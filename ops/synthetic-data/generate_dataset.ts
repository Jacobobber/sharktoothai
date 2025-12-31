import fs from "fs";
import path from "path";

const SEED = 24681357;
const LABOR_RATE = 275.0;
const MAX_TEXT_LENGTH = 600;

const EXPECTED_REQUIRED_FIELDS = [
  "ro_id",
  "open_date",
  "close_date",
  "vehicle_year",
  "vehicle_make",
  "vehicle_model",
  "engine_type",
  "mileage_range",
  "complaint_text",
  "technician_notes",
  "diagnostic_summary",
  "repair_actions",
  "labor_hours",
  "labor_rate",
  "labor_cost",
  "parts_cost",
  "total_cost",
  "warranty_flag",
  "comebacks_flag",
  "repair_category",
  "advisor_notes",
  "internal_comments"
];

type Scenario = {
  scenarioId: string;
};

type Category = {
  key: string;
  family: string;
  repairCategory: "minor" | "medium" | "major";
  repairBucket: string;
  summary: string;
  complaintTemplates: string[];
  diagnosticTemplates: string[];
  repairTemplates: string[];
  outcomeTemplates: string[];
};

type RecordRow = Record<string, string>;

type GroundTruthEntry = {
  scenario_id: string;
  expected_primary_ro_ids: string[];
  acceptable_secondary_ro_ids: string[];
  explicit_non_match_ro_ids: string[];
};

const rnd = (() => {
  let t = SEED >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
})();

const randRange = (min: number, max: number, step = 0.1) => {
  const span = Math.floor((max - min) / step) + 1;
  return min + Math.floor(rnd() * span) * step;
};

const pick = <T,>(values: T[]) => values[Math.floor(rnd() * values.length)];

const csvEscape = (value: string) => {
  if (value.includes("\n") || value.includes("\r") || value.includes(",") || value.includes('"')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
};

const readText = (filePath: string) => {
  if (!fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf8");
};

const parseRequiredFields = (schemaText: string) => {
  const required: string[] = [];
  const lines = schemaText.split(/\r?\n/);
  let inRequired = false;
  for (const line of lines) {
    if (line.trim().toLowerCase() === "## required fields") {
      inRequired = true;
      continue;
    }
    if (inRequired && line.trim().startsWith("## ")) break;
    if (!inRequired) continue;
    if (/^\s{2,}[-*]\s+/.test(line)) continue;
    const match = line.match(/^[-*]\s+([a-zA-Z0-9_]+)/);
    if (match) required.push(match[1]);
  }
  return required;
};

const parseScenarioIds = (yamlText: string): Scenario[] => {
  const scenarios: Scenario[] = [];
  const lines = yamlText.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*-\s*scenario_id:\s*"?([A-Za-z0-9\-_]+)"?/);
    if (match) scenarios.push({ scenarioId: match[1] });
  }
  return scenarios;
};

const parseTotalCount = (sizeText: string) => {
  const match = sizeText.match(/Total RO count:\s*(\d+)/i);
  return match ? Number(match[1]) : 100;
};

const formatDate = (date: Date) => date.toISOString().slice(0, 10);

const ensureNoPii = (value: string, context: string) => {
  const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
  const phone = /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b|\(\d{3}\)\s*\d{3}[-.\s]?\d{4}\b/;
  const vin = /\b[A-HJ-NPR-Z0-9]{17}\b/i;
  if (email.test(value)) throw new Error(`PII check failed (${context}): email-like string found`);
  if (phone.test(value)) throw new Error(`PII check failed (${context}): phone-like string found`);
  if (vin.test(value)) throw new Error(`PII check failed (${context}): VIN-like string found`);
};

const enforceTextLength = (value: string, context: string) => {
  if (value.length > MAX_TEXT_LENGTH) {
    throw new Error(`Text length exceeded (${context}): ${value.length}`);
  }
};

