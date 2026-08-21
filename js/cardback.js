/* Fallback card backs.
   ArkhamDB only ships a `backimagesrc` for genuinely double-sided cards, so
   everything else falls back to the printed back for its deck. */
(function (global) {
  'use strict';

  var BACKS = {
    player: 'img/player.png',
    encounter: 'img/encounter.png'
  };

  /* Encounter-deck cards carry an encounter set; everything else is a player card
     (weaknesses included — they shuffle into a player deck and share its back). */
  function kindFor(card) {
    return (card.encounter_code || card.faction_code === 'mythos') ? 'encounter' : 'player';
  }

  function backFor(card) {
    return BACKS[kindFor(card)];
  }

  global.CardBack = { backFor: backFor, kindFor: kindFor, srcFor: function (kind) { return BACKS[kind]; } };
})(window);
