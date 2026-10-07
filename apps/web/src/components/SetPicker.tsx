import { Link } from 'react-router';
import type { QuestionSetSummary } from '@sliver/shared';

/** Radio list of the question sets this browser can play (built-in + its own). */
export function SetPicker({
  sets,
  value,
  onChange,
  returnTo,
  disabled = false,
}: {
  sets: QuestionSetSummary[] | null;
  value: string | null;
  onChange: (id: string) => void;
  /** Where the editor's "back" link should return to. */
  returnTo: string;
  disabled?: boolean;
}) {
  if (!sets) return <p className="text-cobalt-200">Loading question sets…</p>;

  return (
    <fieldset disabled={disabled}>
      <legend className="label">Question set</legend>
      <div className="divide-y divide-white/12 overflow-hidden rounded-2xl bg-cobalt-900/60">
        {sets.map((set) => {
          const selected = set.id === value;
          return (
            <label
              key={set.id}
              className={`flex cursor-pointer items-center gap-4 px-4 py-3.5 transition-colors ${selected ? 'bg-white/10' : 'hover:bg-white/5'}`}
            >
              <input
                type="radio"
                name="question-set"
                className="h-5 w-5 shrink-0 accent-[#ffcb2e]"
                checked={selected}
                onChange={() => onChange(set.id)}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{set.name}</span>
                <span className="block text-sm text-cobalt-200">
                  {set.questionCount === 0
                    ? 'No questions yet'
                    : `${set.questionCount} question${set.questionCount === 1 ? '' : 's'}`}
                  {set.isBuiltin ? ', ready-made' : ''}
                </span>
              </span>
              {set.isOwner && (
                <Link
                  to={`/sets/${set.id}?return=${encodeURIComponent(returnTo)}`}
                  className="text-sm font-semibold text-sun underline-offset-4 hover:underline"
                >
                  Edit
                </Link>
              )}
            </label>
          );
        })}
      </div>
      <Link
        to={`/sets/new?return=${encodeURIComponent(returnTo)}`}
        className="mt-3 inline-block text-sm font-semibold text-sun underline-offset-4 hover:underline"
      >
        Write your own questions
      </Link>
    </fieldset>
  );
}
