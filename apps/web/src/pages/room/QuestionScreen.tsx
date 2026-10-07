import { useState } from 'react';
import type { GameView, MyAnswer, PublicQuestion, RoomState } from '@sliver/shared';
import { Avatar } from '../../components/Avatar';
import { Fuse } from '../../components/Fuse';
import { Icon } from '../../components/Icon';
import { QuestionView } from '../../components/QuestionView';
import { api, ApiError } from '../../lib/api';
import { useServerNow } from '../../lib/useRoom';

/**
 * One open question. Remounted per question (keyed by id), so local choices
 * never leak into the next one. The server decides everything that matters:
 * whether the answer arrived in time, whether it is right, and what it scores.
 */
export function QuestionScreen({
  state,
  game,
  question,
  code,
  serverNow,
}: {
  state: RoomState;
  game: GameView;
  question: PublicQuestion;
  code: string;
  serverNow: () => number;
}) {
  const now = useServerNow(serverNow, true, 100);
  const [selected, setSelected] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [accepted, setAccepted] = useState<MyAnswer | null>(null);
  const [error, setError] = useState('');

  const endsAt = game.phaseEndsAt ?? now;
  const closed = now >= endsAt;
  const locked = game.myAnswer ?? accepted;

  const submit = async () => {
    setSubmitting(true);
    setError('');
    try {
      const answer = question.type === 'MCQ' ? { optionIndex: selected ?? -1 } : { text };
      const { myAnswer } = await api.submitAnswer(code, { questionId: question.id, answer });
      setAccepted(myAnswer);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ALREADY_ANSWERED') {
        setError('');
      } else {
        setError(err instanceof ApiError ? err.message : 'Your answer didn’t go through. Try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const answered = new Set(game.answeredPlayerIds);
  const participants = game.leaderboard?.map((s) => ({ id: s.playerId, name: s.name })) ?? state.players;
  const waitingOn = participants.filter((p) => !answered.has(p.id)).length;

  return (
    <div className="flex flex-1 flex-col pt-6">
      <QuestionView
        question={question}
        total={game.questionCount}
        timer={<Fuse startedAt={game.phaseStartedAt} endsAt={endsAt} now={now} />}
        selected={selected}
        onSelect={setSelected}
        text={text}
        onText={setText}
        locked={locked}
        closed={closed}
        submitting={submitting}
        onSubmit={submit}
      >
        {error && (
          <p role="alert" className="mt-4 rounded-xl bg-coral px-4 py-3 font-medium text-cobalt-950">
            {error}
          </p>
        )}
        {locked && !closed && (
          <p className="mt-4 text-center text-cobalt-100" aria-live="polite">
            {waitingOn > 0
              ? `Waiting for ${waitingOn} more ${waitingOn === 1 ? 'player' : 'players'}. Answers reveal when the clock runs out.`
              : 'Everyone’s in. Answers reveal when the clock runs out.'}
          </p>
        )}
      </QuestionView>

      <ul className="mt-10 flex flex-wrap gap-2" aria-label="Who has answered">
        {participants.map((p) => {
          const done = answered.has(p.id);
          return (
            <li
              key={p.id}
              className={`flex items-center gap-2 rounded-pill py-1 pr-3 pl-1 text-sm ${done ? 'bg-white/14' : 'bg-white/5 text-white/60'}`}
            >
              <Avatar name={p.name} size={26} dim={!done} />
              <span className="max-w-[9rem] truncate">{p.name}</span>
              {done && <Icon name="check" size={16} className="text-mint" />}
              <span className="sr-only">{done ? 'has answered' : 'still thinking'}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
