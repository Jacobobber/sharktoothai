const replaceAll = (input: string, pattern: RegExp, token: string): string => {
  return input.replace(pattern, token);
};

export const redactPII = (input: string): string => {
  let output = input;

  output = replaceAll(
    output,
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
    "<EMAIL>"
  );
  output = replaceAll(
    output,
    /(\+?\d[\d\s().-]{8,}\d)/g,
    "<PHONE>"
  );
  output = replaceAll(
    output,
    /\b[0-9A-HJ-NPR-Z]{17}\b/gi,
    "<VIN>"
  );
  output = output.replace(/\b(last\s+name|name)\s+[a-zA-Z'-]{2,}\b/gi, (match) =>
    match.replace(/\b[a-zA-Z'-]{2,}\b/, "<PERSON>")
  );
  output = replaceAll(
    output,
    /\b(address|street|st\.|avenue|ave\.|road|rd\.)\s+[a-zA-Z0-9'\-\s]{3,}\b/gi,
    "<ADDRESS>"
  );

  return output;
};
