import type { RequestContext } from "../../../../../shared/types/api";
import type { DbClient } from "../../../../../platform/gateway/src/db/pg";
import { buildPiiHashes } from "../pii/piiHash";
import { resolveTenantScope } from "./tenantScope";

export type StrictLookupResult = {
  roIds: string[];
  roNumbers: string[];
};

const parseRoNumbers = (input: string): string[] => {
  const matches = input.match(/RO[-\s]?\d{3,6}/gi) ?? [];
  const normalized = matches.map((match) => {
    const cleaned = match.replace(/\s+/g, "-").toUpperCase();
    return cleaned.includes("RO-") ? cleaned : cleaned.replace("RO", "RO-");
  });
  return Array.from(new Set(normalized));
};

const parseDateTokens = (input: string): string[] => {
  const matches = input.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
  return Array.from(new Set(matches));
};

const parsePartNumber = (input: string): string | null => {
  const match = input.match(/part\s*number\s*[:#]?\s*([A-Z0-9-]{4,})/i);
  return match ? match[1].toUpperCase() : null;
};

const parseOpCode = (input: string): string | null => {
  const match = input.match(/op\s*code\s*[:#]?\s*([A-Z0-9-]{2,})/i);
  return match ? match[1].toUpperCase() : null;
};

const extractPiiHints = (input: string) => {
  const emailMatch = input.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const vinMatch = input.match(/\b[0-9A-HJ-NPR-Z]{17}\b/i);
  const phoneMatch = input.match(/(\+?\d[\d\s().-]{8,}\d)/);
  const lastNameMatch = input.match(/last\s+name\s+([a-zA-Z'-]{2,})/i);
  const nameMatch = input.match(/\bname\s+([a-zA-Z'-]{2,})/i);

  return {
    email: emailMatch ? emailMatch[0] : null,
    vin: vinMatch ? vinMatch[0] : null,
    phone: phoneMatch ? phoneMatch[0] : null,
    name: lastNameMatch ? lastNameMatch[1] : nameMatch ? nameMatch[1] : null
  };
};

export const resolveStrictLookup = async (
  client: DbClient,
  ctx: RequestContext,
  input: string,
  scopeTenantId?: string | null,
  scopeGroupId?: string | null
): Promise<StrictLookupResult> => {
  const scope = await resolveTenantScope(client, ctx, {
    scopeTenantId,
    scopeGroupId
  });

  const roNumbers = parseRoNumbers(input);
  const dateTokens = parseDateTokens(input);
  const partNumber = parsePartNumber(input);
  const opCode = parseOpCode(input);
  const piiHints = extractPiiHints(input);

  const roIds = new Set<string>();
  const resolvedRoNumbers = new Set<string>();

  if (roNumbers.length) {
    const result = await client.query<{ ro_id: string; ro_number: string }>(
      `SELECT ro_id, ro_number
       FROM app.repair_orders
       WHERE tenant_id = ANY($1::uuid[])
         AND ro_number = ANY($2::text[])`,
      [scope.tenantIds, roNumbers]
    );
    result.rows.forEach((row) => {
      roIds.add(row.ro_id);
      resolvedRoNumbers.add(row.ro_number);
    });
  }

  if (dateTokens.length) {
    const result = await client.query<{ ro_id: string; ro_number: string }>(
      `SELECT ro_id, ro_number
       FROM app.repair_orders
       WHERE tenant_id = ANY($1::uuid[])
         AND (
           ro_open_date = ANY($2::date[])
           OR ro_close_date = ANY($2::date[])
         )`,
      [scope.tenantIds, dateTokens]
    );
    result.rows.forEach((row) => {
      roIds.add(row.ro_id);
      resolvedRoNumbers.add(row.ro_number);
    });
  }

  if (partNumber) {
    const result = await client.query<{ ro_id: string }>(
      `SELECT DISTINCT ro_id
       FROM app.ro_parts_lines
       WHERE tenant_id = ANY($1::uuid[])
         AND part_number = $2`,
      [scope.tenantIds, partNumber]
    );
    result.rows.forEach((row) => roIds.add(row.ro_id));
  }

  if (opCode) {
    const result = await client.query<{ ro_id: string }>(
      `SELECT DISTINCT ro_id
       FROM app.ro_labor_lines
       WHERE tenant_id = ANY($1::uuid[])
         AND operation = $2`,
      [scope.tenantIds, opCode]
    );
    result.rows.forEach((row) => roIds.add(row.ro_id));
  }

  let hashList: string[] = [];
  try {
    const piiHashes = buildPiiHashes({
      customerName: piiHints.name ?? undefined,
      emails: piiHints.email ? [piiHints.email] : undefined,
      phones: piiHints.phone ? [piiHints.phone] : undefined,
      vins: piiHints.vin ? [piiHints.vin] : undefined
    });
    hashList = [
      piiHashes.nameHash,
      ...piiHashes.emailHashes,
      ...piiHashes.phoneHashes,
      ...piiHashes.vinHashes
    ].filter(Boolean) as string[];
  } catch {
    hashList = [];
  }

  if (hashList.length) {
    for (const tenantId of scope.tenantIds) {
      const result = await client.query<{ ro_id: string; customer_id: string }>(
        `SELECT ro_id, customer_id
         FROM app.lookup_customer_ids($1, $2)`,
        [tenantId, hashList]
      );
      result.rows.forEach((row) => {
        if (row.ro_id) roIds.add(row.ro_id);
      });
    }
  }

  if (roIds.size) {
    const result = await client.query<{ ro_id: string; ro_number: string }>(
      `SELECT ro_id, ro_number
       FROM app.repair_orders
       WHERE tenant_id = ANY($1::uuid[])
         AND ro_id = ANY($2::uuid[])`,
      [scope.tenantIds, Array.from(roIds)]
    );
    result.rows.forEach((row) => resolvedRoNumbers.add(row.ro_number));
  }

  return {
    roIds: Array.from(roIds),
    roNumbers: Array.from(resolvedRoNumbers)
  };
};
