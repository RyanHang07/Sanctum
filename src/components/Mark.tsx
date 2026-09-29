import markDark from "../../design/logo/sanctum-mark-dark.svg";

/** The torii keyhole mark. Always the source SVG from design/logo, never redrawn. */
export function Mark({ size = 18 }: { size?: number }) {
  return <img src={markDark} width={size} height={size} alt="" aria-hidden="true" draggable={false} />;
}
