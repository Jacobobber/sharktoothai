import { xmlToText } from "./xmlToText";
import { generateChatAnswer, isLlmEnabled } from "./llm";

type Citation = {
  chunk_id: string;
  excerpt: string;
};

type AnswerInput = {
  question: string;
  matches: Array<{
    ro_number: string | null;
    score: number;
    citations: Citation[];
  }>;
};

type NormalizedCitation = Citation & { clean_excerpt: string };

type NormalizedInput = {
  question: string;
  matches: Array<{
    ro_number: string | null;
    score: number;
    citations: NormalizedCitation[];
  }>;
};

const normalizeInput = (input: AnswerInput): NormalizedInput => {
  return {
    ...input,
    matches: input.matches.map((match) => ({
      ...match,
      citations: match.citations.map((citation) => ({
        ...citation,
        clean_excerpt: xmlToText(citation.excerpt)
      }))
    }))
  };
};

const promptTemplate = (input: NormalizedInput) => {
  const lines = [
    "You are a reference-only assistant for repair orders.",
    "Summarize what the prior ROs contain that relates to the question.",
    "Do not make recommendations. Do not speculate.",
    "Every sentence must cite the chunk_id(s) it is based on.",
    "If there is insufficient data, respond with: No relevant records found.",
    "",
    `Question: ${input.question}`,
    "",
    "Context (redacted excerpts):"
  ];

  input.matches.forEach((m, idx) => {
    lines.push(`RO ${m.ro_number ?? "unknown"} (score ${m.score.toFixed(3)}):`);
    m.citations.forEach((c) => {
      lines.push(`- [${c.chunk_id}] ${c.clean_excerpt}`);
    });
    if (idx < input.matches.length - 1) lines.push("");
  });

  lines.push("");
  lines.push("Draft a concise answer using only the cited excerpts. Format each sentence with citations like [chunk_id].");

  return lines.join("\n");
};

const buildDeterministicAnswer = (input: NormalizedInput): string => {
  const sentences: string[] = [];
  input.matches.forEach((m) => {
    m.citations.forEach((c) => {
      sentences.push(`Prior RO notes: ${c.clean_excerpt} [${c.chunk_id}]`);
    });
  });
  return sentences.join(" ");
};

export const buildCitedAnswer = async (
  input: AnswerInput
): Promise<{ prompt: string; answer: string; used_llm: boolean }> => {
  const normalized = normalizeInput(input);
  // No actual LLM call; return a deterministic, reference-only summary.
  if (!normalized.matches.length) {
    return {
      prompt: promptTemplate(normalized),
      answer: "No relevant records found.",
      used_llm: false
    };
  }

  const prompt = promptTemplate(normalized);
  if (isLlmEnabled()) {
    const answer = await generateChatAnswer(prompt);
    return { prompt, answer, used_llm: true };
  }

  return {
    prompt,
    answer: buildDeterministicAnswer(normalized),
    used_llm: false
  };
};
