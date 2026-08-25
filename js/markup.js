/* Renders ArkhamDB card text: [token] icons + the small HTML subset FFG uses. */
(function (global) {
  'use strict';

  /* ArkhamDB [token] -> [icon-font class, colour class, tooltip].
     The classes come from css/arkham-icons.css, which mirrors ArkhamDB's own
     naming; docs/icons.md is the full index. */
  var ICONS = {
    action:       ['action',       'action',    'Action'],
    reaction:     ['reaction',     'reaction',  'Reaction'],
    free:         ['fast',         'fast',      'Fast'],
    fast:         ['fast',         'fast',      'Fast'],
    lightning:    ['fast',         'fast',      'Fast'],

    willpower:    ['willpower',    'willpower', 'Willpower'],
    will:         ['willpower',    'willpower', 'Willpower'],
    intellect:    ['intellect',    'intellect', 'Intellect'],
    lore:         ['intellect',    'intellect', 'Intellect'],
    combat:       ['combat',       'combat',    'Combat'],
    strength:     ['combat',       'combat',    'Combat'],
    agility:      ['agility',      'agility',   'Agility'],
    wild:         ['wild',         'wild',      'Wild'],

    guardian:     ['guardian',     'guardian',  'Guardian'],
    seeker:       ['seeker',       'seeker',    'Seeker'],
    rogue:        ['rogue',        'rogue',     'Rogue'],
    mystic:       ['mystic',       'mystic',    'Mystic'],
    survivor:     ['survivor',     'survivor',  'Survivor'],

    skull:        ['skull',        'token',     'Skull'],
    cultist:      ['cultist',      'token',     'Cultist'],
    tablet:       ['tablet',       'token',     'Tablet'],
    elder_thing:  ['elder_thing',  'token',     'Elder Thing'],
    elder_sign:   ['elder_sign',   'wild',      'Elder Sign'],
    eldersign:    ['elder_sign',   'wild',      'Elder Sign'],
    auto_fail:    ['auto_fail',    'combat',    'Auto-fail'],
    bless:        ['bless',        'bless',     'Bless'],
    curse:        ['curse',        'curse',     'Curse'],
    frost:        ['frost',        'frost',     'Frost'],
    null:         ['null',         'token',     'Null'],

    seal_a:       ['seal_a',       'curse',     'Seal A'],
    seal_b:       ['seal_b',       'curse',     'Seal B'],
    seal_c:       ['seal_c',       'curse',     'Seal C'],
    seal_d:       ['seal_d',       'curse',     'Seal D'],
    seal_e:       ['seal_e',       'curse',     'Seal E'],

    unique:       ['unique',       'unique',    'Unique'],
    per_investigator: ['per_investigator', '',  'Per investigator']
  };

  /* No glyph in the font, but a standalone drawing exists in img/icons/ —
     css/style.css masks the file and tints it, so these behave like glyphs. */
  var SVG_ICONS = {
    health: 'Health',
    sanity: 'Sanity'
  };

  /* No glyph and no drawing, so these stay as small lettered tags. */
  var TEXT_ICONS = {
    neutral: 'Neutral',
    mythos:  'Mythos'
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function icon(token) {
    var key = token.toLowerCase();
    var def = ICONS[key];

    if (def) {
      return '<span class="ah icon-' + def[0] + (def[1] ? ' color-' + def[1] : '') +
        '" role="img" aria-label="' + escapeHtml(def[2]) +
        '" title="' + escapeHtml(def[2]) + '"></span>';
    }

    if (SVG_ICONS[key]) return iconHtml(key, key, SVG_ICONS[key], 'ah');

    /* No glyph in the font — show a readable tag rather than leaking raw
       [brackets] into the text. */
    var label = TEXT_ICONS[key] || key.replace(/_/g, ' ');
    return '<span class="ah ah-text" title="' + escapeHtml(label) + '">' +
      escapeHtml(label.toUpperCase()) + '</span>';
  }

  /* Escape everything, then re-open only the tags FFG's card text uses. */
  function reopenTags(html) {
    return html.replace(
      /&lt;(\/?)(b|i|em|strong|u|cite|small)&gt;/gi,
      function (_, slash, tag) { return '<' + slash + tag.toLowerCase() + '>'; }
    );
  }

  /* Card text -> HTML paragraphs. */
  function renderText(raw) {
    if (!raw) return '';
    var html = reopenTags(escapeHtml(raw));
    html = html.replace(/\[([a-z_0-9]+)\]/gi, function (_, token) { return icon(token); });
    return html
      .split(/\n+/)
      .filter(function (line) { return line.trim() !== ''; })
      .map(function (line) { return '<p>' + line + '</p>'; })
      .join('');
  }

  /* Same, but inline (no paragraph wrapping) — used for names and traits. */
  function renderInline(raw) {
    if (!raw) return '';
    return reopenTags(escapeHtml(raw))
      .replace(/\[([a-z_0-9]+)\]/gi, function (_, token) { return icon(token); })
      .replace(/\n+/g, ' ');
  }

  var FACTIONS = ['guardian', 'seeker', 'rogue', 'mystic', 'survivor', 'neutral', 'mythos'];

  /* Factions without a glyph fall back to the coloured dot the tiles already use. */
  var GLYPH_FACTIONS = ['guardian', 'seeker', 'rogue', 'mystic', 'survivor'];

  function factionClass(code) {
    return FACTIONS.indexOf(code) !== -1 ? code : 'neutral';
  }

  function hasFactionIcon(code) {
    return GLYPH_FACTIONS.indexOf(code) !== -1;
  }

  /* Direct icon span, for chrome the API markup does not cover. Font glyph by
     default; the SVG_ICONS names get the masked-file classes instead. */
  function iconHtml(name, colour, label, extra) {
    var cls = SVG_ICONS[name] ? 'ah-svg ah-svg-' + name : 'icon-' + name;
    return '<span class="' + (extra ? extra + ' ' : '') + cls +
      (colour ? ' color-' + colour : '') + '"' +
      (label ? ' role="img" aria-label="' + escapeHtml(label) + '" title="' +
        escapeHtml(label) + '"' : ' aria-hidden="true"') + '></span>';
  }

  global.Markup = {
    escapeHtml: escapeHtml,
    renderText: renderText,
    renderInline: renderInline,
    factionClass: factionClass,
    hasFactionIcon: hasFactionIcon,
    iconHtml: iconHtml
  };
})(window);
