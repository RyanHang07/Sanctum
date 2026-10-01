import { act, fireEvent, render, screen } from "@testing-library/react";
import { DndRow } from "./Dnd";
import { native } from "../../lib/native";
import { resetMockBackend } from "../../lib/mockBackend";

beforeEach(() => resetMockBackend());

describe("Do not disturb while sealed", () => {
  it("is on by default, says what it does, and turns off", async () => {
    render(<DndRow />);
    const toggle = screen.getByRole("switch", { name: "Do not disturb while sealed" });
    expect(await screen.findByText(/Notifications hold until the seal ends/)).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await act(async () => fireEvent.click(toggle));
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect((await native.dndStatus()).enabled).toBe(false);
  });
});
