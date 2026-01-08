// This file is authoritative.
// Any new RO fields must be classified here.
// PII paths must never be embedded.
import { AppError } from "../../../../../shared/utils/errors";
import type { PiiPayload } from "../pii/piiExtract";
import {
  LABOR_BASE_FIELDS,
  LINE_ITEM_BASE_FIELDS,
  PART_BASE_FIELDS,
  parseIndexedFieldName,
  ensureContiguousIndices,
  type LaborLine,
  type PartLine
} from "./lineItemIndexing";
import { PII_FIELDS, DETERMINISTIC_FIELDS, SEMANTIC_FIELDS } from "./roSchemaV2Fields";

export type SemanticEntry = { path: string; text: string; laborIndex?: number; partIndex?: number };

export type DeterministicPayload = {
  roNumber?: string;
  roStatus?: string;
  openTimestamp?: string;
  closeTimestamp?: string;
  writeupTimestamp?: string;
  promisedTimestamp?: string;
  advisorId?: string;
  serviceLane?: string;
  departmentCode?: string;
  waiterFlag?: string;
  loanerFlag?: string;
  warrantyFlag?: string;
  fleetFlag?: string;
  internalRoFlag?: string;
  customerType?: string;
  preferredContactMethod?: string;
  marketingOptIn?: string;
  vehicleYear?: number;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleTrim?: string;
  vehicleEngine?: string;
  vehicleTransmission?: string;
  vehicleDrivetrain?: string;
  odometerIn?: number;
  odometerOut?: number;
  vehicleColor?: string;
  vehicleProductionDate?: string;
  laborTotal?: number;
  partsTotal?: number;
  shopFees?: number;
  environmentalFees?: number;
  discountTotal?: number;
  taxTotal?: number;
  grandTotal?: number;
  paymentMethod?: string;
  invoiceNumber?: string;
  createdBySystem?: string;
  ingestTimestamp?: string;
  tenantId?: string;
  sourceSystem?: string;
  laborLines: LaborLine[];
  partLines: PartLine[];
};

export type RoutedPayloads = {
  piiPayload: PiiPayload | null;
  deterministicPayload: DeterministicPayload;
  semanticPayload: SemanticEntry[];
};

const normalizeTag = (value: string) => value.trim().toUpperCase();

const extractFlatFields = (xml: string): SemanticEntry[] => {
  const rootMatch = xml.match(/<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/);
  if (!rootMatch) {
    throw new AppError("Invalid XML: missing root element", { status: 400, code: "XML_INVALID" });
  }
  const content = rootMatch[2];
  const results: SemanticEntry[] = [];
  const fieldRegex = /<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/g;
  let match: RegExpExecArray | null;
  let totalLength = 0;

  while ((match = fieldRegex.exec(content)) !== null) {
    const name = normalizeTag(match[1]);
    const value = match[2].trim();
    if (value.includes("<")) {
      throw new AppError(`Nested XML detected in field ${name}`, {
        status: 400,
        code: "XML_NESTING"
      });
    }
    results.push({ path: name, text: value });
    totalLength += match[0].length;
  }

  const stripped = content.replace(/\s+/g, "");
  if (totalLength === 0 && stripped.length) {
    throw new AppError("No valid flat fields detected", { status: 400, code: "XML_INVALID" });
  }

  return results;
};

const toNumber = (value: string, field: string): number => {
  const cleaned = value.replace(/,/g, "");
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) {
    throw new AppError(`Invalid numeric value for ${field}`, { status: 400, code: "NUMBER_INVALID" });
  }
  return parsed;
};

const toInt = (value: string, field: string): number => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new AppError(`Invalid integer value for ${field}`, { status: 400, code: "NUMBER_INVALID" });
  }
  return parsed;
};

const isPiiField = (field: string) => PII_FIELDS.has(field);
const isDeterministicField = (field: string) => DETERMINISTIC_FIELDS.has(field);
const isSemanticField = (field: string) => SEMANTIC_FIELDS.has(field);
const KNOWN_FIELDS = new Set([...PII_FIELDS, ...DETERMINISTIC_FIELDS, ...SEMANTIC_FIELDS]);

const levenshteinDistance = (left: string, right: string): number => {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  const rows = left.length + 1;
  const cols = right.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[rows - 1][cols - 1];
};

