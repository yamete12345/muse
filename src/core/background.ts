/**
 * Living cover-art background: several rotating, warped copies of a tiny,
 * pre-blurred cover texture. Rendered at a fraction of the window resolution
 * and stretched by the compositor, so it costs almost nothing on the GPU.
 */
import { onFrame } from "./ticker";

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uA;
uniform sampler2D uB;
uniform float uMix;
uniform float uTime;
uniform float uTheme;
uniform float uAspect;

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
  vec3 col = mix(cover(uA, p), cover(uB, p), uMix);
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  vec3 dark = mix(vec3(l), col, 1.35) * 0.6;
  vec3 light = mix(vec3(l), col, 0.8) * 0.42 + 0.56;
  vec3 c = mix(dark, light, uTheme);
  float v = smoothstep(1.25, 0.15, length(vUv - 0.5) * 1.4);
  c *= mix(mix(0.78, 1.0, v), mix(0.95, 1.0, v), uTheme);
  gl_FragColor = vec4(c, 1.0);
}`;

const TEX = 64;
const SCALE = 1 / 6;
const FADE_S = 1.3;

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
  private average: [number, number, number] = [70, 58, 110];
  onTone: ((rgb: [number, number, number]) => void) | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
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
      [gl.FRAGMENT_SHADER, FRAG],
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

    for (const name of ["uA", "uB", "uMix", "uTime", "uTheme", "uAspect"]) this.u[name] = gl.getUniformLocation(prog, name);
    gl.uniform1i(this.u.uA, 0);
    gl.uniform1i(this.u.uB, 1);

    this.texA = this.makeTexture(0);
    this.texB = this.makeTexture(1);
    this.upload(this.texA, 0, fallbackCover());

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
      const v = light ? (l + (c - l) * 0.8) * 0.42 + 0.56 * 255 : (l + (c - l) * 1.35) * 0.6 * 0.9;
      return Math.round(Math.min(255, Math.max(0, v)));
    }) as [number, number, number];
  }

  setCover(url: string | null) {
    const token = ++this.loadToken;
    const apply = (src: CanvasImageSource) => {
      if (token !== this.loadToken) return;
      // Commit any running fade so the new cover fades from what is on screen.
      if (this.fading) this.swap();
      const small = downsample(src);
      this.average = averageColor(small);
      this.onTone?.(this.tone());
      this.upload(this.texB, 1, small);
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
    const w = Math.max(48, Math.round(this.canvas.clientWidth * SCALE));
    const h = Math.max(48, Math.round(this.canvas.clientHeight * SCALE));
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
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private frame = (_ts: number, dt: number) => {
    // Slow drift while paused, like the real thing.
    this.time += dt * (this.playing ? 1 : 0.3);
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

    this.acc += dt;
    if (this.acc < 1 / this.fps - 0.002 && !this.dirty) return;
    this.acc = 0;
    this.dirty = false;
    this.draw();
  };
}

const smoothstep = (x: number) => x * x * (3 - 2 * x);

function downsample(src: CanvasImageSource): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = TEX;
  const ctx = c.getContext("2d")!;
  ctx.filter = "blur(2px) saturate(1.25)";
  // Overdraw slightly so the blur does not pull in transparent edges.
  ctx.drawImage(src, -4, -4, TEX + 8, TEX + 8);
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
  const g = ctx.createLinearGradient(0, 0, TEX, TEX);
  g.addColorStop(0, "#5b3a7a");
  g.addColorStop(0.5, "#2a3f73");
  g.addColorStop(1, "#7a3a52");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, TEX, TEX);
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
