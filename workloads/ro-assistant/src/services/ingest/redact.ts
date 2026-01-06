const redactTagValues = (xml: string, tagName: string, token: string): string => {
  const lower = xml.toLowerCase();
  const openPrefix = `<${tagName.toLowerCase()}`;
  const closeTag = `</${tagName.toLowerCase()}>`;
  let idx = 0;
  let result = "";

  while (idx < lower.length) {
    const start = lower.indexOf(openPrefix, idx);
    if (start === -1) {
      result += xml.slice(idx);
      break;
    }
    const openEnd = lower.indexOf(">", start);
    if (openEnd === -1) {
      result += xml.slice(idx);
      break;
    }
    const closeIdx = lower.indexOf(closeTag, openEnd + 1);
    if (closeIdx === -1) {
      result += xml.slice(idx);
      break;
    }
    result += xml.slice(idx, openEnd + 1);
    result += token;
    result += xml.slice(closeIdx, closeIdx + closeTag.length);
    idx = closeIdx + closeTag.length;
  }

  return result;
};

const tagAliases = (names: string[]) => names.flatMap((name) => [name, name.toLowerCase()]);

// Redact explicit XML fields; avoid broad regex sweeps to reduce unintended removal.
export const redactPii = (xml: string): string => {
  let result = xml;

  const nameTags = tagAliases([
    "customer_name",
    "customerName",
    "customer",
    "CUSTOMER_FIRST_NAME",
    "CUSTOMER_LAST_NAME"
  ]);
  const emailTags = tagAliases(["email", "email_address", "emailAddress", "CUSTOMER_EMAIL"]);
  const phoneTags = tagAliases(["phone", "phone_number", "phoneNumber", "phones", "CUSTOMER_PHONE"]);
  const vinTags = tagAliases(["vin", "vehicle_vin", "vehicleVin", "VIN"]);
  const licenseTags = tagAliases(["license_plate", "licensePlate", "plate", "LICENSE_PLATE"]);
  const paymentTags = tagAliases(["payment_method", "paymentMethod", "PAYMENT_METHOD"]);
  const addressTags = tagAliases([
    "address",
    "address_line1",
    "addressLine1",
    "address_line2",
    "addressLine2",
    "CUSTOMER_ADDRESS_LINE1"
  ]);
  const cityTags = tagAliases(["address_city", "addressCity", "city", "CUSTOMER_ADDRESS_CITY"]);
  const stateTags = tagAliases(["address_state", "addressState", "state", "CUSTOMER_ADDRESS_STATE"]);
  const zipTags = tagAliases([
    "address_zip",
    "addressZip",
    "zip",
    "postal_code",
    "postalCode",
    "CUSTOMER_ADDRESS_POSTAL"
  ]);

  for (const tag of nameTags) result = redactTagValues(result, tag, "[REDACTED_NAME]");
  for (const tag of emailTags) result = redactTagValues(result, tag, "[REDACTED_EMAIL]");
  for (const tag of phoneTags) result = redactTagValues(result, tag, "[REDACTED_PHONE]");
  for (const tag of vinTags) result = redactTagValues(result, tag, "[REDACTED_VIN]");
  for (const tag of licenseTags) result = redactTagValues(result, tag, "[REDACTED_LICENSE]");
  for (const tag of paymentTags) result = redactTagValues(result, tag, "[REDACTED_PAYMENT]");
  for (const tag of addressTags) result = redactTagValues(result, tag, "[REDACTED_ADDRESS]");
  for (const tag of cityTags) result = redactTagValues(result, tag, "[REDACTED_CITY]");
  for (const tag of stateTags) result = redactTagValues(result, tag, "[REDACTED_STATE]");
  for (const tag of zipTags) result = redactTagValues(result, tag, "[REDACTED_ZIP]");

  return result;
};
