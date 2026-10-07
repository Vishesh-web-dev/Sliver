import { z } from 'zod';
import { DEFAULT_DIFFICULTY_POINTS, DIFFICULTIES } from './difficulty.js';
import { sanitizeLine, sanitizeMultiline } from './text.js';

/**
 * Validation for everything a client can send. The server parses every request
 * body with these schemas; the web client reuses them for form validation so
 * both sides agree on limits and messages.
 */

export const LIMITS = {
  displayName: 20,
  gameName: 60,
  setName: 80,
  setDescription: 280,
  prompt: 500,
  option: 140,
  optionsMin: 2,
  optionsMax: 6,
  acceptedAnswersMax: 10,
  acceptedAnswer: 100,
  explanation: 600,
  questionsPerSet: 100,
  answerText: 200,
  pointsMax: 10_000,
} as const;

/** Server-side bounds. The UI keeps the question timer fixed at 30s for now. */
export const TIMING = {
  questionDurationSec: { min: 10, max: 120, default: 30 },
  resultsDurationSec: { min: 3, max: 30, default: 8 },
  startCountdownSec: 3,
} as const;

const line = (label: string, max: number) =>
  z
    .string({ error: `${label} is required` })
    .transform(sanitizeLine)
    .pipe(
      z
        .string()
        .min(1, `${label} is required`)
        .max(max, `${label} must be at most ${max} characters`),
    );

const multiline = (label: string, max: number) =>
  z
    .string({ error: `${label} is required` })
    .transform(sanitizeMultiline)
    .pipe(
      z
        .string()
        .min(1, `${label} is required`)
        .max(max, `${label} must be at most ${max} characters`),
    );

const optionalMultiline = (label: string, max: number) =>
  z
    .string()
    .nullish()
    .transform((v) => (v == null ? null : sanitizeMultiline(v) || null))
    .pipe(z.string().max(max, `${label} must be at most ${max} characters`).nullable());

// ── Names ────────────────────────────────────────────────────────────────────

export const displayNameSchema = line('Name', LIMITS.displayName).pipe(
  z.string().regex(/^[\p{L}\p{N}\p{M} ._'’-]+$/u, 'Use letters, numbers, spaces and . _ \' - only'),
);

export const gameNameSchema = line('Game name', LIMITS.gameName);

// ── Scoring & game settings ──────────────────────────────────────────────────

const pointsValue = z
  .number({ error: 'Points must be a number' })
  .int('Points must be a whole number')
  .min(0, 'Points cannot be negative')
  .max(LIMITS.pointsMax, `Points must be at most ${LIMITS.pointsMax}`);

export const difficultySchema = z.literal(DIFFICULTIES, { error: 'Pick a difficulty level' });

export const difficultyPointsSchema = z.object({
  '90': pointsValue,
  '80': pointsValue,
  '70': pointsValue,
  '60': pointsValue,
  '50': pointsValue,
  '40': pointsValue,
  '30': pointsValue,
  '20': pointsValue,
  '15': pointsValue,
  '10': pointsValue,
  '5': pointsValue,
  '1': pointsValue,
});

export const scoringSchema = z.object({
  difficultyPoints: difficultyPointsSchema,
  /** Optional rule: lose this % of the question's points for a wrong answer. Default 0. */
  wrongAnswerPenaltyPercent: z.number().int().min(0).max(100),
  /**
   * Reserved for a future speed bonus (basePoints + speedBonus = finalPoints).
   * The scoring engine already supports it; the MVP UI keeps it disabled.
   */
  speedBonus: z.object({
    enabled: z.boolean(),
    maxPoints: z.number().int().min(0).max(1000),
  }),
});

export const gameSettingsSchema = z.object({
  /** How many questions to play from the set, in order. null = all of them. */
  questionCount: z.number().int().min(1).max(LIMITS.questionsPerSet).nullable(),
  questionDurationSec: z
    .number()
    .int()
    .min(TIMING.questionDurationSec.min)
    .max(TIMING.questionDurationSec.max),
  resultsDurationSec: z
    .number()
    .int()
    .min(TIMING.resultsDurationSec.min)
    .max(TIMING.resultsDurationSec.max),
  showExplanations: z.boolean(),
  showLeaderboardAfterEachQuestion: z.boolean(),
  scoring: scoringSchema,
});

export type ScoringSettings = z.infer<typeof scoringSchema>;
export type GameSettings = z.infer<typeof gameSettingsSchema>;

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  questionCount: null,
  questionDurationSec: TIMING.questionDurationSec.default,
  resultsDurationSec: TIMING.resultsDurationSec.default,
  showExplanations: true,
  showLeaderboardAfterEachQuestion: true,
  scoring: {
    difficultyPoints: { ...DEFAULT_DIFFICULTY_POINTS },
    wrongAnswerPenaltyPercent: 0,
    speedBonus: { enabled: false, maxPoints: 0 },
  },
};

