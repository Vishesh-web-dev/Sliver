import { useEffect, useRef } from 'react';
import type { StandingView } from '@sliver/shared';
import { Icon } from './Icon';

/**
 * Standings, highest first. Ties share a rank. Movement arrows compare with the
 * previous board this player saw (purely cosmetic, computed in the browser).
 */
export function Leaderboard({
  standings,
  meId,
  detailed = false,
}: {
  standings: StandingView[];
  meId: string;
  detailed?: boolean;
}) {
  const previous = useRef<Map<string, number>>(new Map());
  const last = previous.current;
  useEffect(() => {
    previous.current = new Map(standings.map((s) => [s.playerId, s.rank]));
  }, [standings]);

  return (
    <ol className="divide-y divide-white/12 overflow-hidden rounded-3xl bg-cobalt-900/70">
      {standings.map((s) => {
        const before = last.get(s.playerId);
        const moved = before === undefined ? 0 : before - s.rank;
        const isMe = s.playerId === meId;
        return (
          <li
            key={s.playerId}
            className={`flex items-center gap-3 px-4 py-3 sm:px-5 ${isMe ? 'bg-white/8' : ''}`}
          >
            <span className="display w-8 text-center text-xl tabular-nums text-cobalt-200">{s.rank}</span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className={`truncate font-semibold ${s.connected ? '' : 'text-white/55'}`}>{s.name}</span>
                {isMe && <span className="rounded-pill bg-sun px-2 py-0.5 text-xs font-bold text-cobalt-950">You</span>}
                {!s.connected && (
                  <>
                    <Icon name="wifiOff" size={16} className="text-white/50" />
                    <span className="sr-only">offline</span>
                  </>
                )}
              </span>
              {detailed && (
                <span className="mt-0.5 block text-sm text-cobalt-200">
                  {s.correct} right, {s.incorrect} wrong, {s.unanswered} missed, {Math.round(s.accuracy * 100)}% accuracy
                </span>
              )}
            </span>
            {moved !== 0 && (
              <span className={`flex items-center text-sm font-semibold ${moved > 0 ? 'text-mint' : 'text-coral'}`}>
                <Icon name={moved > 0 ? 'up' : 'down'} size={16} />
                <span className="sr-only">{moved > 0 ? 'up' : 'down'}</span>
                {Math.abs(moved)}
              </span>
            )}
            <span className="display text-2xl tabular-nums">{s.score}</span>
          </li>
        );
      })}
    </ol>
  );
}
