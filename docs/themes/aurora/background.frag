// Северное сияние: ленты цветов обложки медленно плывут вверх,
// на ударе баса вспыхивают, а тёмное небо под ними становится глубже.

float ribbon(vec2 p, float y, float k, float t, float ph) {
  float wave = 0.10 * sin(p.x * 2.3 + t * 0.9 + ph) + 0.05 * sin(p.x * 5.1 - t * 0.6 + ph * 2.0);
  float d = p.y - y - wave;
  return exp(-d * d * k);
}

void main() {
  vec2 p = vUv - 0.5;
  p.x *= uAspect;
  float t = uTime * 0.12;

  // The sky: the cover's colours, stretched and drifting slowly.
  vec3 sky = cover(vec2(0.5 + 0.18 * p.x + 0.05 * sin(t + uPhA.x), 0.75 - 0.3 * p.y));
  sky = mix(sky, cover(vec2(0.2 + 0.1 * sin(t * 0.7 + uPhA.y), 0.2 + 0.2 * p.y)), 0.35);

  // Three ribbons, each its own colour from the cover.
  float r1 = ribbon(p, 0.12 + 0.04 * sin(t * 0.8 + uPhA.z), 38.0, t * 3.0, uPhA.x);
  float r2 = ribbon(p, -0.05 + 0.05 * cos(t * 0.6), 26.0, t * 2.4, uPhA.y + 1.7);
  float r3 = ribbon(p, 0.28 + 0.03 * sin(t * 1.1 + uPhA.w), 60.0, t * 3.6, uPhA.w + 3.1);
  vec3 c1 = cover(vec2(0.15, 0.30));
  vec3 c2 = cover(vec2(0.80, 0.55));
  vec3 c3 = cover(vec2(0.50, 0.15));

  float flare = 0.55 + 0.6 * uBeat;
  vec3 col = sky * 0.75;
  col += c1 * r1 * 0.55 * flare + c2 * r2 * 0.45 * flare + c3 * r3 * 0.35 * flare;

  // On a kick the dark sky deepens a little.
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col *= 1.0 - 0.28 * uBeat * smoothstep(uMid + 0.02, uMid - 0.18, l);

  gl_FragColor = vec4(tone(col), 1.0);
}
