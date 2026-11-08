/**
 * Living cover-art background, in one of two looks: several rotating, warped
 * copies of a tiny pre-blurred cover ("cover", the lighter one), or the cover
 * melted into its colors and stirred, pulsing with the beat ("gradient").
 * Rendered at a fraction of the window resolution and stretched by the
 * compositor, so it costs little on the GPU.
 */
import { onFrame } from "./ticker";

export type BackgroundLook = "cover" | "gradient";

/**
 * The gradient has crisp edges, so it needs more detail than the blurred
 * cover: a bigger texture and a third of the window's resolution, not a sixth.
 */
const GRADIENT_TEX = 128;
const GRADIENT_SCALE = 1 / 3;

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

/** Shared by both looks: darkens or lightens for the theme, adds a vignette. */
const TONE = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vUv;
uniform float uMix;
uniform float uTime;
uniform float uTheme;
uniform float uAspect;
uniform float uBright;
uniform float uSat;

vec3 tone(vec3 col) {
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  vec3 dark = mix(vec3(l), col, 1.35 * uSat) * 0.6 * uBright;
  vec3 light = mix(vec3(l), col, 0.8 * uSat) * 0.42 + 0.56 * min(uBright, 1.2);
  vec3 c = mix(dark, light, uTheme);
  float v = smoothstep(1.25, 0.15, length(vUv - 0.5) * 1.4);
  return c * mix(mix(0.78, 1.0, v), mix(0.95, 1.0, v), uTheme);
}
`;

/** "Live cover": several rotating, warped copies of the cover itself. */
const COVER_FRAG = TONE + `
uniform sampler2D uA;
uniform sampler2D uB;

mat2 rot(float a) { float s = sin(a), c = cos(a); return mat2(c, -s, s, c); }

vec3 layer(sampler2D t, vec2 p, float a, float s, vec2 o) {
  return texture2D(t, rot(a) * (p * s) + o + 0.5).rgb;
}

vec3 cover(sampler2D t, vec2 p) {
  float T = uTime;
  vec3 c = layer(t, p, T * 0.045, 0.8, vec2(0.0));
  c += layer(t, p + vec2(0.25 * sin(T * 0.07), 0.2 * cos(T * 0.05)), -T * 0.06 + 1.3, 1.15, vec2(0.1, -0.05));
  c += layer(t, p - vec2(0.2 * cos(T * 0.04), 0.25 * sin(T * 0.06)), T * 0.035 + 2.6, 0.7, vec2(-0.12, 0.08));
  c += layer(t, p * 1.35, -T * 0.025 + 4.0, 1.0, vec2(0.0, 0.15));
  return c * 0.25;
}

void main() {
  vec2 p = vUv - 0.5;
  p.x *= uAspect;
  p += 0.07 * vec2(sin(p.y * 2.6 + uTime * 0.11), cos(p.x * 2.2 - uTime * 0.09));
  gl_FragColor = vec4(tone(mix(cover(uA, p), cover(uB, p), uMix)), 1.0);
}`;

/**
 * "Cover colors", like Apple Music: the cover itself, blurred to its colors
 * and stirred by a few slow whirls. Its big areas fill most of the screen,
 * the rest is drawn out into long soft strokes; where a whirl squeezes two
 * colors together they meet in a clearer edge. Light areas brighten a
 * little on each beat of the song.
 */
const GRADIENT_FRAG = TONE + `
uniform sampler2D uA;
uniform sampler2D uB;
uniform float uBeat;
uniform vec2 uBeatDir;
uniform vec4 uPhA;
uniform vec4 uPhB;
uniform vec4 uPhC;
uniform vec4 uAmpW;
uniform vec3 uAmpF;

mat2 rot(float a) { float s = sin(a), c = cos(a); return mat2(c, -s, s, c); }

/** Turns the picture around c, strongest in the middle, fading out by r. */
vec2 whirl(vec2 p, vec2 c, float r, float a) {
  vec2 d = p - c;
  return c + rot(a * exp(-dot(d, d) / (r * r))) * d;
}

