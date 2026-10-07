import type { GameView, RoomState } from '@sliver/shared';
import { Icon } from '../../components/Icon';
import { Leaderboard } from '../../components/Leaderboard';
import { letter } from '../../components/QuestionView';
import { Wedge } from '../../components/Wedge';
import { useServerNow } from '../../lib/useRoom';

/** The reveal: your verdict first, then the answer, the room's picks and the standings. */
export function ResultsScreen({
  state,
  game,
  serverNow,
}: {
  state: RoomState;
  game: GameView;
  serverNow: () => number;
}) {
  const now = useServerNow(serverNow, true, 200);
  const question = game.question!;
  const reveal = game.reveal!;
  const mine = game.myResult;
  const isLast = game.questionIndex + 1 >= game.questionCount;
  const left = Math.max(0, Math.ceil(((game.phaseEndsAt ?? now) - now) / 1000));
  const total = reveal.summary.correct + reveal.summary.incorrect + reveal.summary.unanswered;

  const verdict = !mine
    ? null
    : !mine.answered
      ? { tone: 'bg-white/12 text-white', title: 'No answer', icon: null }
      : mine.isCorrect
        ? { tone: 'bg-mint text-cobalt-950', title: 'Correct', icon: 'check' as const }
        : { tone: 'bg-coral text-cobalt-950', title: 'Not quite', icon: 'x' as const };

  return (
    <div className="flex flex-1 flex-col gap-8 pt-6" aria-live="polite">
      {verdict && mine && (
        <section className={`pop-in rounded-3xl px-6 py-6 ${verdict.tone}`}>
          <div className="flex items-start justify-between gap-4">
            <h1 className="display flex items-center gap-3 text-[clamp(2.2rem,9vw,3rem)]">
              {verdict.icon && <Icon name={verdict.icon} size={40} strokeWidth={3} />}
              {verdict.title}
            </h1>
            <p className="display text-[clamp(2.2rem,9vw,3rem)] tabular-nums">
              {mine.points > 0 ? `+${mine.points}` : mine.points < 0 ? `−${Math.abs(mine.points)}` : '0'}
            </p>
          </div>
          <dl className="mt-5 grid gap-1 text-lg">
            <div className="flex gap-2">
              <dt className="opacity-75">Your answer:</dt>
              <dd className="font-semibold">{mine.answer ?? 'none'}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="opacity-75">Correct answer:</dt>
              <dd className="font-semibold">{reveal.correct.display}</dd>
            </div>
          </dl>
        </section>
      )}

      <section>
        <div className="flex items-center gap-3 text-cobalt-200">
          <Wedge value={question.difficulty} size={28} />
          <span>
            Question {question.index + 1} of {game.questionCount}, rated {question.difficulty}%.{' '}
            {reveal.summary.correct} of {total} got it.
          </span>
        </div>
        <p className="mt-3 text-xl font-semibold whitespace-pre-line">{question.prompt}</p>

        {reveal.correct.type === 'SHORT' && reveal.correct.alsoAccepted.length > 0 && (
          <p className="mt-2 text-sm text-cobalt-200">Also accepted: {reveal.correct.alsoAccepted.join(', ')}</p>
        )}

        {reveal.explanation && (
          <p className="mt-4 rounded-2xl bg-cobalt-900/60 px-5 py-4 text-lg leading-relaxed">{reveal.explanation}</p>
        )}

        {question.options && reveal.optionCounts && (
          <ul className="mt-5 grid gap-2" aria-label="How the room answered">
            {question.options.map((option, i) => {
              const count = reveal.optionCounts![i] ?? 0;
              const correct = reveal.correct.type === 'MCQ' && reveal.correct.optionIndex === i;
              const share = total ? count / total : 0;
              return (
                <li
                  key={i}
                  className={`rounded-xl px-4 py-3 ${correct ? 'bg-cobalt-950/45 ring-2 ring-mint' : 'bg-white/8'}`}
                >
                  <span className="flex items-center gap-3">
                    <span className="font-bold">{letter(i)}</span>
                    <span className="flex-1">{option}</span>
                    {correct && <Icon name="check" className="text-mint" />}
                    <span className="font-semibold tabular-nums">
                      {count}
                      <span className="sr-only"> {count === 1 ? 'player' : 'players'}</span>
                    </span>
                  </span>
                  <span className="mt-2 block h-1.5 overflow-hidden rounded-pill bg-white/10" aria-hidden="true">
                    <span
                      className={`block h-full rounded-pill ${correct ? 'bg-mint' : 'bg-white/45'}`}
                      style={{ width: `${share * 100}%` }}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {game.leaderboard && (
        <section aria-labelledby="board-title">
          <h2 id="board-title" className="display-tight mb-3 text-2xl">
            Leaderboard
          </h2>
          <Leaderboard standings={game.leaderboard} meId={state.me.playerId} />
        </section>
      )}

      <p className="mt-auto text-center text-cobalt-200" role="timer">
        {isLast ? 'Final results' : 'Next question'} in <span className="font-semibold text-white tabular-nums">{left}</span>
      </p>
    </div>
  );
}
