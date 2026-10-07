import { useEffect, useState } from 'react';
import type { Difficulty } from '@sliver/shared';

/**
 * The sliver: a disc whose filled slice is the share of people expected to
 * get the question right. 90% is nearly whole; 1% is a hairline.
 *
 * With `animate`, it starts whole and narrows to its value once — the one
 * orchestrated motion in the game, played as each question opens.
 */
export function Wedge({
  value,
  size = 48,
  animate = false,
  className = '',
  onDark = false,
}: {
  value: Difficulty | number;
  size?: number;
  animate?: boolean;
  className?: string;
  /** Force the stage colours (sun on translucent white), e.g. on a selected backstage chip. */
  onDark?: boolean;
}) {
  const [shown, setShown] = useState(animate ? 100 : value);
  useEffect(() => {
    if (!animate) {
      setShown(value);
      return;
    }
    setShown(100);
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(value)));
    return () => cancelAnimationFrame(id);
  }, [animate, value]);

  // A 1% slice is invisible at small sizes; give it a minimum visible sliver.
  const visible = Math.max(shown, size < 40 ? 4 : 1.6);
  return (
    <div
      className={`wedge shrink-0 ${className}`}
      style={{
        width: size,
        ['--wedge' as string]: visible,
        ...(onDark ? { ['--wedge-fill' as string]: '#ffcb2e', ['--wedge-rest' as string]: 'rgb(255 255 255 / 0.25)' } : {}),
      }}
      role="img"
      aria-label={`Difficulty ${value}%: about ${value} in 100 people get this right`}
    />
  );
}
