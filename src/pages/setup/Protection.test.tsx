import { act, fireEvent, render, screen, within } from "@testing-library/react";
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
  it("turns on with one admin approval, and says what it covers", async () => {
    const p = await renderIt();
    expect(await p.findByText("Off")).toBeInTheDocument();
    expect(p.getByText(/Links, keywords, and sites with allowed pages stay with the browser extension/)).toBeInTheDocument();
    await act(async () => fireEvent.click(p.getByRole("button", { name: "Turn on protection" })));
    expect(p.getByText("On")).toBeInTheDocument();
    expect(p.getByText("Sites are blocked in every browser while you’re sealed.")).toBeInTheDocument();
    expect(p.getByText("Hasn’t needed to bring Sanctum back.")).toBeInTheDocument();
  });

  it("explains a declined prompt", async () => {
    mockControls.guard({ decline: true });
    const p = await renderIt();
    await act(async () => fireEvent.click(await p.findByRole("button", { name: "Turn on protection" })));
    expect(screen.getByRole("status")).toHaveTextContent("Windows didn't allow it. Protection needs one admin approval.");
    expect(p.getByText("Off")).toBeInTheDocument();
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
    expect(await p.findByText("1 site is blocked in every browser right now.")).toBeInTheDocument();
    expect(p.getByText(/Brought Sanctum back 1 time, last on Sep 30/)).toBeInTheDocument();
    expect(p.getByRole("button", { name: "Stays on while sealed" })).toBeDisabled();
  });
});
