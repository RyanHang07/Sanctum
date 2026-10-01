import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { quietSummary, quietWindowEnd } from "./quiet";
import { native } from "./native";
import { resetMockBackend } from "./mockBackend";
import { useStore } from "../state/store";
import { QuietHoursSection } from "../pages/setup/QuietHours";
import { QuietPauseDialog } from "../components/QuietPauseDialog";
import { QuietCard } from "../windows/Intercept";
import { Toast } from "../components/Toast";
import type { Intercept, QuietConfig } from "./types";

const initial = useStore.getState();
beforeEach(() => {
  resetMockBackend();
  useStore.setState(initial, true);
});

const pad = (n: number) => String(n).padStart(2, "0");
/** A window around now: from an hour ago to an hour ahead (crossing midnight if it must). */
function windowNow(): QuietConfig {
  const h = new Date().getHours();
  return { enabled: true, daysMask: 127, start: `${pad((h + 23) % 24)}:00`, end: `${pad((h + 1) % 24)}:59` };
}

describe("quiet hours schedule", () => {
  it("belongs to the day it starts on and runs past midnight", () => {
    // 2026-10-02 is a Friday.
    const fri = { enabled: true, daysMask: 1 << 5, start: "23:00", end: "07:00" };
    expect(quietWindowEnd(fri, new Date(2026, 9, 2, 23, 30))).toEqual(new Date(2026, 9, 3, 7, 0));
    expect(quietWindowEnd(fri, new Date(2026, 9, 3, 6, 59))).toEqual(new Date(2026, 9, 3, 7, 0));
    expect(quietWindowEnd(fri, new Date(2026, 9, 3, 7, 0))).toBeNull();
    expect(quietWindowEnd(fri, new Date(2026, 9, 3, 23, 30))).toBeNull();
    expect(quietWindowEnd({ ...fri, enabled: false }, new Date(2026, 9, 2, 23, 30))).toBeNull();
    expect(quietSummary({ enabled: true, daysMask: 127, start: "23:00", end: "07:00" })).toBe("Every night");
    expect(quietSummary({ enabled: true, daysMask: 0b0111110, start: "09:00", end: "17:00" })).toBe("Weekdays");
  });

  it("turns on and edits the schedule in Setup", async () => {
    // Midday, outside the default 11 PM to 7 AM window, so the schedule stays editable.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 30, 12, 0));
    onTestFinished(() => {
      vi.useRealTimers();
    });
    await act(() => useStore.getState().loadQuiet());
    render(<QuietHoursSection />);
    const section = within(screen.getByRole("region", { name: "Quiet hours" }));
    expect(section.getByTestId("quiet-status")).toHaveTextContent("Off");
    await act(async () => fireEvent.click(section.getByRole("switch", { name: "Quiet hours" })));
    // Saturday's window off, the end moved: saved, and summarized.
    await act(async () => fireEvent.click(section.getByRole("button", { name: "Sat" })));
    await act(async () => fireEvent.change(section.getByRole("combobox", { name: "Until" }), { target: { value: "06:30" } }));
    const saved = (await native.quietStatus()).config;
    expect(saved).toMatchObject({ enabled: true, daysMask: 0b0111111, start: "23:00", end: "06:30" });
    expect(section.getByTestId("quiet-status")).toHaveTextContent("Sun, Mon, Tue, Wed, Thu, Fri, 11:00 PM to 6:30 AM");
  });

  it("holds the schedule mid-window, and pauses 15 minutes only with a reason", async () => {
    await native.quietSave(windowNow());
    await act(() => useStore.getState().loadQuiet());
    expect(useStore.getState().quiet?.on).toBe(true);
    render(
      <>
        <QuietHoursSection />
        <QuietPauseDialog />
        <Toast />
      </>,
    );
    expect(screen.getByRole("switch", { name: "Quiet hours" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sat" })).toBeDisabled();
    expect(screen.getByTestId("quiet-status")).toHaveTextContent("On now until");

    act(() => useStore.getState().openQuietPause());
    const dialog = within(screen.getByRole("dialog", { name: "Pause quiet hours" }));
    expect(dialog.getByRole("button", { name: /Pause 15 min/ })).toBeDisabled();
    fireEvent.change(dialog.getByLabelText("Why pause"), { target: { value: "Calling my sister back" } });
    await act(async () => fireEvent.click(dialog.getByRole("button", { name: /Pause 15 min/ })));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Quiet hours paused.");
    const q = useStore.getState().quiet!;
    expect(q.on).toBe(false);
    expect(q.pausedUntil! - Date.now()).toBeGreaterThan(14 * 60_000);
    expect(screen.getByTestId("quiet-status")).toHaveTextContent("Paused until");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Resume now" })));
    expect(useStore.getState().quiet?.on).toBe(true);
  });

  it("the overlay offers the pause and a way back", () => {
    const onPause = vi.fn();
    const p: Intercept = {
      kind: "quiet",
      label: "Discord",
      attempts: 0,
      profileName: "Quiet hours",
      elapsedMs: 0,
      remainingMs: 42 * 60_000,
      backTo: "Visual Studio Code",
      keyword: null,
      endsAt: new Date(2026, 9, 3, 7, 0).getTime(),
    };
    render(<QuietCard p={p} onBack={vi.fn()} onPause={onPause} />);
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Discord waits until 7:00 AM.");
    fireEvent.click(screen.getByRole("button", { name: "Pause 15 min" }));
    expect(onPause).toHaveBeenCalledOnce();
  });
});
