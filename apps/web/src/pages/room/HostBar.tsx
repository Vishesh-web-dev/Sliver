import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';

/** Host controls during play. Ending takes two taps so it can't happen by accident. */
export function HostBar({ code }: { code: string }) {
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  const end = async () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    try {
      await api.endGame(code);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not end the game.');
    }
    setArmed(false);
  };

  return (
    <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-white/12 pt-5 text-sm text-cobalt-200">
      <span>You’re the host. The server runs the clock; you can end the game early.</span>
      <button type="button" className={`btn btn-sm ${armed ? 'bg-coral text-cobalt-950' : 'btn-ghost'}`} onClick={end}>
        {armed ? 'Tap again to end the game' : 'End game'}
      </button>
      {error && <span role="alert" className="w-full text-coral">{error}</span>}
    </div>
  );
}
