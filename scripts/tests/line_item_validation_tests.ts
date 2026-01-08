import { AppError } from "../../shared/utils/errors";
import {
  routeXmlToPayloads,
  validateRoutedPayloads
} from "../../workloads/ro-assistant/src/services/ingest/xmlFieldRouting";

const baseHeader = `
  <RO_STATUS>OPEN</RO_STATUS>
  <OPEN_TIMESTAMP>2026-01-01T09:00:00Z</OPEN_TIMESTAMP>
  <VIN>SYNTHVIN0000000001</VIN>
  <CUSTOMER_FIRST_NAME>Jane</CUSTOMER_FIRST_NAME>
  <CUSTOMER_LAST_NAME>Smith</CUSTOMER_LAST_NAME>
  <CUSTOMER_COMPLAINT>Brake noise</CUSTOMER_COMPLAINT>
`;

const buildXml = (roNumber: string, body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<REPAIR_ORDER>
  <RO_NUMBER>${roNumber}</RO_NUMBER>
  ${baseHeader}
  ${body}
</REPAIR_ORDER>`;

const runValidation = (xml: string) => {
  const routed = routeXmlToPayloads(xml);
  validateRoutedPayloads({
    deterministicPayload: routed.deterministicPayload,
    piiPayload: routed.piiPayload,
    semanticPayload: routed.semanticPayload,
    piiEnabled: true
  });
};

const expectError = (label: string, fn: () => void, code: string) => {
  try {
    fn();
    throw new Error(`Expected error for ${label}`);
  } catch (err) {
    if (!(err instanceof AppError)) {
      throw err;
    }
    if (err.code !== code) {
      throw new Error(`Unexpected error code for ${label}: ${err.code}`);
    }
  }
};

const expectUnknownFieldError = (label: string, fn: () => void, field: string) => {
  try {
    fn();
    throw new Error(`Expected error for ${label}`);
  } catch (err) {
    if (!(err instanceof AppError)) {
      throw err;
    }
    if (err.code !== "XML_FIELD_UNKNOWN") {
      throw new Error(`Unexpected error code for ${label}: ${err.code}`);
    }
    if (!err.message.includes(field)) {
      throw new Error(`Missing unknown field name for ${label}`);
    }
    if (!err.message.includes("field not in Schema V2 allow-list")) {
      throw new Error(`Missing allow-list guidance for ${label}`);
    }
  }
};

const validXml = buildXml(
  "6920001",
  `
  <LABOR_LINE_NUMBER_1>1</LABOR_LINE_NUMBER_1>
  <OP_CODE_1>BRK01</OP_CODE_1>
  <OP_DESCRIPTION_1>Replace pads</OP_DESCRIPTION_1>
  <ACTUAL_HOURS_1>1.0</ACTUAL_HOURS_1>
  <LABOR_RATE_1>275.00</LABOR_RATE_1>
  <LABOR_EXTENDED_AMOUNT_1>275.00</LABOR_EXTENDED_AMOUNT_1>
  <PART_LINE_NUMBER_1_1>1</PART_LINE_NUMBER_1_1>
  <PART_NUMBER_1_1>BRK-PAD</PART_NUMBER_1_1>
  <PART_DESCRIPTION_1_1>Pad set</PART_DESCRIPTION_1_1>
  <PART_QUANTITY_1_1>1</PART_QUANTITY_1_1>
  <PART_UNIT_PRICE_1_1>120.00</PART_UNIT_PRICE_1_1>
  <PART_EXTENDED_PRICE_1_1>120.00</PART_EXTENDED_PRICE_1_1>
  <LABOR_LINE_NUMBER_2>2</LABOR_LINE_NUMBER_2>
  <OP_CODE_2>BRK02</OP_CODE_2>
  <OP_DESCRIPTION_2>Inspect rear brakes</OP_DESCRIPTION_2>
  <ACTUAL_HOURS_2>2.0</ACTUAL_HOURS_2>
  <LABOR_RATE_2>275.00</LABOR_RATE_2>
  <LABOR_EXTENDED_AMOUNT_2>550.00</LABOR_EXTENDED_AMOUNT_2>
  <LABOR_TOTAL>825.00</LABOR_TOTAL>
  <PARTS_TOTAL>120.00</PARTS_TOTAL>
  <SHOP_FEES>0.00</SHOP_FEES>
  <ENVIRONMENTAL_FEES>0.00</ENVIRONMENTAL_FEES>
  <TAX_TOTAL>0.00</TAX_TOTAL>
  <DISCOUNT_TOTAL>0.00</DISCOUNT_TOTAL>
  <GRAND_TOTAL>945.00</GRAND_TOTAL>
  `
);

const orphanPartXml = buildXml(
  "6920002",
  `
  <LABOR_LINE_NUMBER_1>1</LABOR_LINE_NUMBER_1>
  <OP_CODE_1>BRK01</OP_CODE_1>
  <ACTUAL_HOURS_1>1.0</ACTUAL_HOURS_1>
  <LABOR_EXTENDED_AMOUNT_1>275.00</LABOR_EXTENDED_AMOUNT_1>
  <PART_NUMBER_2_1>BAD</PART_NUMBER_2_1>
  <PART_QUANTITY_2_1>1</PART_QUANTITY_2_1>
  <PART_UNIT_PRICE_2_1>10.00</PART_UNIT_PRICE_2_1>
  `
);

const badRateXml = buildXml(
  "6920003",
  `
  <LABOR_LINE_NUMBER_1>1</LABOR_LINE_NUMBER_1>
  <OP_CODE_1>BRK01</OP_CODE_1>
  <ACTUAL_HOURS_1>1.0</ACTUAL_HOURS_1>
  <LABOR_RATE_1>300.00</LABOR_RATE_1>
  <LABOR_EXTENDED_AMOUNT_1>300.00</LABOR_EXTENDED_AMOUNT_1>
  <LABOR_TOTAL>300.00</LABOR_TOTAL>
  <PARTS_TOTAL>0.00</PARTS_TOTAL>
  <SHOP_FEES>0.00</SHOP_FEES>
  <ENVIRONMENTAL_FEES>0.00</ENVIRONMENTAL_FEES>
  <TAX_TOTAL>0.00</TAX_TOTAL>
  <DISCOUNT_TOTAL>0.00</DISCOUNT_TOTAL>
  <GRAND_TOTAL>300.00</GRAND_TOTAL>
  `
);

const badRoXml = buildXml(
  "123",
  `
  <LABOR_LINE_NUMBER_1>1</LABOR_LINE_NUMBER_1>
  <OP_CODE_1>BRK01</OP_CODE_1>
  <ACTUAL_HOURS_1>1.0</ACTUAL_HOURS_1>
  <LABOR_RATE_1>275.00</LABOR_RATE_1>
  <LABOR_EXTENDED_AMOUNT_1>275.00</LABOR_EXTENDED_AMOUNT_1>
  <LABOR_TOTAL>275.00</LABOR_TOTAL>
  <PARTS_TOTAL>0.00</PARTS_TOTAL>
  <SHOP_FEES>0.00</SHOP_FEES>
  <ENVIRONMENTAL_FEES>0.00</ENVIRONMENTAL_FEES>
  <TAX_TOTAL>0.00</TAX_TOTAL>
  <DISCOUNT_TOTAL>0.00</DISCOUNT_TOTAL>
  <GRAND_TOTAL>275.00</GRAND_TOTAL>
  `
);

const gapLaborXml = buildXml(
  "6920004",
  `
  <LABOR_LINE_NUMBER_1>1</LABOR_LINE_NUMBER_1>
  <OP_CODE_1>BRK01</OP_CODE_1>
  <ACTUAL_HOURS_1>1.0</ACTUAL_HOURS_1>
  <LABOR_RATE_1>275.00</LABOR_RATE_1>
  <LABOR_EXTENDED_AMOUNT_1>275.00</LABOR_EXTENDED_AMOUNT_1>
  <LABOR_LINE_NUMBER_3>3</LABOR_LINE_NUMBER_3>
  <OP_CODE_3>BRK03</OP_CODE_3>
  <ACTUAL_HOURS_3>1.0</ACTUAL_HOURS_3>
  <LABOR_RATE_3>275.00</LABOR_RATE_3>
  <LABOR_EXTENDED_AMOUNT_3>275.00</LABOR_EXTENDED_AMOUNT_3>
  <LABOR_TOTAL>550.00</LABOR_TOTAL>
  <PARTS_TOTAL>0.00</PARTS_TOTAL>
  <SHOP_FEES>0.00</SHOP_FEES>
  <ENVIRONMENTAL_FEES>0.00</ENVIRONMENTAL_FEES>
  <TAX_TOTAL>0.00</TAX_TOTAL>
  <DISCOUNT_TOTAL>0.00</DISCOUNT_TOTAL>
  <GRAND_TOTAL>550.00</GRAND_TOTAL>
  `
);

const unknownFieldXml = buildXml(
  "6920005",
  `
  <LABOR_LINE_NUMBER_1>1</LABOR_LINE_NUMBER_1>
  <OP_CODE_1>BRK01</OP_CODE_1>
  <ACTUAL_HOURS_1>1.0</ACTUAL_HOURS_1>
  <LABOR_RATE_1>275.00</LABOR_RATE_1>
  <LABOR_EXTENDED_AMOUNT_1>275.00</LABOR_EXTENDED_AMOUNT_1>
  <LABOR_TOTAL>275.00</LABOR_TOTAL>
  <PARTS_TOTAL>0.00</PARTS_TOTAL>
  <SHOP_FEES>0.00</SHOP_FEES>
  <ENVIRONMENTAL_FEES>0.00</ENVIRONMENTAL_FEES>
  <TAX_TOTAL>0.00</TAX_TOTAL>
  <DISCOUNT_TOTAL>0.00</DISCOUNT_TOTAL>
  <GRAND_TOTAL>275.00</GRAND_TOTAL>
  <UNKNOWN_FIELD>abc</UNKNOWN_FIELD>
  `
);

const indexedSemanticXml = buildXml(
  "6920006",
  `
  <LABOR_LINE_NUMBER_1>1</LABOR_LINE_NUMBER_1>
  <OP_CODE_1>BRK01</OP_CODE_1>
  <OP_DESCRIPTION_1>Replace pads</OP_DESCRIPTION_1>
  <ACTUAL_HOURS_1>1.0</ACTUAL_HOURS_1>
  <LABOR_RATE_1>275.00</LABOR_RATE_1>
  <LABOR_EXTENDED_AMOUNT_1>275.00</LABOR_EXTENDED_AMOUNT_1>
  <LABOR_TOTAL>275.00</LABOR_TOTAL>
  <PARTS_TOTAL>0.00</PARTS_TOTAL>
  <SHOP_FEES>0.00</SHOP_FEES>
  <ENVIRONMENTAL_FEES>0.00</ENVIRONMENTAL_FEES>
  <TAX_TOTAL>0.00</TAX_TOTAL>
  <DISCOUNT_TOTAL>0.00</DISCOUNT_TOTAL>
  <GRAND_TOTAL>275.00</GRAND_TOTAL>
  `
);

const missingRateXml = buildXml(
  "6920007",
  `
  <LABOR_LINE_NUMBER_1>1</LABOR_LINE_NUMBER_1>
  <OP_CODE_1>BRK01</OP_CODE_1>
  <ACTUAL_HOURS_1>1.0</ACTUAL_HOURS_1>
  <LABOR_EXTENDED_AMOUNT_1>275.00</LABOR_EXTENDED_AMOUNT_1>
  <LABOR_TOTAL>275.00</LABOR_TOTAL>
  <PARTS_TOTAL>0.00</PARTS_TOTAL>
  <SHOP_FEES>0.00</SHOP_FEES>
  <ENVIRONMENTAL_FEES>0.00</ENVIRONMENTAL_FEES>
  <TAX_TOTAL>0.00</TAX_TOTAL>
  <DISCOUNT_TOTAL>0.00</DISCOUNT_TOTAL>
  <GRAND_TOTAL>275.00</GRAND_TOTAL>
  `
);

const missingExtendedXml = buildXml(
  "6920008",
  `
  <LABOR_LINE_NUMBER_1>1</LABOR_LINE_NUMBER_1>
  <OP_CODE_1>BRK01</OP_CODE_1>
  <ACTUAL_HOURS_1>1.0</ACTUAL_HOURS_1>
  <LABOR_RATE_1>275.00</LABOR_RATE_1>
  <LABOR_TOTAL>275.00</LABOR_TOTAL>
  <PARTS_TOTAL>0.00</PARTS_TOTAL>
  <SHOP_FEES>0.00</SHOP_FEES>
  <ENVIRONMENTAL_FEES>0.00</ENVIRONMENTAL_FEES>
  <TAX_TOTAL>0.00</TAX_TOTAL>
  <DISCOUNT_TOTAL>0.00</DISCOUNT_TOTAL>
  <GRAND_TOTAL>275.00</GRAND_TOTAL>
  `
);

const mismatchedTotalsXml = buildXml(
  "6920009",
  `
  <LABOR_LINE_NUMBER_1>1</LABOR_LINE_NUMBER_1>
  <OP_CODE_1>BRK01</OP_CODE_1>
  <ACTUAL_HOURS_1>1.0</ACTUAL_HOURS_1>
  <LABOR_RATE_1>275.00</LABOR_RATE_1>
  <LABOR_EXTENDED_AMOUNT_1>275.00</LABOR_EXTENDED_AMOUNT_1>
  <LABOR_TOTAL>100.00</LABOR_TOTAL>
  <PARTS_TOTAL>0.00</PARTS_TOTAL>
  <SHOP_FEES>0.00</SHOP_FEES>
  <ENVIRONMENTAL_FEES>0.00</ENVIRONMENTAL_FEES>
  <TAX_TOTAL>0.00</TAX_TOTAL>
  <DISCOUNT_TOTAL>0.00</DISCOUNT_TOTAL>
  <GRAND_TOTAL>100.00</GRAND_TOTAL>
  `
);

runValidation(validXml);
expectError("orphan part", () => runValidation(orphanPartXml), "PART_ORPHANED");
expectError("labor rate", () => runValidation(badRateXml), "LABOR_RATE_INVALID");
expectError("ro number", () => runValidation(badRoXml), "RO_NUMBER_INVALID");
expectError("labor gap", () => runValidation(gapLaborXml), "INDEX_GAP");
expectError("missing labor rate", () => runValidation(missingRateXml), "LABOR_RATE_MISSING");
expectError("missing extended", () => runValidation(missingExtendedXml), "LABOR_EXTENDED_MISSING");
expectError("mismatched totals", () => runValidation(mismatchedTotalsXml), "LABOR_TOTAL_INVALID");
expectUnknownFieldError("unknown field", () => routeXmlToPayloads(unknownFieldXml), "UNKNOWN_FIELD");

const indexedSemantic = routeXmlToPayloads(indexedSemanticXml);
const opDescription = indexedSemantic.semanticPayload.find((entry) => entry.path === "OP_DESCRIPTION_1");
if (!opDescription || opDescription.laborIndex !== 1) {
  throw new Error("Indexed semantic field did not route correctly");
}

console.log("Line item validation tests passed.");