const closestSchemaMatches = (unknownFields: string[], limit = 5): string[] => {
  if (!unknownFields.length) return [];
  const bases = unknownFields.map((field) => parseIndexedFieldName(field).base);
  const candidates = Array.from(KNOWN_FIELDS);
  const scored = candidates.map((candidate) => {
    const score = Math.min(
      ...bases.map((base) => levenshteinDistance(base, candidate))
    );
    return { candidate, score };
  });
  scored.sort((a, b) => a.score - b.score || a.candidate.localeCompare(b.candidate));
  return scored.slice(0, limit).map((entry) => entry.candidate);
};

const buildUnknownFieldError = (unknownFields: string[]): AppError => {
  const unique = Array.from(new Set(unknownFields));
  const matches = closestSchemaMatches(unique, 5);
  let message = `Unknown XML field${unique.length > 1 ? "s" : ""}: ${unique.join(
    ", "
  )}. field not in Schema V2 allow-list.`;
  if (matches.length) {
    message += ` Closest matches: ${matches.join(", ")}.`;
  }
  return new AppError(message, { status: 400, code: "XML_FIELD_UNKNOWN" });
};

const initDeterministicPayload = (): DeterministicPayload => ({
  laborLines: [],
  partLines: []
});

const setDeterministicField = (payload: DeterministicPayload, field: string, text: string) => {
  switch (field) {
    case "RO_NUMBER":
      payload.roNumber = text;
      return;
    case "RO_STATUS":
      payload.roStatus = text;
      return;
    case "OPEN_TIMESTAMP":
      payload.openTimestamp = text;
      return;
    case "CLOSE_TIMESTAMP":
      payload.closeTimestamp = text;
      return;
    case "WRITEUP_TIMESTAMP":
      payload.writeupTimestamp = text;
      return;
    case "PROMISED_TIMESTAMP":
      payload.promisedTimestamp = text;
      return;
    case "ADVISOR_ID":
      payload.advisorId = text;
      return;
    case "SERVICE_LANE":
      payload.serviceLane = text;
      return;
    case "DEPARTMENT_CODE":
      payload.departmentCode = text;
      return;
    case "WAITER_FLAG":
      payload.waiterFlag = text;
      return;
    case "LOANER_FLAG":
      payload.loanerFlag = text;
      return;
    case "WARRANTY_FLAG":
      payload.warrantyFlag = text;
      return;
    case "FLEET_FLAG":
      payload.fleetFlag = text;
      return;
    case "INTERNAL_RO_FLAG":
      payload.internalRoFlag = text;
      return;
    case "CUSTOMER_TYPE":
      payload.customerType = text;
      return;
    case "PREFERRED_CONTACT_METHOD":
      payload.preferredContactMethod = text;
      return;
    case "MARKETING_OPT_IN":
      payload.marketingOptIn = text;
      return;
    case "VEHICLE_YEAR":
      payload.vehicleYear = toInt(text, field);
      return;
    case "VEHICLE_MAKE":
      payload.vehicleMake = text;
      return;
    case "VEHICLE_MODEL":
      payload.vehicleModel = text;
      return;
    case "VEHICLE_TRIM":
      payload.vehicleTrim = text;
      return;
    case "VEHICLE_ENGINE":
      payload.vehicleEngine = text;
      return;
    case "VEHICLE_TRANSMISSION":
      payload.vehicleTransmission = text;
      return;
    case "VEHICLE_DRIVETRAIN":
      payload.vehicleDrivetrain = text;
      return;
    case "ODOMETER_IN":
      payload.odometerIn = toInt(text, field);
      return;
    case "ODOMETER_OUT":
      payload.odometerOut = toInt(text, field);
      return;
    case "VEHICLE_COLOR":
      payload.vehicleColor = text;
      return;
    case "VEHICLE_PRODUCTION_DATE":
      payload.vehicleProductionDate = text;
      return;
    case "LABOR_TOTAL":
      payload.laborTotal = toNumber(text, field);
      return;
    case "PARTS_TOTAL":
      payload.partsTotal = toNumber(text, field);
      return;
    case "SHOP_FEES":
      payload.shopFees = toNumber(text, field);
      return;
    case "ENVIRONMENTAL_FEES":
      payload.environmentalFees = toNumber(text, field);
      return;
    case "DISCOUNT_TOTAL":
      payload.discountTotal = toNumber(text, field);
      return;
    case "TAX_TOTAL":
      payload.taxTotal = toNumber(text, field);
      return;
    case "GRAND_TOTAL":
      payload.grandTotal = toNumber(text, field);
      return;
    case "PAYMENT_METHOD":
      payload.paymentMethod = text;
      return;
    case "INVOICE_NUMBER":
      payload.invoiceNumber = text;
      return;
    case "CREATED_BY_SYSTEM":
      payload.createdBySystem = text;
      return;
    case "INGEST_TIMESTAMP":
      payload.ingestTimestamp = text;
      return;
    case "TENANT_ID":
      payload.tenantId = text;
      return;
    case "SOURCE_SYSTEM":
      payload.sourceSystem = text;
      return;
    default:
      return;
  }
};

