import { xmlToText } from "./xmlToText";

export type AnswerContext = {
  answerId: string;
  intent: string;
  tone: string;
  retrievalStrategy: string;
  citedROs: Array<{ roNumber: string; evidence: string[] }>;
  createdAt: string;
};

export class AnswerContextStore {
  private store = new Map<string, { context: AnswerContext; expiresAt: number }>();
  private ttlMs: number;

  constructor(ttlMs: number = 30 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  setLastAnswerContext(key: string, context: AnswerContext) {
    const expiresAt = Date.now() + this.ttlMs;
    this.store.set(key, { context, expiresAt });
  }

  getLastAnswerContext(key: string): AnswerContext | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.context;
  }

  clearOnNewConversation(key: string) {
    this.store.delete(key);
  }
}

export const buildAnswerContext = (input: {
  answerId: string;
  intent: string;
  tone: string;
  retrievalStrategy: string;
  createdAt: string;
  matches: Array<{
    ro_number: string | null;
    citations: Array<{ excerpt: string }>;
  }>;
}): AnswerContext => {
  const roMap = new Map<string, Set<string>>();
  input.matches.forEach((match) => {
    if (!match.ro_number) return;
    const existing = roMap.get(match.ro_number) ?? new Set<string>();
    match.citations.forEach((citation) => {
      if (citation.excerpt) existing.add(citation.excerpt);
    });
    roMap.set(match.ro_number, existing);
  });

  const citedROs = Array.from(roMap.entries()).map(([roNumber, evidenceSet]) => ({
    roNumber,
    evidence: Array.from(evidenceSet)
  }));

  return {
    answerId: input.answerId,
    intent: input.intent,
    tone: input.tone,
    retrievalStrategy: input.retrievalStrategy,
    citedROs,
    createdAt: input.createdAt
  };
};

const normalizeEvidence = (value: string): string => {
  const cleaned = xmlToText(value).replace(/\s+/g, " ").trim();
  if (cleaned.length <= 180) return cleaned;
  return `${cleaned.slice(0, 177)}...`;
};

export const buildProvenanceAnswer = (context: AnswerContext): string => {
  if (!context.citedROs.length) {
    return "The previous answer did not include any cited repair orders.";
  }
  const lines: string[] = [];
  lines.push("The previous answer was based on these repair orders:");
  context.citedROs.forEach((ro) => {
    lines.push(`- ${ro.roNumber}`);
    const evidenceItems = ro.evidence
      .map((evidence) => normalizeEvidence(evidence))
      .filter(Boolean)
      .slice(0, 3);
    evidenceItems.forEach((evidence) => {
      lines.push(`  - ${evidence}`);
    });
  });
  return lines.join("\n");
};

export const answerContextStore = new AnswerContextStore();
