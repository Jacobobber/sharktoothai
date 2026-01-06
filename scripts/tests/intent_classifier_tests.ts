import assert from "assert";

const setBaseEnv = () => {
  process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
  process.env.PORT = "3000";
  process.env.RATE_LIMIT_WINDOW_SEC = "60";
  process.env.RATE_LIMIT_MAX = "100";
  process.env.MAX_UPLOAD_BYTES = "1000000";
  process.env.AZURE_OPENAI_ENDPOINT = "https://example.openai.azure.com";
  process.env.AZURE_OPENAI_API_KEY = "test-key";
  process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT = "embed";
  process.env.AZURE_OPENAI_API_VERSION = "2024-12-01-preview";
  process.env.AZURE_OPENAI_CHAT_DEPLOYMENT = "chat";
  process.env.AZURE_OPENAI_CHAT_API_VERSION = "2024-12-01-preview";
  process.env.JWT_SECRET = "secret";
  process.env.JWT_EXPIRES_IN = "1h";
  process.env.DEV_AUTH_TOKEN_ADMIN = "token";
  process.env.DEV_USER_ID_ADMIN = "00000000-0000-0000-0000-000000000001";
  process.env.DEV_TENANT_ID_ADMIN = "00000000-0000-0000-0000-000000000010";
};

const run = async () => {
  setBaseEnv();
  const { redactPII } = await import(
    "../../workloads/ro-assistant/src/services/retrieval/redactPii"
  );
  const { classifyIntent } = await import(
    "../../workloads/ro-assistant/src/services/retrieval/intentClassifier"
  );

  const redacted = redactPII(
    "Email john@example.com, phone +1 (555) 222-3333, VIN 1HGCM82633A004352, name Jane."
  );
  assert.ok(redacted.includes("<EMAIL>"));
  assert.ok(redacted.includes("<PHONE>"));
  assert.ok(redacted.includes("<VIN>"));
  assert.ok(redacted.includes("<PERSON>"));

  const rulesCost = await classifyIntent("How much did the repair cost?");
  assert.strictEqual(rulesCost.intent, "cost_analysis");
  assert.strictEqual(rulesCost.source, "rules");

  const provenance = await classifyIntent("Where did you get that information?");
  assert.strictEqual(provenance.intent, "provenance_query");
  assert.strictEqual(provenance.source, "rules");

  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "{\"intent\":\"lookup\",\"confidence\":0.72}" } }]
      })
    } as any;
  }) as any;

  const llmResult = await classifyIntent("Show details about the record");
  assert.strictEqual(llmResult.intent, "lookup");
  assert.strictEqual(llmResult.source, "llm");
  assert.ok(llmResult.confidence >= 0.6);

  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "{\"intent\":\"bad\",\"confidence\":0.9}" } }]
      })
    } as any;
  }) as any;

  const badSchema = await classifyIntent("Show details about the record");
  assert.strictEqual(badSchema.intent, "unknown");
  assert.strictEqual(badSchema.source, "fallback");

  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return { ok: false, status: 500, statusText: "Error" } as any;
  }) as any;

  const failure = await classifyIntent("Show details about the record");
  assert.strictEqual(failure.intent, "unknown");
  assert.strictEqual(failure.source, "fallback");

  globalThis.fetch = originalFetch;
  assert.ok(fetchCalls >= 2);
};

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