const initPiiPayload = (): PiiPayload => ({});

const setPiiField = (payload: PiiPayload, field: string, text: string) => {
  switch (field) {
    case "CUSTOMER_FIRST_NAME":
      payload.customerName = payload.customerName
        ? `${payload.customerName} ${text}`.trim()
        : text;
      return;
    case "CUSTOMER_LAST_NAME":
      payload.customerName = payload.customerName
        ? `${payload.customerName} ${text}`.trim()
        : text;
      return;
    case "CUSTOMER_EMAIL":
      payload.emails = payload.emails ? [...payload.emails, text] : [text];
      return;
    case "CUSTOMER_PHONE":
      payload.phones = payload.phones ? [...payload.phones, text] : [text];
      return;
    case "VIN":
      payload.vins = payload.vins ? [...payload.vins, text] : [text];
      return;
    case "LICENSE_PLATE":
      payload.licensePlates = payload.licensePlates ? [...payload.licensePlates, text] : [text];
      return;
    case "CUSTOMER_ADDRESS_LINE1":
      payload.address = payload.address ?? {};
      payload.address.line1 = text;
      return;
    case "CUSTOMER_ADDRESS_CITY":
      payload.address = payload.address ?? {};
      payload.address.city = text;
      return;
    case "CUSTOMER_ADDRESS_STATE":
      payload.address = payload.address ?? {};
      payload.address.state = text;
      return;
    case "CUSTOMER_ADDRESS_POSTAL":
      payload.address = payload.address ?? {};
      payload.address.zip = text;
      return;
    default:
      return;
  }
};

export const routeXmlToPayloads = (xml: string): RoutedPayloads => {
  const leaves = extractFlatFields(xml);
  const piiPayload = initPiiPayload();
  const deterministicPayload = initDeterministicPayload();
  const semanticPayload: SemanticEntry[] = [];
  const seenFields = new Set<string>();
  const laborLineMap = new Map<number, LaborLine>();
  const partLineMap = new Map<string, PartLine>();
  const unknownFields: string[] = [];

  for (const leaf of leaves) {
    const field = leaf.path;
    if (seenFields.has(field)) {
      throw new AppError(`Duplicate XML element name: ${field}`, {
        status: 400,
        code: "XML_DUPLICATE_FIELD"
      });
    }
    seenFields.add(field);
    const indexed = parseIndexedFieldName(field);
    const base = indexed.base;
    const knownBase = isPiiField(base) || isDeterministicField(base) || isSemanticField(base);
    if (!knownBase) {
      unknownFields.push(field);
      continue;
    }
    if (isPiiField(base)) {
      if (indexed.isIndexed) {
        throw new AppError(`Indexed PII field not allowed: ${field}`, {
          status: 400,
          code: "PII_INDEXED"
        });
      }
      setPiiField(piiPayload, base, leaf.text);
      continue;
    }
    if (indexed.isIndexed) {
      if (!isDeterministicField(base) && !isSemanticField(base)) {
        throw new AppError(`Unclassified indexed field: ${field}`, {
          status: 400,
          code: "INDEXED_FIELD_UNKNOWN"
        });
      }
      if (!LINE_ITEM_BASE_FIELDS.has(base)) {
        throw new AppError(`Indexed field not allowed for base ${base}`, {
          status: 400,
          code: "INDEXED_BASE_INVALID"
        });
      }
      if (indexed.partIndex) {
        if (!PART_BASE_FIELDS.has(base)) {
          throw new AppError(`Part index used on non-part field ${base}`, {
            status: 400,
            code: "PART_INDEX_INVALID"
          });
        }
        const key = `${indexed.laborIndex}_${indexed.partIndex}`;
        const partLine = partLineMap.get(key) ?? {
          laborIndex: indexed.laborIndex as number,
          partIndex: indexed.partIndex
        };
        if (isDeterministicField(base)) {
          setPartLineField(partLine, base, leaf.text, field);
        } else {
          semanticPayload.push({
            path: field,
            text: leaf.text,
            laborIndex: indexed.laborIndex,
            partIndex: indexed.partIndex
          });
        }
        partLineMap.set(key, partLine);
      } else if (indexed.laborIndex) {
        if (!LABOR_BASE_FIELDS.has(base)) {
          throw new AppError(`Labor index used on non-labor field ${base}`, {
            status: 400,
            code: "LABOR_INDEX_INVALID"
          });
        }
        const laborLine = laborLineMap.get(indexed.laborIndex) ?? {
          laborIndex: indexed.laborIndex
        };
        if (isDeterministicField(base)) {
          setLaborLineField(laborLine, base, leaf.text, field);
        } else {
          semanticPayload.push({
            path: field,
            text: leaf.text,
            laborIndex: indexed.laborIndex
          });
        }
        laborLineMap.set(indexed.laborIndex, laborLine);
      }
      continue;
    }
    if (LINE_ITEM_BASE_FIELDS.has(base)) {
      throw new AppError(`Line item field requires index suffix: ${field}`, {
        status: 400,
        code: "INDEX_REQUIRED"
      });
    }
    if (isDeterministicField(base)) {
      setDeterministicField(deterministicPayload, base, leaf.text);
      continue;
    }
    if (isSemanticField(base)) {
      semanticPayload.push(leaf);
      continue;
    }
  }

  if (unknownFields.length) {
    throw buildUnknownFieldError(unknownFields);
  }

  const hasPii = Object.keys(piiPayload).length > 0;
  deterministicPayload.laborLines = Array.from(laborLineMap.values()).sort(
    (a, b) => a.laborIndex - b.laborIndex
  );
  deterministicPayload.partLines = Array.from(partLineMap.values()).sort((a, b) => {
    if (a.laborIndex !== b.laborIndex) return a.laborIndex - b.laborIndex;
    return a.partIndex - b.partIndex;
  });
  return {
    piiPayload: hasPii ? piiPayload : null,
    deterministicPayload,
    semanticPayload
  };
};

