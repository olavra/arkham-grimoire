/* Renders ArkhamDB card text: [token] icons + the small HTML subset FFG uses. */
(function (global) {
  'use strict';

  /* token -> [glyph, css modifier, tooltip] */
  var ICONS = {
    action:       ['➜',           'action',   'Action'],
    reaction:     ['↩',           'reaction', 'Reaction'],
    free:         ['⚡',          'fast',     'Fast'],
    fast:         ['⚡',          'fast',     'Fast'],

    willpower:    ['W',           'mystic',   'Willpower'],
    intellect:    ['I',           'seeker',   'Intellect'],
    combat:       ['C',           'survivor', 'Combat'],
    agility:      ['A',           'guardian', 'Agility'],
    wild:         ['★',           'skill',    'Wild'],

    guardian:     ['G',           'guardian', 'Guardian'],
    seeker:       ['S',           'seeker',   'Seeker'],
    rogue:        ['R',           'rogue',    'Rogue'],
    mystic:       ['M',           'mystic',   'Mystic'],
    survivor:     ['V',           'survivor', 'Survivor'],
    neutral:      ['N',           '',         'Neutral'],
    mythos:       ['◈',           'token',    'Mythos'],

    skull:        ['☠',           'token',    'Skull'],
    cultist:      ['CULTIST',     'token',    'Cultist'],
    tablet:       ['TABLET',      'token',    'Tablet'],
    elder_thing:  ['ELDER THING', 'token',    'Elder Thing'],
    elder_sign:   ['ELDER SIGN',  'skill',    'Elder Sign'],
    auto_fail:    ['✗',           'survivor', 'Auto-fail'],

    bless:        ['BLESS',       'bless',    'Bless'],
    curse:        ['CURSE',       'curse',    'Curse'],
    frost:        ['❄',           'token',    'Frost'],

    health:       ['HP',          'survivor', 'Health'],
    sanity:       ['SAN',         'guardian', 'Sanity'],
    per_investigator: ['PER INV', '',         'Per investigator'],
    null:         ['∅',           '',         'Null']
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
    var glyph, mod, label;
    if (def) {
      glyph = def[0]; mod = def[1]; label = def[2];
    } else {
      /* Unknown token (new set, seal_a, …): show it as a readable tag
         rather than leaking raw [brackets] into the text. */
      glyph = key.replace(/_/g, ' ').toUpperCase();
      mod = '';
      label = glyph;
    }
    return '<span class="ah' + (mod ? ' ah-' + mod : '') + '" title="' +
      escapeHtml(label) + '">' + escapeHtml(glyph) + '</span>';
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

  function factionClass(code) {
    return FACTIONS.indexOf(code) !== -1 ? code : 'neutral';
  }

  global.Markup = {
    escapeHtml: escapeHtml,
    renderText: renderText,
    renderInline: renderInline,
    factionClass: factionClass
  };
})(window);
