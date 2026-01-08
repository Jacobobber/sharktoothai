import { randomUUID } from "crypto";
import type { RequestContext } from "../../../../../shared/types/api";
import { AppError } from "../../../../../shared/utils/errors";
import type { DbClient } from "../../../../../platform/gateway/src/db/pg";
import type { Chunk } from "./chunk";
import type { EmbeddedChunk } from "./embed";
import type { DeterministicPayload } from "./xmlFieldRouting";
import type { VaultWriteConfirmation } from "../pii/piiVault";
import { assertNoRawPii } from "./redact";
import type { LineItemSemanticRedactions } from "./redact";

type StoreDocumentInput = {
  filename: string;
  mimeType: string;
  sha256Hash: string;
  storagePath: string;
  createdBy: string;
};

const assertVaultWriteConfirmed = (confirmation: VaultWriteConfirmation) => {
  if (!confirmation?.vaultWriteConfirmed) {
    throw new AppError("PII vault write required before deterministic persistence", {
      status: 400,
      code: "PII_VAULT_REQUIRED"
    });
  }
};

export const ensureChunkTables = async (client: DbClient) => {
  const { rows } = await client.query<{ regclass: string | null }>(
    "SELECT to_regclass('app.chunks') AS regclass"
  );
  if (!rows[0]?.regclass) {
    throw new AppError("chunks table missing", { status: 500, code: "SCHEMA_MISSING" });
  }
  const emb = await client.query<{ regclass: string | null }>(
    "SELECT to_regclass('app.embeddings') AS regclass"
  );
  if (!emb.rows[0]?.regclass) {
    throw new AppError("embeddings table missing", { status: 500, code: "SCHEMA_MISSING" });
  }
};

export const storeDocument = async (
  client: DbClient,
  ctx: RequestContext,
  input: StoreDocumentInput
): Promise<string> => {
  const result = await client.query<{ doc_id: string }>(
    `INSERT INTO app.documents
       (doc_id, tenant_id, filename, mime_type, sha256, storage_path, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING doc_id`,
    [
      randomUUID(),
      ctx.tenantId,
      input.filename,
      input.mimeType,
      Buffer.from(input.sha256Hash, "hex"),
      input.storagePath,
      input.createdBy
    ]
  );
  return result.rows[0].doc_id;
};

export const storeRepairOrder = async (
  client: DbClient,
  ctx: RequestContext,
  input: {
    docId: string;
    roNumber: string;
    customerUuid: string;
    roId: string;
    vaultWriteConfirmation: VaultWriteConfirmation;
  }
): Promise<string> => {
  assertVaultWriteConfirmed(input.vaultWriteConfirmation);
  const result = await client.query<{ ro_id: string }>(
    `INSERT INTO app.repair_orders (ro_id, tenant_id, doc_id, ro_number, customer_uuid)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ro_id`,
    [input.roId, ctx.tenantId, input.docId, input.roNumber, input.customerUuid]
  );
  return result.rows[0].ro_id;
};

