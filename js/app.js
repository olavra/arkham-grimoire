/* Arkham Grimoire — hash-routed SPA over the ArkhamDB API. */
(function () {
  'use strict';

  var view = document.getElementById('view');
  var crumb = document.getElementById('breadcrumb');
  var searchWrap = document.getElementById('search-wrap');
  var searchInput = document.getElementById('search');

  var esc = Markup.escapeHtml;
  var inline = Markup.renderInline;
  var text = Markup.renderText;
  var facClass = Markup.factionClass;

  var BATCH = 60;
  var LANDSCAPE = ['investigator', 'act', 'agenda', 'scenario'];

  /* Cycle names are derived from the pack list: the first pack of a cycle
     carries the cycle's name. /api/public/cycles/ is currently returning 500. */
  var CYCLE_LABELS = {
    50: 'Return To…',
    60: 'Investigator Starter Decks',
    61: 'Investigator Starter Decks',
    70: 'Standalone Scenarios',
    80: 'Novellas & Parallel Investigators',
    90: 'Promotional & Side Stories'
  };

  var state = {
    token: 0,        // invalidates in-flight renders when the route changes
    cards: [],       // cards for the current pack view
    shown: 0,
    query: '',
    observer: null
  };
  var scrollMemory = Object.create(null);

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

  function setCrumb(parts) {
    if (!parts || !parts.length) { crumb.hidden = true; crumb.innerHTML = ''; return; }
    crumb.hidden = false;
    html(crumb, parts.map(function (p) {
      return p.href ? '<a href="' + esc(p.href) + '">' + esc(p.label) + '</a>'
                    : '<span>' + esc(p.label) + '</span>';
    }).join('<span class="sep">/</span>'));
  }

  function showSearch(show, placeholder) {
    searchWrap.hidden = !show;
    if (show) searchInput.placeholder = placeholder || 'Filter cards…';
    else searchInput.value = '';
  }

  function isLandscape(card) { return LANDSCAPE.indexOf(card.type_code) !== -1; }

  function cardImage(card, back) {
    var src = API.imageUrl(back ? card.backimagesrc : card.imagesrc);
    return src;
  }

  function levelSuffix(card) {
    return (card.xp !== undefined && card.xp !== null) ? ' (' + card.xp + ')' : '';
  }

  /* ---------- home: pack list ---------- */

  function renderHome() {
    var token = ++state.token;
    setCrumb(null);
    showSearch(false);
    loading('Consulting the index');

    API.getPacks().then(function (packs) {
      if (token !== state.token) return;

      var cycles = [];
      var byCycle = Object.create(null);
      packs.forEach(function (p) {
        if (!byCycle[p.cycle_position]) {
          byCycle[p.cycle_position] = [];
          cycles.push(p.cycle_position);
        }
        byCycle[p.cycle_position].push(p);
      });

      var total = packs.reduce(function (n, p) { return n + (p.known || 0); }, 0);

      var out = '' +
        '<section class="hero">' +
          '<div class="hero-glow"></div>' +
          '<span class="eyebrow"><span class="dt"></span>Arkham Horror: The Card Game</span>' +
          '<h1 class="h-display">The <span class="grd">Grimoire</span></h1>' +
          '<p class="body-lg">Every card in the collection, pack by pack. ' +
            'Pick a set below, or open the whole pool at once.</p>' +
          '<div class="hero-meta">' +
            '<span>' + packs.length + ' Packs</span>' +
            '<span class="sep"></span>' +
            '<span>' + total.toLocaleString() + ' Cards Indexed</span>' +
            '<span class="sep"></span>' +
            '<span>Data via ArkhamDB</span>' +
          '</div>' +
        '</section>' +

        '<div class="pack-grid" style="margin-bottom:8px">' +
          '<a class="pack-card featured glass-card" href="#/pack/_all">' +
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
              '<span class="pc-count">Browse everything</span>' +
              '<span class="pc-arr">→</span>' +
            '</div>' +
          '</a>' +
        '</div>';

      cycles.forEach(function (cyc) {
        var group = byCycle[cyc];
        var label = CYCLE_LABELS[cyc] || group[0].name;
        out += '' +
          '<div class="section-head">' +
            '<h2>' + esc(label) + '</h2>' +
            '<span class="mono-tag">Cycle ' + esc(String(cyc)) + ' — ' + group.length +
              (group.length === 1 ? ' pack' : ' packs') + '</span>' +
          '</div>' +
          '<div class="pack-grid">' +
            group.map(packCardHtml).join('') +
          '</div>';
      });

      html(view, out);
      restoreScroll('#/');
    }).catch(function (err) { if (token === state.token) failure(err); });
  }

  function packCardHtml(p) {
    var count = p.known || 0;
    return '' +
      '<a class="pack-card glass-card" href="#/pack/' + esc(p.code) + '">' +
        '<div class="pc-top">' +
          '<span class="pc-name">' + esc(p.name) + '</span>' +
          '<span class="pc-code">' + esc(p.code) + '</span>' +
        '</div>' +
        '<div class="pc-foot">' +
          '<span class="pc-count">' + count + (count === 1 ? ' card' : ' cards') + '</span>' +
          '<span class="pc-arr">→</span>' +
        '</div>' +
      '</a>';
  }

  /* ---------- pack: card grid ---------- */

  function renderPack(code) {
    var token = ++state.token;
    var isAll = code === '_all';
    state.query = '';

    setCrumb([{ label: 'Packs', href: '#/' }, { label: isAll ? 'All Cards' : code }]);
    showSearch(false);
    loading(isAll ? 'Gathering the whole collection' : 'Opening the pack');

    Promise.all([API.getPacks(), API.getCards(code)]).then(function (res) {
      if (token !== state.token) return;

      var packs = res[0], cards = res[1];
      var pack = null;
      for (var i = 0; i < packs.length; i++) if (packs[i].code === code) pack = packs[i];

      var title = isAll ? 'All Cards' : (pack ? pack.name : code);
      setCrumb([{ label: 'Packs', href: '#/' }, { label: title }]);

      state.cards = cards;
      state.shown = 0;

      html(view,
        '<div class="toolbar">' +
          '<div>' +
            '<h1>' + esc(title) + '</h1>' +
            '<div class="tb-meta">' +
              '<span class="chip" id="count-chip">' + cards.length + ' cards</span>' +
              (pack ? '<span class="chip">' + esc(pack.code) + '</span>' : '') +
              (pack && pack.available ? '<span class="chip">' + esc(pack.available) + '</span>' : '') +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="card-grid" id="card-grid"></div>' +
        '<div class="sentinel" id="sentinel"></div>' +
        '<div id="grid-empty"></div>');

      showSearch(true, 'Filter ' + cards.length + ' cards…');
      searchInput.value = '';

      applyFilter('');
      restoreScroll(location.hash);
    }).catch(function (err) { if (token === state.token) failure(err); });
  }

  function matches(card, q) {
    if (!q) return true;
    var haystack = [
      card.name, card.subname, card.traits, card.text,
      card.type_name, card.faction_name, card.pack_name, card.code
    ].join(' ').toLowerCase();
    return haystack.indexOf(q) !== -1;
  }

  function applyFilter(q) {
    var grid = document.getElementById('card-grid');
    if (!grid) return;

    state.query = q;
    state.filtered = state.cards.filter(function (c) { return matches(c, q); });
    state.shown = 0;
    grid.innerHTML = '';

    var chip = document.getElementById('count-chip');
    if (chip) {
      chip.textContent = q
        ? state.filtered.length + ' of ' + state.cards.length + ' cards'
        : state.cards.length + ' cards';
    }

    var empty = document.getElementById('grid-empty');
    if (empty) {
      empty.innerHTML = state.filtered.length ? '' :
        '<div class="state"><div class="mono-tag">Nothing matches “' + esc(q) + '”</div></div>';
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
    var src = cardImage(card, false);
    var fac = facClass(card.faction_code);
    var sub = card.subname || '';
    var art = src
      ? '<img src="' + esc(src) + '" alt="' + esc(card.name) + '" loading="lazy" decoding="async">'
      : '<span class="noimg">No image</span>';

    return '' +
      '<a class="card-tile" href="#/card/' + esc(card.code) + '">' +
        '<div class="tile-img' + (isLandscape(card) ? ' landscape' : '') + '">' + art + '</div>' +
        '<div class="tile-name">' +
          '<span class="fac fac-' + fac + '"></span>' +
          '<span>' + esc(card.name) + levelSuffix(card) + '</span>' +
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
    setCrumb([{ label: 'Packs', href: '#/' }, { label: code }]);
    loading('Retrieving the card');

    API.getCard(code).then(function (card) {
      if (token !== state.token) return;

      setCrumb([
        { label: 'Packs', href: '#/' },
        { label: card.pack_name, href: '#/pack/' + card.pack_code },
        { label: card.name }
      ]);

      html(view, detailHtml(card));
      wireFlip(card);
      wireViewer(card);
      restoreScroll(location.hash);
    }).catch(function (err) { if (token === state.token) failure(err); });
  }

  function statHtml(kind, key, value) {
    return '<div class="stat ' + kind + '"><span class="k">' + esc(key) +
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

  function skillIconsHtml(card) {
    var order = [
      ['skill_willpower', 'willpower'], ['skill_intellect', 'intellect'],
      ['skill_combat', 'combat'], ['skill_agility', 'agility'], ['skill_wild', 'wild']
    ];
    var out = '';
    order.forEach(function (pair) {
      var n = card[pair[0]] || 0;
      for (var i = 0; i < n; i++) out += '[' + pair[1] + ']';
    });
    if (!out) return '';
    return '<div class="type-line"><span class="mono-tag">Icons</span>' +
      '<span>' + inline(out) + '</span></div>';
  }

  function metaCell(key, value) {
    if (value == null || value === '') return '';
    return '<div class="cell"><span class="k">' + esc(key) + '</span>' +
      '<span class="v">' + value + '</span></div>';
  }

  function detailHtml(card) {
    var fac = facClass(card.faction_code);
    var front = cardImage(card, false);
    var back = cardImage(card, true);

    var art = front
      ? '<img id="detail-img" src="' + esc(front) + '" alt="' + esc(card.name) + '">'
      : '<div class="noimg">No image available</div>';

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
          '<div class="frame' + (isLandscape(card) ? ' landscape' : '') + '" ' +
            'id="art-frame" role="button" tabindex="0" ' +
            'aria-label="Open ' + esc(card.name) + ' in the 3D viewer">' + art + '</div>' +
          '<div class="frame-hint">Click the card to inspect it in 3D</div>' +
          (back ? '<button class="btn-ghost flip-btn" id="flip">Flip card ⤾</button>' : '') +
        '</aside>' +

        '<div class="detail-body">' +
          '<div class="detail-title">' +
            '<h1>' + (card.is_unique ? '<span class="unique">◆</span>' : '') + esc(card.name) + '</h1>' +
            (card.subname ? '<div class="sub">' + esc(card.subname) + '</div>' : '') +
            '<div class="type-line">' +
              '<span class="badge txt-' + fac + '">' + esc(card.faction_name || 'Neutral') + '</span>' +
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
    var img = document.getElementById('detail-img');
    if (!btn || !img) return;
    var showingBack = false;
    btn.addEventListener('click', function () {
      showingBack = !showingBack;
      img.src = cardImage(card, showingBack);
      btn.textContent = showingBack ? 'Show front ⤾' : 'Flip card ⤾';
    });
  }

  function wireViewer(card) {
    var frame = document.getElementById('art-frame');
    if (!frame) return;
    frame.addEventListener('click', function () { Viewer.open(card); });
    frame.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); Viewer.open(card); }
    });
  }

  /* ---------- scroll memory ---------- */

  function rememberScroll() {
    scrollMemory[location.hash || '#/'] = window.scrollY;
  }

  function restoreScroll(key) {
    var y = scrollMemory[key];
    window.scrollTo(0, y || 0);
  }

  /* ---------- router ---------- */

  function route() {
    if (state.observer) { state.observer.disconnect(); state.observer = null; }
    Viewer.close();   // a back/forward press while the preview is open should dismiss it

    var hash = location.hash.replace(/^#\/?/, '');
    var parts = hash.split('/').filter(Boolean);

    if (!parts.length) return renderHome();
    if (parts[0] === 'pack' && parts[1]) return renderPack(decodeURIComponent(parts[1]));
    if (parts[0] === 'card' && parts[1]) return renderCard(decodeURIComponent(parts[1]));

    setCrumb(null);
    showSearch(false);
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
    debounce = setTimeout(function () { applyFilter(q); }, 140);
  });

  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { searchInput.value = ''; applyFilter(''); }
  });

  document.addEventListener('click', function (e) {
    var link = e.target.closest && e.target.closest('a[href^="#/"]');
    if (link) rememberScroll();
  }, true);

  window.addEventListener('hashchange', route);

  if (!location.hash) location.replace('#/');
  route();
})();
