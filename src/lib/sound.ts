// Sound cues (SPEC 4.0.2, 8). All on by default; Setup > Preferences > Sounds turns them off.
// Synthesized with Web Audio so nothing is bundled.

export type Cue = "enter" | "blocked" | "held" | "broken";

let enabled = true;
export const setSoundsEnabled = (on: boolean) => {
  enabled = on;
};
export const soundsEnabled = () => enabled;

type Ctx = AudioContext;

function withContext(ms: number, play: (ctx: Ctx, out: GainNode) => void) {
  const Ctor = typeof window !== "undefined" ? window.AudioContext : undefined;
  if (!enabled || !Ctor) return;
  const ctx = new Ctor();
  void ctx.resume();
  const master = ctx.createGain();
  master.gain.value = 0.22;
  master.connect(ctx.destination);
  play(ctx, master);
  setTimeout(() => void ctx.close(), ms);
}

function tone(ctx: Ctx, out: AudioNode, freq: number, at: number, dur: number, peak: number, type: OscillatorType = "sine", attack = 0.02) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(peak, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g);
  g.connect(out);
  o.start(at);
  o.stop(at + dur + 0.05);
}

const CUES: Record<Cue, (delay: number) => void> = {
  // One low sine tone, 220 Hz, soft swell.
  enter: (delay) =>
    withContext(delay * 1000 + 2000, (ctx, out) => tone(ctx, out, 220, ctx.currentTime + delay, 1.4, 0.7, "sine", 0.35)),
  // Muted tick.
  blocked: (delay) =>
    withContext(delay * 1000 + 600, (ctx, out) => {
      const t = ctx.currentTime + delay;
      tone(ctx, out, 1800, t, 0.05, 0.25, "triangle", 0.002);
      tone(ctx, out, 900, t, 0.08, 0.2, "sine", 0.002);
    }),
  // Rising C major arpeggio (C5 E5 G5 C6), sine + octave shimmer, ~1.6s decay (HeldPage.dc.html).
  held: (delay) =>
    withContext(delay * 1000 + 3800, (ctx, out) => {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        const t = ctx.currentTime + delay + i * 0.11;
        tone(ctx, out, f, t, 1.6, 0.9, "sine");
        tone(ctx, out, f * 2, t, 1.6, 0.18, "triangle");
      });
    }),
  // Two notes falling a minor third.
  broken: (delay) =>
    withContext(delay * 1000 + 2000, (ctx, out) => {
      const t = ctx.currentTime + delay;
      tone(ctx, out, 392, t, 0.6, 0.6, "sine");
      tone(ctx, out, 329.63, t + 0.28, 0.9, 0.6, "sine");
    }),
};

/** Plays a cue after `delay` seconds (the held chime waits for the logo to draw). */
export function play(cue: Cue, delay = 0) {
  try {
    CUES[cue](delay);
  } catch {
    // Audio is a nicety; never let it break a flow.
  }
}
