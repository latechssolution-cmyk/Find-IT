"""Generate the launcher icon set from the design tokens.

The project shipped Expo's default blue chevron on a leftover coral
background — a placeholder, and the single most-seen brand surface there is
(home screen, app switcher, Play listing). This draws the mark instead:

  a map pin, cream on chocolate, with the pin's void reading as the "hole"

Chocolate #763D26 is `choc[800]`, the primary brand token (8.09:1 on cream);
cream #FBF9F4 is the app background. Nothing here is a new colour.

Adaptive icons: Android masks the outer ~1/3 away and may shift the
foreground during animation, so the mark sits inside the inner 66% safe zone
and the background is a flat fill.

    python scripts/make-icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

ASSETS = Path(__file__).resolve().parent.parent / "assets"

CHOC = (118, 61, 38, 255)      # choc[800] — primary brand
CREAM = (251, 249, 244, 255)   # cream background

SIZE = 1024
SAFE = 0.62                    # fraction of the canvas the mark may occupy


def pin(draw: ImageDraw.ImageDraw, cx: float, cy: float, r: float, fill) -> None:
    """A map pin: circle head + tapered point, drawn as one silhouette."""
    # Head
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)
    # Point — an isoceles triangle whose top edge is a chord of the circle,
    # so the join reads as one shape rather than a lollipop.
    chord = r * 0.74
    draw.polygon(
        [(cx - chord, cy + r * 0.62), (cx + chord, cy + r * 0.62), (cx, cy + r * 2.35)],
        fill=fill,
    )


def build_foreground() -> Image.Image:
    """Transparent PNG; the mark only, inside the safe zone."""
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = SIZE * SAFE * 0.26
    cx, cy = SIZE / 2, SIZE / 2 - r * 0.42
    pin(d, cx, cy, r, CREAM)
    # The void: a hole punched in the head, so the pin reads at 48px where
    # interior detail would otherwise turn to mud.
    hole = r * 0.40
    d.ellipse([cx - hole, cy - hole, cx + hole, cy + hole], fill=(0, 0, 0, 0))
    return img


def build_square(bg, fg_colour) -> Image.Image:
    """Flattened icon for stores and iOS — same mark, no transparency."""
    img = Image.new("RGBA", (SIZE, SIZE), bg)
    d = ImageDraw.Draw(img)
    r = SIZE * SAFE * 0.26
    cx, cy = SIZE / 2, SIZE / 2 - r * 0.42
    pin(d, cx, cy, r, fg_colour)
    hole = r * 0.40
    d.ellipse([cx - hole, cy - hole, cx + hole, cy + hole], fill=bg)
    return img


def build_monochrome() -> Image.Image:
    """Themed icons (Android 13+): silhouette only, system tints it."""
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = SIZE * SAFE * 0.26
    cx, cy = SIZE / 2, SIZE / 2 - r * 0.42
    pin(d, cx, cy, r, (0, 0, 0, 255))
    hole = r * 0.40
    d.ellipse([cx - hole, cy - hole, cx + hole, cy + hole], fill=(0, 0, 0, 0))
    return img


def main() -> None:
    out = {
        "android-icon-foreground.png": build_foreground(),
        "android-icon-background.png": Image.new("RGBA", (SIZE, SIZE), CHOC),
        "android-icon-monochrome.png": build_monochrome(),
        "icon.png": build_square(CHOC, CREAM),
        "splash-icon.png": build_square(CREAM, CHOC),
        "favicon.png": build_square(CHOC, CREAM).resize((48, 48), Image.LANCZOS),
    }
    for name, img in out.items():
        img.save(ASSETS / name)
        print(f"  wrote {name} ({img.width}x{img.height})")


if __name__ == "__main__":
    main()
