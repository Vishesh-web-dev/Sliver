/**
 * Difficulty is expressed as a conceptual "percentile": the share of people who
 * would be expected to get the question right. 90% is easy, 1% is brutal.
 * It is a label chosen by the question author, not a live survey.
 */
export const DIFFICULTIES = [90, 80, 70, 60, 50, 40, 30, 20, 15, 10, 5, 1] as const;

export type Difficulty = (typeof DIFFICULTIES)[number];

/** JSON object keys are strings, so points tables are keyed by the string form. */
export type DifficultyKey = `${Difficulty}`;

export type DifficultyPoints = Record<DifficultyKey, number>;

export const DEFAULT_DIFFICULTY_POINTS: DifficultyPoints = {
  '90': 10,
  '80': 15,
  '70': 20,
  '60': 25,
  '50': 30,
  '40': 35,
  '30': 40,
  '20': 50,
  '15': 60,
  '10': 75,
  '5': 100,
  '1': 150,
};

export function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === 'number' && (DIFFICULTIES as readonly number[]).includes(value);
}

export function difficultyKey(difficulty: Difficulty): DifficultyKey {
  return String(difficulty) as DifficultyKey;
}

/**
 * Points a question is worth: an explicit per-question override wins,
 * otherwise the game's difficulty table decides.
 */
export function resolveQuestionPoints(
  override: number | null | undefined,
  difficulty: Difficulty,
  table: DifficultyPoints,
): number {
  if (typeof override === 'number' && Number.isFinite(override)) return override;
  return table[difficultyKey(difficulty)];
}
