/* ArkhamDB API client — https://arkhamdb.com/api/doc */
(function (global) {
  'use strict';

  /* ArkhamDB serves each translation from its own subdomain — there is no
     locale query parameter, `?_locale=es` is answered in English. Card scans
     under /bundles/cards/ are byte-identical on every subdomain, so images stay
     pinned to the canonical host: switching language then costs one JSON
     request, not a re-download of the art. */
  var CANON = 'https://arkhamdb.com';
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

  function known(code) {
    for (var i = 0; i < LOCALES.length; i++) if (LOCALES[i].code === code) return true;
    return false;
  }

  function originFor(code) {
    return code === 'en' ? CANON : 'https://' + code + '.arkhamdb.com';
  }

  /* Private browsing can make localStorage throw on read as well as write. */
  function stored() {
    try { return localStorage.getItem(STORE_KEY); } catch (e) { return null; }
  }

  var saved = stored();
  var locale = known(saved) ? saved : DEFAULT_LOCALE;
  var ORIGIN = originFor(locale);
  var BASE = ORIGIN + '/api/public';

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
        if (!res.ok) throw new Error('ArkhamDB responded ' + res.status + ' for ' + url);
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

  /* No /cycles/ request: that endpoint has been answering 500 for a long time,
     and an error page carries no Access-Control-Allow-Origin, so the browser
     reported every call as a CORS failure in the console. Packs only carry a
     cycle_position, never a cycle name, so the cycle headings come from the
     static table in app.js instead.  */

  /* ArkhamDB files a "Books" pack in the Promotional cycle that holds no cards
     of its own: the novella cards live under each novella's pack. It would be
     an empty tile in the catalogue and a dead row in the pack picker. It cannot
     be caught by an empty card count, which the reprint boxes share. */
  var EMPTY_PACKS = { books: true };

  /* Packs, newest cycle last. */
  function getPacks() {
    if (cache.packs) return Promise.resolve(cache.packs);
    var g = gen;
    return getJSON(BASE + '/packs/').then(function (packs) {
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

  /* Cards for one pack, or the whole collection when packCode is '_all'
     (encounter=1 includes encounter-deck cards, not just player cards).
     Default order is by set — packs in release order, cards by their number
     inside the pack. */
  function getCards(packCode) {
    if (cache.cards[packCode]) return Promise.resolve(cache.cards[packCode]);
    var url = packCode === '_all'
      ? BASE + '/cards/?encounter=1'
      : BASE + '/cards/' + encodeURIComponent(packCode);
    var g = gen;
    return Promise.all([getJSON(url), packRank()]).then(function (res) {
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

  /* A single card. Served from whatever pack is already loaded when possible. */
  function getCard(code) {
    if (cache.byCode[code]) return Promise.resolve(cache.byCode[code]);
    var g = gen;
    return getJSON(BASE + '/card/' + encodeURIComponent(code)).then(function (card) {
      return fresh(g) ? remember(card) : card;
    });
  }

  /* Whatever is already on the heap for a code, without asking for it. Callers
     that can do without an answer use this rather than firing a request. */
  function cached(code) { return cache.byCode[code] || null; }

  /* The endpoint getCard would hit — shown on the detail page for debugging. */
  function cardUrl(code) {
    return BASE + '/card/' + encodeURIComponent(code);
  }

  /* Art is the same file on every subdomain — always the canonical one, so a
     language switch keeps every image already in the browser cache. */
  function imageUrl(src) {
    if (!src) return null;
    return /^https?:/.test(src) ? src : CANON + src;
  }

  /* Every cached payload is locale-bound, so switching language empties the lot
     — including requests still in the air, whose answers are in the old
     language. Returns false when nothing changed, so the caller can skip the
     re-render. */
  function setLocale(code) {
    if (!known(code) || code === locale) return false;
    locale = code;
    gen++;
    ORIGIN = originFor(code);
    BASE = ORIGIN + '/api/public';
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
