import { describe, expect, it } from "vitest";
import extra from "../theme/extra.json";
import { DUR, EASE, gsap } from "./gsap";

describe("GSAP setup", () => {
  it("reads durations from the motion tokens, in seconds", () => {
    expect(DUR.ui).toBeCloseTo(0.12);
    expect(DUR.enter).toBeCloseTo(0.18);
    expect(DUR.state).toBeCloseTo(0.24);
    expect(DUR.glide).toBeCloseTo(0.4);
    expect(DUR.moment).toBeCloseTo(0.7);
    expect(DUR.drain).toBeCloseTo(1.2);
    expect(DUR.breathe).toBeCloseTo(3.2);
    expect(Object.keys(DUR).sort()).toEqual(Object.keys(extra.motion.duration).sort());
  });

  it("registers every easing token as a named ease", () => {
    expect(Object.keys(EASE).sort()).toEqual(["drift", "exit", "glide", "seat", "settle", "snap", "ui"]);
    for (const name of Object.values(EASE)) {
      const ease = gsap.parseEase(name);
      expect(ease(0)).toBeCloseTo(0);
      expect(ease(1)).toBeCloseTo(1);
    }
  });

  it("gives the app one overshoot: the keyhole seat", () => {
    const peak = (name: string) => Math.max(...Array.from({ length: 101 }, (_, i) => gsap.parseEase(name)(i / 100)));
    expect(peak(EASE.seat)).toBeGreaterThan(1.01);
    for (const name of [EASE.ui, EASE.glide, EASE.settle, EASE.exit, EASE.drift]) expect(peak(name)).toBeLessThanOrEqual(1.0001);
  });

  it("exits accelerate away; entrances decelerate in", () => {
    expect(gsap.parseEase(EASE.exit)(0.5)).toBeLessThan(0.5);
    expect(gsap.parseEase(EASE.ui)(0.5)).toBeGreaterThan(0.5);
  });

  it("defaults tweens to the enter duration and the UI ease", () => {
    const t = gsap.to({ v: 0 }, { v: 1 });
    expect(t.duration()).toBeCloseTo(DUR.enter);
    t.kill();
  });
});
