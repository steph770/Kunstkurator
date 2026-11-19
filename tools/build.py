#!/usr/bin/env python3
"""Baut die Bilder fuer Rahmen und Begleitapp aus data/*.json.

Modi:
  build   (Standard)  Rahmenbilder 1200x1600, Vorschaubilder, Gesamtansichten, ZIP
  survey              Arbeitsansichten mit Koordinatenraster zum Auswaehlen der Ausschnitte

Ausschnitt-Koordinaten (data/ausschnitte.json):
  x, y = linke obere Ecke als Anteil von Breite bzw. Hoehe des Gemaeldes (0..1)
  w    = Breite als Anteil der Gemaeldebreite; die Hoehe folgt aus dem Format 3:4 (Hochformat)
"""
import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import zipfile

from PIL import Image, ImageDraw, ImageFont

Image.MAX_IMAGE_PIXELS = None

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get("ORIGINAL_CACHE", os.path.join(ROOT, ".originale"))
UA = "kunstkurator/1.0 (https://github.com/steph770/kunstkurator; private Kunstarchiv)"
FRAME_W, FRAME_H = 1200, 1600
MAX_UPSCALE = 1.6


def load(name):
    with open(os.path.join(ROOT, "data", name), encoding="utf-8") as f:
        return json.load(f)


def http_get(url, dest=None, tries=5):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=600) as r:
                if dest is None:
                    return r.read()
                tmp = dest + ".part"
                with open(tmp, "wb") as f:
                    while True:
                        chunk = r.read(1 << 20)
                        if not chunk:
                            break
                        f.write(chunk)
                os.replace(tmp, dest)
                return dest
        except Exception as e:  # noqa: BLE001
            print(f"  Versuch {i + 1} fehlgeschlagen: {e}", flush=True)
            time.sleep(10 * (i + 1))
    raise SystemExit(f"Download fehlgeschlagen: {url}")


def commons_info(title):
    q = urllib.parse.urlencode({
        "action": "query", "titles": title, "prop": "imageinfo",
        "iiprop": "url|size|sha1", "format": "json", "formatversion": "2",
    })
    data = json.loads(http_get("https://commons.wikimedia.org/w/api.php?" + q))
    page = data["query"]["pages"][0]
    if "imageinfo" not in page:
        raise SystemExit(f"Datei nicht gefunden: {title}")
    return page["imageinfo"][0]


def original(werk):
    os.makedirs(CACHE, exist_ok=True)
    info = commons_info(werk["commons"])
    path = os.path.join(CACHE, werk["id"] + ".jpg")
    if os.path.exists(path):
        h = hashlib.sha1()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        if h.hexdigest() == info["sha1"]:
            return path, info
    print(f"Lade {werk['commons']} ({info['size'] / 1e6:.0f} MB)", flush=True)
    http_get(info["url"].split("?")[0], path)
    return path, info


def vips(*args):
    subprocess.run(["vips", *map(str, args)], check=True)


def extract(src, left, top, width, height, out_w, out_h, dest, quality=92, hell=None):
    """Schneidet einen Bereich aus und skaliert ihn exakt auf out_w x out_h.
    hell: optionaler Gammawert > 1 hellt dunkle Bilder für das E-Ink-Display auf."""
    png = dest + ".tmp.png"
    vips("extract_area", src, png, left, top, width, height)
    img = Image.open(png).convert("RGB")
    img = img.resize((out_w, out_h), Image.LANCZOS)
    if hell:
        lut = [round(255 * (i / 255) ** (1 / hell)) for i in range(256)]
        img = img.point(lut * 3)
    img.save(dest, "JPEG", quality=quality, optimize=True, progressive=True)
    os.remove(png)


def unpacked(src):
    """Entpackt das JPEG einmal ins vips-Format, damit viele Ausschnitte schnell gehen."""
    v = src[:-4] + ".v"
    if not os.path.exists(v):
        print(f"  entpacke {os.path.basename(src)}", flush=True)
        vips("copy", src, v)
    return v


def drop(src):
    v = src[:-4] + ".v"
    if os.path.exists(v):
        os.remove(v)


