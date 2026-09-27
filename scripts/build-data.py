"""Build public/data/ from upstream, our overlay, and a few derived rules.

    python scripts/fetch-data.py      # first, to put upstream in place
    python scripts/build-data.py

The output is what the app reads instead of arkhamdb.com/api/public: one
directory per locale, shaped like the endpoints it replaces.

    db/meta.json                  what this build was made from
    db/<locale>/packs.json        <- /api/public/packs/
    db/<locale>/cards/all.json    <- /api/public/cards/?encounter=1
    db/<locale>/cards/<pack>.json <- /api/public/cards/<pack>

The tree sits at the site root because that is what the site serves: index.html
is at the root, so the app fetches these as /db/<locale>/...

Three inputs, in strict order of authority: upstream is the base, our overlay
patches it, and the rules derive what can be derived. The order matters in one
place -- overlay pack patches are applied BEFORE the rules run, because a rule
reads the `replaces` that only the overlay declares.

WHY THE RULES EXIST

Upstream models three things in a way that is correct but not what a person
browsing a collection expects, and all three are derivable rather than facts
worth writing down:

  Stubs.  A Revised Core card such as 01501 is stored as five fields and a
  `duplicate_of: 01001`. It has no name and no text of its own. Resolving the
  pointer is what gives it a card.

  Replacements.  The Revised Core only restates the 116 cards that changed, so
  asking upstream for `rcore` yields 116 of the ~195 cards in the box. The
  other 82 are the ones the revision left alone, still filed under `core`.

  Reprint boxes.  The twelve Campaign and Investigator Expansions hold no cards
  at all; each declares the packs it reprints, and `reprint_type` says which
  half of them it took -- the campaign box the encounter cards, the investigator
  box the player cards.

Writing any of this out as data would mean copying thousands of card records
and re-copying them whenever upstream fixes an erratum. As rules they cost
about forty lines and inherit every upstream correction for free.

MEMBERSHIP

A card keeps one `pack_code`: where upstream files it, which is where it was
printed. What the rules produce is membership, in a `packs` array listing every
product the card appears in -- so 01001 is `pack_code: core`, `packs:
[core, rcore]`. A pack's file contains every member, which is why a card can
appear in more than one of them.

IMAGES

Upstream carries no image paths at all; ArkhamDB derives them, and so do we,
from data/card-art/manifest.json -- the mirror written by docs/fetch-cardart.py.
The manifest is what says whether a scan exists and whether it is .png or .jpg,
which cannot be guessed: 1806 of them are .jpg. Paths are emitted in ArkhamDB's
own `/bundles/cards/<file>` form so that the app's existing API.imageUrl keeps
resolving them against arkhamdb.com; pointing them at our own mirror is a
separate change, in the app rather than here.

Options:

    --locale CODE   build one locale, repeatable (default: every locale the
                    app offers)
    --all-locales   build every locale upstream translates
    --pretty        indent the JSON, for reading it rather than serving it
    --quiet         totals only
"""
import argparse
import collections
import glob
import json
import os
import re
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPSTREAM = os.path.join(ROOT, 'data', 'database-json')
OVERLAY = os.path.join(ROOT, 'data', 'database-overlay')
CARDART = os.path.join(ROOT, 'data', 'card-art', 'manifest.json')
LOCK = os.path.join(ROOT, 'data', 'upstream.lock')
OUT = os.path.join(ROOT, 'db')

# Every locale the app's picker offers. Building fewer would leave the picker
# with entries that 404.
DEFAULT_LOCALES = ('es', 'en', 'de', 'fr', 'it', 'pt', 'pl', 'ru', 'uk', 'ko', 'zh')

# Scans are served from here, in ArkhamDB's own layout -- see the docstring.
IMG_PREFIX = '/bundles/cards/'
ARKHAMDB = 'https://arkhamdb.com'

