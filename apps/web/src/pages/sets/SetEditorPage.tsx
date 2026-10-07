import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { LIMITS, type QuestionSetDetail } from '@sliver/shared';
import { Icon } from '../../components/Icon';
import { Backstage, ErrorText } from '../../components/Shell';
import { api, ApiError } from '../../lib/api';
import {
  blankQuestion,
  duplicateQuestion,
  emptySet,
  fromDetail,
  questionErrors,
  validateDraft,
  type DraftQuestion,
  type DraftSet,
} from './draft';
import { QuestionEditor } from './QuestionEditor';

const snapshot = (d: DraftSet) => JSON.stringify({ ...d, questions: d.questions.map(({ key: _k, ...q }) => q) });

export function SetEditorPage() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const returnTo = search.get('return');
  const isNew = !id;

  const [meta, setMeta] = useState<QuestionSetDetail | null>(null);
  const [draft, setDraft] = useState<DraftSet | null>(isNew ? emptySet() : null);
  const [saved, setSaved] = useState<string>(() => (isNew ? snapshot(emptySet()) : ''));
  const [showErrors, setShowErrors] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  useEffect(() => {
    if (isNew) return;
    api
      .getSet(id)
      .then((set) => {
        const d = fromDetail(set);
        setMeta(set);
        setDraft(d);
        setSaved(snapshot(d));
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Could not load this set.'));
  }, [id, isNew]);

  const dirty = draft !== null && snapshot(draft) !== saved;
  const validation = useMemo(() => (draft ? validateDraft(draft) : null), [draft]);
  const errors = showErrors && validation ? validation.errors : new Map<string, string>();
  const readOnly = Boolean(meta && (!meta.isOwner || meta.isLocked));

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  if (!draft) {
    return (
      <Backstage>
        {error ? <ErrorText tone="paper">{error}</ErrorText> : <p className="text-cobalt-950/60">Loading…</p>}
        <Link to="/sets" className="btn btn-outline mt-6">
          Back to question sets
        </Link>
      </Backstage>
    );
  }

  const update = (next: DraftSet) => {
    setDraft(next);
    setStatus('idle');
  };
  const updateQuestion = (index: number, q: DraftQuestion) =>
    update({ ...draft, questions: draft.questions.map((x, i) => (i === index ? q : x)) });
  const move = (index: number, delta: -1 | 1) => {
    const questions = [...draft.questions];
    const [q] = questions.splice(index, 1);
    questions.splice(index + delta, 0, q!);
    update({ ...draft, questions });
  };
  const addQuestion = (type: 'MCQ' | 'SHORT') => {
    const last = draft.questions.at(-1);
    update({ ...draft, questions: [...draft.questions, blankQuestion(type, last?.difficulty ?? 50)] });
  };

  const save = async () => {
    setShowErrors(true);
    setError('');
    if (!validation?.input) {
      setError('Some questions need fixing before you can save. They’re outlined in red.');
      return;
    }
    setStatus('saving');
    try {
      const result = isNew ? await api.createSet(validation.input) : await api.updateSet(id, validation.input);
      const d = fromDetail(result);
      setMeta(result);
      setDraft(d);
      setSaved(snapshot(d));
      setShowErrors(false);
      setStatus('saved');
      if (isNew) navigate(`/sets/${result.id}${returnTo ? `?return=${encodeURIComponent(returnTo)}` : ''}`, { replace: true });
    } catch (err) {
      setStatus('idle');
      setError(err instanceof ApiError ? err.message : 'Could not save. Try again.');
    }
  };

  const duplicateSet = async () => {
    if (!meta) return;
    try {
      const copy = await api.duplicateSet(meta.id);
      navigate(`/sets/${copy.id}${returnTo ? `?return=${encodeURIComponent(returnTo)}` : ''}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not copy the set.');
    }
  };

  const problemCount = validation ? new Set([...validation.errors.keys()].map((k) => k.split('.').slice(0, 2).join('.'))).size : 0;

  return (
    <Backstage
      right={
        <Link to={returnTo ?? '/sets'} className="btn btn-outline btn-sm">
          <Icon name="back" size={16} />
          {returnTo?.startsWith('/room/') ? 'Back to the game' : returnTo === '/create' ? 'Back to new game' : 'All sets'}
        </Link>
      }
    >
      {meta && !meta.isOwner && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-cobalt-50 px-5 py-4 ring-1 ring-cobalt-100">
          <p>This is a ready-made set, so it can’t be changed. Make a copy to edit it.</p>
          <button type="button" className="btn btn-ink btn-sm" onClick={duplicateSet}>
            <Icon name="duplicate" size={16} />
            Duplicate to edit
          </button>
        </div>
      )}
      {meta?.isOwner && meta.isLocked && (
        <p className="mb-6 rounded-2xl bg-sun-200 px-5 py-4 text-cobalt-950">
          A game is playing this set right now, so it’s locked. You can edit it again when that game ends.
        </p>
      )}

      <fieldset disabled={readOnly} className="space-y-5">
        <label className="block">
          <span className="label">Set name</span>
          <input
            className="field-paper display-tight text-2xl"
            value={draft.name}
            maxLength={LIMITS.setName}
            aria-invalid={errors.has('name')}
            onChange={(e) => update({ ...draft, name: e.target.value })}
            placeholder="Friday night quiz"
          />
          {errors.get('name') && <p className="mt-1.5 text-sm font-medium text-[#b42318]">{errors.get('name')}</p>}
        </label>
        <label className="block">
          <span className="label">
            Description <span className="font-normal text-cobalt-950/55">(optional)</span>
          </span>
          <input
            className="field-paper"
            value={draft.description}
            maxLength={LIMITS.setDescription}
            onChange={(e) => update({ ...draft, description: e.target.value })}
            placeholder="Office party, round two"
          />
        </label>
      </fieldset>

      <h2 className="display-tight mt-10 mb-4 flex items-baseline justify-between text-2xl">
        Questions
        <span className="text-base font-semibold text-cobalt-950/60 tabular-nums">{draft.questions.length}</span>
      </h2>

      <div className="space-y-5">
        {draft.questions.map((q, i) => (
          <QuestionEditor
            key={q.key}
            question={q}
            index={i}
            count={draft.questions.length}
            errors={questionErrors(errors, i)}
            readOnly={readOnly}
            onChange={(next) => updateQuestion(i, next)}
            onMove={(delta) => move(i, delta)}
            onDuplicate={() =>
              update({
                ...draft,
                questions: [...draft.questions.slice(0, i + 1), duplicateQuestion(q), ...draft.questions.slice(i + 1)],
              })
            }
            onDelete={() => update({ ...draft, questions: draft.questions.filter((_, j) => j !== i) })}
          />
        ))}
        {draft.questions.length === 0 && (
          <p className="rounded-2xl border border-dashed border-cobalt-200 bg-white px-5 py-6 text-cobalt-950/75">
            No questions yet. Add one below. A good game has around 12, getting harder as it goes.
          </p>
        )}
      </div>

      {!readOnly && draft.questions.length < LIMITS.questionsPerSet && (
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" className="btn btn-outline" onClick={() => addQuestion('MCQ')}>
            <Icon name="plus" />
            Add a multiple-choice question
          </button>
          <button type="button" className="btn btn-outline" onClick={() => addQuestion('SHORT')}>
            <Icon name="plus" />
            Add a typed-answer question
          </button>
        </div>
      )}

      {!readOnly && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-cobalt-100 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-8">
            <p className="text-sm" role="status" aria-live="polite">
              {status === 'saving'
                ? 'Saving…'
                : showErrors && problemCount > 0
                  ? `${problemCount} ${problemCount === 1 ? 'thing needs' : 'things need'} fixing`
                  : dirty
                    ? 'Unsaved changes'
                    : status === 'saved'
                      ? 'All changes saved'
                      : isNew
                        ? 'New set, not saved yet'
                        : 'No changes'}
            </p>
            <button type="button" className="btn btn-ink" disabled={status === 'saving' || (!dirty && !isNew)} onClick={save}>
              {isNew ? 'Save set' : 'Save changes'}
            </button>
          </div>
          {error && (
            <p role="alert" className="mx-auto max-w-4xl px-5 pb-3 text-sm font-medium text-[#b42318] sm:px-8">
              {error}
            </p>
          )}
        </div>
      )}
      {readOnly && <ErrorText tone="paper">{error}</ErrorText>}
    </Backstage>
  );
}

