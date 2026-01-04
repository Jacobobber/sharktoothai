import { redactPii } from "../../workloads/ro-assistant/src/services/ingest/redact";

const sample = `<repair_order>
  <customer_name>Jane Roe</customer_name>
  <email>jane.roe@example.com</email>
  <phone>555-123-4567</phone>
  <vin>1HGCM82633A123456</vin>
  <license_plate>ABC1234</license_plate>
  <payment_method>Visa</payment_method>
  <address>123 Main St</address>
  <address_city>Springfield</address_city>
  <address_state>IL</address_state>
  <address_zip>62704</address_zip>
</repair_order>`;

const redacted = redactPii(sample);

const hasTagValue = (xml: string, tag: string, value: string) => {
  const lower = xml.toLowerCase();
  const openTag = `<${tag.toLowerCase()}>`;
  const closeTag = `</${tag.toLowerCase()}>`;
  let idx = 0;
  while (idx < lower.length) {
    const start = lower.indexOf(openTag, idx);
    if (start === -1) return false;
    const end = lower.indexOf(closeTag, start + openTag.length);
    if (end === -1) return false;
    const inner = xml.slice(start + openTag.length, end).trim();
    if (inner === value) return true;
    idx = end + closeTag.length;
  }
  return false;
};

const checks = [
  { tag: "customer_name", value: "Jane Roe" },
  { tag: "email", value: "jane.roe@example.com" },
  { tag: "phone", value: "555-123-4567" },
  { tag: "vin", value: "1HGCM82633A123456" },
  { tag: "license_plate", value: "ABC1234" },
  { tag: "payment_method", value: "Visa" },
  { tag: "address", value: "123 Main St" },
  { tag: "address_city", value: "Springfield" },
  { tag: "address_state", value: "IL" },
  { tag: "address_zip", value: "62704" }
];

const leaked = checks.find((check) => hasTagValue(redacted, check.tag, check.value));
if (leaked) {
  console.error("PII detected in redacted XML:", leaked.value);
  process.exit(1);
}

console.log("Redaction harness passed: XML fields redacted.");
