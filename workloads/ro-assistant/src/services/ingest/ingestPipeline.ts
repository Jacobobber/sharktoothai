import type { RequestContext } from "../../../../../shared/types/api";
import { AppError } from "../../../../../shared/utils/errors";
import { sha256 } from "../../../../../shared/utils/hash";
import { randomUUID } from "crypto";
import { auditLog } from "../../../../../platform/gateway/src/core/audit/auditService";
import { runWithTransaction } from "../../../../../platform/gateway/src/db/pg";
import { extractText } from "./extractText";
import {
  redactSemanticText,
  assertNoRawPii,
  buildLineItemSemanticRedactions
} from "./redact";
import { chunkText } from "./chunk";
import { embedChunks } from "./embed";
import {
  storeDocument,
  storeRepairOrder,
  ensureChunkTables,
  storeChunksAndEmbeddings,
  storeRepairOrderDetails
} from "./store";
import { encryptPiiPayload } from "../pii/piiEncrypt";
import { writePiiVaultRecord } from "../pii/piiVault";
import { isTenantPiiEnabled } from "../tenant/tenantConfig";
import { resolveCustomerIdentity } from "./customerIdentity";
import {
  assertNoPiiInSemantic,
  buildSemanticXml,
  routeXmlToPayloads,
  stripXmlTags,
  validateRoutedPayloads
} from "./xmlFieldRouting";

type IngestPipelineInput = {
  filename: string;
  fileBuffer: Buffer;
  mimeType?: string;
  roNumber?: string;
};

export const runIngestPipeline = async (
  ctx: Required<RequestContext>,
  input: IngestPipelineInput
) => {
  const digest = sha256(input.fileBuffer);

  await runWithTransaction(ctx, async (client) => {
    const rawText = extractText(input.fileBuffer);
    const routed = routeXmlToPayloads(rawText);
    assertNoPiiInSemantic(routed.semanticPayload);
    const piiEnabled = await isTenantPiiEnabled(client, ctx);

    validateRoutedPayloads({
      deterministicPayload: routed.deterministicPayload,
      piiPayload: routed.piiPayload,
      semanticPayload: routed.semanticPayload,
      piiEnabled
    });

    const customerIdentity = await resolveCustomerIdentity(client, ctx, routed.piiPayload);
    assertNoPiiInDeterministic(routed.piiPayload, routed.deterministicPayload);
    if (!customerIdentity.customerUuid) {
      throw new AppError("customer_uuid missing", { status: 400, code: "CUSTOMER_IDENTITY_MISSING" });
    }

    if (
      input.roNumber &&
      routed.deterministicPayload.roNumber &&
      routed.deterministicPayload.roNumber !== input.roNumber
    ) {
      throw new AppError("RO number mismatch between payload and request", {
        status: 400,
        code: "RO_NUMBER_MISMATCH"
      });
    }

    const roNumber = input.roNumber ?? routed.deterministicPayload.roNumber;
    if (!roNumber) {
      throw new AppError("RO number missing", { status: 400, code: "RO_NUMBER_MISSING" });
    }

    if (!piiEnabled) {
      throw new AppError("PII vaulting must be enabled for ingest", {
        status: 400,
        code: "PII_DISABLED"
      });
    }

    const piiPayload = routed.piiPayload;
    if (!piiPayload) {
      throw new AppError("PII payload missing", { status: 400, code: "PII_MISSING" });
    }
    const roId = randomUUID();
    const encrypted = await encryptPiiPayload(piiPayload);
    // PII vaulting must precede deterministic persistence — do not reorder.
    const vaultWriteConfirmation = await writePiiVaultRecord(client, ctx, {
      roId,
      customerUuid: customerIdentity.customerUuid,
      keyRef: encrypted.keyRef,
      nonce: encrypted.nonce,
      ciphertext: encrypted.ciphertext,
      nameHash: customerIdentity.nameHash,
      emailHashes: customerIdentity.emailHashes,
      phoneHashes: customerIdentity.phoneHashes,
      vinHashes: customerIdentity.vinHashes,
      licensePlateHashes: customerIdentity.licensePlateHashes,
      addressHash: customerIdentity.addressHash
    });
    await auditLog(ctx, {
      action: "PII_WRITE",
      object_type: "pii_vault",
      object_id: roId,
      metadata: { fields: Object.keys(routed.piiPayload ?? {}) }
    });

    await auditLog(ctx, {
      action: "UPLOAD_DOC",
      object_type: "document",
      object_id: digest.slice(0, 12),
      metadata: { filename: input.filename }
    });

    await ensureChunkTables(client);

    const docId = await storeDocument(client, ctx, {
      filename: input.filename,
      mimeType: input.mimeType ?? "application/octet-stream",
      sha256Hash: digest,
      storagePath: `ingest/${ctx.tenantId}/${digest}`,
      createdBy: ctx.userId
    });

    await storeRepairOrder(client, ctx, {
      docId,
      roNumber,
      customerUuid: customerIdentity.customerUuid,
      roId,
      vaultWriteConfirmation
    });

    const lineItemSemanticRedactions = buildLineItemSemanticRedactions(routed.semanticPayload);
    await storeRepairOrderDetails(
      client,
      ctx,
      roId,
      routed.deterministicPayload,
      customerIdentity.customerUuid,
      vaultWriteConfirmation,
      lineItemSemanticRedactions
    );

    // Redaction is defense-in-depth; primary PII exclusion is structural.
    const semanticXml = buildSemanticXml(routed.semanticPayload);
    const semanticText = stripXmlTags(semanticXml);
    const redactedText = redactSemanticText(semanticText);
    assertSemanticRedaction(routed.piiPayload, redactedText);
    assertNoRawPii(redactedText);
    assertNoCustomerUuidInSemantic(redactedText, customerIdentity.customerUuid);

    const chunks = chunkText(redactedText);
    const embeddings = await embedChunks(chunks);

    await storeChunksAndEmbeddings(client, ctx, { roId, chunks, embeddings });

    await auditLog(ctx, {
      action: "INGEST_COMPLETE",
      object_type: "repair_order",
      object_id: roId,
      metadata: { chunks: chunks.length }
    });
  });
};

