import { useEffect, useRef, type FormEvent, type ReactNode } from 'react';
import type { MyAnswer, PublicQuestion } from '@sliver/shared';
import { Icon } from './Icon';
import { Wedge } from './Wedge';

export const letter = (i: number) => String.fromCharCode(65 + i);

/**
 * How a question looks to a player. Used live in the game and as the preview
 * in the question editor, so hosts see exactly what players will see.
 */
export function QuestionView({
  question,
  total,
  timer,
  selected,
  onSelect,
  text,
  onText,
  locked,
  closed,
  submitting,
  onSubmit,
  animateWedge = true,
  children,
}: {
  question: PublicQuestion;
  total: number;
  timer: ReactNode;
  selected: number | null;
  onSelect: (index: number) => void;
  text: string;
  onText: (value: string) => void;
  /** The answer the server accepted, if any. */
  locked: MyAnswer | null;
  /** Time is up (client-side view of the server deadline). */
  closed: boolean;
  submitting: boolean;
  onSubmit: () => void;
  animateWedge?: boolean;
  children?: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const interactive = !locked && !closed && !submitting;

  // Keyboard: A–F (or 1–6) choose an option, Enter locks it in.
  useEffect(() => {
    if (question.type !== 'MCQ' || !interactive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest('input, textarea, select')) return;
      const options = question.options ?? [];
      const byLetter = e.key.length === 1 ? e.key.toUpperCase().charCodeAt(0) - 65 : -1;
      const byNumber = /^[1-6]$/.test(e.key) ? Number(e.key) - 1 : -1;
      const index = byLetter >= 0 && byLetter < options.length ? byLetter : byNumber;
      if (index >= 0 && index < options.length) {
        e.preventDefault();
        onSelect(index);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [interactive, onSelect, question]);

  useEffect(() => {
    if (question.type === 'SHORT' && interactive) inputRef.current?.focus({ preventScroll: true });
    // Focus once when the question opens.
  }, [question.id]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (interactive) onSubmit();
  };

  const canSubmit = interactive && (question.type === 'MCQ' ? selected !== null : text.trim().length > 0);

  return (
    <form onSubmit={submit} className="flex flex-1 flex-col" noValidate>
      <div className="flex items-center gap-4">
        <Wedge value={question.difficulty} size={64} animate={animateWedge} />
        <div className="min-w-0 flex-1">
          <p className="display text-4xl tabular-nums">{question.difficulty}%</p>
          <p className="text-sm text-cobalt-200">
            Question {question.index + 1} of {total}, worth {question.points} points
          </p>
        </div>
      </div>

      <div className="mt-6">{timer}</div>

      <h1 className="mt-8 text-[clamp(1.5rem,5.4vw,2.1rem)] leading-snug font-semibold whitespace-pre-line">
        {question.prompt}
      </h1>

      <div className="mt-8">
        {question.type === 'MCQ' ? (
          <div role="radiogroup" aria-label="Answers" className="grid gap-3">
            {(question.options ?? []).map((option, i) => {
              const isChosen = locked ? locked.optionIndex === i : selected === i;
              return (
                <button
                  key={i}
                  type="button"
                  role="radio"
                  aria-checked={isChosen}
                  disabled={!interactive}
                  onClick={() => onSelect(i)}
                  className={`flex min-h-16 w-full items-center gap-4 rounded-2xl px-4 py-3 text-left text-lg font-medium transition-[background-color,transform,box-shadow] duration-150 ${
                    isChosen
                      ? 'bg-sun text-cobalt-950'
                      : 'bg-white/10 text-white enabled:hover:bg-white/16 disabled:opacity-60'
                  } enabled:active:scale-[0.99]`}
                >
                  <span
                    className={`display-tight flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg ${
                      isChosen ? 'bg-cobalt-950 text-sun' : 'bg-white/14'
                    }`}
                    aria-hidden="true"
                  >
                    {letter(i)}
                  </span>
                  <span className="min-w-0 flex-1">{option}</span>
                  {locked && isChosen && <Icon name="lock" />}
                </button>
              );
            })}
          </div>
        ) : (
          <label className="block">
            <span className="sr-only">Your answer</span>
            <input
              ref={inputRef}
              className="field min-h-16 text-xl"
              value={locked ? (locked.text ?? '') : text}
              onChange={(e) => onText(e.target.value)}
              disabled={!interactive}
              placeholder="Type your answer"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              maxLength={200}
              enterKeyHint="done"
            />
            <span className="mt-2 block text-sm text-cobalt-200">Spelling counts; capitals and punctuation don’t.</span>
          </label>
        )}
      </div>

      <div className="mt-8">
        {locked ? (
          <p className="pop-in flex min-h-14 items-center justify-center gap-2 rounded-pill bg-cobalt-950/45 px-6 text-lg font-semibold" role="status">
            <Icon name="lock" />
            Answer locked
          </p>
        ) : closed ? (
          <p className="flex min-h-14 items-center justify-center rounded-pill bg-cobalt-950/45 px-6 text-lg font-semibold" role="status">
            Time’s up
          </p>
        ) : (
          <button type="submit" className="btn btn-sun min-h-14 w-full text-lg" disabled={!canSubmit}>
            {submitting ? 'Locking in…' : 'Lock in answer'}
          </button>
        )}
      </div>

      {children}
    </form>
  );
}
