import type pg from 'pg';

/**
 * Deadlines are set and enforced on the database clock. This class lets an
 * isolate report "server time" on that same clock when browsers sync, so the
 * countdown a player sees matches the deadline the database will enforce.
 *
 * Calibration takes a few samples and keeps the one with the smallest round
 * trip (the tightest error bound, ±RTT/2).
 */
export class ServerClock {
  private offsetMs = 0;
  private bestRttMs = Number.POSITIVE_INFINITY;
  private calibratedAt = 0;

  constructor(private readonly pool: pg.Pool) {}

  now(): number {
    return Date.now() + this.offsetMs;
  }

  async calibrate(samples = 3): Promise<void> {
    // Re-measure from scratch every few minutes in case the host clock drifted.
    if (Date.now() - this.calibratedAt > 5 * 60_000) this.bestRttMs = Number.POSITIVE_INFINITY;
    for (let i = 0; i < samples; i++) {
      const t0 = Date.now();
      const { rows } = await this.pool.query<{ ms: number }>(
        'SELECT (extract(epoch FROM clock_timestamp()) * 1000)::float8 AS ms',
      );
      const t1 = Date.now();
      const rtt = t1 - t0;
      const dbMs = Number(rows[0]?.ms);
      if (Number.isFinite(dbMs) && rtt <= this.bestRttMs) {
        this.bestRttMs = rtt;
        this.offsetMs = dbMs - (t0 + t1) / 2;
      }
    }
    this.calibratedAt = Date.now();
  }
}
