/* Arkham Grimoire — hash-routed SPA over the ArkhamDB API. */
(function () {
  'use strict';

  var view = document.getElementById('view');
  var head = document.getElementById('site-head');
  var searchWrap = document.getElementById('search-wrap');
  var searchInput = document.getElementById('search');
  var replacedBtn = document.getElementById('toggle-replaced');
  var backBtn = document.getElementById('back-btn');
  var filterbar = document.getElementById('filterbar');
  var fbGroups = document.getElementById('fb-groups');
  var filtersBtn = document.getElementById('filters-toggle');
  var filtersN = document.getElementById('filters-n');
  var picker = document.getElementById('pack-picker');
  var pickerQ = document.getElementById('pp-q');
  var pickerList = document.getElementById('pp-list');

  var esc = Markup.escapeHtml;
  var text = Markup.renderText;
  var facClass = Markup.factionClass;

  var BATCH = 60;
  var LANDSCAPE = ['investigator', 'act', 'agenda', 'scenario'];

  /* Cycle names, keyed by cycle_position. Packs only carry the position, and
     /api/public/cycles/ is returning 500, so these mirror the upstream
     arkhamdb-json-data cycle list; the live endpoint overrides them if it comes
     back. Positions 50 and up are ArkhamDB's grouping buckets, not real cycles. */
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

  function cycleLabel(position, group, live) {
    if (live && live[position]) return live[position];
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

  var state = {
    token: 0,        // invalidates in-flight renders when the route changes
    packs: [],       // selected pack codes; empty means "every pack"
    cards: [],       // cards for the current pack selection
    shown: 0,
    query: '',
    types: [],       // selected type_codes; empty means "no type filter"
    factions: [],    // selected faction_codes; empty means "no faction filter"
    levels: [],      // selected xp values, as strings; empty means "no level filter"
    observer: null
  };
  var scrollMemory = Object.create(null);
  var filterMemory = Object.create(null);   // pack key -> {query, types, factions, levels}

  var packIndex = Object.create(null);      // pack code -> pack
  var packList = [];                        // packs in catalogue order
  var pickerBuilt = false;

  var lastHash = location.hash || '#/';
  var prevHash = null;                      // the route we arrived from
  var lastGrid = null;                      // last card-browser hash, for the back button
  var filtersOpen = true;

  /* The 43 packs the Investigator/Campaign Expansions superseded. Shown by
     default; the topbar toggle drops them for a collection-shaped catalogue. */
  var showReplaced = true;
  var homeData = null;                      // {packs, cycles}; lets the toggle repaint without refetching
  /* chapter/cycle -> true. Cycle positions are unique across chapters, so one
     flat map is enough. Both survive repaints and re-entering the home route. */
  var collapsedChapters = Object.create(null);
  var collapsedCycles = Object.create(null);

  /* ---------- helpers ---------- */

  function html(el, markup) { el.innerHTML = markup; }

  function loading(label) {
    html(view, '<div class="state"><div class="spinner"></div>' +
      '<div class="mono-tag">' + esc(label) + '</div></div>');
  }

  function failure(err) {
    html(view,
      '<div class="state error">' +
        '<div class="mono-tag">Signal lost</div>' +
        '<div class="msg">' + esc(err && err.message ? err.message : String(err)) + '</div>' +
        '<a class="btn-ghost" href="#/">Back to packs</a>' +
      '</div>');
  }

  function showSearch(show, placeholder) {
    searchWrap.hidden = !show;
    if (show) searchInput.placeholder = placeholder || 'Filter cards…';
    else searchInput.value = '';
  }

  function showBack(show, href) {
    backBtn.hidden = !show;
    if (show) backBtn.setAttribute('href', href || '#/');
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

  /* The superseded-packs toggle lives in the topbar, so it outlives the view
     re-renders — it only needs showing on the home route. */
  function showReplacedToggle(show) {
    replacedBtn.hidden = !show;
    if (!show) return;
    replacedBtn.classList.toggle('on', showReplaced);
    replacedBtn.setAttribute('aria-pressed', showReplaced ? 'true' : 'false');
  }

  function isLandscape(card) { return LANDSCAPE.indexOf(card.type_code) !== -1; }

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

  /* ---------- home: pack list ---------- */

  function renderHome() {
    var token = ++state.token;
    showSearch(false);
    showBack(false);
    showFilters(false);
    loading('Consulting the index');

    if (homeData) { paintHome(); restoreScroll('#/'); return; }

    Promise.all([API.getPacks(), API.getCycles()]).then(function (res) {
      if (token !== state.token) return;
      homeData = { packs: res[0], cycles: res[1] };
      indexPacks(res[0]);
      paintHome();
      restoreScroll('#/');
    }).catch(function (err) { if (token === state.token) failure(err); });
  }

  /* Split off from renderHome so the "superseded packs" toggle can repaint
     without refetching or flashing the spinner. */
  function paintHome() {
    var all = homeData.packs;
    var packs = showReplaced ? all : all.filter(function (p) { return p.replaced !== true; });
    var replacedCount = all.reduce(function (n, p) { return n + (p.replaced === true ? 1 : 0); }, 0);
    var total = packs.reduce(function (n, p) { return n + (p.known || 0); }, 0);

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
    chapters.sort(function (a, b) { return a - b; });

    var out = '' +
      '<div class="pack-grid" style="margin-bottom:8px">' +
        '<a class="pack-card featured glass-card" href="#/pack/_all">' +
          '<div class="pc-body">' +
            '<div class="pc-top">' +
              '<div>' +
                '<div class="pc-name">All Cards</div>' +
                '<p class="body-md" style="margin-top:8px;max-width:52ch">' +
                  'The complete pool — player cards and encounter cards, no pack filter. ' +
                  'Large download; give it a moment.</p>' +
              '</div>' +
              '<span class="pc-code">/ALL</span>' +
            '</div>' +
            '<div class="pc-foot">' +
              '<span class="pc-count">' + packs.length + ' packs · ' +
                total.toLocaleString() + ' cards</span>' +
              '<span class="pc-arr">→</span>' +
            '</div>' +
          '</div>' +
        '</a>' +
      '</div>';

    chapters.forEach(function (ch) {
      var bucket = byChapter[ch];
      var meta = CHAPTERS[ch] || { label: 'Chapter ' + ch, note: '' };
      var n = bucket.order.reduce(function (sum, cyc) { return sum + bucket.groups[cyc].length; }, 0);

      var body = '';
      bucket.order.forEach(function (cyc) {
        var group = bucket.groups[cyc];
        var label = cycleLabel(cyc, group, homeData.cycles);
        body += '' +
          '<details class="cycle" data-cycle="' + esc(String(cyc)) + '"' +
              (collapsedCycles[cyc] ? '' : ' open') + '>' +
            '<summary class="section-head">' +
              '<span class="cy-chev" aria-hidden="true"></span>' +
              '<span class="cy-title">' + esc(label) + '</span>' +
              '<span class="mono-tag">Cycle ' + esc(String(cyc)) + ' — ' + group.length +
                (group.length === 1 ? ' pack' : ' packs') + '</span>' +
            '</summary>' +
            '<div class="pack-grid">' +
              group.map(packCardHtml).join('') +
            '</div>' +
          '</details>';
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

    replacedBtn.querySelector('.tt-n').textContent = replacedCount;
    showReplacedToggle(true);

    /* `toggle` does not bubble, so each disclosure needs its own listener. */
    view.querySelectorAll('.chapter').forEach(function (det) {
      det.addEventListener('toggle', function () {
        if (det.open) delete collapsedChapters[det.dataset.chapter];
        else collapsedChapters[det.dataset.chapter] = true;
      });
    });
    view.querySelectorAll('.cycle').forEach(function (det) {
      det.addEventListener('toggle', function () {
        if (det.open) delete collapsedCycles[det.dataset.cycle];
        else collapsedCycles[det.dataset.cycle] = true;
      });
    });
  }

  function packCardHtml(p) {
    var count = p.known || 0;
    var released = releaseDate(p.available);
    /* Covers are keyed by FFG product code, so packs FFG never boxed on their
       own (novellas, side stories) simply render without one. */
    var cover = PackCovers.url(p.code);
    var ffg = PackCovers.ffgCode(p.code);
    return '' +
      '<a class="pack-card glass-card' + (cover ? '' : ' no-cover') +
          '" href="#/pack/' + esc(p.code) + '">' +
        (cover
          ? '<div class="pc-cover">' +
              '<img src="' + esc(cover) + '" alt="" loading="lazy" decoding="async">' +
            '</div>'
          : '') +
        '<div class="pc-body">' +
          '<div class="pc-top">' +
            '<span class="pc-name">' + esc(p.name) + '</span>' +
            /* FFG's SKU reads better than the ArkhamDB slug; the slug is still
               in the link, and in the tooltip for the packs FFG never boxed. */
            '<span class="pc-code" title="' + esc(p.code) + '">' + esc(ffg || p.code) + '</span>' +
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

  /* ---------- pack: card grid ---------- */

  /* The route carries the pack filter: a comma-separated list of pack codes,
     or `_all` for the unfiltered pool. Picking a pack on the home page is just
     a pre-filled version of the pack filter the card browser exposes. */
  function packKey(codes) { return codes.length ? codes.join(',') : '_all'; }

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
    var token = ++state.token;
    var codes = parsePacks(spec);

    showSearch(false);
    showBack(false);
    showReplacedToggle(false);
    showFilters(false);
    loading(codes.length ? 'Opening the pack' : 'Gathering the whole collection');

    Promise.all([API.getPacks(), loadCards(codes)]).then(function (res) {
      if (token !== state.token) return;

      indexPacks(res[0]);
      state.packs = codes;
      state.cards = res[1];
      state.shown = 0;

      /* Restore whatever was selected last time this pack set was open, so
         opening a card and coming back doesn't wipe the filters. */
      var saved = filterMemory[packKey(codes)] ||
                  { query: '', types: [], factions: [], levels: [] };
      state.query = saved.query;
      state.types = saved.types.slice();
      state.factions = saved.factions.slice();
      state.levels = saved.levels.slice();

      html(view,
        '<div class="card-grid" id="card-grid"></div>' +
        '<div class="sentinel" id="sentinel"></div>' +
        '<div id="grid-empty"></div>');

      showSearch(true, 'Filter ' + state.cards.length + ' cards…');
      searchInput.value = state.query;
      buildPicker();
      renderFilterbar();
      showFilters(true);
      Card3D.bind(document.getElementById('card-grid'));   // delegated: covers later batches

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
    lastHash = lastGrid = '#/pack/' + packKey(codes);
    history.replaceState(null, '', lastHash);

    renderFilterbar();               // the pills answer immediately
    filterbar.classList.add('busy');

    loadCards(codes).then(function (cards) {
      if (token !== state.token) return;
      filterbar.classList.remove('busy');
      state.cards = cards;
      searchInput.placeholder = 'Filter ' + cards.length + ' cards…';
      pruneFilters();
      renderFilterbar();
      applyFilters();
    }).catch(function (err) {
      if (token !== state.token) return;
      filterbar.classList.remove('busy');
      failure(err);
    });
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
            glyph + esc(it.label) + '<span class="n">' + it.count + '</span></button>';
        }).join('') +
      '</div>';
  }

  function packGroupHtml() {
    var pills = state.packs.length
      ? state.packs.map(function (code) {
          var name = packName(code);
          return '<span class="pack-pill">' + esc(name) +
            '<button type="button" class="pp-x" data-code="' + esc(code) + '"' +
            ' aria-label="Remove ' + esc(name) + '">×</button></span>';
        }).join('')
      : '<span class="pack-pill all">All packs</span>';

    return '' +
      '<div class="fb-group fb-packs">' +
        '<span class="fb-label">Packs</span>' + pills +
        '<button type="button" class="fb-add" id="fb-add" aria-expanded="false"' +
          ' aria-controls="pack-picker">+ Pack</button>' +
      '</div>';
  }

  function renderFilterbar() {
    var cards = state.cards;
    html(fbGroups,
      packGroupHtml() +
      facetGroup('Level', 'level', levelFacets(cards), state.levels, false) +
      facetGroup('Type', 'type',
        facetsOf(cards, 'type_code', 'type_name', TYPE_ORDER), state.types, false) +
      facetGroup('Class', 'faction',
        facetsOf(cards, 'faction_code', 'faction_name', FACTION_ORDER), state.factions, true) +
      '<div class="fb-group fb-tail">' +
        '<span class="chip" id="count-chip">' + cards.length + ' cards</span>' +
        '<button type="button" class="facet-clear" id="facet-clear" hidden>Clear filters</button>' +
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
          }), homeData && homeData.cycles)) + '</div>';
      }
      out += '<button type="button" class="pp-item" data-code="' + esc(p.code) + '"' +
        ' data-name="' + esc(p.name.toLowerCase() + ' ' + p.code) + '">' +
        '<span class="pp-tick" aria-hidden="true">✓</span>' +
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
      var hit = !q || el.dataset.name.indexOf(q) !== -1;
      el.hidden = !hit;
      if (hit && current) groups[current.dataset.cycle] = true;
    });
    pickerList.querySelectorAll('.pp-head').forEach(function (h) {
      h.hidden = !groups[h.dataset.cycle];
    });
  }

  function openPicker() {
    picker.hidden = false;
    var add = document.getElementById('fb-add');
    if (add) add.setAttribute('aria-expanded', 'true');
    pickerQ.value = '';
    filterPicker('');
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

  /* ---------- filtering ---------- */

  /* Toggles inside a group are OR'd; the groups and the text box are AND'd. */
  function passes(card) {
    if (state.types.length && state.types.indexOf(card.type_code) === -1) return false;
    if (state.factions.length && state.factions.indexOf(card.faction_code) === -1) return false;
    if (state.levels.length && state.levels.indexOf(String(card.xp)) === -1) return false;
    return matches(card, state.query);
  }

  function applyFilters() {
    var grid = document.getElementById('card-grid');
    if (!grid) return;

    filterMemory[packKey(state.packs)] = {
      query: state.query,
      types: state.types.slice(),
      factions: state.factions.slice(),
      levels: state.levels.slice()
    };

    state.filtered = state.cards.filter(passes);
    state.shown = 0;
    grid.innerHTML = '';

    var facets = state.types.length + state.factions.length + state.levels.length;

    var chip = document.getElementById('count-chip');
    if (chip) {
      chip.textContent = (state.query || facets)
        ? state.filtered.length + ' of ' + state.cards.length + ' cards'
        : state.cards.length + ' cards';
    }

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
    grid.insertAdjacentHTML('beforeend', slice.map(tileHtml).join(''));
    state.shown += slice.length;
  }

  function tileHtml(card) {
    var fac = facClass(card.faction_code);
    var sub = card.subname || '';
    /* Front face only: a tile never rotates past 90°, so the reverse would be
       a second image request for pixels nobody sees. */
    var art = Card3D.html(card, { lazy: true, 'class': 'tile-img' }) ||
      '<div class="tile-img' + (isLandscape(card) ? ' landscape' : '') + '">' +
        '<span class="noimg">No image</span></div>';

    var facMark = Markup.hasFactionIcon(card.faction_code)
      ? Markup.iconHtml(card.faction_code, fac, card.faction_name, 'tile-fac')
      : '<span class="fac fac-' + fac + '" title="' + esc(card.faction_name || 'Neutral') + '"></span>';

    return '' +
      '<a class="card-tile" href="#/card/' + esc(card.code) + '">' +
        art +
        '<div class="tile-name">' +
          facMark +
          '<span>' + esc(card.name) + '</span>' +
        '</div>' +
        (sub ? '<div class="tile-sub">' + esc(sub) + '</div>' : '') +
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
    showSearch(false);
    showReplacedToggle(false);
    showFilters(false);
    /* Whatever grid we came from, filters and all — falling back to the card's
       own pack for a cold link straight into a card. */
    showBack(true, lastGrid || '#/');
    loading('Retrieving the card');

    API.getCard(code).then(function (card) {
      if (token !== state.token) return;

      if (!lastGrid) showBack(true, '#/pack/' + card.pack_code);
      html(view, detailHtml(card));
      wireFlip(card);
      wireViewer(card);
      restoreScroll(location.hash);
    }).catch(function (err) { if (token === state.token) failure(err); });
  }

  /* stat kinds that the Arkham icon font actually has a glyph for */
  var STAT_ICONS = {
    willpower: 'willpower', intellect: 'intellect',
    combat: 'combat', agility: 'agility'
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

  function detailHtml(card) {
    var fac = facClass(card.faction_code);
    /* Both faces here: the flip button turns the sheet over instead of swapping
       a src, so the reverse has to be in the DOM. Cards without a printed back
       get the generic deck back, same as the full-screen viewer. */
    var art = Card3D.html(card, { back: true, id: 'art-card' });

    var stats = statsFor(card);

    var backBlock = '';
    if (card.back_text || card.back_flavor || card.back_name) {
      backBlock = '' +
        '<div class="backside">' +
          '<h3>Reverse — ' + esc(card.back_name || card.name) + '</h3>' +
          (card.back_text ? '<div class="textbox">' + text(card.back_text) + '</div>' : '') +
          (card.back_flavor ? '<div class="flavor">' + text(card.back_flavor) + '</div>' : '') +
        '</div>';
    }

    var restrictions = '';
    if (card.restrictions && card.restrictions.investigator) {
      restrictions = Object.keys(card.restrictions.investigator).map(function (k) {
        return '<a href="#/card/' + esc(k) + '">' +
          esc(card.restrictions.investigator[k]) + '</a>';
      }).join(', ');
    }

    var meta = '' +
      metaCell('Pack', '<a href="#/pack/' + esc(card.pack_code) + '">' + esc(card.pack_name) + '</a>') +
      metaCell('Card number', esc(String(card.position)) + ' / ' + esc(card.code)) +
      metaCell('Encounter set', card.encounter_name ? esc(card.encounter_name) : '') +
      metaCell('Quantity in pack', card.quantity != null ? esc(String(card.quantity)) : '') +
      metaCell('Deck limit', card.deck_limit != null ? esc(String(card.deck_limit)) : '') +
      metaCell('Slot', card.slot ? esc(card.slot) : '') +
      metaCell('Restricted to', restrictions) +
      metaCell('Illustrator', card.illustrator ? esc(card.illustrator) : '') +
      metaCell('Errata', card.errata_date ? esc(card.errata_date) : '') +
      metaCell('On ArkhamDB',
        '<a href="' + esc(card.url || (API.origin + '/card/' + card.code)) +
        '" target="_blank" rel="noopener">' + esc(card.code) + ' ↗</a>');

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
              (card.xp != null ? '<span class="badge plain">Level ' + esc(String(card.xp)) + '</span>' : '') +
              flags.map(function (f) {
                return '<span class="badge plain">' + esc(f) + '</span>';
              }).join('') +
            '</div>' +
            (card.traits ? '<div class="traits" style="margin-top:14px">' + esc(card.traits) + '</div>' : '') +
          '</div>' +

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
      '</div>';
  }

  function wireFlip(card) {
    var btn = document.getElementById('flip');
    var stage = document.getElementById('art-card');
    if (!btn || !stage) return;
    btn.addEventListener('click', function () {
      var showingBack = Card3D.flip(stage);
      btn.textContent = showingBack ? 'Show front ⤾' : 'Flip card ⤾';
    });
  }

  function wireViewer(card) {
    var frame = document.getElementById('art-frame');
    if (!frame) return;
    Card3D.bind(frame);
    frame.addEventListener('click', function () { Viewer.open(card); });
    frame.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); Viewer.open(card); }
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

  /* ---------- router ---------- */

  function route() {
    if (state.observer) { state.observer.disconnect(); state.observer = null; }
    Viewer.close();   // a back/forward press while the preview is open should dismiss it
    closePicker();

    var current = location.hash || '#/';
    if (current !== lastHash) { prevHash = lastHash; lastHash = current; }

    var hash = current.replace(/^#\/?/, '');
    var parts = hash.split('/').filter(Boolean);

    if (!parts.length) return renderHome();
    if (parts[0] === 'pack' && parts[1]) return renderPack(decodeURIComponent(parts[1]));
    if (parts[0] === 'card' && parts[1]) return renderCard(decodeURIComponent(parts[1]));

    showSearch(false);
    showBack(false);
    showReplacedToggle(false);
    showFilters(false);
    html(view,
      '<div class="state error">' +
        '<div class="mono-tag">Uncharted route</div>' +
        '<div class="msg">Nothing is filed under “' + esc(hash) + '”.</div>' +
        '<a class="btn-ghost" href="#/">Back to packs</a>' +
      '</div>');
  }

  /* ---------- wiring ---------- */

  var debounce;
  searchInput.addEventListener('input', function () {
    clearTimeout(debounce);
    var q = searchInput.value.trim().toLowerCase();
    debounce = setTimeout(function () { state.query = q; applyFilters(); }, 140);
  });

  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { searchInput.value = ''; state.query = ''; applyFilters(); }
  });

  replacedBtn.addEventListener('click', function () {
    showReplaced = !showReplaced;
    paintHome();
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
    if (!filtersOpen) closePicker();
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

  /* The picker stays open across picks so several packs can go in at once. */
  pickerList.addEventListener('click', function (e) {
    var item = e.target.closest('.pp-item');
    if (item) togglePack(item.dataset.code);
  });

  pickerQ.addEventListener('input', function () {
    filterPicker(pickerQ.value.trim().toLowerCase());
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !picker.hidden) closePicker();
  });

  document.addEventListener('pointerdown', function (e) {
    if (picker.hidden) return;
    if (e.target.closest('#pack-picker') || e.target.closest('#fb-add')) return;
    closePicker();
  });

  document.addEventListener('click', function (e) {
    var link = e.target.closest && e.target.closest('a[href^="#/"]');
    if (link) rememberScroll();
  }, true);

  window.addEventListener('resize', syncHeadHeight);
  if (window.ResizeObserver) new ResizeObserver(syncHeadHeight).observe(head);

  window.addEventListener('hashchange', route);

  if (!location.hash) location.replace('#/');
  syncHeadHeight();
  route();
})();
