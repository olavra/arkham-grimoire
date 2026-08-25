/* Inline 3D card previews — the flat thumbnails of the grid and the detail view
   are the same sheet the full-screen Viewer builds, only smaller: a perspective
   stage, faces that hide their backface, and a pointer-driven tilt.

   The Viewer stays the deep-inspection tool (free rotation, zoom, inertia);
   this module is the ambient version that lives inside the page. */
(function (global) {
  'use strict';

  var esc = Markup.escapeHtml;

  /* The card types FFG prints on their side. Scenario cards are *not* one of
     them — they are ordinary portrait encounter cards despite sitting next to
     the acts and agendas in a scenario's pack. */
  var LANDSCAPE = ['investigator', 'act', 'agenda'];
  var reduceMotion = global.matchMedia &&
    global.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var MAX_TILT = 11;        // degrees at the edge of the stage
  var LIFT = 22;            // px of translateZ while the pointer is over a card

  var tracked = null;       // stage currently under the pointer
  var rect = null;          // its bounding box, read once per hover
  var frame = null;

  function isLandscape(card) { return LANDSCAPE.indexOf(card.type_code) !== -1; }

  function stateOf(stage) {
    if (!stage.__c3d) stage.__c3d = { rx: 0, ry: 0, flipped: false };
    return stage.__c3d;
  }

  function apply(stage) {
    var card = stage.querySelector('.c3d');
    if (!card) return;
    var s = stateOf(stage);
    var lift = tracked === stage ? LIFT : 0;
    card.style.transform =
      'translateZ(' + lift + 'px) ' +
      'rotateX(' + s.rx.toFixed(2) + 'deg) ' +
      'rotateY(' + (s.ry + (s.flipped ? 180 : 0)).toFixed(2) + 'deg)';
  }

  /* ---------- markup ---------- */

  /* o.src      the image to try first
     o.alt      alt text
     o.orient   'auto' for a front, which may re-frame the whole card; 'fit' for
                a back, which may only turn itself. The generic deck backs pass
                nothing: they are portrait by construction and would be read as
                a sideways scan.
     o.fallback the next image to try if o.src fails
     o.blank    present on real card art: the name to show if every candidate
                fails. Absent on the bundled deck backs, which cannot fail.
     o.lazy     defer the request (grid tiles) */
  function faceHtml(cls, o) {
    return '' +
      '<div class="c3d-face ' + cls + '">' +
        '<img src="' + esc(o.src) + '" alt="' + esc(o.alt) + '"' +
          (o.orient ? ' data-orient="' + o.orient + '"' : '') +
          (o.fallback ? ' data-fallback="' + esc(o.fallback) + '"' : '') +
          (o.blank === undefined ? '' : ' data-blank="' + esc(o.blank || '') + '"') +
          (o.lazy ? ' loading="lazy" decoding="async"' : '') + '>' +
        '<span class="c3d-glare" aria-hidden="true"></span>' +
      '</div>';
  }

  /* What a face shows when there is no art for it: a reverse ArkhamDB knows
     about but has no scan of, or a candidate chain that ran out. The generic
     deck back would claim the card is face-down-blank on that side, which is
     the opposite of the truth, so the face says what is there and what is
     missing instead. */
  function blankInner(name) {
    return '<span class="face-blank">' +
      (name ? '<b>' + esc(name) + '</b>' : '') +
      '<span>No image</span></span>';
  }

  function blankBackHtml(name) {
    return '<div class="c3d-face c3d-back c3d-blank">' + blankInner(name) + '</div>';
  }

  /* Whether img/cards/<code>.png exists is only knowable by asking for it, so
     faces are drawn optimistically: a failed image steps to its next candidate,
     and one that has run out becomes the blank panel rather than a browser's
     broken-image glyph. `error` doesn't bubble either, hence the capture-phase
     listener — the same shape as the `load` hook below. */
  global.document.addEventListener('error', function (e) {
    var img = e.target;
    if (img.tagName !== 'IMG' || img.dataset.blank === undefined) return;

    var next = img.dataset.fallback;
    if (next) {
      delete img.dataset.fallback;
      img.src = next;
      return;
    }

    var face = img.closest('.c3d-face, .v-face');
    if (!face) return;
    face.classList.add(face.classList.contains('v-face') ? 'v-blank' : 'c3d-blank');
    face.innerHTML = blankInner(img.dataset.blank);
  }, true);

  /* opts.back  — render the reverse face too (detail view; the grid never
                  rotates far enough to show it, so it skips the extra image)
     opts.lazy  — defer the face images (grid tiles)
     opts.class — extra classes on the stage element
     opts.id    — id for the stage element */
  function html(card, opts) {
    opts = opts || {};
    var front = Faces.art(card);
    if (!front.src) return null;             // caller falls back to its own placeholder

    var out = '' +
      '<div' + (opts.id ? ' id="' + esc(opts.id) + '"' : '') +
        ' class="c3d-stage' + (isLandscape(card) ? ' landscape' : '') +
        (opts['class'] ? ' ' + opts['class'] : '') + '">' +
        '<div class="c3d">' +
          faceHtml('c3d-front', {
            src: front.src, alt: card.name, orient: 'auto',
            fallback: front.fallback, blank: card.name, lazy: opts.lazy
          });

    if (opts.back) {
      /* The back may be this card's own scan or a linked card's — Faces knows
         which, and whether there is one at all. */
      var reverse = Faces.back(card);
      if (reverse.src) {
        out += faceHtml('c3d-back', {
          src: reverse.src, alt: (reverse.name || card.name) + ' back', orient: 'fit',
          fallback: reverse.fallback, blank: reverse.name, lazy: opts.lazy
        });
      } else if (reverse.missing) {
        out += blankBackHtml(reverse.name);
      } else {
        out += faceHtml('c3d-back', {
          src: CardBack.backFor(card), alt: card.name + ' back', lazy: opts.lazy
        });
      }
    }

    return out + '</div></div>';
  }

  /* ---------- orientation ---------- */

  /* type_code says which way a card is printed, and the frame is built from it
     before any pixels arrive. The scans don't always agree:

       · ArkhamDB stores some landscape cards — the parallel investigators, for
         one — as an upright file with the card lying on its side, so 90024 came
         out as a portrait image letterboxed inside a landscape frame.
       · The reverse would mean a type we have filed the wrong way round.

     Neither is knowable before the image loads, so the guess is corrected once
     it has: a wide image in a portrait frame turns the frame landscape, and a
     tall image in a landscape frame is a sideways scan, spun upright by CSS.
     `load` doesn't bubble, hence one capture-phase listener for every card
     image on the page — grid tiles, detail art and the viewer alike. */
  function fixOrientation(img) {
    var box = img.closest('.c3d-stage, .viewer-card');
    if (!box || !img.naturalWidth || !img.naturalHeight) return;

    var wide = img.naturalWidth > img.naturalHeight;
    if (wide === box.classList.contains('landscape')) return;   // the guess held

    /* A back face never re-frames the card. The two sides of one sheet share a
       shape, so a reverse printed the other way round — the enemy on the back of
       an agenda, the investigator on the back of an asset — is a sideways print
       on the same rectangle, not a differently shaped card. Turn the image and
       leave the box to the front. */
    if (img.dataset.orient === 'fit') {
      img.classList.add('sideways');
      if (wide) img.classList.add('wide');
      return;
    }

    if (!wide) { img.classList.add('sideways'); return; }

    box.classList.add('landscape');
    var frame = box.closest('.frame');       // the detail view's own aspect box
    if (frame) frame.classList.add('landscape');

    /* A back fits itself to the box, so any that measured before this ran was
       fitted to the wrong shape. Both faces load at once and either can win. */
    Array.prototype.forEach.call(box.querySelectorAll('img[data-orient="fit"]'),
      function (b) {
        b.classList.remove('sideways', 'wide');
        fixOrientation(b);
      });

    /* The viewer derives its corner radius from a measured width. */
    if (global.Viewer && global.Viewer.resize) global.Viewer.resize();
  }

  global.document.addEventListener('load', function (e) {
    var img = e.target;
    if (img.tagName === 'IMG' && img.dataset.orient) fixOrientation(img);
  }, true);

  /* ---------- tilt ---------- */

  function schedule() {
    if (frame || !tracked) return;
    frame = requestAnimationFrame(function () {
      frame = null;
      if (tracked) apply(tracked);
    });
  }

  function enter(stage) {
    if (tracked === stage) return;
    if (tracked) leave();
    tracked = stage;
    rect = stage.getBoundingClientRect();
    stage.classList.add('tracking');        // kills the transition, so the tilt tracks 1:1
  }

  function leave() {
    if (!tracked) return;
    var stage = tracked;
    var s = stateOf(stage);
    s.rx = 0; s.ry = 0;
    tracked = null; rect = null;
    stage.classList.remove('tracking');
    apply(stage);                            // eases home now that the transition is back
  }

  function onMove(e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    var stage = e.target.closest ? e.target.closest('.c3d-stage') : null;
    if (!stage) { leave(); return; }

    enter(stage);
    if (!rect || !rect.width || !rect.height) return;

    var px = (e.clientX - rect.left) / rect.width - 0.5;
    var py = (e.clientY - rect.top) / rect.height - 0.5;
    var s = stateOf(stage);
    s.ry = px * 2 * MAX_TILT;
    s.rx = -py * 2 * MAX_TILT;

    stage.style.setProperty('--gx', (px + 0.5) * 100 + '%');
    stage.style.setProperty('--gy', (py + 0.5) * 100 + '%');
    schedule();
  }

  /* One pair of listeners per container — tiles appended later are covered. */
  function bind(scope) {
    if (!scope || reduceMotion || scope.__c3dBound) return;
    scope.__c3dBound = true;
    scope.addEventListener('pointermove', onMove);
    scope.addEventListener('pointerleave', leave);
  }

  /* Scrolling slides the card out from under the cached rect; drop the hover
     rather than tilt from a stale box. Bound once — grids come and go. */
  global.addEventListener('scroll', leave, { passive: true });

  /* ---------- flip ---------- */

  function setFlipped(stage, flipped) {
    if (!stage) return false;
    var s = stateOf(stage);
    s.flipped = !!flipped;
    apply(stage);
    return s.flipped;
  }

  function flip(stage) {
    return stage ? setFlipped(stage, !stateOf(stage).flipped) : false;
  }

  function isFlipped(stage) {
    return !!(stage && stage.__c3d && stage.__c3d.flipped);
  }

  global.Card3D = {
    html: html,
    bind: bind,
    flip: flip,
    setFlipped: setFlipped,
    isFlipped: isFlipped,
    isLandscape: isLandscape
  };
})(window);
