/* 3D card preview overlay: drag to rotate, middle-drag to pan, wheel/pinch to
   zoom, flip, reset. */
(function (global) {
  'use strict';

  var esc = Markup.escapeHtml;
  var LANDSCAPE = ['investigator', 'act', 'agenda', 'scenario'];
  var reduceMotion = global.matchMedia &&
    global.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var MIN_ZOOM = 0.35, MAX_ZOOM = 5;

  var PAN_KEEP = 48;        // px of card that must stay over the stage

  var root = null;          // overlay element while open
  var card3d = null;
  var zoomEl = null;
  var stage = null;
  var lastFocus = null;

  var rx = 0, ry = 0, zoom = 1;
  var panX = 0, panY = 0;             // screen-space offset, in CSS px
  var vx = 0, vy = 0;                 // rotational velocity, degrees per frame
  var pointers = Object.create(null);
  var pointerCount = 0;
  var dragging = false;
  var dragMoved = false;              // suppresses the click-to-close after a rotate
  var lastX = 0, lastY = 0, pinchDist = 0;
  var panning = false, panId = null, panLastX = 0, panLastY = 0;
  var spinFrame = null, tweenFrame = null;

  function isLandscape(card) { return LANDSCAPE.indexOf(card.type_code) !== -1; }

  /* The pan rides on the zoom wrapper, outside the rotation, so it stays a flat
     screen-space nudge however the card is turned. Translating before scaling
     keeps it 1:1 with the pointer at any zoom — the parent box is unscaled. */
  function apply() {
    if (!card3d) return;
    card3d.style.transform = 'rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg)';
    zoomEl.style.transform =
      'translate(' + panX.toFixed(1) + 'px,' + panY.toFixed(1) + 'px) ' +
      'scale(' + zoom.toFixed(3) + ')';
  }

  function clampX(v) { return Math.max(-90, Math.min(90, v)); }

  /* A card panned entirely off the stage is a card the user has to guess their
     way back to, so a sliver always stays put. Zooming out shrinks the ceiling,
     hence the re-clamp after every zoom rather than only while dragging. */
  function clampPan() {
    if (!stage || !card3d) return;
    var r = stage.getBoundingClientRect();
    var maxX = Math.max(0, (r.width + card3d.offsetWidth * zoom) / 2 - PAN_KEEP);
    var maxY = Math.max(0, (r.height + card3d.offsetHeight * zoom) / 2 - PAN_KEEP);
    panX = Math.max(-maxX, Math.min(maxX, panX));
    panY = Math.max(-maxY, Math.min(maxY, panY));
  }

  /* ---------- inertia ---------- */

  function stopSpin() {
    if (spinFrame) { cancelAnimationFrame(spinFrame); spinFrame = null; }
    vx = vy = 0;
  }

  function spin() {
    vx *= 0.94; vy *= 0.94;
    if (Math.abs(vx) < 0.02 && Math.abs(vy) < 0.02) { stopSpin(); return; }
    ry += vx;
    rx = clampX(rx + vy);
    apply();
    spinFrame = requestAnimationFrame(spin);
  }

  /* ---------- tweened moves (flip / reset) ---------- */

  function tweenTo(targetRx, targetRy, targetZoom, targetPanX, targetPanY, ms) {
    stopSpin();
    if (tweenFrame) cancelAnimationFrame(tweenFrame);
    if (reduceMotion) {
      rx = targetRx; ry = targetRy; zoom = targetZoom;
      panX = targetPanX; panY = targetPanY;
      apply();
      return;
    }

    var fromRx = rx, fromRy = ry, fromZoom = zoom;
    var fromPanX = panX, fromPanY = panY;
    var start = performance.now();

    function step(now) {
      var t = Math.min(1, (now - start) / ms);
      var e = 1 - Math.pow(1 - t, 3);          // ease-out cubic
      rx = fromRx + (targetRx - fromRx) * e;
      ry = fromRy + (targetRy - fromRy) * e;
      zoom = fromZoom + (targetZoom - fromZoom) * e;
      panX = fromPanX + (targetPanX - fromPanX) * e;
      panY = fromPanY + (targetPanY - fromPanY) * e;
      apply();
      if (t < 1) tweenFrame = requestAnimationFrame(step);
      else tweenFrame = null;
    }
    tweenFrame = requestAnimationFrame(step);
  }

  function flip() {
    /* Land on whichever half-turn is closest, so repeat presses alternate faces.
       The pan is left alone — turning the card over is not a request to move it. */
    var target = Math.round((ry + 180) / 180) * 180;
    tweenTo(0, target, zoom, panX, panY, 520);
  }

  function reset() { tweenTo(0, 0, 1, 0, 0, 420); }

  /* ---------- pointer handling ---------- */

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function activePointers() {
    var out = [];
    for (var id in pointers) out.push(pointers[id]);
    return out;
  }

  function capture(e) {
    if (!e.target.setPointerCapture) return;
    try { e.target.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
  }

  function onPointerDown(e) {
    /* Middle button pans instead of rotating. It never reaches the rotation
       bookkeeping, so a pan can't be mistaken for the first half of a pinch. */
    if (e.pointerType === 'mouse' && e.button === 1) {
      stopSpin();
      panning = true;
      panId = e.pointerId;
      panLastX = e.clientX; panLastY = e.clientY;
      stage.classList.add('panning');
      capture(e);
      e.preventDefault();
      return;
    }
    if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
    pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    pointerCount++;
    stopSpin();

    if (pointerCount === 1) {
      dragging = true;
      dragMoved = false;
      lastX = e.clientX; lastY = e.clientY;
      card3d.classList.add('grabbing');
    } else if (pointerCount === 2) {
      dragging = false;
      var p = activePointers();
      pinchDist = distance(p[0], p[1]);
    }
    capture(e);
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (panning && e.pointerId === panId) {
      panX += e.clientX - panLastX;
      panY += e.clientY - panLastY;
      panLastX = e.clientX; panLastY = e.clientY;
      clampPan();
      apply();
      return;
    }
    if (!pointers[e.pointerId]) return;
    pointers[e.pointerId] = { x: e.clientX, y: e.clientY };

    if (pointerCount >= 2) {
      var p = activePointers();
      var d = distance(p[0], p[1]);
      if (pinchDist > 0) {
        zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * (d / pinchDist)));
        clampPan();
        apply();
      }
      pinchDist = d;
      return;
    }

    if (!dragging) return;
    var dx = e.clientX - lastX;
    var dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMoved = true;

    vx = dx * 0.45;
    vy = -dy * 0.45;
    ry += vx;
    rx = clampX(rx + vy);
    apply();
  }

  function onPointerUp(e) {
    if (panning && e.pointerId === panId) {
      panning = false;
      panId = null;
      if (stage) stage.classList.remove('panning');
      return;
    }
    if (pointers[e.pointerId]) { delete pointers[e.pointerId]; pointerCount--; }
    if (pointerCount < 2) pinchDist = 0;
    if (pointerCount === 0) {
      dragging = false;
      card3d.classList.remove('grabbing');
      if (!reduceMotion && (Math.abs(vx) > 0.4 || Math.abs(vy) > 0.4)) {
        spinFrame = requestAnimationFrame(spin);
      } else {
        vx = vy = 0;
      }
    }
  }

  function onWheel(e) {
    e.preventDefault();
    stopSpin();
    zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * (1 - e.deltaY * 0.0015)));
    clampPan();
    apply();
  }

  function onKey(e) {
    switch (e.key) {
      case 'Escape': close(); break;
      case 'ArrowLeft':  stopSpin(); ry -= 10; apply(); e.preventDefault(); break;
      case 'ArrowRight': stopSpin(); ry += 10; apply(); e.preventDefault(); break;
      case 'ArrowUp':    stopSpin(); rx = clampX(rx + 10); apply(); e.preventDefault(); break;
      case 'ArrowDown':  stopSpin(); rx = clampX(rx - 10); apply(); e.preventDefault(); break;
      case '+': case '=': zoom = Math.min(MAX_ZOOM, zoom * 1.15); apply(); break;
      case '-': case '_': zoom = Math.max(MIN_ZOOM, zoom / 1.15); apply(); break;
      case 'f': case 'F': flip(); break;
      case 'r': case 'R': reset(); break;
      case 'Tab': trapTab(e); break;
    }
  }

  function trapTab(e) {
    var focusable = root.querySelectorAll('button');
    if (!focusable.length) return;
    var first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  }

  /* ---------- sizing ---------- */

  function syncSize() {
    if (!card3d) return;
    card3d.style.setProperty('--w', card3d.offsetWidth + 'px');
    card3d.style.setProperty('--h', card3d.offsetHeight + 'px');
  }

  /* ---------- open / close ---------- */

  function open(card) {
    if (root) close();

    var landscape = isLandscape(card);
    var fallback = CardBack.backFor(card);
    var front = API.imageUrl(card.imagesrc) || fallback;
    var back = API.imageUrl(card.backimagesrc) || fallback;
    var backIsReal = !!card.backimagesrc;

    rx = 0; ry = 0; zoom = 1; vx = 0; vy = 0; panX = 0; panY = 0;

    root = document.createElement('div');
    root.className = 'viewer';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', card.name + ' — 3D preview');

    root.innerHTML = '' +
      '<div class="viewer-backdrop" data-close="1"></div>' +
      '<div class="viewer-shell">' +
        '<div class="viewer-bar">' +
          '<div class="viewer-title">' +
            '<span class="vt-name">' + esc(card.name) + '</span>' +
            '<span class="vt-sub">' + esc(card.type_name) +
              (backIsReal ? '' : ' — generic ' + esc(CardBack.kindFor(card)) + ' back') +
            '</span>' +
          '</div>' +
          '<button class="viewer-x" id="viewer-close" aria-label="Close preview">✕</button>' +
        '</div>' +

        '<div class="viewer-stage" data-close="1">' +
          '<div class="viewer-zoom">' +
            '<div class="viewer-card' + (landscape ? ' landscape' : '') + '" tabindex="-1">' +
              '<div class="v-face v-front"><img src="' + esc(front) + '" alt="' + esc(card.name) + ' front"></div>' +
              '<div class="v-face v-back"><img src="' + esc(back) + '" alt="' + esc(card.name) + ' back"></div>' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div class="viewer-controls">' +
          '<button class="btn-ghost" id="viewer-flip">Flip <kbd>F</kbd></button>' +
          '<button class="btn-ghost" id="viewer-reset">Reset <kbd>R</kbd></button>' +
          '<span class="viewer-hint">Drag to rotate · middle-drag to pan · ' +
            'scroll to zoom · <kbd>Esc</kbd> to close</span>' +
        '</div>' +
      '</div>';

    document.body.appendChild(root);
    document.body.classList.add('viewer-open');

    card3d = root.querySelector('.viewer-card');
    zoomEl = root.querySelector('.viewer-zoom');

    syncSize();
    apply();
    requestAnimationFrame(function () { root.classList.add('in'); });

    stage = root.querySelector('.viewer-stage');
    stage.addEventListener('pointerdown', onPointerDown);
    stage.addEventListener('pointermove', onPointerMove);
    stage.addEventListener('pointerup', onPointerUp);
    stage.addEventListener('pointercancel', onPointerUp);
    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('dblclick', reset);

    /* Chrome opens its autoscroll ring on middle mousedown and pastes the X
       selection on middle click under X11 — neither survives a preventDefault
       here, and pointerdown alone doesn't suppress the mouse-event pair. */
    stage.addEventListener('mousedown', function (e) {
      if (e.button === 1) e.preventDefault();
    });
    stage.addEventListener('auxclick', function (e) {
      if (e.button === 1) e.preventDefault();
    });

    root.addEventListener('click', function (e) {
      if (dragMoved) { dragMoved = false; return; }
      if (e.target.dataset && e.target.dataset.close) close();
    });
    root.querySelector('#viewer-close').addEventListener('click', close);
    root.querySelector('#viewer-flip').addEventListener('click', flip);
    root.querySelector('#viewer-reset').addEventListener('click', reset);

    document.addEventListener('keydown', onKey);
    global.addEventListener('resize', syncSize);

    lastFocus = document.activeElement;
    root.querySelector('#viewer-close').focus();
  }

  function close() {
    if (!root) return;
    stopSpin();
    if (tweenFrame) { cancelAnimationFrame(tweenFrame); tweenFrame = null; }

    document.removeEventListener('keydown', onKey);
    global.removeEventListener('resize', syncSize);

    var dying = root;
    root = null; card3d = null; zoomEl = null; stage = null;
    pointers = Object.create(null); pointerCount = 0; dragging = false;
    panning = false; panId = null;

    dying.classList.remove('in');
    document.body.classList.remove('viewer-open');

    var remove = function () { if (dying.parentNode) dying.parentNode.removeChild(dying); };
    if (reduceMotion) remove();
    else setTimeout(remove, 220);

    if (lastFocus && lastFocus.focus) lastFocus.focus();
    lastFocus = null;
  }

  global.Viewer = { open: open, close: close };
})(window);
