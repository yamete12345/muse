//! How loud the low, low-mid, high-mid and high parts of the sound are right
//! now, about 30 times a second, for the widget's level bars. Each band keeps
//! its own slowly falling peak, so the bars move in every song, quiet or loud.

use super::beat::LowPass;

pub const BANDS: usize = 4;
/// Steps per second.
const FPS: u32 = 31;
/// Edges between the bands, Hz.
const EDGES: [f32; BANDS - 1] = [180.0, 700.0, 2500.0];
/// How fast a band's peak falls back per step (about 20% a second).
const PEAK_FALL: f32 = 0.993;
/// The quietest peak a band can have, so near silence does not fill the bars.
const PEAK_FLOOR: f32 = 0.004;
/// A band's peak is at least this share of the loudest band's, so a band
/// with next to nothing in it does not fill its bar on its own scale.
const SHARE_OF_LOUDEST: f32 = 0.25;
/// Below this overall level the bars rest.
const SILENCE: f32 = 0.0008;

pub struct Levels {
    filters: [LowPass; BANDS - 1],
    energy: [f32; BANDS],
    peak: [f32; BANDS],
    hop: usize,
    in_hop: usize,
}

impl Levels {
    pub fn new(rate: u32) -> Self {
        Levels {
            filters: EDGES.map(|hz| LowPass::new(hz, rate)),
            energy: [0.0; BANDS],
            peak: [PEAK_FLOOR; BANDS],
            hop: (rate / FPS) as usize,
            in_hop: 0,
        }
    }

    /// Feeds mono samples; calls `out` with each band's level in 0..=1.
    pub fn push(&mut self, input: &[i16], mut out: impl FnMut([f32; BANDS])) {
        for &s in input {
            let x = s as f32 / 32768.0;
            // Each low-pass keeps everything under its edge; the bands are
            // the differences between neighbouring ones.
            let mut below = [0.0f32; BANDS - 1];
            for (i, f) in self.filters.iter_mut().enumerate() {
                below[i] = f.step(x);
            }
            let bands = [below[0], below[1] - below[0], below[2] - below[1], x - below[2]];
            for (e, b) in self.energy.iter_mut().zip(bands) {
                *e += b * b;
            }
            self.in_hop += 1;
            if self.in_hop == self.hop {
                self.in_hop = 0;
                out(self.step());
            }
        }
    }

    fn step(&mut self) -> [f32; BANDS] {
        let n = self.hop as f32;
        let rms = self.energy.map(|e| (e / n).sqrt());
        self.energy = [0.0; BANDS];
        if rms.iter().sum::<f32>() < SILENCE {
            return [0.0; BANDS];
        }
        for i in 0..BANDS {
            self.peak[i] = (self.peak[i] * PEAK_FALL).max(rms[i]).max(PEAK_FLOOR);
        }
        let loudest = self.peak.iter().copied().fold(0.0, f32::max);
        let mut out = [0.0; BANDS];
        for i in 0..BANDS {
            let scale = self.peak[i].max(loudest * SHARE_OF_LOUDEST);
            // A gentle curve: quieter moments still show some motion.
            out[i] = (rms[i] / scale).clamp(0.0, 1.0).powf(0.8);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: u32 = 16_000;

    fn tone(hz: f32, secs: f32) -> Vec<i16> {
        (0..(RATE as f32 * secs) as usize).map(|i| ((i as f32 * 2.0 * std::f32::consts::PI * hz / RATE as f32).sin() * 12000.0) as i16).collect()
    }

    fn last(l: &mut Levels, samples: &[i16]) -> [f32; BANDS] {
        let mut v = [0.0; BANDS];
        l.push(samples, |x| v = x);
        v
    }

    #[test]
    fn a_tone_lights_its_own_band() {
        let mut l = Levels::new(RATE);
        let bass = last(&mut l, &tone(80.0, 1.0));
        assert!(bass[0] > 0.8 && bass[3] < bass[0] * 0.3, "bass {bass:?}");
        let mut l = Levels::new(RATE);
        let high = last(&mut l, &tone(5000.0, 1.0));
        assert!(high[3] > 0.8 && high[0] < high[3] * 0.3, "high {high:?}");
    }

    #[test]
    fn silence_rests() {
        let mut l = Levels::new(RATE);
        assert_eq!(last(&mut l, &vec![0i16; RATE as usize]), [0.0; BANDS]);
    }
}
