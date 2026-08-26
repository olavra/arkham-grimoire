/* "Ask Claude about this card" — turns a card record into an English rules
   question and hands it to claude.ai as a pre-filled new conversation.

   Nothing is sent from here and no key is held anywhere: the whole prompt rides
   in the query string of an ordinary link, and the conversation happens on the
   reader's own Claude account. That keeps the app a static site with no
   backend and no per-question cost.

   The control is an <a>, deliberately, rather than a button calling
   window.open. Safari on iOS blocks a popup opened outside a user gesture, and
   the gesture is lost across any await between the tap and the call — so a
   handler that fetched anything first would be blocked on exactly the devices
   this most needs to work on. An anchor is never blocked, and its href is
   built at render time, when the card is already in hand. */
(function (global) {
  'use strict';

  var esc = Markup.escapeHtml;
  var NEW_CHAT = 'https://claude.ai/new';

  /* Card text is a few hundred characters on all but a handful of records, but
     act and agenda backs and investigator reverses run long. Each block is
     clipped so one outlier cannot push the URL past what a browser — or
     whatever hands it to the Claude app on a phone — will carry. */
  var BLOCK_MAX = 1200;

  var ENTITIES = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
    '&#39;': "'", '&nbsp;': ' ', '&mdash;': '—', '&ndash;': '–', '&hellip;': '…'
  };

  /* ArkhamDB card text carries the small HTML subset FFG uses — <b> on keywords
     like Revelation, <i> on reminder text, <p> between paragraphs. Markup
     renders it for the page; the prompt wants prose, so emphasis becomes its
     Markdown equivalent and the rest is dropped. Shipped as-is the tags reach
     Claude as literal angle brackets to read past. */
  function plain(s) {
    return String(s)
      .replace(/<\s*(b|strong)\s*>([\s\S]*?)<\s*\/\s*\1\s*>/gi, '**$2**')
      .replace(/<\s*(i|em)\s*>([\s\S]*?)<\s*\/\s*\1\s*>/gi, '_$2_')
      .replace(/<\s*br\s*\/?\s*>/gi, '\n')
      .replace(/<\s*\/\s*p\s*>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&[a-z0-9#]+;/gi, function (e) {
        var k = e.toLowerCase();
        return Object.prototype.hasOwnProperty.call(ENTITIES, k) ? ENTITIES[k] : e;
      })
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function clip(s) {
    if (s == null) return '';
    s = plain(s);
    return s.length > BLOCK_MAX ? s.slice(0, BLOCK_MAX).trim() + ' […]' : s;
  }

  /* One "- Field: value" bullet per value. A card text runs to several lines, so
     wrapped lines are indented to keep them inside their own bullet rather than
     reading as new fields. */
  function line(label, value) {
    if (value == null || value === '') return '';
    return '- ' + label + ': ' + String(value).replace(/\n/g, '\n  ') + '\n';
  }

  /* A count per icon rather than a repeated glyph name: "2× Willpower" is what
     a player would say, and it survives the URL round trip as plain text. */
  var SKILLS = [
    ['skill_willpower', 'Willpower'],
    ['skill_intellect', 'Intellect'],
    ['skill_combat',    'Combat'],
    ['skill_agility',   'Agility'],
    ['skill_wild',      'Wild']
  ];

  function skillIcons(card) {
    var parts = [];
    for (var i = 0; i < SKILLS.length; i++) {
      var n = card[SKILLS[i][0]];
      if (n) parts.push(n + '× ' + SKILLS[i][1]);
    }
    return parts.join(', ');
  }

  /* ArkhamDB stores "X" costs and unlevelled cards as negatives. Printing the
     raw number would state something false about the card, so a value that
     isn't a plain printed number is left out entirely — the ArkhamDB link at
     the foot of the prompt is the authority for anything omitted here. */
  function printed(n) {
    return typeof n === 'number' && n >= 0 ? String(n) : null;
  }

  /* Only the stat lines the card actually carries: an enemy has no shroud and a
     location has no fight value, and a blank row is one more thing to read
     past. `health` covers both asset/investigator health and enemy health,
     which is how ArkhamDB stores it. */
  function statBlock(card) {
    return '' +
      line('Cost', printed(card.cost)) +
      line('Level', printed(card.xp)) +
      line('Slot', card.slot) +
      line('Skill icons', skillIcons(card)) +
      /* An enemy printed "5 per investigator" carries health 5 plus a flag.
         Emitting the bare 5 would state a different enemy than the one on the
         table, so the flag rides along with the number. */
      line('Health', card.health == null ? null :
        card.health + (card.health_per_investigator ? ' per investigator' : '')) +
      line('Sanity', card.sanity) +
      line('Fight', card.enemy_fight) +
      line('Evade', card.enemy_evade) +
      line('Damage dealt', card.enemy_damage) +
      line('Horror dealt', card.enemy_horror) +
      line('Shroud', card.shroud) +
      line('Clues', card.clues) +
      line('Doom', card.doom) +
      line('Stage', card.stage) +
      line('Victory', card.victory);
  }

  /* The reverse, however ArkhamDB happens to model it — printed back text on
     the record itself, or a linked card filed separately. Faces.linked already
     hands back the [token] source form for the nested shape. */
  function reverseBlock(card) {
    var lc = Faces.linked(card);
    var name = card.back_name || (lc && lc.name) || '';
    var type = lc && lc.type_name ? ' (' + lc.type_name + ')' : '';
    var text = card.back_text || (lc && lc.text) || '';

    if (!name && !text) return '';
    /* A named reverse with no printed text is the whole of what the back says —
       the name is the value, not the label. */
    if (!text) return line('Reverse side', name + type);
    return line('Reverse side' + (name ? ' — ' + name + type : type), clip(text));
  }

  function title(card) {
    return card.name + (card.subname ? ' — ' + card.subname : '');
  }

  /* Every printed value the card carries, front and back, as one bullet list.
     Flavour text is the one field left out: it is atmosphere rather than a
     rule, and the URL has a length budget to spend on the text box instead. */
  function promptFor(card) {
    var flags = [];
    if (card.is_unique) flags.push('Unique');
    if (card.permanent) flags.push('Permanent');
    if (card.exceptional) flags.push('Exceptional');
    if (card.myriad) flags.push('Myriad');

    var info = '' +
      line('Name', title(card)) +
      line('Type', card.type_name +
        (card.subtype_name ? ' (' + card.subtype_name + ')' : '')) +
      line('Class', card.faction_name || 'Neutral') +
      line('Traits', card.traits) +
      line('Keywords', flags.join(', ')) +
      statBlock(card) +
      line('Text', clip(card.text)) +
      reverseBlock(card) +
      line('Pack', card.pack_name) +
      line('Card code', card.code) +
      line('ArkhamDB', API.origin + '/card/' + card.code);

    return '' +
      'I have a rules question about this Arkham Horror: The Card Game card:\n' +
      info +
      '\nExplain briefly the card behavior and FAQ.';
  }

  function href(card) {
    return NEW_CHAT + '?q=' + encodeURIComponent(promptFor(card));
  }

  /* Rendered as part of the detail view even though it is fixed to the
     viewport: a route change replaces the view and takes the bubble with it,
     so there is no mount/unmount to keep in step with the router. */
  /* The glyph carries the button on its own, so the label is the accessible
     name and the tooltip rather than visible text: aria-label names it for
     assistive tech, title gives a sighted reader the same words on hover. */
  function bubbleHtml(card) {
    if (!card) return '';
    var label = 'Ask Claude about ' + title(card) + ' — opens claude.ai in a new tab';
    return '' +
      '<a class="ask-claude" href="' + esc(href(card)) + '" ' +
        'target="_blank" rel="noopener noreferrer" ' +
        'title="' + esc(label) + '" aria-label="' + esc(label) + '">' +
        '<svg class="ask-ico" viewBox="43 48.27 506 342.23" aria-hidden="true" focusable="false">' +
          '<g transform="translate(0.000000,445.000000) scale(0.100000,-0.100000)" fill="currentColor">' +
            '<path d="M2825 3963 c-424 -28 -837 -200 -1160 -482 -44 -39 -340 -330 -658 -648 l-577 -578 627 -626 c420 -419 657 -647 716 -691 267 -198 561 -321 892 -374 166 -27 450 -25 619 5 360 63 676 209 945 437 47 40 350 337 674 661 l587 588 -617 616 c-345 343 -656 645 -703 682 -385 296 -863 442 -1345 410z m-847 -654 c6 -64 15 -125 23 -136 23 -38 62 -52 165 -59 154 -11 163 -20 29 -28 -132 -8 -176 -23 -195 -64 -10 -22 -25 -141 -30 -237 l-1 -20 -9 20 c-5 11 -9 49 -10 85 -1 96 -14 149 -44 178 -23 24 -36 27 -158 37 -143 12 -137 19 27 30 136 8 161 33 170 165 7 98 15 154 20 148 2 -2 8 -56 13 -119z m1201 -259 c70 -20 204 -80 225 -101 6 -5 -7 -9 -35 -9 -168 -1 -369 -101 -486 -243 -265 -321 -160 -815 212 -998 107 -52 190 -72 304 -72 l95 0 -27 -23 c-84 -72 -245 -142 -377 -163 -327 -53 -661 99 -835 382 -183 298 -157 680 65 954 121 150 317 263 508 293 90 14 266 4 351 -20z m1296 -670 c8 -139 18 -180 51 -220 45 -53 73 -61 267 -75 98 -8 181 -16 183 -18 2 -2 -76 -9 -174 -16 -283 -20 -313 -46 -326 -281 -8 -135 -17 -212 -24 -206 -3 3 -11 82 -17 174 -14 183 -22 211 -77 257 -47 40 -58 42 -254 56 -198 14 -194 22 14 34 147 8 195 18 238 50 52 40 64 80 79 268 8 95 15 174 16 177 4 15 17 -99 24 -200z m-551 -782 c10 -154 23 -166 181 -175 58 -3 105 -9 105 -13 0 -4 -46 -11 -102 -15 -107 -7 -150 -21 -168 -55 -5 -10 -13 -66 -17 -124 -3 -59 -9 -106 -13 -106 -4 0 -10 47 -13 105 -3 57 -11 113 -17 124 -18 35 -61 49 -168 56 -56 4 -102 11 -102 15 0 4 47 10 105 13 159 9 173 22 182 176 3 55 9 101 13 101 4 0 10 -46 14 -102z"/>' +
          '</g>' +
        '</svg>' +
      '</a>';
  }

  global.AskClaude = {
    promptFor: promptFor,
    href: href,
    bubbleHtml: bubbleHtml
  };
})(window);
