import { DIFFICULTIES, TIMING, difficultyKey, type GameSettings } from '@sliver/shared';
import { Toggle } from './Toggle';
import { Wedge } from './Wedge';

const PAUSES = [5, 8, 10, 15, 20];
const PENALTIES = [
  { value: 0, label: 'No, a wrong answer scores 0' },
  { value: 25, label: 'Lose 25% of the question’s points' },
  { value: 50, label: 'Lose 50% of the question’s points' },
  { value: 100, label: 'Lose all of the question’s points' },
];

/** Game settings on the stage (create screen and the host's lobby panel). */
export function SettingsForm({
  value,
  onChange,
  setSize,
  disabled = false,
}: {
  value: GameSettings;
  onChange: (next: GameSettings) => void;
  /** Questions in the chosen set; bounds "number of questions". */
  setSize: number;
  disabled?: boolean;
}) {
  const update = <K extends keyof GameSettings>(key: K, v: GameSettings[K]) => onChange({ ...value, [key]: v });
  const count = value.questionCount === null ? 'all' : String(Math.min(value.questionCount, Math.max(setSize, 1)));

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">Questions to play</span>
          <select
            className="field"
            value={count}
            disabled={disabled || setSize === 0}
            onChange={(e) => update('questionCount', e.target.value === 'all' ? null : Number(e.target.value))}
          >
            <option value="all">All of them{setSize ? ` (${setSize})` : ''}</option>
            {Array.from({ length: Math.max(0, setSize - 1) }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                First {n}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Pause between questions</span>
          <select
            className="field"
            value={value.resultsDurationSec}
            disabled={disabled}
            onChange={(e) => update('resultsDurationSec', Number(e.target.value))}
          >
            {PAUSES.map((s) => (
              <option key={s} value={s}>
                {s} seconds
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="text-sm text-cobalt-200">
        Every question gets {TIMING.questionDurationSec.default} seconds, timed by the server.
      </p>

      <div className="divide-y divide-white/12 rounded-2xl bg-cobalt-900/60 px-4">
        <Toggle
          label="Show explanations"
          hint="After each question, show why the answer is right."
          checked={value.showExplanations}
          disabled={disabled}
          onChange={(v) => update('showExplanations', v)}
        />
        <Toggle
          label="Show the leaderboard after every question"
          hint="Off keeps the standings secret until the end."
          checked={value.showLeaderboardAfterEachQuestion}
          disabled={disabled}
          onChange={(v) => update('showLeaderboardAfterEachQuestion', v)}
        />
      </div>

      <details className="group rounded-2xl bg-cobalt-900/60 px-4 py-3">
        <summary className="cursor-pointer list-none font-medium select-none">
          <span className="flex items-center justify-between">
            Points
            <span className="text-sm text-cobalt-200 group-open:hidden">Harder questions are worth more</span>
          </span>
        </summary>
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            {DIFFICULTIES.map((d) => (
              <label key={d} className="flex items-center gap-3">
                <Wedge value={d} size={22} />
                <span className="w-10 text-sm font-semibold tabular-nums">{d}%</span>
                <input
                  type="number"
                  min={0}
                  max={10000}
                  inputMode="numeric"
                  className="field w-full px-3 py-1.5 text-base"
                  value={value.scoring.difficultyPoints[difficultyKey(d)]}
                  disabled={disabled}
                  onChange={(e) =>
                    update('scoring', {
                      ...value.scoring,
                      difficultyPoints: {
                        ...value.scoring.difficultyPoints,
                        [difficultyKey(d)]: Math.max(0, Math.min(10000, Math.round(Number(e.target.value) || 0))),
                      },
                    })
                  }
                  aria-label={`Points for ${d}% questions`}
                />
              </label>
            ))}
          </div>
          <label className="block">
            <span className="label">Do wrong answers lose points?</span>
            <select
              className="field"
              value={value.scoring.wrongAnswerPenaltyPercent}
              disabled={disabled}
              onChange={(e) =>
                update('scoring', { ...value.scoring, wrongAnswerPenaltyPercent: Number(e.target.value) })
              }
            >
              {PENALTIES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </details>
    </div>
  );
}
