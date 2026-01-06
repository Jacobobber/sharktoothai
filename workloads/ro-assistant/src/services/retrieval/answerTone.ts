export enum AnswerTone {
  DEFINITIVE = "DEFINITIVE",
  QUALIFIED = "QUALIFIED",
  CAUTIOUS = "CAUTIOUS"
}

export const determineAnswerTone = (intentConfidence: number): AnswerTone => {
  if (intentConfidence >= 0.8) return AnswerTone.DEFINITIVE;
  if (intentConfidence >= 0.6) return AnswerTone.QUALIFIED;
  return AnswerTone.CAUTIOUS;
};
