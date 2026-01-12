const SSH_KEY_REGEX =
  /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521))\s+([A-Za-z0-9+/=]+)(\s+.+)?$/;

export const normalizeSshPublicKey = (value: string): string => value.trim().replace(/\s+/g, " ");

export const isValidSshPublicKey = (value: string): boolean => {
  if (!value) return false;
  const normalized = normalizeSshPublicKey(value);
  const match = normalized.match(SSH_KEY_REGEX);
  if (!match) return false;
  const body = match[4];
  if (!body || body.length < 32) return false;
  try {
    const decoded = Buffer.from(body, "base64");
    return decoded.length > 16;
  } catch {
    return false;
  }
};
