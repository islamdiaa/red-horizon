#!/usr/bin/env python3
"""Build the interface fallback fonts for the translated UI (public/fonts/), from the pinned sources that
tools/fonts/fetch.mjs downloads (sha256-checked again here).

  tektur-cyrillic.woff2      Tektur (OFL), width 85, weights 400-700 (variable), Cyrillic only: Russian next to
                             the Latin-only Rajdhani, condensed so Russian strings fit the HUD
  noto-sans-sc-subset.woff2  Noto Sans SC (OFL) Medium, only the characters the zh-CN catalogue uses: a safety net
                             for systems without a Chinese font (the CSS stack prefers the system's own)

Also writes src/i18n/source/zh-CN.glyphs.txt (the characters in the CJK subset), which tests/i18n.test.ts compares
with the catalogue. Re-run after changing zh-CN.json:

  python3 -m venv ~/.cache/rh-fonts/venv && ~/.cache/rh-fonts/venv/bin/pip install fonttools==4.60.1 brotli==1.1.0
  node tools/fonts/fetch.mjs && ~/.cache/rh-fonts/venv/bin/python tools/fonts/subset.py
"""
import hashlib
import io
import json
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CACHE = os.path.join(os.path.expanduser('~'), '.cache', 'red-horizon', 'fonts')
PINS = json.load(open(os.path.join(ROOT, 'tools', 'fonts', 'fonts.json'), encoding='utf-8'))
OUT = os.path.join(ROOT, 'public', 'fonts')

# Cyrillic (Russian and its neighbours), plus the numero sign
CYRILLIC = list(range(0x0400, 0x0460)) + [0x0490, 0x0491, 0x04B0, 0x04B1, 0x2116]
# always in the CJK subset: ideographic and full-width punctuation the translators may use
CJK_ALWAYS = '　、。〈〉《》「」『』【】〔〕〜・！（），：；？～·…—'


def source(font_id):
    pin = next(f for f in PINS['fonts'] if f['id'] == font_id)['files']['font']
    path = os.path.join(CACHE, font_id, pin['file'])
    with open(path, 'rb') as fh:
        digest = hashlib.sha256(fh.read()).hexdigest()
    if digest != pin['sha256']:
        sys.exit(f'{path}: sha256 {digest} != pinned {pin["sha256"]} (run node tools/fonts/fetch.mjs)')
    return path


def rename(font, family):
    """A Modified Version must not use the original (possibly reserved) name: call it ours."""
    name = font['name']
    for rec in list(name.names):
        if rec.nameID in (1, 3, 4, 6, 16, 17, 21, 22, 25):
            name.removeNames(nameID=rec.nameID)
    name.setName(family, 1, 3, 1, 0x409)
    name.setName('Regular', 2, 3, 1, 0x409)
    name.setName(f'{family};subset', 3, 3, 1, 0x409)
    name.setName(family, 4, 3, 1, 0x409)
    name.setName(family.replace(' ', ''), 6, 3, 1, 0x409)


def reload(font):
    """Instanced fonts are subset from a clean re-parse (the subsetter trips over the instancer's lazy tables)."""
    buf = io.BytesIO()
    font.save(buf)
    buf.seek(0)
    return TTFont(buf)


def write(font, unicodes, out, family):
    font = reload(font)
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = ['kern', 'liga', 'calt', 'locl', 'ccmp', 'mark', 'mkmk', 'vert', 'halt', 'palt']
    opts.name_IDs = ['*']
    opts.notdef_outline = True
    opts.recalc_bounds = True
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=unicodes)
    sub.subset(font)
    rename(font, family)
    font.flavor = 'woff2'
    # reproducible output: keep the source's timestamp (fontTools writes "now" into head.modified otherwise)
    font.recalcTimestamp = False
    font['head'].modified = font['head'].created
    font.save(out)
    print(f'{os.path.relpath(out, ROOT)}: {os.path.getsize(out) / 1024:.1f} KB, {len(font.getBestCmap())} characters')


def tektur():
    font = TTFont(source('tektur'))
    font = instancer.instantiateVariableFont(font, {'wdth': 85, 'wght': (400, 700)})
    write(font, CYRILLIC, os.path.join(OUT, 'tektur-cyrillic.woff2'), 'RH Cyrillic')


def noto_sc():
    cat = json.load(open(os.path.join(ROOT, 'src', 'i18n', 'locales', 'zh-CN.json'), encoding='utf-8'))
    chars = set(CJK_ALWAYS)
    for v in cat.values():
        chars.update(c for c in v if ord(c) >= 0x2E80)
    font = TTFont(source('notosanssc'))
    font = instancer.instantiateVariableFont(font, {'wght': 500})
    cmap = font.getBestCmap()
    missing = sorted(c for c in chars if ord(c) not in cmap)
    if missing:
        print('not in Noto Sans SC:', ''.join(missing))
    have = sorted(c for c in chars if ord(c) in cmap)
    write(font, [ord(c) for c in have], os.path.join(OUT, 'noto-sans-sc-subset.woff2'), 'RH CJK')
    with open(os.path.join(ROOT, 'src', 'i18n', 'source', 'zh-CN.glyphs.txt'), 'w', encoding='utf-8') as fh:
        fh.write(''.join(have) + '\n')


if __name__ == '__main__':
    # (the Cyrillic set is fixed: `subset.py cjk` after a Chinese catalogue change rebuilds only what changed)
    which = sys.argv[1:] or ['tektur', 'cjk']
    if 'tektur' in which:
        tektur()
    if 'cjk' in which:
        noto_sc()
