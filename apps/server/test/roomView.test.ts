import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_SETTINGS } from '@sliver/shared';
import type { AnswerRow, GameQuestionRow, GameRow, PlayerRow, RoomRow } from '../src/db/schema.js';
import { buildRoomState, type RoomSnapshot } from '../src/services/roomView.js';

/**
 * Anti-cheat (spec §21): what a browser receives must never contain the
 * answer key or other players' choices while a question is open.
 */

const now = new Date('2026-10-07T10:00:00Z');
const later = new Date('2026-10-07T10:00:30Z');

const player = (id: string, name: string): PlayerRow => ({
  id,
  roomId: 'room',
  userId: `user-${id}`,
  displayName: name,
  isConnected: true,
  lastSeenAt: now,
  disconnectedAt: null,
  joinedAt: now,
});

const room: RoomRow = {
  id: 'room',
  code: 'AB7KQ',
  name: 'Friday',
  hostPlayerId: 'p1',
  questionSetId: 'set',
  settings: DEFAULT_GAME_SETTINGS,
  currentGameId: 'game',
  version: 7,
  createdAt: now,
};

const question: GameQuestionRow = {
  id: 'q1',
  gameId: 'game',
  sourceQuestionId: null,
  position: 0,
  type: 'SHORT',
  difficulty: 1,
  prompt: 'Remove six letters from BSAINXLAENTTEARS',
  options: [],
  correctOption: null,
  acceptedAnswers: ['banana'],
  caseSensitive: false,
  explanation: 'SECRET-EXPLANATION',
  points: 150,
};

const game = (status: GameRow['status'], showLeaderboard = true): GameRow => ({
  id: 'game',
  roomId: 'room',
  questionSetId: 'set',
  status,
  currentIndex: 0,
  questionCount: 12,
  questionsPlayed: status === 'RESULTS' ? 1 : 0,
  settings: { ...DEFAULT_GAME_SETTINGS, showLeaderboardAfterEachQuestion: showLeaderboard },
  phaseStartedAt: now,
  phaseEndsAt: later,
  startedAt: now,
  endedAt: null,
  endReason: null,
});

const answer = (playerId: string, text: string, scored: boolean): AnswerRow => ({
  id: `a-${playerId}`,
  gameId: 'game',
  gameQuestionId: 'q1',
  playerId,
  optionIndex: null,
  textAnswer: text,
  submittedAt: now,
  isCorrect: scored ? text === 'banana' : null,
  pointsEarned: scored ? (text === 'banana' ? 150 : 0) : null,
});

function snapshot(status: GameRow['status'], showLeaderboard = true): RoomSnapshot {
  const scored = status === 'RESULTS';
  return {
    room,
    questionSet: { id: 'set', name: 'Set', questionCount: 12, isBuiltin: false },
    players: [player('p1', 'Anjali'), player('p2', 'Rahul')],
    game: game(status, showLeaderboard),
    gamePlayers: [
      { gameId: 'game', playerId: 'p1', score: scored ? 150 : 0, correctCount: scored ? 1 : 0, incorrectCount: 0, unansweredCount: 0, joinedAt: now },
      { gameId: 'game', playerId: 'p2', score: 0, correctCount: 0, incorrectCount: scored ? 1 : 0, unansweredCount: 0, joinedAt: now },
    ],
    question,
    answers: [answer('p1', 'banana', scored), answer('p2', 'apple', scored)],
  };
}

describe('per-player room state', () => {
  it('never leaks the answer key or other players’ answers while a question is open', () => {
    const state = buildRoomState(snapshot('QUESTION_ACTIVE'), 'p2');
    const wire = JSON.stringify(state);
    expect(wire).not.toContain('banana'); // accepted answer, and p1's typed answer
    expect(wire).not.toContain('SECRET-EXPLANATION');
    expect(wire).not.toContain('acceptedAnswers');
    expect(wire).not.toContain('correctOption');
    expect(state.game?.reveal).toBeNull();
    // p2 sees their own locked answer and that p1 has answered (not what).
    expect(state.game?.myAnswer?.display).toBe('apple');
    expect(state.game?.answeredPlayerIds.sort()).toEqual(['p1', 'p2']);
    expect(state.game?.question?.prompt).toContain('BSAINXLAENTTEARS');
  });

  it('reveals the answer, explanation and everyone’s result after the question closes', () => {
    const state = buildRoomState(snapshot('RESULTS'), 'p2');
    expect(state.game?.reveal?.correct).toEqual({ type: 'SHORT', display: 'banana', alsoAccepted: [] });
    expect(state.game?.reveal?.explanation).toBe('SECRET-EXPLANATION');
    expect(state.game?.myResult).toMatchObject({ answer: 'apple', isCorrect: false, points: 0 });
    expect(state.game?.leaderboard?.map((s) => [s.name, s.rank, s.score])).toEqual([
      ['Anjali', 1, 150],
      ['Rahul', 2, 0],
    ]);
  });

  it('hides explanations and the per-question leaderboard when the host turns them off', () => {
    const snap = snapshot('RESULTS', false);
    snap.game!.settings = { ...snap.game!.settings, showExplanations: false };
    const state = buildRoomState(snap, 'p1');
    expect(state.game?.reveal?.explanation).toBeNull();
    expect(state.game?.leaderboard).toBeNull();
  });

  it('shows nothing of the first question during the start countdown', () => {
    const snap = snapshot('STARTING');
    snap.game!.currentIndex = -1;
    const state = buildRoomState(snap, 'p1');
    expect(state.game?.question).toBeNull();
    expect(JSON.stringify(state)).not.toContain('BSAINXLAENTTEARS');
  });
});
