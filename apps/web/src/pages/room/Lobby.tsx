import { useEffect, useRef, useState } from 'react';
import type { GameSettings, QuestionSetSummary, RoomState } from '@sliver/shared';
import { Avatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { SetPicker } from '../../components/SetPicker';
import { SettingsForm } from '../../components/SettingsForm';
import { ErrorText } from '../../components/Shell';
import { api, ApiError } from '../../lib/api';

export function Lobby({ state, code }: { state: RoomState; code: string }) {
  const host = state.players.find((p) => p.isHost);
  const isHost = state.me.isHost;

  return (
    <div className="grid gap-10 py-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-14">
      <section aria-labelledby="lobby-title">
        <p className="text-cobalt-200">{state.room.name}</p>
        <h1 id="lobby-title" className="sr-only">
          Lobby for game {code}
        </h1>
        <InviteCode code={code} />

        <h2 className="display-tight mt-10 mb-3 flex items-baseline justify-between text-2xl">
          Players
          <span className="text-base font-semibold text-cobalt-200 tabular-nums">{state.players.length}</span>
        </h2>
        <ul className="divide-y divide-white/12 overflow-hidden rounded-2xl bg-cobalt-900/60">
          {state.players.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-3">
              <Avatar name={p.name} dim={!p.connected} />
              <span className={`min-w-0 flex-1 truncate font-semibold ${p.connected ? '' : 'text-white/55'}`}>
                {p.name}
                {p.id === state.me.playerId && <span className="ml-2 font-normal text-cobalt-200">(you)</span>}
              </span>
              {p.isHost && (
                <span className="flex items-center gap-1 text-sm font-semibold text-sun">
                  <Icon name="crown" size={16} />
                  Host
                </span>
              )}
              {!p.connected && <span className="text-sm text-white/55">Offline</span>}
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Game setup">
        {isHost ? (
          <HostSetup state={state} code={code} />
        ) : (
          <div className="rounded-3xl bg-cobalt-900/60 p-6">
            <p className="display-tight text-3xl">Waiting for {host?.name ?? 'the host'} to start</p>
            <p className="mt-3 text-cobalt-100">
              {state.room.questionSet
                ? `${state.room.playableQuestionCount} questions from “${state.room.questionSet.name}”, 30 seconds each.`
                : 'The host is still choosing the questions.'}
            </p>
            <p className="mt-6 text-sm text-cobalt-200">
              Keep this screen open. The first question appears for everyone at the same moment.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function InviteCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/join/${code}`;
  const canShare = typeof navigator.share === 'function';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this link', link);
    }
  };

  return (
    <div className="mt-2">
      <p className="display text-[clamp(3.5rem,17vw,6rem)] tracking-[0.06em] text-sun" aria-label={`Game code ${code.split('').join(' ')}`}>
        {code}
      </p>
      <p className="mt-3 text-cobalt-100">
        Friends join at <span className="font-semibold text-white">{window.location.host}/join</span> with this code.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" className="btn btn-ghost" onClick={copy}>
          <Icon name={copied ? 'check' : 'copy'} />
          {copied ? 'Link copied' : 'Copy invite link'}
        </button>
        {canShare && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void navigator.share({ title: 'Join my Sliver game', url: link }).catch(() => undefined)}
          >
            <Icon name="share" />
            Share
          </button>
        )}
      </div>
    </div>
  );
}

const sameSettings = (a: GameSettings, b: GameSettings) => JSON.stringify(a) === JSON.stringify(b);

function HostSetup({ state, code }: { state: RoomState; code: string }) {
  const [sets, setSets] = useState<QuestionSetSummary[] | null>(null);
  const [settings, setSettings] = useState<GameSettings>(state.room.settings);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const pendingSave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    api
      .listSets()
      .then(setSets)
      .catch(() => setSets([]));
  }, [state.room.questionSet?.id, state.room.questionSet?.questionCount]);

  // Adopt server-side settings unless the host is mid-edit.
  useEffect(() => {
    if (!pendingSave.current && !sameSettings(settings, state.room.settings)) setSettings(state.room.settings);
  }, [state.room.settings]);

  useEffect(() => () => clearTimeout(pendingSave.current), []);

  const changeSettings = (next: GameSettings) => {
    setSettings(next);
    clearTimeout(pendingSave.current);
    pendingSave.current = setTimeout(() => {
      pendingSave.current = undefined;
      api.updateRoom(code, { settings: next }).catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Could not save settings.');
        setSettings(state.room.settings);
      });
    }, 400);
  };

  const chooseSet = (questionSetId: string) => {
    setError('');
    api.updateRoom(code, { questionSetId }).catch((err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Could not change the question set.');
    });
  };

  const start = async () => {
    setStarting(true);
    setError('');
    try {
      await api.startGame(code);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start the game.');
      setStarting(false);
    }
  };

  const playable = state.room.playableQuestionCount;
  const others = state.players.filter((p) => p.id !== state.me.playerId && p.connected).length;

  return (
    <div>
      <div className="rounded-3xl bg-sun p-6 text-cobalt-950">
        <p className="display-tight text-2xl">
          {playable > 0 ? `${playable} questions, 30 seconds each` : 'Pick a question set with questions'}
        </p>
        <p className="mt-1 text-cobalt-950/75">
          {others === 0
            ? 'Nobody else is here yet. Share the code, or start on your own to try it out.'
            : `${others} ${others === 1 ? 'friend is' : 'friends are'} ready.`}
        </p>
        <button
          type="button"
          className="btn mt-5 min-h-14 w-full bg-cobalt-700 text-lg text-white hover:bg-cobalt-800"
          disabled={starting || playable === 0}
          onClick={start}
        >
          {starting ? 'Starting…' : 'Start game'}
        </button>
        <p className="mt-3 text-sm text-cobalt-950/70">Questions lock when the game starts.</p>
      </div>

      <ErrorText>{error}</ErrorText>

      <div className="mt-8">
        <SetPicker
          sets={sets}
          value={state.room.questionSet?.id ?? null}
          onChange={chooseSet}
          returnTo={`/room/${code}`}
        />
      </div>

      <h2 className="display-tight mt-8 mb-4 text-xl">Settings</h2>
      <SettingsForm value={settings} onChange={changeSettings} setSize={state.room.questionSet?.questionCount ?? 0} />
    </div>
  );
}