# Fields a locale file is allowed to override. Anything else in a translation
# is ignored rather than silently reshaping a card.
TRANSLATABLE = ('name', 'subname', 'text', 'traits', 'flavor', 'slot',
                'back_name', 'back_subname', 'back_text', 'back_flavor',
                'back_traits', 'customization_text', 'customization_change')

notes = []


def note(msg):
    notes.append(msg)


def load(path, default=None):
    try:
        with open(path, encoding='utf-8') as fh:
            return json.load(fh)
    except FileNotFoundError:
        return default
    except ValueError as err:
        raise SystemExit('%s is not valid JSON: %s' % (path, err))


def dump(path, payload, pretty):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        if pretty:
            json.dump(payload, fh, indent=2, sort_keys=True, ensure_ascii=False)
        else:
            json.dump(payload, fh, separators=(',', ':'), ensure_ascii=False)
        fh.write('\n')
    os.replace(tmp, path)
    return os.path.getsize(path)


def patch(base, over):
    """Apply an overlay entry. Returns None when the entry drops the record.
    Keys beginning with __ are directives, not data."""
    if over.get('__drop'):
        return None
    out = dict(base)
    for key, value in over.items():
        if key.startswith('__'):
            continue
        if value is None:
            out.pop(key, None)       # an explicit null removes a field
        else:
            out[key] = value
    return out


# --------------------------------------------------------------------------
# inputs


def read_packs():
    """Packs and cycles, upstream then overlay. Returns them in the order the
    app wants: by cycle, then by position inside the cycle."""
    cycles = {c['code']: dict(c) for c in load(os.path.join(UPSTREAM, 'cycles.json'), [])}
    packs = {p['code']: dict(p) for p in load(os.path.join(UPSTREAM, 'packs.json'), [])}

    for code, over in (load(os.path.join(OVERLAY, 'cycles.json'), {}) or {}).items():
        if code in cycles:
            cycles[code] = patch(cycles[code], over) or cycles.pop(code, None)
        elif over.get('__new'):
            cycles[code] = patch({'code': code}, over)
        else:
            note('database-overlay/cycles.json: %s is not an upstream cycle; '
                 'add "__new": true to create it' % code)

    created = dropped = patched = 0
    for code, over in (load(os.path.join(OVERLAY, 'packs.json'), {}) or {}).items():
        if code in packs:
            merged = patch(packs[code], over)
            if merged is None:
                del packs[code]
                dropped += 1
            else:
                packs[code] = merged
                patched += 1
        elif over.get('__new'):
            packs[code] = patch({'code': code}, over)
            created += 1
        else:
            note('database-overlay/packs.json: %s is not an upstream pack; '
                 'add "__new": true to create it' % code)
    if created or dropped or patched:
        note('packs: %d patched, %d created, %d dropped by the overlay'
             % (patched, created, dropped))

    for pack in packs.values():
        cycle = cycles.get(pack.get('cycle_code')) or {}
        pack['cycle_position'] = cycle.get('position', 999)
        pack['cycle_name'] = cycle.get('name')

    order = sorted(packs.values(),
                   key=lambda p: (p.get('cycle_position', 999), p.get('position', 0)))
    return order, cycles


