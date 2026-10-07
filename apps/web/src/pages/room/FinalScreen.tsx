import { useState } from 'react';
import { Link } from 'react-router';
import type { FinalView, RoomState } from '@sliver/shared';
import { Icon } from '../../components/Icon';
import { Leaderboard } from '../../components/Leaderboard';
import { ErrorText } from '../../components/Shell';
import { api, ApiError } from '../../lib/api';

export function FinalScreen({ state, final, code }: { state: RoomState; final: FinalView; code: string }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const winners = final.standings.filter((s) => final.winnerIds.includes(s.playerId));
  const iWon = final.winnerIds.includes(state.me.playerId);
  const top = winners[0];

  const playAgain = async () => {
    setBusy(true);
    try {
      await api.restartGame(code);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start a new round.');
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-10 pt-8">
      <section className="pop-in text-center" aria-live="polite">
        {top ? (
          <>
            <Icon name="crown" size={56} className="mx-auto text-sun" />
            <p className="mt-2 text-lg text-cobalt-100">
              {winners.length > 1 ? 'A tie at the top' : iWon ? 'You win' : 'The winner'}
            </p>
            <h1 className="display mt-3 text-[clamp(3rem,13vw,6rem)] break-words text-sun">
              {winners.map((w) => w.name).join(' & ')}
            </h1>
            <p className="display mt-4 text-3xl tabular-nums">{top.score} points</p>
          </>
        ) : (
          <h1 className="display text-5xl">Game over</h1>
        )}
        {final.endReason === 'ENDED_BY_HOST' && (
          <p className="mt-4 text-cobalt-200">
            The host ended the game early, after {final.questionsPlayed}{' '}
            {final.questionsPlayed === 1 ? 'question' : 'questions'}.
          </p>
        )}
      </section>

      <section aria-labelledby="final-title">
        <h2 id="final-title" className="display-tight mb-3 text-2xl">
          Final standings
        </h2>
        <Leaderboard standings={final.standings} meId={state.me.playerId} detailed />
      </section>

      <section className="mt-auto">
        <ErrorText>{error}</ErrorText>
        {state.me.isHost ? (
          <div className="flex flex-col gap-3 sm:flex-row">
            <button type="button" className="btn btn-sun min-h-14 flex-1 text-lg" disabled={busy} onClick={playAgain}>
              {busy ? 'Opening the lobby…' : 'Play again'}
            </button>
            <Link to="/" className="btn btn-ghost min-h-14 flex-1">
              Leave
            </Link>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 text-center">
            <p className="text-cobalt-100">Stay here: if the host plays again, you’ll go straight to the lobby.</p>
            <Link to="/" className="btn btn-ghost">
              Leave
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
