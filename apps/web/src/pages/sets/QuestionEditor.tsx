import { useId, useState } from 'react';
import {
  DEFAULT_DIFFICULTY_POINTS,
  DIFFICULTIES,
  LIMITS,
  difficultyKey,
  isShortAnswerCorrect,
} from '@sliver/shared';
import { Fuse } from '../../components/Fuse';
import { Icon } from '../../components/Icon';
import { QuestionView, letter } from '../../components/QuestionView';
import { Toggle } from '../../components/Toggle';
import { Wedge } from '../../components/Wedge';
import type { DraftQuestion } from './draft';

interface Props {
  question: DraftQuestion;
  index: number;
  count: number;
  errors: Map<string, string>;
  readOnly: boolean;
  onChange: (next: DraftQuestion) => void;
  onMove: (delta: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1.5 text-sm font-medium text-[#b42318]">{message}</p>;
}

/** One question, laid out for people who have never seen a form builder. */
export function QuestionEditor({ question: q, index, count, errors, readOnly, onChange, onMove, onDuplicate, onDelete }: Props) {
  const id = useId();
  const [preview, setPreview] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = <K extends keyof DraftQuestion>(key: K, value: DraftQuestion[K]) => onChange({ ...q, [key]: value });
  const defaultPoints = DEFAULT_DIFFICULTY_POINTS[difficultyKey(q.difficulty)];
  const hasErrors = errors.size > 0;

  return (
    <article
      className={`rounded-3xl bg-white p-5 ring-1 sm:p-7 ${hasErrors ? 'ring-2 ring-[#f3c4bf]' : 'ring-cobalt-100'}`}
      aria-labelledby={`${id}-title`}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h3 id={`${id}-title`} className="display-tight flex items-center gap-3 text-xl">
          <Wedge value={q.difficulty} size={30} />
          Question {index + 1}
        </h3>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setPreview((p) => !p)} aria-pressed={preview}>
            <Icon name="eye" size={16} />
            {preview ? 'Back to editing' : 'Preview'}
          </button>
          {!readOnly && (
            <>
              <button type="button" className="btn btn-outline btn-sm px-2.5" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up">
                <Icon name="up" size={16} />
              </button>
              <button type="button" className="btn btn-outline btn-sm px-2.5" disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Move down">
                <Icon name="down" size={16} />
              </button>
              <button type="button" className="btn btn-outline btn-sm px-2.5" onClick={onDuplicate} aria-label="Duplicate question">
                <Icon name="duplicate" size={16} />
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => {
                  if (confirmDelete) onDelete();
                  else {
                    setConfirmDelete(true);
                    setTimeout(() => setConfirmDelete(false), 4000);
                  }
                }}
              >
                <Icon name="trash" size={16} />
                {confirmDelete ? 'Tap again' : <span className="sr-only">Delete question</span>}
              </button>
            </>
          )}
        </div>
      </header>

      {preview ? (
        <Preview question={q} index={index} count={count} defaultPoints={defaultPoints} />
      ) : (
        <fieldset disabled={readOnly} className="mt-6 space-y-6">
          <div>
            <span className="label">Answer type</span>
            <div className="inline-flex rounded-pill bg-cobalt-50 p-1 ring-1 ring-cobalt-100" role="radiogroup" aria-label="Answer type">
              {(['MCQ', 'SHORT'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={q.type === t}
                  onClick={() => set('type', t)}
                  className={`rounded-pill px-4 py-2 text-sm font-semibold transition-colors ${q.type === t ? 'bg-cobalt-700 text-white' : 'text-cobalt-950/70 hover:text-cobalt-950'}`}
                >
                  {t === 'MCQ' ? 'Multiple choice' : 'Typed answer'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="label" id={`${id}-difficulty`}>
              Difficulty: how many people get this right?
            </span>
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-12" role="radiogroup" aria-labelledby={`${id}-difficulty`}>
              {DIFFICULTIES.map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={q.difficulty === d}
                  onClick={() => set('difficulty', d)}
                  className={`flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-sm font-semibold tabular-nums transition-colors ${
                    q.difficulty === d ? 'bg-cobalt-700 text-white' : 'bg-cobalt-50 text-cobalt-950 hover:bg-cobalt-100'
                  }`}
                >
                  <Wedge value={d} size={20} onDark={q.difficulty === d} />
                  {d}%
                </button>
              ))}
            </div>
            <p className="mt-2 text-sm text-cobalt-950/60">90% is easy, 1% is fiendish. Harder questions score more.</p>
          </div>

          <label className="block">
            <span className="label">Question</span>
            <textarea
              className="field-paper min-h-24 resize-y text-lg"
              value={q.prompt}
              maxLength={LIMITS.prompt}
              aria-invalid={errors.has('prompt')}
              onChange={(e) => set('prompt', e.target.value)}
              placeholder="What comes next? 2, 4, 8, 16, ?"
            />
            <FieldError message={errors.get('prompt')} />
          </label>

          {q.type === 'MCQ' ? (
            <McqOptions q={q} errors={errors} onChange={onChange} />
          ) : (
            <ShortAnswers q={q} errors={errors} onChange={onChange} />
          )}

          <label className="block">
            <span className="label">
              Explanation <span className="font-normal text-cobalt-950/55">(optional, shown after the answer)</span>
            </span>
            <textarea
              className="field-paper min-h-16 resize-y"
              value={q.explanation}
              maxLength={LIMITS.explanation}
              onChange={(e) => set('explanation', e.target.value)}
              placeholder="The number doubles each time."
            />
            <FieldError message={errors.get('explanation')} />
          </label>

          <label className="block sm:max-w-xs">
            <span className="label">Points</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={LIMITS.pointsMax}
              className="field-paper"
              value={q.points}
              aria-invalid={errors.has('points')}
              onChange={(e) => set('points', e.target.value)}
              placeholder={`${defaultPoints} (from difficulty)`}
            />
            <span className="mt-1.5 block text-sm text-cobalt-950/60">
              Leave empty to use the game’s points for {q.difficulty}%.
            </span>
            <FieldError message={errors.get('points')} />
          </label>
        </fieldset>
      )}
    </article>
  );
}

function McqOptions({ q, errors, onChange }: { q: DraftQuestion; errors: Map<string, string>; onChange: (q: DraftQuestion) => void }) {
  const name = useId();
  const setOption = (i: number, value: string) => onChange({ ...q, options: q.options.map((o, j) => (j === i ? value : o)) });
  const removeOption = (i: number) => {
    const options = q.options.filter((_, j) => j !== i);
    const correctOption = q.correctOption === null ? null : q.correctOption === i ? null : q.correctOption > i ? q.correctOption - 1 : q.correctOption;
    onChange({ ...q, options, correctOption });
  };

  return (
    <div>
      <span className="label">Options, and which one is correct</span>
      <ul className="space-y-2">
        {q.options.map((option, i) => {
          const error = errors.get(`options.${i}`);
          const correct = q.correctOption === i;
          return (
            <li key={i}>
              <div className={`flex items-center gap-2 rounded-xl p-1 ${correct ? 'bg-[#e8fbf3] ring-1 ring-[#8ce9c4]' : ''}`}>
                <label className="flex shrink-0 cursor-pointer items-center gap-2 pl-2" title="Mark as the correct answer">
                  <input
                    type="radio"
                    name={name}
                    checked={correct}
                    onChange={() => onChange({ ...q, correctOption: i })}
                    className="h-5 w-5 accent-[#0f9f6e]"
                    aria-label={`Option ${letter(i)} is correct`}
                  />
                  <span className="w-5 font-bold">{letter(i)}</span>
                </label>
                <input
                  className="field-paper"
                  value={option}
                  maxLength={LIMITS.option}
                  aria-invalid={Boolean(error)}
                  aria-label={`Option ${letter(i)}`}
                  onChange={(e) => setOption(i, e.target.value)}
                  placeholder={`Option ${letter(i)}`}
                />
                <button
                  type="button"
                  className="btn btn-outline btn-sm shrink-0 px-2.5"
                  disabled={q.options.length <= LIMITS.optionsMin}
                  onClick={() => removeOption(i)}
                  aria-label={`Remove option ${letter(i)}`}
                >
                  <Icon name="x" size={16} />
                </button>
              </div>
              <FieldError message={error} />
            </li>
          );
        })}
      </ul>
      <FieldError message={errors.get('correctOption') ?? errors.get('options')} />
      {q.options.length < LIMITS.optionsMax && (
        <button type="button" className="btn btn-outline btn-sm mt-3" onClick={() => onChange({ ...q, options: [...q.options, ''] })}>
          <Icon name="plus" size={16} />
          Add option
        </button>
      )}
      <p className="mt-2 text-sm text-cobalt-950/60">Tick the circle next to the right answer.</p>
    </div>
  );
}

function ShortAnswers({ q, errors, onChange }: { q: DraftQuestion; errors: Map<string, string>; onChange: (q: DraftQuestion) => void }) {
  const [trial, setTrial] = useState('');
  const accepted = q.acceptedAnswers.filter((a) => a.trim());
  const verdict = trial.trim() ? isShortAnswerCorrect(trial, accepted, { caseSensitive: q.caseSensitive }) : null;
  const setAnswer = (i: number, value: string) =>
    onChange({ ...q, acceptedAnswers: q.acceptedAnswers.map((a, j) => (j === i ? value : a)) });

  return (
    <div className="space-y-4">
      <div>
        <span className="label">Correct answer, plus any other wording you’ll accept</span>
        <ul className="space-y-2">
          {q.acceptedAnswers.map((answer, i) => (
            <li key={i} className="flex items-center gap-2">
              <input
                className="field-paper"
                value={answer}
                maxLength={LIMITS.acceptedAnswer}
                aria-label={i === 0 ? 'Correct answer' : `Also accept ${i}`}
                aria-invalid={Boolean(errors.get(`acceptedAnswers.${i}`))}
                onChange={(e) => setAnswer(i, e.target.value)}
                placeholder={i === 0 ? '32' : 'thirty-two'}
              />
              <button
                type="button"
                className="btn btn-outline btn-sm shrink-0 px-2.5"
                disabled={q.acceptedAnswers.length <= 1}
                onClick={() => onChange({ ...q, acceptedAnswers: q.acceptedAnswers.filter((_, j) => j !== i) })}
                aria-label="Remove this answer"
              >
                <Icon name="x" size={16} />
              </button>
            </li>
          ))}
        </ul>
        <FieldError message={errors.get('acceptedAnswers')} />
        {q.acceptedAnswers.length < LIMITS.acceptedAnswersMax && (
          <button
            type="button"
            className="btn btn-outline btn-sm mt-3"
            onClick={() => onChange({ ...q, acceptedAnswers: [...q.acceptedAnswers, ''] })}
          >
            <Icon name="plus" size={16} />
            Accept another wording
          </button>
        )}
        <p className="mt-2 text-sm text-cobalt-950/60">
          Capitals, spaces, punctuation and accents are ignored, and numbers match by value (32 = 32.0).
        </p>
      </div>

      <Toggle
        tone="paper"
        label="Capital letters matter"
        hint="Only for answers like chemical symbols, where pH and PH differ."
        checked={q.caseSensitive}
        onChange={(v) => onChange({ ...q, caseSensitive: v })}
      />

      <div className="rounded-2xl bg-cobalt-50 p-4">
        <label className="block">
          <span className="label">Try an answer the way a player might type it</span>
          <input className="field-paper" value={trial} onChange={(e) => setTrial(e.target.value)} placeholder="Thirty two" />
        </label>
        {verdict !== null && (
          <p className={`mt-2 flex items-center gap-2 text-sm font-semibold ${verdict ? 'text-[#0b7a55]' : 'text-[#b42318]'}`} role="status">
            <Icon name={verdict ? 'check' : 'x'} size={16} />
            {verdict ? 'This would count as correct.' : 'This would be marked wrong.'}
          </p>
        )}
      </div>
    </div>
  );
}

function Preview({ question, index, count, defaultPoints }: { question: DraftQuestion; index: number; count: number; defaultPoints: number }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [text, setText] = useState('');
  const points = question.points.trim() === '' ? defaultPoints : Number(question.points);
  return (
    <div className="mt-6 rounded-3xl bg-cobalt-700 p-5 text-white sm:p-7">
      <QuestionView
        question={{
          id: question.key,
          index,
          type: question.type,
          difficulty: question.difficulty,
          prompt: question.prompt || 'Your question appears here.',
          options: question.type === 'MCQ' ? question.options.map((o, i) => o || `Option ${letter(i)}`) : null,
          points,
        }}
        total={count}
        timer={<Fuse startedAt={0} endsAt={30_000} now={9_000} label="Preview timer" />}
        selected={selected}
        onSelect={setSelected}
        text={text}
        onText={setText}
        locked={null}
        closed={false}
        submitting={false}
        onSubmit={() => undefined}
      />
      <p className="mt-4 text-center text-sm text-cobalt-200">This is what players see. Nothing is submitted.</p>
    </div>
  );
}