def read_cards():
    """Every upstream card, plus our own. Each carries `_encounter`, taken from
    the file it came from: upstream splits a pack's encounter cards into
    <pack>_encounter.json, and that split is what the reprint rule needs."""
    cards = {}
    files = sorted(glob.glob(os.path.join(UPSTREAM, 'pack', '*', '*.json')))
    if not files:
        raise SystemExit('no upstream cards found -- run scripts/fetch-data.py first')
    for path in files:
        encounter = os.path.basename(path).endswith('_encounter.json')
        for card in load(path, []):
            card = dict(card)
            card['_encounter'] = encounter
            if card['code'] in cards:
                note('duplicate code %s in %s' % (card['code'], os.path.basename(path)))
            cards[card['code']] = card

    own = 0
    for path in sorted(glob.glob(os.path.join(OVERLAY, 'cards', '*.json'))):
        for card in load(path, []):
            card = dict(card)
            card.setdefault('_encounter', bool(card.get('encounter_code')))
            if card['code'] in cards:
                note('database-overlay/cards/%s: %s already exists upstream; '
                     'patch it in fixes.json instead of redefining it'
                     % (os.path.basename(path), card['code']))
            cards[card['code']] = card
            own += 1
    if own:
        note('cards: %d added from the overlay' % own)

    dropped = patched = 0
    for code, over in (load(os.path.join(OVERLAY, 'fixes.json'), {}) or {}).items():
        if code not in cards:
            note('database-overlay/fixes.json: %s is not a known card' % code)
            continue
        merged = patch(cards[code], over)
        if merged is None:
            del cards[code]
            dropped += 1
        else:
            cards[code] = merged
            patched += 1
    if patched or dropped:
        note('cards: %d patched, %d dropped by the overlay' % (patched, dropped))
    return cards


def read_art():
    """code -> (front file, back file), from the card-art manifest. Absent
    manifest means no images, which is a warning rather than a failure: the
    data is still worth building."""
    manifest = load(CARDART)
    if not manifest:
        note('data/card-art/manifest.json not found -- no image paths emitted. '
             'Run docs/fetch-cardart.py.')
        return {}
    files = {entry['file'] for entry in manifest.get('files', {}).values()}
    front, back = {}, {}
    for name in files:
        stem = name.rsplit('.', 1)[0]
        if stem.endswith('b') and stem[:-1]:
            back.setdefault(stem[:-1], name)
        front.setdefault(stem, name)
    art = {}
    for code in set(front) | set(back):
        art[code] = (front.get(code), back.get(code))
    return art


# --------------------------------------------------------------------------
# rules


def resolve_stubs(cards):
    """A stub is a card stored as a pointer: `duplicate_of` and no name of its
    own. It inherits the target's fields, and its own always win -- which is
    how a Revised Core card keeps its new illustrator and its own scan while
    taking the rest from the original."""
    resolved = 0
    for card in cards.values():
        target_code = card.get('duplicate_of') or card.get('alternate_of')
        if not target_code or card.get('name'):
            continue
        target = cards.get(target_code)
        if not target:
            note('stub %s points at %s, which does not exist' % (card['code'], target_code))
            continue
        merged = {k: v for k, v in target.items() if not k.startswith('_')}
        merged.update(card)
        card.clear()
        card.update(merged)
        resolved += 1
    if resolved:
        note('rules: %d stubs resolved through duplicate_of' % resolved)
    return resolved


def mark_hidden(cards):
    """Which cards are a reverse rather than a card of their own.

    Upstream's `hidden` is unreliable on its own: it misses 38 cards that are
    plainly the back of something, and wrongly claims 21 that are not. The
    relationship it fails to consult is the one it already stores -- a card
    named as some other card's `back_link` IS a reverse.

        hidden = something links to it,
                 or upstream says so and it links to nothing itself

    Checked against a live API dump this matches ArkhamDB on 5927 of 5929
    cards. The two it does not are promo investigators upstream marks hidden in
    error, and they are corrected in the overlay rather than by weakening the
    rule. faces.js depends on this: a card wrongly marked hidden is announced
    to the reader as the back of something else."""
    targets = {c['back_link'] for c in cards.values() if c.get('back_link')}
    changed = 0
    for card in cards.values():
        was = bool(card.get('hidden'))
        now = card['code'] in targets or (was and not card.get('back_link'))
        if now != was:
            changed += 1
        card['hidden'] = now
    if changed:
        note('rules: hidden recomputed, %d cards changed' % changed)


# Two icon tokens printed side by side are written [action][action] upstream
# and served [action] [action] by ArkhamDB. markup.js draws each token as its
# own span and adds no gap, so without this the two icons sit flush. It applies
# to `text` alone: in `flavor` the same substitution makes matters worse.
ADJACENT_TOKENS = re.compile(r'\]\[')


