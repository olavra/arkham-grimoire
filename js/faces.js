/* Card faces — what belongs on the reverse of a card, and which cards are only
   ever a reverse.

   ArkhamDB models a physical double-sided card two different ways:

     · one record, two scans — `double_sided` with a `backimagesrc`;
     · two records — the front carries `linked_to_code` (and a nested
       `linked_card`), while the reverse is filed as a card in its own right and
       flagged `hidden` so it stays out of deck building.

   The second shape is why 90023, Elspeth Baudin, reports `double_sided: false`
   yet links to 90023b: one card on the table, two card types, two records. Same
   for 11068a, an asset whose back is the investigator 11068b. So a linked card
   is drawn as the back face wherever a back face is drawn, and the hidden half
   is labelled as a reverse rather than passed off as a card of its own.

   The link is only ever followed forwards, the direction the API states it in.
   A hidden card says that it is a reverse and stops there; it does not go
   looking for whichever card points at it. Nothing here is keyed on a card
   code — every pairing comes from `linked_to_code` and `hidden`. */
(function (global) {
  'use strict';

  /* A nested `linked_card` is serialised in ArkhamDB's own display form: its
     `text` arrives as finished HTML — `<p>…<span class="icon-elder_sign">` —
     where a top-level card's `text` is the [token] source Markup renders from.
     Handed to the renderer as-is it gets escaped, and the reverse shows its
     paragraph tags as words. `real_text` carries the source on the nested
     record, and `text` is the only display field the two shapes disagree on.

     A standalone copy of the same card is better still — the `_all` pool
     carries every hidden card — so it wins when one has been loaded. */
  var sourced = Object.create(null);            // code -> converted copy

  function asSource(lc) {
    if (lc.real_text == null || lc.real_text === lc.text) return lc;
    if (sourced[lc.code]) return sourced[lc.code];

    var copy = {};
    for (var k in lc) copy[k] = lc[k];
    copy.text = lc.real_text;
    sourced[lc.code] = copy;
    return copy;
  }

  function linked(card) {
    var lc = (card && card.linked_card) || null;
    if (!lc) return null;
    return API.cached(lc.code) || asSource(lc);
  }

  /* One sheet, two printed sides — however the API happens to say so. A hidden
     card counts: being the reverse of something is the whole reason it is
     hidden, so it has a front even before we know which card that is. */
  function twoSided(card) {
    return !!(card && (card.double_sided || card.backimagesrc ||
                       card.linked_to_code || card.hidden));
  }

  function isHidden(card) { return !!(card && card.hidden); }

  /* 218 cards in the pool have no scan on ArkhamDB, and the ones it does hold
     occasionally answer 500. Both are covered by a hand-added file at
     img/cards/<code>.png. Nothing can say in advance whether that file is there,
     so the URL is always offered as the next candidate and the miss is caught
     where the face is drawn — which makes dropping a PNG into the folder the
     whole of adding a card's art, with no list to keep in step. */
  var LOCAL = 'img/cards/';

  function localArt(code) { return code ? LOCAL + code + '.png' : null; }

  /* A card's front, as a candidate chain: the API's scan, then the local file. */
  function art(card) {
    var remote = API.imageUrl(card && card.imagesrc);
    var local = localArt(card && card.code);
    return { src: remote || local, fallback: remote ? local : null };
  }

  /* The reverse face — this card's own back scan, or the card it links to.

       src      the printed back, from this card's own scan or the linked card's
       fallback the next candidate if src fails — see `art`
       name     what the reverse is called, if it is named at all
       real     src is a real scan of the back, not a generic deck back
       missing  the card has a reverse and there is no candidate image for it at
                all, which is the reason the generic deck back is not simply
                substituted: on a card whose other side is printed art, an
                encounter back is a lie rather than a stand-in. */
  function back(card) {
    var lc = linked(card);
    var own = API.imageUrl(card && card.backimagesrc);
    var lcArt = lc ? art(lc) : null;
    var src = own || (lcArt && lcArt.src) || null;

    return {
      card: lc,
      code: (card && card.linked_to_code) || null,
      name: (lc && lc.name) || (card && card.back_name) || null,
      src: src,
      fallback: own ? null : (lcArt && lcArt.fallback) || null,
      real: !!src,
      missing: !src && twoSided(card)
    };
  }

  global.Faces = {
    art: art,
    linked: linked,
    twoSided: twoSided,
    isHidden: isHidden,
    back: back
  };
})(window);
