export interface Standing {
  playerId: string;
  name: string;
  score: number;
  correct: number;
  incorrect: number;
  unanswered: number;
}

export type RankedStanding<T extends Standing> = T & { rank: number; accuracy: number };

/** correct / questions faced; 0 when the player has not faced any question yet. */
export function accuracyOf(s: Pick<Standing, 'correct' | 'incorrect' | 'unanswered'>): number {
  const faced = s.correct + s.incorrect + s.unanswered;
  return faced === 0 ? 0 : s.correct / faced;
}

/**
 * Highest score first. Equal scores share a rank ("1, 1, 3" competition
 * ranking) so ties are never broken arbitrarily; within a tie, rows are
 * ordered by name only so the list is stable on screen.
 */
export function rankStandings<T extends Standing>(rows: readonly T[]): RankedStanding<T>[] {
  const sorted = [...rows].sort(
    (a, b) => b.score - a.score || a.name.localeCompare(b.name) || a.playerId.localeCompare(b.playerId),
  );
  let rank = 0;
  let previousScore: number | null = null;
  return sorted.map((row, i) => {
    if (row.score !== previousScore) {
      rank = i + 1;
      previousScore = row.score;
    }
    return { ...row, rank, accuracy: accuracyOf(row) };
  });
}

/** Everyone sharing first place. */
export function winnersOf<T extends Standing>(ranked: readonly RankedStanding<T>[]): string[] {
  return ranked.filter((r) => r.rank === 1).map((r) => r.playerId);
}