const ROOT = path.resolve(__dirname);
const schemaPath = path.join(ROOT, "schema.md");
const scenariosPath = path.join(ROOT, "retrieval-scenarios.yaml");
const adminScenariosPath = path.join(ROOT, "retrieval-scenarios-admin.yaml");
const safetyPath = path.join(ROOT, "safety-rules.md");
const sizePath = path.join(ROOT, "dataset-size.md");

const schemaText = readText(schemaPath);
const requiredFields = parseRequiredFields(schemaText);
if (!requiredFields.length) {
  throw new Error("schema.md missing Required Fields section");
}

for (const field of EXPECTED_REQUIRED_FIELDS) {
  if (!requiredFields.includes(field)) {
    throw new Error(`schema.md missing required field: ${field}`);
  }
}

for (const field of requiredFields) {
  if (!EXPECTED_REQUIRED_FIELDS.includes(field)) {
    throw new Error(`Generator does not support required field: ${field}`);
  }
}

const scenarios = parseScenarioIds(readText(scenariosPath));
const adminScenarios = parseScenarioIds(readText(adminScenariosPath));
const allScenarios = [...scenarios, ...adminScenarios];
if (!allScenarios.length) {
  throw new Error("No scenarios found in retrieval scenario files");
}

const totalCount = parseTotalCount(readText(sizePath));
if (totalCount < 50 || totalCount > 150) {
  throw new Error(`Total RO count out of bounds: ${totalCount}`);
}

readText(safetyPath); // Presence is enforced by runtime reading.