export const assertNoPiiInSemantic = (semanticPayload: SemanticEntry[]) => {
  const violations = semanticPayload.filter((entry) => {
    const base = parseIndexedFieldName(entry.path).base;
    return isPiiField(base);
  });
  if (violations.length) {
    throw new AppError("PII path routed to semantic payload", {
      status: 400,
      code: "PII_ROUTE_VIOLATION"
    });
  }
};

export const validateRoutedPayloads = (input: {
  deterministicPayload: DeterministicPayload;
  piiPayload: PiiPayload | null;
  semanticPayload: SemanticEntry[];
  piiEnabled: boolean;
}) => {
  const errors: string[] = [];
  const det = input.deterministicPayload;

  if (!det.roNumber || !det.roStatus || !det.openTimestamp) {
    errors.push("missing required deterministic fields");
  }

  if (errors.length) {
    throw new AppError(`Ingest validation failed: ${errors.join(", ")}`, {
      status: 400,
      code: "INGEST_VALIDATION"
    });
  }

  validateRoNumber(det.roNumber);
  validateLineItems(det, input.semanticPayload);

  const pii = input.piiPayload;
  if (!pii || !pii.vins?.[0]) {
    errors.push("missing required vin");
  }

  if (input.piiEnabled) {
    if (!pii) {
      errors.push("pii payload missing");
    }
  }

  if (!input.semanticPayload.find((entry) => entry.path === "CUSTOMER_COMPLAINT")) {
    errors.push("missing customer complaint");
  }

  if (!input.semanticPayload.length) {
    errors.push("semantic payload empty");
  }

  if (errors.length) {
    throw new AppError(`Ingest validation failed: ${errors.join(", ")}`, {
      status: 400,
      code: "INGEST_VALIDATION"
    });
  }
};

export const buildSemanticXml = (entries: SemanticEntry[]): string => {
  const lines = ["<semantic>"];
  for (const entry of entries) {
    const safeText = entry.text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    lines.push(`  <field path="${entry.path}">${safeText}</field>`);
  }
  lines.push("</semantic>");
  return lines.join("\n");
};

export const stripXmlTags = (value: string): string => {
  let result = "";
  let idx = 0;
  while (idx < value.length) {
    const nextTag = value.indexOf("<", idx);
    if (nextTag === -1) {
      result += value.slice(idx);
      break;
    }
    result += value.slice(idx, nextTag);
    const close = value.indexOf(">", nextTag);
    if (close === -1) break;
    idx = close + 1;
  }
  return result;
};

