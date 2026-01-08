import { AppError } from "../../shared/utils/errors";
import { assertNoRawPii, redactSemanticText } from "../../workloads/ro-assistant/src/services/ingest/redact";

const expectLeak = (label: string, text: string, expected: string) => {
  try {
    assertNoRawPii(text);
    throw new Error(`Expected leakage detection for ${label}`);
  } catch (err) {
    if (!(err instanceof AppError)) {
      throw err;
    }
    if (!err.message.includes(expected)) {
      throw new Error(`Expected ${expected} in leakage for ${label}`);
    }
  }
};

const raw = "Contact customer Jane Smith at jane.smith@example.com or 555-212-9999. VIN 1HGCM82633A123456.";
const redacted = redactSemanticText(raw);

if (!redacted.includes("<EMAIL>")) {
  throw new Error("Email was not redacted");
}
if (!redacted.includes("<PHONE>")) {
  throw new Error("Phone was not redacted");
}
if (!redacted.includes("<VIN>")) {
  throw new Error("VIN was not redacted");
}
if (!redacted.includes("<PERSON>")) {
  throw new Error("Person was not redacted");
}

const normal = "Replace brake pads and resurface rotors.";
const normalRedacted = redactSemanticText(normal);
if (normalRedacted !== normal) {
  throw new Error("Normal text was over-redacted");
}

expectLeak("raw email", "reach me at tech@example.com", "EMAIL");
expectLeak("raw phone", "call 555-444-1212 for updates", "PHONE");
expectLeak("raw vin", "VIN 1M8GDM9AXKP042788 noted", "VIN");

assertNoRawPii(redacted);

console.log("Semantic redaction tests passed.");