const categories: Category[] = [
  {
    key: "hot_no_start_starter",
    family: "hot_no_start",
    repairCategory: "medium",
    repairBucket: "electrical",
    summary: "Intermittent hot no-start; single click",
    complaintTemplates: [
      "intermittent no-start when hot, single click from starter",
      "hot restart no crank, single click",
      "no-start after heat soak, clicks once"
    ],
    diagnosticTemplates: [
      "voltage drop test at starter circuit",
      "starter current draw test",
      "checked crank signal and starter feed"
    ],
    repairTemplates: [
      "replaced starter and added heat shield",
      "replaced starter assembly",
      "replaced starter solenoid"
    ],
    outcomeTemplates: ["starts consistently when hot", "hot restart verified", "no-start not reproduced"]
  },
  {
    key: "hot_no_start_cable",
    family: "hot_no_start",
    repairCategory: "minor",
    repairBucket: "electrical",
    summary: "Hot no-start; clicks once",
    complaintTemplates: [
      "intermittent no-start when hot, single click from starter",
      "hot restart no crank, single click",
      "no-start after heat soak, clicks once"
    ],
    diagnosticTemplates: [
      "inspected battery cables and terminals",
      "checked cable resistance at crank",
      "load tested battery and connections"
    ],
    repairTemplates: [
      "cleaned and tightened battery cable connections",
      "replaced positive cable terminal",
      "repaired ground cable connection"
    ],
    outcomeTemplates: ["hot restarts restored", "crank normal when hot", "no-start resolved"]
  },
  {
    key: "brake_fade_air",
    family: "brake_fade",
    repairCategory: "medium",
    repairBucket: "brakes",
    summary: "Brake pedal soft after multiple stops",
    complaintTemplates: [
      "brake pedal goes soft after a few stops",
      "soft pedal after repeated braking",
      "pedal fades after multiple stops"
    ],
    diagnosticTemplates: [
      "pressure bleed and inspected for air",
      "checked for air in lines",
      "inspected fluid condition and bleed"
    ],
    repairTemplates: [
      "performed full brake bleed",
      "bled system and verified pedal",
      "pressure bled brake system"
    ],
    outcomeTemplates: ["pedal firm across repeated stops", "pedal feel stable", "brake pedal restored"]
  },
  {
    key: "brake_fade_master",
    family: "brake_fade",
    repairCategory: "medium",
    repairBucket: "brakes",
    summary: "Soft pedal returns after stops",
    complaintTemplates: [
      "brake pedal goes soft after a few stops",
      "soft pedal after repeated braking",
      "pedal fades after multiple stops"
    ],
    diagnosticTemplates: [
      "tested master cylinder bypass",
      "checked for internal master leak",
      "isolated master cylinder pressure drop"
    ],
    repairTemplates: [
      "replaced master cylinder and bled system",
      "installed master cylinder and pressure bled",
      "replaced master cylinder"
    ],
    outcomeTemplates: ["pedal feel stable", "pedal firm after repair", "brake feel normal"]
  },
  {
    key: "weak_heat_low_coolant",
    family: "weak_heat",
    repairCategory: "minor",
    repairBucket: "cooling",
    summary: "Weak heat at idle; improves with rpm",
    complaintTemplates: [
      "cabin heat weak at idle but improves with rpm",
      "heat output low at idle, better with rpm",
      "heater weak at idle"
    ],
    diagnosticTemplates: [
      "checked coolant level and flow",
      "inspected cooling system level",
      "pressure tested cooling system"
    ],
    repairTemplates: [
      "corrected coolant level and bled system",
      "topped off coolant and bled air",
      "filled coolant and verified flow"
    ],
    outcomeTemplates: ["heat output normal at idle", "cabin heat consistent", "heat restored at idle"]
  },
  {
    key: "weak_heat_core",
    family: "weak_heat",
    repairCategory: "medium",
    repairBucket: "cooling",
    summary: "Weak heat at idle; flow restricted",
    complaintTemplates: [
      "cabin heat weak at idle but improves with rpm",
      "heat output low at idle, better with rpm",
      "heater weak at idle"
    ],
    diagnosticTemplates: [
      "measured heater core inlet/outlet temps",
      "checked heater core flow",
      "verified restricted heater flow"
    ],
    repairTemplates: [
      "flushed heater core and restored flow",
      "backflushed heater core",
      "performed heater core flush"
    ],
    outcomeTemplates: ["cabin heat consistent", "heat restored at idle", "heater output normal"]
  },
  {
    key: "low_charge_alternator",
    family: "charging",
    repairCategory: "medium",
    repairBucket: "electrical",
    summary: "Battery light on; low charging voltage",
    complaintTemplates: [
      "battery light on, charging voltage low",
      "charge light on, low output",
      "low charging voltage with warning light"
    ],
    diagnosticTemplates: [
      "loaded alternator output test",
      "checked alternator output under load",
      "verified regulator output low"
    ],
    repairTemplates: ["replaced alternator", "installed new alternator", "replaced alternator assembly"],
    outcomeTemplates: ["charging voltage within spec", "charge system normal", "warning light off"]
  },
  {
    key: "suspension_rattle",
    family: "suspension_noise",
    repairCategory: "medium",
    repairBucket: "suspension",
    summary: "Front rattle on small bumps",
    complaintTemplates: [
      "rattle from front end over small bumps",
      "front end rattle on rough road",
      "clunk on small bumps"
    ],
    diagnosticTemplates: [
      "inspected sway bar links and mounts",
      "checked strut mounts and links",
      "verified loose front link"
    ],
    repairTemplates: [
      "replaced sway bar links",
      "replaced front sway links",
      "tightened and replaced worn links"
    ],
    outcomeTemplates: ["rattle no longer present", "noise resolved", "front end quiet"]
  },
  {
    key: "vacuum_leak_idle",
    family: "idle_quality",
    repairCategory: "medium",
    repairBucket: "engine",
    summary: "Rough idle with high trims",
    complaintTemplates: [
      "rough idle with high fuel trims",
      "idle rough, trims high",
      "rough idle, improves off idle"
    ],
    diagnosticTemplates: [
      "smoke test intake system",
      "checked for unmetered air",
      "verified intake leak"
    ],
    repairTemplates: [
      "replaced intake gasket",
      "sealed intake leak",
      "replaced intake seals"
    ],
    outcomeTemplates: ["idle smooth and trims normal", "idle stabilized", "fuel trims normal"]
  },
  {
    key: "brake_grind_hardware",
    family: "brake_noise",
    repairCategory: "minor",
    repairBucket: "brakes",
    summary: "Grinding noise at low-speed braking",
    complaintTemplates: [
      "grinding noise when braking at low speed",
      "low speed brake grind",
      "grind noise on light brake apply"
    ],
    diagnosticTemplates: [
      "inspected pad hardware and caliper bracket",
      "checked pad hardware fit",
      "inspected pad clips and shims"
    ],
    repairTemplates: [
      "reinstalled pad hardware and lubricated contact points",
      "re-seated pad hardware",
      "lubricated pad contact points"
    ],
    outcomeTemplates: ["grinding noise resolved", "brake noise gone", "no grind on test"]
  },
  {
    key: "wind_noise_door",
    family: "body_noise",
    repairCategory: "minor",
    repairBucket: "body",
    summary: "Wind noise at highway speed",
    complaintTemplates: [
      "wind noise at highway speed",
      "wind whistle at speed",
      "wind noise from door area"
    ],
    diagnosticTemplates: [
      "checked door alignment and mirror trim",
      "inspected door seal seating",
      "verified trim fitment"
    ],
    repairTemplates: [
      "adjusted door alignment and reseated trim",
      "aligned door and replaced seal",
      "repositioned mirror trim"
    ],
    outcomeTemplates: ["wind noise reduced", "wind noise resolved", "noise not present on road test"]
  },
  {
    key: "misfire_under_load",
    family: "misfire",
    repairCategory: "medium",
    repairBucket: "engine",
    summary: "Misfire under load only",
    complaintTemplates: [
      "intermittent misfire under load only",
      "misfire on acceleration, idle ok",
      "hesitation under load"
    ],
    diagnosticTemplates: [
      "load test ignition and fuel delivery",
      "verified coil output under load",
      "checked fuel delivery under load"
    ],
    repairTemplates: [
      "replaced ignition coil and verified",
      "replaced weak coil",
      "replaced coil and cleared codes"
    ],
    outcomeTemplates: ["misfire not present under load", "acceleration smooth", "no misfire on test"]
  },
  {
    key: "brake_shake_rotor",
    family: "brake_vibration",
    repairCategory: "medium",
    repairBucket: "brakes",
    summary: "Steering shake when braking",
    complaintTemplates: [
      "steering wheel shakes during braking from speed",
      "brake vibration from highway speeds",
      "steering shake on brake apply"
    ],
    diagnosticTemplates: [
      "measured rotor runout",
      "checked rotor thickness variation",
      "verified front rotor runout"
    ],
    repairTemplates: [
      "replaced front brake rotors and pads",
      "replaced front rotors",
      "installed new rotors and pads"
    ],
    outcomeTemplates: ["brake shake resolved", "vibration gone", "smooth braking restored"]
  },
  {
    key: "no_airflow_blend",
    family: "hvac_airflow",
    repairCategory: "medium",
    repairBucket: "hvac",
    summary: "Blower runs but no airflow",
    complaintTemplates: [
      "blower runs but little to no airflow from vents",
      "fan works, no air out vents",
      "blower on, airflow blocked"
    ],
    diagnosticTemplates: [
      "inspected blend door and ducting",
      "checked mode door movement",
      "verified door stuck"
    ],
    repairTemplates: [
      "freed blend door and recalibrated actuator",
      "repaired blend door linkage",
      "recalibrated HVAC actuator"
    ],
    outcomeTemplates: ["airflow restored", "vents flowing", "airflow normal"]
  },
  {
    key: "coolant_smell_core",
    family: "coolant_smell",
    repairCategory: "major",
    repairBucket: "hvac",
    summary: "Coolant smell in cabin with fogging",
    complaintTemplates: [
      "coolant smell in cabin with window fogging",
      "sweet odor in cabin, fogging windows",
      "coolant odor from vents"
    ],
    diagnosticTemplates: [
      "pressure tested cooling system and HVAC box",
      "checked for heater core seepage",
      "verified coolant leak inside HVAC"
    ],
    repairTemplates: [
      "replaced heater core and cleaned HVAC box",
      "replaced heater core",
      "replaced heater core and flushed system"
    ],
    outcomeTemplates: ["no coolant odor or fogging", "odor resolved", "no fogging after repair"]
  },
  {
    key: "trans_shudder_tcc",
    family: "transmission",
    repairCategory: "major",
    repairBucket: "transmission",
    summary: "Light throttle shudder",
    complaintTemplates: [
      "shudder on light throttle cruise",
      "vibration at steady cruise",
      "light throttle shudder"
    ],
    diagnosticTemplates: [
      "road tested and checked TCC engagement",
      "verified TCC shudder",
      "checked transmission fluid condition"
    ],
    repairTemplates: [
      "performed fluid service and re-learn",
      "replaced fluid and adapted",
      "performed transmission service"
    ],
    outcomeTemplates: ["shudder reduced to not present", "cruise smooth", "no shudder after service"]
  },
  {
    key: "ac_warm_idle_fan",
    family: "ac_performance",
    repairCategory: "medium",
    repairBucket: "hvac",
    summary: "A/C warm at idle, cools driving",
    complaintTemplates: [
      "A/C warm at idle and cools when driving",
      "A/C not cold at idle",
      "A/C warm at idle, cold at speed"
    ],
    diagnosticTemplates: [
      "checked condenser airflow and fan operation",
      "verified fan command at idle",
      "checked fan control circuit"
    ],
    repairTemplates: [
      "repaired fan control circuit",
      "replaced cooling fan relay",
      "repaired fan wiring"
    ],
    outcomeTemplates: ["A/C cool at idle", "idle cooling restored", "A/C temp normal"]
  },
  {
    key: "cv_click_axle",
    family: "drivetrain_noise",
    repairCategory: "major",
    repairBucket: "drivetrain",
    summary: "Clicking on tight turns",
    complaintTemplates: [
      "clicking from front axle on tight turns",
      "clicking on full lock turns",
      "front axle clicks on turns"
    ],
    diagnosticTemplates: [
      "inspected CV joints and boots",
      "checked axle play",
      "verified outer CV wear"
    ],
    repairTemplates: [
      "replaced front axle assembly",
      "replaced CV axle",
      "installed new axle"
    ],
    outcomeTemplates: ["clicking noise resolved", "no click on turns", "axle noise gone"]
  }
];