def space_tokens(cards):
    spaced = 0
    for card in cards.values():
        text = card.get('text')
        if text and ADJACENT_TOKENS.search(text):
            card['text'] = ADJACENT_TOKENS.sub('] [', text)
            spaced += 1
    if spaced:
        note('rules: %d cards had adjacent icon tokens spaced' % spaced)


def membership(cards, packs):
    """pack_code -> [card codes], applying the two expansion rules on top of
    what each card says about itself."""
    own = collections.defaultdict(list)
    for card in cards.values():
        own[card['pack_code']].append(card['code'])

    members = {p['code']: list(own.get(p['code'], ())) for p in packs}

    # `replaces`: a reissue restates only what changed, so it also holds every
    # card of the pack it replaces that none of its own cards stands in for.
    for pack in packs:
        replaced = pack.get('replaces')
        if not replaced:
            continue
        if replaced not in members:
            note('%s declares replaces: %s, which is not a pack' % (pack['code'], replaced))
            continue
        covered = {cards[c].get('duplicate_of') or cards[c].get('alternate_of')
                   for c in members[pack['code']]}
        inherited = [c for c in own.get(replaced, ()) if c not in covered]
        members[pack['code']].extend(inherited)
        note('rules: %s inherits %d cards from %s (%d of its own)'
             % (pack['code'], len(inherited), replaced, len(own.get(pack['code'], ()))))

    # `reprint_packs` + `reprint_type`: the box holds one half of each pack it
    # reprints -- the campaign box the encounter cards, the player box the rest.
    for pack in packs:
        sources = pack.get('reprint_packs')
        if not sources:
            continue
        want_encounter = pack.get('reprint_type') == 'campaign'
        if pack.get('reprint_type') not in ('campaign', 'player'):
            note('%s has reprint_packs but reprint_type=%r; treated as player'
                 % (pack['code'], pack.get('reprint_type')))
        taken = []
        for src in sources:
            if src not in own:
                note('%s reprints %s, which has no cards' % (pack['code'], src))
                continue
            taken += [c for c in own[src]
                      if bool(cards[c].get('_encounter')) == want_encounter]
        seen = set(members[pack['code']])
        members[pack['code']].extend(c for c in taken if c not in seen)
        declared = pack.get('size')
        got = len(members[pack['code']])
        if declared and abs(got - declared) > 12:
            note('%s: rule yields %d cards, pack declares size %d (%+d)'
                 % (pack['code'], got, declared, got - declared))

    return members


# --------------------------------------------------------------------------
# derived fields


