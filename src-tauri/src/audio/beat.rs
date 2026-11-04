//! Beats in the playing app's sound, for the background's pulse. The bass is
//! followed in 10 ms steps: a beat is where its energy jumps well above the
//! level of the last half second.

/// Steps per second.
const FPS: u32 = 100;
/// Bass up to about this frequency carries the kick.
const BASS_HZ: f32 = 150.0;
/// The bass must reach this many times its recent level...
const FIRE: f32 = 1.6;
/// ...after having dropped back under this, so one kick is one beat.
const REARM: f32 = 1.15;
/// Beats closer than this are one beat (≈ 215 BPM).
const MIN_GAP_S: f32 = 0.28;
/// Below this the sound counts as silence (fades, gaps between songs).
const SILENCE: f32 = 1e-6;

/// Second-order low-pass (RBJ biquad).
struct LowPass {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}

impl LowPass {
    fn new(hz: f32, rate: u32) -> Self {
        let w = 2.0 * std::f32::consts::PI * hz / rate as f32;
        let alpha = w.sin() / (2.0 * std::f32::consts::FRAC_1_SQRT_2);
        let cos = w.cos();
        let a0 = 1.0 + alpha;
        LowPass {
            b0: (1.0 - cos) / 2.0 / a0,
            b1: (1.0 - cos) / a0,
            b2: (1.0 - cos) / 2.0 / a0,
            a1: -2.0 * cos / a0,
            a2: (1.0 - alpha) / a0,
            x1: 0.0,
            x2: 0.0,
            y1: 0.0,
            y2: 0.0,
        }
    }

    fn step(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2 - self.a1 * self.y1 - self.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = y;
        y
    }
}

pub struct Beats {
    filter: LowPass,
    hop: usize,
    in_hop: usize,
    energy: f32,
    /// Bass level of the last ~0.5 s.
    slow: f32,
    armed: bool,
    since: u32,
    min_gap: u32,
}

impl Beats {
    pub fn new(rate: u32) -> Self {
        Beats {
            filter: LowPass::new(BASS_HZ, rate),
            hop: (rate / FPS) as usize,
            in_hop: 0,
            energy: 0.0,
            slow: 0.0,
            armed: true,
            since: u32::MAX / 2,
            min_gap: (MIN_GAP_S * FPS as f32) as u32,
        }
    }

    /// Feeds mono samples; calls `beat` with a strength in 0.3..=1 for each beat.
    pub fn push(&mut self, input: &[i16], mut beat: impl FnMut(f32)) {
        for &s in input {
            let y = self.filter.step(s as f32 / 32768.0);
            self.energy += y * y;
            self.in_hop += 1;
            if self.in_hop == self.hop {
                let e = self.energy / self.hop as f32;
                self.in_hop = 0;
                self.energy = 0.0;
                if let Some(strength) = self.step(e) {
                    beat(strength);
                }
            }
        }
    }

    fn step(&mut self, e: f32) -> Option<f32> {
        self.since = self.since.saturating_add(1);
        let base = self.slow.max(SILENCE);
        let ratio = e / base;
        // The level follows rises slowly and falls a bit faster, so a loud
        // part does not hide the next kicks for long.
        let k = if e > self.slow { 0.02 } else { 0.035 };
        self.slow += (e - self.slow) * k;
        if ratio < REARM {
            self.armed = true;
        }
        if self.armed && ratio > FIRE && e > SILENCE && self.since >= self.min_gap {
            self.armed = false;
            self.since = 0;
            return Some((0.3 + (ratio - FIRE) / 4.0).min(1.0));
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: u32 = 16_000;

    /// A kick drum: a falling 60 Hz thump every `gap` seconds, over steady hi-hat-like noise.
    fn song(beats: usize, gap: f32) -> Vec<i16> {
        let n = (beats as f32 * gap * RATE as f32) as usize;
        let mut seed = 1u32;
        (0..n)
            .map(|i| {
                let t = i as f32 / RATE as f32;
                let since = t % gap;
                let kick = (2.0 * std::f32::consts::PI * 60.0 * since).sin() * (-since * 18.0).exp();
                seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12_345);
                let noise = ((seed >> 16) as f32 / 32768.0 - 1.0) * 0.08;
                ((kick * 0.7 + noise) * 32767.0) as i16
            })
            .collect()
    }

    #[test]
    fn finds_kicks_and_nothing_in_a_held_tone() {
        let mut b = Beats::new(RATE);
        let mut found = 0;
        b.push(&song(16, 0.5), |_| found += 1);
        assert!((14..=16).contains(&found), "beats {found}");

        let tone: Vec<i16> = (0..RATE as usize * 4).map(|i| ((i as f32 * 2.0 * std::f32::consts::PI * 80.0 / RATE as f32).sin() * 12000.0) as i16).collect();
        let mut b = Beats::new(RATE);
        let mut found = 0;
        b.push(&tone, |_| found += 1);
        // Only the start of the tone.
        assert!(found <= 1, "tone beats {found}");
    }
}
