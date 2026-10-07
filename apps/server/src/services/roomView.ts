import { and, asc, eq, sql } from 'drizzle-orm';
import type {
  CorrectAnswerView,
  Difficulty,
  GameView,
  PlayerResult,
  PublicQuestion,
  RevealView,
  RoomState,
  StandingView,
} from '@sliver/shared';
import type { Db } from '../db/client.js';
import {
  answers,
  gamePlayers,
  gameQuestions,
  games,
  players,
  questionSets,
  questions,
  rooms,
  type AnswerRow,
  type GamePlayerRow,
  type GameQuestionRow,
  type GameRow,
  type PlayerRow,
  type RoomRow,
} from '../db/schema.js';
import { rankStandings, winnersOf } from '../domain/ranking.js';
import { optionLetter, toMyAnswer } from './game.js';

/**
 * Everything needed to render a room for any player, read in one consistent
 * snapshot. Contains secrets (correct answers); never send it as-is —
 * buildRoomState() decides what each player may see.
 */
export interface RoomSnapshot {
  room: RoomRow;
  questionSet: { id: string; name: string; questionCount: number; isBuiltin: boolean } | null;
  players: PlayerRow[];
  game: GameRow | null;
  gamePlayers: GamePlayerRow[];
  /** The current question (with its answer key) while QUESTION_ACTIVE or RESULTS. */
  question: GameQuestionRow | null;
  /** Answers to the current question. */
  answers: AnswerRow[];
}

