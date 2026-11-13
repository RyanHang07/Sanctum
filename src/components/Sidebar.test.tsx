import { act, render, screen } from "@testing-library/react";
import { Sidebar } from "./Sidebar";
import { useStore } from "../state/store";

const initial = useStore.getState();

function renderSidebar(overrides: Partial<ReturnType<typeof useStore.getState>> = {}) {
  act(() => useStore.setState({ ...initial, ...overrides } as any, true));
  return render(<Sidebar pillMeta="4m left" />);
}

beforeEach(() => {
  act(() => useStore.setState(initial, true));
});

describe("Sidebar", () => {
  it("keeps a toggle with shortcut hint and no clipped hover tooltip markup", () => {
    renderSidebar({ appState: "open", activeTab: "today", settings: { ...initial.settings, sidebarCollapsed: false, displayName: "Ada" } });
    const toggle = screen.getByRole("button", { name: "Collapse sidebar" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("title", "Collapse sidebar (Ctrl+B)");
    expect(document.querySelector(".group-hover\\/toggle\\:flex")).toBeNull();
    expect(screen.queryByText("Ada")).toBeNull();
  });

  it("shows app version in the expanded sidebar", () => {
    renderSidebar({ settings: { ...initial.settings, sidebarCollapsed: false } });
    expect(screen.getByText(/^v\d+\.\d+$/)).toBeInTheDocument();
  });

  it("keeps version in the rail and reveals it on hover/focus when collapsed", () => {
    renderSidebar({ settings: { ...initial.settings, sidebarCollapsed: true } });
    const version = screen.getByText(/^v\d+\.\d+$/);
    expect(version.className).toContain("max-w-0");
    expect(version.className).toContain("group-hover/sidebar-bottom:max-w-[48px]");
    expect(version.className).toContain("group-focus-within/sidebar-bottom:max-w-[48px]");
  });

  it("aligns the expanded status pill contents with nav rows", () => {
    renderSidebar({ settings: { ...initial.settings, sidebarCollapsed: false } });
    const pill = screen.getByTestId("state-pill");
    expect(pill.className).toContain("w-full");
    expect(pill.className).toContain("gap-[10px]");
  });
});