/**
 * A curved fold through c: the picture on its far side is pushed by up to
 * "shift", so colors from two different parts of the cover meet in a clear
 * edge. The push fades along the fold and away from it, so the edge shows in
 * one stretch only and the far side still flows smoothly.
 */
vec2 fold(vec2 q, vec2 c, float ang, float len, float shift, float bend) {
  vec2 dir = vec2(cos(ang), sin(ang));
  vec2 d = q - c;
  float along = dot(d, vec2(-dir.y, dir.x));
  float across = dot(d, dir) + 0.16 * sin(along * 2.6 + bend);
  float reach = exp(-along * along / (len * len)) * exp(-across * across / 0.12);
  return q + dir * shift * reach * smoothstep(-0.03, 0.03, across);
}

vec3 cover(vec2 uv) {
  // Smoothed texel steps: plain linear filtering leaves faint creases at the
  // texels, and the whirls stretch them into visible blocks.
  vec2 t = uv * ${GRADIENT_TEX}.0 + 0.5;
  vec2 i = floor(t);
  vec2 f = t - i;
  uv = (i + f * f * (3.0 - 2.0 * f) - 0.5) / ${GRADIENT_TEX}.0;
  return mix(texture2D(uA, uv).rgb, texture2D(uB, uv).rgb, uMix);
}

