import { AppError } from "../../shared/utils/errors";
import type { Rng } from "./v2Rng";
import type { Scenario, ScenarioParams, TextTemplateSet } from "./v2Scenarios";

const LABOR_RATE = 275;
const TOTAL_TOLERANCE = 0.01;

const round2 = (value: number) => Math.round(value * 100) / 100;

const chooseFloat = (rng: Rng, min: number, max: number) => {
  const scaled = rng.next() * (max - min) + min;
  return round2(scaled);
};

const sum = (values: number[]) => round2(values.reduce((acc, val) => acc + val, 0));

const ensureWithin = (value: number, min: number, max: number, label: string) => {
  if (value < min - TOTAL_TOLERANCE || value > max + TOTAL_TOLERANCE) {
    throw new AppError(`${label} out of range`, { status: 400, code: "GEN_RANGE" });
  }
};

export type CustomerProfile = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  addressLine1: string;
  addressCity: string;
  addressState: string;
  addressPostal: string;
};

export type VehicleProfile = {
  vin: string;
  licensePlate: string;
  year: number;
  make: string;
  model: string;
  trim: string;
  engine: string;
  transmission: string;
  drivetrain: string;
  color: string;
};

export type LaborLine = {
  laborIndex: number;
  opCode: string;
  opDescription: string;
  laborType: string;
  actualHours: number;
  laborRate: number;
  laborExtendedAmount: number;
  technicianId: string;
  technicianNotes: string;
  cause: string;
  correction: string;
};

export type PartLine = {
  laborIndex: number;
  partIndex: number;
  partNumber: string;
  partDescription: string;
  quantity: number;
  unitPrice: number;
  extendedPrice: number;
  partSource: string;
  backorderFlag: string;
};

export type LineItemBundle = {
  laborLines: LaborLine[];
  partLines: PartLine[];
  laborTotal: number;
  partsTotal: number;
  shopFees: number;
  environmentalFees: number;
  taxTotal: number;
  discountTotal: number;
  grandTotal: number;
};

const makeLaborHoursSplit = (rng: Rng, totalHours: number, lineCount: number) => {
  const hours: number[] = [];
  let remaining = totalHours;
  for (let i = 0; i < lineCount; i += 1) {
    const left = lineCount - i;
    if (left === 1) {
      if (remaining > 20) {
        throw new AppError("Labor hours exceed maximum per line", {
          status: 400,
          code: "HOURS_INVALID"
        });
      }
      hours.push(round2(remaining));
      break;
    }
    const minRemaining = 0.5 * (left - 1);
    const maxRemaining = 20 * (left - 1);
    const minForLine = Math.max(0.5, remaining - maxRemaining);
    const maxForLine = Math.min(20, remaining - minRemaining);
    const value = round2(chooseFloat(rng, minForLine, maxForLine));
    hours.push(value);
    remaining = round2(remaining - value);
  }
  return hours;
};

