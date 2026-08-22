#!/usr/bin/env python3
"""Re-fetch the Arkham icon assets from ArkhamDB and rebuild what we vendor.

    python docs/regen-icons.py

Downloads the icon font + the class-symbol PNGs, extracts every glyph in the font
to img/icons/<name>.svg, and reports any icon in ArkhamDB's app.css whose glyph we
do not have a name for. Only the standard library is used.

See docs/icons.md for the index this produces.
"""
import html
import os
import re
import sys
import urllib.request

ORIGIN = "https://arkhamdb.com"
CACHE_BUST = "irjt2b"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# canonical name -> character in the font.
# The five class symbols are absent from app.css (it uses the PNGs); their
# characters were identified against core-set investigator cards 01001-01005.
ICONS = {
    "action": "i", "reaction": "!", "fast": "j",
    "willpower": "p", "intellect": "b", "combat": "c", "agility": "a", "wild": "s",
    "guardian": "f", "seeker": "h", "rogue": "d", "mystic": "g", "survivor": "e",
    "skull": "k", "cultist": "l", "tablet": "q", "elder_thing": "n",
    "elder_sign": "o", "auto_fail": "m", "bless": "v", "curse": "w",
    "frost": "x", "null": "t",
    "seal_a": "1", "seal_b": "2", "seal_c": "3", "seal_d": "4", "seal_e": "5",
    "unique": "s", "per_investigator": "u",
}

FACTIONS = ["guardian", "seeker", "rogue", "mystic", "survivor"]
FONT_FORMATS = ["woff", "ttf", "otf"]

UPM, ASCENT = 1024, 768


def get(url):
    with urllib.request.urlopen(url) as r:
        return r.read()


def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    mode = "wb" if isinstance(data, bytes) else "w"
    with open(path, mode, **({} if mode == "wb" else {"encoding": "utf-8"})) as f:
        f.write(data)


def font_url(ext):
    return "%s/bundles/app/fonts/arkham-icons.%s?%s" % (ORIGIN, ext, CACHE_BUST)


def parse_app_css(css):
    """class name -> content character, for every .icon-* rule."""
    found = {}
    for m in re.finditer(r"([^{}]*?)\{([^{}]*)\}", css):
        sel, body = m.group(1), m.group(2)
        if ".icon-" not in sel or "content:" not in body:
            continue
        cm = re.search(r'content:\s*"([^"]*)"', body)
        if not cm:
            continue
        for s in sel.split(","):
            n = re.match(r"^\.icon-([a-z0-9_]+)(::?before)?$", s.strip())
            if n:
                found[n.group(1)] = cm.group(1)
    return found


_TOK = re.compile(r"([MmLlHhVvCcSsQqTtAaZz])|(-?\d*\.?\d+(?:[eE][-+]?\d+)?)")
_ARGS = {"M": 2, "L": 2, "H": 1, "V": 1, "C": 6, "S": 4, "Q": 4, "T": 2, "A": 7, "Z": 0}


def path_extent(d):
    """Conservative bbox of a path: every coordinate pair, control points included.

    A font never clips a glyph that pokes outside the em box, but an SVG viewBox
    does, so the box we emit has to cover whatever the path actually reaches.
    """
    toks = [(m.group(1), m.group(2)) for m in _TOK.finditer(d)]
    i, cmd = 0, None
    x = y = sx = sy = 0.0
    xs, ys = [], []
    while i < len(toks):
        c, n = toks[i]
        if c:
            cmd = c
            i += 1
            if cmd in "Zz":
                x, y = sx, sy
                continue
        if cmd is None:
            break
        need = _ARGS[cmd.upper()]
        nums = []
        while len(nums) < need and i < len(toks) and toks[i][1] is not None:
            nums.append(float(toks[i][1]))
            i += 1
        if len(nums) < need:
            break
        rel, u = cmd.islower(), cmd.upper()
        if u == "H":
            x = x + nums[0] if rel else nums[0]
        elif u == "V":
            y = y + nums[0] if rel else nums[0]
        else:
            pts = [(nums[5], nums[6])] if u == "A" else list(zip(nums[0::2], nums[1::2]))
            bx, by = x, y
            for px, py in pts:
                xs.append(bx + px if rel else px)
                ys.append(by + py if rel else py)
            lx, ly = pts[-1]
            x, y = (bx + lx, by + ly) if rel else (lx, ly)
        xs.append(x)
        ys.append(y)
        if u == "M":
            sx, sy = x, y
        cmd = "L" if cmd == "M" else ("l" if cmd == "m" else cmd)
    return (min(xs), min(ys), max(xs), max(ys)) if xs else (0, 0, 0, 0)


