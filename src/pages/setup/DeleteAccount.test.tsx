import { act, fireEvent, render, screen } from "@testing-library/react";
import { DeleteAccount } from "./Account";
import { native } from "../../lib/native";
import { resetMockBackend } from "../../lib/mockBackend";
import { useStore } from "../../state/store";

const initial = useStore.getState();
beforeEach(() => {
  resetMockBackend();
  useStore.setState(initial, true);
});

describe("Delete account", () => {
  it("deletes after typing delete, and signs this PC out", async () => {
    await native.cloudSignInEmail("me@example.com");
    const onDone = vi.fn();
    render(<DeleteAccount onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
    const go = screen.getByRole("button", { name: "Delete my account" });
    expect(go).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Type delete to confirm"), { target: { value: "Delete" } });
    await act(async () => fireEvent.click(go));
    expect(onDone).toHaveBeenCalledOnce();
    expect((await native.cloudStatus()).signedIn).toBe(false);
  });

  it("waits while sealed", () => {
    act(() => useStore.getState().setAppState("sealed"));
    render(<DeleteAccount onDone={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Waits until the seal ends" })).toBeDisabled();
  });
});