export async function loadRoomSnapshot(db: Db, roomId: string): Promise<RoomSnapshot | null> {
  return db.transaction(
    async (tx) => {
      const [row] = await tx
        .select({
          room: rooms,
          setName: questionSets.name,
          setIsBuiltin: questionSets.isBuiltin,
          setCount: sql<number>`(SELECT count(*)::int FROM ${questions} q WHERE q.question_set_id = rooms.question_set_id)`,
        })
        .from(rooms)
        .leftJoin(questionSets, eq(questionSets.id, rooms.questionSetId))
        .where(eq(rooms.id, roomId));
      if (!row) return null;
      const { room } = row;

      const roster = await tx
        .select()
        .from(players)
        .where(eq(players.roomId, roomId))
        .orderBy(asc(players.joinedAt));

      let game: GameRow | null = null;
      let participants: GamePlayerRow[] = [];
      let question: GameQuestionRow | null = null;
      let current: AnswerRow[] = [];
      if (room.currentGameId) {
        [game = null] = await tx.select().from(games).where(eq(games.id, room.currentGameId));
        if (game) {
          participants = await tx.select().from(gamePlayers).where(eq(gamePlayers.gameId, game.id));
          if (game.status === 'QUESTION_ACTIVE' || game.status === 'RESULTS') {
            [question = null] = await tx
              .select()
              .from(gameQuestions)
              .where(and(eq(gameQuestions.gameId, game.id), eq(gameQuestions.position, game.currentIndex)));
            if (question) {
              current = await tx.select().from(answers).where(eq(answers.gameQuestionId, question.id));
            }
          }
        }
      }

      return {
        room,
        questionSet:
          room.questionSetId && row.setName !== null
            ? {
                id: room.questionSetId,
                name: row.setName,
                questionCount: row.setCount,
                isBuiltin: row.setIsBuiltin ?? false,
              }
            : null,
        players: roster,
        game,
        gamePlayers: participants,
        question,
        answers: current,
      };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}

function publicQuestion(q: GameQuestionRow): PublicQuestion {
  return {
    id: q.id,
    index: q.position,
    type: q.type,
    difficulty: q.difficulty as Difficulty,
    prompt: q.prompt,
    options: q.type === 'MCQ' ? q.options : null,
    points: q.points,
  };
}

function correctAnswerOf(q: GameQuestionRow): CorrectAnswerView {
  if (q.type === 'MCQ') {
    const index = q.correctOption ?? 0;
    return { type: 'MCQ', optionIndex: index, display: `${optionLetter(index)}. ${q.options[index] ?? ''}` };
  }
  const [first = '', ...rest] = q.acceptedAnswers;
  return { type: 'SHORT', display: first, alsoAccepted: rest };
}

function buildReveal(
  s: RoomSnapshot & { game: GameRow; question: GameQuestionRow },
  standings: StandingView[],
): RevealView {
  const q = s.question;
  const byPlayer = new Map(s.answers.map((a) => [a.playerId, a]));
  const results: PlayerResult[] = standings.map((st) => {
    const a = byPlayer.get(st.playerId);
    if (!a) {
      return {
        playerId: st.playerId,
        name: st.name,
        answer: null,
        optionIndex: null,
        isCorrect: false,
        answered: false,
        points: 0,
      };
    }
    return {
      playerId: st.playerId,
      name: st.name,
      answer: toMyAnswer(q, a).display,
      optionIndex: a.optionIndex,
      isCorrect: a.isCorrect === true,
      answered: true,
      points: a.pointsEarned ?? 0,
    };
  });

  let optionCounts: number[] | null = null;
  if (q.type === 'MCQ') {
    optionCounts = q.options.map(() => 0);
    for (const a of s.answers) {
      if (a.optionIndex !== null && a.optionIndex < optionCounts.length) {
        optionCounts[a.optionIndex] = (optionCounts[a.optionIndex] ?? 0) + 1;
      }
    }
  }

  return {
    correct: correctAnswerOf(q),
    explanation: s.game.settings.showExplanations ? q.explanation : null,
    optionCounts,
    results,
    summary: {
      correct: results.filter((r) => r.answered && r.isCorrect).length,
      incorrect: results.filter((r) => r.answered && !r.isCorrect).length,
      unanswered: results.filter((r) => !r.answered).length,
    },
  };
}

function buildGameView(s: RoomSnapshot & { game: GameRow }, viewerId: string): GameView {
  const { game } = s;
  const names = new Map(s.players.map((p) => [p.id, p]));
  const standings: StandingView[] = rankStandings(
    s.gamePlayers.map((gp) => ({
      playerId: gp.playerId,
      name: names.get(gp.playerId)?.displayName ?? 'Player',
      score: gp.score,
      correct: gp.correctCount,
      incorrect: gp.incorrectCount,
      unanswered: gp.unansweredCount,
    })),
  ).map((r) => ({ ...r, connected: names.get(r.playerId)?.isConnected ?? false }));

  // The question is only ever visible while it is open or being revealed.
  const question =
    s.question && (game.status === 'QUESTION_ACTIVE' || game.status === 'RESULTS') ? s.question : null;
  const mine = question ? s.answers.find((a) => a.playerId === viewerId) : undefined;
  const reveal = question && game.status === 'RESULTS' ? buildReveal({ ...s, question }, standings) : null;
  const complete = game.status === 'GAME_COMPLETE';

  return {
    id: game.id,
    status: game.status,
    phaseStartedAt: game.phaseStartedAt.getTime(),
    phaseEndsAt: game.phaseEndsAt?.getTime() ?? null,
    questionIndex: game.currentIndex,
    questionCount: game.questionCount,
    questionDurationSec: game.settings.questionDurationSec,
    question: question ? publicQuestion(question) : null,
    answeredPlayerIds: question ? s.answers.map((a) => a.playerId) : [],
    myAnswer: question && mine ? toMyAnswer(question, mine) : null,
    reveal,
    myResult: reveal?.results.find((r) => r.playerId === viewerId) ?? null,
    leaderboard: complete || game.settings.showLeaderboardAfterEachQuestion ? standings : null,
    final: complete
      ? {
          endReason: game.endReason ?? 'COMPLETED',
          winnerIds: game.questionsPlayed > 0 ? winnersOf(standings) : [],
          standings,
          questionsPlayed: game.questionsPlayed,
        }
      : null,
  };
}

/** The per-player view. Pure: unit tests pin down exactly what each player can see. */
export function buildRoomState(s: RoomSnapshot, viewerId: string): RoomState {
  const viewer = s.players.find((p) => p.id === viewerId);
  const setCount = s.questionSet?.questionCount ?? 0;
  return {
    version: s.room.version,
    room: {
      code: s.room.code,
      name: s.room.name,
      hostPlayerId: s.room.hostPlayerId,
      settings: s.room.settings,
      questionSet: s.questionSet,
      playableQuestionCount: Math.min(s.room.settings.questionCount ?? setCount, setCount),
    },
    me: {
      playerId: viewerId,
      name: viewer?.displayName ?? '',
      isHost: s.room.hostPlayerId === viewerId,
    },
    players: s.players.map((p) => ({
      id: p.id,
      name: p.displayName,
      isHost: p.id === s.room.hostPlayerId,
      connected: p.isConnected,
    })),
    phase: s.game ? s.game.status : 'LOBBY',
    game: s.game ? buildGameView({ ...s, game: s.game }, viewerId) : null,
  };
}
