type CachedToken = {
  token: string;
  expiresAtMs: number;
};

const ARM_RESOURCE = "https://management.azure.com/";
const IMDS_ENDPOINT = "http://169.254.169.254/metadata/identity/oauth2/token";
const IMDS_API_VERSION = "2018-02-01";
const REFRESH_WINDOW_MS = 2 * 60 * 1000;

let cachedToken: CachedToken | null = null;

export const getArmAccessToken = async (): Promise<string> => {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAtMs - REFRESH_WINDOW_MS > now) {
    return cachedToken.token;
  }

  const resource = encodeURIComponent(ARM_RESOURCE);
  const url = `${IMDS_ENDPOINT}?api-version=${IMDS_API_VERSION}&resource=${resource}`;
  const response = await fetch(url, {
    headers: { Metadata: "true" }
  });
  if (!response.ok) {
    throw new Error(`Managed identity token fetch failed: ${response.status}`);
  }
  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: string;
    expires_on?: string;
  };
  if (!data.access_token) {
    throw new Error("Managed identity token missing access_token");
  }
  const expiresInSec = data.expires_in ? Number(data.expires_in) : NaN;
  const expiresAtMs = Number.isFinite(expiresInSec)
    ? now + expiresInSec * 1000
    : data.expires_on
      ? Number(data.expires_on) * 1000
      : now + 30 * 60 * 1000;

  cachedToken = { token: data.access_token, expiresAtMs };
  return data.access_token;
};
