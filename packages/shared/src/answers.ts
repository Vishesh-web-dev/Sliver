/**
 * Short-answer matching. The server is the only authority on correctness; this
 * lives in the shared package so the question editor can offer an
 * "is this answer accepted?" tester that behaves exactly like the server.
 *
 * Rules, applied to the player's answer and every accepted answer:
 *  1. Unicode-normalise and strip accents        "Café"        → "cafe"
 *  2. Lower-case unless the question is case-sensitive
 *  3. Punctuation becomes whitespace; whitespace collapses and is trimmed
 *  4. Two answers match when they are equal, equal with all spaces removed
 *     ("thirty-two" = "thirty two" = "thirtytwo"), or both are numbers with the
 *     same value ("7.5" = "7.50", "1,000" = "1000").
 */

export interface MatchOptions {
  caseSensitive: boolean;
}

export function normalizeAnswer(input: string, { caseSensitive }: MatchOptions): string {
  let s = input.normalize('NFKD').replace(/\p{M}+/gu, '');
  if (!caseSensitive) s = s.toLowerCase();
  return s
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parses a plain number such as "32", "-4", "7.50", "1,000" or "45°"; otherwise null. */
export function parseNumericAnswer(input: string): number | null {
  const s = input
    .trim()
    .replace(/[°%]$/u, '')
    .replace(/(?<=\d)[,_ ](?=\d{3}\b)/g, '');
  if (!/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function isShortAnswerCorrect(
  answer: string,
  acceptedAnswers: readonly string[],
  options: MatchOptions,
): boolean {
  const given = normalizeAnswer(answer, options);
  if (given.length === 0) return false;
  const givenCompact = given.replace(/ /g, '');
  const givenNumber = parseNumericAnswer(answer);

  return acceptedAnswers.some((accepted) => {
    const expected = normalizeAnswer(accepted, options);
    if (expected.length === 0) return false;
    if (given === expected) return true;
    if (givenCompact === expected.replace(/ /g, '')) return true;
    const expectedNumber = parseNumericAnswer(accepted);
    return givenNumber !== null && expectedNumber !== null && givenNumber === expectedNumber;
  });
}