def overview(src, width, dest, quality=88):
    subprocess.run(["vipsthumbnail", src, "--size", f"{width}x", "-o", f"{dest}[Q={quality},optimize_coding,strip]"], check=True)


def crop_box(c, W, H):
    left = round(c["x"] * W)
    top = round(c["y"] * H)
    cw = round(c["w"] * W)
    ch = round(cw * FRAME_H / FRAME_W)
    if left < 0 or top < 0 or left + cw > W or top + ch > H:
        raise SystemExit(f"Ausschnitt {c['id']} liegt ausserhalb des Bildes: {left},{top},{cw}x{ch} von {W}x{H}")
    if FRAME_W / cw > MAX_UPSCALE:
        raise SystemExit(f"Ausschnitt {c['id']} zu klein ({cw}px breit, Vergroesserung {FRAME_W / cw:.2f}x)")
    return left, top, cw, ch


def font(size):
    for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def draw_grid(img, x0, y0, x1, y1, step):
    """Zeichnet ein Raster in globalen Bildanteilen (0..1) auf einen Ausschnitt x0..x1, y0..y1."""
    d = ImageDraw.Draw(img)
    w, h = img.size
    f = font(max(14, w // 90))
    n = round(1 / step)
    for i in range(n + 1):
        g = i * step
        if x0 <= g <= x1:
            px = (g - x0) / (x1 - x0) * w
            strong = i % 4 == 0
            d.line([(px, 0), (px, h)], fill=(255, 0, 255) if strong else (0, 255, 255), width=2 if strong else 1)
            d.text((px + 3, 3), f"x{g:.3f}".replace("0.", "."), fill=(255, 255, 0), font=f, stroke_width=2, stroke_fill=(0, 0, 0))
        if y0 <= g <= y1:
            py = (g - y0) / (y1 - y0) * h
            strong = i % 4 == 0
            d.line([(0, py), (w, py)], fill=(255, 0, 255) if strong else (0, 255, 255), width=2 if strong else 1)
            d.text((3, py + 3), f"y{g:.3f}".replace("0.", "."), fill=(255, 255, 0), font=f, stroke_width=2, stroke_fill=(0, 0, 0))


def survey(werke):
    out = os.path.join(ROOT, "werkstatt")
    os.makedirs(out, exist_ok=True)
    only = os.environ.get("SURVEY_WERK")
    tiles = int(os.environ.get("SURVEY_TILES", "4"))
    for werk in werke:
        if only and (only == "none" or werk["id"] not in only.split(",")):
            continue
        src, info = original(werk)
        W, H = info["width"], info["height"]
        ov = os.path.join(out, f"{werk['id']}_00_gesamt.jpg")
        overview(src, 2400, ov)
        img = Image.open(ov).convert("RGB")
        draw_grid(img, 0, 0, 1, 1, 0.05)
        img.save(ov, quality=85)
        rows = max(1, round(tiles * H / W))
        vsrc = unpacked(src)
        for r in range(rows):
            for c in range(tiles):
                x0, x1 = c / tiles, (c + 1) / tiles
                y0, y1 = r / rows, (r + 1) / rows
                # leicht ueberlappend
                ox, oy = 0.15 / tiles, 0.15 / rows
                x0, x1 = max(0, x0 - ox), min(1, x1 + ox)
                y0, y1 = max(0, y0 - oy), min(1, y1 + oy)
                left, top = round(x0 * W), round(y0 * H)
                cw, ch = round((x1 - x0) * W), round((y1 - y0) * H)
                tw = 1800
                th = round(tw * ch / cw)
                dest = os.path.join(out, f"{werk['id']}_r{r}c{c}.jpg")
                extract(vsrc, left, top, cw, ch, tw, th, dest, quality=85)
                t = Image.open(dest).convert("RGB")
                draw_grid(t, x0, y0, x1, y1, 0.0125)
                t.save(dest, quality=85)
        drop(src)
        print(f"Werkstatt {werk['id']}: {W}x{H}, {rows}x{tiles} Kacheln", flush=True)
    probe = os.environ.get("SURVEY_PROBE")
    if probe:
        # Probeausschnitte: JSON-Liste [{"werk":..,"id":..,"x":..,"y":..,"w":..}]
        liste = json.loads(probe)
        for werk in werke:
            mine = [c for c in liste if c["werk"] == werk["id"]]
            if not mine:
                continue
            src, info = original(werk)
            vsrc = unpacked(src)
            for c in mine:
                left, top, cw, ch = crop_box(c, info["width"], info["height"])
                extract(vsrc, left, top, cw, ch, 600, 800, os.path.join(out, f"probe_{c['id']}.jpg"), hell=c.get("hell"))
            drop(src)


def build(werke, crops):
    werk_by = {w["id"]: w for w in werke}
    for d in ("img/rahmen", "img/vorschau", "img/werke"):
        os.makedirs(os.path.join(ROOT, d), exist_ok=True)
    meta = {"_ausschnitte": {}}
    seen = set()
    for c in crops:
        if c["id"] in seen:
            raise SystemExit(f"Doppelte ID {c['id']}")
        seen.add(c["id"])
        if c["werk"] not in werk_by:
            raise SystemExit(f"Unbekanntes Werk {c['werk']} bei {c['id']}")
    used = sorted({c["werk"] for c in crops})
    for wid in used:
        werk = werk_by[wid]
        src, info = original(werk)
        W, H = info["width"], info["height"]
        meta[wid] = {"breite": W, "hoehe": H, "quelle": info["descriptionurl"] if "descriptionurl" in info else
                     "https://commons.wikimedia.org/wiki/" + urllib.parse.quote(werk["commons"].replace(" ", "_"))}
        ov = os.path.join(ROOT, "img/werke", f"{wid}.jpg")
        if not os.path.exists(ov):
            overview(src, 3000, ov, quality=85)
        vsrc = None
        for c in [c for c in crops if c["werk"] == wid]:
            left, top, cw, ch = crop_box(c, W, H)
            key = f"{left},{top},{cw},{ch},{c.get('hell')}"
            meta["_ausschnitte"][c["id"]] = hashlib.sha1(key.encode()).hexdigest()[:8]
            dest = os.path.join(ROOT, "img/rahmen", f"{c['id']}.jpg")
            stamp = dest + ".box"
            if os.path.exists(dest) and os.path.exists(stamp) and open(stamp).read() == key:
                continue
            print(f"  {c['id']}: {cw}x{ch} px aus {wid}", flush=True)
            vsrc = vsrc or unpacked(src)
            extract(vsrc, left, top, cw, ch, FRAME_W, FRAME_H, dest, quality=93, hell=c.get("hell"))
            Image.open(dest).resize((450, 600), Image.LANCZOS).save(
                os.path.join(ROOT, "img/vorschau", f"{c['id']}.jpg"), quality=82, optimize=True)
            with open(stamp, "w") as f:
                f.write(key)
        drop(src)
    # verwaiste Dateien entfernen
    for d in ("img/rahmen", "img/vorschau"):
        for fn in os.listdir(os.path.join(ROOT, d)):
            base = fn.split(".")[0]
            if base not in seen:
                os.remove(os.path.join(ROOT, d, fn))
    with open(os.path.join(ROOT, "data", "bildinfo.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    # ZIP mit allen Rahmenbildern
    os.makedirs(os.path.join(ROOT, "download"), exist_ok=True)
    zp = os.path.join(ROOT, "download", "rahmenbilder.zip")
    with zipfile.ZipFile(zp, "w", zipfile.ZIP_STORED) as z:
        for c in crops:
            info = zipfile.ZipInfo(f"{c['id']}.jpg", date_time=(2026, 1, 1, 0, 0, 0))
            with open(os.path.join(ROOT, "img/rahmen", f"{c['id']}.jpg"), "rb") as f:
                z.writestr(info, f.read())
    print(f"Fertig: {len(crops)} Ausschnitte", flush=True)


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "build"
    werke = load("werke.json")
    if mode == "survey":
        survey(werke)
    else:
        crops = load("ausschnitte.json")
        build(werke, crops)
