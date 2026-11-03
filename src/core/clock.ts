import type { MediaState } from "./types";

/**
 * Playback position between the (rare) updates from the media session.
 * Small drifts are corrected smoothly so lyrics never jump backwards.
 */
export class PlaybackClock {
  playing = false;
  rate = 1;
  durationMs = 0;
  /** Positive values show lyrics earlier. */
  offsetMs = 0;

  private basePos = 0;
  private basePerf = 0;
  private err = 0;

  sync(m: MediaState | null, perf = performance.now(), wall = Date.now()) {
    if (!m) {
      this.playing = false;
      this.basePos = 0;
      this.basePerf = perf;
      this.err = 0;
      return;
    }
    const updated = m.updatedAtMs > 0 && m.updatedAtMs <= wall + 1000 ? m.updatedAtMs : wall;
    let reported = m.positionMs + (m.playing ? Math.max(0, wall - updated) * m.rate : 0);
    if (m.durationMs > 0) reported = Math.min(reported, m.durationMs);

    const current = this.position(perf);
    const continuous = this.playing && m.playing && Math.abs(reported - current) < 700;
    this.err = continuous ? current - reported : 0;
    this.basePos = reported;
    this.basePerf = perf;
    this.playing = m.playing;
    this.rate = m.rate || 1;
    this.durationMs = m.durationMs;
  }

  /** Optimistic local seek, before the player confirms it. */
  seekLocal(ms: number, perf = performance.now()) {
    this.basePos = ms;
    this.basePerf = perf;
    this.err = 0;
  }

  position(perf = performance.now()): number {
    const elapsed = perf - this.basePerf;
    let p = this.basePos + (this.playing ? elapsed * this.rate : 0) + this.err * Math.exp(-elapsed / 350);
    if (this.durationMs > 0) p = Math.min(p, this.durationMs);
    return Math.max(0, p);
  }

  /** Time on the lyrics timeline. */
  now(perf = performance.now()): number {
    return this.position(perf) + this.offsetMs;
  }
}
