import { AppError } from "../../../../../shared/utils/errors";
import { loadEnv } from "../../../../../platform/gateway/src/config/env";
import { redactPII } from "./redactPii";

export type Intent =
  | "lookup"
  | "procedure_summary"
  | "cost_analysis"
  | "frequency_analysis"
  | "trend_analysis"
  | "comparison"
  | "provenance_query"
  | "unknown";

export type IntentResult = {
  intent: Intent;
  confidence: number;
  source: "rules" | "llm" | "fallback";
};

const intentList: Intent[] = [
  "lookup",
  "procedure_summary",
  "cost_analysis",
  "frequency_analysis",
  "trend_analysis",
  "comparison",
  "provenance_query",
  "unknown"
];

const confidenceThreshold = 0.6;

const rulesClassify = (input: string): IntentResult | null => {
  const text = input.toLowerCase();

  if (
    /where did you get|source|which ro|how do you know|based on what/.test(text)
  ) {
    return { intent: "provenance_query", confidence: 1, source: "rules" };
  }

  if (
    /how\s+much|cost|price|total|labor|parts|estimate|most\s+expensive|cheapest/.test(text)
  ) {
    return { intent: "cost_analysis", confidence: 0.9, source: "rules" };
  }

  if (/how\s+many|count|number\s+of|frequency/.test(text)) {
    return { intent: "frequency_analysis", confidence: 0.85, source: "rules" };
  }

  if (/trend|over\s+time|by\s+month|by\s+week|increase|decrease|rising|declining/.test(text)) {
    return { intent: "trend_analysis", confidence: 0.8, source: "rules" };
  }

  if (/compare|versus|vs\.?|difference\s+between|which\s+is\s+higher/.test(text)) {
    return { intent: "comparison", confidence: 0.8, source: "rules" };
  }

  if (/what\s+was\s+done|work\s+performed|procedure|repair\s+summary|summary\s+of\s+work/.test(text)) {
    return { intent: "procedure_summary", confidence: 0.8, source: "rules" };
  }

  if (/ro[-\s]?\d{3,6}|repair\s+order|ro\s+number|vin|customer|last\s+name|email|phone/.test(text)) {
    return { intent: "lookup", confidence: 0.8, source: "rules" };
  }

  return null;
};

const parseLlmResult = (text: string): { intent: Intent; confidence: number } | null => {
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  if (typeof parsed.intent !== "string" || typeof parsed.confidence !== "number") return null;
  if (!intentList.includes(parsed.intent as Intent)) return null;
  if (Number.isNaN(parsed.confidence)) return null;
  const confidence = Math.max(0, Math.min(1, parsed.confidence));
  return { intent: parsed.intent as Intent, confidence };
};

const classifyWithLlm = async (input: string): Promise<IntentResult> => {
  let env;
  try {
    env = loadEnv();
  } catch {
    return { intent: "unknown", confidence: 0, source: "fallback" };
  }

  if (!env.azureOpenAiChatDeployment) {
    return { intent: "unknown", confidence: 0, source: "fallback" };
  }

  const baseEndpointRaw = env.azureOpenAiChatEndpoint || env.azureOpenAiEndpoint;
  const baseEndpoint = baseEndpointRaw.includes("/openai/deployments/")
    ? baseEndpointRaw.split("/openai/deployments/")[0]
    : baseEndpointRaw;
  const chatApiVersion = env.azureOpenAiChatApiVersion ?? env.azureOpenAiApiVersion;
  const chatEndpoint = `${baseEndpoint}/openai/deployments/${env.azureOpenAiChatDeployment}/chat/completions?api-version=${chatApiVersion}`;

  const body = {
    messages: [
      {
        role: "system",
        content:
          "You are an intent classifier. Return a single JSON object with keys intent and confidence. Allowed intents: lookup, procedure_summary, cost_analysis, frequency_analysis, trend_analysis, comparison, provenance_query, unknown. Confidence is a number between 0 and 1. Do not include explanations."
      },
      { role: "user", content: input }
    ],
    max_completion_tokens: 50
  };

  const headers = {
    "Content-Type": "application/json",
    "api-key": env.azureOpenAiChatApiKey || env.azureOpenAiApiKey
  };

  const response = await fetch(chatEndpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new AppError("Intent classification failed", { status: 503, code: "INTENT_LLM_FAIL" });
  }
  const data = (await response.json()) as any;
  const content = data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new AppError("Intent classification failed", { status: 503, code: "INTENT_LLM_FAIL" });
  }
  const parsed = parseLlmResult(content.trim());
  if (!parsed || parsed.confidence < confidenceThreshold) {
    return { intent: "unknown", confidence: 0, source: "fallback" };
  }
  return { intent: parsed.intent, confidence: parsed.confidence, source: "llm" };
};

export const classifyIntent = async (query: string): Promise<IntentResult> => {
  const redacted = redactPII(query);
  const rules = rulesClassify(redacted);
  if (rules) return rules;

  try {
    return await classifyWithLlm(redacted);
  } catch {
    return { intent: "unknown", confidence: 0, source: "fallback" };
  }
};