const flattenPiiValues = (piiPayload: ReturnType<typeof routeXmlToPayloads>["piiPayload"]) => {
  if (!piiPayload) return [];
  const values: string[] = [];
  if (piiPayload.customerName) values.push(piiPayload.customerName);
  if (piiPayload.emails) values.push(...piiPayload.emails);
  if (piiPayload.phones) values.push(...piiPayload.phones);
  if (piiPayload.vins) values.push(...piiPayload.vins);
  if (piiPayload.licensePlates) values.push(...piiPayload.licensePlates);
  if (piiPayload.paymentMethods) values.push(...piiPayload.paymentMethods);
  if (piiPayload.address?.line1) values.push(piiPayload.address.line1);
  if (piiPayload.address?.line2) values.push(piiPayload.address.line2);
  if (piiPayload.address?.city) values.push(piiPayload.address.city);
  if (piiPayload.address?.state) values.push(piiPayload.address.state);
  if (piiPayload.address?.zip) values.push(piiPayload.address.zip);
  return values.filter(Boolean);
};

const assertSemanticRedaction = (
  piiPayload: ReturnType<typeof routeXmlToPayloads>["piiPayload"],
  redactedText: string
) => {
  const haystack = redactedText.toLowerCase();
  const values = flattenPiiValues(piiPayload);
  const leaked = values.find((value) => haystack.includes(value.toLowerCase()));
  if (leaked) {
    throw new AppError("PII detected in semantic payload after redaction", {
      status: 400,
      code: "PII_SEMANTIC_LEAK"
    });
  }
};

const assertNoPiiInDeterministic = (
  piiPayload: ReturnType<typeof routeXmlToPayloads>["piiPayload"],
  payload: ReturnType<typeof routeXmlToPayloads>["deterministicPayload"]
) => {
  if (!piiPayload) return;
  const haystack = JSON.stringify(payload).toLowerCase();
  const values = flattenPiiValues(piiPayload);
  const leaked = values.find((value) => haystack.includes(value.toLowerCase()));
  if (leaked) {
    throw new AppError("PII detected in deterministic payload", {
      status: 400,
      code: "PII_DETERMINISTIC_LEAK"
    });
  }
};

const assertNoCustomerUuidInSemantic = (semanticText: string, customerUuid: string) => {
  if (semanticText.toLowerCase().includes(customerUuid.toLowerCase())) {
    throw new AppError("customer_uuid leaked into semantic payload", {
      status: 400,
      code: "CUSTOMER_UUID_SEMANTIC_LEAK"
    });
  }
};
