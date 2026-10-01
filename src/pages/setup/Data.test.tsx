import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { DataSection } from "./Data";
import { Toast } from "../../components/Toast";
import { native } from "../../lib/native";
import { resetMockBackend } from "../../lib/mockBackend";
import { useStore } from "../../state/store";

const initial = useStore.getState();
beforeEach(() => {
  resetMockBackend();
  useStore.setState(initial, true);
});

describe("Your data", () => {
  it("exports, backs up, and restores after a confirmation", async () => {
    const reload = vi.fn();
    render(
      <>
        <DataSection reload={reload} />
        <Toast />
      </>,
    );
    const section = within(screen.getByRole("region", { name: "Your data" }));
    await act(async () => fireEvent.click(section.getByRole("button", { name: "JSON" })));
    expect(screen.getByRole("status")).toHaveTextContent("Exported.");
    expect(section.getByText(/Saved Sanctum export/)).toBeInTheDocument();

    await act(async () => fireEvent.click(section.getByRole("button", { name: "Back up now" })));
    const list = within(await section.findByRole("list", { name: "Backups" }));
    const [b] = await native.backupList();
    fireEvent.click(list.getByRole("button", { name: `Restore ${b!.name}` }));
    expect(list.getByText(/What's here now is backed up first/)).toBeInTheDocument();
    await act(async () => fireEvent.click(list.getByRole("button", { name: "Restore it" })));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("restoring waits while sealed", async () => {
    await native.backupCreate();
    act(() => useStore.getState().setAppState("sealed"));
    render(<DataSection reload={vi.fn()} />);
    expect(await screen.findByRole("button", { name: /^Restore Sanctum backup/ })).toBeDisabled();
  });
});
