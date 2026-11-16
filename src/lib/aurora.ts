import { rgb } from "../theme/color";

// The aurora's engine (redesign F4, decided 2026-11-15 "Audit follow-ups"): a northern-lights
// fragment shader on one WebGL canvas. A bright wavy band glows in the accent, rays rise from it
// and fade into the second colour at their tips, and the whole is veiled toward the page colour.
// Colours come from the theme's CSS variables at runtime, so it follows every theme.
// The component (components/Aurora.tsx) decides when it moves; this file only draws.

export type AuroraTone = "open" | "sealed" | "event" | "held" | "broken";
export type AuroraPlacement = "top" | "bottom";

export interface AuroraLevel {
  /** Overall opacity of the light, 0 to 1. */
  strength: number;
  /** How fast the curtain drifts (shader seconds per real second). */
  speed: number;
  /** Colour saturation: 1 is the theme's own colours, 0 drains them to grey. */
  sat: number;
  /** Frame-rate cap while it moves. 0 means a still frame. */
  fps: number;
}

/**
 * Per state: near-still and barely there while open, brighter and livelier while sealed,
 * fullest on the held page, drained to grey (and slowed to a third) on a broken seal.
 */
export const LEVELS: Readonly<Record<AuroraTone, AuroraLevel>> = {
  open: { strength: 0.22, speed: 0.12, sat: 1, fps: 20 },
  sealed: { strength: 0.55, speed: 0.45, sat: 1, fps: 30 },
  event: { strength: 0.5, speed: 0.4, sat: 1, fps: 30 },
  held: { strength: 0.95, speed: 0.7, sat: 1, fps: 30 },
  broken: { strength: 0.6, speed: 0.23, sat: 0, fps: 24 },
};

/** Light themes: a pale page turns loud quickly, so every level is scaled down. */
export const LIGHT_SCALE = 0.6;

/** On battery and not charging: open goes still, the rest run at half the frame rate. */
export function levelFor(tone: AuroraTone, onBattery: boolean): AuroraLevel {
  const l = LEVELS[tone];
  if (!onBattery) return l;
  return { ...l, fps: tone === "open" ? 0 : Math.round(l.fps / 2) };
}

/** How long a change of state takes to settle (the `drain` motion token). */
export const AURORA_SETTLE_MS = 1200;

/** The shader time a still frame is drawn at: a moment where band and rays both read. */
export const STILL_T = 17.5;

type Rgb3 = [number, number, number];

/** A CSS colour value (hex or rgb()/rgba()) as 0..1 channels, or null when it can't be read. */
export function parseColour(value: string): Rgb3 | null {
  const v = value.trim();
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?([0-9a-f]{2})?$/i.test(v)) {
    const h = v.length === 9 ? v.slice(0, 7) : v.length === 5 ? v.slice(0, 4) : v;
    return rgb(h).map((c) => c / 255) as Rgb3;
  }
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(v);
  if (m) return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255];
  return null;
}

export interface AuroraColours {
  band: Rgb3;
  tip: Rgb3;
  page: Rgb3;
  light: boolean;
}

const FALLBACK: Rgb3 = [0.5, 0.5, 0.5];

/** The theme's colours for a tone, read from <html>'s CSS variables. */
export function readColours(tone: AuroraTone, root: HTMLElement = document.documentElement): AuroraColours {
  const css = getComputedStyle(root);
  const get = (name: string) => parseColour(css.getPropertyValue(`--s-${name}`) || root.style.getPropertyValue(`--s-${name}`)) ?? null;
  return {
    band: get(tone === "event" ? "event" : "sealed") ?? FALLBACK,
    tip: get("second") ?? get("event") ?? FALLBACK,
    page: get("app") ?? [0, 0, 0],
    light: root.dataset.scheme === "light",
  };
}

const VERT = `attribute vec2 a_pos; void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

export const FRAG = `precision mediump float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_strength;
uniform float u_sat;
uniform float u_flip;
uniform vec3 u_band;
uniform vec3 u_tip;
uniform vec3 u_page;

