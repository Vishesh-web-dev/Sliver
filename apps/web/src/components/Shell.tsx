import type { ReactNode } from 'react';
import { Logo } from './Logo';

/** The cobalt stage: where the game is played. */
export function Stage({ children, right, wide = false }: { children: ReactNode; right?: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col bg-cobalt-700 text-white">
      <header
        className={`mx-auto flex w-full items-center justify-between gap-4 px-5 pt-5 pb-2 sm:px-8 ${wide ? 'max-w-5xl' : 'max-w-2xl'}`}
      >
        <Logo />
        {right}
      </header>
      <main className={`mx-auto flex w-full flex-1 flex-col px-5 pb-10 sm:px-8 ${wide ? 'max-w-5xl' : 'max-w-2xl'}`}>
        {children}
      </main>
    </div>
  );
}

/** Paper-white backstage: where hosts write and organise questions. */
export function Backstage({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="backstage min-h-dvh bg-paper text-cobalt-950">
      <header className="border-b border-cobalt-100 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <Logo tone="paper" />
          {right}
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-5 pt-8 pb-32 sm:px-8">{children}</main>
    </div>
  );
}

export function ErrorText({ children, tone = 'stage' }: { children: ReactNode; tone?: 'stage' | 'paper' }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className={`mt-3 rounded-xl px-4 py-3 text-sm font-medium ${
        tone === 'stage' ? 'bg-coral text-cobalt-950' : 'bg-[#fff1ef] text-[#b42318] ring-1 ring-[#f3c4bf]'
      }`}
    >
      {children}
    </p>
  );
}
