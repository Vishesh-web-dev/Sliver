import { describe, expect, it } from 'vitest';
import { ClockSync } from './clock';

describe('ClockSync', () => {
  it('estimates the server offset from the fastest round trip', () => {
    const clock = new ClockSync();
    // Server is 5s ahead. Slow sample (400ms RTT, asymmetric) then a fast one (20ms).
    clock.record(1_000, 1_000 + 5_000 + 350, 1_400);
    clock.record(2_000, 2_000 + 5_000 + 10, 2_020);
    expect(clock.offsetMs).toBe(5_000);
  });

  it('ignores impossible samples', () => {
    const clock = new ClockSync();
    clock.record(2_000, 9_999, 1_000);
    expect(clock.offsetMs).toBe(0);
  });
});