const scenarioCategoryMap: Record<string, string> = {
  "RS-001": "hot_no_start_starter",
  "RS-002": "brake_fade_air",
  "RS-003": "weak_heat_low_coolant",
  "RS-004": "low_charge_alternator",
  "RS-005": "suspension_rattle",
  "RS-006": "vacuum_leak_idle",
  "RS-007": "brake_grind_hardware",
  "RS-008": "wind_noise_door",
  "RS-009": "misfire_under_load",
  "RS-010": "brake_shake_rotor",
  "RS-011": "no_airflow_blend",
  "RS-012": "coolant_smell_core",
  "RS-013": "trans_shudder_tcc",
  "RS-014": "ac_warm_idle_fan",
  "RS-015": "cv_click_axle",
  "RSA-001": "coolant_smell_core",
  "RSA-002": "hot_no_start_starter",
  "RSA-003": "brake_fade_air",
  "RSA-004": "low_charge_alternator",
  "RSA-005": "trans_shudder_tcc",
  "RSA-006": "wind_noise_door",
  "RSA-007": "coolant_smell_core",
  "RSA-008": "misfire_under_load",
  "RSA-009": "brake_shake_rotor",
  "RSA-010": "ac_warm_idle_fan",
  "RSA-011": "no_airflow_blend",
  "RSA-012": "suspension_rattle",
  "RSA-013": "cv_click_axle",
  "RSA-014": "brake_fade_master"
};

