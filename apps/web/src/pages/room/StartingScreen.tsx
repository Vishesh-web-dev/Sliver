import type { GameView } from '@sliver/shared';
import { useServerNow } from '../../lib/useRoom';

export function StartingScreen({ game, serverNow }: { game: GameView; serverNow: () => number }) {
  const now = useServerNow(serverNow, true, 100);
  const left = Math.max(0, Math.ceil(((game.phaseEndsAt ?? now) - now) / 1000));
  return (
    <div className="my-auto flex flex-col items-center py-16 text-center" role="status" aria-live="polite">
      <p className="text-lg text-cobalt-100">Get ready</p>
      <p key={left} className="display pop-in mt-4 text-[clamp(8rem,40vw,14rem)] text-sun tabular-nums">
        {left || 'Go'}
      </p>
      <p className="mt-6 max-w-sm text-cobalt-100">
        {game.questionCount} questions, {game.questionDurationSec} seconds each. Read every word.
      </p>
    </div>
  );
}