const LABOR_RATE_FIXED = 275;
const HOURS_MAX = 20;
const TOTAL_TOLERANCE = 0.01;

const validateRoNumber = (roNumber: string) => {
  if (!/^[0-9]{7}$/.test(roNumber)) {
    throw new AppError("RO_NUMBER must be numeric and 7 digits", {
      status: 400,
      code: "RO_NUMBER_INVALID"
    });
  }
  if (Number.parseInt(roNumber, 10) < 6920000) {
    throw new AppError("RO_NUMBER below allowed range", {
      status: 400,
      code: "RO_NUMBER_RANGE"
    });
  }
};

const validateLineItems = (det: DeterministicPayload, semantic: SemanticEntry[]) => {
  if (!det.laborLines.length) {
    throw new AppError("At least one labor line is required", {
      status: 400,
      code: "LABOR_MISSING"
    });
  }

  ensureContiguousIndices(
    det.laborLines.map((line) => line.laborIndex),
    "labor"
  );

  const laborIndexSet = new Set(det.laborLines.map((line) => line.laborIndex));

  const partIndicesByLabor = new Map<number, number[]>();
  for (const part of det.partLines) {
    if (!laborIndexSet.has(part.laborIndex)) {
      throw new AppError(`Orphaned part line for labor ${part.laborIndex}`, {
        status: 400,
        code: "PART_ORPHANED"
      });
    }
    const list = partIndicesByLabor.get(part.laborIndex) ?? [];
    list.push(part.partIndex);
    partIndicesByLabor.set(part.laborIndex, list);
  }
  for (const [laborIndex, indices] of partIndicesByLabor.entries()) {
    ensureContiguousIndices(indices, `part for labor ${laborIndex}`);
  }

  const semanticPartRefs = semantic
    .filter((entry) => entry.partIndex && entry.laborIndex)
    .map((entry) => `${entry.laborIndex}_${entry.partIndex}`);
  for (const ref of semanticPartRefs) {
    if (!det.partLines.find((part) => `${part.laborIndex}_${part.partIndex}` === ref)) {
      throw new AppError(`Part description without deterministic line ${ref}`, {
        status: 400,
        code: "PART_DESCRIPTION_ORPHANED"
      });
    }
  }

  const laborTotals: number[] = [];
  for (const labor of det.laborLines) {
    if (!labor.actualHours || labor.actualHours <= 0 || labor.actualHours > HOURS_MAX) {
      throw new AppError(`Invalid ACTUAL_HOURS for labor ${labor.laborIndex}`, {
        status: 400,
        code: "HOURS_INVALID"
      });
    }
    if (labor.laborRate == null) {
      throw new AppError(`LABOR_RATE missing for labor ${labor.laborIndex}`, {
        status: 400,
        code: "LABOR_RATE_MISSING"
      });
    }
    if (Math.abs(labor.laborRate - LABOR_RATE_FIXED) > TOTAL_TOLERANCE) {
      throw new AppError(`LABOR_RATE must be ${LABOR_RATE_FIXED.toFixed(2)}`, {
        status: 400,
        code: "LABOR_RATE_INVALID"
      });
    }

    const computedExtended = labor.actualHours * LABOR_RATE_FIXED;
    if (labor.laborExtendedAmount == null) {
      throw new AppError(`LABOR_EXTENDED_AMOUNT missing for labor ${labor.laborIndex}`, {
        status: 400,
        code: "LABOR_EXTENDED_MISSING"
      });
    }
    if (Math.abs(labor.laborExtendedAmount - computedExtended) > TOTAL_TOLERANCE) {
      throw new AppError(`LABOR_EXTENDED_AMOUNT mismatch for labor ${labor.laborIndex}`, {
        status: 400,
        code: "LABOR_EXTENDED_INVALID"
      });
    }
    laborTotals.push(labor.laborExtendedAmount);
  }

  const partTotals: number[] = [];
  for (const part of det.partLines) {
    if (part.partExtendedPrice == null) {
      throw new AppError(`PART_EXTENDED_PRICE missing for part ${part.laborIndex}_${part.partIndex}`, {
        status: 400,
        code: "PART_EXTENDED_MISSING"
      });
    }
    if (part.partQuantity == null || part.partUnitPrice == null) {
      throw new AppError(`PART_QUANTITY or PART_UNIT_PRICE missing for part ${part.laborIndex}_${part.partIndex}`, {
        status: 400,
        code: "PART_COMPONENT_MISSING"
      });
    }
    if (Math.abs(part.partExtendedPrice - part.partQuantity * part.partUnitPrice) > TOTAL_TOLERANCE) {
      throw new AppError(`PART_EXTENDED_PRICE mismatch for part ${part.laborIndex}_${part.partIndex}`, {
        status: 400,
        code: "PART_EXTENDED_INVALID"
      });
    }
    partTotals.push(part.partExtendedPrice);
  }

  const laborTotalComputed = laborTotals.reduce((sum, value) => sum + value, 0);
  if (det.laborTotal == null) {
    throw new AppError("LABOR_TOTAL missing", { status: 400, code: "LABOR_TOTAL_MISSING" });
  }
  if (Math.abs(det.laborTotal - laborTotalComputed) > TOTAL_TOLERANCE) {
    throw new AppError("LABOR_TOTAL mismatch", { status: 400, code: "LABOR_TOTAL_INVALID" });
  }

  const partsTotalComputed = partTotals.reduce((sum, value) => sum + value, 0);
  if (det.partsTotal == null) {
    throw new AppError("PARTS_TOTAL missing", { status: 400, code: "PARTS_TOTAL_MISSING" });
  }
  if (Math.abs(det.partsTotal - partsTotalComputed) > TOTAL_TOLERANCE) {
    throw new AppError("PARTS_TOTAL mismatch", { status: 400, code: "PARTS_TOTAL_INVALID" });
  }

  if (det.shopFees == null) {
    throw new AppError("SHOP_FEES missing", { status: 400, code: "SHOP_FEES_MISSING" });
  }
  if (det.environmentalFees == null) {
    throw new AppError("ENVIRONMENTAL_FEES missing", { status: 400, code: "ENVIRONMENTAL_FEES_MISSING" });
  }
  if (det.taxTotal == null) {
    throw new AppError("TAX_TOTAL missing", { status: 400, code: "TAX_TOTAL_MISSING" });
  }
  if (det.discountTotal == null) {
    throw new AppError("DISCOUNT_TOTAL missing", { status: 400, code: "DISCOUNT_TOTAL_MISSING" });
  }

  const shopFees = det.shopFees;
  const environmentalFees = det.environmentalFees;
  const taxTotal = det.taxTotal;
  const discountTotal = det.discountTotal;
  const computedGrand =
    laborTotalComputed + partsTotalComputed + shopFees + environmentalFees + taxTotal - discountTotal;

  if (det.grandTotal == null) {
    throw new AppError("GRAND_TOTAL missing", { status: 400, code: "GRAND_TOTAL_MISSING" });
  }
  if (Math.abs(det.grandTotal - computedGrand) > TOTAL_TOLERANCE) {
    throw new AppError("GRAND_TOTAL mismatch", { status: 400, code: "GRAND_TOTAL_INVALID" });
  }
};

