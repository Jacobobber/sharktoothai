import type { Intent } from "./intentClassifier";

export type RetrievalStrategy =
  | "DIRECT_LOOKUP"
  | "HYBRID_SEARCH"
  | "BROAD_VECTOR_SEARCH"
  | "NONE";

export const determineRetrievalStrategy = (
  intent: Intent,
  confidence: number
): RetrievalStrategy => {
  const deterministicIntents = new Set(["lookup", "cost_analysis", "frequency_analysis"]);
  if (deterministicIntents.has(intent) && confidence >= 0.6) return "DIRECT_LOOKUP";
  if (confidence >= 0.6) return "HYBRID_SEARCH";
  return "BROAD_VECTOR_SEARCH";
};

export const shouldBypassRetrieval = (intent: Intent): boolean => {
  return intent === "provenance_query";
};

export const applyDirectLookupFallback = (
  strategy: RetrievalStrategy,
  directMatchesCount: number
): { strategy: RetrievalStrategy; fallbackTriggered: boolean } => {
  if (strategy === "DIRECT_LOOKUP" && directMatchesCount === 0) {
    return { strategy: "HYBRID_SEARCH", fallbackTriggered: true };
  }
  return { strategy, fallbackTriggered: false };
};
