/* FFG product code -> pack cover art.

   ArkhamDB has no field for the FFG SKU (AHC##), and the cover files in
   img/packs/ are named after it, so the link between an ArkhamDB pack code
   and its cover has to live here. Keyed by ArkhamDB pack `code`.

   Most entries were matched on pack name; the ones name-matching cannot
   reach are noted inline. To add a cover: drop the PNG in img/packs/ under
   its FFG name and add a row below. */
(function (global) {
  'use strict';

  var DIR = 'img/packs/';

  /* pack code -> [FFG code, file name in img/packs/] */
  var COVERS = {
    'core': ['AHC01', 'AHC01 - Arkham Horror - The Card Game.png'],                 // AHC01 predates the "Core Set" rename
    'rcore': ['AHC60', 'AHC60 - Revised Core Set.png'],

    'dwl': ['AHC02', 'AHC02 - The Dunwich Legacy.png'],
    'dwlp': ['AHC65', 'AHC65 - The Dunwich Legacy Investigator Expansion.png'],
    'dwlc': ['AHC66', 'AHC66 - The Dunwich Legacy Campaign Expansion.png'],
    'tmm': ['AHC03', 'AHC03 - The Miskatonic Museum.png'],
    'tece': ['AHC04', 'AHC04 - The Essex County Express.png'],
    'bota': ['AHC05', 'AHC05 - Blood on the Altar.png'],
    'uau': ['AHC06', 'AHC06 - Undimensioned and Unseen.png'],
    'wda': ['AHC07', 'AHC07 - Where Doom Awaits.png'],
    'litas': ['AHC08', 'AHC08 - Lost in Time and Space.png'],

    'ptc': ['AHC11', 'AHC11 - The Path to Carcosa.png'],
    'ptcp': ['AHC67', 'AHC67 - The Path to Carcosa Investigator Expansion.png'],
    'eotp': ['AHC12', 'AHC12 - Echoes of the Past.png'],
    'ptcc': ['AHC68', 'AHC68 - The Path to Carcosa Campaign Expansion.png'],
    'tuo': ['AHC13', 'AHC13 - The Unspeakable Oath.png'],
    'apot': ['AHC14', 'AHC14 - A Phantom of Truth.png'],
    'tpm': ['AHC15', 'AHC15 - The Pallid Mask.png'],
    'bsr': ['AHC16', 'AHC16 - Black Stars Rise.png'],
    'dca': ['AHC17', 'AHC17 - Dim Carcosa.png'],

    'tfa': ['AHC19', 'AHC19 - The Forgotten Age.png'],
    'tfap': ['AHC72', 'AHC72 - The Forgotten Age Investigator Expansion.png'],
    'tfac': ['AHC73', 'AHC73 - The Forgotten Age Campaign Expansion.png'],
    'tof': ['AHC20', 'AHC20 - Threads of Fate.png'],
    'tbb': ['AHC21', 'AHC21 - The Boundary Beyond.png'],
    'hote': ['AHC22', 'AHC22 - Heart of the Elders.png'],
    'tcoa': ['AHC23', 'AHC23 - The City of Archives.png'],
    'tdoy': ['AHC24', 'AHC24 - The Depths of Yoth.png'],
    'sha': ['AHC25', 'AHC25 - Shattered Aeons.png'],

    'tcu': ['AHC29', 'AHC29 - The Circle Undone.png'],
    'tcup': ['AHC74', 'AHC74 - The Circle Undone Investigator Expansion.png'],
    'tcuc': ['AHC75', 'AHC75 - The Circle Undone Campaign Expansion.png'],
    'tsn': ['AHC30', 'AHC30 - The Secret Name.png'],
    'wos': ['AHC31', 'AHC31 - The Wages of Sin.png'],
    'fgg': ['AHC32', 'AHC32 - For the Greater Good.png'],
    'uad': ['AHC33', 'AHC33 - Union and Disillusion.png'],
    'icc': ['AHC34', 'AHC34 - In the Clutches of Chaos.png'],
    'bbt': ['AHC35', 'AHC35 - Before the Black Throne.png'],

    'tde': ['AHC37', 'AHC37 - The Dream-Eaters.png'],
    'tdep': ['AHC78', 'AHC78 - The Dream-Eaters Investigator Expansion.png'],
    'tdec': ['AHC79', 'AHC79 - The Dream-Eaters Campaign Expansion.png'],
    'sfk': ['AHC39', 'AHC39 - The Search for Kadath.png'],
    'tsh': ['AHC40', 'AHC40 - A Thousand Shapes of Horror.png'],
    'dsm': ['AHC41', 'AHC41 - Dark Side of the Moon.png'],
    'pnr': ['AHC42', 'AHC42 - Point of No Return.png'],
    'wgd': ['AHC43', 'AHC43 - Where the Gods Dwell.png'],
    'woc': ['AHC44', 'AHC44 - Weaver of the Cosmos.png'],

    'tic': ['AHC52', 'AHC52 - The Innsmouth Conspiracy.png'],
    'ticp': ['AHC81', 'AHC81 - The Innsmouth Conspiracy Investigator Expansion.png'],
    'itd': ['AHC53', 'AHC53 - In Too Deep.png'],
    'ticc': ['AHC82', 'AHC82 - The Innsmouth Conspiracy Campaign Expansion.png'],
    'def': ['AHC54', 'AHC54 - Devil Reef.png'],
    'hhg': ['AHC55', 'AHC55 - Horror in High Gear.png'],
    'lif': ['AHC56', 'AHC56 - A Light in the Fog.png'],
    'lod': ['AHC57', 'AHC57 - The Lair of Dagon.png'],
    'itm': ['AHC58', 'AHC58 - Into the Maelstrom.png'],

    'eoep': ['AHC63', 'AHC63 - Edge of the Earth Investigator Expansion.png'],
    'eoec': ['AHC64', 'AHC64 - Edge of the Earth Campaign Expansion.png'],

    'tskp': ['AHC69', 'AHC69 - The Scarlet Keys Investigator Expansion.png'],
    'tskc': ['AHC70', 'AHC70 - The Scarlet Keys Campaign Expansion.png'],

    'fhvp': ['AHC76', 'AHC76 - The Feast of Hemlock Vale Investigator Expansion.png'],
    'fhvc': ['AHC77', 'AHC77 - The Feast of Hemlock Vale Campaign Expansion.png'],

    'tdcp': ['AHC83', 'AHC83 - The Drowned City Investigator Expansion.png'],
    'tdcc': ['AHC84', 'AHC84 - The Drowned City Campaign Expansion.png'],

    'core_2026': ['AHC100', 'AHC100 - Arkham Horror - The Card Game Core Set.png'], // 2026 reprint, sold as plain "Arkham Horror: The Card Game"

    'rtnotz': ['AHC26', 'AHC26 - Return to the Night of the Zealot.png'],
    'rtdwl': ['AHC28', 'AHC28 - Return to the Dunwich Legacy.png'],
    'rtptc': ['AHC36', 'AHC36 - Return to the Path to Carcosa.png'],
    'rttfa': ['AHC46', 'AHC46 - Return to the Forgotten Age.png'],
    'rttcu': ['AHC61', 'AHC61 - Return to the Circle Undone.png'],

    'nat': ['AHC47', 'AHC47 - Nathaniel Cho Investigator Starter Deck.png'],        // sold as "<name> Investigator Starter Deck"
    'har': ['AHC48', 'AHC48 - Harvey Walters Investigator Starter Deck.png'],
    'win': ['AHC49', 'AHC49 - Winifred Habbamock Investigator Starter Deck.png'],
    'jac': ['AHC50', 'AHC50 - Jacqueline Fine Investigator Starter Deck.png'],
    'ste': ['AHC51', 'AHC51 - Stella Clark Investigator Starter Deck.png'],

    'tom': ['AHC101', 'AHC101 - Tommy Muldoon Investigator Deck.png'],              // sold as "<name> Investigator Deck"
    'car': ['AHC102', 'AHC102 - Carolyn Fern Investigator Deck.png'],
    'and': ['AHC103', 'AHC103 - Andre Patel Investigator Deck.png'],
    'mar': ['AHC104', 'AHC104 - Marie Lambeau Investigator Deck.png'],
    'mig': ['AHC105', 'AHC105 - Miguel de la Cruz Investigator Deck.png'],

    'cotr': ['AHC09', 'AHC09 - Curse of the Rougarou.png'],
    'coh': ['AHC10', 'AHC10 - Carnevale of Horrors.png'],
    'lol': ['AHC18', 'AHC18 - The Labyrinths of Lunacy.png'],
    'guardians': ['AHC27', 'AHC27 - Guardians of the Abyss.png'],
    'hotel': ['AHC38', 'AHC38 - Murder at the Excelsior Hotel.png'],
    'blob': ['AHC45', 'AHC45 - The Blob That Ate Everything.png'],
    'wog': ['AHC59', 'AHC59 - War of the Outer Gods.png'],
    'mtt': ['AHC62', 'AHC62 - Machinations Through Time.png'],
    'fof': ['AHC71', 'AHC71 - Fortune and Folly.png'],
    'tmg': ['AHC80', 'AHC80 - The Midwinter Gala.png'],
    'film_fatale': ['AHC85', 'AHC85 - Film Fatale.png']
  };

  /* Covers on disk with no ArkhamDB pack to hang them on — not carried by the
     API yet, or never carried at all:
       AHC106   Children of Blood
       PAHC01   Barkham Horror - The Meddling of Meowlathotep
     Packs with no cover art on disk (novellas, parallel-investigator side
     stories, promos, Blob ELSE!) fall through to url() returning null. */

  /* 'img/packs/AHC01%20-%20….png', or null when the pack has no art. */
  function url(packCode) {
    var row = COVERS[packCode];
    return row ? DIR + encodeURIComponent(row[1]) : null;
  }

  /* FFG product code, e.g. 'AHC60' for 'rcore'. */
  function ffgCode(packCode) {
    var row = COVERS[packCode];
    return row ? row[0] : null;
  }

  global.PackCovers = { url: url, ffgCode: ffgCode, map: COVERS };
})(window);
