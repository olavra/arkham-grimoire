/* Arkham Grimoire — hash-routed SPA over the ArkhamDB API. */
(function () {
  'use strict';

  var view = document.getElementById('view');
  var head = document.getElementById('site-head');
  var searchWrap = document.getElementById('search-wrap');
  var searchInput = document.getElementById('search');
  var backBtn = document.getElementById('back-btn');
  var filterbar = document.getElementById('filterbar');
  var fbGroups = document.getElementById('fb-groups');
  var filtersBtn = document.getElementById('filters-toggle');
  var filtersN = document.getElementById('filters-n');
  var cardsBtn = document.getElementById('cards-btn');
  var packsBtn = document.getElementById('packs-btn');
  var resourcesBtn = document.getElementById('resources-btn');
  var navToggle = document.getElementById('nav-toggle');
  var navLinks = document.getElementById('nav-links');
  var langBtn = document.getElementById('lang-btn');
  var langNow = document.getElementById('lang-now');
  var langMenu = document.getElementById('lang-menu');
  var sortMenu = document.getElementById('sort-menu');
  var groupMenu = document.getElementById('group-menu');
  var picker = document.getElementById('pack-picker');
  var pickerQ = document.getElementById('pp-q');
  var pickerList = document.getElementById('pp-list');
  var pickerTools = document.getElementById('pp-tools');

  var esc = Markup.escapeHtml;
  var text = Markup.renderText;
  var facClass = Markup.factionClass;

  var BATCH = 60;

  /* Cycle names, keyed by cycle_position. Packs only carry the position and
     /api/public/cycles/ answers 500, so this table — mirroring the upstream
     arkhamdb-json-data cycle list — is the only source of cycle names.
     Positions 50 and up are ArkhamDB's grouping buckets, not real cycles. */
  var CYCLE_LABELS = {
    1: 'Core',
    2: 'The Dunwich Legacy',
    3: 'The Path to Carcosa',
    4: 'The Forgotten Age',
    5: 'The Circle Undone',
    6: 'The Dream-Eaters',
    7: 'The Innsmouth Conspiracy',
    8: 'Edge of the Earth',
    9: 'The Scarlet Keys',
    10: 'The Feast of Hemlock Vale',
    11: 'The Drowned City',
    12: 'Core (2026)',
    13: 'Small Campaign Expansions',
    50: 'Return to…',
    60: 'Investigator Starter Decks',
    61: 'Investigator Decks',
    70: 'Side Stories',
    80: 'Promotional',
    90: 'Parallel'
  };

  /* Since Edge of the Earth a cycle ships as an Investigator/Campaign Expansion
     pair, so a cycle too new for the table above can still be named by stripping
     that suffix — the shortest result is the bare cycle name. */
  var EXPANSION_SUFFIX = /\s+(?:Investigator|Campaign)\s+Expansion$/i;

  function cycleLabel(position, group) {
    if (CYCLE_LABELS[position]) return CYCLE_LABELS[position];
    return group.map(function (p) { return p.name.replace(EXPANSION_SUFFIX, ''); })
      .reduce(function (a, b) { return b.length < a.length ? b : a; });
  }

  /* Packs carry a `chapter`: 1 is the original run, 2 is the 2026 relaunch.
     Without the split the relaunch Core Set (cycle_position 12) lands ahead of
     chapter 1's Return To / Side Stories / Starter Deck buckets, which sit at
     cycle_position 50 and up. */
  var CHAPTERS = {
    1: { label: 'Chapter 1', note: 'The original run, 2016–2025 — Core Set through The Drowned City.' },
    2: { label: 'Chapter 2', note: 'The 2026 relaunch — a new Core Set and its Investigator Decks.' }
  };

  function chapterOf(pack) { return pack.chapter || 1; }   // `books` carries a null chapter

  /* Facet display order. Anything the API returns that isn't listed here still
     shows up — it just sorts to the end. */
  var TYPE_ORDER = ['investigator', 'asset', 'event', 'skill', 'treachery',
                    'enemy', 'location', 'act', 'agenda', 'scenario', 'story', 'key'];
  var FACTION_ORDER = ['guardian', 'seeker', 'rogue', 'mystic', 'survivor', 'neutral', 'mythos'];

  /* Sort orders. ArkhamDB has no sort parameter — every endpoint hands back the
     whole payload — so these run here, over the cards already on the heap. Only
     fields the API actually ships are offered.

     Every comparator falls through to 0 rather than to a tiebreak: Array#sort is
     stable, so equal cards keep the pack order they arrived in. That makes Pack
     the second key of every other sort for free. */
  var SORTS = [
    { code: 'pack', label: 'Pack', cmp: null },   // the order they arrive in
    { code: 'name', label: 'Name', cmp: function (a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''));
    } },
    { code: 'level', label: 'Level', cmp: function (a, b) {
      return num(a.xp) - num(b.xp);
    } },
    { code: 'cost', label: 'Cost', cmp: function (a, b) {
      return num(a.cost) - num(b.cost);
    } },
    { code: 'faction', label: 'Class', cmp: function (a, b) {
      return rank(FACTION_ORDER, a.faction_code) - rank(FACTION_ORDER, b.faction_code);
    } },
    { code: 'type', label: 'Type', cmp: function (a, b) {
      return rank(TYPE_ORDER, a.type_code) - rank(TYPE_ORDER, b.type_code);
    } },
    { code: 'quantity', label: 'Copies', cmp: function (a, b) {
      return num(b.quantity) - num(a.quantity);   // most copies first: 4s before 1s
    } }
  ];

  /* Cards with no value for the key sort last, whichever way the key runs: a
     location has no cost, and "no cost" is not "cheapest". */
  function num(v) { return (v === null || v === undefined) ? Infinity : v; }
  function rank(order, code) {
    var i = order.indexOf(code);
    return i === -1 ? order.length : i;
  }

  function sortCmp(code) {
    for (var i = 0; i < SORTS.length; i++) if (SORTS[i].code === code) return SORTS[i].cmp;
    return null;
  }

  /* Grouping cuts the grid into labelled runs. It is not a second sort key: the
     chosen sort still orders the cards, and the group only decides which run
     each one lands in — so Name inside Pack reads A–Z pack by pack. */
  var GROUPS = [
    { code: 'none', label: 'None' },
    { code: 'pack', label: 'Pack' },
    { code: 'encounter', label: 'Encounter set' },
    { code: 'type', label: 'Type' }
  ];

  /* '' is a group of its own: player cards belong to no encounter set, and
     saying so beats filing them under a blank heading. */
  function groupKey(card) {
    if (state.group === 'pack') return card.pack_code || '';
    if (state.group === 'type') return card.type_code || '';
    if (state.group === 'encounter') return card.encounter_code || '';
    return '';
  }

  function groupTitle(card) {
    if (state.group === 'pack') return packLabel(card) || card.pack_code;
    if (state.group === 'type') return card.type_name || card.type_code || 'No type';
    return card.encounter_name || 'No encounter set';
  }

  /* No symbol for a type: FFG prints none, and the icon set here is the packs'
     and the encounter sets'. The heading carries its name and count alone. */
  function groupIcon(card) {
    if (state.group === 'type') return null;
    return state.group === 'pack'
      ? GameIcons.pack(card.pack_code)
      : GameIcons.set(card.encounter_code);
  }

  /* Catalogue order for packs; encounter sets have no order of their own, so
     they follow their pack and then the order they were printed in — which is
     the order the API hands them back, hence the position fallback. Cards with
     no set sort after the ones that have one. Types run in the same order the
     Type facet lists them: the order a card is read in, not A–Z. */
  function groupRank(card) {
    /* Every type TYPE_ORDER doesn't list shares one rank, so the code itself
       breaks the tie — two unlisted types would otherwise interleave and print
       their heading once per run. */
    if (state.group === 'type') {
      return [rank(TYPE_ORDER, card.type_code), 0, card.type_code || ''];
    }
    var pack = packIndex[card.pack_code];
    var p = pack ? (pack.cycle_position * 1000 + pack.position) : 1e6;
    if (state.group === 'pack') return [p, 0, ''];
    return [p, card.encounter_code ? 0 : 1, card.encounter_code || ''];
  }

  function groupCmp(a, b) {
    var ra = groupRank(a), rb = groupRank(b);
    return (ra[0] - rb[0]) || (ra[1] - rb[1]) || String(ra[2]).localeCompare(String(rb[2]));
  }

  /* The pack catalogue has sort and group menus of its own: the card orders
     above mean nothing for packs. Oldest First is the catalogue as ArkhamDB
     ships it. */
  var HOME_SORTS = [
    { code: 'newest', label: 'Newest First' },
    { code: 'oldest', label: 'Oldest First' }
  ];
  var HOME_GROUPS = [
    { code: 'chapter', label: 'Chapter / Cycle' },
    { code: 'none', label: 'None' }
  ];
  var homeView = { sort: 'oldest', group: 'chapter' };

  var state = {
    token: 0,        // invalidates in-flight renders when the route changes
    packs: [],       // selected pack codes; empty means "every pack"
    cards: [],       // cards for the current pack selection
    shown: 0,
    query: '',
    types: [],       // selected type_codes; empty means "no type filter"
    factions: [],    // selected faction_codes; empty means "no faction filter"
    levels: [],      // selected xp values, as strings; empty means "no level filter"
    /* A view preference, not a filter: it rides along across packs and routes
       rather than being remembered per pack the way the facets are. */
    sort: 'pack',
    group: 'none',   // a view preference too, and it rides along the same way
    observer: null
  };
  var scrollMemory = Object.create(null);
  var filterMemory = Object.create(null);   // pack key -> {types, factions, levels}

  /* Tile size — the minimum column width the card grid is laid out on, in
     pixels. A view preference like sort and group: one setting for every pack
     and route, and unlike those it outlives the tab, since it is really a
     statement about the screen it is being read on. */
  var TILE_KEY = 'ag:tile';
  var TILE_MIN = 110;
  var TILE_MAX = 340;
  var TILE_DEFAULT = 178;
  var tileSize = storedTile();

  /* null, not the default: an untouched slider leaves --tile-w alone so the
     stylesheet's own per-width defaults (132px under 640, one column under 500)
     keep applying. */
  function storedTile() {
    var raw;
    try { raw = localStorage.getItem(TILE_KEY); } catch (e) { return null; }
    var n = parseInt(raw, 10);
    if (!n || n < TILE_MIN || n > TILE_MAX) return null;
    return n;
  }

  var packIndex = Object.create(null);      // pack code -> pack
  var packList = [];                        // packs in catalogue order
  var pickerBuilt = false;

  var lastHash = location.hash || '#/';
  var prevHash = null;                      // the route we arrived from
  var lastGrid = null;                      // last card-browser hash, for the back button
  var filtersOpen = true;

  /* The search field is global: it always queries the whole card pool from its
     own route, whatever page it was typed on. This remembers where to drop the
     user back once the box is emptied — always a card browser, since that is
     what a set of results is. A card page or the pack index are places the
     search was launched *from*, not places emptying it should strand the user
     on. */
  var preSearchHash = '#/';

  /* The 43 packs the Investigator/Campaign Expansions superseded. Shown by
     default; the Superseded switch in the pack filters drops them for a
     collection-shaped catalogue. */
  var showReplaced = true;
  var homeData = null;                      // {packs}; lets the toggle repaint without refetching
  /* chapter -> true for the chapters folded away. Survives repaints and
     re-entering the home route. */
  var collapsedChapters = Object.create(null);

  /* ---------- helpers ---------- */

  function html(el, markup) { el.innerHTML = markup; }

  /* The index is the card browser over the whole pool; the pack catalogue is a
     section of its own under #/packs. */
  var PACKS_HASH = '#/packs';

  function routeParts() {
    return (location.hash || '#/').replace(/^#\/?/, '').split('/').filter(Boolean);
  }
  function isHome() { return routeParts()[0] === 'packs'; }
  function isResources() { return routeParts()[0] === 'resources'; }
  function isSearch() { return routeParts()[0] === 'search'; }
  function searchHash(q) { return '#/search/' + encodeURIComponent(q); }

  function loading(label) {
    html(view, '<div class="state"><div class="spinner"></div>' +
      '<div class="mono-tag">' + esc(label) + '</div></div>');
  }

  function failure(err) {
    html(view,
      '<div class="state error">' +
        '<div class="mono-tag">Signal lost</div>' +
        '<div class="msg">' + esc(err && err.message ? err.message : String(err)) + '</div>' +
        '<a class="btn-ghost" href="' + PACKS_HASH + '">Back to packs</a>' +
      '</div>');
  }

  function showBack(show, href) {
    backBtn.hidden = !show;
    if (show) backBtn.setAttribute('href', href || PACKS_HASH);
  }

  /* Cards, Packs and Resources are the three top-level sections. Everything
     that browses cards — the index, a pack's grid, a card page, a search —
     lights Cards; the catalogue lights Packs and the icon set lights
     Resources. */
  function syncNav() {
    var packs = isHome();
    var res = isResources();
    cardsBtn.classList.toggle('on', !packs && !res);
    packsBtn.classList.toggle('on', packs);
    resourcesBtn.classList.toggle('on', res);
  }

  /* The header is fixed, so the view has to reserve its height — and that
     height changes as the filter rows wrap or the bar is collapsed. */
  function syncHeadHeight() {
    document.documentElement.style.setProperty('--head-h', head.offsetHeight + 'px');
  }

  function showFilters(show) {
    filtersBtn.hidden = !show;
    filterbar.hidden = !show || !filtersOpen;
    if (!show) closePicker();
    syncHeadHeight();
  }

  /* The superseded-packs switch is a pack filter, so it renders wherever packs
     are filtered: the home filter bar, and the pack picker in the browser. Both
     copies drive the same flag, hence one markup helper and one delegated
     click handler keyed on the class. */
  function replacedCount() {
    return packList.reduce(function (n, p) { return n + (p.replaced === true ? 1 : 0); }, 0);
  }

  function replacedChipHtml() {
    var n = replacedCount();
    return '<button type="button" class="facet toggle-replaced' + (showReplaced ? ' on' : '') +
      '" aria-pressed="' + (showReplaced ? 'true' : 'false') +
      '" title="Deluxe boxes and Mythos Packs the Investigator / Campaign Expansions replaced">' +
      '<span class="tt-label">Superseded</span>' +
      (n ? '<span class="tt-n">' + n + '</span>' : '') +
    '</button>';
  }

  function toggleReplaced() {
    showReplaced = !showReplaced;
    if (isHome() && homeData) paintHome();                   // repaints its own chip
    if (!picker.hidden) {
      html(pickerTools, replacedChipHtml());
      filterPicker(pickerQ.value.trim().toLowerCase());
    }
  }

  var isLandscape = Card3D.isLandscape;

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* `available` is an ISO date. Parsed by hand rather than through Date, which
     would read the bare date as UTC and slide it a day back west of Greenwich. */
  function releaseDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return '';
    return String(+m[3]) + ' ' + MONTHS[+m[2] - 1] + ' ' + m[1];
  }

  function indexPacks(packs) {
    packList = packs;
    packIndex = Object.create(null);
    packs.forEach(function (p) { packIndex[p.code] = p; });
  }

  function packName(code) {
    return packIndex[code] ? packIndex[code].name : code;
  }

  /* Packs ship no abbreviation, so their code stands in — it is what ArkhamDB
     prints on the cards themselves and what players quote. The underscore in
     the handful of two-word codes is not part of that shorthand. */
  function packAbbr(code) {
    return String(code || '').replace(/_/g, ' ').toUpperCase();
  }

  /* The pack name off the card itself, not the index: the grid paints its first
     batch before the pack list has necessarily landed. */
  function packLabel(card) {
    return card.pack_name || packName(card.pack_code);
  }

  /* ---------- home: pack list ---------- */

  function renderHome() {
    var token = ++state.token;
    showBack(false);
    showFilters(false);
    loading('Consulting the index');

    if (homeData) { paintHome(); restoreScroll(PACKS_HASH); return; }

    API.getPacks().then(function (packs) {
      if (token !== state.token) return;
      homeData = { packs: packs };
      indexPacks(packs);
      paintHome();
      restoreScroll(PACKS_HASH);
    }).catch(function (err) { if (token === state.token) failure(err); });
  }

  /* Split off from renderHome so the "superseded packs" toggle can repaint
     without refetching or flashing the spinner. */
  function paintHome() {
    var all = homeData.packs;
    var packs = showReplaced ? all : all.filter(function (p) { return p.replaced !== true; });
    var newest = homeView.sort === 'newest';

    if (homeView.group === 'none') {
      paintHomeFlat(packs, all.length, newest);
      return;
    }
    /* Grouped, Newest First is the catalogue run backwards: chapters, cycles
       and the packs inside each all flip. */
    if (newest) packs = packs.slice().reverse();

    /* chapter -> cycle_position -> packs. Packs arrive sorted by cycle_position
       then position, so insertion order is already display order. */
    var chapters = [];
    var byChapter = Object.create(null);
    packs.forEach(function (p) {
      var ch = chapterOf(p);
      if (!byChapter[ch]) {
        byChapter[ch] = { order: [], groups: Object.create(null) };
        chapters.push(ch);
      }
      var bucket = byChapter[ch];
      if (!bucket.groups[p.cycle_position]) {
        bucket.groups[p.cycle_position] = [];
        bucket.order.push(p.cycle_position);
      }
      bucket.groups[p.cycle_position].push(p);
    });
    chapters.sort(function (a, b) { return newest ? b - a : a - b; });

    /* No "All Cards" entry here — the whole pool is the index, reachable from
       the Cards section in the topbar. */
    var out = '';

    chapters.forEach(function (ch) {
      var bucket = byChapter[ch];
      var meta = CHAPTERS[ch] || { label: 'Chapter ' + ch, note: '' };
      var n = bucket.order.reduce(function (sum, cyc) { return sum + bucket.groups[cyc].length; }, 0);

      var body = '';
      bucket.order.forEach(function (cyc) {
        var group = bucket.groups[cyc];
        var label = cycleLabel(cyc, group);
        /* A cycle is a fixed block, not a disclosure: most hold two or three
           packs, and folding each one away cost more scrolling than it saved.
           Blocks sit side by side while the row has room. */
        body += '' +
          '<section class="cycle" data-cycle="' + esc(String(cyc)) + '">' +
            '<header class="section-head">' +
              '<span class="cy-title" title="' + esc(label) + '">' + esc(label) + '</span>' +
              '<span class="mono-tag">Cycle ' + esc(String(cyc)) + ' — ' + group.length +
                (group.length === 1 ? ' pack' : ' packs') + '</span>' +
            '</header>' +
            '<div class="pack-grid">' +
              group.map(packCardHtml).join('') +
            '</div>' +
          '</section>';
      });

      /* <details> carries the collapse for free — keyboard, ARIA and find-in-page
         included. `summary` only admits phrasing content, hence a span title. */
      out += '' +
        '<details class="chapter" data-chapter="' + esc(String(ch)) + '"' +
            (collapsedChapters[ch] ? '' : ' open') + '>' +
          '<summary class="chapter-head">' +
            '<div class="ch-line">' +
              '<span class="ch-chev" aria-hidden="true"></span>' +
              '<span class="ch-title">' + esc(meta.label) + '</span>' +
              '<span class="mono-tag">' + n + (n === 1 ? ' pack' : ' packs') + '</span>' +
            '</div>' +
            (meta.note ? '<span class="ch-note">' + esc(meta.note) + '</span>' : '') +
          '</summary>' +
          '<div class="chapter-body">' + body + '</div>' +
        '</details>';
    });

    html(view, out);

    renderHomeFilterbar(packs.length, all.length);
    showFilters(true);

    /* `toggle` does not bubble, so each disclosure needs its own listener. */
    view.querySelectorAll('.chapter').forEach(function (det) {
      det.addEventListener('toggle', function () {
        if (det.open) delete collapsedChapters[det.dataset.chapter];
        else collapsedChapters[det.dataset.chapter] = true;
      });
    });
  }

  /* Ungrouped, the packs run by release date alone, so the Return To boxes and
     Side Stories land among the cycles they came out beside. Packs with no date
     go last either way; ties keep catalogue order. */
  function paintHomeFlat(packs, total, newest) {
    var at = Object.create(null);
    homeData.packs.forEach(function (p, i) { at[p.code] = i; });
    var sorted = packs.slice().sort(function (a, b) {
      var da = a.available || '', db = b.available || '';
      if (!da !== !db) return da ? -1 : 1;
      if (da !== db) return (da < db ? -1 : 1) * (newest ? -1 : 1);
      return (at[a.code] - at[b.code]) * (newest ? -1 : 1);
    });
    html(view, '<div class="pack-grid pack-flat">' + sorted.map(packCardHtml).join('') + '</div>');
    renderHomeFilterbar(packs.length, total);
    showFilters(true);
  }

  function packCardHtml(p) {
    var count = p.known || 0;
    var released = releaseDate(p.available);
    /* Pack art, where there is some, is the texture behind the medallion;
       the rest keep the star field. See docs/regen-packart.py. */
    var art = PackArt.url(p.code);
    return '' +
      '<a class="pack-card glass-card' + (art ? ' has-art' : '') + '"' +
          (art ? ' style="--art:url(&quot;' + esc(art) + '&quot;)"' : '') +
          ' href="#/pack/' + esc(p.code) + '">' +
        /* The pack's expansion symbol, large, stands where the box art was:
           every pack has one and they all fit the same square, where box shots
           came in every shape, or not at all. It leaves the name line, which
           now carries just the name. */
        '<div class="pc-cover pc-symbol">' +
          symbolHtml(GameIcons.pack(p.code), p.name) +
        '</div>' +
        '<div class="pc-body">' +
          '<div class="pc-top">' +
            '<span class="pc-name" title="' + esc(p.name) + '">' + esc(p.name) + '</span>' +
          '</div>' +
          '<div class="pc-foot">' +
            '<span class="pc-meta">' +
              '<span class="pc-count">' + count + (count === 1 ? ' card' : ' cards') + '</span>' +
              (released ? '<span class="pc-date">' + esc(released) + '</span>' : '') +
            '</span>' +
            '<span class="pc-arr">→</span>' +
          '</div>' +
        '</div>' +
      '</a>';
  }

  /* ---------- resources: the icon set ---------- */

  /* The expansion symbols we vendor, browsable and downloadable as one archive.
     The tree ships as js/iconindex.js — a static host has no directory listing
     — and the zip is built in the page from the same list, so the grid and the
     download can never disagree about what the set contains. */

  var RESOURCES_HASH = '#/resources';

  /* Built once and kept: the archive is a few megabytes of fetching and
     deflating, and pressing the button again should not pay for it twice. */
  var iconZip = null;

  /* Absolute, like GameIcons': the tile puts this in a CSS custom property, and
     a relative url() in one resolves against the stylesheet, not the page. */
  function iconUrl(groupPath, file) {
    var rel = IconIndex.dir + (groupPath + '/' + file).split('/').map(encodeURIComponent).join('/');
    return new URL(rel, document.baseURI).href;
  }

  /* "NOTZ-Agents-of-Hastur.svg" -> "Agents of Hastur". The leading initialism is
     the pack the folder already names, so it is dropped; names with no such
     prefix ("Class-Guardian", "Seal-A") keep every word, since the test is for
     a run of capitals, which those are not. */
  function iconLabel(file) {
    return file.replace(/\.svg$/i, '').replace(/^[A-Z0-9]{2,8}-/, '').replace(/-/g, ' ');
  }

  /* "00 - Core" -> "Core"; "Scenarios/01 - Curse of the Rougarou" -> the
     scenario. The numbers are there to order the folders, not to be read. */
  function iconGroupLabel(group) {
    var last = group.label.split('/').pop();
    return last.replace(/^\d+[a-z]?\s*-\s*/i, '') || last;
  }

  /* A button, not a figure: the tile opens the symbol full screen, and a button
     brings the keyboard and the focus ring with it. Its accessible name is the
     caption below the mark, so the mark itself is hidden from the tree and the
     file name stays a tooltip. The preview reads what it needs off the dataset
     rather than being handed a closure per tile — there are 478 of them. */
  function iconTileHtml(group, file) {
    var label = iconLabel(file);
    var url = iconUrl(group.path, file);
    return '' +
      '<button type="button" class="sym-tile glass-card" title="' + esc(file) + '"' +
          ' data-sym="' + esc(url) + '"' +
          ' data-name="' + esc(label) + '"' +
          ' data-set="' + esc(iconGroupLabel(group)) + '">' +
        '<span class="sym-art" style="--sym:url(&quot;' + esc(url) + '&quot;)" ' +
          'aria-hidden="true"></span>' +
        '<span class="sym-name">' + esc(label) + '</span>' +
      '</button>';
  }

  function renderResources() {
    ++state.token;
    showBack(false);
    showFilters(false);

    /* chapter -> its folders, both already in the order the generator walked. */
    var chapters = [];
    var byChapter = Object.create(null);
    IconIndex.groups.forEach(function (g) {
      var n = parseInt(g.chapter.replace(/\D+/g, ''), 10) || 1;
      if (!byChapter[n]) { byChapter[n] = []; chapters.push(n); }
      byChapter[n].push(g);
    });

    var out = '' +
      '<section class="res-head">' +
        '<div class="res-line">' +
          '<h1 class="res-title">Resources</h1>' +
          '<span class="mono-tag">' + IconIndex.count + ' icons</span>' +
        '</div>' +
        '<p class="res-note">Every expansion symbol in the collection, drawn from the ' +
          'printed boxes and encounter sets. Black SVGs on transparent ground — the page ' +
          'recolours them as it draws them.</p>' +
        '<div class="res-actions">' +
          '<button type="button" class="btn-ghost dl-btn" id="dl-icons">' +
            'Download all as .zip</button>' +
          '<span class="dl-status" id="dl-status" role="status" aria-live="polite"></span>' +
        '</div>' +
      '</section>';

    chapters.forEach(function (ch) {
      var groups = byChapter[ch];
      var meta = CHAPTERS[ch] || { label: 'Chapter ' + ch, note: '' };
      var n = groups.reduce(function (sum, g) { return sum + g.files.length; }, 0);

      var body = groups.map(function (g) {
        return '' +
          '<section class="sym-set">' +
            '<header class="section-head">' +
              '<span class="cy-title" title="' + esc(iconGroupLabel(g)) + '">' +
                esc(iconGroupLabel(g)) + '</span>' +
              '<span class="mono-tag">' + g.files.length +
                (g.files.length === 1 ? ' icon' : ' icons') + '</span>' +
            '</header>' +
            '<div class="sym-grid">' +
              g.files.map(function (f) { return iconTileHtml(g, f); }).join('') +
            '</div>' +
          '</section>';
      }).join('');

      /* Same disclosure as the pack catalogue, and it shares its collapse
         memory: the two pages are the same two chapters. */
      out += '' +
        '<details class="chapter" data-chapter="' + esc(String(ch)) + '"' +
            (collapsedChapters[ch] ? '' : ' open') + '>' +
          '<summary class="chapter-head">' +
            '<div class="ch-line">' +
              '<span class="ch-chev" aria-hidden="true"></span>' +
              '<span class="ch-title">' + esc(meta.label) + '</span>' +
              '<span class="mono-tag">' + n + (n === 1 ? ' icon' : ' icons') + '</span>' +
            '</div>' +
            (meta.note ? '<span class="ch-note">' + esc(meta.note) + '</span>' : '') +
          '</summary>' +
          '<div class="sym-chapter-body">' + body + '</div>' +
        '</details>';
    });

    html(view, out);

    view.querySelectorAll('.chapter').forEach(function (det) {
      det.addEventListener('toggle', function () {
        if (det.open) delete collapsedChapters[det.dataset.chapter];
        else collapsedChapters[det.dataset.chapter] = true;
      });
    });

    wireIconDownload();
    restoreScroll(RESOURCES_HASH);
  }

  /* ---------- resources: the archive ---------- */

  /* Eight at a time: enough to keep the connection busy over 478 small files,
     few enough that the browser is not queueing hundreds of requests it will
     serve one connection at a time anyway. */
  var FETCH_AT_ONCE = 8;

  function fetchIcons(onProgress) {
    var jobs = [];
    IconIndex.groups.forEach(function (g) {
      g.files.forEach(function (f) {
        jobs.push({ name: g.path + '/' + f, url: iconUrl(g.path, f) });
      });
    });

    var out = new Array(jobs.length);
    var next = 0, done = 0;

    function pump() {
      if (next >= jobs.length) return Promise.resolve();
      var i = next++;
      var job = jobs[i];
      return fetch(job.url).then(function (r) {
        if (!r.ok) throw new Error(job.name + ' — ' + r.status);
        return r.arrayBuffer();
      }).then(function (buf) {
        out[i] = { name: job.name, bytes: new Uint8Array(buf) };
        if (onProgress) onProgress(++done, jobs.length);
        return pump();
      });
    }

    var lanes = [];
    for (var k = 0; k < Math.min(FETCH_AT_ONCE, jobs.length); k++) lanes.push(pump());
    return Promise.all(lanes).then(function () { return out; });
  }

  function saveBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    /* Revoking straight away can cancel the download in some browsers. */
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  function wireIconDownload() {
    var btn = document.getElementById('dl-icons');
    var status = document.getElementById('dl-status');
    if (!btn) return;

    function say(msg) {
      /* The page is rebuilt on every route change, so the element this closure
         holds may no longer be on it — the build carries on either way. */
      if (status && status.isConnected) status.textContent = msg || '';
    }
    function busy(on) {
      if (btn.isConnected) {
        btn.disabled = on;
        btn.classList.toggle('working', on);
      }
    }

    btn.addEventListener('click', function () {
      if (btn.disabled) return;

      if (iconZip) {
        saveBlob(iconZip, 'arkham-grimoire-icons.zip');
        say('Saved.');
        return;
      }

      busy(true);
      say('Gathering 0 / ' + IconIndex.count);

      fetchIcons(function (n, total) {
        say('Gathering ' + n + ' / ' + total);
      }).then(function (files) {
        return Zip.create(files, function (n, total) {
          say((Zip.deflates ? 'Compressing ' : 'Packing ') + n + ' / ' + total);
        });
      }).then(function (blob) {
        iconZip = blob;
        saveBlob(blob, 'arkham-grimoire-icons.zip');
        busy(false);
        say(IconIndex.count + ' icons — ' + fileSize(blob.size));
      }).catch(function (err) {
        busy(false);
        say('Failed: ' + (err && err.message ? err.message : String(err)));
      });
    });
  }

  function fileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  /* ---------- pack: card grid ---------- */

  /* The route carries the pack filter: a comma-separated list of pack codes,
     or `_all` for the unfiltered pool. Picking a pack on the home page is just
     a pre-filled version of the pack filter the card browser exposes. */
  function packKey(codes) { return codes.length ? codes.join(',') : '_all'; }

  /* An empty pack selection is the index, not #/pack/_all — that route still
     resolves, it just isn't the address the browser writes back. */
  function gridHash(codes) { return codes.length ? '#/pack/' + packKey(codes) : '#/'; }

  function parsePacks(spec) {
    var seen = Object.create(null);
    return spec.split(',').filter(function (c) {
      if (!c || c === '_all' || seen[c]) return false;
      seen[c] = true;
      return true;
    });
  }

  /* One request per selected pack, merged in the order the codes were given.
     A single pack (or the whole pool) is handed back as the API's own cached
     array, so it must never be sorted in place here. */
  function loadCards(codes) {
    if (!codes.length) return API.getCards('_all');
    if (codes.length === 1) return API.getCards(codes[0]);

    var rank = Object.create(null);
    codes.forEach(function (c, i) { rank[c] = i; });

    return Promise.all(codes.map(function (c) { return API.getCards(c); }))
      .then(function (lists) {
        var out = [];
        lists.forEach(function (l) { out = out.concat(l); });
        return out.sort(function (a, b) {
          return a.pack_code === b.pack_code
            ? a.position - b.position
            : rank[a.pack_code] - rank[b.pack_code];
        });
      });
  }

  function renderPack(spec) {
    renderBrowser(parsePacks(spec), '');
  }

  /* The global search is the same card browser over the whole pool, opened with
     the query already applied — hence one renderer for both routes. */
  function renderSearch(q) {
    renderBrowser([], q);
  }

  function renderBrowser(codes, query) {
    var token = ++state.token;

    showBack(false);
    showFilters(false);
    loading(query ? 'Searching the collection'
          : codes.length ? 'Opening the pack'
          : 'Gathering the whole collection');

    Promise.all([API.getPacks(), loadCards(codes)]).then(function (res) {
      if (token !== state.token) return;

      indexPacks(res[0]);
      state.packs = codes;
      state.cards = res[1];
      state.shown = 0;

      /* Restore whatever was selected last time this pack set was open, so
         opening a card and coming back doesn't wipe the filters. The search
         route is deliberately exempt: it shares the empty pack key with
         #/pack/_all, and a new search should open on the whole pool rather
         than inherit chips from the last one. The query is likewise not part
         of a pack's memory — it belongs to the search route. */
      var saved = (!isSearch() && filterMemory[packKey(codes)]) ||
                  { types: [], factions: [], levels: [] };
      state.query = query;
      state.types = saved.types.slice();
      state.factions = saved.factions.slice();
      state.levels = saved.levels.slice();

      html(view,
        '<div class="card-grid" id="card-grid"></div>' +
        '<div class="sentinel" id="sentinel"></div>' +
        '<div id="grid-empty"></div>');

      buildPicker();
      renderFilterbar();
      showFilters(true);
      Card3D.bind(document.getElementById('card-grid'));   // delegated: covers later batches
      applyTileSize();

      lastGrid = location.hash;
      applyFilters();
      restoreScroll(location.hash);
    }).catch(function (err) { if (token === state.token) failure(err); });
  }

  /* Editing the pack selection rewrites the route in place instead of pushing
     a new one. Assembling a four-pack view would otherwise bury the page the
     browser's Back button ought to return to under four intermediate grids. */
  function setPacks(codes) {
    var order = Object.create(null);
    packList.forEach(function (p, i) { order[p.code] = i; });
    codes = codes.slice().sort(function (a, b) {
      return (order[a] === undefined ? 1e9 : order[a]) -
             (order[b] === undefined ? 1e9 : order[b]);
    });

    var token = ++state.token;
    state.packs = codes;
    /* On the search route the term owns the URL, so narrowing by pack there is
       a transient refinement of the results rather than a new address. */
    if (!isSearch()) {
      lastHash = lastGrid = gridHash(codes);
      history.replaceState(null, '', lastHash);
    }

    renderFilterbar();               // the pills answer immediately
    setBusy(true, busyLabel(codes));

    loadCards(codes).then(function (cards) {
      if (token !== state.token) return;
      state.cards = cards;
      pruneFilters();
      renderFilterbar();             // rebuilds the chip; the busy flags go with it
      setBusy(false);
      applyFilters();
    }).catch(function (err) {
      if (token !== state.token) return;
      setBusy(false);
      failure(err);
    });
  }

  /* Changing the pack selection means a fetch, and the grid keeps showing the
     old selection until it lands — which reads as a frozen page. The count chip
     says what is happening and the grid dims to say it is stale. */
  function setBusy(on, label) {
    filterbar.classList.toggle('busy', on);

    var grid = document.getElementById('card-grid');
    if (grid) grid.classList.toggle('grid-busy', on);

    var chip = document.getElementById('count-chip');
    if (chip && on) {
      chip.classList.add('loading');
      chip.innerHTML = '<span class="chip-spin" aria-hidden="true"></span>' + esc(label);
    }
    /* Switching off is left to applyFilters, which rewrites the chip with the
       real count a moment later. */
    if (chip && !on) chip.classList.remove('loading');
  }

  function busyLabel(codes) {
    if (!codes.length) return 'Loading every card…';
    if (codes.length === 1) return 'Loading ' + packName(codes[0]) + '…';
    return 'Loading ' + codes.length + ' packs…';
  }

  function togglePack(code) {
    var at = state.packs.indexOf(code);
    var next = state.packs.slice();
    if (at === -1) next.push(code); else next.splice(at, 1);
    setPacks(next);
  }

  function matches(card, q) {
    if (!q) return true;
    var haystack = [
      card.name, card.subname, card.traits, card.text,
      card.type_name, card.faction_name, card.pack_name, card.code
    ].join(' ').toLowerCase();
    return haystack.indexOf(q) !== -1;
  }

  /* ---------- facets ---------- */

  /* Tallies one field across the pool and returns it in display order, so a
     selection only ever offers toggles for the values it actually contains. */
  function facetsOf(cards, codeKey, nameKey, order) {
    var seen = Object.create(null);
    var out = [];
    cards.forEach(function (c) {
      var code = c[codeKey];
      if (!code) return;
      if (!seen[code]) {
        seen[code] = { code: code, label: c[nameKey] || code, count: 0 };
        out.push(seen[code]);
      }
      seen[code].count++;
    });
    return out.sort(function (a, b) {
      var ia = order.indexOf(a.code), ib = order.indexOf(b.code);
      if (ia === -1) ia = order.length;
      if (ib === -1) ib = order.length;
      return ia - ib || a.label.localeCompare(b.label);
    });
  }

  /* Level is `xp`, which only player cards carry — encounter cards have none
     and are filtered out entirely once a level is picked. */
  function levelFacets(cards) {
    var seen = Object.create(null);
    var out = [];
    cards.forEach(function (c) {
      if (c.xp === null || c.xp === undefined) return;
      var k = String(c.xp);
      if (!seen[k]) { seen[k] = { code: k, label: k, count: 0 }; out.push(seen[k]); }
      seen[k].count++;
    });
    return out.sort(function (a, b) { return a.code - b.code; });
  }

  function facetList(group) {
    return group === 'type' ? state.types
         : group === 'faction' ? state.factions
         : state.levels;
  }

  /* The tallies are still computed — they cost nothing on top of the pass that
     collects the options — but a number on every chip crowds a bar that already
     carries four groups. Flip this back on to show them again. */
  var SHOW_FACET_COUNTS = false;

  function facetGroup(label, group, items, selected, colorise) {
    if (items.length < 2) return '';   // a single option filters nothing
    return '' +
      '<div class="fb-group">' +
        '<span class="fb-label">' + esc(label) + '</span>' +
        items.map(function (it) {
          var on = selected.indexOf(it.code) !== -1;
          var glyph = colorise && Markup.hasFactionIcon(it.code)
            ? Markup.iconHtml(it.code, '', '', 'facet-ico') : '';
          return '<button type="button" class="facet' + (on ? ' on' : '') +
            (colorise ? ' facet-' + facClass(it.code) : '') +
            '" data-group="' + group + '" data-value="' + esc(it.code) + '"' +
            ' aria-pressed="' + (on ? 'true' : 'false') + '">' +
            glyph + esc(it.label) +
            (SHOW_FACET_COUNTS ? '<span class="n">' + it.count + '</span>' : '') +
          '</button>';
        }).join('') +
      '</div>';
  }

  /* The sort and group menus serve both the card browser and the pack
     catalogue; the route decides which options and which setting they show. */
  function sortOptions() { return isHome() ? HOME_SORTS : SORTS; }
  function groupOptions() { return isHome() ? HOME_GROUPS : GROUPS; }
  function currentSort() { return isHome() ? homeView.sort : state.sort; }
  function currentGroup() { return isHome() ? homeView.group : state.group; }

  function optionLabel(list, code) {
    for (var i = 0; i < list.length; i++) if (list[i].code === code) return list[i].label;
    return code;
  }
  function sortLabel(code) { return optionLabel(sortOptions(), code); }

  /* Seven orders is past what a chip row can carry without taking a line of the
     header to say something the user sets once — so it collapses to the same
     panel the language picker uses. */
  function sortGroupHtml() {
    return '' +
      '<div class="fb-group fb-sort">' +
        '<span class="fb-label">Sort</span>' +
        '<button type="button" class="facet sort-btn" id="sort-btn"' +
          ' aria-haspopup="listbox" aria-expanded="false" aria-controls="sort-menu">' +
          '<span class="sort-now" id="sort-now">' + esc(sortLabel(currentSort())) + '</span>' +
          '<span class="sort-caret" aria-hidden="true">▼</span>' +
        '</button>' +
      '</div>';
  }

  function groupLabel(code) { return optionLabel(groupOptions(), code); }

  function groupGroupHtml() {
    return '' +
      '<div class="fb-group fb-sort">' +
        '<span class="fb-label">Group</span>' +
        '<button type="button" class="facet sort-btn" id="group-btn"' +
          ' aria-haspopup="listbox" aria-expanded="false" aria-controls="group-menu">' +
          '<span class="sort-now" id="group-now">' + esc(groupLabel(currentGroup())) + '</span>' +
          '<span class="sort-caret" aria-hidden="true">▼</span>' +
        '</button>' +
      '</div>';
  }

  /* Sort and Group are lists, so they get panels; size is one number along a
     range, and a slider says that in the width a chip would take. */
  function sizeGroupHtml() {
    var v = tileSize || TILE_DEFAULT;
    return '' +
      '<div class="fb-group fb-size">' +
        '<span class="fb-label">Size</span>' +
        '<input type="range" class="tile-range" id="tile-size"' +
          ' min="' + TILE_MIN + '" max="' + TILE_MAX + '" step="2"' +
          ' value="' + v + '" aria-label="Card size"' +
          ' aria-valuetext="' + v + ' pixels">' +
      '</div>';
  }

  /* The grid element is rebuilt per route, and applyFilters only rewrites its
     contents, so the size is painted back on whenever a grid appears. */
  function applyTileSize() {
    var grid = document.getElementById('card-grid');
    if (!grid) return;
    if (tileSize) grid.style.setProperty('--tile-w', tileSize + 'px');
    else grid.style.removeProperty('--tile-w');
  }

  function setTileSize(px) {
    px = Math.max(TILE_MIN, Math.min(TILE_MAX, px | 0));
    tileSize = px;
    applyTileSize();
    try { localStorage.setItem(TILE_KEY, String(px)); } catch (e) { /* private mode */ }
  }

  /* Panels open under the control that opened them, wherever that control has
     ended up: the sort and group buttons ride the filter bar, which is a row
     under the header on a narrow window and a rail down the left edge on a wide
     one. Anchoring in CSS would need one rule per layout, and the rail's would
     have to guess the button's height.

     The panels are siblings of the bar — it scrolls its own overflow and would
     clip them — so the coordinates are measured against whatever the panel is
     positioned in, and clamped to the window on both axes. A panel with no room
     below its button opens upward instead. */
  var MENU_GAP = 8;

  function placeMenu(menu, btn) {
    if (!menu || !btn) return;
    var host = menu.offsetParent || document.documentElement;
    var hr = host.getBoundingClientRect();
    var br = btn.getBoundingClientRect();
    var w = menu.offsetWidth;
    var h = menu.offsetHeight;

    var left = Math.min(br.left, window.innerWidth - w - 12);
    var below = br.bottom + MENU_GAP;
    var top = (below + h > window.innerHeight && br.top - h - MENU_GAP > 0)
      ? br.top - h - MENU_GAP
      : Math.min(below, Math.max(12, window.innerHeight - h - 12));

    menu.style.right = 'auto';
    menu.style.left = Math.round(Math.max(12, left) - hr.left) + 'px';
    menu.style.top = Math.round(top - hr.top) + 'px';
  }

  function buildGroupMenu() {
    if (!groupMenu) return;
    html(groupMenu, groupOptions().map(function (g) {
      var on = g.code === currentGroup();
      return '<button type="button" class="pop-item' + (on ? ' on' : '') + '"' +
        ' role="option" aria-selected="' + (on ? 'true' : 'false') + '"' +
        ' data-group="' + esc(g.code) + '">' +
        '<span class="pop-tick" aria-hidden="true">✓</span>' +
        '<span class="pop-name">' + esc(g.label) + '</span>' +
      '</button>';
    }).join(''));
  }

  function closeGroup() {
    if (!groupMenu || groupMenu.hidden) return;
    groupMenu.hidden = true;
    var btn = document.getElementById('group-btn');
    if (btn) {
      btn.classList.remove('on');
      btn.setAttribute('aria-expanded', 'false');
    }
  }

  function toggleGroup() {
    var open = groupMenu.hidden;
    if (open) { closePicker(); closeSort(); closeLang(); closeNav(); buildGroupMenu(); }
    groupMenu.hidden = !open;
    var btn = document.getElementById('group-btn');
    if (open) placeMenu(groupMenu, btn);
    if (btn) {
      btn.classList.toggle('on', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
  }

  function setGroup(code) {
    closeGroup();
    if (code === currentGroup()) return;
    if (isHome()) { homeView.group = code; if (homeData) paintHome(); return; }
    state.group = code;
    var now = document.getElementById('group-now');
    if (now) now.textContent = groupLabel(code);
    applyFilters();
  }

  function buildSortMenu() {
    if (!sortMenu) return;
    html(sortMenu, sortOptions().map(function (s) {
      var on = s.code === currentSort();
      return '<button type="button" class="pop-item' + (on ? ' on' : '') + '"' +
        ' role="option" aria-selected="' + (on ? 'true' : 'false') + '"' +
        ' data-sort="' + esc(s.code) + '">' +
        '<span class="pop-tick" aria-hidden="true">✓</span>' +
        '<span class="pop-name">' + esc(s.label) + '</span>' +
      '</button>';
    }).join(''));
  }

  function closeSort() {
    if (!sortMenu || sortMenu.hidden) return;
    sortMenu.hidden = true;
    var btn = document.getElementById('sort-btn');
    if (btn) { btn.classList.remove('on'); btn.setAttribute('aria-expanded', 'false'); }
  }

  function toggleSort() {
    var open = sortMenu.hidden;
    if (open) { closePicker(); closeLang(); closeNav(); closeGroup(); buildSortMenu(); }
    sortMenu.hidden = !open;
    var btn = document.getElementById('sort-btn');
    if (open) placeMenu(sortMenu, btn);
    if (btn) {
      btn.classList.toggle('on', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
  }

  function packGroupHtml() {
    var pills = state.packs.map(function (code) {
      var name = packName(code);
      return '<span class="pack-pill">' +
        symbolHtml(GameIcons.pack(code), name) + esc(name) +
        '<button type="button" class="pp-x" data-code="' + esc(code) + '"' +
        ' aria-label="Remove ' + esc(name) + '">×</button></span>';
    }).join('');

    return '' +
      '<div class="fb-group fb-packs">' +
        '<span class="fb-label">Packs</span>' + pills +
        '<button type="button" class="fb-add" id="fb-add" aria-expanded="false"' +
          ' aria-controls="pack-picker">+ Pack</button>' +
      '</div>';
  }

  /* The home page filters packs rather than cards, so it fills the same bar
     with the only pack filter it has — keeping Filters in the topbar on every
     route instead of appearing halfway through the app. */
  function renderHomeFilterbar(shown, total) {
    html(fbGroups,
      '<div class="fb-row">' +
        '<div class="fb-group fb-packs">' +
          '<span class="fb-label">Packs</span>' +
          replacedChipHtml() +
        '</div>' +
        '<div class="fb-group fb-tail">' +
          sortGroupHtml() +
          groupGroupHtml() +
          '<span class="chip" id="count-chip">' +
            (shown === total ? total + ' packs' : shown + ' of ' + total + ' packs') +
          '</span>' +
        '</div>' +
      '</div>');

    /* Hiding the superseded packs is the one active filter this route has. */
    filtersN.textContent = showReplaced ? '' : '1';
    filtersBtn.classList.toggle('on', !showReplaced);
    syncHeadHeight();
  }

  /* Packs and Level share the first row — both are short, and the pack pills
     need somewhere to grow. Type and Class each keep a row of their own: they
     run to a dozen chips and reflowing them around a neighbour makes the bar
     jump every time the selection changes. */
  function renderFilterbar() {
    var cards = state.cards;
    html(fbGroups,
      '<div class="fb-row">' +
        packGroupHtml() +
        facetGroup('Level', 'level', levelFacets(cards), state.levels, false) +
        '<div class="fb-group fb-tail">' +
          sortGroupHtml() +
          groupGroupHtml() +
          sizeGroupHtml() +
          /* role=status so the count — and the "loading…" that replaces it while
             a pack is fetched — is announced, not just drawn. */
          '<span class="chip" id="count-chip" role="status">' +
            cards.length + ' unique · ' + copies(cards) + ' total</span>' +
          '<button type="button" class="facet-clear" id="facet-clear" hidden>Clear filters</button>' +
        '</div>' +
      '</div>' +
      '<div class="fb-row">' +
        facetGroup('Type', 'type',
          facetsOf(cards, 'type_code', 'type_name', TYPE_ORDER), state.types, false) +
      '</div>' +
      '<div class="fb-row">' +
        facetGroup('Class', 'faction',
          facetsOf(cards, 'faction_code', 'faction_name', FACTION_ORDER), state.factions, true) +
      '</div>');

    markPicked();
    syncFilterCount();
    syncHeadHeight();
  }

  /* A pack that leaves the selection can take the only card of some type or
     level with it; a toggle for a value no longer in the pool would filter
     everything away with no chip left to switch off. */
  function pruneFilters() {
    var live = { type: Object.create(null), faction: Object.create(null), level: Object.create(null) };
    state.cards.forEach(function (c) {
      if (c.type_code) live.type[c.type_code] = true;
      if (c.faction_code) live.faction[c.faction_code] = true;
      if (c.xp !== null && c.xp !== undefined) live.level[String(c.xp)] = true;
    });
    function keep(list, set) {
      return list.filter(function (v) { return set[v] === true; });
    }
    state.types = keep(state.types, live.type);
    state.factions = keep(state.factions, live.faction);
    state.levels = keep(state.levels, live.level);
  }

  function syncFilterCount() {
    var n = state.packs.length + state.types.length +
            state.factions.length + state.levels.length;
    filtersN.textContent = n || '';
    filtersBtn.classList.toggle('on', n > 0);
  }

  function setSort(code) {
    closeSort();
    if (code === currentSort()) return;
    if (isHome()) { homeView.sort = code; if (homeData) paintHome(); return; }
    state.sort = code;
    var now = document.getElementById('sort-now');
    if (now) now.textContent = sortLabel(code);
    applyFilters();
  }

  function clearFacets() {
    state.types = [];
    state.factions = [];
    state.levels = [];
    renderFilterbar();
    applyFilters();
  }

  /* ---------- pack picker ---------- */

  function buildPicker() {
    if (pickerBuilt || !packList.length) return;
    pickerBuilt = true;

    var out = '';
    var cycle = null;
    packList.forEach(function (p) {
      if (p.cycle_position !== cycle) {
        cycle = p.cycle_position;
        out += '<div class="pp-head" data-cycle="' + esc(String(cycle)) + '">' +
          esc(cycleLabel(cycle, packList.filter(function (q) {
            return q.cycle_position === cycle;
          }))) + '</div>';
      }
      out += '<button type="button" class="pp-item" data-code="' + esc(p.code) + '"' +
        (p.replaced === true ? ' data-replaced="1"' : '') +
        ' data-name="' + esc(p.name.toLowerCase() + ' ' + p.code) + '">' +
        '<span class="pp-tick" aria-hidden="true">✓</span>' +
        symbolHtml(GameIcons.pack(p.code), p.name) +
        '<span class="pp-name">' + esc(p.name) + '</span>' +
        '<span class="pp-n">' + (p.known || 0) + '</span>' +
      '</button>';
    });
    html(pickerList, out);
  }

  function markPicked() {
    pickerList.querySelectorAll('.pp-item').forEach(function (b) {
      var on = state.packs.indexOf(b.dataset.code) !== -1;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function filterPicker(q) {
    var groups = Object.create(null);      // cycle -> any visible pack
    var current = null;
    pickerList.querySelectorAll('.pp-head,.pp-item').forEach(function (el) {
      if (el.classList.contains('pp-head')) { current = el; groups[el.dataset.cycle] = false; return; }
      /* An already-picked pack stays listed even when superseded ones are
         hidden — otherwise there is no row left to unpick it from. */
      var hit = (!q || el.dataset.name.indexOf(q) !== -1) &&
                (showReplaced || el.dataset.replaced !== '1' || el.classList.contains('on'));
      el.hidden = !hit;
      if (hit && current) groups[current.dataset.cycle] = true;
    });
    pickerList.querySelectorAll('.pp-head').forEach(function (h) {
      h.hidden = !groups[h.dataset.cycle];
    });
  }

  function openPicker() {
    closeSort();
    closeGroup();
    closeLang();
    picker.hidden = false;
    var add = document.getElementById('fb-add');
    if (add) add.setAttribute('aria-expanded', 'true');
    html(pickerTools, replacedChipHtml());
    pickerQ.value = '';
    filterPicker('');
    placeMenu(picker, add);      // after the list, which is what gives it its height
    pickerQ.focus();
  }

  function closePicker() {
    if (picker.hidden) return;
    picker.hidden = true;
    var add = document.getElementById('fb-add');
    if (add) add.setAttribute('aria-expanded', 'false');
  }

  function togglePicker() {
    if (picker.hidden) openPicker(); else closePicker();
  }

  /* ---------- section menu ---------- */

  /* Only a menu on a narrow window — wider than that CSS keeps the links inline
     as display:contents and the class does nothing. */
  function closeNav() {
    if (!navLinks.classList.contains('open')) return;
    navLinks.classList.remove('open');
    navToggle.setAttribute('aria-expanded', 'false');
  }

  function toggleNav() {
    var open = !navLinks.classList.contains('open');
    navLinks.classList.toggle('open', open);
    navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) { closePicker(); closeSort(); closeGroup(); closeLang(); }   // one panel at a time
  }

  /* ---------- filtering ---------- */

  /* Toggles inside a group are OR'd; the groups and the text box are AND'd. */
  function passes(card) {
    if (state.types.length && state.types.indexOf(card.type_code) === -1) return false;
    if (state.factions.length && state.factions.indexOf(card.faction_code) === -1) return false;
    if (state.levels.length && state.levels.indexOf(String(card.xp)) === -1) return false;
    return matches(card, state.query);
  }

  /* Two different questions, and a pack answers them differently: the Core Set
     lists 183 distinct cards but 265 pieces of cardboard, because a card the
     pack ships four of is still one card. */
  function copies(list) {
    var n = 0;
    for (var i = 0; i < list.length; i++) n += list[i].quantity > 0 ? list[i].quantity : 1;
    return n;
  }

  function countLabel(narrowed) {
    var uniq = state.filtered.length, tot = copies(state.filtered);
    if (!narrowed) return uniq + ' unique · ' + tot + ' total';
    return uniq + '/' + state.cards.length + ' unique · ' +
           tot + '/' + copies(state.cards) + ' total';
  }

  function applyFilters() {
    var grid = document.getElementById('card-grid');
    if (!grid) return;

    if (!isSearch()) {
      filterMemory[packKey(state.packs)] = {
        types: state.types.slice(),
        factions: state.factions.slice(),
        levels: state.levels.slice()
      };
    }

    state.filtered = state.cards.filter(passes);
    var cmp = sortCmp(state.sort);
    if (cmp) state.filtered.sort(cmp);   // filter() already made a copy of its own
    /* Sort first, group second: Array#sort is stable, so gathering the runs
       afterwards leaves each one in the order the sort just put it in. */
    if (state.group !== 'none') {
      state.filtered.sort(groupCmp);
      countGroups();
    }
    state.shown = 0;
    state.openGroup = null;   // the heading the next batch continues under
    grid.innerHTML = '';

    var facets = state.types.length + state.factions.length + state.levels.length;

    var chip = document.getElementById('count-chip');
    if (chip) chip.textContent = countLabel(state.query || facets);

    var clearBtn = document.getElementById('facet-clear');
    if (clearBtn) clearBtn.hidden = !facets;

    var empty = document.getElementById('grid-empty');
    if (empty) {
      empty.innerHTML = state.filtered.length ? '' :
        '<div class="state"><div class="mono-tag">' +
          (state.query ? 'Nothing matches “' + esc(state.query) + '”'
                       : 'No cards match these filters') +
        '</div></div>';
    }

    appendBatch();
    watchSentinel();
  }

  function appendBatch() {
    var grid = document.getElementById('card-grid');
    if (!grid) return;
    var slice = state.filtered.slice(state.shown, state.shown + BATCH);
    if (!slice.length) return;
    grid.insertAdjacentHTML('beforeend', slice.map(cellHtml).join(''));
    state.shown += slice.length;
  }

  /* A tile, preceded by a heading whenever the run changes. The open group is
     tracked across batches so a set split by the infinite scroll is not
     announced twice. */
  function cellHtml(card) {
    if (state.group === 'none') return tileHtml(card);
    var key = groupKey(card);
    if (key === state.openGroup) return tileHtml(card);
    state.openGroup = key;
    return groupHeadHtml(card) + tileHtml(card);
  }

  function countGroups() {
    state.groupCounts = Object.create(null);
    state.filtered.forEach(function (c) {
      var k = groupKey(c);
      state.groupCounts[k] = (state.groupCounts[k] || 0) + 1;
    });
  }

  function groupHeadHtml(card) {
    var n = (state.groupCounts && state.groupCounts[groupKey(card)]) || 0;
    var title = groupTitle(card);
    return '' +
      '<h2 class="grid-head">' +
        symbolHtml(groupIcon(card), title) +
        '<span class="gh-name">' + esc(title) + '</span>' +
        '<span class="gh-count">' + n + (n === 1 ? ' card' : ' cards') + '</span>' +
      '</h2>';
  }

  function tileHtml(card) {
    var fac = facClass(card.faction_code);
    /* Front face only: a tile never rotates past 90°, so the reverse would be
       a second image request for pixels nobody sees.

       `upright`: every tile is portrait in the grid, investigators, acts and
       agendas included. They are printed on their side, but a wide tile among
       portrait ones breaks the row it sits in — the card stands on its side
       here instead, and the detail view shows it the way it is printed. */
    var art = Card3D.html(card, { lazy: true, upright: true, 'class': 'tile-img' }) ||
      '<div class="tile-img"><span class="noimg">No image</span></div>';

    var facMark = Markup.hasFactionIcon(card.faction_code)
      ? Markup.iconHtml(card.faction_code, fac, card.faction_name, 'tile-fac')
      : '<span class="fac fac-' + fac + '" title="' + esc(card.faction_name || 'Neutral') + '"></span>';

    /* A hidden card is the reverse of another card, not something you can draw
       or build with — the grid says so rather than showing it as a peer. */
    var flag = Faces.isHidden(card)
      ? '<span class="tile-flag" title="The reverse of another card — never ' +
        'drawn or added to a deck on its own">Hidden</span>'
      : '';

    /* Collector number, and the set it counts within — a bare "#1" is not an
       identifier, the whole pool holds one per pack. The pack code is the
       abbreviation ArkhamDB itself uses; the tooltip spells the set out and
       adds the card code, which is the one value that is unique pool-wide. */
    /* How many copies the pack holds — part of the identifier line, not the
       name: "CORE #2 ×3" is one fact about the printing, read in one go. */
    var qty = card.quantity > 0
      ? '<span class="tile-qty">×' + card.quantity + '</span>'
      : '';

    var num = (card.position || card.position === 0)
      ? '<span class="tile-num" title="' + esc(packLabel(card)) + ' #' +
          esc(String(card.position)) + ' · ' + esc(card.code) +
          (card.quantity > 0 ? ' · ' + card.quantity + ' copies in the pack' : '') + '">' +
          '<span class="tile-pack">' + esc(packAbbr(card.pack_code)) + '</span>' +
          '<span class="tile-pos">#' + esc(String(card.position)) + '</span>' +
          qty +
        '</span>'
      : '';

    return '' +
      '<a class="card-tile' + (Faces.isHidden(card) ? ' is-hidden' : '') +
        '" href="#/card/' + esc(card.code) + '">' +
        art + flag +
        '<div class="tile-name">' +
          facMark +
          '<span class="tile-title">' + esc(card.name) + '</span>' +
        '</div>' +
        /* No subtitle: "The Fed" under Roland Banks costs a line and answers
           nothing you came to the grid for. */
        '<div class="tile-meta">' + num + '</div>' +
      '</a>';
  }

  function watchSentinel() {
    if (state.observer) { state.observer.disconnect(); state.observer = null; }
    var sentinel = document.getElementById('sentinel');
    if (!sentinel) return;

    state.observer = new IntersectionObserver(function (entries) {
      if (!entries[0].isIntersecting) return;
      if (state.shown >= state.filtered.length) { state.observer.disconnect(); return; }
      appendBatch();
    }, { rootMargin: '900px 0px' });

    state.observer.observe(sentinel);
  }

  /* ---------- card detail ---------- */

  function renderCard(code) {
    var token = ++state.token;
    showFilters(false);
    /* Whatever grid we came from, filters and all — falling back to the card's
       own pack for a cold link straight into a card. */
    showBack(true, lastGrid || '#/');
    loading('Retrieving the card');

    API.getCard(code).then(function (card) {
      if (token !== state.token) return;

      if (!lastGrid) showBack(true, '#/pack/' + card.pack_code);
      html(view, detailHtml(card));
      hydrateCardRefs(token);
      linkifyCardText(card, token);
      wireFlip(card);
      wireViewer(card);
      restoreScroll(location.hash);
    }).catch(function (err) { if (token === state.token) failure(err); });
  }

  /* stat kinds Markup can draw an icon for — font glyphs, plus health and
     sanity from img/icons/ */
  var STAT_ICONS = {
    willpower: 'willpower', intellect: 'intellect',
    combat: 'combat', agility: 'agility',
    health: 'health', sanity: 'sanity'
  };

  function statHtml(kind, key, value) {
    var ico = STAT_ICONS[kind]
      ? Markup.iconHtml(STAT_ICONS[kind], kind, '', 'stat-ico') : '';
    return '<div class="stat ' + kind + '"><span class="k">' + ico + esc(key) +
      '</span><span class="v">' + esc(String(value)) + '</span></div>';
  }

  function statsFor(card) {
    var s = [];
    var t = card.type_code;

    if (t === 'investigator') {
      s.push(statHtml('willpower', 'Willpower', card.skill_willpower));
      s.push(statHtml('intellect', 'Intellect', card.skill_intellect));
      s.push(statHtml('combat', 'Combat', card.skill_combat));
      s.push(statHtml('agility', 'Agility', card.skill_agility));
      if (card.health != null) s.push(statHtml('health', 'Health', card.health));
      if (card.sanity != null) s.push(statHtml('sanity', 'Sanity', card.sanity));
      return s.join('');
    }

    if (t === 'enemy') {
      if (card.enemy_fight != null) s.push(statHtml('combat', 'Fight', card.enemy_fight));
      if (card.health != null) {
        s.push(statHtml('health', 'Health',
          card.health + (card.health_per_investigator ? ' ea.' : '')));
      }
      if (card.enemy_evade != null) s.push(statHtml('agility', 'Evade', card.enemy_evade));
      if (card.enemy_damage != null) s.push(statHtml('health', 'Damage', card.enemy_damage));
      if (card.enemy_horror != null) s.push(statHtml('sanity', 'Horror', card.enemy_horror));
      if (card.victory != null) s.push(statHtml('xp', 'Victory', card.victory));
      return s.join('');
    }

    if (t === 'location') {
      if (card.shroud != null) s.push(statHtml('agility', 'Shroud', card.shroud));
      if (card.clues != null) {
        s.push(statHtml('intellect', 'Clues',
          card.clues + (card.health_per_investigator ? ' ea.' : '')));
      }
      if (card.victory != null) s.push(statHtml('xp', 'Victory', card.victory));
      return s.join('');
    }

    if (t === 'act' || t === 'agenda') {
      if (card.stage != null) s.push(statHtml('cost', 'Stage', card.stage));
      if (card.clues != null) s.push(statHtml('intellect', 'Clues', card.clues));
      if (card.doom != null) s.push(statHtml('xp', 'Doom', card.doom));
      return s.join('');
    }

    /* player cards: asset / event / skill */
    if (card.cost != null) s.push(statHtml('cost', 'Cost', card.cost));
    if (card.xp != null) s.push(statHtml('xp', 'Level', card.xp));
    if (card.health != null) s.push(statHtml('health', 'Health', card.health));
    if (card.sanity != null) s.push(statHtml('sanity', 'Sanity', card.sanity));
    if (card.victory != null) s.push(statHtml('xp', 'Victory', card.victory));
    return s.join('');
  }

  /* Skill icons are printed once per copy on the card; here one pip carries the
     count instead, so a 3-icon skill card stays one glyph wide. */
  var SKILL_PIPS = [
    ['skill_willpower', 'willpower', 'Willpower'],
    ['skill_intellect', 'intellect', 'Intellect'],
    ['skill_combat', 'combat', 'Combat'],
    ['skill_agility', 'agility', 'Agility'],
    ['skill_wild', 'wild', 'Wild']
  ];

  function skillIconsHtml(card) {
    var pips = SKILL_PIPS.map(function (pip) {
      var n = card[pip[0]] || 0;
      if (!n) return '';
      return '<span class="skill-pip" role="img" aria-label="' +
        esc(pip[2] + ' ×' + n) + '" title="' + esc(pip[2] + ' ×' + n) + '">' +
        Markup.iconHtml(pip[1], pip[1]) +
        '<span class="n">×' + n + '</span>' +
      '</span>';
    }).join('');

    if (!pips) return '';
    return '<div class="type-line"><span class="mono-tag">Icons</span>' +
      '<span class="skill-pips">' + pips + '</span></div>';
  }

  function metaCell(key, value) {
    if (value == null || value === '') return '';
    return '<div class="cell"><span class="k">' + esc(key) + '</span>' +
      '<span class="v">' + value + '</span></div>';
  }

  /* The expansion symbols ship as black-on-transparent SVGs, so they are drawn
     as a mask over the text colour instead of an <img> that would stay black on
     the dark sheet. */
  function symbolHtml(url, label) {
    if (!url) return '';
    return '<span class="exp-ico" style="--sym:url(&quot;' + esc(url) + '&quot;)" ' +
      'role="img" aria-label="' + esc(label + ' symbol') + '"></span>';
  }

  /* restrictions.investigator is a code -> code map, so the values carry no more
     information than the keys; hydrateCardRefs fetches the readable label. */
  function restrictedCodes(card) {
    var inv = card.restrictions && card.restrictions.investigator;
    return inv ? Object.keys(inv) : [];
  }

  /* deck_requirements.card maps a required card's code to every printing that
     satisfies it ({'01006': {'01006':…, '98005':…}}). Only the key is the card
     actually named on the investigator; the rest are its reprints. */
  function requirementCodes(card) {
    var req = card.deck_requirements && card.deck_requirements.card;
    return req ? Object.keys(req) : [];
  }

  /* Links to other cards. The API gives bare codes, and the name and pack live
     on the referenced card, so each link ships with its code as placeholder text
     and hydrateCardRefs rewrites it once that card has been fetched. */
  function cardRefLink(code) {
    return '<a class="cardref" data-code="' + esc(code) +
      '" href="#/card/' + esc(code) + '">' + esc(code) + '</a>';
  }

  function refList(items) {
    return items.length ? '<span class="cardrefs">' + items.join('') + '</span>' : '';
  }

  function cardRefs(codes) {
    if (!codes) return '';
    if (!Array.isArray(codes)) codes = [codes];
    return refList(codes.map(cardRefLink));
  }

  var RANDOM_TARGETS = { basicweakness: 'basic weakness' };

  /* Named cards first, then the "1 random basic weakness" style slots, which
     have no code to link to. */
  function deckRequirements(card) {
    var items = requirementCodes(card).map(cardRefLink);
    var random = (card.deck_requirements && card.deck_requirements.random) || [];
    random.forEach(function (r) {
      items.push('<span>1 random ' + esc(RANDOM_TARGETS[r.value] || r.value) + '</span>');
    });
    return refList(items);
  }

  /* errata_date arrives as a {date, timezone, timezone_type} object. */
  function errataDate(errata) {
    if (!errata) return '';
    var raw = typeof errata === 'string' ? errata : errata.date;
    if (!raw) return '';
    return esc(String(raw).slice(0, 10));
  }

  /* Swap every card link's code for "Name (Pack)". Codes already in the API
     cache resolve without a request; the rest fall back to the bare code. */
  function hydrateCardRefs(token) {
    var links = view.querySelectorAll('.cardref[data-code]');
    var byCode = Object.create(null);

    Array.prototype.forEach.call(links, function (a) {
      var code = a.getAttribute('data-code');
      (byCode[code] || (byCode[code] = [])).push(a);
    });

    Object.keys(byCode).forEach(function (code) {
      API.getCard(code).then(function (ref) {
        if (token !== state.token) return;
        byCode[code].forEach(function (a) {
          a.textContent = ref.name + (ref.pack_name ? ' (' + ref.pack_name + ')' : '');
          a.title = ref.code;
        });
      }).catch(function () { /* leave the code showing */ });
    });
  }

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /* Card text names its deck requirements and restrictions in prose ("…: Roland's
     .38 Special, Cover Up, 1 random basic weakness") with no markup to hang a
     link on. Only names this card's own data already points at get linked, so
     there is no guessing at arbitrary card names in the text. */
  function linkifyNames(root, refs) {
    /* Longest first: "Cover Up" must not win inside a longer title. */
    refs = refs.slice().sort(function (a, b) { return b.name.length - a.name.length; });

    var byName = Object.create(null);
    refs.forEach(function (r) { if (!byName[r.name]) byName[r.name] = r; });

    var re = new RegExp('(' + Object.keys(byName).map(escapeRe).join('|') + ')', 'g');
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    var node;
    while ((node = walker.nextNode())) nodes.push(node);

    nodes.forEach(function (text) {
      if (text.parentNode.closest('a')) return;

      var raw = text.nodeValue;
      var frag = document.createDocumentFragment();
      var last = 0;
      var m;

      re.lastIndex = 0;
      while ((m = re.exec(raw))) {
        if (m.index > last) frag.appendChild(document.createTextNode(raw.slice(last, m.index)));
        var ref = byName[m[0]];
        var a = document.createElement('a');
        a.className = 'cardref';
        a.href = '#/card/' + ref.code;
        a.title = ref.code + (ref.pack_name ? ' · ' + ref.pack_name : '');
        a.textContent = m[0];
        frag.appendChild(a);
        last = m.index + m[0].length;
      }
      if (!last) return;

      if (last < raw.length) frag.appendChild(document.createTextNode(raw.slice(last)));
      text.parentNode.replaceChild(frag, text);
    });
  }

  function linkifyCardText(card, token) {
    var codes = requirementCodes(card).concat(restrictedCodes(card))
      .filter(function (code) { return code !== card.code; });
    if (!codes.length) return;

    Promise.all(codes.map(function (code) {
      return API.getCard(code).catch(function () { return null; });
    })).then(function (refs) {
      if (token !== state.token) return;
      refs = refs.filter(function (r) { return r && r.name; });
      if (!refs.length) return;
      Array.prototype.forEach.call(view.querySelectorAll('.textbox'), function (box) {
        linkifyNames(box, refs);
      });
    });
  }

  /* What is printed on the other side.

     A `back_text`/`back_flavor` reverse is a second half of the same record and
     gets a paragraph. A linked reverse is a whole card — its own type, traits,
     stats and text — so it gets the same treatment the front does, and a link
     to its own page for the card data. A card can carry both; both are shown. */
  function reverseBlock(card) {
    var out = '';
    var lc = Faces.linked(card);

    if (lc) {
      var stats = statsFor(lc);
      out += '' +
        '<div class="backside">' +
          '<h3>Reverse — ' + esc(lc.name) + '</h3>' +
          '<div class="type-line">' +
            '<span class="badge plain">' + esc(lc.type_name) + '</span>' +
            (lc.subname ? '<span class="badge plain">' + esc(lc.subname) + '</span>' : '') +
            '<a class="badge plain" href="#/card/' + esc(lc.code) + '">' +
              esc(lc.code) + ' ↗</a>' +
          '</div>' +
          (lc.traits ? '<div class="traits">' + esc(lc.traits) + '</div>' : '') +
          (stats ? '<div class="stats">' + stats + '</div>' : '') +
          skillIconsHtml(lc) +
          (lc.text ? '<div class="textbox">' + text(lc.text) + '</div>' : '') +
          (lc.flavor ? '<div class="flavor">' + text(lc.flavor) + '</div>' : '') +
        '</div>';
    }

    if (card.back_text || card.back_flavor || card.back_name) {
      out += '' +
        '<div class="backside">' +
          '<h3>Reverse — ' + esc(card.back_name || card.name) + '</h3>' +
          (card.back_text ? '<div class="textbox">' + text(card.back_text) + '</div>' : '') +
          (card.back_flavor ? '<div class="flavor">' + text(card.back_flavor) + '</div>' : '') +
        '</div>';
    }

    return out;
  }

  /* A hidden card is a reverse ArkhamDB happens to file separately, so the page
     leads with what it actually is. It does not name the card it is the back of:
     the link only points forwards in the API, and answering it the other way
     round would mean hunting for whichever card points here. */
  function hiddenNote(card) {
    if (!Faces.isHidden(card)) return '';
    return '' +
      '<div class="note note-hidden">' +
        '<strong>Hidden card.</strong> This is the reverse of another card, ' +
        'not one that is drawn, searched for or added to a deck on its own.' +
      '</div>';
  }

  function detailHtml(card) {
    var fac = facClass(card.faction_code);
    /* Both faces here: the flip button turns the sheet over instead of swapping
       a src, so the reverse has to be in the DOM. Cards without a printed back
       get the generic deck back, same as the full-screen viewer. */
    var art = Card3D.html(card, { back: true, id: 'art-card' });

    var stats = statsFor(card);
    var backBlock = reverseBlock(card);

    var meta = '' +
      metaCell('Pack',
        symbolHtml(GameIcons.pack(card.pack_code), card.pack_name) +
        '<a href="#/pack/' + esc(card.pack_code) + '">' + esc(card.pack_name) + '</a>') +
      metaCell('Card number', esc(card.pack_name) + ' #' + esc(String(card.position))) +
      metaCell('Encounter set', card.encounter_name
        ? symbolHtml(GameIcons.set(card.encounter_code), card.encounter_name) + esc(card.encounter_name)
        : '') +
      metaCell('Quantity in pack', card.quantity != null ? esc(String(card.quantity)) : '') +
      metaCell('Deck limit', card.deck_limit != null ? esc(String(card.deck_limit)) : '') +
      metaCell('Deck size', card.deck_requirements && card.deck_requirements.size != null
        ? esc(String(card.deck_requirements.size)) : '') +
      metaCell('Deck requirements', deckRequirements(card)) +
      metaCell('Slot', card.slot ? esc(card.slot) : '') +
      metaCell('Restricted to', cardRefs(restrictedCodes(card))) +
      metaCell('Back side', cardRefs(card.linked_to_code)) +
      metaCell('Alternate of', cardRefs(card.alternate_of_code)) +
      metaCell('Alternated by', cardRefs(card.alternated_by)) +
      metaCell('Duplicate of', cardRefs(card.duplicate_of_code)) +
      metaCell('Duplicated by', cardRefs(card.duplicated_by)) +
      metaCell('Illustrator', card.illustrator ? esc(card.illustrator) : '') +
      metaCell('Errata', errataDate(card.errata_date)) +
      metaCell('On ArkhamDB',
        '<a href="' + esc(card.url || (API.origin + '/card/' + card.code)) +
        '" target="_blank" rel="noopener">' + esc(card.code) + ' ↗</a>') +
      metaCell('API endpoint',
        '<a href="' + esc(API.cardUrl(card.code)) +
        '" target="_blank" rel="noopener">/card/' + esc(card.code) + ' ↗</a>');

    var flags = [];
    if (card.is_unique) flags.push('Unique');
    if (card.permanent) flags.push('Permanent');
    if (card.exceptional) flags.push('Exceptional');
    if (card.myriad) flags.push('Myriad');
    if (card.subtype_name) flags.push(card.subtype_name);

    return '' +
      '<div class="detail">' +
        '<aside class="detail-art">' +
          '<div class="frame' + (isLandscape(card) ? ' landscape' : '') +
            (art ? ' frame-3d' : '') + '" ' +
            'id="art-frame" role="button" tabindex="0" ' +
            'aria-label="Open ' + esc(card.name) + ' in the 3D viewer">' +
            (art || '<div class="noimg">No image available</div>') + '</div>' +
          '<div class="frame-hint">Hover to tilt · click to inspect in 3D</div>' +
          (art ? '<button class="btn-ghost flip-btn" id="flip">Flip card ⤾</button>' : '') +
        '</aside>' +

        '<div class="detail-body">' +
          '<div class="detail-title">' +
            '<h1>' + (card.is_unique
              ? Markup.iconHtml('unique', 'unique', 'Unique', 'unique') : '') +
              esc(card.name) + '</h1>' +
            (card.subname ? '<div class="sub">' + esc(card.subname) + '</div>' : '') +
            '<div class="type-line">' +
              '<span class="badge txt-' + fac + '">' +
                (Markup.hasFactionIcon(card.faction_code)
                  ? Markup.iconHtml(card.faction_code, '', '', 'badge-ico') : '') +
                esc(card.faction_name || 'Neutral') + '</span>' +
              '<span class="badge plain">' + esc(card.type_name) + '</span>' +
              (Faces.isHidden(card) ? '<span class="badge warn">Hidden</span>' : '') +
              (card.xp != null ? '<span class="badge plain">Level ' + esc(String(card.xp)) + '</span>' : '') +
              flags.map(function (f) {
                return '<span class="badge plain">' + esc(f) + '</span>';
              }).join('') +
            '</div>' +
            (card.traits ? '<div class="traits" style="margin-top:14px">' + esc(card.traits) + '</div>' : '') +
          '</div>' +

          hiddenNote(card) +

          (stats ? '<div class="stats">' + stats + '</div>' : '') +
          skillIconsHtml(card) +

          (card.text ? '<div class="textbox">' + text(card.text) + '</div>' : '') +
          (card.flavor ? '<div class="flavor">' + text(card.flavor) + '</div>' : '') +
          backBlock +

          '<div class="meta">' +
            '<h3>Card data</h3>' +
            '<div class="meta-grid">' + meta + '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      /* Fixed to the viewport, so it sits outside the grid rather than in a
         column of it. Being part of this markup is what scopes it to the
         route: the next render replaces the view and the bubble goes with it. */
      AskClaude.bubbleHtml(card);
  }

  /* When the reverse is a card of its own, the button names it — the flip is the
     only place the page shows that the two records are one card. */
  function wireFlip(card) {
    var btn = document.getElementById('flip');
    var stage = document.getElementById('art-card');
    if (!btn || !stage) return;

    var name = Faces.back(card).name;
    var toBack = name ? 'Flip to ' + name + ' ⤾' : 'Flip card ⤾';

    btn.textContent = toBack;
    btn.addEventListener('click', function () {
      btn.textContent = Card3D.flip(stage) ? 'Show front ⤾' : toBack;
    });
  }

  function wireViewer(card) {
    var frame = document.getElementById('art-frame');
    if (!frame) return;

    /* The viewer opens on the face the page is showing: a card turned over here
       and then clicked is a request to inspect that side, not the front. */
    function open() {
      Viewer.open(card, { flipped: Card3D.isFlipped(document.getElementById('art-card')) });
    }

    Card3D.bind(frame);
    frame.addEventListener('click', open);
    frame.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  }

  /* ---------- scroll memory ---------- */

  function rememberScroll() {
    scrollMemory[location.hash || '#/'] = { y: window.scrollY, shown: state.shown };
  }

  function restoreScroll(key) {
    var mem = scrollMemory[key];
    var y = mem ? mem.y : 0;

    /* A fresh grid only holds the first batch, so the document is far shorter
       than it was when we left. Re-render up to the batch the user had reached,
       otherwise the jump lands short and the observer walks down in steps. */
    if (mem && mem.shown > state.shown) {
      var pool = state.filtered || [];
      while (state.shown < mem.shown && state.shown < pool.length) appendBatch();
    }

    /* Jump, never animate — even if something re-enables smooth scrolling. */
    var root = document.documentElement;
    var previous = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto';
    window.scrollTo(0, y);
    root.style.scrollBehavior = previous;
  }

  /* ---------- card language ---------- */

  /* ArkhamDB keeps every translation on its own subdomain, so the picker really
     chooses which host the app talks to. API.setLocale drops its caches; these
     are the copies this layer kept, and they have to go with them. */
  /* The button carries the code, the panel the native name: two letters keep the
     trigger the same width in every language, and "Українська" would not have
     fit the bar anyway. */
  function buildLangPicker() {
    if (!langMenu) return;
    var current = API.getLocale();
    html(langMenu, API.locales.map(function (l) {
      var on = l.code === current;
      return '<button type="button" class="pop-item' + (on ? ' on' : '') + '"' +
        ' role="option" aria-selected="' + (on ? 'true' : 'false') + '"' +
        ' data-code="' + esc(l.code) + '">' +
        '<span class="pop-tick" aria-hidden="true">✓</span>' +
        '<span class="pop-name">' + esc(l.label) + '</span>' +
        '<span class="pop-note">' + esc(l.code.toUpperCase()) + '</span>' +
      '</button>';
    }).join(''));
    if (langNow) langNow.textContent = current.toUpperCase();
  }

  function closeLang() {
    if (!langMenu || langMenu.hidden) return;
    langMenu.hidden = true;
    langBtn.classList.remove('on');
    langBtn.setAttribute('aria-expanded', 'false');
  }

  function toggleLang() {
    var open = langMenu.hidden;
    if (open) { closePicker(); closeSort(); closeGroup(); closeNav(); }   // all hang off the header
    langMenu.hidden = !open;
    langBtn.classList.toggle('on', open);
    langBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function changeLang(code) {
    closeLang();
    if (!API.setLocale(code)) return;

    homeData = null;
    packList = [];
    packIndex = Object.create(null);
    pickerBuilt = false;      // pack names in the picker are translated too
    state.cards = [];
    state.filtered = [];
    /* Facet memory is codes, not labels, so it survives — the chips a pack was
       left on still mean the same thing in the new language. */
    buildLangPicker();
    route();
  }

  /* ---------- router ---------- */

  function route() {
    if (state.observer) { state.observer.disconnect(); state.observer = null; }
    Viewer.close();   // a back/forward press while the preview is open should dismiss it
    SymViewer.close();
    closePicker();
    closeSort();
    closeGroup();
    closeLang();
    closeNav();

    var current = location.hash || '#/';
    if (current !== lastHash) { prevHash = lastHash; lastHash = current; }

    var hash = current.replace(/^#\/?/, '');
    var parts = hash.split('/').filter(Boolean);

    /* Only the card browser — the index or a pack's grid — is somewhere the box
       can return to once it is emptied. */
    if (!parts.length || parts[0] === 'pack') preSearchHash = current;
    syncSearchInput();
    syncNav();

    if (!parts.length) return renderBrowser([], '');       // the index browses every card
    if (parts[0] === 'packs') return renderHome();
    if (parts[0] === 'resources') return renderResources();
    if (parts[0] === 'search') return renderSearch(decodeURIComponent(parts[1] || '').toLowerCase());
    if (parts[0] === 'pack' && parts[1]) return renderPack(decodeURIComponent(parts[1]));
    if (parts[0] === 'card' && parts[1]) return renderCard(decodeURIComponent(parts[1]));

    showBack(false);
    showFilters(false);
    html(view,
      '<div class="state error">' +
        '<div class="mono-tag">Uncharted route</div>' +
        '<div class="msg">Nothing is filed under “' + esc(hash) + '”.</div>' +
        '<a class="btn-ghost" href="#/">Back to the cards</a>' +
      '</div>');
  }

  /* ---------- wiring ---------- */

  /* The field only ever mirrors the search route: everywhere else it sits
     empty, ready to take the collection-wide query.

     Never while it has focus, though. Typing rewrites the hash, and the
     hashchange it triggers can land a whole render later — long enough on a
     phone for more characters to have been typed. Writing the by-then stale
     term back would truncate them, and doing it mid-composition (which is most
     of the time on a soft keyboard, where the word is only committed when the
     keyboard closes) drops the pending word altogether. */
  function syncSearchInput() {
    if (document.activeElement === searchInput) return;
    var parts = routeParts();
    searchInput.value = parts[0] === 'search'
      ? decodeURIComponent(parts[1] || '') : '';
  }

  /* A submitted term rewrites the search route in place rather than pushing an
     entry per query; only the jump onto the route, and the way back off it, are
     history the Back button should see. */
  function runSearch(q) {
    if (isSearch()) {
      if (!q) { location.hash = preSearchHash || '#/'; return; }
      if (q === state.query) return;
      state.query = q;
      lastHash = lastGrid = searchHash(q);
      history.replaceState(null, '', lastHash);
      applyFilters();
    } else if (q) {
      location.hash = searchHash(q);      // routes, and renderSearch takes it from there
    }
  }

  function currentQuery() { return searchInput.value.trim().toLowerCase(); }

  /* The query runs when it is submitted, never while it is being typed: every
     search is a full pass over the whole card pool, and re-running it per
     keystroke burns work on terms the user never meant to look up. */
  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {         // and the phone keyboard's Go key: search, then get out of the way
      e.preventDefault();
      runSearch(currentQuery());
      searchInput.blur();
      return;
    }
    if (e.key !== 'Escape') return;
    searchInput.value = '';
    runSearch('');
  });

  /* type=search fires this on the native × as well as on Enter, and clearing
     the box that way is a submission of the empty term — the way back off the
     search route. */
  searchInput.addEventListener('search', function () {
    runSearch(currentQuery());
  });

  /* The grid we came from is one entry back, so going back keeps the forward
     stack intact instead of piling a second copy of the grid on top of it. */
  backBtn.addEventListener('click', function (e) {
    if (prevHash && prevHash === backBtn.getAttribute('href')) {
      e.preventDefault();
      history.back();
    }
  });

  filtersBtn.addEventListener('click', function () {
    filtersOpen = !filtersOpen;
    filterbar.hidden = !filtersOpen;
    filtersBtn.setAttribute('aria-expanded', filtersOpen ? 'true' : 'false');
    if (!filtersOpen) { closePicker(); closeSort(); closeGroup(); }   // their triggers just left
    syncHeadHeight();
  });

  filterbar.addEventListener('click', function (e) {
    var remove = e.target.closest('.pp-x');
    if (remove) {
      setPacks(state.packs.filter(function (c) { return c !== remove.dataset.code; }));
      return;
    }
    if (e.target.closest('#fb-add')) { togglePicker(); return; }
    if (e.target.closest('#facet-clear')) { clearFacets(); return; }
    /* Styled as a facet but wired to its own flag, so it has to be caught
       before the generic facet branch below. */
    if (e.target.closest('.toggle-replaced')) { toggleReplaced(); return; }

    /* Styled as a facet, so it has to be caught before the generic branch. */
    if (e.target.closest('#sort-btn')) { toggleSort(); return; }
    if (e.target.closest('#group-btn')) { toggleGroup(); return; }

    var btn = e.target.closest('.facet');
    if (!btn) return;
    var list = facetList(btn.dataset.group);
    var at = list.indexOf(btn.dataset.value);
    if (at === -1) list.push(btn.dataset.value); else list.splice(at, 1);
    btn.classList.toggle('on', at === -1);
    btn.setAttribute('aria-pressed', at === -1 ? 'true' : 'false');
    syncFilterCount();
    applyFilters();
  });

  /* The slider lives in a bar that is rewritten wholesale on every filter
     change, so the handler rides the bar rather than the input. */
  filterbar.addEventListener('input', function (e) {
    var range = e.target.closest('#tile-size');
    if (!range) return;
    setTileSize(parseInt(range.value, 10));
    range.setAttribute('aria-valuetext', tileSize + ' pixels');
  });

  /* The picker stays open across picks so several packs can go in at once. */
  pickerList.addEventListener('click', function (e) {
    var item = e.target.closest('.pp-item');
    if (item) togglePack(item.dataset.code);
  });

  pickerTools.addEventListener('click', function (e) {
    if (e.target.closest('.toggle-replaced')) toggleReplaced();
  });

  pickerQ.addEventListener('input', function () {
    filterPicker(pickerQ.value.trim().toLowerCase());
  });

  navToggle.addEventListener('click', toggleNav);

  if (langBtn && langMenu) {
    langBtn.addEventListener('click', toggleLang);
    langMenu.addEventListener('click', function (e) {
      var item = e.target.closest('.pop-item');
      if (item) changeLang(item.dataset.code);
    });
  }

  if (sortMenu) {
    sortMenu.addEventListener('click', function (e) {
      var item = e.target.closest('.pop-item');
      if (item) setSort(item.dataset.sort);
    });
  }

  if (groupMenu) {
    groupMenu.addEventListener('click', function (e) {
      var item = e.target.closest('.pop-item');
      if (item) setGroup(item.dataset.group);
    });
  }

  /* Tapping the section you are already on routes nowhere, so the menu has to
     shut itself rather than wait for a hashchange. */
  navLinks.addEventListener('click', function (e) {
    if (e.target.closest('a')) closeNav();
  });

  /* Registered once against #view rather than per render: the element is reused
     across routes and only its contents are replaced, so a listener added in
     renderResources would stack up a copy per visit. */
  view.addEventListener('click', function (e) {
    var tile = e.target.closest && e.target.closest('.sym-tile');
    if (!tile) return;
    SymViewer.open({
      url: tile.dataset.sym,
      name: tile.dataset.name,
      set: tile.dataset.set
    });
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!picker.hidden) closePicker();
    closeSort();
    closeGroup();
    closeLang();
    closeNav();
  });

  document.addEventListener('pointerdown', function (e) {
    if (!picker.hidden &&
        !e.target.closest('#pack-picker') && !e.target.closest('#fb-add')) closePicker();
    if (!e.target.closest('#sort-menu') && !e.target.closest('#sort-btn')) closeSort();
    if (!e.target.closest('#group-menu') && !e.target.closest('#group-btn')) closeGroup();
    if (!e.target.closest('#lang-wrap')) closeLang();
    if (!e.target.closest('#nav-links') && !e.target.closest('#nav-toggle')) closeNav();
  });

  document.addEventListener('click', function (e) {
    var link = e.target.closest && e.target.closest('a[href^="#/"]');
    if (link) rememberScroll();
  }, true);

  /* A panel is placed against where its button was when it opened. Scrolling
     the rail, or resizing the window, moves the button out from under it —
     close rather than leave a panel pointing at nothing. */
  function closePanels() { closeSort(); closeGroup(); closePicker(); }
  filterbar.addEventListener('scroll', closePanels, { passive: true });

  window.addEventListener('resize', function () {
    syncHeadHeight();
    closePanels();
  });
  if (window.ResizeObserver) new ResizeObserver(syncHeadHeight).observe(head);

  window.addEventListener('hashchange', route);

  if (!location.hash) location.replace('#/');
  buildLangPicker();
  syncHeadHeight();
  route();
})();
