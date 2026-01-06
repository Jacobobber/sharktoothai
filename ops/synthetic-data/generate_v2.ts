import fs from "fs";
import path from "path";
import { createRng } from "./v2Rng";
import {
  DEFAULT_TEMPLATES,
  DIAGNOSTIC_TEMPLATES,
  MAJOR_REPAIR_TEMPLATES,
  SCENARIO_DISTRIBUTION,
  SCENARIO_PARAMS,
  WARRANTY_TEMPLATES,
  type Scenario,
  type TextTemplateSet
} from "./v2Scenarios";
import { buildLineItems, buildComplaint, type CustomerProfile, type VehicleProfile } from "./v2Builders";
import { routeXmlToPayloads, validateRoutedPayloads } from "../../workloads/ro-assistant/src/services/ingest/xmlFieldRouting";

// Example usage:
// npx ts-node --transpile-only ops/synthetic-data/generate_v2.ts --count 1000 --seed demo --output-dir ops/synthetic-data/v2 --tenant-id 00000000-0000-0000-0000-000000000010
//
// Sample XML snippet:
// <REPAIR_ORDER>
//   <RO_NUMBER>6920000</RO_NUMBER>
//   <RO_STATUS>OPEN</RO_STATUS>
//   <OPEN_TIMESTAMP>2026-01-01T09:00:00Z</OPEN_TIMESTAMP>
//   <CUSTOMER_FIRST_NAME>Jane</CUSTOMER_FIRST_NAME>
//   <CUSTOMER_LAST_NAME>Smith</CUSTOMER_LAST_NAME>
//   <CUSTOMER_COMPLAINT>Customer reports squealing brakes.</CUSTOMER_COMPLAINT>
//   <LABOR_LINE_NUMBER_1>1</LABOR_LINE_NUMBER_1>
//   <OP_CODE_1>OP512</OP_CODE_1>
//   <OP_DESCRIPTION_1>Replace front brake pads</OP_DESCRIPTION_1>
//   <ACTUAL_HOURS_1>1.0</ACTUAL_HOURS_1>
//   <LABOR_RATE_1>275.00</LABOR_RATE_1>
//   <LABOR_EXTENDED_AMOUNT_1>275.00</LABOR_EXTENDED_AMOUNT_1>
//   <PART_LINE_NUMBER_1_1>1</PART_LINE_NUMBER_1_1>
//   <PART_NUMBER_1_1>PART-4832</PART_NUMBER_1_1>
//   <PART_DESCRIPTION_1_1>Front brake pad set</PART_DESCRIPTION_1_1>
// </REPAIR_ORDER>

type Args = {
  count: number;
  seed: string;
  outputDir: string;
  tenantId: string;
  startRoNumber: number;
  manifest: boolean;
};

const DEFAULT_ARGS: Args = {
  count: 1000,
  seed: "1",
  outputDir: "ops/synthetic-data/v2",
  tenantId: "00000000-0000-0000-0000-000000000010",
  startRoNumber: 6920000,
  manifest: false
};

const parseArgs = (argv: string[]): Args => {
  const args = { ...DEFAULT_ARGS };
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    const next = argv[i + 1];
    if (current === "--count" && next) args.count = Number.parseInt(next, 10);
    if (current === "--seed" && next) args.seed = next;
    if (current === "--output-dir" && next) args.outputDir = next;
    if (current === "--tenant-id" && next) args.tenantId = next;
    if (current === "--start-ro-number" && next) args.startRoNumber = Number.parseInt(next, 10);
    if (current === "--manifest") args.manifest = true;
  }
  return args;
};

const templatesForScenario = (scenario: Scenario): TextTemplateSet => {
  if (scenario === "HIGH_DOLLAR_DIAGNOSTIC") return DIAGNOSTIC_TEMPLATES;
  if (scenario === "MULTI_LINE_MAJOR_REPAIR") return MAJOR_REPAIR_TEMPLATES;
  if (scenario === "WARRANTY_REPAIR") return WARRANTY_TEMPLATES;
  return DEFAULT_TEMPLATES;
};