void main() {
  float T = uTime;
  vec2 p = vUv - 0.5;
  p.x *= uAspect;
  // Random per window and nudged with every song (uPh*: phases, uAmp*: strengths),
  // so the same moves never come back in the same order.
  vec4 a = uPhA, b = uPhB, c = uPhC;
  vec2 q = rot(T * 0.013 + c.w) * p;
  q = whirl(q, vec2(0.38 * sin(T * 0.041 + a.x), 0.3 * cos(T * 0.033 + a.y)), 0.72, 1.15 * uAmpW.x * sin(T * 0.052 + a.z));
  q = whirl(q, vec2(-0.42 * cos(T * 0.029 + a.w), 0.3 * sin(T * 0.047 + b.x)), 0.66, -1.2 * uAmpW.y * sin(T * 0.038 + b.y));
  q = whirl(q, vec2(0.46 * sin(T * 0.023 + b.z), -0.34 * cos(T * 0.031 + b.w)), 0.8, 1.0 * uAmpW.z * cos(T * 0.044 + c.x));
  q = whirl(q, vec2(-0.2 * sin(T * 0.036 + c.y), -0.25 * cos(T * 0.027 + c.z)), 0.6, 0.9 * uAmpW.w * sin(T * 0.061 + a.x + b.y));
  q += 0.05 * vec2(sin(q.y * 3.1 + T * 0.1 + b.z), cos(q.x * 2.7 - T * 0.08 + a.w));
  // Now and then a clearer edge in one place, gentle and short-lived.
  q = fold(q, vec2(0.35 * sin(T * 0.027 + a.y + b.w), 0.28 * cos(T * 0.034 + c.x)), T * 0.031 + a.z + c.y, 0.38,
           0.24 * uAmpF.x * smoothstep(0.25, 0.95, sin(T * 0.043 + b.x + c.z)), T * 0.07 + a.x);
  q = fold(q, vec2(-0.3 * cos(T * 0.022 + b.y + a.w), -0.3 * sin(T * 0.029 + c.w)), -T * 0.024 + b.z + a.x, 0.32,
           0.2 * uAmpF.y * smoothstep(0.25, 0.95, sin(T * 0.037 + c.y + a.z)), -T * 0.06 + b.w);
  q = fold(q, vec2(0.15 * cos(T * 0.019 + c.x + a.y), 0.36 * sin(T * 0.025 + b.x)), T * 0.018 + c.z + b.y, 0.3,
           0.18 * uAmpF.z * smoothstep(0.25, 0.95, sin(T * 0.051 + a.w + c.w)), T * 0.05 + c.x);
  // The cover fills the window (cropped like a photo, mirrored past its edges).
  float fit = 0.66 / max(1.0, uAspect / 1.4);
  vec2 uv = q * fit + 0.5;
  vec3 col = cover(uv);
  // The beat: every spot briefly takes on a little of its neighbour's colour,
  // so dark patches lighten and light ones darken a touch, a new way each beat.
  col = mix(col, cover(uv + uBeatDir * 0.24), uBeat * 0.6);
  // A second, larger copy turning the other way keeps it from looking like a photo.
  col = mix(col, cover(rot(1.9 + a.z - T * 0.021) * q * 0.42 + 0.5), 0.28);
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  // White covers give a soft grey, not a glare (dark theme).
  col *= mix(1.12 - 0.42 * l, 1.0, uTheme);
  gl_FragColor = vec4(tone(col), 1.0);
}`;

const TEX = 64;
const SCALE = 1 / 6;
const FADE_S = 1.8;

export class MeshBackground {
  private gl: WebGLRenderingContext;
  private texA: WebGLTexture;
  private texB: WebGLTexture;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private mix = 0;
  private fading = false;
  private theme = 0;
  private themeTarget = 0;
  private time = Math.random() * 100;
  private acc = 0;
  private fps = 30;
  private playing = true;
  private dirty = true;
  private readonly unsubscribe: () => void;
  private readonly ro: ResizeObserver;
  private loadToken = 0;
  private brightness = 1;
  private saturation = 1;
  private speed = 1;
  private average: [number, number, number] = [70, 58, 110];
  /** Beat pulse: `kick` jumps on a beat and decays; `beat` follows it softly. */
  private kick = 0;
  private beat = 0;
  /** Which way colours shift on the current beat. */
  private beatDir: [number, number] = [1, 0];
  /** Gradient look: random phases and strengths of its moves, eased toward a new roll per song. */
  private seed = rollSeed();
  private seedTarget = this.seed.slice();
  onTone: ((rgb: [number, number, number]) => void) | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly look: BackgroundLook = "cover",
  ) {
    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error("WebGL is not available");
    this.gl = gl;

    const prog = gl.createProgram()!;
    for (const [type, src] of [
      [gl.VERTEX_SHADER, VERT],
      [gl.FRAGMENT_SHADER, look === "gradient" ? GRADIENT_FRAG : COVER_FRAG],
    ] as const) {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? "shader");
      gl.attachShader(prog, sh);
    }
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    for (const name of ["uA", "uB", "uMix", "uTime", "uTheme", "uAspect", "uBright", "uSat", "uBeat", "uBeatDir", "uPhA", "uPhB", "uPhC", "uAmpW", "uAmpF"])
      this.u[name] = gl.getUniformLocation(prog, name);
    gl.uniform1i(this.u.uA, 0);
    gl.uniform1i(this.u.uB, 1);

    this.texA = this.makeTexture(0);
    this.texB = this.makeTexture(1);
    this.upload(this.texA, 0, downsample(fallbackCover(), look));

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    this.unsubscribe = onFrame(this.frame);
  }

  destroy() {
    this.unsubscribe();
    this.ro.disconnect();
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  setFps(fps: number) {
    this.fps = fps;
  }

  setPlaying(playing: boolean) {
    this.playing = playing;
  }

  /** Brightness/saturation multipliers and drift speed (0 freezes the motion). */
  setScene(brightness: number, saturation: number, speed: number) {
    this.brightness = brightness;
    this.saturation = saturation;
    this.speed = speed;
    this.dirty = true;
    this.onTone?.(this.tone());
  }

  /** A beat in the song, strength 0..1 (gradient look only). */
  pulse(strength: number) {
    // A new direction only for a fresh beat, not while one is still fading in.
    if (this.kick < 0.25) {
      const a = Math.random() * Math.PI * 2;
      this.beatDir = [Math.cos(a), Math.sin(a)];
    }
    // Ordinary beats come in around 0.3–0.4: lift them so each one shows.
    this.kick = Math.max(this.kick, 0.55 + 0.45 * strength);
  }

  setTheme(light: boolean) {
    this.themeTarget = light ? 1 : 0;
    this.onTone?.(this.tone());
  }

  /**
   * Approximate overall color of the background as the shader renders it.
   * The window uses it as its native background, so areas uncovered while
   * resizing match the picture instead of flashing dark.
   */
  tone(): [number, number, number] {
    const [r, g, b] = this.average;
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    const light = this.themeTarget === 1;
    return [r, g, b].map((c) => {
      const sat = this.saturation;
      const v = light
        ? (l + (c - l) * 0.8 * sat) * 0.42 + 0.56 * 255 * Math.min(this.brightness, 1.2)
        : (l + (c - l) * 1.35 * sat) * 0.6 * 0.9 * this.brightness;
      return Math.round(Math.min(255, Math.max(0, v)));
    }) as [number, number, number];
  }

  setCover(url: string | null) {
    const token = ++this.loadToken;
    const apply = (src: CanvasImageSource) => {
      if (token !== this.loadToken) return;
      // Commit any running fade so the new cover fades from what is on screen.
      if (this.fading) this.swap();
      const small = downsample(src, this.look);
      this.average = averageColor(small);
      this.upload(this.texB, 1, small);
      // A new song rearranges the moves a little.
      this.seedTarget = rollSeed(this.seedTarget);
      this.onTone?.(this.tone());
      this.mix = 0;
      this.fading = true;
    };
    if (!url) return apply(fallbackCover());
    const img = new Image();
    img.decoding = "async";
    img.onload = () => apply(img);
    img.src = url;
  }

  private swap() {
    [this.texA, this.texB] = [this.texB, this.texA];
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texA);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texB);
    this.mix = 0;
    this.fading = false;
  }

  private makeTexture(unit: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
    return tex;
  }

  private upload(tex: WebGLTexture, unit: number, src: TexImageSource) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, src);
    this.dirty = true;
  }

  private resize() {
    const scale = this.look === "gradient" ? GRADIENT_SCALE : SCALE;
    const w = Math.max(48, Math.round(this.canvas.clientWidth * scale));
    const h = Math.max(48, Math.round(this.canvas.clientHeight * scale));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      // Resizing clears the buffer; draw right away so no black frame shows.
      this.canvas.width = w;
      this.canvas.height = h;
      this.gl.viewport(0, 0, w, h);
      this.draw();
    }
  }

  private draw() {
    const gl = this.gl;
    gl.uniform1f(this.u.uTime, this.time);
    gl.uniform1f(this.u.uMix, smoothstep(this.mix));
    gl.uniform1f(this.u.uTheme, smoothstep(this.theme));
    gl.uniform1f(this.u.uAspect, this.canvas.width / this.canvas.height);
    gl.uniform1f(this.u.uBright, this.brightness);
    gl.uniform1f(this.u.uSat, this.saturation);
    gl.uniform1f(this.u.uBeat, this.beat);
    gl.uniform2f(this.u.uBeatDir, this.beatDir[0], this.beatDir[1]);
    if (this.look === "gradient") {
      const r = this.seed;
      gl.uniform4f(this.u.uPhA, r[0], r[1], r[2], r[3]);
      gl.uniform4f(this.u.uPhB, r[4], r[5], r[6], r[7]);
      gl.uniform4f(this.u.uPhC, r[8], r[9], r[10], r[11]);
      gl.uniform4f(this.u.uAmpW, r[12], r[13], r[14], r[15]);
      gl.uniform3f(this.u.uAmpF, r[16], r[17], r[18]);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private frame = (_ts: number, dt: number) => {
    // Slow drift while paused, like the real thing.
    this.time += dt * (this.playing ? 1 : 0.3) * this.speed;
    if (this.fading) {
      this.mix = Math.min(1, this.mix + dt / FADE_S);
      if (this.mix >= 1) {
        this.swap();
        this.dirty = true;
      }
    }
    if (this.theme !== this.themeTarget) {
      const step = dt / 0.35;
      this.theme = this.themeTarget > this.theme ? Math.min(this.themeTarget, this.theme + step) : Math.max(this.themeTarget, this.theme - step);
    }

    // Quick to change, a little slower to settle back.
    this.kick *= Math.exp(-dt / 0.28);
    this.beat += (this.kick - this.beat) * Math.min(1, dt / 0.06);
    const pulsing = this.beat > 0.003 || this.kick > 0.003;
    let settling = false;
    const k = Math.min(1, dt / 3);
    for (let i = 0; i < this.seed.length; i++) {
      const d = this.seedTarget[i] - this.seed[i];
      if (Math.abs(d) > 1e-4) settling = true;
      this.seed[i] += d * k;
    }

    this.acc += dt;
    const moving = this.speed > 0 || this.fading || this.theme !== this.themeTarget || pulsing || settling;
    if (!moving && !this.dirty) return;
    if (this.acc < 1 / this.fps - 0.002 && !this.dirty) return;
    this.acc = 0;
    this.dirty = false;
    this.draw();
  };
}

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/**
 * Phases (12) and strengths (4 whirls, 3 folds) of the gradient's moves.
 * Without `from`, a fresh random set; with it, that set nudged for a new song
 * (phases shift, strengths are rolled again), so changes stay gentle.
 */
function rollSeed(from?: number[]): number[] {
  const phases = Array.from({ length: 12 }, (_, i) => (from ? from[i] + rand(-0.7, 0.7) : rand(0, Math.PI * 2)));
  // A whirl may turn either way (fixed per window); a fold may be nearly gone for a song.
  // Each song keeps the way its whirls turn: reversing them would unwind the picture.
  const whirls = Array.from({ length: 4 }, (_, i) => rand(0.6, 1.1) * Math.sign(from ? from[12 + i] : Math.random() - 0.3));
  const folds = Array.from({ length: 3 }, () => (Math.random() < 0.35 ? rand(0, 0.2) : rand(0.6, 1.1)));
  return [...phases, ...whirls, ...folds];
}

const smoothstep = (x: number) => x * x * (3 - 2 * x);

function downsample(src: CanvasImageSource, look: BackgroundLook = "cover"): HTMLCanvasElement {
  const c = document.createElement("canvas");
  const size = look === "gradient" ? GRADIENT_TEX : TEX;
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  // The gradient keeps only the colors: small details melt into their surroundings
  // (large, soft areas, like Apple Music).
  ctx.filter = look === "gradient" ? "blur(16px) saturate(1.1)" : "blur(2px) saturate(1.25)";
  // Overdraw so the blur does not pull in transparent edges.
  const o = look === "gradient" ? 32 : 4;
  ctx.drawImage(src, -o, -o, size + 2 * o, size + 2 * o);
  return c;
}

function averageColor(c: HTMLCanvasElement): [number, number, number] {
  const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < d.length; i += 4) {
    r += d[i];
    g += d[i + 1];
    b += d[i + 2];
  }
  const n = d.length / 4;
  return [r / n, g / n, b / n];
}

function fallbackCover(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = TEX;
  const ctx = c.getContext("2d")!;
  // Monochrome idle look: near-black with slate and graphite haze.
  ctx.fillStyle = "#0b0d0f";
  ctx.fillRect(0, 0, TEX, TEX);
  const blobs: [number, number, number, string][] = [
    [0.18, 0.3, 0.55, "rgba(64, 86, 96, 0.95)"],
    [0.7, 0.62, 0.5, "rgba(78, 80, 82, 0.85)"],
    [0.35, 0.85, 0.45, "rgba(50, 70, 80, 0.9)"],
    [0.9, 0.12, 0.35, "rgba(44, 50, 54, 0.8)"],
  ];
  for (const [x, y, r, color] of blobs) {
    const g = ctx.createRadialGradient(x * TEX, y * TEX, 0, x * TEX, y * TEX, r * TEX);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(11, 13, 15, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, TEX, TEX);
  }
  return c;
}

/** A tiny tiled noise texture that hides banding in the stretched gradient. */
export function noiseDataUrl(): string {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL("image/png");
}
