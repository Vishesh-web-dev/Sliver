import { isShortAnswerCorrect, type ScoringSettings } from '@sliver/shared';

/**
 * Pure scoring rules. Runs only on the server, once per answer, inside the
 * transaction that closes a question.
 *
 *   finalPoints = basePoints + speedBonus      (correct)
 *   finalPoints = -penalty                      (wrong; penalty is 0 by default)
 *   finalPoints = 0                             (no answer — never reaches here)
 */

export interface ScorableQuestion {
  type: 'MCQ' | 'SHORT';
  correctOption: number | null;
  acceptedAnswers: readonly string[];
  caseSensitive: boolean;
  points: number;
}

export interface ScorableAnswer {
  optionIndex: number | null;
  textAnswer: string | null;
  submittedAt: Date;
}

export interface AnswerWindow {
  startedAt: Date;
  endsAt: Date;
}

export interface ScoreResult {
  isCorrect: boolean;
  basePoints: number;
  speedBonus: number;
  penalty: number;
  points: number;
}

export function isAnswerCorrect(question: ScorableQuestion, answer: ScorableAnswer): boolean {
  if (question.type === 'MCQ') {
    return answer.optionIndex !== null && answer.optionIndex === question.correctOption;
  }
  return (
    answer.textAnswer !== null &&
    isShortAnswerCorrect(answer.textAnswer, question.acceptedAnswers, {
      caseSensitive: question.caseSensitive,
    })
  );
}

/** Share of the window still left when the answer arrived, clamped to 0..1. */
export function remainingFraction(window: AnswerWindow, submittedAt: Date): number {
  const total = window.endsAt.getTime() - window.startedAt.getTime();
  if (total <= 0) return 0;
  const left = window.endsAt.getTime() - submittedAt.getTime();
  return Math.min(1, Math.max(0, left / total));
}

export function scoreAnswer(
  question: ScorableQuestion,
  answer: ScorableAnswer,
  window: AnswerWindow,
  scoring: ScoringSettings,
): ScoreResult {
  const isCorrect = isAnswerCorrect(question, answer);
  if (isCorrect) {
    const speedBonus = scoring.speedBonus.enabled
      ? Math.round(scoring.speedBonus.maxPoints * remainingFraction(window, answer.submittedAt))
      : 0;
    return {
      isCorrect,
      basePoints: question.points,
      speedBonus,
      penalty: 0,
      points: question.points + speedBonus,
    };
  }
  const penalty = Math.round((question.points * scoring.wrongAnswerPenaltyPercent) / 100);
  // `0 - penalty` rather than `-penalty`: no penalty must be 0, not -0.
  return { isCorrect, basePoints: 0, speedBonus: 0, penalty, points: 0 - penalty };
}
