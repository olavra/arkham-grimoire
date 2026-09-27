"""Mirror every card scan ArkhamDB holds into data/card-art/.

Run from the project root, as often as you like:

    python docs/fetch-cardart.py

The first run pulls the lot -- 7500-odd files, around 850 MB. Every run after
that is a sync: each file already on disk is asked for conditionally with the
ETag recorded the last time, so an unchanged scan costs one 304 and no body.
A full re-sync of an up-to-date mirror is therefore cheap enough to be a habit
rather than an event.

There is only one resolution. ArkhamDB serves each scan as a single file under
/bundles/cards/ and answers 500 for every larger variant one might guess at
(.jpg for a .png card, @2x, /large/, _hires), so "best available" is simply
whatever that file is. Quality is uneven and nothing here can improve it: the
old core-set scans are ~420x300 while recent packs are 750x1050.

The extension is taken from the card's own imagesrc and never assumed -- 1806
of the scans are .jpg and the rest .png, and asking for the wrong one is a 500.

Only the canonical host is used. The locale subdomains serve byte-identical
scans (same ETag, same length), so there is nothing to gain from fetching
es.arkhamdb.com as well: card text is translated, card art is not.

Writes:

    data/card-art/<code>[b].<ext>   the scans, named as ArkhamDB names them
    data/card-art/manifest.json     per-file etag, length and digest
    data/card-art/no-art.json       the cards the API lists with no scan at all

The manifest is what makes a run incremental, so it lives with the images:
delete it and the next run re-downloads everything. Both JSON files are
generated -- edit neither by hand.

Options:

    --workers N   parallel connections (default 6)
    --force       ignore the manifest and refetch every file
    --pack CODE   restrict to one pack, repeatable
    --limit N     stop after N files, for a quick smoke test
    --dry-run     report what would be fetched, download nothing
    --prune       delete mirrored files the API no longer lists
"""
import argparse
import hashlib
import http.client
import json
import os
import re
import socket
import sys
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'card-art')
MANIFEST = os.path.join(OUT, 'manifest.json')
NO_ART = os.path.join(OUT, 'no-art.json')

HOST = 'arkhamdb.com'
CARDS_URL = 'https://' + HOST + '/api/public/cards/?encounter=1'
UA = 'arkham-grimoire card-art sync (local mirror)'

# ArkhamDB 500s intermittently under load, and a mirror run makes thousands of
# requests, so a failure is ordinary rather than exceptional.
RETRIES = 4
BACKOFF = 1.6
TIMEOUT = 30

# Every scan lives directly under this prefix; anything else in an imagesrc is
# a shape this script has not seen, and is reported rather than guessed at.
PREFIX = '/bundles/cards/'
SAFE_NAME = re.compile(r'^[A-Za-z0-9_-]+\.(?:png|jpg|jpeg|webp|gif)$')

# An error page served with a 200 would otherwise be written out as a card.
MAGIC = (b'\x89PNG\r\n\x1a\n', b'\xff\xd8\xff', b'RIFF', b'GIF8')

lock = threading.Lock()
local = threading.local()


def log(msg):
    with lock:
        sys.stdout.write(msg + '\n')
        sys.stdout.flush()


def connection():
    """One keep-alive connection per worker: 7500 fresh TLS handshakes would
    cost more than the downloads."""
    conn = getattr(local, 'conn', None)
    if conn is None:
        conn = local.conn = http.client.HTTPSConnection(HOST, timeout=TIMEOUT)
    return conn


def drop_connection():
    conn = getattr(local, 'conn', None)
    local.conn = None
    if conn is not None:
        try:
            conn.close()
        except Exception:
            pass


def get(path, headers):
    """GET path, retrying on transport errors and 5xx. Returns
    (status, headers, body); the body of a 304 is empty."""
    last = None
    for attempt in range(RETRIES):
        if attempt:
            time.sleep(BACKOFF ** attempt)
        try:
            conn = connection()
            sent = dict(headers)
            sent['User-Agent'] = UA
            sent['Accept'] = 'image/*'
            conn.request('GET', path, headers=sent)
            res = conn.getresponse()
            body = res.read()  # always drained, or the connection cannot be reused
            if res.status >= 500:
                last = 'HTTP %d' % res.status
                drop_connection()
                continue
            return res.status, {k.lower(): v for k, v in res.getheaders()}, body
        except (http.client.HTTPException, socket.error, OSError) as err:
            last = '%s: %s' % (type(err).__name__, err)
            drop_connection()
    raise IOError(last or 'unknown failure')


