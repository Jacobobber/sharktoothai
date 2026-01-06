import { xmlToText } from "./xmlToText";
import { generateChatAnswer, isLlmEnabled } from "./llm";
import { AnswerTone } from "./answerTone";

type Citation = {
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
    "You are a helpful assistant for repair orders.",
    "Summarize what the prior ROs contain that relates to the question.",
    "Use the excerpts as your primary source.",
    "If you infer beyond the excerpts, label it clearly as an estimate or likely scenario.",
    "Do not invent facts that contradict the excerpts.",
    "Use this response format:",
    "Summary: <one sentence>",
    "Findings:",
    "- <bullet per RO, include RO number when available>",
    "Notes: <optional, keep brief>",
    "If there is insufficient data, respond with: No relevant records found.",
    "",
    `Question: ${input.question}`,
    "",
    "Context (redacted excerpts):"
  ];

  input.matches.forEach((m, idx) => {
    lines.push(`RO ${m.ro_number ?? "unknown"} (score ${m.score.toFixed(3)}):`);
    m.citations.forEach((c) => {
      lines.push(`- ${c.clean_excerpt}`);
    });
    if (idx < input.matches.length - 1) lines.push("");
  });

  lines.push("");
  lines.push("Draft a concise answer using only the excerpts.");

  return lines.join("\n");
};

const trimSentence = (value: string): string => {
  return value.trim().replace(/[.]+$/, "");
};

const buildSummaryLine = (tone: AnswerTone, summary: string): string => {
  if (tone === AnswerTone.DEFINITIVE) {
    return `Summary: ${trimSentence(summary)}.`;
  }
  if (tone === AnswerTone.QUALIFIED) {
    return `Summary: Based on the available repair orders, ${trimSentence(summary)}.`;
  }
  return `Summary: From the repair orders reviewed, ${trimSentence(
    summary
  )}, though the data may be incomplete.`;
};

const applyToneToSummaryLine = (answer: string, tone: AnswerTone): string => {
  if (tone === AnswerTone.DEFINITIVE) return answer;
  const lines = answer.split("\n");
  if (!lines.length) return answer;
  const first = lines[0].trim();
  if (!first.toLowerCase().startsWith("summary:")) return answer;
  const summaryContent = first.slice("summary:".length).trim();
  const defaultSummary = summaryContent || "The relevant repair order details are summarized below";
  lines[0] = buildSummaryLine(tone, defaultSummary);
  return lines.join("\n");
};

const buildDeterministicAnswer = (input: NormalizedInput, tone: AnswerTone): string => {
  const defaultSummary = "The relevant repair order details are summarized below";
  const lines: string[] = [buildSummaryLine(tone, defaultSummary)];
  const sentences: string[] = [];
  input.matches.forEach((m) => {
    m.citations.forEach((c) => {
      sentences.push(`Prior RO notes: ${c.clean_excerpt}`);
    });
  });
  if (sentences.length) {
    lines.push(sentences.join(" "));
  }
  return lines.join("\n");
};

export const buildCitedAnswer = async (
  input: AnswerInput,
  tone: AnswerTone
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
    return { prompt, answer: applyToneToSummaryLine(answer, tone), used_llm: true };
  }

  return {
    prompt,
    answer: buildDeterministicAnswer(normalized, tone),
    used_llm: false
  };
};
