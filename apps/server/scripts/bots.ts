/**
 * Fill a room with bot players so you can try a full multiplayer game alone.
 *
 *   npm run bots -- AB7KQ            # 3 bots
 *   npm run bots -- AB7KQ 6          # 6 bots
 *   SERVER_URL=https://… npm run bots -- AB7KQ
 *
 * Bots use the public API exactly like browsers: their own session, the join
 * endpoint and a WebSocket. They never learn the answers (the server doesn't
 * reveal them early), so they guess — at random moments within the 30 seconds.
 */
import type { RoomState, ServerMessage } from '@sliver/shared';

const [codeArg, countArg] = process.argv.slice(2);
const SERVER = (process.env.SERVER_URL ?? 'http://localhost:8787').replace(/\/$/, '');
const NAMES = ['Rahul', 'Sneha', 'Kunal', 'Priya', 'Arjun', 'Meera', 'Dev', 'Isha', 'Kabir', 'Tara'];
const GUESSES = ['32', '5', 'Johnny', 'banana', 'A', '42', '47', '11', 'Tuesday', 'N', '1', '8', 'no idea'];

if (!codeArg) {
  console.error('Usage: npm run bots -- <ROOM CODE> [count]');
  process.exit(1);
}
const code = codeArg.toUpperCase();
const count = Math.min(Number(countArg ?? 3) || 3, NAMES.length);

async function call<T>(token: string | null, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${SERVER}/api${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const json = (await res.json()) as T & { error?: { message: string } };
  if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
  return json;
}

async function runBot(name: string) {
  const { token } = await call<{ token: string }>(null, 'POST', '/session');
  await call(token, 'POST', `/rooms/${code}/join`, { displayName: name });
  const ws = new WebSocket(`${SERVER.replace(/^http/, 'ws')}/ws`);
  const answered = new Set<string>();

  ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'auth', token, roomCode: code })));
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data)) as ServerMessage;
    if (msg.type === 'error') console.error(`[${name}] ${msg.message}`);
    if (msg.type !== 'state') return;
    const state: RoomState = msg.state;
    const q = state.game?.question;
    if (state.phase !== 'QUESTION_ACTIVE' || !q || answered.has(q.id) || state.game?.myAnswer) return;
    answered.add(q.id);
    const delay = 2_000 + Math.random() * 24_000;
    setTimeout(() => {
      const answer =
        q.type === 'MCQ'
          ? { optionIndex: Math.floor(Math.random() * (q.options?.length ?? 1)) }
          : { text: GUESSES[Math.floor(Math.random() * GUESSES.length)]! };
      call(token, 'POST', `/rooms/${code}/answers`, { questionId: q.id, answer })
        .then(() => console.log(`[${name}] answered Q${q.index + 1}`))
        .catch((err: Error) => console.log(`[${name}] ${err.message}`));
    }, delay);
  });
  ws.addEventListener('close', () => console.log(`[${name}] disconnected`));
  console.log(`[${name}] joined ${code}`);
}

for (const name of NAMES.slice(0, count)) {
  await runBot(name).catch((err: Error) => console.error(`[${name}] ${err.message}`));
}
console.log('Bots are playing. Ctrl+C to stop.');
