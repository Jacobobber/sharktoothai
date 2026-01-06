import { AppError } from "../../../../../shared/utils/errors";

export type IndexedField = {
  raw: string;
  base: string;
  laborIndex?: number;
  partIndex?: number;
  isIndexed: boolean;
};

export type LaborLine = {
  laborIndex: number;
  laborLineNumber?: number;
  opCode?: string;
  laborType?: string;
  skillLevel?: string;
  flatRateHours?: number;
  actualHours?: number;
  laborRate?: number;
  laborExtendedAmount?: number;
  technicianId?: string;
};

export type PartLine = {
  laborIndex: number;
  partIndex: number;
  partLineNumber?: number;
  partNumber?: string;
  partQuantity?: number;
  partUnitPrice?: number;
  partExtendedPrice?: number;
  partSource?: string;
  backorderFlag?: string;
};

export const LABOR_BASE_FIELDS = new Set([
  "LABOR_LINE_NUMBER",
  "OP_CODE",
  "OP_DESCRIPTION",
  "LABOR_TYPE",
  "SKILL_LEVEL",
  "FLAT_RATE_HOURS",
  "ACTUAL_HOURS",
  "LABOR_RATE",
  "LABOR_EXTENDED_AMOUNT",
  "TECHNICIAN_ID",
  "TECHNICIAN_NOTES"
]);

export const PART_BASE_FIELDS = new Set([
  "PART_LINE_NUMBER",
  "PART_NUMBER",
  "PART_DESCRIPTION",
  "PART_QUANTITY",
  "PART_UNIT_PRICE",
  "PART_EXTENDED_PRICE",
  "PART_SOURCE",
  "BACKORDER_FLAG"
]);

export const LINE_ITEM_BASE_FIELDS = new Set([
  ...LABOR_BASE_FIELDS,
  ...PART_BASE_FIELDS
]);

const isNumericSegment = (value: string) => /^[0-9]+$/.test(value);

const parseIndex = (value: string, field: string) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new AppError(`Invalid index in field ${field}`, { status: 400, code: "INDEX_INVALID" });
  }
  return parsed;
};

export const parseIndexedFieldName = (name: string): IndexedField => {
  const parts = name.split("_");
  if (parts.length < 2) {
    return { raw: name, base: name, isIndexed: false };
  }
  const last = parts[parts.length - 1];
  const secondLast = parts[parts.length - 2];

  if (isNumericSegment(last) && isNumericSegment(secondLast)) {
    const base = parts.slice(0, -2).join("_");
    return {
      raw: name,
      base,
      laborIndex: parseIndex(secondLast, name),
      partIndex: parseIndex(last, name),
      isIndexed: true
    };
  }
  if (isNumericSegment(last)) {
    const base = parts.slice(0, -1).join("_");
    return {
      raw: name,
      base,
      laborIndex: parseIndex(last, name),
      isIndexed: true
    };
  }
  return { raw: name, base: name, isIndexed: false };
};

export const ensureContiguousIndices = (indices: number[], label: string) => {
  if (!indices.length) return;
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i += 1) {
    const expected = i + 1;
    if (sorted[i] !== expected) {
      throw new AppError(`Non-contiguous ${label} indices: expected ${expected}`, {
        status: 400,
        code: "INDEX_GAP"
      });
    }
  }
};
