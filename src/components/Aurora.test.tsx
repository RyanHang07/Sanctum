import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, render, screen, waitFor } from "@testing-library/react";
import { Aurora, StateBackdrop } from "./Aurora";
import { LEVELS, LIGHT_SCALE, levelFor, parseColour, STILL_T } from "../lib/aurora";
import { setReducedMotion, setShown } from "../test/motion";

// A stand-in WebGL context: every call is recorded, uniform locations are their names.
function fakeGl() {
  const noop = () => undefined;
  return {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    ARRAY_BUFFER: 5,
    STATIC_DRAW: 6,
    FLOAT: 7,
    TRIANGLES: 8,
    COLOR_BUFFER_BIT: 9,
    createShader: () => ({}),
    shaderSource: noop,
    compileShader: noop,
    getShaderParameter: () => true,
    deleteShader: noop,
    createProgram: () => ({}),
    attachShader: noop,
    linkProgram: noop,
    getProgramParameter: () => true,
    useProgram: noop,
    createBuffer: () => ({}),
    bindBuffer: noop,
    bufferData: noop,
    getAttribLocation: () => 0,
    enableVertexAttribArray: noop,
    vertexAttribPointer: noop,
    getUniformLocation: (_p: unknown, name: string) => name,
    viewport: noop,
    uniform2f: noop,
    uniform1f: vi.fn(),
    uniform3f: vi.fn(),
    clearColor: noop,
    clear: noop,
    drawArrays: vi.fn(),
    deleteProgram: noop,
    deleteBuffer: noop,
  };
}

type Gl = ReturnType<typeof fakeGl>;
const last = (fn: ReturnType<typeof vi.fn>, name: string) => fn.mock.calls.filter((c) => c[0] === name).at(-1)?.slice(1);

let raf: ReturnType<typeof vi.fn<(cb: FrameRequestCallback) => number>>;
let caf: ReturnType<typeof vi.fn<(id: number) => void>>;

function withWebGl(context: Gl | null = fakeGl()) {
  (window as unknown as { WebGLRenderingContext: unknown }).WebGLRenderingContext = function WebGLRenderingContext() {};
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as RenderingContext);
  return context;
}

beforeEach(() => {
  raf = vi.fn<(cb: FrameRequestCallback) => number>(() => 7);
  caf = vi.fn<(id: number) => void>();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(raf);
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(caf);
});

afterEach(() => {
  delete (window as unknown as { WebGLRenderingContext?: unknown }).WebGLRenderingContext;
  vi.restoreAllMocks();
  const root = document.documentElement;
  root.style.removeProperty("--s-sealed");
  root.style.removeProperty("--s-second");
  delete root.dataset.scheme;
  delete (navigator as { getBattery?: unknown }).getBattery;
});

