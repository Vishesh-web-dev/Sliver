/**
 * The countdown: a fuse that burns down from the right, with the seconds
 * beside it. Both come from server timestamps (via the clock offset), so every
 * player sees the same deadline whatever their network or device clock.
 */
export function Fuse({
  startedAt,
  endsAt,
  now,
  label = 'Time left',
}: {
  startedAt: number;
  endsAt: number;
  now: number;
  label?: string;
}) {
  const total = Math.max(1, endsAt - startedAt);
  const left = Math.max(0, endsAt - now);
  const fraction = Math.min(1, left / total);
  const seconds = Math.ceil(left / 1000);
  const urgent = left <= 5_000;

  return (
    <div className="flex items-center gap-4">
      <div
        className="relative h-3 flex-1 overflow-hidden rounded-pill bg-white/14"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={Math.round(total / 1000)}
        aria-valuenow={seconds}
      >
        <div
          className={`fuse absolute inset-y-0 left-0 rounded-pill ${urgent ? 'bg-coral' : 'bg-sun'}`}
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
      <span
        className={`display w-[3ch] text-right text-4xl tabular-nums ${urgent ? 'text-coral' : 'text-white'}`}
        aria-hidden="true"
      >
        {seconds}
      </span>
    </div>
  );
}
