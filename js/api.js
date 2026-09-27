/* Card data client — our own database under /db/, built by scripts/build-data.py.

   This used to call arkhamdb.com/api/public directly. The endpoints it replaces
   are still visible in the paths, because the build emits the same shapes:

     /api/public/packs/            -> /db/<locale>/packs.json
     /api/public/cards/?encounter=1 -> /db/<locale>/cards/all.json
     /api/public/cards/<pack>      -> /db/<locale>/cards/<pack>.json
     /api/public/card/<code>       -> resolved from all.json; see getCard

   What that buys, beyond not depending on someone else's uptime: the cards
   ArkhamDB does not serve (Children of Blood), the packs it files wrongly (the
   promo Roland Banks is 98004 of The Dirge of Reason, not a Core Set card), and
   the reissue and reprint boxes it reports as empty. See scripts/build-data.py.

   Card art is a separate question and still comes from ArkhamDB: imagesrc is
   emitted in its /bundles/cards/ form and resolved against the canonical host
   by imageUrl, exactly as before. */
(function (global) {
  'use strict';

  /* The ArkhamDB site, for the outbound links on a card's detail page. It is no
     longer where any data comes from, and locale no longer changes a host --
     only which directory under /db/ is read. */
  var ARKHAMDB = 'https://arkhamdb.com';
  var LOCALES = [
    { code: 'es', label: 'Español' },
    { code: 'en', label: 'English' },
    { code: 'de', label: 'Deutsch' },
    { code: 'fr', label: 'Français' },
    { code: 'it', label: 'Italiano' },
    { code: 'pt', label: 'Português' },
    { code: 'pl', label: 'Polski' },
    { code: 'ru', label: 'Русский' },
    { code: 'uk', label: 'Українська' },
    { code: 'ko', label: '한국어' },
    { code: 'zh', label: '中文' }
  ];
  var DEFAULT_LOCALE = 'es';
  var STORE_KEY = 'ag:locale';

  /* Every locale listed above is built by scripts/build-data.py; adding one
     here without building it would leave the picker with an entry that 404s. */

  function known(code) {
    for (var i = 0; i < LOCALES.length; i++) if (LOCALES[i].code === code) return true;
    return false;
  }

  /* Absolute from the site root: the app runs at / with hash routes, and the
     data sits beside index.html. */
  function baseFor(code) { return '/db/' + code; }

  function siteFor(code) {
    return code === 'en' ? ARKHAMDB : 'https://' + code + '.arkhamdb.com';
  }

  /* Private browsing can make localStorage throw on read as well as write. */
  function stored() {
    try { return localStorage.getItem(STORE_KEY); } catch (e) { return null; }
  }

  var saved = stored();
  var locale = known(saved) ? saved : DEFAULT_LOCALE;
  var BASE = baseFor(locale);
  var ORIGIN = siteFor(locale);

  /* In-memory caches. The "all cards" payload is ~9 MB, far past the
     sessionStorage quota, so everything stays on the heap for the tab. */
  var cache = {
    packs: null,
    cards: Object.create(null), // pack_code -> card[]   ('_all' for the full pool)
    byCode: Object.create(null) // card code -> card
  };
  var inflight = Object.create(null);

  /* Bumped by setLocale. A request that was already in the air when the
     language changed still resolves — this is how its answer is kept out of the
     caches instead of poisoning them with the previous language. */
  var gen = 0;
  function fresh(g) { return g === gen; }

  function getJSON(url) {
    if (inflight[url]) return inflight[url];
    var p = fetch(url, { headers: { Accept: 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error('card database responded ' + res.status + ' for ' + url);
        return res.json();
      })
      .then(function (data) {
        delete inflight[url];
        return data;
      })
      .catch(function (err) {
        delete inflight[url];
        throw err;
      });
    inflight[url] = p;
    return p;
  }

  function remember(card) {
    cache.byCode[card.code] = card;
    return card;
  }

  function index(cards) {
    for (var i = 0; i < cards.length; i++) remember(cards[i]);
    return cards;
  }

  /* Cycle names now ride on each pack as cycle_name, put there by the build
     from the upstream cycles.json — so there is no separate cycle request, and
     no static table to keep in step either. The old /cycles/ endpoint answered
     500 for years, which is what the table in app.js was working around. */

  /* ArkhamDB files a "Books" pack in the Promotional cycle that holds no cards
     of its own: the novella cards live under each novella's pack. It would be
     an empty tile in the catalogue and a dead row in the pack picker. It cannot
     be caught by an empty card count, which the reprint boxes share. */
  var EMPTY_PACKS = { books: true };

  /* Packs, newest cycle last. The build already emits them in this order; the
     sort is kept so the app does not depend on that. */
  function getPacks() {
    if (cache.packs) return Promise.resolve(cache.packs);
    var g = gen;
    return getJSON(BASE + '/packs.json').then(function (packs) {
      var sorted = packs.filter(function (p) {
        return !EMPTY_PACKS[p.code];
      }).sort(function (a, b) {
        return a.cycle_position - b.cycle_position || a.position - b.position;
      });
      if (fresh(g)) cache.packs = sorted;
      return sorted;
    });
  }

  /* pack_code -> release order, taken from the already-sorted pack list. Cards
     carry no cycle_position of their own, so this is the only way to put the
     pool in set order. A pack list that fails to load resolves to null and the
     sort falls back to the pack code. */
  function packRank() {
    return getPacks().then(function (packs) {
      var rank = Object.create(null);
      packs.forEach(function (p, i) { rank[p.code] = i; });
      return rank;
    }).catch(function () { return null; });
  }

  function cardsUrl(packCode) {
    return BASE + '/cards/' + (packCode === '_all' ? 'all' : encodeURIComponent(packCode)) + '.json';
  }

  /* Cards for one pack, or the whole collection when packCode is '_all'.
     Default order is by set — packs in release order, cards by their number
     inside the pack.

     A pack's file holds every card in that product, which is not the same as
     every card whose pack_code is that pack: a Revised Core card and a reprint
     box's contents keep the pack_code of where they were printed. So a card can
     appear in more than one pack file, and its own pack_code is what the sort
     below keys on. */
  function getCards(packCode) {
    if (cache.cards[packCode]) return Promise.resolve(cache.cards[packCode]);
    var g = gen;
    return Promise.all([getJSON(cardsUrl(packCode)), packRank()]).then(function (res) {
      var cards = res[0], rank = res[1];
      cards.sort(function (a, b) {
        if (a.pack_code === b.pack_code) return a.position - b.position;
        /* A pack the list doesn't know about sorts to the end rather than
           colliding with rank 0. */
        var ra = rank && rank[a.pack_code] !== undefined ? rank[a.pack_code] : Infinity;
        var rb = rank && rank[b.pack_code] !== undefined ? rank[b.pack_code] : Infinity;
        return ra === rb ? a.pack_code.localeCompare(b.pack_code) : ra - rb;
      });
      if (fresh(g)) cache.cards[packCode] = index(cards);
      return cards;
    });
  }

  /* A single card. There is no per-card file — 6000 of them per locale is a lot
     of files to deploy for something the full pool already answers — so a code
     that is not on the heap yet is served by loading the pool and indexing it.
     That is one 9 MB request at worst, cached for the tab, and it is only ever
     reached by opening a card link directly; browsing the grid has already
     loaded a pack by then. */
  function getCard(code) {
    if (cache.byCode[code]) return Promise.resolve(cache.byCode[code]);
    var g = gen;
    return getCards('_all').then(function () {
      var card = cache.byCode[code];
      if (!card) throw new Error('no card ' + code + ' in the database');
      return fresh(g) ? card : card;
    });
  }

  /* Whatever is already on the heap for a code, without asking for it. Callers
     that can do without an answer use this rather than firing a request. */
  function cached(code) { return cache.byCode[code] || null; }

  /* The file a card is served from — shown on the detail page for debugging.
     Every card is in the pool; a pack file would need the pack, which the
     caller may not have. */
  function cardUrl(code) {
    return cardsUrl('_all');
  }

  /* Art is still ArkhamDB's, and the same file on every subdomain — always the
     canonical host, so a language switch keeps every image already in the
     browser cache. A card the build added itself carries an absolute or
     site-relative imagesrc and is returned untouched. */
  function imageUrl(src) {
    if (!src) return null;
    if (/^https?:/.test(src)) return src;
    if (src.indexOf('/bundles/') === 0) return ARKHAMDB + src;
    return src;
  }

  /* Every cached payload is locale-bound, so switching language empties the lot
     — including requests still in the air, whose answers are in the old
     language. Returns false when nothing changed, so the caller can skip the
     re-render. */
  function setLocale(code) {
    if (!known(code) || code === locale) return false;
    locale = code;
    gen++;
    BASE = baseFor(code);
    ORIGIN = siteFor(code);
    global.API.origin = ORIGIN;

    cache.packs = null;
    cache.cards = Object.create(null);
    cache.byCode = Object.create(null);
    inflight = Object.create(null);

    try { localStorage.setItem(STORE_KEY, code); } catch (e) { /* private mode */ }
    return true;
  }

  global.API = {
    getPacks: getPacks,
    getCards: getCards,
    getCard: getCard,
    cached: cached,
    cardUrl: cardUrl,
    imageUrl: imageUrl,
    locales: LOCALES,
    getLocale: function () { return locale; },
    setLocale: setLocale,
    origin: ORIGIN
  };
})(window);
