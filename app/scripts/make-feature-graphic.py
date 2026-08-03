"""Play Store feature graphic, 1024x500, from the design tokens.

Google requires this asset and crops/scales it aggressively across surfaces,
so the rule is: one idea, large type, nothing important near the edges. It is
drawn with the app's ACTUAL typefaces — Instrument Serif for the wordmark,
Geist for the supporting line — so the listing and the product look like the
same thing. A feature graphic set in Arial is the store-listing equivalent of
the placeholder icon we just removed.

    python scripts/make-feature-graphic.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
FONTS = ROOT / "node_modules" / "@expo-google-fonts"

SERIF = FONTS / "instrument-serif" / "400Regular" / "InstrumentSerif_400Regular.ttf"
SANS = FONTS / "geist" / "400Regular" / "Geist_400Regular.ttf"

W, H = 1024, 500
CHOC = (118, 61, 38, 255)      # choc[800] — primary brand
CREAM = (251, 249, 244, 255)
CARAMEL = (227, 147, 47, 255)  # accent, same token the app uses for actions


def pin(d: ImageDraw.ImageDraw, cx: float, cy: float, r: float, fill) -> None:
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)
    chord = r * 0.74
    d.polygon(
        [(cx - chord, cy + r * 0.62), (cx + chord, cy + r * 0.62), (cx, cy + r * 2.35)],
        fill=fill,
    )


def blend(fg, bg, alpha: float):
    """Pre-blend, because ImageDraw REPLACES pixels instead of compositing.

    Drawing `(255,255,255,20)` onto an RGBA canvas does not produce a 8%
    ghost — it writes white with an alpha channel that then flattens to solid
    white on RGB conversion. The first render of this graphic came out with a
    glaring opaque pin for exactly that reason.
    """
    return tuple(round(f * alpha + b * (1 - alpha)) for f, b in zip(fg[:3], bg[:3])) + (255,)


def main() -> None:
    img = Image.new("RGBA", (W, H), CHOC)
    d = ImageDraw.Draw(img)

    # Oversized pin bleeding off the right edge: gives the composition a
    # subject without competing with the wordmark for the centre. 8% white,
    # pre-blended so it reads as a tonal shift rather than a second element.
    pin(d, W * 0.855, H * 0.34, 150, blend((255, 255, 255), CHOC, 0.08))

    wordmark = ImageFont.truetype(str(SERIF), 104)
    sub = ImageFont.truetype(str(SANS), 32)

    # Mark sits ABOVE the wordmark with real clearance — in the first render
    # its point speared the F.
    mark_r = 34
    mark_cx, mark_cy = 96, 118
    pin(d, mark_cx, mark_cy, mark_r, CARAMEL)
    hole = mark_r * 0.40
    d.ellipse([mark_cx - hole, mark_cy - hole, mark_cx + hole, mark_cy + hole], fill=CHOC)

    d.text((92, 246), "FIND IT", font=wordmark, fill=CREAM)
    d.text((96, 372), "Local places across Pakistan — even offline.",
           font=sub, fill=blend(CREAM, CHOC, 0.78))

    img.convert("RGB").save(ASSETS / "feature-graphic.png")
    print(f"  wrote feature-graphic.png ({W}x{H})")


if __name__ == "__main__":
    main()
