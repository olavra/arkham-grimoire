/* ArkhamDB API client — https://arkhamdb.com/api/doc */
(function (global) {
  'use strict';

  var ORIGIN = 'https://arkhamdb.com';
  var BASE = ORIGIN + '/api/public';

  /* In-memory caches. The "all cards" payload is ~9 MB, far past the
     sessionStorage quota, so everything stays on the heap for the tab. */
  var cache = {
    packs: null,
    cycles: undefined,          // position -> cycle name; null once /cycles/ has failed
    cards: Object.create(null), // pack_code -> card[]   ('_all' for the full pool)
    byCode: Object.create(null) // card code -> card
  };
  var inflight = Object.create(null);

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

  /* Cycle names, keyed by cycle position. This endpoint has been answering 500
     for a while and packs only carry a cycle_position, never a cycle name, so
     the caller keeps a static table to fall back on. A failure resolves to null
     instead of rejecting — a missing heading must not take the pack list down. */
  function getCycles() {
    if (cache.cycles !== undefined) return Promise.resolve(cache.cycles);
    return getJSON(BASE + '/cycles/').then(function (cycles) {
      var byPosition = Object.create(null);
      cycles.forEach(function (c) {
        if (c && c.position !== undefined && c.name) byPosition[c.position] = c.name;
      });
      cache.cycles = byPosition;
      return byPosition;
    }).catch(function () {
      cache.cycles = null;
      return null;
    });
  }

  /* Packs, newest cycle last. */
  function getPacks() {
    if (cache.packs) return Promise.resolve(cache.packs);
    return getJSON(BASE + '/packs/').then(function (packs) {
      cache.packs = packs.slice().sort(function (a, b) {
        return a.cycle_position - b.cycle_position || a.position - b.position;
      });
      return cache.packs;
    });
  }

  /* Cards for one pack, or the whole collection when packCode is '_all'
     (encounter=1 includes encounter-deck cards, not just player cards). */
  function getCards(packCode) {
    if (cache.cards[packCode]) return Promise.resolve(cache.cards[packCode]);
    var url = packCode === '_all'
      ? BASE + '/cards/?encounter=1'
      : BASE + '/cards/' + encodeURIComponent(packCode);
    return getJSON(url).then(function (cards) {
      cards.sort(function (a, b) {
        return a.pack_code === b.pack_code
          ? a.position - b.position
          : a.pack_code.localeCompare(b.pack_code);
      });
      cache.cards[packCode] = index(cards);
      return cards;
    });
  }

  /* A single card. Served from whatever pack is already loaded when possible. */
  function getCard(code) {
    if (cache.byCode[code]) return Promise.resolve(cache.byCode[code]);
    return getJSON(BASE + '/card/' + encodeURIComponent(code)).then(remember);
  }

  /* Whatever is already on the heap for a code, without asking for it. Callers
     that can do without an answer use this rather than firing a request. */
  function cached(code) { return cache.byCode[code] || null; }

  /* The endpoint getCard would hit — shown on the detail page for debugging. */
  function cardUrl(code) {
    return BASE + '/card/' + encodeURIComponent(code);
  }

  function imageUrl(src) {
    if (!src) return null;
    return /^https?:/.test(src) ? src : ORIGIN + src;
  }

  global.API = {
    getPacks: getPacks,
    getCycles: getCycles,
    getCards: getCards,
    getCard: getCard,
    cached: cached,
    cardUrl: cardUrl,
    imageUrl: imageUrl,
    origin: ORIGIN
  };
})(window);
