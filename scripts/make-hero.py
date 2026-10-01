"""The README's hero animation from what scripts/screenshots.mjs records (docs/screenshots/frames).

Open -> Enter focus -> the seal fades in -> a sealed app is caught -> Sanctum held -> back to
Open. Animated WebP, not GIF: full color, so the gradients stay smooth instead of banding.
The slow-motion clips are re-timed to a steady 30 fps and every cut is a cross-fade.
Run after `npm run screenshots` (it calls this):  python scripts/make-hero.py
"""

import json
from pathlib import Path

from PIL import Image, ImageEnhance

ROOT = Path(__file__).resolve().parent.parent
FRAMES = ROOT / "docs" / "screenshots" / "frames"
OUT = ROOT / "docs" / "screenshots" / "sanctum.webp"
WIDTH = 960
FPS = 30
STEP = round(1000 / FPS)


def fit(img: Image.Image) -> Image.Image:
    img = img.convert("RGB")
    return img.resize((WIDTH, round(img.height * WIDTH / img.width)), Image.LANCZOS)


def load(name: str) -> Image.Image:
    return fit(Image.open(FRAMES / f"{name}.png"))


def clip(name: str) -> list[Image.Image]:
    """A recorded clip, re-timed to FPS: for each tick, the latest frame captured by then."""
    folder = FRAMES / name
    times = json.loads((folder / "times.json").read_text())
    frames = [fit(Image.open(folder / f"{i:03d}.jpg")) for i in range(len(times))]
    out, k = [], 0
    for t in range(0, times[-1] + 1, STEP):
        while k + 1 < len(times) and times[k + 1] <= t:
            k += 1
        out.append(frames[k])
    return out


def fade(a: Image.Image, b: Image.Image, ms: int) -> list[Image.Image]:
    n = max(2, ms // STEP)
    return [Image.blend(a, b, (i + 1) / n) for i in range(n)]


def main() -> None:
    open_ = load("open")
    sealed = load("sealed")
    held = load("held")
    seal = clip("seal")
    build = clip("held")

    # The overlay a sealed app gets, over the dimmed sealed screen, as it sits on a desktop.
    overlay = Image.open(FRAMES / "overlay.png").convert("RGBA")
    scale = WIDTH / 1120
    overlay = overlay.resize((round(480 * scale), round(290 * scale)), Image.LANCZOS)
    caught = ImageEnhance.Brightness(sealed).enhance(0.55)
    caught.paste(overlay, ((caught.width - overlay.width) // 2, (caught.height - overlay.height) // 2), overlay)

    frames: list[Image.Image] = []
    durations: list[int] = []

    def hold(img: Image.Image, ms: int) -> None:
        frames.append(img)
        durations.append(ms)

    def run(imgs: list[Image.Image]) -> None:
        frames.extend(imgs)
        durations.extend([STEP] * len(imgs))

    hold(open_, 1600)
    run(seal)
    hold(sealed, 900)
    run(fade(sealed, caught, 220))
    hold(caught, 2000)
    run(fade(caught, sealed, 220))
    hold(sealed, 500)
    run(fade(sealed, build[0], 300))
    run(build)
    hold(held, 2400)
    run(fade(held, open_, 450))

    frames[0].save(
        OUT,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        quality=82,
        method=6,
    )
    total = sum(durations) / 1000
    print(f"{OUT.relative_to(ROOT)}  {len(frames)} frames  {total:.1f}s  {OUT.stat().st_size / 1_000_000:.1f} MB")


if __name__ == "__main__":
    main()
