// Sound cues (SPEC 4.0.2, 8). All on by default; Setup › General › Sounds turns them off, sets
// the volume, and picks a style per cue (decided 2026-09-30: audition all, choose per cue).
// Synthesized with Web Audio so nothing is bundled: bell partials for chimes, filtered noise
// for latches and knocks, filtered saws for deep swells, all through a short synthetic room.

export type Cue = "enter" | "blocked" | "held" | "broken" | "exit" | "checkin";
export type Style = "chime" | "latch" | "deep";

export const CUES: { id: Cue; label: string; hint: string }[] = [
  { id: "enter", label: "Enter focus", hint: "The seal closes" },
  { id: "blocked", label: "Blocked", hint: "A sealed app or site is caught" },
  { id: "held", label: "Sanctum held", hint: "A session finishes" },
  { id: "broken", label: "Seal broken", hint: "Tamper or a broken session" },
  { id: "exit", label: "Let out early", hint: "An unlock ends the session" },
  { id: "checkin", label: "Check-in", hint: "A scheduled check-in appears" },
];

export const STYLES: { id: Style; label: string }[] = [
  { id: "chime", label: "Chime" },
  { id: "latch", label: "Latch" },
  { id: "deep", label: "Deep" },
];

export type Styles = Record<Cue, Style>;
// Defaults chosen by audition (2026-09-30).
export const DEFAULT_STYLES: Styles = { enter: "deep", blocked: "chime", held: "deep", broken: "chime", exit: "chime", checkin: "deep" };

let enabled = true;
let volume = 0.7;
let styles: Styles = { ...DEFAULT_STYLES };

export const setSoundsEnabled = (on: boolean) => {
  enabled = on;
};
export const soundsEnabled = () => enabled;
/** 0 to 1. */
export const setSoundVolume = (v: number) => {
  volume = Math.min(1, Math.max(0, v));
};
export const setSoundStyles = (s: Partial<Styles>) => {
  styles = { ...DEFAULT_STYLES, ...s };
};

/** Reads the saved styles, keeping only known cues and styles. */
export function parseStyles(raw: string | null): Styles {
  try {
    const v = JSON.parse(raw ?? "{}") as Record<string, string>;
    const out: Styles = { ...DEFAULT_STYLES };
    for (const c of CUES) if (STYLES.some((s) => s.id === v[c.id])) out[c.id] = v[c.id] as Style;
    return out;
  } catch {
    return { ...DEFAULT_STYLES };
  }
}

type Ctx = AudioContext;

/** A short room: a convolver fed with decaying noise, mixed under the dry signal. */
function room(ctx: Ctx, out: AudioNode, seconds = 1.6, wet = 0.28): AudioNode {
  const input = ctx.createGain();
  const dry = ctx.createGain();
  const verb = ctx.createConvolver();
  const wetGain = ctx.createGain();
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  verb.buffer = buf;
  dry.gain.value = 1;
  wetGain.gain.value = wet;
  input.connect(dry).connect(out);
  input.connect(verb).connect(wetGain).connect(out);
  return input;
}

function withContext(ms: number, play: (ctx: Ctx, out: AudioNode, t: number) => void, delay = 0, force = false) {
  const Ctor = typeof window !== "undefined" ? window.AudioContext : undefined;
  if ((!enabled && !force) || !Ctor || volume <= 0) return;
  const ctx = new Ctor();
  void ctx.resume();
  const master = ctx.createGain();
  master.gain.value = 0.32 * volume;
  // A gentle limiter so stacked partials never clip.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10;
  comp.ratio.value = 6;
  master.connect(comp).connect(ctx.destination);
  play(ctx, master, ctx.currentTime + delay);
  setTimeout(() => void ctx.close(), delay * 1000 + ms);
}

function env(g: GainNode, at: number, peak: number, attack: number, dur: number) {
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
}

function osc(ctx: Ctx, out: AudioNode, freq: number, at: number, dur: number, peak: number, type: OscillatorType = "sine", attack = 0.005) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  env(g, at, peak, attack, dur);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + dur + 0.05);
  return o;
}

