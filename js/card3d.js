/* Inline 3D card previews — the flat thumbnails of the grid and the detail view
   are the same sheet the full-screen Viewer builds, only smaller: a perspective
   stage, faces that hide their backface, and a pointer-driven tilt.

   The Viewer stays the deep-inspection tool (free rotation, zoom, inertia);
   this module is the ambient version that lives inside the page. */
(function (global) {
  'use strict';

  var esc = Markup.escapeHtml;
  var LANDSCAPE = ['investigator', 'act', 'agenda', 'scenario'];
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

  function faceHtml(cls, src, alt, lazy) {
    return '' +
      '<div class="c3d-face ' + cls + '">' +
        '<img src="' + esc(src) + '" alt="' + esc(alt) + '"' +
          (lazy ? ' loading="lazy" decoding="async"' : '') + '>' +
        '<span class="c3d-glare" aria-hidden="true"></span>' +
      '</div>';
  }

  /* opts.back  — render the reverse face too (detail view; the grid never
                  rotates far enough to show it, so it skips the extra image)
     opts.lazy  — defer the face images (grid tiles)
     opts.class — extra classes on the stage element
     opts.id    — id for the stage element */
  function html(card, opts) {
    opts = opts || {};
    var front = API.imageUrl(card.imagesrc);
    if (!front) return null;                 // caller falls back to its own placeholder

    var out = '' +
      '<div' + (opts.id ? ' id="' + esc(opts.id) + '"' : '') +
        ' class="c3d-stage' + (isLandscape(card) ? ' landscape' : '') +
        (opts['class'] ? ' ' + opts['class'] : '') + '">' +
        '<div class="c3d">' +
          faceHtml('c3d-front', front, card.name, opts.lazy);

    if (opts.back) {
      var back = API.imageUrl(card.backimagesrc) || CardBack.backFor(card);
      out += faceHtml('c3d-back', back, card.name + ' back', opts.lazy);
    }

    return out + '</div></div>';
  }

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

  global.Card3D = {
    html: html,
    bind: bind,
    flip: flip,
    setFlipped: setFlipped,
    isLandscape: isLandscape
  };
})(window);
