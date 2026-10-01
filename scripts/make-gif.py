"""The README's hero GIF from the frames scripts/screenshots.mjs captures (docs/screenshots/frames).

Open -> Enter focus -> the seal fades in -> a sealed app is caught -> Sanctum held. Run after
`npm run screenshots`:  python scripts/make-gif.py
"""

from pathlib import Path

from PIL import Image, ImageEnhance

ROOT = Path(__file__).resolve().parent.parent
FRAMES = ROOT / "docs" / "screenshots" / "frames"
OUT = ROOT / "docs" / "screenshots" / "sanctum.gif"
WIDTH = 960

# The capture order (scripts/screenshots.mjs): open, 12 while sealing, sealed, 26 while held
# builds, held.
OPEN, SEALING, SEALED, HOLDING = 1, 12, 1, 26


def load(name: str) -> Image.Image:
    img = Image.open(FRAMES / name).convert("RGB")
    return img.resize((WIDTH, round(img.height * WIDTH / img.width)), Image.LANCZOS)


def main() -> None:
    names = sorted(p.name for p in FRAMES.glob("[0-9][0-9][0-9].png"))
    expected = OPEN + SEALING + SEALED + HOLDING + 1
    if len(names) != expected:
        raise SystemExit(f"Expected {expected} frames, found {len(names)}. Run npm run screenshots first.")
    frames = [load(n) for n in names]
    durations = [1800] + [70] * SEALING + [1300]

    # The overlay a sealed app gets, over the dimmed sealed screen, as it sits on a desktop.
    sealed = frames[OPEN + SEALING]
    overlay = Image.open(FRAMES / "overlay.png").convert("RGBA")
    scale = WIDTH / 1120
    overlay = overlay.resize((round(480 * scale), round(290 * scale)), Image.LANCZOS)
    caught = ImageEnhance.Brightness(sealed).enhance(0.55)
    caught.paste(overlay, ((caught.width - overlay.width) // 2, (caught.height - overlay.height) // 2), overlay)
    out = frames[: OPEN + SEALING + SEALED] + [caught]
    durations += [2200]

    out += frames[OPEN + SEALING + SEALED :]
    durations += [70] * HOLDING + [3200]

    # One shared palette keeps the gradient steady from frame to frame.
    # Built from the open, sealed, caught, and held frames together.
    keys = [out[0], out[OPEN + SEALING], out[OPEN + SEALING + SEALED], out[-1]]
    sheet = Image.new("RGB", (WIDTH, sum(k.height for k in keys)))
    y = 0
    for k in keys:
        sheet.paste(k, (0, y))
        y += k.height
    palette = sheet.quantize(colors=255, method=Image.Quantize.MEDIANCUT)
    # Dither only the frames that hold on screen (smooth gradients where the eye rests); the
    # fast transition frames stay flat, which keeps the file small.
    holds = {i for i, d in enumerate(durations) if d >= 1000}
    quantized = [f.quantize(palette=palette, dither=Image.Dither.FLOYDSTEINBERG if i in holds else Image.Dither.NONE) for i, f in enumerate(out)]
    quantized[0].save(OUT, save_all=True, append_images=quantized[1:], duration=durations, loop=0, optimize=True, disposal=1)
    print(f"{OUT.relative_to(ROOT)}  {len(out)} frames  {OUT.stat().st_size / 1_000_000:.1f} MB")


if __name__ == "__main__":
    main()
