import { Link } from 'react-router';

export function Logo({ tone = 'stage' }: { tone?: 'stage' | 'paper' }) {
  return (
    <Link
      to="/"
      className={`inline-flex items-center gap-2.5 ${tone === 'stage' ? 'text-white' : 'text-cobalt-950'}`}
      aria-label="Sliver home"
    >
      <svg width="28" height="28" viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r="26" fill="none" stroke="currentColor" strokeOpacity=".35" strokeWidth="5" />
        <path d="M32 32 L32 6 A26 26 0 0 1 47.28 10.97 Z" fill={tone === 'stage' ? '#FFCB2E' : '#1B3BD6'} />
      </svg>
      <span className="display text-xl">Sliver</span>
    </Link>
  );
}
