import assert from "assert";
import {
  AnswerContextStore,
  buildAnswerContext,
  buildProvenanceAnswer
} from "../../workloads/ro-assistant/src/services/retrieval/answerContext";

const run = () => {
  const store = new AnswerContextStore(10);
  const key = "tenant:user:convo";

  const context = buildAnswerContext({
    answerId: "answer-1",
    intent: "lookup",
    tone: "DEFINITIVE",
    retrievalStrategy: "DIRECT_LOOKUP",
    createdAt: new Date(0).toISOString(),
    matches: [
      {
        ro_number: "RO-0001",
        citations: [{ excerpt: "Brake pads replaced" }, { excerpt: "Brake pads replaced" }]
      },
      {
        ro_number: "RO-0002",
        citations: [{ excerpt: "Oil change completed" }]
      }
    ]
  });

  store.setLastAnswerContext(key, context);
  const loaded = store.getLastAnswerContext(key);
  assert.ok(loaded);
  assert.strictEqual(loaded?.citedROs.length, 2);
  assert.strictEqual(loaded?.citedROs[0].evidence.length, 1);

  const provenance = buildProvenanceAnswer(context);
  assert.ok(provenance.includes("RO-0001"));
  assert.ok(provenance.includes("Brake pads replaced"));

  return new Promise<void>((resolve) => setTimeout(resolve, 15)).then(() => {
    const expired = store.getLastAnswerContext(key);
    assert.strictEqual(expired, null);
  });
};

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