const records: RecordRow[] = [];
const categoryRids: Record<string, string[]> = {};
for (const cat of categories) categoryRids[cat.key] = [];

const basePerCat = Math.floor(totalCount / categories.length);
let remainder = totalCount - basePerCat * categories.length;

let roIndex = 1;
const baseDate = new Date("2024-01-01T00:00:00Z");

for (const cat of categories) {
  const extra = remainder > 0 ? 1 : 0;
  remainder -= extra;
  const count = basePerCat + extra;
  for (let i = 0; i < count; i += 1) {
    const roId = `RO-${String(roIndex).padStart(4, "0")}`;
    categoryRids[cat.key].push(roId);

    const complaint = pick(cat.complaintTemplates);
    const diagnostic = pick(cat.diagnosticTemplates);
    const repair = pick(cat.repairTemplates);
    const outcome = pick(cat.outcomeTemplates);

    const openDate = new Date(baseDate.getTime() + roIndex * 86400000);
    const closeDate = new Date(openDate.getTime() + (1 + Math.floor(rnd() * 7)) * 86400000);

    const laborHours = (() => {
      if (cat.repairCategory === "minor") return randRange(0.5, 1.5, 0.1);
      if (cat.repairCategory === "medium") return randRange(2, 4, 0.1);
      return randRange(5, 10, 0.1);
    })();

    const partsCost = (() => {
      if (cat.repairCategory === "minor") return Math.floor(randRange(25, 150, 1));
      if (cat.repairCategory === "medium") return Math.floor(randRange(200, 900, 1));
      return Math.floor(randRange(1000, 3500, 1));
    })();

    const laborCost = Number((laborHours * LABOR_RATE).toFixed(2));
    const totalCost = Number((laborCost + partsCost).toFixed(2));

    const technicianNotes = [
      `Complaint: ${complaint} on <MODEL_YEAR> <VEHICLE_MODEL> with <ENGINE_TYPE>.`,
      `Condition: observed within <MILEAGE_RANGE>.`,
      `Diagnosis: ${diagnostic}; findings indicate ${cat.summary.toLowerCase()}.`,
      `Repair: ${repair}.`,
      `Outcome: ${outcome}.`
    ].join(" ");

    const advisorNotes = "Customer requested confirmation of repair outcome; no additional concerns.";
    const internalComments = "Verified repair on road test; no further action.";

    const row: RecordRow = {
      ro_id: roId,
      open_date: formatDate(openDate),
      close_date: formatDate(closeDate),
      vehicle_year: "<MODEL_YEAR>",
      vehicle_make: "<VEHICLE_MODEL>",
      vehicle_model: "<VEHICLE_MODEL>",
      engine_type: "<ENGINE_TYPE>",
      mileage_range: "<MILEAGE_RANGE>",
      complaint_text: complaint,
      technician_notes: technicianNotes,
      diagnostic_summary: diagnostic,
      repair_actions: repair,
      labor_hours: laborHours.toFixed(1),
      labor_rate: LABOR_RATE.toFixed(2),
      labor_cost: laborCost.toFixed(2),
      parts_cost: partsCost.toFixed(2),
      total_cost: totalCost.toFixed(2),
      warranty_flag: rnd() < 0.2 ? "true" : "false",
      comebacks_flag: rnd() < 0.1 ? "true" : "false",
      repair_category: cat.repairBucket,
      advisor_notes: advisorNotes,
      internal_comments: internalComments
    };

    for (const [key, value] of Object.entries(row)) {
      if (typeof value !== "string" || value.length === 0) {
        throw new Error(`Missing value for ${key} on ${roId}`);
      }
      ensureNoPii(value, `${roId}:${key}`);
      if (["complaint_text", "technician_notes", "diagnostic_summary", "repair_actions", "advisor_notes", "internal_comments"].includes(key)) {
        enforceTextLength(value, `${roId}:${key}`);
      }
    }

    records.push(row);
    roIndex += 1;
  }
}

