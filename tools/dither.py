"""Eigene Umrechnung für das Spectra-6-Display (6 Farben).

Ergebnis ist ein BMP in der theoretischen Palette. Die Firmware erkennt diese exakten
Farbwerte und zeigt das Bild ohne eigene Umrechnung an. Gerechnet wird gegen die
gemessene Palette (so wie das Display die Farben tatsächlich zeigt).
"""
import numpy as np
from PIL import Image

FARBEN = ["black", "white", "yellow", "red", "blue", "green"]
THEORIE = {"black": (0, 0, 0), "white": (255, 255, 255), "yellow": (255, 255, 0),
           "red": (255, 0, 0), "blue": (0, 0, 255), "green": (0, 255, 0)}
# Messwerte aus der Firmware-Dokumentation (docs/MEASURED_PALETTE.md), falls der Rahmen keine eigene Palette meldet
GEMESSEN = {"black": (2, 2, 2), "white": (179, 182, 171), "yellow": (201, 184, 0),
            "red": (117, 10, 0), "blue": (0, 47, 107), "green": (33, 69, 40)}

try:
    from numba import njit
except ImportError:  # langsamer, aber funktionsfähig
    def njit(*a, **k):
        def deco(f):
            return f
        return deco if not (a and callable(a[0])) else a[0]


def palette_aus(geraet):
    """Liest die vom Rahmen gemeldete Palette (verschiedene mögliche Formen), sonst Messwerte."""
    p = (geraet or {}).get("palette")
    if isinstance(p, dict):
        src = p.get("perceived", p)
        try:
            return {n: tuple(int(src[n][c]) for c in "rgb") for n in FARBEN}
        except (KeyError, TypeError, ValueError):
            pass
    return dict(GEMESSEN)


def srgb_zu_lab(rgb):
    c = rgb.astype(np.float64) / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124564, 0.3575761, 0.1804375],
                  [0.2126729, 0.7151522, 0.0721750],
                  [0.0193339, 0.1191920, 0.9503041]])
    xyz = c @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    L = 116 * f[..., 1] - 16
    a = 500 * (f[..., 0] - f[..., 1])
    b = 200 * (f[..., 1] - f[..., 2])
    return np.stack([L, a, b], axis=-1)


@njit(cache=True)
def _diffusion(lab, pal, kern):
    h, w, _ = lab.shape
    idx = np.zeros((h, w), dtype=np.uint8)
    nk = kern.shape[0]
    for y in range(h):
        rechts = (y % 2 == 0)
        for i in range(w):
            x = i if rechts else w - 1 - i
            L = lab[y, x, 0]; A = lab[y, x, 1]; B = lab[y, x, 2]
            best = 0; bd = 1e18
            for k in range(pal.shape[0]):
                d = (L - pal[k, 0]) ** 2 + (A - pal[k, 1]) ** 2 + (B - pal[k, 2]) ** 2
                if d < bd:
                    bd = d; best = k
            idx[y, x] = best
            eL = L - pal[best, 0]; eA = A - pal[best, 1]; eB = B - pal[best, 2]
            for j in range(nk):
                dx = int(kern[j, 0]); dy = int(kern[j, 1]); wt = kern[j, 2]
                if not rechts:
                    dx = -dx
                xx = x + dx; yy = y + dy
                if 0 <= xx < w and yy < h:
                    lab[yy, xx, 0] += eL * wt
                    lab[yy, xx, 1] += eA * wt
                    lab[yy, xx, 2] += eB * wt
    return idx


KERNE = {
    "floyd-steinberg": [(1, 0, 7), (-1, 1, 3), (0, 1, 5), (1, 1, 1)],
    "stucki": [(1, 0, 8), (2, 0, 4), (-2, 1, 2), (-1, 1, 4), (0, 1, 8), (1, 1, 4), (2, 1, 2),
               (-2, 2, 1), (-1, 2, 2), (0, 2, 4), (1, 2, 2), (2, 2, 1)],
}


def umrechnen(img, palette, saettigung=1.0, kern="floyd-steinberg", fehleranteil=1.0, gamma=0.9):
    """Gibt (bmp_bild_theoretisch, simulation_gemessen) zurück."""
    rgb = np.asarray(img.convert("RGB"))
    lab = srgb_zu_lab(rgb)
    pal_rgb = np.array([palette[n] for n in FARBEN], dtype=np.uint8)
    pal_lab = srgb_zu_lab(pal_rgb.reshape(1, -1, 3)).reshape(-1, 3)
    Lb, Lw = pal_lab[0, 0], pal_lab[1, 0]
    # Helligkeit in den Bereich des Displays stauchen (Schwarz bis Display-Weiß), Farbigkeit proportional
    k = (Lw - Lb) / 100.0
    hell = np.clip(lab[..., 0] / 100.0, 0, 1) ** gamma  # Mitteltöne leicht anheben, das Display ist dunkler als ein Bildschirm
    lab[..., 0] = Lb + hell * (Lw - Lb)
    lab[..., 1] *= k * saettigung
    lab[..., 2] *= k * saettigung
    kk = np.array(KERNE[kern], dtype=np.float64)
    kk[:, 2] = kk[:, 2] / kk[:, 2].sum() * fehleranteil
    idx = _diffusion(np.ascontiguousarray(lab), pal_lab.astype(np.float64), kk)
    theo = np.array([THEORIE[n] for n in FARBEN], dtype=np.uint8)
    return Image.fromarray(theo[idx]), Image.fromarray(pal_rgb[idx])