float hash(float n) { return fract(sin(n) * 43758.5453); }
float noise(float x) {
  float i = floor(x);
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(hash(i), hash(i + 1.0), f);
}
vec3 grey(vec3 c, float s) { return mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, s); }

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  if (u_flip > 0.5) uv.y = 1.0 - uv.y;
  float x = uv.x * (u_res.x / u_res.y);
  float t = u_time;
  vec3 col = vec3(0.0);
  float w = 0.0;
  float tipMix = 0.0;
  for (int i = 0; i < 2; i++) {
    float fi = float(i);
    // The curtain's lower edge: a slow wave with a little noise in it.
    float band = 0.24 + 0.1 * fi
      + 0.07 * sin(x * 1.3 + t * 0.21 + fi * 2.0)
      + 0.035 * sin(x * 3.7 - t * 0.33 + fi * 4.1)
      + 0.03 * (noise(x * 2.0 + t * 0.15 + fi * 9.0) - 0.5);
    float d = uv.y - band;
    float edge = exp(-abs(d) * (d < 0.0 ? 34.0 : 12.0));
    // Rays: vertical streaks rising from the band, each its own height, flickering slowly.
    float streak = noise(x * 24.0 + fi * 31.0 + t * 0.4) * 0.6 + noise(x * 61.0 - t * 0.7 + fi * 7.0) * 0.4;
    float len = 0.14 + 0.22 * noise(x * 3.0 + t * 0.1 + fi * 5.0);
    float ray = d > 0.0 ? exp(-d / len) * streak * streak * (1.0 - smoothstep(0.2, 0.6, d)) : 0.0;
    float k = smoothstep(0.0, len * 1.4, max(d, 0.0));
    float layer = (edge * 0.9 + ray * 0.9) * (1.0 - 0.35 * fi);
    col += mix(u_band, u_tip, k) * layer;
    tipMix += k * layer;
    w += layer;
  }
  col /= max(w, 0.0001);
  tipMix /= max(w, 0.0001);
  // A broken seal drains the accent to grey; the tips keep a faint trace of the second colour.
  col = grey(col, mix(u_sat, max(u_sat, 0.35), tipMix));
  // Veiled toward the page colour, so text stays in front.
  col = mix(u_page, col, 0.85);
  float a = clamp(w, 0.0, 1.0) * u_strength;
  gl_FragColor = vec4(col * a, a);
}`;

export interface AuroraTarget {
  strength: number;
  speed: number;
  sat: number;
  band: Rgb3;
  tip: Rgb3;
  page: Rgb3;
  flip: boolean;
}

/** The target a tone, placement and theme add up to. */
export function targetFor(tone: AuroraTone, placement: AuroraPlacement, colours: AuroraColours, level: AuroraLevel = LEVELS[tone]): AuroraTarget {
  return {
    strength: level.strength * (colours.light ? LIGHT_SCALE : 1),
    speed: level.speed,
    sat: level.sat,
    band: colours.band,
    tip: colours.tip,
    page: colours.page,
    flip: placement === "top",
  };
}

export interface AuroraEngine {
  /** Where the light is headed. `immediate` jumps there (still frames, first paint). */
  setTarget(target: AuroraTarget, immediate: boolean): void;
  /** Match the canvas's drawing buffer to its size on screen. */
  resize(): void;
  /** Draw one frame at the current time. */
  draw(): void;
  /** Draw the still frame (reduced motion, battery saver). */
  drawStill(): void;
  /** Move, capped at `fps`. */
  start(fps: number): void;
  stop(): void;
  readonly running: boolean;
  destroy(): void;
}

/** True when this web view has WebGL at all (jsdom and some locked-down GPUs don't). */
export function webglAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.WebGLRenderingContext !== "undefined";
}

/** Half resolution: the light is soft, and a quarter of the pixels is a quarter of the work. */
const RES_SCALE = 0.5;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    gl.deleteShader(s);
    return null;
  }
  return s;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const lerp3 = (a: Rgb3, b: Rgb3, k: number): Rgb3 => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];

/** Sets up the shader on `canvas`, or returns null when WebGL can't be had (CSS fallback). */
export function createAurora(canvas: HTMLCanvasElement): AuroraEngine | null {
  if (!webglAvailable()) return null;
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: "low-power" }) as WebGLRenderingContext | null;
  } catch {
    gl = null;
  }
  if (!gl) return null;
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  const program = gl.createProgram();
  if (!vs || !fs || !program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const pos = gl.getAttribLocation(program, "a_pos");
  gl.enableVertexAttribArray(pos);
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

  const u = (name: string) => gl!.getUniformLocation(program, name);
  const loc = {
    res: u("u_res"),
    time: u("u_time"),
    strength: u("u_strength"),
    sat: u("u_sat"),
    flip: u("u_flip"),
    band: u("u_band"),
    tip: u("u_tip"),
    page: u("u_page"),
  };

  let cur: AuroraTarget | null = null;
  let goal: AuroraTarget | null = null;
  let time = STILL_T;
  let raf = 0;
  let last = 0;
  let lastDraw = 0;

  const paint = () => {
    if (!cur || !gl) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(loc.res, canvas.width || 1, canvas.height || 1);
    gl.uniform1f(loc.time, time);
    gl.uniform1f(loc.strength, cur.strength);
    gl.uniform1f(loc.sat, cur.sat);
    gl.uniform1f(loc.flip, cur.flip ? 1 : 0);
    gl.uniform3f(loc.band, ...cur.band);
    gl.uniform3f(loc.tip, ...cur.tip);
    gl.uniform3f(loc.page, ...cur.page);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const step = (dt: number) => {
    if (!cur || !goal) return;
    // Ease toward the goal: about 95% of the way in AURORA_SETTLE_MS.
    const k = 1 - Math.exp((-dt * 3000) / AURORA_SETTLE_MS);
    cur = {
      strength: lerp(cur.strength, goal.strength, k),
      speed: lerp(cur.speed, goal.speed, k),
      sat: lerp(cur.sat, goal.sat, k),
      band: lerp3(cur.band, goal.band, k),
      tip: lerp3(cur.tip, goal.tip, k),
      page: lerp3(cur.page, goal.page, k),
      flip: goal.flip,
    };
    time += dt * cur.speed;
  };

  const engine: AuroraEngine = {
    setTarget(target, immediate) {
      goal = target;
      if (immediate || !cur) cur = target;
    },
    resize() {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(r.width * dpr * RES_SCALE));
      const h = Math.max(1, Math.round(r.height * dpr * RES_SCALE));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
    },
    draw: paint,
    drawStill() {
      if (goal) cur = goal;
      time = STILL_T;
      paint();
    },
    start(fps) {
      engine.stop();
      const frame = 1000 / Math.max(1, fps);
      last = performance.now();
      lastDraw = 0;
      const tick = (now: number) => {
        raf = requestAnimationFrame(tick);
        // Skip frames past the cap: the light is slow, and every skipped frame is battery kept.
        if (now - lastDraw < frame - 1) return;
        step(Math.min(0.1, (now - last) / 1000));
        last = now;
        lastDraw = now;
        paint();
      };
      raf = requestAnimationFrame(tick);
    },
    stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
    get running() {
      return raf !== 0;
    },
    destroy() {
      engine.stop();
      gl?.deleteProgram(program);
      gl?.deleteBuffer(buf);
      gl = null;
    },
  };
  return engine;
}
