/** Initial-in-a-circle; colour derived from the name so it stays stable. */
const TONES = ['bg-sun text-cobalt-950', 'bg-mint text-cobalt-950', 'bg-white text-cobalt-950', 'bg-cobalt-200 text-cobalt-950', 'bg-coral text-cobalt-950'];

export function Avatar({ name, size = 36, dim = false }: { name: string; size?: number; dim?: boolean }) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  const tone = TONES[hash % TONES.length];
  const initial = [...name.trim()][0]?.toUpperCase() ?? '?';
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold ${tone} ${dim ? 'opacity-40' : ''}`}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}
