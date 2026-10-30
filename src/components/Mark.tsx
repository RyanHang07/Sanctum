import markDark from "../../design/logo/sanctum-mark-dark.svg";
import markLight from "../../design/logo/sanctum-mark-light.svg";

/**
 * The torii keyhole mark. Always the source SVGs from design/logo, never redrawn: light ink for
 * dark themes, dark ink for light ones (styles.css shows the one that fits the theme).
 */
export function Mark({ size = 18 }: { size?: number }) {
  return (
    <>
      <img className="mark-for-dark" src={markDark} width={size} height={size} alt="" aria-hidden="true" draggable={false} />
      <img className="mark-for-light" src={markLight} width={size} height={size} alt="" aria-hidden="true" draggable={false} />
    </>
  );
}
