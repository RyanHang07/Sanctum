import { CUES, DEFAULT_STYLES, parseStyles, STYLES } from "./sound";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { act } from "react";
import { SoundsSection } from "../pages/setup/Sounds";
import { useStore } from "../state/store";
import { native } from "./native";
import { resetMockBackend } from "./mockBackend";

const initial = useStore.getState();
beforeEach(() => {
  resetMockBackend();
  useStore.setState(initial, true);
});

describe("sound styles", () => {
  it("reads saved styles, keeping only known cues and styles", () => {
    expect(parseStyles(null)).toEqual(DEFAULT_STYLES);
    expect(parseStyles("not json")).toEqual(DEFAULT_STYLES);
    expect(parseStyles(JSON.stringify({ enter: "latch", held: "banjo", nope: "chime" }))).toEqual({ ...DEFAULT_STYLES, enter: "latch" });
    expect(CUES.map((c) => c.id)).toEqual(["enter", "blocked", "held", "broken", "exit", "checkin"]);
    expect(STYLES.map((s) => s.id)).toEqual(["chime", "latch", "deep"]);
  });

  it("picks a style per cue in Setup and saves it, with the volume", async () => {
    render(<SoundsSection />);
    const section = within(screen.getByRole("region", { name: "Sounds" }));
    const enter = within(section.getByRole("radiogroup", { name: "Enter focus sound" }));
    expect(enter.getByRole("radio", { name: "Deep" })).toHaveAttribute("aria-checked", "true");
    await act(async () => fireEvent.click(enter.getByRole("radio", { name: "Latch" })));
    expect(enter.getByRole("radio", { name: "Latch" })).toHaveAttribute("aria-checked", "true");
    expect(JSON.parse((await native.getSetting("sound_styles"))!).enter).toBe("latch");
    fireEvent.change(section.getByRole("slider", { name: "Volume" }), { target: { value: "40" } });
    expect(await native.getSetting("sound_volume")).toBe("40");
    await act(() => useStore.getState().loadSettings());
    expect(useStore.getState().settings.soundStyles.enter).toBe("latch");
    expect(useStore.getState().settings.soundVolume).toBe(40);
  });
});
