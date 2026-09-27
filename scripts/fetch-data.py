"""Bring in the upstream card data: Kamalisk/arkhamdb-json-data.

Run from the project root:

    python scripts/fetch-data.py            # update to upstream's latest
    python scripts/fetch-data.py --pin      # re-checkout the SHA in the lockfile
    python scripts/fetch-data.py --status    # say what is there, fetch nothing

Upstream lands in data/database-json/, which is generated and gitignored: nothing in
there is ever edited. Our own changes live in data/database-overlay/ and are applied by
build-data.py, so an upstream update can never conflict with them -- there is
only ever one copy of each upstream file, and it is theirs.

What is committed instead is data/upstream.lock: the commit the last build used.
That is what makes a build reproducible without carrying 33 MB of someone else's
repository in our history, and it is the reason this is a fetch script rather
than a submodule. A submodule would pin the same SHA but drag its checkout into
every clone of this repo, and a fork -- the other obvious option -- would put
our edits in the same files as theirs and turn every update into a merge.

--pin is the other direction: check out whatever the lockfile already names,
for reproducing an older build or undoing an update that broke something.

The clone is shallow (--depth 1). History is of no use to us here, and it is
the difference between a 3 MB fetch and a 33 MB one.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST = os.path.join(ROOT, 'data', 'database-json')
LOCK = os.path.join(ROOT, 'data', 'upstream.lock')

REMOTE = 'https://github.com/Kamalisk/arkhamdb-json-data.git'
BRANCH = 'master'

# Enough of the tree to tell a real checkout from a half-finished one.
EXPECTED = ('packs.json', 'cycles.json', 'pack', 'schema', 'translations')


def run(*args, **kw):
    """git, with its output passed through. Raises on a non-zero exit."""
    cwd = kw.pop('cwd', None)
    capture = kw.pop('capture', False)
    proc = subprocess.run(('git',) + args, cwd=cwd, check=False,
                          stdout=subprocess.PIPE if capture else None,
                          stderr=subprocess.STDOUT if capture else None,
                          text=True)
    if proc.returncode != 0:
        if capture and proc.stdout:
            sys.stderr.write(proc.stdout)
        raise SystemExit('git %s failed (%d)' % (' '.join(args), proc.returncode))
    return (proc.stdout or '').strip()


def complete(path):
    """A checkout with every part we expect present."""
    return all(os.path.exists(os.path.join(path, name)) for name in EXPECTED)


def head(path):
    return run('rev-parse', 'HEAD', cwd=path, capture=True)


def read_lock():
    try:
        with open(LOCK, encoding='utf-8') as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def write_lock(sha, subject):
    tmp = LOCK + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        json.dump({
            'remote': REMOTE,
            'branch': BRANCH,
            'commit': sha,
            'subject': subject,
            'fetched': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        }, fh, indent=2, sort_keys=True)
        fh.write('\n')
    os.replace(tmp, LOCK)


def clone():
    """Fresh shallow clone. Anything already at DEST is replaced: it is
    generated, so there is nothing there worth keeping."""
    if os.path.isdir(DEST):
        shutil.rmtree(DEST, ignore_errors=True)
    os.makedirs(os.path.dirname(DEST), exist_ok=True)
    print('cloning %s (%s, shallow)...' % (REMOTE, BRANCH))
    run('clone', '--depth', '1', '--branch', BRANCH, '--quiet', REMOTE, DEST)


def update():
    """Fast-forward an existing shallow checkout to upstream's tip. Any local
    change is discarded -- see the module docstring: this tree is not ours."""
    print('fetching %s...' % BRANCH)
    run('fetch', '--depth', '1', '--quiet', 'origin', BRANCH, cwd=DEST)
    run('reset', '--hard', '--quiet', 'FETCH_HEAD', cwd=DEST)
    run('clean', '-qfd', cwd=DEST)


def pin(sha):
    """Check out the exact commit the lockfile names. A shallow clone does not
    have it, so it is fetched on its own first."""
    print('pinning to %s...' % sha[:12])
    run('fetch', '--depth', '1', '--quiet', 'origin', sha, cwd=DEST)
    run('checkout', '--quiet', sha, cwd=DEST)


def describe(sha):
    return run('log', '-1', '--format=%s', sha, cwd=DEST, capture=True)


def counts():
    """A shape report, so a truncated checkout is obvious before a build
    silently emits half a card pool."""
    import glob
    packs = cards = 0
    try:
        with open(os.path.join(DEST, 'packs.json'), encoding='utf-8') as fh:
            packs = len(json.load(fh))
    except (OSError, ValueError):
        pass
    files = glob.glob(os.path.join(DEST, 'pack', '*', '*.json'))
    for path in files:
        try:
            with open(path, encoding='utf-8') as fh:
                cards += len(json.load(fh))
        except (OSError, ValueError):
            pass
    locales = []
    tdir = os.path.join(DEST, 'translations')
    if os.path.isdir(tdir):
        locales = sorted(n for n in os.listdir(tdir)
                         if os.path.isdir(os.path.join(tdir, n)))
    return packs, len(files), cards, locales


def report():
    lock = read_lock()
    print('lockfile: %s' % (LOCK if lock else '(none yet)'))
    if lock:
        print('  commit  %s' % lock.get('commit'))
        print('  subject %s' % lock.get('subject'))
        print('  fetched %s' % lock.get('fetched'))
    if not complete(DEST):
        print('checkout: missing or incomplete at data/database-json/')
        return
    sha = head(DEST)
    packs, files, cards, locales = counts()
    print('checkout: %s' % sha)
    print('  %d packs, %d pack files, %d cards, %d locales (%s)'
          % (packs, files, cards, len(locales), ' '.join(locales)))
    if lock and lock.get('commit') != sha:
        print('  NOTE: checkout and lockfile disagree -- '
              'run with --pin to go back, or without to record this one')


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--pin', action='store_true',
                    help='check out the commit named in the lockfile')
    ap.add_argument('--status', action='store_true',
                    help='report what is present and fetch nothing')
    args = ap.parse_args()

    if args.status:
        report()
        return

    if not shutil.which('git'):
        raise SystemExit('git is not on PATH')

    lock = read_lock()

    if args.pin:
        if not lock or not lock.get('commit'):
            raise SystemExit('nothing to pin to: data/upstream.lock is missing')
        if not complete(DEST):
            clone()
        pin(lock['commit'])
        sha = head(DEST)
        print('at %s -- lockfile unchanged' % sha[:12])
    else:
        before = head(DEST) if complete(DEST) else None
        if before is None:
            clone()
        else:
            update()
        sha = head(DEST)
        subject = describe(sha)
        write_lock(sha, subject)
        if before is None:
            print('cloned at %s' % sha[:12])
        elif before == sha:
            print('already up to date at %s' % sha[:12])
        else:
            print('updated %s -> %s' % (before[:12], sha[:12]))
        print('  %s' % subject)

    packs, files, cards, locales = counts()
    print('%d packs, %d pack files, %d cards, %d locales' % (packs, files, cards, len(locales)))
    if not complete(DEST):
        raise SystemExit('checkout looks incomplete -- expected %s'
                         % ', '.join(EXPECTED))


if __name__ == '__main__':
    main()