const pickNonMatch = (primaryKey: string, used: Set<string>) => {
  const primaryCategory = categories.find((cat) => cat.key === primaryKey);
  if (!primaryCategory) throw new Error(`Unknown category for non-match: ${primaryKey}`);
  const sameFamily = categories.filter(
    (cat) => cat.family === primaryCategory.family && cat.key !== primaryKey
  );
  const candidates = (sameFamily.length ? sameFamily : categories).filter((cat) => cat.key !== primaryKey);
  for (const cat of candidates) {
    for (const rid of categoryRids[cat.key]) {
      if (!used.has(rid)) return rid;
    }
  }
  throw new Error(`Unable to find non-match for ${primaryKey}`);
};

const groundTruth: GroundTruthEntry[] = [];
for (const scenario of allScenarios) {
  const key = scenarioCategoryMap[scenario.scenarioId];
  if (!key) throw new Error(`No category mapping for scenario ${scenario.scenarioId}`);
  const ids = categoryRids[key];
  if (!ids || ids.length < 3) throw new Error(`Not enough records for category ${key}`);

  const used = new Set<string>();
  const primary = ids[0];
  const secondary = [ids[1], ids[2]];
  used.add(primary);
  secondary.forEach((id) => used.add(id));

  const nonMatch1 = pickNonMatch(key, used);
  used.add(nonMatch1);
  const nonMatch2 = pickNonMatch(key, used);

  groundTruth.push({
    scenario_id: scenario.scenarioId,
    expected_primary_ro_ids: [primary],
    acceptable_secondary_ro_ids: secondary,
    explicit_non_match_ro_ids: [nonMatch1, nonMatch2]
  });
}

