import type { Difficulty } from './difficulty.js';
import type { GameSettings, QuestionInput } from './schemas.js';

/**
 * Wire contracts between the server and the browser.
 *
 * Commands (create/join/start/answer/…) are REST calls that return a clear
 * success or error. State flows the other way over one WebSocket per player:
 * the server pushes a complete, per-player RoomState whenever anything in the
 * room changes. Clients render that state and never compute game outcomes.
 */

// ── Game state machine ───────────────────────────────────────────────────────

/**
 * LOBBY → STARTING → QUESTION_ACTIVE → RESULTS → QUESTION_ACTIVE … → GAME_COMPLETE
 *
 * QUESTION_LOCKED and NEXT_QUESTION from the spec are not resting states: they
 * happen inside the single database transaction that closes a question (lock,
 * score, publish RESULTS) and the one that opens the next.
 */
export const PHASES = ['LOBBY', 'STARTING', 'QUESTION_ACTIVE', 'RESULTS', 'GAME_COMPLETE'] as const;
export type Phase = (typeof PHASES)[number];
export type GameStatus = Exclude<Phase, 'LOBBY'>;
export const ACTIVE_GAME_STATUSES = ['STARTING', 'QUESTION_ACTIVE', 'RESULTS'] as const;
export type ActiveGameStatus = (typeof ACTIVE_GAME_STATUSES)[number];
export type EndReason = 'COMPLETED' | 'ENDED_BY_HOST';

// ── Error codes ──────────────────────────────────────────────────────────────

export const ERROR_CODES = [
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'ROOM_NOT_FOUND',
  'NOT_IN_ROOM',
  'NOT_HOST',
  'NAME_TAKEN',
  'ROOM_FULL',
  'INVALID_STATE',
  'NO_QUESTION_SET',
  'NO_QUESTIONS',
  'QUESTION_SET_LOCKED',
  'QUESTION_SET_READ_ONLY',
  'QUESTION_NOT_ACTIVE',
  'DEADLINE_PASSED',
  'ALREADY_ANSWERED',
  'INVALID_ANSWER',
  'RATE_LIMITED',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string };
}

// ── REST payloads ────────────────────────────────────────────────────────────

export interface SessionResponse {
  token: string;
  userId: string;
  displayName: string | null;
}

export interface QuestionSetSummary {
  id: string;
  name: string;
  description: string | null;
  questionCount: number;
  isBuiltin: boolean;
  isOwner: boolean;
  /** true while a running game uses this set; edits and deletes are refused. */
  isLocked: boolean;
  updatedAt: string;
}

export type StoredQuestion = QuestionInput & { id: string };

export interface QuestionSetDetail extends QuestionSetSummary {
  questions: StoredQuestion[];
}

export interface CreateRoomResponse {
  code: string;
  playerId: string;
}

export interface JoinRoomResponse {
  code: string;
  playerId: string;
}

export interface RoomPreview {
  code: string;
  name: string;
  phase: Phase;
  playerCount: number;
  hostName: string | null;
  /** Set when the caller already has a seat in this room (reconnect). */
  myPlayerId: string | null;
  myDisplayName: string | null;
}

export interface SubmitAnswerResponse {
  myAnswer: MyAnswer;
}

// ── Room state (server → client) ─────────────────────────────────────────────

export interface PlayerView {
  id: string;
  name: string;
  isHost: boolean;
  connected: boolean;
}

/** What a player may see of a question while it is open: never the answer. */
export interface PublicQuestion {
  id: string;
  index: number;
  type: 'MCQ' | 'SHORT';
  difficulty: Difficulty;
  prompt: string;
  /** MCQ only. */
  options: string[] | null;
  points: number;
}

export interface MyAnswer {
  /** Human-readable form, e.g. "C. All of them" or "32". */
  display: string;
  optionIndex: number | null;
  text: string | null;
  /** Epoch ms, server clock. */
  submittedAt: number;
}

export type CorrectAnswerView =
  | { type: 'MCQ'; optionIndex: number; display: string }
  | { type: 'SHORT'; display: string; alsoAccepted: string[] };

export interface PlayerResult {
  playerId: string;
  name: string;
  /** null = did not answer in time. */
  answer: string | null;
  optionIndex: number | null;
  isCorrect: boolean;
  answered: boolean;
  points: number;
}

export interface RevealView {
  correct: CorrectAnswerView;
  /** null when the question has none or the host turned explanations off. */
  explanation: string | null;
  /** MCQ only: how many players picked each option. */
  optionCounts: number[] | null;
  results: PlayerResult[];
  summary: { correct: number; incorrect: number; unanswered: number };
}

export interface StandingView {
  playerId: string;
  name: string;
  rank: number;
  score: number;
  correct: number;
  incorrect: number;
  unanswered: number;
  /** 0..1 over questions this player faced. */
  accuracy: number;
  connected: boolean;
}

export interface FinalView {
  endReason: EndReason;
  /** Everyone tied for first place. */
  winnerIds: string[];
  standings: StandingView[];
  questionsPlayed: number;
}

export interface GameView {
  id: string;
  status: GameStatus;
  /** Epoch ms on the server clock. Clients convert with their measured offset. */
  phaseStartedAt: number;
  phaseEndsAt: number | null;
  /** 0-based; -1 during STARTING. */
  questionIndex: number;
  questionCount: number;
  questionDurationSec: number;
  question: PublicQuestion | null;
  /** Who has locked an answer for the open question (never what they chose). */
  answeredPlayerIds: string[];
  myAnswer: MyAnswer | null;
  /** RESULTS only. */
  reveal: RevealView | null;
  myResult: PlayerResult | null;
  /** null when the host hid the per-question leaderboard. */
  leaderboard: StandingView[] | null;
  /** GAME_COMPLETE only. */
  final: FinalView | null;
}

export interface RoomState {
  /** Monotonic per room; clients drop any state older than the one they have. */
  version: number;
  room: {
    code: string;
    name: string;
    hostPlayerId: string | null;
    settings: GameSettings;
    questionSet: { id: string; name: string; questionCount: number; isBuiltin: boolean } | null;
    /** How many questions the next game will play (settings.questionCount capped by the set). */
    playableQuestionCount: number;
  };
  me: { playerId: string; name: string; isHost: boolean };
  players: PlayerView[];
  phase: Phase;
  game: GameView | null;
}

// ── WebSocket messages ───────────────────────────────────────────────────────

export type ClientMessage =
  | { type: 'auth'; token: string; roomCode: string }
  /** Clock sync + keepalive. `t` is the client's Date.now() when sent. */
  | { type: 'ping'; t: number };

export type ServerMessage =
  | { type: 'state'; state: RoomState }
  | { type: 'pong'; t: number; serverTime: number }
  | { type: 'error'; code: ErrorCode; message: string; fatal: boolean };

export const WS_CLOSE = {
  /** Auth failed or the player has no seat; the client must not auto-retry. */
  POLICY: 4001,
  AUTH_TIMEOUT: 4008,
} as const;
