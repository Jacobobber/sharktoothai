import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname);
const DATASET_DIR = path.join(ROOT, "datasets", "v1");
const CSV_PATH = path.join(DATASET_DIR, "ro_records.csv");
const DOCS_DIR = path.join(DATASET_DIR, "ro_documents");
const GT_PATH = path.join(DATASET_DIR, "ground_truth_map.yaml");
const SCHEMA_PATH = path.join(ROOT, "schema.md");

const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const phonePattern = /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b|\(\d{3}\)\s*\d{3}[-.\s]?\d{4}\b/;
const vinPattern = /\b[A-HJ-NPR-Z0-9]{17}\b/i;

const die = (message: string) => {
  console.error(`ERROR: ${message}`);
  process.exit(1);
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

const parseCsv = (csvText: string) => {
  const rows: string[][] = [];
  let row: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i += 1) {
    const ch = csvText[i];
    const next = csvText[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        current += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(current);
      current = "";
      continue;
    }
    if (ch === "\n") {
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
      continue;
    }
    if (ch === "\r") continue;
    current += ch;
  }
  if (current.length > 0 || row.length > 0) {
    row.push(current);
    rows.push(row);
  }
  return rows;
};

const ensureNoPii = (value: string, context: string) => {
  if (emailPattern.test(value)) die(`PII detected (${context}): email-like string`);
  if (phonePattern.test(value)) die(`PII detected (${context}): phone-like string`);
  if (vinPattern.test(value)) die(`PII detected (${context}): VIN-like string`);
};

const ensureFile = (filePath: string, label: string) => {
  if (!fs.existsSync(filePath)) die(`${label} not found: ${filePath}`);
};

const schemaText = readText(SCHEMA_PATH);
if (!schemaText) die("schema.md not found");
const requiredFields = parseRequiredFields(schemaText);
if (!requiredFields.length) die("Required fields not found in schema.md");

ensureFile(CSV_PATH, "ro_records.csv");
const csvText = readText(CSV_PATH);
const rows = parseCsv(csvText);
if (!rows.length) die("ro_records.csv is empty or unparsable");

const header = rows[0];
const headerSet = new Set(header);
const requiredSet = new Set(requiredFields);

if (header.length !== requiredFields.length || !requiredFields.every((f) => headerSet.has(f))) {
  die(`ro_records.csv columns do not match schema Required list. Expected: ${requiredFields.join(", ")}`);
}

const roIds = new Set<string>();
for (let i = 1; i < rows.length; i += 1) {
  const row = rows[i];
  if (row.length !== header.length) {
    die(`CSV row ${i + 1} has ${row.length} columns; expected ${header.length}`);
  }
  const record: Record<string, string> = {};
  for (let j = 0; j < header.length; j += 1) {
    record[header[j]] = row[j] ?? "";
  }
  const roId = record["ro_id"];
  if (!roId) die(`CSV row ${i + 1} missing ro_id`);
  if (roIds.has(roId)) die(`Duplicate ro_id in CSV: ${roId}`);
  roIds.add(roId);
  for (const [key, value] of Object.entries(record)) {
    if (!value) die(`CSV row ${i + 1} empty value for ${key}`);
    ensureNoPii(value, `csv:${roId}:${key}`);
  }
}

ensureFile(DOCS_DIR, "ro_documents directory");
for (const roId of roIds) {
  const docPath = path.join(DOCS_DIR, `${roId}.txt`);
  if (!fs.existsSync(docPath)) {
    die(`Missing document for ro_id ${roId}: ${docPath}`);
  }
  const docText = readText(docPath);
  if (!docText.includes(roId)) {
    die(`Document ${docPath} does not reference ro_id ${roId}`);
  }
  ensureNoPii(docText, `doc:${roId}`);
}

ensureFile(GT_PATH, "ground_truth_map.yaml");
const gtText = readText(GT_PATH);
const gtRoIds = new Set<string>();
const roIdMatches = gtText.match(/RO-\d{4}/g) ?? [];
for (const roId of roIdMatches) gtRoIds.add(roId);

for (const roId of gtRoIds) {
  if (!roIds.has(roId)) {
    die(`ground_truth_map.yaml references missing ro_id: ${roId}`);
  }
}

for (const roId of roIds) {
  if (!gtRoIds.has(roId)) {
    continue;
  }
}

console.log("Validation passed.");