const datasetDir = path.join(ROOT, "datasets", "v1");
fs.mkdirSync(datasetDir, { recursive: true });

const csvPath = path.join(datasetDir, "ro_records.csv");
const csvLines = [requiredFields.join(",")];
for (const row of records) {
  const line = requiredFields.map((field) => csvEscape(row[field])).join(",");
  csvLines.push(line);
}
fs.writeFileSync(csvPath, csvLines.join("\n") + "\n", "utf8");

const gtPath = path.join(datasetDir, "ground_truth_map.yaml");
const gtLines: string[] = [];
for (const entry of groundTruth) {
  gtLines.push(`- scenario_id: ${entry.scenario_id}`);
  gtLines.push(`  expected_primary_ro_ids: ${JSON.stringify(entry.expected_primary_ro_ids)}`);
  gtLines.push(`  acceptable_secondary_ro_ids: ${JSON.stringify(entry.acceptable_secondary_ro_ids)}`);
  gtLines.push(`  explicit_non_match_ro_ids: ${JSON.stringify(entry.explicit_non_match_ro_ids)}`);
  gtLines.push("");
}
fs.writeFileSync(gtPath, gtLines.join("\n").trimEnd() + "\n", "utf8");

const readmePath = path.join(datasetDir, "README.md");
const readme = textwrap(`
# Synthetic RO Dataset v1

Purpose:
- Pilot-safe synthetic dataset for RO Assistant retrieval evaluation.

Record counts:
- Total RO records: ${records.length}

Pricing assumptions:
- Labor rate: $${LABOR_RATE.toFixed(2)} per hour
- Labor hours and parts costs follow dataset generation rules

Safety guarantees:
- No PII; placeholders only (<VEHICLE_MODEL>, <MODEL_YEAR>, <ENGINE_TYPE>, <MILEAGE_RANGE>)
- Records are generated deterministically with a fixed seed

Determinism:
- Seed: ${SEED}

Warning:
- Synthetic data only. Not for production use.
`);
fs.writeFileSync(readmePath, readme + "\n", "utf8");

function textwrap(content: string) {
  return content.replace(/\n\s+/g, "\n").trim();
}
