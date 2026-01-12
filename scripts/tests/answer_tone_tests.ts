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
  const { determineAnswerTone, AnswerTone } = await import(
    "../../workloads/ro-assistant/src/services/retrieval/answerTone"
  );
  const { buildCitedAnswer } = await import("../../workloads/ro-assistant/src/services/retrieval/cite");

  assert.strictEqual(determineAnswerTone(0.9), AnswerTone.DEFINITIVE);
  assert.strictEqual(determineAnswerTone(0.7), AnswerTone.QUALIFIED);
  assert.strictEqual(determineAnswerTone(0.2), AnswerTone.CAUTIOUS);

  const matches = [
    {
      ro_number: "RO-0001",
      score: 1,
      citations: [{ excerpt: "Brake pads replaced" }]
    }
  ];

  const definite = await buildCitedAnswer(
    { question: "What happened?", matches },
    AnswerTone.DEFINITIVE
  );
  assert.ok(definite.answer.startsWith("Summary: The relevant repair order details"));

  const qualified = await buildCitedAnswer(
    { question: "What happened?", matches },
    AnswerTone.QUALIFIED
  );
  assert.ok(qualified.answer.startsWith("Summary: Based on the available repair orders"));

  const cautious = await buildCitedAnswer(
    { question: "What happened?", matches },
    AnswerTone.CAUTIOUS
  );
  assert.ok(cautious.answer.startsWith("Summary: From the repair orders reviewed"));
};

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