const setLaborLineField = (line: LaborLine, field: string, text: string, raw: string) => {
  switch (field) {
    case "LABOR_LINE_NUMBER":
      line.laborLineNumber = toInt(text, raw);
      return;
    case "OP_CODE":
      line.opCode = text;
      return;
    case "LABOR_TYPE":
      line.laborType = text;
      return;
    case "SKILL_LEVEL":
      line.skillLevel = text;
      return;
    case "FLAT_RATE_HOURS":
      line.flatRateHours = toNumber(text, raw);
      return;
    case "ACTUAL_HOURS":
      line.actualHours = toNumber(text, raw);
      return;
    case "LABOR_RATE":
      line.laborRate = toNumber(text, raw);
      return;
    case "LABOR_EXTENDED_AMOUNT":
      line.laborExtendedAmount = toNumber(text, raw);
      return;
    case "TECHNICIAN_ID":
      line.technicianId = text;
      return;
    default:
      return;
  }
};

const setPartLineField = (line: PartLine, field: string, text: string, raw: string) => {
  switch (field) {
    case "PART_LINE_NUMBER":
      line.partLineNumber = toInt(text, raw);
      return;
    case "PART_NUMBER":
      line.partNumber = text;
      return;
    case "PART_QUANTITY":
      line.partQuantity = toNumber(text, raw);
      return;
    case "PART_UNIT_PRICE":
      line.partUnitPrice = toNumber(text, raw);
      return;
    case "PART_EXTENDED_PRICE":
      line.partExtendedPrice = toNumber(text, raw);
      return;
    case "PART_SOURCE":
      line.partSource = text;
      return;
    case "BACKORDER_FLAG":
      line.backorderFlag = text;
      return;
    default:
      return;
  }
};
