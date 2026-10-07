export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
  tone = 'stage',
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
  tone?: 'stage' | 'paper';
}) {
  const track =
    tone === 'stage'
      ? checked
        ? 'bg-sun'
        : 'bg-white/20'
      : checked
        ? 'bg-cobalt-700'
        : 'bg-cobalt-100';
  const knob = tone === 'stage' && checked ? 'bg-cobalt-950' : 'bg-white';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 py-2 text-left disabled:opacity-50"
    >
      <span>
        <span className="block font-medium">{label}</span>
        {hint && <span className={`block text-sm ${tone === 'stage' ? 'text-cobalt-200' : 'text-cobalt-950/60'}`}>{hint}</span>}
      </span>
      <span className={`relative h-7 w-12 shrink-0 rounded-pill transition-colors ${track}`}>
        <span
          className={`absolute top-1 left-1 h-5 w-5 rounded-full shadow transition-transform ${knob} ${checked ? 'translate-x-5' : ''}`}
        />
      </span>
    </button>
  );
}
