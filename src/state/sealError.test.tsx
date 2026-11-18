import { act } from "@testing-library/react";
import { bus } from "../lib/bus";
import { EVENTS } from "../lib/native";
import { resetMockBackend } from "../lib/mockBackend";
import { connectNativeEvents } from "./events";
import { useStore } from "./store";

const initial = useStore.getState();
beforeEach(() => {
  resetMockBackend();
  useStore.setState(initial, true);
});

describe("a seal whose end couldn't be saved", () => {
  it("says so once, plainly, with the reason", async () => {
    const off = connectNativeEvents();
    await act(async () => {
      bus.emit(EVENTS.sealError, { sessionId: 7, what: "complete", message: "The disk is full." });
    });
    const notice = useStore.getState().notice;
    expect(notice?.lead).toBe("The seal ended, but it wasn't saved.");
    expect(notice?.rest).toBe("Sanctum keeps trying. The disk is full.");
    off();
  });
});