const buildScenarioPlan = (count: number, rngSeed: string) => {
  const scenarios = Object.keys(SCENARIO_DISTRIBUTION) as Scenario[];
  if (count < scenarios.length) {
    throw new Error("Count must be at least number of scenarios");
  }
  const totalWeight = scenarios.reduce((acc, key) => acc + SCENARIO_DISTRIBUTION[key], 0);
  const raw = scenarios.map((scenario) => {
    const weight = SCENARIO_DISTRIBUTION[scenario];
    const exact = (count * weight) / totalWeight;
    return { scenario, exact, count: Math.floor(exact), frac: exact - Math.floor(exact) };
  });
  let remaining = count - raw.reduce((acc, entry) => acc + entry.count, 0);
  const sorted = [...raw].sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < remaining; i += 1) {
    sorted[i % sorted.length].count += 1;
  }
  const final = raw.reduce((acc, entry) => {
    const updated = sorted.find((item) => item.scenario === entry.scenario);
    if (!updated || updated.count <= 0) {
      throw new Error(`Scenario count invalid for ${entry.scenario}`);
    }
    acc[entry.scenario] = updated.count;
    return acc;
  }, {} as Record<Scenario, number>);

  const scenarioList: Scenario[] = [];
  for (const scenario of scenarios) {
    for (let i = 0; i < final[scenario]; i += 1) scenarioList.push(scenario);
  }
  const rng = createRng(rngSeed);
  const shuffled = rng.shuffle(scenarioList);
  if (shuffled[0] === "REPEAT_VISIT") {
    const swapIndex = shuffled.findIndex((item) => item !== "REPEAT_VISIT");
    if (swapIndex > 0) {
      [shuffled[0], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[0]];
    }
  }
  return { plan: shuffled, counts: final };
};

const escapeXml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const addField = (map: Map<string, string>, name: string, value: string | number | boolean) => {
  if (map.has(name)) {
    throw new Error(`Duplicate XML element name: ${name}`);
  }
  const strValue = typeof value === "number" ? value.toFixed(2) : String(value);
  map.set(name, strValue);
};

