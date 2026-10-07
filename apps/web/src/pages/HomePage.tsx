import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { DIFFICULTIES, normalizeRoomCode } from '@sliver/shared';
import { ErrorText, Stage } from '../components/Shell';
import { Wedge } from '../components/Wedge';

export function HomePage() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const join = (e: FormEvent) => {
    e.preventDefault();
    const normalized = normalizeRoomCode(code);
    if (!normalized) {
      setError('Game codes are 5 letters and numbers, like AB7KQ.');
      return;
    }
    navigate(`/join/${normalized}`);
  };

  return (
    <Stage
      wide
      right={
        <Link to="/sets" className="text-sm font-semibold text-cobalt-100 underline-offset-4 hover:underline">
          Your question sets
        </Link>
      }
    >
      <section className="grid flex-1 items-center gap-12 py-10 lg:grid-cols-[1.15fr_1fr] lg:py-16">
        <div>
          <h1 className="display text-[clamp(3.2rem,11vw,6.5rem)]">
            How rare is your reasoning?
          </h1>
          <p className="mt-6 max-w-[34rem] text-lg text-cobalt-100">
            A party quiz of common sense, sneaky logic and things hiding in plain sight. Each question is
            harder than the last. Everyone answers at once, on their own phone, against the same clock.
          </p>

          <div className="mt-10 flex flex-col gap-6 sm:flex-row sm:items-end">
            <Link to="/create" className="btn btn-sun min-h-14 px-8 text-lg">
              Create a game
            </Link>
            <form onSubmit={join} className="flex-1 sm:max-w-sm" noValidate>
              <label htmlFor="home-code" className="label text-cobalt-100">
                Got a code from a friend?
              </label>
              <div className="flex gap-2">
                <input
                  id="home-code"
                  className="field display-tight min-w-0 flex-1 text-center tracking-[0.18em] uppercase"
                  placeholder="AB7KQ"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={7}
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value);
                    setError('');
                  }}
                />
                <button type="submit" className="btn btn-ghost min-h-14">
                  Join a game
                </button>
              </div>
            </form>
          </div>
          <ErrorText>{error}</ErrorText>
        </div>

        <figure aria-labelledby="ladder-caption" className="lg:justify-self-end">
          <ol className="grid grid-cols-4 gap-x-5 gap-y-6 sm:grid-cols-6 lg:grid-cols-3">
            {DIFFICULTIES.map((d) => (
              <li key={d} className="flex flex-col items-center gap-2">
                <Wedge value={d} size={64} />
                <span className="display text-lg tabular-nums">{d}%</span>
              </li>
            ))}
          </ol>
          <figcaption id="ladder-caption" className="mt-6 max-w-[22rem] text-sm text-cobalt-200 lg:ml-auto lg:text-right">
            The slice is how many people get it right. Twelve questions take you from 90% down to the last 1%.
          </figcaption>
        </figure>
      </section>
    </Stage>
  );
}