/** A struck bell: inharmonic partials, the high ones dying first. */
function bell(ctx: Ctx, out: AudioNode, freq: number, at: number, dur = 2.2, peak = 0.5) {
  const partials: [number, number, number][] = [
    [1, 1, 1],
    [2.0, 0.45, 0.7],
    [2.76, 0.3, 0.5],
    [5.4, 0.12, 0.3],
    [8.93, 0.06, 0.18],
  ];
  for (const [ratio, gain, life] of partials) osc(ctx, out, freq * ratio, at, dur * life, peak * gain, "sine", 0.003);
}

/** Filtered noise: clicks, latches, knocks. */
function noise(ctx: Ctx, out: AudioNode, at: number, dur: number, peak: number, freq: number, q = 1, type: BiquadFilterType = "bandpass") {
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  env(g, at, peak, 0.002, dur);
  src.connect(f).connect(g).connect(out);
  src.start(at);
  src.stop(at + dur + 0.02);
}

/** A body thump: a sine dropping in pitch. */
function thump(ctx: Ctx, out: AudioNode, at: number, from: number, to: number, dur: number, peak: number) {
  const o = osc(ctx, out, from, at, dur, peak, "sine", 0.002);
  o.frequency.setValueAtTime(from, at);
  o.frequency.exponentialRampToValueAtTime(to, at + dur * 0.8);
}

/** A slow swell: detuned saws through a low-pass that opens (or closes). */
function swell(ctx: Ctx, out: AudioNode, freqs: number[], at: number, dur: number, peak: number, open: [number, number], attack = 0.4) {
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.Q.value = 0.7;
  f.frequency.setValueAtTime(open[0], at);
  f.frequency.exponentialRampToValueAtTime(open[1], at + dur * 0.7);
  const g = ctx.createGain();
  env(g, at, peak, attack, dur);
  f.connect(g).connect(out);
  for (const hz of freqs) {
    for (const cents of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = hz;
      o.detune.value = cents;
      const og = ctx.createGain();
      og.gain.value = 0.5 / freqs.length;
      o.connect(og).connect(f);
      o.start(at);
      o.stop(at + dur + 0.1);
    }
  }
}

const N = { C2: 65.41, A2: 110, C3: 130.81, E3: 164.81, G3: 196, A3: 220, C4: 261.63, D4: 293.66, E4: 329.63, G4: 392, A4: 440, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, C6: 1046.5 };

type Voice = (ctx: Ctx, out: AudioNode, t: number) => void;

