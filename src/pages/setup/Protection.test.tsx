import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ProtectionSection } from "./Protection";
import { Toast } from "../../components/Toast";
import { useStore } from "../../state/store";
import { mockControls, resetMockBackend } from "../../lib/mockBackend";
import { native } from "../../lib/native";

const initial = useStore.getState();

beforeEach(() => {
  resetMockBackend();
  useStore.setState(initial, true);
});

async function renderIt() {
  render(
    <>
      <ProtectionSection />
      <Toast />
    </>,
  );
  return within(await screen.findByRole("region", { name: "Protection" }));
}

describe("Protection", () => {
  it("opens on its status and turns on with one admin approval", async () => {
    const p = await renderIt();
    await waitFor(() => expect(p.getByTestId("protection-status")).toHaveTextContent("Off. Sanctum can be closed while you’re sealed."));
    expect(p.getByTestId("protection-status")).toHaveAttribute("data-tone", "off");
    expect(p.getByText("Asks Windows for approval once.")).toBeInTheDocument();
    await act(async () => fireEvent.click(p.getByRole("button", { name: "Turn on" })));
    const line = p.getByTestId("protection-status");
    expect(line).toHaveTextContent("Sanctum reopens if it’s closed while you’re sealed.");
    expect(line).toHaveAttribute("data-tone", "ok");
    expect(within(line).getByRole("button", { name: "Turn off" })).toBeEnabled();
    expect(p.getByText("While sealed")).toBeInTheDocument();
    expect(p.getByText("None")).toBeInTheDocument();
  });

  it("asks to update a guard from an older Sanctum, and shows its last problem", async () => {
    await native.guardInstall();
    mockControls.guard({ outdated: true, lastError: "Protection couldn't update the hosts file: access denied." });
    const p = await renderIt();
    const line = p.getByTestId("protection-status");
    await waitFor(() => expect(line).toHaveTextContent("From an older Sanctum. Update it."));
    expect(line).toHaveAttribute("data-tone", "attention");
    expect(p.getByRole("alert")).toHaveTextContent("Protection couldn't update the hosts file: access denied.");
    await act(async () => fireEvent.click(within(line).getByRole("button", { name: "Update" })));
    expect(p.getByTestId("protection-status")).toHaveTextContent("Sanctum reopens if it’s closed while you’re sealed.");
  });

  it("explains a declined prompt", async () => {
    mockControls.guard({ decline: true });
    const p = await renderIt();
    await act(async () => fireEvent.click(await p.findByRole("button", { name: "Turn on" })));
    expect(screen.getByRole("status")).toHaveTextContent("Windows didn't allow it. Protection needs one admin approval.");
    expect(p.getByTestId("protection-status")).toHaveTextContent(/^Off\./);
  });

  it("stays on while sealed and reports restarts", async () => {
    await native.guardInstall();
    await native.addDistraction({ kind: "site", value: "twitch.tv" });
    await native.addDistraction({ kind: "site", value: "reddit.com/r/all" });
    const profile = await native.createProfile({ name: "Deep Work" });
    await native.startSession(profile.id, 60);
    mockControls.guard({ restartedAt: new Date(2026, 8, 30, 14, 5).getTime() });
    act(() => useStore.getState().setAppState("sealed"));
    const p = await renderIt();
    // Only the whole-domain site goes in the hosts file.
    expect(await p.findByText("1 now")).toBeInTheDocument();
    expect(p.getByText(/^1, last Sep 30/)).toBeInTheDocument();
    expect(p.getByRole("button", { name: "Stays on while sealed" })).toBeDisabled();
  });

  it("closing apps run as administrator asks first, then stays on while sealed", async () => {
    const p = await renderIt();
    await act(async () => fireEvent.click(await p.findByRole("button", { name: "Turn on" })));
    const toggle = p.getByRole("switch", { name: "Close apps run as administrator" });
    fireEvent.click(toggle);
    expect(p.getByRole("alert")).toHaveTextContent("Unsaved work in them is lost.");
    fireEvent.click(p.getByRole("button", { name: "Cancel" }));
    expect(p.queryByRole("alert")).toBeNull();
    expect(await native.getSetting("guard_close_elevated")).toBeNull();
    fireEvent.click(toggle);
    await act(async () => fireEvent.click(p.getByRole("button", { name: "Close them anyway" })));
    expect(await native.getSetting("guard_close_elevated")).toBe("1");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(native.guardCloseElevated(false)).resolves.toBe(false);
    await native.guardCloseElevated(true);
    await native.createProfile({ name: "Deep Work" });
    await act(() => useStore.getState().loadProfiles());
    await act(async () => void (await useStore.getState().enterFocus()));
    await expect(native.guardCloseElevated(false)).rejects.toBe("This stays on until the seal ends.");
  });
});

describe("Protection's status failing to load (M5)", () => {
  it("says why instead of Checking… forever, with Turn on and Repair still usable", async () => {
    const status = vi.spyOn(native, "guardStatus").mockRejectedValueOnce("The service didn't answer.");
    const p = await renderIt();
    await waitFor(() => expect(p.getByTestId("protection-status")).toHaveTextContent("Couldn’t check protection. The service didn't answer."));
    expect(p.getByRole("button", { name: "Turn on" })).toBeEnabled();
    expect(p.getByRole("button", { name: "Repair" })).toBeEnabled();
    await act(async () => fireEvent.click(p.getByRole("button", { name: "Turn on" })));
    expect(p.getByTestId("protection-status")).toHaveTextContent("Sanctum reopens if it’s closed while you’re sealed.");
    status.mockRestore();
  });
});
