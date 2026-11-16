import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { TrayPanel, sealTicks } from "./TrayPanel";
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
    // While sealed, the field parks the thought (v0.3.1): a task for today, tagged with the seal.
    const add = panel.getByLabelText("Park a thought for later");
    fireEvent.change(add, { target: { value: "Water the plants" } });
    await act(async () => fireEvent.keyDown(add, { key: "Enter" }));
    expect(await panel.findByText("1/3")).toBeInTheDocument();
    expect(panel.getByRole("checkbox", { name: "Water the plants" })).toBeInTheDocument();
    const todos = await native.listTodos("2000-01-01", "2100-01-01");
    expect(todos.find((t) => t.title === "Water the plants")?.parkedFrom).toBeTruthy();
  });

  it("draws the sealed timer as accent text on the panel, over a neutral ruler", async () => {
    await seed();
    const [p] = await native.listProfiles();
    await native.startSession(p!.id, 60);
    render(<TrayPanel />);
    const panel = within(await screen.findByRole("region", { name: "Sanctum tray panel" }));
    const timer = await panel.findByRole("timer");
    // sealed-on is for text on the accent fill; on the dark panel it was unreadable (Aura, Night Owl).
    expect(timer).toHaveClass("text-sealed-text");
    expect(timer).not.toHaveClass("text-sealed-on");
    const ruler = panel.getByTestId("seal-ruler");
    const ticks = ruler.querySelectorAll("span");
    expect(ticks).toHaveLength(13);
    const majors = ruler.querySelectorAll("span[data-major]");
    expect(majors).toHaveLength(5);
    majors.forEach((t) => expect(t).toHaveClass("bg-muted"));
    // The second colour marks only goals and kept days, never the scale.
    expect(ruler.innerHTML).not.toMatch(/second/);
    expect(panel.getByTestId("state-dot")).toHaveClass("bg-sealed");
  });

  it("is neutral when open: a hollow dot, readable foot line, no faint text or outline-none", async () => {
    await seed();
    render(<TrayPanel />);
    const panel = within(await screen.findByRole("region", { name: "Sanctum tray panel" }));
    await panel.findByText("Quit Sanctum");
    const dot = panel.getByTestId("state-dot");
    expect(dot).toHaveClass("border-muted");
    expect(dot).not.toHaveClass("bg-open");
    expect(panel.getByText(/check-in/)).toHaveClass("text-muted");
    const html = (await screen.findByRole("region", { name: "Sanctum tray panel" })).outerHTML;
    expect(html).not.toMatch(/text-faint|outline-none|uppercase/);
    expect(panel.getByLabelText("Add a task for today")).toHaveClass("focus-ring-off");
  });
});

describe("sealTicks", () => {
  it("ticks every 5 minutes, with quarter hours major", () => {
    const t = sealTicks(45);
    expect(t.map((k) => k.major)).toEqual([true, false, false, true, false, false, true, false, false, true]);
    expect(t[t.length - 1]!.at).toBe(1);
    expect(sealTicks(0)).toEqual([{ at: 0, major: true }]);
  });
});