// ── Questions ────────────────────────────────────────────────────────────────

const questionBase = {
  id: z.uuid().optional(),
  difficulty: difficultySchema,
  prompt: multiline('Question text', LIMITS.prompt),
  explanation: optionalMultiline('Explanation', LIMITS.explanation),
  /** null = use the game's points table for this difficulty. */
  points: pointsValue.nullish().transform((v) => v ?? null),
};

export const mcqQuestionInputSchema = z
  .object({
    ...questionBase,
    type: z.literal('MCQ'),
    options: z
      .array(line('Option', LIMITS.option))
      .min(LIMITS.optionsMin, `Add at least ${LIMITS.optionsMin} options`)
      .max(LIMITS.optionsMax, `At most ${LIMITS.optionsMax} options`),
    correctOption: z.number({ error: 'Mark the correct option' }).int().min(0),
  })
  .superRefine((q, ctx) => {
    if (q.correctOption >= q.options.length) {
      ctx.addIssue({ code: 'custom', path: ['correctOption'], message: 'Mark the correct option' });
    }
    const seen = new Set<string>();
    q.options.forEach((option, i) => {
      const key = option.toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({ code: 'custom', path: ['options', i], message: 'Options must be different' });
      }
      seen.add(key);
    });
  });

export const shortQuestionInputSchema = z.object({
  ...questionBase,
  type: z.literal('SHORT'),
  acceptedAnswers: z
    .array(line('Accepted answer', LIMITS.acceptedAnswer))
    .min(1, 'Add at least one accepted answer')
    .max(LIMITS.acceptedAnswersMax, `At most ${LIMITS.acceptedAnswersMax} accepted answers`),
  caseSensitive: z.boolean().default(false),
});

export const questionInputSchema = z.discriminatedUnion('type', [
  mcqQuestionInputSchema,
  shortQuestionInputSchema,
]);

export type QuestionInput = z.infer<typeof questionInputSchema>;
export type QuestionInputRaw = z.input<typeof questionInputSchema>;

export const questionSetInputSchema = z.object({
  name: line('Set name', LIMITS.setName),
  description: optionalMultiline('Description', LIMITS.setDescription),
  questions: z
    .array(questionInputSchema)
    .max(LIMITS.questionsPerSet, `A set can hold at most ${LIMITS.questionsPerSet} questions`),
});

export type QuestionSetInput = z.infer<typeof questionSetInputSchema>;

// ── Rooms & answers ──────────────────────────────────────────────────────────

export const createRoomSchema = z.object({
  gameName: gameNameSchema,
  displayName: displayNameSchema,
  questionSetId: z.uuid().nullable(),
  settings: gameSettingsSchema,
});

export const joinRoomSchema = z.object({
  displayName: displayNameSchema,
});

export const updateRoomSchema = z
  .object({
    gameName: gameNameSchema.optional(),
    questionSetId: z.uuid().nullable().optional(),
    settings: gameSettingsSchema.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to update');

export const transferHostSchema = z.object({ playerId: z.uuid() });

export const answerPayloadSchema = z.union([
  z.object({ optionIndex: z.number().int().min(0).max(LIMITS.optionsMax - 1) }).strict(),
  z.object({ text: line('Answer', LIMITS.answerText) }).strict(),
]);

export const submitAnswerSchema = z.object({
  questionId: z.uuid(),
  answer: answerPayloadSchema,
});

export type CreateRoomRequest = z.input<typeof createRoomSchema>;
export type JoinRoomRequest = z.input<typeof joinRoomSchema>;
export type UpdateRoomRequest = z.input<typeof updateRoomSchema>;
export type AnswerPayload = z.infer<typeof answerPayloadSchema>;
export type SubmitAnswerRequest = z.input<typeof submitAnswerSchema>;

/** First human-readable message from a Zod error, for toasts and 400 bodies. */
export function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid input';
  return issue.message;
}