def pool():
    """Every card in the game, from the API. encounter=1 or the encounter decks
    are left out, which is most of the scans."""
    req = urllib.request.Request(CARDS_URL, headers={
        'User-Agent': UA, 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
        return json.load(res)


def wanted(cards, packs):
    """imagesrc -> the card codes that point at it. A path can be claimed by
    more than one card: the front of one card is sometimes the back of another,
    and reprints share art."""
    out = {}
    skipped = []
    noart = []
    for card in cards:
        if packs and card.get('pack_code') not in packs:
            continue
        if not card.get('imagesrc'):
            noart.append({'code': card.get('code'), 'name': card.get('name'),
                          'pack_code': card.get('pack_code')})
        for key in ('imagesrc', 'backimagesrc'):
            src = card.get(key)
            if not src:
                continue
            name = src[len(PREFIX):] if src.startswith(PREFIX) else None
            if not name or not SAFE_NAME.match(name):
                skipped.append((card.get('code'), src))
                continue
            out.setdefault(src, []).append(card.get('code'))
    return out, skipped, noart


def load_manifest():
    try:
        with open(MANIFEST, encoding='utf-8') as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return {}
    return data.get('files', {}) if isinstance(data, dict) else {}


def write_json(path, payload):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, indent=2, sort_keys=True, ensure_ascii=False)
        fh.write('\n')
    os.replace(tmp, path)


def save_manifest(files):
    write_json(MANIFEST, {
        'generated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'host': HOST,
        'count': len(files),
        'bytes': sum(f.get('bytes', 0) for f in files.values()),
        'files': files,
    })


def fetch(src, entry, force):
    """Sync one scan. Returns (state, bytes, entry), where state is one of
    'new', 'updated', 'current' or 'gone', and a None entry means drop it from
    the manifest."""
    name = src[len(PREFIX):]
    dest = os.path.join(OUT, name)
    on_disk = os.path.isfile(dest)

    headers = {}
    if on_disk and entry and not force:
        # The ETag is the reliable half here: this server answers a future
        # If-Modified-Since with a 200, so a date alone cannot be trusted.
        if entry.get('etag'):
            headers['If-None-Match'] = entry['etag']
        elif entry.get('last_modified'):
            headers['If-Modified-Since'] = entry['last_modified']

    status, res, body = get(src, headers)

    if status == 304:
        return 'current', entry.get('bytes', 0), entry
    if status == 404:
        return 'gone', 0, None
    if status != 200:
        raise IOError('HTTP %d' % status)
    if not body.startswith(MAGIC):
        raise IOError('not an image (%d bytes, %s)'
                      % (len(body), res.get('content-type', '?')))
    declared = res.get('content-length')
    if declared and int(declared) != len(body):
        raise IOError('truncated: %s declared, %d read' % (declared, len(body)))

    # Written through a temp file so an interrupted run never leaves half a card
    # behind for the next run to accept as complete.
    tmp = dest + '.part'
    with open(tmp, 'wb') as fh:
        fh.write(body)
    os.replace(tmp, dest)

    return ('updated' if on_disk else 'new'), len(body), {
        'etag': res.get('etag'),
        'last_modified': res.get('last-modified'),
        'bytes': len(body),
        'sha256': hashlib.sha256(body).hexdigest(),
        'file': name,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--workers', type=int, default=6)
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--pack', action='append', default=[])
    ap.add_argument('--limit', type=int)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--prune', action='store_true')
    args = ap.parse_args()

    os.makedirs(OUT, exist_ok=True)

    log('listing cards...')
    try:
        cards = pool()
    except Exception as err:
        sys.exit('could not read the card list: %s' % err)

    packs = set(args.pack)
    paths, skipped, noart = wanted(cards, packs)
    manifest = {} if args.force else load_manifest()

    for code, src in skipped:
        log('  ? %s: unexpected imagesrc %r, left out' % (code, src))

    todo = sorted(paths)
    if args.limit:
        todo = todo[:args.limit]

    log('%d cards, %d unique scans, %d already in the manifest'
        % (len(cards), len(paths), len(manifest)))
    if not packs:
        log('%d cards have no scan at all' % len(noart))

    if args.dry_run:
        conditional = [p for p in todo if p in manifest
                       and os.path.isfile(os.path.join(OUT, p[len(PREFIX):]))]
        log('would check %d scans, %d of them as conditional requests'
            % (len(todo), len(conditional)))
        return

    tally = {'new': 0, 'updated': 0, 'current': 0, 'gone': 0, 'failed': 0}
    moved = 0
    done = 0
    started = time.time()

    def work(src):
        try:
            return src, fetch(src, manifest.get(src), args.force), None
        except Exception as err:
            return src, None, err

    with ThreadPoolExecutor(max_workers=args.workers) as workers:
        for src, result, err in workers.map(work, todo):
            done += 1
            if err is not None:
                tally['failed'] += 1
                log('  ! %s: %s' % (src[len(PREFIX):], err))
            else:
                state, size, entry = result
                tally[state] += 1
                if entry is None:
                    manifest.pop(src, None)
                    log('  - %s: 404, no longer served' % src[len(PREFIX):])
                else:
                    manifest[src] = entry
                if state in ('new', 'updated'):
                    moved += size
            if done % 250 == 0 or done == len(todo):
                log('  %d/%d  new %d  updated %d  unchanged %d  failed %d  %.1f MB'
                    % (done, len(todo), tally['new'], tally['updated'],
                       tally['current'], tally['failed'], moved / 1048576))

    # Pruning needs the whole picture, so it is skipped on a partial run rather
    # than deleting everything the filter happened to leave out.
    if args.prune and not packs and not args.limit:
        keep = set(p[len(PREFIX):] for p in paths)
        for name in sorted(os.listdir(OUT)):
            if name.endswith('.json') or name in keep or not SAFE_NAME.match(name):
                continue
            os.remove(os.path.join(OUT, name))
            log('  - pruned %s' % name)

    save_manifest(manifest)
    if not packs:
        write_json(NO_ART, {'count': len(noart),
                            'cards': sorted(noart, key=lambda c: c['code'] or '')})

    mirrored = sum(f.get('bytes', 0) for f in manifest.values())
    log('done in %ds: %d new, %d updated, %d unchanged, %d failed'
        % (time.time() - started, tally['new'], tally['updated'],
           tally['current'], tally['failed']))
    log('%.1f MB transferred; mirror now holds %d files, %.1f MB'
        % (moved / 1048576, len(manifest), mirrored / 1048576))
    if tally['failed']:
        log('re-run to pick up the failures -- everything already on disk '
            'answers 304')
        sys.exit(1)


if __name__ == '__main__':
    main()
