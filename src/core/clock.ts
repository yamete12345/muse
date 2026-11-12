import type { MediaState } from "./types";

/** Whole-second reports in a row before a player counts as one that rounds. */
const COARSE_AFTER = 3;
/** How far a whole-second report may be from the estimate before it counts as a seek. */
const COARSE_JUMP = 2500;

/**
 * Playback position between the (rare) updates from the media session.
 * Small drifts are corrected smoothly so lyrics never jump backwards.
 *
 * Some players (Apple Music for Windows) report the position only in whole
 * seconds, several times a second, each time stamped "now". Taken as is, the
 * lyrics would stall and snap. For those the clock keeps what every report
 * says for sure, that the real position is between N and N + 1 s at that
 * moment, narrows that window report by report, and runs from its middle.
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
  /** Whole-second reports in a row (see COARSE_AFTER). */
  private whole = 0;
  /** Bounds of the real position, as "position at perf 0" (at rate 1). */
  private lo = -Infinity;
  private hi = Infinity;

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
    const coarse = this.coarse(m, perf - Math.max(0, wall - updated), perf);
    if (coarse !== null) reported = coarse;
    const continuous = this.playing && m.playing && Math.abs(reported - current) < 700;
    this.err = continuous ? current - reported : 0;
    this.basePos = reported;
    this.basePerf = perf;
    this.playing = m.playing;
    this.rate = m.rate || 1;
    this.durationMs = m.durationMs;
  }

  /**
   * For a player that rounds to whole seconds: the position at `perf`, from
   * the window all its reports agree on (`at`: when this one was taken);
   * null for any other player.
   */
  private coarse(m: MediaState, at: number, perf: number): number | null {
    const whole = m.playing && m.rate === 1 && m.positionMs % 1000 === 0;
    this.whole = whole ? this.whole + 1 : 0;
    if (this.whole < COARSE_AFTER) {
      this.lo = -Infinity;
      this.hi = Infinity;
      return null;
    }
    const lo = m.positionMs - at;
    const hi = lo + 1000;
    // A seek or a new song: the old window says nothing any more.
    const far = Number.isFinite(this.lo) && (hi < this.lo - COARSE_JUMP || lo > this.hi + COARSE_JUMP);
    if (far || !Number.isFinite(this.lo)) {
      this.lo = lo;
      this.hi = hi;
    } else {
      this.lo = Math.max(this.lo, lo);
      this.hi = Math.min(this.hi, hi);
      // Timestamps jitter: if the window closed, start again from this report.
      if (this.lo > this.hi) {
        this.lo = lo;
        this.hi = hi;
      }
    }
    let p = (this.lo + this.hi) / 2 + perf;
    if (m.durationMs > 0) p = Math.min(p, m.durationMs);
    return p;
  }

  /** Optimistic local seek, before the player confirms it. */
  seekLocal(ms: number, perf = performance.now()) {
    this.basePos = ms;
    this.basePerf = perf;
    this.err = 0;
    this.lo = -Infinity;
    this.hi = Infinity;
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
