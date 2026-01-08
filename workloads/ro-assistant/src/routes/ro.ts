import type { RequestHandler } from "express";
import type { RequestWithContext } from "../../../../shared/types/api";
import { AppError } from "../../../../shared/utils/errors";
import { auditLog } from "../../../../platform/gateway/src/core/audit/auditService";
import { withRequestContext } from "../../../../platform/gateway/src/db/pg";

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export const roHandler: RequestHandler = async (req, res) => {
  const ctx = (req as RequestWithContext).context;
  if (!ctx?.role || !ctx?.tenantId || !ctx?.userId || !ctx?.requestId) {
    const error = new AppError("Missing request context", { status: 400, code: "CTX_MISSING" });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }
  if (ctx.role !== "USER" && ctx.role !== "ADMIN" && ctx.role !== "DEALERADMIN" && ctx.role !== "DEVELOPER") {
    const error = new AppError("Insufficient role", { status: 403, code: "ROLE_FORBIDDEN" });
    return res.status(error.status ?? 403).json({ error: error.code, message: error.message });
  }

  const roId = req.params.ro_id;
  if (!roId) {
    const error = new AppError("ro_id required", { status: 400, code: "BAD_REQUEST" });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }
  if (!isUuid(roId)) {
    const error = new AppError("ro_id must be a UUID", { status: 400, code: "INVALID_ID" });
    return res.status(error.status ?? 400).json({ error: error.code, message: error.message });
  }

  try {
    const { roResult, chunksResult } = await withRequestContext(ctx, async (client) => {
      const roResult = await client.query(
        `SELECT r.ro_id,
                r.ro_number,
                r.doc_id,
                r.created_at,
                d.ro_number AS det_ro_number,
                d.ro_status,
                d.open_timestamp,
                d.close_timestamp,
                d.advisor_id,
                d.technician_id,
                d.vehicle_year,
                d.vehicle_make,
                d.vehicle_model,
                d.vehicle_color,
                d.odometer_in AS mileage_in,
                d.odometer_out AS mileage_out,
                d.labor_total,
                d.parts_total,
                d.tax_total,
                d.discount_total,
                d.grand_total AS total_due
           FROM app.repair_orders r
           LEFT JOIN app.ro_deterministic_v2 d
             ON d.tenant_id = r.tenant_id AND d.ro_number = r.ro_number
          WHERE r.tenant_id = $1 AND r.ro_id = $2`,
        [ctx.tenantId, roId]
      );

      if (!roResult.rowCount) {
        return { roResult, chunksResult: null };
      }

      if (!roResult.rows[0]?.det_ro_number) {
        throw new AppError("Deterministic payload missing for RO", {
          status: 500,
          code: "RO_DETERMINISTIC_MISSING"
        });
      }

      const chunksResult = await client.query(
        `SELECT chunk_id, chunk_index, chunk_text
           FROM app.chunks
          WHERE tenant_id = $1 AND ro_id = $2
          ORDER BY chunk_index ASC`,
        [ctx.tenantId, roId]
      );

      return { roResult, chunksResult };
    });

    if (!roResult?.rowCount || !chunksResult) {
      const error = new AppError("RO not found", { status: 404, code: "NOT_FOUND" });
      return res.status(error.status ?? 404).json({ error: error.code, message: error.message });
    }

    await auditLog(ctx, {
      action: "VIEW_RO",
      object_type: "repair_order",
      object_id: roId
    });

    const { det_ro_number: _det_ro_number, ...ro } = roResult.rows[0];
    return res.status(200).json({
      ro,
      chunks: chunksResult.rows.map((c) => ({
        chunk_id: c.chunk_id,
        chunk_index: c.chunk_index,
        excerpt: c.chunk_text
      }))
    });
  } catch (err) {
    const error = new AppError("RO fetch failed", { status: 500, code: "RO_FETCH_FAILED" });
    return res.status(error.status ?? 500).json({ error: error.code, message: error.message });
  }
};
