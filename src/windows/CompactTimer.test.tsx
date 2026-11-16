import { act, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { CompactTimer } from "./CompactTimer";
import { resetMockBackend } from "../lib/mockBackend";
import { EVENTS, native } from "../lib/native";
import { bus } from "../lib/bus";
import { sampleProfiles } from "../lib/catalog";
import type { HeldStats } from "../lib/types";

// The compact timer (redesign S8): text stays readable on both sides of the fill, and the held
// moment is a crisp second-colour edge and a closed ring, with no glow.

beforeEach(() => resetMockBackend());

const heldStats = (over: Partial<HeldStats> = {}): HeldStats => ({
  sessionId: 1,
  profileId: 1,
  profileName: "Deep Work",
  plannedMinutes: 60,
  focusMinutes: 60,
  attempts: 0,
  broken: false,
  ...over,
});

async function sealed() {
  for (const d of sampleProfiles()) await native.createProfile(d);
  const [p] = await native.listProfiles();
  await native.startSession(p!.id, 60);
  return p!;
}

describe("Compact timer", () => {
  it("shows the seal's time left, with the sub-line in text-2 over the panel and no fade", async () => {
    const p = await sealed();
    render(<CompactTimer />);
    const timer = await screen.findByRole("timer", { name: /Focus timer, 60:00 left/ });
    expect(timer).toHaveClass("border-sealed-line");
    expect(timer).not.toHaveAttribute("data-held");
    expect(screen.getAllByText(p.name)).toHaveLength(2);
    const subs = screen.getAllByText(/min left · until/);
    expect(subs[0]).toHaveClass("text-text-2");
    expect(timer.innerHTML).not.toMatch(/opacity-80/);
  });

  it("marks the held moment crisply: closed ring, second-colour edge, plain copy", async () => {
    await sealed();
    render(<CompactTimer />);
    await screen.findByRole("timer", { name: /left/ });
    act(() => bus.emit(EVENTS.held, heldStats()));
    const timer = screen.getByRole("timer", { name: "Focus timer, held" });
    expect(timer).toHaveAttribute("data-held", "true");
    expect(timer).toHaveClass("border-second");
    expect(timer).not.toHaveClass("border-sealed-line");
    expect(screen.getAllByText("Held. 60 of 60 minutes.")).toHaveLength(2);
    // The fill covers the whole widget, and the ring is closed.
    expect(screen.getByTestId("on-fill").style.clipPath).toBe("inset(0 0% 0 0)");
    const arcs = timer.querySelectorAll("circle[stroke-dashoffset]");
    arcs.forEach((c) => expect(c.getAttribute("stroke-dashoffset")).toBe("0.0"));
    // No glow anywhere (decided 2026-11-16).
    expect(timer.outerHTML).not.toMatch(/shadow|blur|drop-shadow|glow/);
  });

  it("names a broken seal plainly, without the held edge", async () => {
    await sealed();
    render(<CompactTimer />);
    await screen.findByRole("timer", { name: /left/ });
    act(() => bus.emit(EVENTS.held, heldStats({ broken: true })));
    const timer = screen.getByRole("timer", { name: "Focus timer, seal broken" });
    expect(timer).not.toHaveClass("border-second");
    expect(screen.getAllByText("Seal broken.")).toHaveLength(2);
  });

  it("has no casual copy, and every glide drops under reduced motion", () => {
    const src = readFileSync("src/windows/CompactTimer.tsx", "utf8");
    expect(src).not.toMatch(/Held\. Nice\./);
    const glides = src.match(/duration-glide/g)?.length ?? 0;
    expect(glides).toBeGreaterThan(0);
    expect(src.match(/motion-reduce:transition-none/g)?.length ?? 0).toBeGreaterThanOrEqual(glides);
  });
});
