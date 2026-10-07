import type {
  ApiErrorBody,
  CreateRoomRequest,
  CreateRoomResponse,
  ErrorCode,
  JoinRoomResponse,
  MyAnswer,
  QuestionSetDetail,
  QuestionSetInput,
  QuestionSetSummary,
  RoomPreview,
  RoomState,
  SubmitAnswerRequest,
  UpdateRoomRequest,
} from '@sliver/shared';
import { API_URL } from './config';
import { ensureSession, forgetSession } from './session';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK',
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
  const session = await ensureSession();
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      method,
      headers: {
        authorization: `Bearer ${session.token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Can’t reach the game server. Check your connection and try again.');
  }

  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => null)) as unknown;
  if (res.ok) return json as T;

  const error = (json as ApiErrorBody | null)?.error;
  // A token the server no longer knows (e.g. the database was reset): start fresh once.
  if (res.status === 401 && !retried) {
    forgetSession();
    return request<T>(method, path, body, true);
  }
  throw new ApiError(res.status, error?.code ?? 'INTERNAL', error?.message ?? 'Something went wrong.');
}

const code = (c: string) => encodeURIComponent(c.toUpperCase());

export const api = {
  listSets: () => request<QuestionSetSummary[]>('GET', '/question-sets'),
  getSet: (id: string) => request<QuestionSetDetail>('GET', `/question-sets/${id}`),
  createSet: (input: QuestionSetInput) => request<QuestionSetDetail>('POST', '/question-sets', input),
  updateSet: (id: string, input: QuestionSetInput) =>
    request<QuestionSetDetail>('PUT', `/question-sets/${id}`, input),
  deleteSet: (id: string) => request<void>('DELETE', `/question-sets/${id}`),
  duplicateSet: (id: string) => request<QuestionSetDetail>('POST', `/question-sets/${id}/duplicate`),

  createRoom: (input: CreateRoomRequest) => request<CreateRoomResponse>('POST', '/rooms', input),
  previewRoom: (c: string) => request<RoomPreview>('GET', `/rooms/${code(c)}`),
  joinRoom: (c: string, displayName: string) =>
    request<JoinRoomResponse>('POST', `/rooms/${code(c)}/join`, { displayName }),
  roomState: (c: string) => request<RoomState>('GET', `/rooms/${code(c)}/state`),
  updateRoom: (c: string, input: UpdateRoomRequest) => request<void>('PATCH', `/rooms/${code(c)}`, input),
  startGame: (c: string) => request<{ gameId: string }>('POST', `/rooms/${code(c)}/start`),
  submitAnswer: (c: string, input: SubmitAnswerRequest) =>
    request<{ myAnswer: MyAnswer }>('POST', `/rooms/${code(c)}/answers`, input),
  endGame: (c: string) => request<void>('POST', `/rooms/${code(c)}/end`),
  restartGame: (c: string) => request<void>('POST', `/rooms/${code(c)}/restart`),
  transferHost: (c: string, playerId: string) => request<void>('POST', `/rooms/${code(c)}/host`, { playerId }),
};
