import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { LIMITS, displayNameSchema, firstIssueMessage, normalizeRoomCode, type RoomPreview } from '@sliver/shared';
import { ErrorText, Stage } from '../components/Shell';
import { api, ApiError } from '../lib/api';
import { rememberName, rememberedName } from '../lib/session';

const PHASE_NOTE: Record<RoomPreview['phase'], string> = {
  LOBBY: 'Waiting in the lobby',
  STARTING: 'Starting now, and you can still get in',
  QUESTION_ACTIVE: 'In progress, so you’ll join from the current question',
  RESULTS: 'In progress, so you’ll join from the next question',
  GAME_COMPLETE: 'This game has finished',
};

export function JoinPage() {
  const params = useParams();
  const navigate = useNavigate();
  const [code, setCode] = useState(params.code ?? '');
  const [name, setName] = useState(rememberedName);
  const [preview, setPreview] = useState<RoomPreview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const normalized = normalizeRoomCode(code);

  // Look the room up as soon as the code is complete.
  useEffect(() => {
    setPreview(null);
    if (!normalized) return;
    let cancelled = false;
    api
      .previewRoom(normalized)
      .then((p) => {
        if (cancelled) return;
        setPreview(p);
        setError('');
        if (p.myDisplayName) setName(p.myDisplayName);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not find that game.');
      });
    return () => {
      cancelled = true;
    };
  }, [normalized]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!normalized) {
      setError('Game codes are 5 letters and numbers, like AB7KQ.');
      return;
    }
    const parsedName = displayNameSchema.safeParse(name);
    if (!parsedName.success) {
      setError(firstIssueMessage(parsedName.error));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.joinRoom(normalized, parsedName.data);
      rememberName(parsedName.data);
      navigate(`/room/${normalized}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not join the game.');
      setBusy(false);
    }
  };

  const returning = Boolean(preview?.myPlayerId);

  return (
    <Stage>
      <form onSubmit={submit} className="py-8" noValidate>
        <h1 className="display text-5xl sm:text-6xl">{returning ? 'Welcome back' : 'Join a game'}</h1>

        <div className="mt-10 space-y-6">
          <label className="block">
            <span className="label">Game code</span>
            <input
              className="field display-tight text-center text-3xl tracking-[0.3em] uppercase sm:max-w-xs"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setError('');
              }}
              placeholder="AB7KQ"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={7}
              autoFocus={!params.code}
            />
          </label>

          {preview && (
            <div className="pop-in rounded-2xl bg-cobalt-900/60 px-5 py-4">
              <p className="display-tight text-2xl">{preview.name}</p>
              <p className="mt-1 text-cobalt-200">
                {preview.hostName ? `Hosted by ${preview.hostName}. ` : ''}
                {preview.playerCount} {preview.playerCount === 1 ? 'player' : 'players'} so far.{' '}
                {PHASE_NOTE[preview.phase]}.
              </p>
            </div>
          )}

          <label className="block">
            <span className="label">Your name</span>
            <input
              className="field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={LIMITS.displayName}
              placeholder="Rahul"
              autoComplete="nickname"
              autoFocus={Boolean(params.code)}
            />
            {returning && (
              <span className="mt-2 block text-sm text-cobalt-200">
                You’re already in this game. Your score and answers are waiting.
              </span>
            )}
          </label>
        </div>

        <ErrorText>{error}</ErrorText>
        <button type="submit" className="btn btn-sun mt-8 min-h-14 w-full text-lg sm:w-auto sm:px-10" disabled={busy}>
          {busy ? 'Joining…' : returning ? 'Rejoin game' : 'Join game'}
        </button>
      </form>
    </Stage>
  );
}