def derive(cards, packs, members, art, lookups):
    """Add the fields ArkhamDB computes at serve time and upstream does not
    store. Only the ones the app actually reads, plus the name lookups, which
    are free."""
    by_pack = {p['code']: p for p in packs}
    packs_of = collections.defaultdict(list)
    for code, codes in members.items():
        for card in codes:
            packs_of[card].append(code)

    # Reverse indexes: upstream states a reprint relationship once, forwards.
    duplicated_by = collections.defaultdict(list)
    alternated_by = collections.defaultdict(list)
    for card in cards.values():
        if card.get('duplicate_of'):
            duplicated_by[card['duplicate_of']].append(card['code'])
        if card.get('alternate_of'):
            alternated_by[card['alternate_of']].append(card['code'])

    order = {p['code']: i for i, p in enumerate(packs)}

    for card in cards.values():
        code = card['code']

        card['packs'] = sorted(set(packs_of.get(code, [card['pack_code']])),
                               key=lambda c: order.get(c, 999))

        pack = by_pack.get(card['pack_code'], {})
        card['pack_name'] = pack.get('name')
        for field, table in (('faction_code', 'factions'), ('faction2_code', 'factions'),
                             ('faction3_code', 'factions'), ('type_code', 'types'),
                             ('subtype_code', 'subtypes'), ('encounter_code', 'encounters')):
            value = card.get(field)
            if value is None:
                continue
            name = lookups[table].get(value)
            if name is None:
                note('%s: unknown %s %r' % (code, field, value))
                continue
            card[field.replace('_code', '_name')] = name

        front, back = art.get(code, (None, None))
        if front and not card.get('imagesrc'):
            card['imagesrc'] = IMG_PREFIX + front
        # A <code>b scan is only this card's other face when <code>b is not a
        # card of its own. Where it is, the reverse is a separate record and is
        # reached through linked_card -- and declaring backimagesrc as well
        # would make faces.js prefer the bare image over the record, losing the
        # reverse's name and text. Matches ArkhamDB on all 5929 shared cards.
        if back and not card.get('backimagesrc') and (code + 'b') not in cards:
            card['backimagesrc'] = IMG_PREFIX + back

        # faces.js reads linked_to_code and the nested linked_card; upstream
        # states the same link as back_link.
        link = card.get('back_link')
        if link:
            card['linked_to_code'] = link
            target = cards.get(link)
            if target:
                card['linked_to_name'] = target.get('name')
                card['linked_card'] = {k: v for k, v in target.items()
                                       if not k.startswith('_') and k != 'linked_card'}
            else:
                note('%s links to %s, which does not exist' % (code, link))

        for src, dest in (('duplicate_of', 'duplicate_of'), ('alternate_of', 'alternate_of')):
            target_code = card.get(src)
            if target_code:
                card[dest + '_code'] = target_code
                target = cards.get(target_code)
                if target:
                    card[dest + '_name'] = target.get('name')
        if duplicated_by.get(code):
            card['duplicated_by'] = sorted(duplicated_by[code])
        if alternated_by.get(code):
            card['alternated_by'] = sorted(alternated_by[code])

        # Only for cards ArkhamDB actually serves; a custom card has no page
        # there and the app falls back to its own link.
        if not card.get('__custom'):
            card['url'] = '%s/card/%s' % (ARKHAMDB, code)


# --------------------------------------------------------------------------
# locales


def available_locales():
    tdir = os.path.join(UPSTREAM, 'translations')
    if not os.path.isdir(tdir):
        return []
    return sorted(n for n in os.listdir(tdir)
                  if os.path.isdir(os.path.join(tdir, n)))


def localize(cards, packs, cycles, locale):
    """Apply a locale's overlay. 'en' is the base, so nothing to apply.
    Untranslated fields simply stay in English, which is what ArkhamDB serves
    too -- its locale subdomains fall back the same way."""
    if locale == 'en':
        return cards, packs, 0

    tdir = os.path.join(UPSTREAM, 'translations', locale)
    strings = {}
    for path in glob.glob(os.path.join(tdir, 'pack', '*', '*.json')):
        for index, entry in enumerate(load(path, [])):
            # An entry with no code matches no card. Upstream has one such
            # record; it is reported rather than allowed to fail the build,
            # since nothing else in the locale depends on it.
            if not isinstance(entry, dict) or 'code' not in entry:
                note('%s: entry %d of %s has no code, skipped'
                     % (locale, index, os.path.basename(path)))
                continue
            strings[entry['code']] = entry

    applied = 0
    out = {}
    for code, card in cards.items():
        # Always a copy, even with nothing to translate: pack_name is rewritten
        # below, and handing back the shared record would write this locale's
        # names into every locale built after it.
        copy = dict(card)
        entry = strings.get(code)
        if entry:
            for field in TRANSLATABLE:
                if field in entry:
                    copy[field] = entry[field]
            applied += 1
        out[code] = copy

    names = {p['code']: p.get('name') for p in load(os.path.join(tdir, 'packs.json'), [])}
    cnames = {c['code']: c.get('name') for c in load(os.path.join(tdir, 'cycles.json'), [])}
    lpacks = []
    for pack in packs:
        copy = dict(pack)
        if names.get(pack['code']):
            copy['name'] = names[pack['code']]
        if cnames.get(pack.get('cycle_code')):
            copy['cycle_name'] = cnames[pack['cycle_code']]
        lpacks.append(copy)

    # pack_name rides on each card, so it has to follow the locale too.
    by_pack = {p['code']: p.get('name') for p in lpacks}
    for card in out.values():
        if card.get('pack_code') in by_pack:
            card['pack_name'] = by_pack[card['pack_code']]

    return out, lpacks, applied