export const buildLineItems = (
  rng: Rng,
  scenario: Scenario,
  params: ScenarioParams,
  templates: TextTemplateSet,
  warranty: boolean
): LineItemBundle => {
  const laborLineCount = rng.int(params.laborLines[0], params.laborLines[1]);
  let totalHours = chooseFloat(rng, params.hoursRange[0], params.hoursRange[1]);
  const minHours = 0.5 * laborLineCount;
  const maxHours = 20 * laborLineCount;
  if (totalHours < minHours) totalHours = minHours;
  if (totalHours > maxHours) totalHours = maxHours;
  const hoursSplit = makeLaborHoursSplit(rng, totalHours, laborLineCount);

  const laborLines: LaborLine[] = [];
  const partLines: PartLine[] = [];

  for (let i = 0; i < laborLineCount; i += 1) {
    const laborIndex = i + 1;
    const actualHours = hoursSplit[i] ?? hoursSplit[hoursSplit.length - 1];
    const laborExtendedAmount = round2(actualHours * LABOR_RATE);
    laborLines.push({
      laborIndex,
      opCode: `OP${rng.int(100, 999)}`,
      opDescription: rng.pick(templates.opDescriptions),
      laborType: warranty ? "WARRANTY" : rng.pick(["CUSTOMER_PAY", "INTERNAL"]),
      actualHours,
      laborRate: LABOR_RATE,
      laborExtendedAmount,
      technicianId: `TECH-${rng.int(1, 35)}`,
      technicianNotes: rng.pick(templates.technicianNotes),
      cause: rng.pick(templates.causes),
      correction: rng.pick(templates.corrections)
    });

    const partsCount = rng.int(params.partsPerLabor[0], params.partsPerLabor[1]);
    for (let p = 0; p < partsCount; p += 1) {
      const partIndex = p + 1;
      const quantity = rng.int(1, 2);
      const unitPrice = round2(chooseFloat(rng, 15, 350));
      const extendedPrice = round2(unitPrice * quantity);
      partLines.push({
        laborIndex,
        partIndex,
        partNumber: `PART-${rng.int(1000, 9999)}`,
        partDescription: rng.pick(templates.partDescriptions),
        quantity,
        unitPrice,
        extendedPrice,
        partSource: rng.pick(["STOCK", "ORDER", "OEM"]),
        backorderFlag: rng.pick(["false", "false", "false", "true"])
      });
    }
  }

  const laborTotal = sum(laborLines.map((line) => line.laborExtendedAmount));
  const partsTotal = sum(partLines.map((line) => line.extendedPrice));

  const shopFees = 0;
  const environmentalFees = 0;
  const taxTotal = 0;
  let discountTotal = 0;

  if (warranty) {
    discountTotal = round2(laborTotal + partsTotal + shopFees + environmentalFees + taxTotal);
  }

  let grandTotal = round2(
    laborTotal + partsTotal + shopFees + environmentalFees + taxTotal - discountTotal
  );

  const targetMin = params.totalRange[0];
  const targetMax = params.totalRange[1];

  if (!warranty) {
    if (grandTotal < targetMin || grandTotal > targetMax) {
      const target = chooseFloat(rng, targetMin, targetMax);
      const neededParts = round2(target - laborTotal);
      if (neededParts <= 0) {
        for (const part of partLines) {
          part.unitPrice = 0;
          part.extendedPrice = 0;
        }
      } else {
        const existingParts = partLines.length;
        if (existingParts === 0) {
          partLines.push({
            laborIndex: 1,
            partIndex: 1,
            partNumber: `PART-${rng.int(1000, 9999)}`,
            partDescription: rng.pick(templates.partDescriptions),
            quantity: 1,
            unitPrice: round2(neededParts),
            extendedPrice: round2(neededParts),
            partSource: rng.pick(["STOCK", "ORDER", "OEM"]),
            backorderFlag: rng.pick(["false", "false", "true"])
          });
        } else {
          const last = partLines[partLines.length - 1];
          const otherPartsTotal = sum(
            partLines.slice(0, partLines.length - 1).map((line) => line.extendedPrice)
          );
          const remaining = round2(Math.max(0, neededParts - otherPartsTotal));
          last.unitPrice = round2(remaining / Math.max(1, last.quantity));
          last.extendedPrice = round2(last.unitPrice * last.quantity);
        }
      }
    }
    const updatedPartsTotal = sum(partLines.map((line) => line.extendedPrice));
    grandTotal = round2(laborTotal + updatedPartsTotal);
    ensureWithin(grandTotal, targetMin, targetMax, "GRAND_TOTAL");
  }

  const updatedPartsTotal = sum(partLines.map((line) => line.extendedPrice));
  const computedGrand = round2(
    laborTotal + updatedPartsTotal + shopFees + environmentalFees + taxTotal - discountTotal
  );

  return {
    laborLines,
    partLines,
    laborTotal,
    partsTotal: updatedPartsTotal,
    shopFees,
    environmentalFees,
    taxTotal,
    discountTotal,
    grandTotal: computedGrand
  };
};

export const buildComplaint = (
  scenario: Scenario,
  templates: TextTemplateSet,
  customer: CustomerProfile,
  rng: Rng
) => {
  if (scenario === "PII_IN_SEMANTIC") {
    const contact = rng.pick([customer.phone, customer.email]);
    return `Customer ${customer.firstName} reported the issue. Please contact ${contact} for updates.`;
  }
  if (scenario === "REPEAT_VISIT") {
    return "Customer returned for follow-up on the prior repair visit.";
  }
  return rng.pick(templates.complaints);
};
