import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { TrayPanel } from "./TrayPanel";
import { resetMockBackend } from "../lib/mockBackend";
import { EVENTS, native } from "../lib/native";
import { bus } from "../lib/bus";
import { sampleProfiles } from "../lib/catalog";
import { todayKey } from "../lib/planner";

beforeEach(() => resetMockBackend());

async function seed() {
  for (const d of sampleProfiles()) await native.createProfile(d);
  const today = todayKey();
  for (const title of ["Send the invoice", "Call the bank"]) await native.saveTodo({ title, dueDate: today, dueTime: null, durationMin: null, profileId: null });
}

describe("Tray panel", () => {
  it("enters focus through the main window with the picked profile and length", async () => {
    await seed();
    const heard: unknown[] = [];
    const off = bus.on(EVENTS.enterFocus, (p) => heard.push(p));
    render(<TrayPanel />);
    const panel = within(await screen.findByRole("region", { name: "Sanctum tray panel" }));
    expect(await panel.findByRole("option", { name: "Deep Work" })).toBeInTheDocument();
    fireEvent.change(panel.getByLabelText("Profile"), { target: { value: String((await native.listProfiles()).find((p) => p.name === "Deep Work")!.id) } });
    fireEvent.change(panel.getByLabelText("Duration"), { target: { value: "30" } });
    await act(async () => fireEvent.click(panel.getByRole("button", { name: /Enter focus/ })));
    expect(heard).toEqual([{ profileId: expect.any(Number), minutes: 30 }]);
    expect(panel.getByText("Quit Sanctum")).toBeInTheDocument();
    off();
  });

  it("checks off and adds today's items, and shows the seal when sealed", async () => {
    await seed();
    const [p] = await native.listProfiles();
    await native.startSession(p!.id, 60);
    render(<TrayPanel />);
    const panel = within(await screen.findByRole("region", { name: "Sanctum tray panel" }));
    expect(await panel.findByRole("timer")).toHaveTextContent("60:00");
    expect(panel.getByText(`${p!.name} · until`, { exact: false })).toBeInTheDocument();
    expect(panel.getByText("Break the seal")).toBeInTheDocument();
    expect(panel.getByText("0/2")).toBeInTheDocument();
    await act(async () => fireEvent.click(panel.getByRole("checkbox", { name: "Send the invoice" })));
    expect(await panel.findByText("1/2")).toBeInTheDocument();
    const add = panel.getByLabelText("Add a task for today");
    fireEvent.change(add, { target: { value: "Water the plants" } });
    await act(async () => fireEvent.keyDown(add, { key: "Enter" }));
    expect(await panel.findByText("1/3")).toBeInTheDocument();
    expect(panel.getByRole("checkbox", { name: "Water the plants" })).toBeInTheDocument();
  });
});
