import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import {
  DEFAULT_GAME_SETTINGS,
  LIMITS,
  createRoomSchema,
  firstIssueMessage,
  type GameSettings,
  type QuestionSetSummary,
} from '@sliver/shared';
import { SetPicker } from '../components/SetPicker';
import { SettingsForm } from '../components/SettingsForm';
import { ErrorText, Stage } from '../components/Shell';
import { api, ApiError } from '../lib/api';
import { rememberName, rememberedName } from '../lib/session';

export function CreatePage() {
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState(rememberedName);
  const [gameName, setGameName] = useState('');
  const [sets, setSets] = useState<QuestionSetSummary[] | null>(null);
  const [setId, setSetId] = useState<string | null>(null);
  const [settings, setSettings] = useState<GameSettings>(() => structuredClone(DEFAULT_GAME_SETTINGS));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .listSets()
      .then((list) => {
        setSets(list);
        // Default to the first set that has questions: your own first, else the built-in starter.
        const playable = list.find((s) => s.questionCount > 0);
        setSetId((current) => current ?? playable?.id ?? list[0]?.id ?? null);
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Could not load question sets.'));
  }, []);

  const chosen = sets?.find((s) => s.id === setId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = createRoomSchema.safeParse({
      gameName: gameName.trim() || `${displayName.trim() || 'Friday'}’s game`,
      displayName,
      questionSetId: setId,
      settings,
    });
    if (!parsed.success) {
      setError(firstIssueMessage(parsed.error));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { code } = await api.createRoom(parsed.data);
      rememberName(parsed.data.displayName);
      navigate(`/room/${code}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the game.');
      setBusy(false);
    }
  };

  return (
    <Stage>
      <form onSubmit={submit} className="py-8" noValidate>
        <h1 className="display text-5xl sm:text-6xl">New game</h1>
        <p className="mt-3 text-cobalt-100">You’ll be the host. You get a code to share, then start when everyone’s in.</p>

        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          <label className="block">
            <span className="label">Your name</span>
            <input
              className="field"
              value={displayName}
              maxLength={LIMITS.displayName}
              autoComplete="nickname"
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Anjali"
              required
            />
          </label>
          <label className="block">
            <span className="label">Game name</span>
            <input
              className="field"
              value={gameName}
              maxLength={LIMITS.gameName}
              onChange={(e) => setGameName(e.target.value)}
              placeholder="Friday night quiz"
            />
          </label>
        </div>

        <div className="mt-8">
          <SetPicker sets={sets} value={setId} onChange={setSetId} returnTo="/create" />
        </div>

        <h2 className="display-tight mt-10 mb-4 text-2xl">Settings</h2>
        <SettingsForm value={settings} onChange={setSettings} setSize={chosen?.questionCount ?? 0} />

        <ErrorText>{error}</ErrorText>
        <button type="submit" className="btn btn-sun mt-8 min-h-14 w-full text-lg sm:w-auto sm:px-10" disabled={busy}>
          {busy ? 'Creating…' : 'Create game'}
        </button>
      </form>
    </Stage>
  );
}