def public(card):
    """The record as served: private build fields stripped."""
    return {k: v for k, v in card.items() if not k.startswith('_')}


# --------------------------------------------------------------------------


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--locale', action='append', default=[])
    ap.add_argument('--all-locales', action='store_true')
    ap.add_argument('--pretty', action='store_true')
    ap.add_argument('--quiet', action='store_true')
    args = ap.parse_args()

    started = time.time()

    packs, cycles = read_packs()
    cards = read_cards()
    art = read_art()
    lookups = {
        'types': {t['code']: t['name'] for t in load(os.path.join(UPSTREAM, 'types.json'), [])},
        'factions': {f['code']: f['name'] for f in load(os.path.join(UPSTREAM, 'factions.json'), [])},
        'subtypes': {s['code']: s['name'] for s in load(os.path.join(UPSTREAM, 'subtypes.json'), [])},
        'encounters': {e['code']: e['name'] for e in load(os.path.join(UPSTREAM, 'encounters.json'), [])},
    }

    resolve_stubs(cards)
    mark_hidden(cards)
    space_tokens(cards)
    members = membership(cards, packs)
    derive(cards, packs, members, art, lookups)

    have = available_locales()
    if args.all_locales:
        locales = ['en'] + have
    elif args.locale:
        locales = args.locale
    else:
        locales = list(DEFAULT_LOCALES)
    unknown = [l for l in locales if l != 'en' and l not in have]
    if unknown:
        raise SystemExit('upstream has no translation for: %s (has: %s)'
                         % (', '.join(unknown), ' '.join(have)))

    lock = load(LOCK, {}) or {}
    written = 0
    total = 0

    for locale in locales:
        lcards, lpacks, applied = localize(cards, packs, cycles, locale)
        base = os.path.join(OUT, locale)

        total += dump(os.path.join(base, 'packs.json'),
                      [public(p) for p in lpacks], args.pretty)
        written += 1

        pool = sorted(lcards.values(),
                      key=lambda c: (next((i for i, p in enumerate(lpacks)
                                           if p['code'] == c['pack_code']), 999),
                                     c.get('position') or 0))
        total += dump(os.path.join(base, 'cards', 'all.json'),
                      [public(c) for c in pool], args.pretty)
        written += 1

        for pack in lpacks:
            codes = members.get(pack['code'], ())
            rows = [public(lcards[c]) for c in codes if c in lcards]
            rows.sort(key=lambda c: c.get('position') or 0)
            total += dump(os.path.join(base, 'cards', '%s.json' % pack['code']),
                          rows, args.pretty)
            written += 1

        if not args.quiet:
            print('%-6s %d packs, %d cards, %d translated'
                  % (locale, len(lpacks), len(pool), applied))

    dump(os.path.join(OUT, 'meta.json'), {
        'generated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'upstream': {'commit': lock.get('commit'), 'subject': lock.get('subject')},
        'locales': locales,
        'packs': len(packs),
        'cards': len(cards),
        'images': len(art),
    }, True)

    if notes and not args.quiet:
        print()
        print('notes:')
        for line in notes:
            print('  %s' % line)

    print()
    print('%d files, %.1f MB, in %ds'
          % (written + 1, total / 1048576, time.time() - started))


if __name__ == '__main__':
    main()
