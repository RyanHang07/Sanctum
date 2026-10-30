import { act, fireEvent, render, screen } from "@testing-library/react";
import { useUpdate } from "./update";
import { useStore } from "./store";
import { UpdateNotice } from "../components/UpdateNotice";
import { AboutSection } from "../pages/setup/About";
import { mockUpdates, resetMockBackend } from "../lib/mockBackend";

const initial = { update: useUpdate.getState(), store: useStore.getState() };

beforeEach(() => {
  resetMockBackend();
  useUpdate.setState(initial.update, true);
  useStore.setState(initial.store, true);
});

describe("one-click updates (v0.3)", () => {
  it("shows a downloaded update and installs it with one click", async () => {
    mockUpdates.available = { version: "0.3.0", notes: "Themes." };
    let stop = () => {};
    await act(async () => {
      stop = useUpdate.getState().start();
    });
    render(<UpdateNotice />);
    expect(await screen.findByText("Sanctum 0.3.0 is ready.")).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Restart to update" })));
    expect(mockUpdates.applied).toBe(true);
    stop();
  });

  it("waits for the seal to end, and Later hides it for now", async () => {
    useUpdate.setState({ ready: { version: "0.3.0", notes: null } });
    useStore.setState({ appState: "sealed" });
    render(<UpdateNotice />);
    expect(screen.getByText("It installs after the seal ends.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restart to update" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(screen.queryByRole("region", { name: "Update ready" })).toBeNull();
  });

  it("Check for updates in Setup › About gets it ready for the same one click", async () => {
    mockUpdates.available = { version: "0.3.0", notes: null };
    render(<AboutSection />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check for updates" })));
    expect(screen.getByText("Version 0.3.0 is downloaded and ready.")).toBeInTheDocument();
    expect(useUpdate.getState().ready?.version).toBe("0.3.0");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Restart to update" })));
    expect(mockUpdates.applied).toBe(true);
    // Privacy, terms, and the license and notices are a click away.
    for (const name of ["Privacy", "Terms", "Legal"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
  });
});