def view_box(d, adv):
    """Em box, widened if the glyph pokes out of it. Y is flipped by the <g>."""
    x0, y0, x1, y1 = path_extent(d)
    left = min(0.0, x0)
    top = min(0.0, ASCENT - y1)
    right = max(float(adv), x1)
    bottom = max(float(UPM), ASCENT - y0)
    return "%g %g %g %g" % (left, top, right - left, bottom - top)


def parse_svg_font(svg):
    """character -> (path data, advance width)."""
    glyphs = {}
    for m in re.finditer(r"<glyph\b([^>]*)/>", svg):
        attrs = dict(re.findall(r'(\S+)="([^"]*)"', m.group(1)))
        if not attrs.get("unicode") or not attrs.get("d"):
            continue
        glyphs[html.unescape(attrs["unicode"])] = (
            attrs["d"], int(float(attrs.get("horiz-adv-x", UPM))))
    return glyphs


def main():
    print("fetching app.css …")
    css = get(ORIGIN + "/css/app.css").decode("utf-8", "replace")
    upstream = parse_app_css(css)

    known = set(ICONS.values())
    # Expected mismatches: .icon-wild is content:"?" upstream (no glyph in the font, so
    # ArkhamDB renders a literal question mark; we use the star instead) and
    # .icon-seal_b is content:"=2", a typo that prints a stray "=".
    # Anything else is a genuinely new icon.
    expected = {"wild", "seal_b"}
    unknown = {k: v for k, v in upstream.items()
               if v not in known and k not in expected}
    if unknown:
        print("  NOTE: app.css icons whose glyph we do not vendor: %s" % unknown)
    print("  %d .icon-* rules upstream, %d names vendored" % (len(upstream), len(ICONS)))

    print("fetching font …")
    for ext in FONT_FORMATS:
        write(os.path.join(ROOT, "fonts", "arkham-icons." + ext), get(font_url(ext)))

    # the SVG-font build is only used here, as the source for the per-icon SVGs
    glyphs = parse_svg_font(get(font_url("svg")).decode("utf-8", "replace"))
    spare = sorted(set(glyphs) - known - {" "})
    if spare:
        print("  NOTE: unnamed glyphs in the font: %s" % spare)

    print("writing img/icons/ …")
    for name, ch in sorted(ICONS.items()):
        if ch not in glyphs:
            print("  MISSING glyph %r for %s" % (ch, name), file=sys.stderr)
            continue
        d, adv = glyphs[ch]
        write(os.path.join(ROOT, "img", "icons", name + ".svg"),
              '<svg xmlns="http://www.w3.org/2000/svg" viewBox="%s" '
              'fill="currentColor"><g transform="translate(0, %d) scale(1, -1)">'
              '<path d="%s"/></g></svg>\n' % (view_box(d, adv), ASCENT, d))

    print("writing img/factions/ …")
    for f in FACTIONS:
        write(os.path.join(ROOT, "img", "factions", f + ".png"),
              get("%s/bundles/app/images/factions/%s.png" % (ORIGIN, f)))

    print("done — %d icons" % len(ICONS))


if __name__ == "__main__":
    main()
