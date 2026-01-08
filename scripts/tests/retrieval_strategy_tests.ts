import assert from "assert";
import {
  determineRetrievalStrategy,
  applyDirectLookupFallback,
  shouldBypassRetrieval
} from "../../workloads/ro-assistant/src/services/retrieval/retrievalStrategy";

const run = () => {
  assert.strictEqual(determineRetrievalStrategy("lookup", 0.9), "DIRECT_LOOKUP");
  assert.strictEqual(determineRetrievalStrategy("lookup", 0.7), "DIRECT_LOOKUP");
  assert.strictEqual(determineRetrievalStrategy("lookup", 0.2), "BROAD_VECTOR_SEARCH");
  assert.strictEqual(determineRetrievalStrategy("cost_analysis", 0.9), "DIRECT_LOOKUP");
  assert.strictEqual(determineRetrievalStrategy("frequency_analysis", 0.7), "DIRECT_LOOKUP");
  assert.strictEqual(determineRetrievalStrategy("unknown", 0.2), "BROAD_VECTOR_SEARCH");
  assert.strictEqual(determineRetrievalStrategy("procedure_summary", 0.7), "HYBRID_SEARCH");

  const fallback = applyDirectLookupFallback("DIRECT_LOOKUP", 0);
  assert.strictEqual(fallback.strategy, "HYBRID_SEARCH");
  assert.strictEqual(fallback.fallbackTriggered, true);

  const noFallback = applyDirectLookupFallback("DIRECT_LOOKUP", 2);
  assert.strictEqual(noFallback.strategy, "DIRECT_LOOKUP");
  assert.strictEqual(noFallback.fallbackTriggered, false);

  assert.strictEqual(shouldBypassRetrieval("provenance_query"), true);
  assert.strictEqual(shouldBypassRetrieval("lookup"), false);
};

run();
