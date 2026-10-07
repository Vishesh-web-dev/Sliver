import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { QuestionSetSummary } from '@sliver/shared';
import { Icon } from '../../components/Icon';
import { Backstage, ErrorText } from '../../components/Shell';
import { api, ApiError } from '../../lib/api';

export function SetsPage() {
  const navigate = useNavigate();
  const [sets, setSets] = useState<QuestionSetSummary[] | null>(null);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = () =>
    api
      .listSets()
      .then(setSets)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Could not load your sets.'));

  useEffect(() => {
    void load();
  }, []);

  const duplicate = async (id: string) => {
    try {
      const copy = await api.duplicateSet(id);
      navigate(`/sets/${copy.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not copy the set.');
    }
  };

  const remove = async (id: string) => {
    if (confirming !== id) {
      setConfirming(id);
      setTimeout(() => setConfirming((c) => (c === id ? null : c)), 4000);
      return;
    }
    try {
      await api.deleteSet(id);
      setConfirming(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the set.');
    }
  };

  const mine = sets?.filter((s) => s.isOwner) ?? [];
  const builtin = sets?.filter((s) => s.isBuiltin) ?? [];

  return (
    <Backstage
      right={
        <Link to="/create" className="btn btn-ink btn-sm">
          Create a game
        </Link>
      }
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-4xl sm:text-5xl">Question sets</h1>
          <p className="mt-2 max-w-xl text-cobalt-950/70">
            Write your own questions here, then pick the set when you create a game. A set can’t be changed while
            a game is playing it.
          </p>
        </div>
        <Link to="/sets/new" className="btn btn-ink">
          <Icon name="plus" />
          New set
        </Link>
      </div>

      <ErrorText tone="paper">{error}</ErrorText>

      <h2 className="display-tight mt-10 mb-3 text-xl">Yours</h2>
      {sets && mine.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-cobalt-200 bg-white px-5 py-6 text-cobalt-950/75">
          You haven’t written any questions yet. Start a new set, or copy a ready-made one below and change it.
        </p>
      ) : (
        <SetList sets={mine} confirming={confirming} onDuplicate={duplicate} onDelete={remove} />
      )}

      <h2 className="display-tight mt-10 mb-3 text-xl">Ready-made</h2>
      <SetList sets={builtin} confirming={confirming} onDuplicate={duplicate} onDelete={remove} />
      {!sets && !error && <p className="text-cobalt-950/60">Loading…</p>}
    </Backstage>
  );
}

function SetList({
  sets,
  confirming,
  onDuplicate,
  onDelete,
}: {
  sets: QuestionSetSummary[];
  confirming: string | null;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (sets.length === 0) return null;
  return (
    <ul className="divide-y divide-cobalt-100 overflow-hidden rounded-2xl bg-white ring-1 ring-cobalt-100">
      {sets.map((set) => (
        <li key={set.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
          <div className="min-w-0 flex-1">
            <Link to={`/sets/${set.id}`} className="font-semibold underline-offset-4 hover:underline">
              {set.name}
            </Link>
            <p className="text-sm text-cobalt-950/65">
              {set.questionCount} question{set.questionCount === 1 ? '' : 's'}
              {set.isLocked && <span className="ml-2 font-semibold text-cobalt-700">Being played now</span>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to={`/sets/${set.id}`} className="btn btn-outline btn-sm">
              <Icon name={set.isOwner ? 'edit' : 'eye'} size={16} />
              {set.isOwner ? 'Edit' : 'View'}
            </Link>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => onDuplicate(set.id)}>
              <Icon name="duplicate" size={16} />
              Duplicate
            </button>
            {set.isOwner && (
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={set.isLocked}
                onClick={() => onDelete(set.id)}
              >
                <Icon name="trash" size={16} />
                {confirming === set.id ? 'Tap again to delete' : 'Delete'}
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