const SOUNDS: Record<Cue, Record<Style, { ms: number; voice: Voice }>> = {
  enter: {
    // Two bells rising a fifth: the door closes gently.
    chime: { ms: 3200, voice: (c, o, t) => { const r = room(c, o, 2); bell(c, r, N.G4, t, 2.4, 0.42); bell(c, r, N.D5, t + 0.16, 2.6, 0.36); } },
    // A heavy latch: click, the bolt, then the body of the door.
    latch: { ms: 1600, voice: (c, o, t) => { const r = room(c, o, 0.8, 0.18); noise(c, r, t, 0.03, 0.7, 3200, 2); noise(c, r, t + 0.05, 0.09, 0.5, 900, 1.5); thump(c, r, t + 0.05, 140, 48, 0.35, 0.9); } },
    // A low swell opening up, with a sub underneath.
    deep: { ms: 3000, voice: (c, o, t) => { const r = room(c, o, 2.2, 0.3); swell(c, r, [N.A3 / 2, N.A3 * 0.75], t, 2.2, 0.55, [180, 1400], 0.5); osc(c, r, 55, t, 2, 0.35, "sine", 0.4); } },
  },
  blocked: {
    chime: { ms: 1400, voice: (c, o, t) => { const r = room(c, o, 0.9, 0.2); bell(c, r, N.E5, t, 0.7, 0.36); } },
    // A muted knock on wood.
    latch: { ms: 700, voice: (c, o, t) => { noise(c, o, t, 0.05, 0.45, 1400, 4); thump(c, o, t, 260, 150, 0.09, 0.4); } },
    deep: { ms: 900, voice: (c, o, t) => { thump(c, o, t, 110, 70, 0.22, 0.55); osc(c, o, 220, t, 0.18, 0.08, "triangle"); } },
  },
  held: {
    // A rising bell arpeggio in C, left to ring.
    chime: { ms: 4200, voice: (c, o, t) => { const r = room(c, o, 2.6, 0.32); [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => bell(c, r, f, t + i * 0.12, 2.8, 0.36 - i * 0.03)); } },
    // The latch releasing, then one bright ding.
    latch: { ms: 3200, voice: (c, o, t) => { const r = room(c, o, 1.6, 0.24); thump(c, r, t, 90, 160, 0.18, 0.6); noise(c, r, t + 0.02, 0.06, 0.4, 2400, 2); bell(c, r, N.C6, t + 0.2, 2.4, 0.34); } },
    // Peaceful and steady: a grounded root, an open fifth swelling slowly, a low bell rung once.
    deep: { ms: 5600, voice: (c, o, t) => { const r = room(c, o, 3.4, 0.38); osc(c, r, N.C2, t, 4.2, 0.3, "sine", 0.7); swell(c, r, [N.C3, N.G3], t, 4, 0.42, [220, 950], 0.8); osc(c, r, N.E4, t + 0.3, 3.4, 0.07, "triangle", 1.1); bell(c, r, N.C4, t + 0.55, 3.2, 0.22); } },
  },
  broken: {
    // Two bells falling a minor third, slightly out of tune.
    chime: { ms: 3000, voice: (c, o, t) => { const r = room(c, o, 1.8, 0.26); bell(c, r, N.G4, t, 1.6, 0.36); bell(c, r, N.E4 * 0.994, t + 0.3, 2, 0.36); } },
    // A hollow clunk and a rattle.
    latch: { ms: 1400, voice: (c, o, t) => { thump(c, o, t, 180, 60, 0.4, 0.8); noise(c, o, t + 0.08, 0.25, 0.25, 600, 3); noise(c, o, t + 0.18, 0.12, 0.15, 900, 3); } },
    // A low minor drop, the filter closing.
    deep: { ms: 2800, voice: (c, o, t) => { const r = room(c, o, 2, 0.3); swell(c, r, [N.A3 / 2, N.C4 / 2], t, 1.9, 0.55, [1600, 160], 0.08); osc(c, r, 46, t + 0.1, 1.6, 0.3, "sine", 0.1); } },
  },
  exit: {
    // One soft bell, falling back to the root.
    chime: { ms: 2800, voice: (c, o, t) => { const r = room(c, o, 2, 0.28); bell(c, r, N.D5, t, 1.6, 0.3); bell(c, r, N.G4, t + 0.22, 2.2, 0.3); } },
    latch: { ms: 1200, voice: (c, o, t) => { noise(c, o, t, 0.04, 0.5, 2600, 2); thump(c, o, t + 0.03, 70, 130, 0.2, 0.5); } },
    deep: { ms: 2600, voice: (c, o, t) => { const r = room(c, o, 1.8, 0.28); swell(c, r, [N.D4 / 2, N.A3 / 2], t, 1.8, 0.45, [1200, 250], 0.2); } },
  },
  checkin: {
    // A gentle two-tone call.
    chime: { ms: 2400, voice: (c, o, t) => { const r = room(c, o, 1.6, 0.26); bell(c, r, N.E5, t, 1.2, 0.26); bell(c, r, N.B4, t + 0.2, 1.6, 0.26); } },
    latch: { ms: 900, voice: (c, o, t) => { noise(c, o, t, 0.03, 0.35, 1800, 3); noise(c, o, t + 0.14, 0.03, 0.3, 1600, 3); } },
    // A low fifth swells under two soft bells: a calm call, not an alarm.
    deep: { ms: 3800, voice: (c, o, t) => { const r = room(c, o, 2.6, 0.34); osc(c, r, 55, t, 2.4, 0.2, "sine", 0.35); swell(c, r, [N.A2, N.E3], t, 2.4, 0.36, [200, 800], 0.4); bell(c, r, N.A3, t + 0.25, 2.4, 0.2); bell(c, r, N.E4, t + 0.6, 2.2, 0.13); } },
  },
};

/** Plays a cue in its chosen style after `delay` seconds (the held chime waits for the logo). */
export function play(cue: Cue, delay = 0) {
  try {
    const s = SOUNDS[cue][styles[cue]];
    withContext(s.ms, s.voice, delay);
  } catch {
    // Audio is a nicety; never let it break a flow.
  }
}

/** Plays one style of a cue now, even with sounds off (Setup's audition). */
export function preview(cue: Cue, style: Style) {
  try {
    const s = SOUNDS[cue][style];
    withContext(s.ms, s.voice, 0, true);
  } catch {
    // As above.
  }
}
