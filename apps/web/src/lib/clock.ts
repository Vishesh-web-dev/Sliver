/**
 * Server-clock estimate from ping/pong samples (NTP-style). The sample with the
 * smallest round trip bounds the error tightest, so it wins. All countdowns
 * render from server timestamps through this offset; the browser clock is
 * never trusted for deadlines.
 */
export class ClockSync {
  private offset = 0;
  private bestRtt = Number.POSITIVE_INFINITY;
  private samples = 0;

  record(clientSent: number, serverTime: number, clientReceived = Date.now()): void {
    const rtt = clientReceived - clientSent;
    if (rtt < 0) return;
    this.samples++;
    // Let the estimate re-adapt slowly if the network path changes.
    if (rtt <= this.bestRtt || this.samples % 20 === 0) {
      this.bestRtt = rtt;
      this.offset = serverTime - (clientSent + clientReceived) / 2;
    }
  }

  /** Current time on the server's clock, in epoch ms. */
  now(): number {
    return Date.now() + this.offset;
  }

  get offsetMs(): number {
    return this.offset;
  }
}
