import type { RequestHandler } from "express";
import type { RequestWithContext } from "../../../../shared/types/api";
import { AppError } from "../../../../shared/utils/errors";
import { sha256 } from "../../../../shared/utils/hash";
import { randomUUID } from "crypto";
import { auditLog } from "../../../../platform/gateway/src/core/audit/auditService";
import { runWithTransaction } from "../../../../platform/gateway/src/db/pg";
import type { DbClient } from "../../../../platform/gateway/src/db/pg";
import { assertTenantContext } from "../../../../platform/gateway/src/core/tenant/tenantContext";
import { validateFileType } from "../services/ingest/validate";
import { extractText } from "../services/ingest/extractText";
import {
  redactSemanticText,
  assertNoRawPii,
  buildLineItemSemanticRedactions
} from "../services/ingest/redact";
import { chunkText } from "../services/ingest/chunk";
import { embedChunks } from "../services/ingest/embed";
import {
  storeDocument,
  storeRepairOrder,
  ensureChunkTables,
  storeChunksAndEmbeddings,
  storeRepairOrderDetails
} from "../services/ingest/store";
import { encryptPiiPayload } from "../services/pii/piiEncrypt";
import { writePiiVaultRecord } from "../services/pii/piiVault";
import { isTenantPiiEnabled } from "../services/tenant/tenantConfig";
import { resolveCustomerIdentity } from "../services/ingest/customerIdentity";
import {
  assertNoPiiInSemantic,
  buildSemanticXml,
  routeXmlToPayloads,
  stripXmlTags,
  validateRoutedPayloads,
  type SemanticEntry
} from "../services/ingest/xmlFieldRouting";

type IngestBody = {
  filename: string;
  content_base64: string;
  ro_number: string;
  mime_type?: string;
};

const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 5 * 1024 * 1024);

const decodeContent = (content_base64: string) => {
  try {
    return Buffer.from(content_base64, "base64");
  } catch (err) {
    throw new AppError("Invalid file content encoding", { status: 400, code: "CONTENT_DECODE" });
  }
};