const buildCustomer = (rngSeed: string, index: number): CustomerProfile => {
  const rng = createRng(`${rngSeed}-customer-${index}`);
  const firstNames = ["Jane", "John", "Maria", "David", "Olivia", "Marcus", "Priya", "Luis"];
  const lastNames = ["Smith", "Johnson", "Lee", "Garcia", "Patel", "Brown", "Nguyen", "Davis"];
  const streets = ["Main St", "Oak Ave", "Pine Rd", "Cedar Blvd", "Maple Dr"];
  const cities = ["Phoenix", "Dallas", "Austin", "Seattle", "Denver"];
  const states = ["AZ", "TX", "WA", "CO", "NV"];
  const firstName = rng.pick(firstNames);
  const lastName = rng.pick(lastNames);
  const phone = `555-${rng.int(100, 999)}-${rng.int(1000, 9999)}`;
  const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.test`;
  const addressLine1 = `${rng.int(100, 9999)} ${rng.pick(streets)}`;
  const addressCity = rng.pick(cities);
  const addressState = rng.pick(states);
  const addressPostal = `${rng.int(10000, 99999)}`;
  return {
    firstName,
    lastName,
    phone,
    email,
    addressLine1,
    addressCity,
    addressState,
    addressPostal
  };
};

const buildVehicle = (rng: ReturnType<typeof createRng>): VehicleProfile => {
  const makes = ["Honda", "Toyota", "Ford", "Chevrolet", "Nissan"];
  const models = ["Civic", "Camry", "F-150", "Malibu", "Altima"];
  const trims = ["LX", "SE", "Sport", "EX", "Limited"];
  const engines = ["2.0L I4", "2.5L I4", "3.5L V6"];
  const transmissions = ["Automatic", "CVT", "Manual"];
  const drivetrains = ["FWD", "RWD", "AWD"];
  const colors = ["Black", "White", "Silver", "Blue", "Red"];
  return {
    vin: `SYNTH${rng.int(1000000, 9999999)}${rng.int(1000000, 9999999)}`.slice(0, 17),
    licensePlate: `S${rng.int(1000, 9999)}${rng.int(0, 9)}`,
    year: rng.int(2016, 2024),
    make: rng.pick(makes),
    model: rng.pick(models),
    trim: rng.pick(trims),
    engine: rng.pick(engines),
    transmission: rng.pick(transmissions),
    drivetrain: rng.pick(drivetrains),
    color: rng.pick(colors)
  };
};

const buildTimestamps = (baseDate: Date, offsetDays: number, rng: ReturnType<typeof createRng>) => {
  const open = new Date(baseDate);
  open.setUTCDate(open.getUTCDate() + offsetDays);
  open.setUTCHours(rng.int(7, 16), rng.int(0, 59), 0, 0);
  const close = new Date(open);
  close.setUTCHours(open.getUTCHours() + rng.int(1, 6));
  const writeup = new Date(open);
  writeup.setUTCHours(open.getUTCHours() - 1);
  const promised = new Date(open);
  promised.setUTCDate(open.getUTCDate() + 1);
  return {
    open: open.toISOString(),
    close: close.toISOString(),
    writeup: writeup.toISOString(),
    promised: promised.toISOString(),
    ingest: new Date().toISOString()
  };
};

const validateGeneratedXml = (xml: string) => {
  const routed = routeXmlToPayloads(xml);
  validateRoutedPayloads({
    deterministicPayload: routed.deterministicPayload,
    piiPayload: routed.piiPayload,
    semanticPayload: routed.semanticPayload,
    piiEnabled: true
  });
};

const buildXml = (fields: Map<string, string>) => {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', "<REPAIR_ORDER>"];
  for (const [key, value] of fields.entries()) {
    lines.push(`  <${key}>${escapeXml(value)}</${key}>`);
  }
  lines.push("</REPAIR_ORDER>");
  return lines.join("\n");
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  if (!Number.isFinite(args.count) || args.count <= 0) {
    throw new Error("Invalid count");
  }
  if (!Number.isFinite(args.startRoNumber) || args.startRoNumber < 6920000) {
    throw new Error("Invalid start RO number");
  }

  const { plan, counts } = buildScenarioPlan(args.count, args.seed);
  const rng = createRng(args.seed);
  const outputDir = path.resolve(args.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  const manifest: Array<{
    roNumber: string;
    vin: string;
    scenario: Scenario;
    grandTotal: number;
    laborLines: number;
    partLines: number;
  }> = [];

  const baseDate = new Date(Date.UTC(2026, 0, 1, 8, 0, 0));
  const vinPool: string[] = [];
  const vehicleByVin = new Map<string, VehicleProfile>();

  const scenarioTotals: Record<Scenario, number> = {
    ROUTINE_MAINTENANCE: 0,
    HIGH_DOLLAR_DIAGNOSTIC: 0,
    WARRANTY_REPAIR: 0,
    MULTI_LINE_MAJOR_REPAIR: 0,
    PII_IN_SEMANTIC: 0,
    REPEAT_VISIT: 0
  };

  for (let i = 0; i < plan.length; i += 1) {
    const scenario = plan[i];
    scenarioTotals[scenario] += 1;
    const roNumber = String(args.startRoNumber + i);
    if (!/^[0-9]{7}$/.test(roNumber)) {
      throw new Error("RO_NUMBER must be 7 digits");
    }
    const customer = buildCustomer(args.seed, i);
    let vehicle = buildVehicle(rng);
    if (scenario === "REPEAT_VISIT") {
      if (!vinPool.length) {
        throw new Error("Repeat visit scenario requires prior VINs");
      }
      const selectedVin = rng.pick(vinPool);
      const prior = vehicleByVin.get(selectedVin);
      if (!prior) {
        throw new Error("Repeat visit scenario missing prior VIN profile");
      }
      vehicle = prior;
    } else {
      vinPool.push(vehicle.vin);
      vehicleByVin.set(vehicle.vin, vehicle);
    }

    const params = SCENARIO_PARAMS[scenario];
    const templates = templatesForScenario(scenario);
    const lineItems = buildLineItems(rng, scenario, params, templates, params.warranty);

    const complaint = buildComplaint(scenario, templates, customer, rng);
    const timestamps = buildTimestamps(baseDate, i % 365, rng);
    const fields = new Map<string, string>();

    const odometerIn = rng.int(10000, 90000);
    const odometerOut = odometerIn + rng.int(0, 250);

    addField(fields, "RO_NUMBER", roNumber);
    addField(fields, "RO_STATUS", "OPEN");
    addField(fields, "OPEN_TIMESTAMP", timestamps.open);
    addField(fields, "CLOSE_TIMESTAMP", timestamps.close);
    addField(fields, "WRITEUP_TIMESTAMP", timestamps.writeup);
    addField(fields, "PROMISED_TIMESTAMP", timestamps.promised);
    addField(fields, "ADVISOR_ID", `ADV-${rng.int(100, 999)}`);
    addField(fields, "SERVICE_LANE", `LANE-${rng.int(1, 5)}`);
    addField(fields, "DEPARTMENT_CODE", `SV${rng.int(1, 9)}`);
    addField(fields, "WAITER_FLAG", rng.pick(["true", "false", "false"]));
    addField(fields, "LOANER_FLAG", rng.pick(["false", "false", "true"]));
    addField(fields, "WARRANTY_FLAG", params.warranty ? "true" : "false");
    addField(fields, "FLEET_FLAG", "false");
    addField(fields, "INTERNAL_RO_FLAG", "false");
    addField(fields, "CUSTOMER_TYPE", rng.pick(["RETAIL", "FLEET", "WARRANTY"]));
    addField(fields, "PREFERRED_CONTACT_METHOD", rng.pick(["PHONE", "EMAIL"]));
    addField(fields, "MARKETING_OPT_IN", rng.pick(["true", "false"]));
    addField(fields, "VEHICLE_YEAR", vehicle.year);
    addField(fields, "VEHICLE_MAKE", vehicle.make);
    addField(fields, "VEHICLE_MODEL", vehicle.model);
    addField(fields, "VEHICLE_TRIM", vehicle.trim);
    addField(fields, "VEHICLE_ENGINE", vehicle.engine);
    addField(fields, "VEHICLE_TRANSMISSION", vehicle.transmission);
    addField(fields, "VEHICLE_DRIVETRAIN", vehicle.drivetrain);
    addField(fields, "ODOMETER_IN", odometerIn);
    addField(fields, "ODOMETER_OUT", odometerOut);
    addField(fields, "VEHICLE_COLOR", vehicle.color);
    addField(fields, "VEHICLE_PRODUCTION_DATE", `${vehicle.year}-01-01`);
    addField(fields, "LABOR_TOTAL", lineItems.laborTotal);
    addField(fields, "PARTS_TOTAL", lineItems.partsTotal);
    addField(fields, "SHOP_FEES", lineItems.shopFees);
    addField(fields, "ENVIRONMENTAL_FEES", lineItems.environmentalFees);
    addField(fields, "DISCOUNT_TOTAL", lineItems.discountTotal);
    addField(fields, "TAX_TOTAL", lineItems.taxTotal);
    addField(fields, "GRAND_TOTAL", lineItems.grandTotal);
    addField(fields, "PAYMENT_METHOD", params.warranty ? "WARRANTY" : rng.pick(["CARD", "CASH"]));
    addField(fields, "INVOICE_NUMBER", `INV-${roNumber}`);
    addField(fields, "CREATED_BY_SYSTEM", "synthetic-generator");
    addField(fields, "INGEST_TIMESTAMP", timestamps.ingest);
    addField(fields, "TENANT_ID", args.tenantId);
    addField(fields, "SOURCE_SYSTEM", "SYNTHETIC_V2");

    addField(fields, "CUSTOMER_FIRST_NAME", customer.firstName);
    addField(fields, "CUSTOMER_LAST_NAME", customer.lastName);
    addField(fields, "CUSTOMER_PHONE", customer.phone);
    addField(fields, "CUSTOMER_EMAIL", customer.email);
    addField(fields, "CUSTOMER_ADDRESS_LINE1", customer.addressLine1);
    addField(fields, "CUSTOMER_ADDRESS_CITY", customer.addressCity);
    addField(fields, "CUSTOMER_ADDRESS_STATE", customer.addressState);
    addField(fields, "CUSTOMER_ADDRESS_POSTAL", customer.addressPostal);
    addField(fields, "VIN", vehicle.vin);
    addField(fields, "LICENSE_PLATE", vehicle.licensePlate);

    addField(fields, "CUSTOMER_COMPLAINT", complaint);
    addField(fields, "ADDITIONAL_SYMPTOMS", rng.pick(templates.complaints));
    addField(fields, "CUSTOMER_REQUESTS", rng.pick(["Inspect brakes", "Perform oil change", "Check noise"]));
    addField(fields, "ADVISOR_NOTES", rng.pick(templates.advisorNotes));
    addField(fields, "INTERNAL_COMMENTS", "Internal review complete.");
    addField(fields, "QC_NOTES", "Quality check passed.");

    for (const labor of lineItems.laborLines) {
      const idx = labor.laborIndex;
      addField(fields, `LABOR_LINE_NUMBER_${idx}`, idx);
      addField(fields, `OP_CODE_${idx}`, labor.opCode);
      addField(fields, `OP_DESCRIPTION_${idx}`, labor.opDescription);
      addField(fields, `LABOR_TYPE_${idx}`, labor.laborType);
      addField(fields, `SKILL_LEVEL_${idx}`, rng.pick(["A", "B", "C"]));
      addField(fields, `FLAT_RATE_HOURS_${idx}`, labor.actualHours);
      addField(fields, `ACTUAL_HOURS_${idx}`, labor.actualHours);
      addField(fields, `LABOR_RATE_${idx}`, labor.laborRate);
      addField(fields, `LABOR_EXTENDED_AMOUNT_${idx}`, labor.laborExtendedAmount);
      addField(fields, `TECHNICIAN_ID_${idx}`, labor.technicianId);
      addField(fields, `TECHNICIAN_NOTES_${idx}`, labor.technicianNotes);
      addField(fields, `CAUSE_${idx}`, labor.cause);
      addField(fields, `CORRECTION_${idx}`, labor.correction);
    }

    for (const part of lineItems.partLines) {
      const name = `${part.laborIndex}_${part.partIndex}`;
      addField(fields, `PART_LINE_NUMBER_${name}`, part.partIndex);
      addField(fields, `PART_NUMBER_${name}`, part.partNumber);
      addField(fields, `PART_DESCRIPTION_${name}`, part.partDescription);
      addField(fields, `PART_QUANTITY_${name}`, part.quantity);
      addField(fields, `PART_UNIT_PRICE_${name}`, part.unitPrice);
      addField(fields, `PART_EXTENDED_PRICE_${name}`, part.extendedPrice);
      addField(fields, `PART_SOURCE_${name}`, part.partSource);
      addField(fields, `BACKORDER_FLAG_${name}`, part.backorderFlag);
    }

    const xml = buildXml(fields);
    validateGeneratedXml(xml);

    const filename = `RO-${roNumber}.xml`;
    fs.writeFileSync(path.join(outputDir, filename), xml, "utf8");

    if (args.manifest) {
      manifest.push({
        roNumber,
        vin: vehicle.vin,
        scenario,
        grandTotal: lineItems.grandTotal,
        laborLines: lineItems.laborLines.length,
        partLines: lineItems.partLines.length
      });
    }
  }

  for (const scenario of Object.keys(counts) as Scenario[]) {
    if (scenarioTotals[scenario] < counts[scenario]) {
      throw new Error(`Scenario count mismatch for ${scenario}`);
    }
  }

  if (args.manifest) {
    fs.writeFileSync(
      path.join(outputDir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf8"
    );
  }
};

main();
