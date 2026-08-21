/* ArkhamDB API client — https://arkhamdb.com/api/doc */
(function (global) {
  'use strict';

  var ORIGIN = 'https://arkhamdb.com';
  var BASE = ORIGIN + '/api/public';

  /* In-memory caches. The "all cards" payload is ~9 MB, far past the
     sessionStorage quota, so everything stays on the heap for the tab. */
  var cache = {
    packs: null,
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

  function index(cards) {
    for (var i = 0; i < cards.length; i++) cache.byCode[cards[i].code] = cards[i];
    return cards;
  }

  /* Packs, newest cycle last. The /cycles/ endpoint currently 500s, so cycle
     grouping is derived from the pack list itself. */
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
    return getJSON(BASE + '/card/' + encodeURIComponent(code)).then(function (card) {
      cache.byCode[card.code] = card;
      return card;
    });
  }

  function imageUrl(src) {
    if (!src) return null;
    return /^https?:/.test(src) ? src : ORIGIN + src;
  }

  global.API = {
    getPacks: getPacks,
    getCards: getCards,
    getCard: getCard,
    imageUrl: imageUrl,
    origin: ORIGIN
  };
})(window);