export const storeRepairOrderDetails = async (
  client: DbClient,
  ctx: RequestContext,
  roId: string,
  payload: DeterministicPayload,
  customerUuid: string,
  vaultWriteConfirmation: VaultWriteConfirmation,
  lineItemSemanticRedactions: LineItemSemanticRedactions
) => {
  assertVaultWriteConfirmed(vaultWriteConfirmation);
  await client.query(
    `UPDATE app.repair_orders
     SET ro_status = $2,
         open_timestamp = $3,
         close_timestamp = $4
     WHERE ro_id = $1 AND tenant_id = $5`,
    [roId, payload.roStatus ?? null, payload.openTimestamp ?? null, payload.closeTimestamp ?? null, ctx.tenantId]
  );
  await client.query(`DELETE FROM app.ro_labor_lines WHERE tenant_id = $1 AND ro_id = $2`, [
    ctx.tenantId,
    roId
  ]);
  await client.query(`DELETE FROM app.ro_parts_lines WHERE tenant_id = $1 AND ro_id = $2`, [
    ctx.tenantId,
    roId
  ]);

  for (const labor of payload.laborLines) {
    const laborKey = String(labor.laborIndex);
    const laborRedactions = lineItemSemanticRedactions.labor[laborKey];
    const opDescriptionRedacted = laborRedactions?.opDescriptionRedacted ?? null;
    const technicianNotesRedacted = laborRedactions?.technicianNotesRedacted ?? null;
    if (opDescriptionRedacted) assertNoRawPii(opDescriptionRedacted);
    if (technicianNotesRedacted) assertNoRawPii(technicianNotesRedacted);
    await client.query(
      `INSERT INTO app.ro_labor_lines
       (labor_id, tenant_id, ro_id, labor_index, labor_line_number, op_code, labor_type, skill_level,
        flat_rate_hours, actual_hours, labor_rate, labor_extended_amount, technician_id, technician_code,
        op_description, technician_notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        randomUUID(),
        ctx.tenantId,
        roId,
        labor.laborIndex,
        labor.laborLineNumber ?? null,
        labor.opCode ?? null,
        labor.laborType ?? null,
        labor.skillLevel ?? null,
        labor.flatRateHours ?? null,
        labor.actualHours ?? null,
        labor.laborRate ?? null,
        labor.laborExtendedAmount ?? null,
        labor.technicianId ?? null,
        labor.technicianId ?? null,
        opDescriptionRedacted,
        technicianNotesRedacted
      ]
    );
  }

  for (const part of payload.partLines) {
    const partKey = `${part.laborIndex}_${part.partIndex}`;
    const partRedactions = lineItemSemanticRedactions.parts[partKey];
    const partDescriptionRedacted = partRedactions?.partDescriptionRedacted ?? null;
    if (partDescriptionRedacted) assertNoRawPii(partDescriptionRedacted);
    await client.query(
      `INSERT INTO app.ro_parts_lines
       (part_line_id, tenant_id, ro_id, labor_index, part_index, part_line_number, part_number,
        quantity, unit_price, line_total, part_source, backorder_flag, part_description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        randomUUID(),
        ctx.tenantId,
        roId,
        part.laborIndex,
        part.partIndex,
        part.partLineNumber ?? null,
        part.partNumber ?? null,
        part.partQuantity ?? null,
        part.partUnitPrice ?? null,
        part.partExtendedPrice ?? null,
        part.partSource ?? null,
        part.backorderFlag ?? null,
        partDescriptionRedacted
      ]
    );
  }

  await client.query(
    `INSERT INTO app.ro_deterministic_v2
       (ro_id, tenant_id, customer_uuid, ro_number, ro_status, open_timestamp, close_timestamp, writeup_timestamp,
        promised_timestamp, advisor_id, service_lane, department_code, waiter_flag, loaner_flag,
        warranty_flag, fleet_flag, internal_ro_flag, customer_type, preferred_contact_method,
        marketing_opt_in, vehicle_year, vehicle_make, vehicle_model, vehicle_trim, vehicle_engine,
        vehicle_transmission, vehicle_drivetrain, odometer_in, odometer_out, vehicle_color,
        vehicle_production_date, labor_line_number, op_code, labor_type, skill_level, flat_rate_hours,
        actual_hours, labor_rate, labor_extended_amount, technician_id, part_line_number, part_number,
        part_quantity, part_unit_price, part_extended_price, part_source, backorder_flag, labor_total,
        parts_total, shop_fees, environmental_fees, discount_total, tax_total, grand_total, payment_method,
        invoice_number, created_by_system, ingest_timestamp, tenant_id_source, source_system)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55,$56,$57,$58,$59,$60,$61,$62)
     ON CONFLICT (ro_id)
     DO UPDATE SET
       customer_uuid = EXCLUDED.customer_uuid,
       ro_number = EXCLUDED.ro_number,
       ro_status = EXCLUDED.ro_status,
       open_timestamp = EXCLUDED.open_timestamp,
       close_timestamp = EXCLUDED.close_timestamp,
       writeup_timestamp = EXCLUDED.writeup_timestamp,
       promised_timestamp = EXCLUDED.promised_timestamp,
       advisor_id = EXCLUDED.advisor_id,
       service_lane = EXCLUDED.service_lane,
       department_code = EXCLUDED.department_code,
       waiter_flag = EXCLUDED.waiter_flag,
       loaner_flag = EXCLUDED.loaner_flag,
       warranty_flag = EXCLUDED.warranty_flag,
       fleet_flag = EXCLUDED.fleet_flag,
       internal_ro_flag = EXCLUDED.internal_ro_flag,
       customer_type = EXCLUDED.customer_type,
       preferred_contact_method = EXCLUDED.preferred_contact_method,
       marketing_opt_in = EXCLUDED.marketing_opt_in,
       vehicle_year = EXCLUDED.vehicle_year,
       vehicle_make = EXCLUDED.vehicle_make,
       vehicle_model = EXCLUDED.vehicle_model,
       vehicle_trim = EXCLUDED.vehicle_trim,
       vehicle_engine = EXCLUDED.vehicle_engine,
       vehicle_transmission = EXCLUDED.vehicle_transmission,
       vehicle_drivetrain = EXCLUDED.vehicle_drivetrain,
       odometer_in = EXCLUDED.odometer_in,
       odometer_out = EXCLUDED.odometer_out,
       vehicle_color = EXCLUDED.vehicle_color,
       vehicle_production_date = EXCLUDED.vehicle_production_date,
       labor_line_number = EXCLUDED.labor_line_number,
       op_code = EXCLUDED.op_code,
       labor_type = EXCLUDED.labor_type,
       skill_level = EXCLUDED.skill_level,
       flat_rate_hours = EXCLUDED.flat_rate_hours,
       actual_hours = EXCLUDED.actual_hours,
       labor_rate = EXCLUDED.labor_rate,
       labor_extended_amount = EXCLUDED.labor_extended_amount,
       technician_id = EXCLUDED.technician_id,
       part_line_number = EXCLUDED.part_line_number,
       part_number = EXCLUDED.part_number,
       part_quantity = EXCLUDED.part_quantity,
       part_unit_price = EXCLUDED.part_unit_price,
       part_extended_price = EXCLUDED.part_extended_price,
       part_source = EXCLUDED.part_source,
       backorder_flag = EXCLUDED.backorder_flag,
       labor_total = EXCLUDED.labor_total,
       parts_total = EXCLUDED.parts_total,
       shop_fees = EXCLUDED.shop_fees,
       environmental_fees = EXCLUDED.environmental_fees,
       discount_total = EXCLUDED.discount_total,
       tax_total = EXCLUDED.tax_total,
       grand_total = EXCLUDED.grand_total,
       payment_method = EXCLUDED.payment_method,
       invoice_number = EXCLUDED.invoice_number,
       created_by_system = EXCLUDED.created_by_system,
       ingest_timestamp = EXCLUDED.ingest_timestamp,
       tenant_id_source = EXCLUDED.tenant_id_source,
       source_system = EXCLUDED.source_system`,
    [
      roId,
      ctx.tenantId,
      customerUuid,
      payload.roNumber ?? null,
      payload.roStatus ?? null,
      payload.openTimestamp ?? null,
      payload.closeTimestamp ?? null,
      payload.writeupTimestamp ?? null,
      payload.promisedTimestamp ?? null,
      payload.advisorId ?? null,
      payload.serviceLane ?? null,
      payload.departmentCode ?? null,
      payload.waiterFlag ?? null,
      payload.loanerFlag ?? null,
      payload.warrantyFlag ?? null,
      payload.fleetFlag ?? null,
      payload.internalRoFlag ?? null,
      payload.customerType ?? null,
      payload.preferredContactMethod ?? null,
      payload.marketingOptIn ?? null,
      payload.vehicleYear ?? null,
      payload.vehicleMake ?? null,
      payload.vehicleModel ?? null,
      payload.vehicleTrim ?? null,
      payload.vehicleEngine ?? null,
      payload.vehicleTransmission ?? null,
      payload.vehicleDrivetrain ?? null,
      payload.odometerIn ?? null,
      payload.odometerOut ?? null,
      payload.vehicleColor ?? null,
      payload.vehicleProductionDate ?? null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      payload.laborTotal ?? null,
      payload.partsTotal ?? null,
      payload.shopFees ?? null,
      payload.environmentalFees ?? null,
      payload.discountTotal ?? null,
      payload.taxTotal ?? null,
      payload.grandTotal ?? null,
      payload.paymentMethod ?? null,
      payload.invoiceNumber ?? null,
      payload.createdBySystem ?? null,
      payload.ingestTimestamp ?? null,
      payload.tenantId ?? null,
      payload.sourceSystem ?? null
    ]
  );
};

export const storeChunksAndEmbeddings = async (
  client: DbClient,
  ctx: RequestContext,
  input: { roId: string; chunks: Chunk[]; embeddings: EmbeddedChunk[] }
) => {
  for (const chunk of input.chunks) {
    const chunkInsert = await client.query<{ chunk_id: string }>(
      `INSERT INTO app.chunks (chunk_id, tenant_id, ro_id, chunk_text, chunk_index)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING chunk_id`,
      [randomUUID(), ctx.tenantId, input.roId, chunk.text, chunk.index]
    );
    const chunkId = chunkInsert.rows[0].chunk_id;
    const embedding = input.embeddings.find((e) => e.chunkId === chunk.id);
    if (!embedding) continue;

    const vectorLiteral = `[${embedding.embedding.join(",")}]`;
    await client.query(
      `INSERT INTO app.embeddings (embedding_id, tenant_id, chunk_id, embedding)
       VALUES ($1, $2, $3, $4::vector)`,
      [randomUUID(), ctx.tenantId, chunkId, vectorLiteral]
    );
  }
};
