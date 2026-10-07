import type { ErrorCode } from '@sliver/shared';

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_IN_ROOM: 403,
  NOT_HOST: 403,
  QUESTION_SET_READ_ONLY: 403,
  NOT_FOUND: 404,
  ROOM_NOT_FOUND: 404,
  NAME_TAKEN: 409,
  ROOM_FULL: 409,
  INVALID_STATE: 409,
  NO_QUESTION_SET: 409,
  NO_QUESTIONS: 409,
  QUESTION_SET_LOCKED: 409,
  QUESTION_NOT_ACTIVE: 409,
  DEADLINE_PASSED: 409,
  ALREADY_ANSWERED: 409,
  INVALID_ANSWER: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

/** An expected, user-facing failure. Anything else is a 500 with a generic message. */
export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = STATUS[code];
  }
}

export const fail = (code: ErrorCode, message: string): never => {
  throw new AppError(code, message);
};

/** Postgres error helpers (node-postgres puts the SQLSTATE on `code`). */
export function pgCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  if (typeof e?.code === 'string') return e.code;
  if (typeof e?.cause?.code === 'string') return e.cause.code;
  return undefined;
}

export function pgConstraint(err: unknown): string | undefined {
  const e = err as { constraint?: unknown; cause?: { constraint?: unknown } } | null;
  if (typeof e?.constraint === 'string') return e.constraint;
  if (typeof e?.cause?.constraint === 'string') return e.cause.constraint;
  return undefined;
}

export const PG_UNIQUE_VIOLATION = '23505';
export const PG_SNAPSHOT_IMMUTABLE = 'SL001';
export const PG_ANSWER_WINDOW_CLOSED = 'SL002';
export const PG_ANSWER_IMMUTABLE = 'SL003';
