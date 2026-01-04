import { AppError } from "../../../../../shared/utils/errors";
import { loadEnv } from "../../../../../platform/gateway/src/config/env";

const env = loadEnv();

const baseEndpointRaw = env.azureOpenAiChatEndpoint || env.azureOpenAiEndpoint;
const baseEndpoint = baseEndpointRaw.includes("/openai/deployments/")
  ? baseEndpointRaw.split("/openai/deployments/")[0]
  : baseEndpointRaw;

const chatApiVersion = env.azureOpenAiChatApiVersion ?? env.azureOpenAiApiVersion;

const chatEndpoint = env.azureOpenAiChatDeployment
  ? `${baseEndpoint}/openai/deployments/${env.azureOpenAiChatDeployment}/chat/completions?api-version=${chatApiVersion}`
  : "";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const isLlmEnabled = (): boolean => {
  return Boolean(env.ragLlmEnabled && env.azureOpenAiChatDeployment);
};

export const generateChatAnswer = async (prompt: string): Promise<string> => {
  if (!isLlmEnabled()) {
    throw new AppError("LLM disabled", { status: 501, code: "LLM_DISABLED" });
  }

  const body: {
    messages: Array<{ role: string; content: string }>;
    temperature?: number;
    max_completion_tokens: number;
  } = {
    messages: [
      {
        role: "system",
        content:
          "You are a reference-only assistant for repair orders. Use only the supplied excerpts. Cite every sentence."
      },
      { role: "user", content: prompt }
    ],
    max_completion_tokens: env.ragLlmMaxTokens
  };
  if (env.ragLlmTemperature === 1) {
    body.temperature = env.ragLlmTemperature;
  }

  const headers = {
    "Content-Type": "application/json",
    "api-key": env.azureOpenAiChatApiKey || env.azureOpenAiApiKey
  };

  let attempt = 0;
  const maxAttempts = 2;
  while (attempt < maxAttempts) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const response = await fetch(chatEndpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        const detail = text ? ` - ${text.slice(0, 200)}` : "";
        throw new AppError(
          `Chat completion unavailable: ${response.status} ${response.statusText}${detail}`,
          { status: 503, code: "LLM_FAIL" }
        );
      }
      const data = (await response.json()) as any;
      const content = data?.choices?.[0]?.message?.content;
      if (!content || typeof content !== "string") {
        throw new AppError("Chat completion response malformed", { status: 502, code: "LLM_FAIL" });
      }
      return content.trim();
    } catch (err) {
      attempt += 1;
      if (attempt >= maxAttempts) {
        if (err instanceof AppError) throw err;
        throw new AppError("Chat completion unavailable", { status: 503, code: "LLM_FAIL" });
      }
      await sleep(200 * attempt);
    }
  }

  throw new AppError("Chat completion unavailable", { status: 503, code: "LLM_FAIL" });
};