describe("Aurora", () => {
  it("falls back to a CSS gradient when the web view has no WebGL", () => {
    render(<Aurora tone="open" />);
    const a = screen.getByTestId("aurora");
    expect(a).toHaveAttribute("data-render", "fallback");
    expect(a.querySelector("canvas")).toBeNull();
    expect(a.querySelector(".aurora-fallback")).toHaveStyle({ opacity: String(LEVELS.open.strength) });
  });

  it("falls back when WebGL exists but no context can be had", () => {
    withWebGl(null);
    render(<Aurora tone="sealed" />);
    expect(screen.getByTestId("aurora")).toHaveAttribute("data-render", "fallback");
  });

  it("draws the shader on one canvas, in the theme's colours, and follows a theme change", async () => {
    document.documentElement.style.setProperty("--s-sealed", "#FF0000");
    document.documentElement.style.setProperty("--s-second", "#00FF00");
    const gl = withWebGl()!;
    render(<Aurora tone="sealed" />);
    const a = screen.getByTestId("aurora");
    expect(a).toHaveAttribute("data-render", "webgl");
    expect(a.querySelectorAll("canvas")).toHaveLength(1);
    expect(gl.drawArrays).toHaveBeenCalled();
    expect(last(gl.uniform3f, "u_band")).toEqual([1, 0, 0]);
    expect(last(gl.uniform3f, "u_tip")).toEqual([0, 1, 0]);

    act(() => document.documentElement.style.setProperty("--s-sealed", "#0000FF"));
    await waitFor(() => expect(last(gl.uniform3f, "u_band")).toEqual([0, 0, 1]));
  });

  it("is a still frame under reduced motion: one draw, no animation loop", () => {
    const gl = withWebGl()!;
    render(<Aurora tone="sealed" />);
    expect(screen.getByTestId("aurora")).toHaveAttribute("data-motion", "still");
    expect(raf).not.toHaveBeenCalled();
    expect(gl.drawArrays).toHaveBeenCalled();
    expect(last(gl.uniform1f, "u_time")).toEqual([STILL_T]);
  });

  it("moves while shown, pauses while the window is hidden, and resumes", () => {
    setReducedMotion(false);
    withWebGl();
    render(<Aurora tone="sealed" />);
    const a = screen.getByTestId("aurora");
    expect(a).toHaveAttribute("data-motion", "live");
    expect(raf).toHaveBeenCalled();
    setShown(false);
    expect(a).toHaveAttribute("data-motion", "paused");
    expect(caf).toHaveBeenCalled();
    raf.mockClear();
    setShown(true);
    expect(a).toHaveAttribute("data-motion", "live");
    expect(raf).toHaveBeenCalled();
  });

  it("pauses when told to (a page covering it)", () => {
    setReducedMotion(false);
    withWebGl();
    render(<Aurora tone="open" paused />);
    expect(screen.getByTestId("aurora")).toHaveAttribute("data-motion", "paused");
    expect(raf).not.toHaveBeenCalled();
  });

  it("is barely there while open, stronger sealed, fullest held, and drained to grey when broken", () => {
    expect(LEVELS.open.strength).toBeLessThan(LEVELS.sealed.strength);
    expect(LEVELS.sealed.strength).toBeLessThan(LEVELS.held.strength);
    expect(LEVELS.open.speed).toBeLessThan(LEVELS.sealed.speed);
    expect(LEVELS.broken.sat).toBe(0);
    expect(LEVELS.broken.speed).toBeCloseTo(LEVELS.held.speed / 3, 1);
    for (const tone of ["open", "sealed", "held", "broken"] as const) {
      const { unmount } = render(<Aurora tone={tone} />);
      expect(screen.getByTestId("aurora")).toHaveAttribute("data-strength", LEVELS[tone].strength.toFixed(2));
      unmount();
    }
    const gl = withWebGl()!;
    render(<Aurora tone="broken" />);
    expect(last(gl.uniform1f, "u_sat")).toEqual([0]);
    expect(last(gl.uniform1f, "u_strength")?.[0]).toBeCloseTo(LEVELS.broken.strength);
  });

  it("is quieter on light themes", () => {
    document.documentElement.dataset.scheme = "light";
    render(<Aurora tone="sealed" />);
    expect(screen.getByTestId("aurora")).toHaveAttribute("data-strength", (LEVELS.sealed.strength * LIGHT_SCALE).toFixed(2));
  });

  it("places the band at the top or the bottom", () => {
    const gl = withWebGl()!;
    const { unmount } = render(<Aurora tone="open" placement="bottom" />);
    expect(screen.getByTestId("aurora")).toHaveAttribute("data-placement", "bottom");
    expect(last(gl.uniform1f, "u_flip")).toEqual([0]);
    unmount();
    render(<Aurora tone="open" />);
    expect(last(gl.uniform1f, "u_flip")).toEqual([1]);
  });

  it("on battery: open holds still, and the rest run at half the frame rate", async () => {
    expect(levelFor("open", true).fps).toBe(0);
    expect(levelFor("sealed", true).fps).toBe(LEVELS.sealed.fps / 2);
    (navigator as { getBattery?: unknown }).getBattery = () =>
      Promise.resolve({ charging: false, addEventListener: () => undefined, removeEventListener: () => undefined });
    setReducedMotion(false);
    withWebGl();
    render(<Aurora tone="open" />);
    await waitFor(() => expect(screen.getByTestId("aurora")).toHaveAttribute("data-motion", "still"));
  });
});

describe("StateBackdrop", () => {
  it("is one aurora that follows the app's state", () => {
    const { rerender } = render(<StateBackdrop state="open" />);
    expect(screen.getAllByTestId("aurora")).toHaveLength(1);
    expect(screen.getByTestId("aurora")).toHaveAttribute("data-tone", "open");
    rerender(<StateBackdrop state="sealed" />);
    expect(screen.getAllByTestId("aurora")).toHaveLength(1);
    expect(screen.getByTestId("aurora")).toHaveAttribute("data-tone", "sealed");
  });
});

describe("aurora colours and styles", () => {
  it("reads theme colours as hex or rgb()", () => {
    expect(parseColour("#FF8000")).toEqual([1, 128 / 255, 0]);
    expect(parseColour(" #fff ")).toEqual([1, 1, 1]);
    expect(parseColour("rgba(0, 51, 255, 0.5)")).toEqual([0, 0.2, 1]);
    expect(parseColour("")).toBeNull();
  });

  it("pauses CSS loops and the keyhole breathe while the window is hidden (motion spec 9)", () => {
    const css = readFileSync(join(__dirname, "..", "styles.css"), "utf8");
    expect(css).toMatch(/html\[data-window-hidden\] \.loop[\s\S]*?animation-play-state: paused/);
    expect(css).toContain("html[data-window-hidden] .mark-breathe");
  });
});