export const ingestHandler: RequestHandler = async (req, res) => {
  const ctx = (req as RequestWithContext).context;
  if (!ctx?.requestId || !ctx?.tenantId || !ctx?.userId || !ctx?.role) {
    const error = new AppError("Missing request context", { status: 400, code: "CTX_MISSING" });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }

  if (ctx.role !== "ADMIN" && ctx.role !== "DEALERADMIN" && ctx.role !== "DEVELOPER") {
    const error = new AppError("Admin role required", { status: 403, code: "ADMIN_ONLY" });
    return res.status(error.status ?? 403).json({ error: error.code, message: error.message });
  }

  const body = req.body as IngestBody;
  const safeCtx = assertTenantContext(ctx);
  if (!body?.filename || !body?.content_base64 || !body?.ro_number) {
    const error = new AppError("filename, content_base64, and ro_number are required", {
      status: 400,
      code: "BAD_REQUEST"
    });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }

  try {
    validateFileType(body.filename);
  } catch (err) {
    const error = err instanceof AppError ? err : new AppError("Invalid file type", { status: 400 });
    await auditLog(ctx ?? {}, {
      action: "INGEST_FAILED",
      object_type: "repair_order",
      object_id: safeCtx.requestId,
      metadata: { reason: "invalid_file_type", stage: "validate" }
    });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }

  if (body.content_base64.length > MAX_UPLOAD_BYTES * 2) {
    return res.status(413).json({ error: "FILE_TOO_LARGE", message: "Upload too large" });
  }

  const fileBuffer = decodeContent(body.content_base64);
  if (fileBuffer.byteLength > MAX_UPLOAD_BYTES) {
    await auditLog(ctx ?? {}, {
      action: "INGEST_FAILED",
      object_type: "repair_order",
      object_id: safeCtx.requestId,
      metadata: { reason: "file_too_large", stage: "validate" }
    });
    return res.status(413).json({ error: "FILE_TOO_LARGE", message: "Upload too large" });
  }
  const digest = sha256(fileBuffer);

  try {
    await runWithTransaction(safeCtx, async (client) => {
      const rawText = extractText(fileBuffer);
      const routed = routeXmlToPayloads(rawText);
      assertNoPiiInSemantic(routed.semanticPayload);
      const piiEnabled = await isTenantPiiEnabled(client, safeCtx);

      validateRoutedPayloads({
        deterministicPayload: routed.deterministicPayload,
        piiPayload: routed.piiPayload,
        semanticPayload: routed.semanticPayload,
        piiEnabled
      });
      await validateRoNumberSequence(client, safeCtx, routed.deterministicPayload.roNumber);

      const customerIdentity = await resolveCustomerIdentity(client, safeCtx, routed.piiPayload);
      assertNoPiiInDeterministic(routed.piiPayload, routed.deterministicPayload);
      if (!customerIdentity.customerUuid) {
        throw new AppError("customer_uuid missing", { status: 400, code: "CUSTOMER_IDENTITY_MISSING" });
      }

      if (
        routed.deterministicPayload.roNumber &&
        routed.deterministicPayload.roNumber !== body.ro_number
      ) {
        throw new AppError("RO number mismatch between payload and request", {
          status: 400,
          code: "RO_NUMBER_MISMATCH"
        });
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
      const vaultWriteConfirmation = await writePiiVaultRecord(client, safeCtx, {
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
      await auditLog(safeCtx, {
        action: "PII_WRITE",
        object_type: "pii_vault",
        object_id: roId,
        metadata: { fields: Object.keys(routed.piiPayload ?? {}) }
      });

      await auditLog(safeCtx, {
        action: "UPLOAD_DOC",
        object_type: "document",
        object_id: digest.slice(0, 12),
        metadata: { filename: body.filename }
      });

      await ensureChunkTables(client);

      const docId = await storeDocument(client, safeCtx, {
        filename: body.filename,
        mimeType: body.mime_type ?? "application/octet-stream",
        sha256Hash: digest,
        storagePath: `ingest/${safeCtx.tenantId}/${digest}`,
        createdBy: safeCtx.userId
      });

      await storeRepairOrder(client, safeCtx, {
        docId,
        roNumber: body.ro_number,
        customerUuid: customerIdentity.customerUuid,
        roId,
        vaultWriteConfirmation
      });

      const lineItemSemanticRedactions = buildLineItemSemanticRedactions(routed.semanticPayload);
      await storeRepairOrderDetails(
        client,
        safeCtx,
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

      await storeChunksAndEmbeddings(client, safeCtx, { roId, chunks, embeddings });

      await auditLog(safeCtx, {
        action: "INGEST_COMPLETE",
        object_type: "repair_order",
        object_id: roId,
        metadata: { chunks: chunks.length }
      });
    });
  } catch (err) {
    const status =
      err instanceof AppError && err.code === "EMBED_FAIL"
        ? 503
        : err instanceof AppError && err.status
          ? err.status
          : 500;
    const code = err instanceof AppError && err.code ? err.code : "INGEST_ERROR";
    const msg =
      err instanceof AppError && err.code === "EMBED_FAIL"
        ? "Embedding unavailable"
        : err instanceof AppError
          ? err.message
          : "Ingestion failed";
    let stage = "unknown";
    if (err instanceof AppError && err.code === "PII_DETECTED") stage = "pii_detected";
    if (err instanceof AppError && err.code === "EMBED_FAIL") stage = "embed";

    await auditLog(ctx ?? {}, {
      action: "INGEST_FAILED",
      object_type: "repair_order",
      object_id: safeCtx?.requestId ?? undefined,
      metadata: {
        reason: msg.slice(0, 120),
        stage
      }
    });

    const includeDetail = process.env.NODE_ENV !== "production";
    const detail = includeDetail && err instanceof Error ? err.message : undefined;
    return res.status(status).json({ error: code, message: msg, detail });
  }

  return res.status(201).json({ status: "ok" });
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

const validateRoNumberSequence = async (
  client: DbClient,
  ctx: RequestWithContext["context"],
  roNumber?: string
) => {
  if (!roNumber) return;
  const mode = (process.env.RO_SEQUENCE_MODE ?? "off").toLowerCase();
  if (mode === "off") return;

  const result = await client.query<{ max_ro: string | null }>(
    `SELECT MAX(CAST(ro_number AS bigint)) AS max_ro
     FROM app.repair_orders
     WHERE tenant_id = $1 AND ro_number ~ '^[0-9]{7}$'`,
    [ctx?.tenantId]
  );
  const maxValue = result.rows[0]?.max_ro ? Number.parseInt(result.rows[0].max_ro, 10) : null;
  const current = Number.parseInt(roNumber, 10);
  if (Number.isFinite(maxValue) && current <= (maxValue as number)) {
    if (mode === "strict") {
      throw new AppError("RO_NUMBER is not sequential", {
        status: 400,
        code: "RO_SEQUENCE_INVALID"
      });
    }
    await auditLog(ctx ?? {}, {
      action: "INGEST_WARNING",
      object_type: "repair_order",
      object_id: roNumber,
      metadata: { reason: "ro_sequence_non_monotonic" }
    });
  }
};
