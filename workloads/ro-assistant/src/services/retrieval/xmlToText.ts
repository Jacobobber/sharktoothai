const decodeEntities = (input: string): string => {
  return input
    .split("&lt;")
    .join("<")
    .split("&gt;")
    .join(">")
    .split("&amp;")
    .join("&")
    .split("&quot;")
    .join("\"")
    .split("&#39;")
    .join("'");
};

export const xmlToText = (xml: string): string => {
  let result = "";
  let inTag = false;

  for (let i = 0; i < xml.length; i += 1) {
    const ch = xml[i];
    if (ch === "<") {
      inTag = true;
      if (result && !result.endsWith(" ")) result += " ";
      continue;
    }
    if (ch === ">") {
      inTag = false;
      if (result && !result.endsWith(" ")) result += " ";
      continue;
    }
    if (!inTag) {
      result += ch;
    }
  }

  const decoded = decodeEntities(result);
  return decoded.replace(/\s+/g, " ").trim();
};
