/* 3D card preview overlay: drag to rotate, middle-drag to pan, wheel/pinch to
   zoom, flip, quarter turn, reset. */
(function (global) {
  'use strict';

  var esc = Markup.escapeHtml;
  var reduceMotion = global.matchMedia &&
    global.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var MIN_ZOOM = 0.35, MAX_ZOOM = 5;

  var root = null;          // overlay element while open
  var card3d = null;
  var zoomEl = null;
  var stage = null;
  var lastFocus = null;

  var rx = 0, ry = 0, rz = 0, zoom = 1;
  var panX = 0, panY = 0;             // screen-space offset, in CSS px
  var vx = 0, vy = 0;                 // rotational velocity, degrees per frame
  var pointers = Object.create(null);
  var pointerCount = 0;
  var dragging = false;
  var dragMoved = false;              // suppresses the click-to-close after a rotate
  var lastX = 0, lastY = 0, pinchDist = 0;
  var panning = false, panId = null, panLastX = 0, panLastY = 0;
  var spinFrame = null, tweenFrame = null;
  var tweenTarget = null;             // where a running tween is headed, or null

  /* The pan rides on the zoom wrapper, outside the rotation, so it stays a flat
     screen-space nudge however the card is turned. Translating before scaling
     keeps it 1:1 with the pointer at any zoom — the parent box is unscaled. */
  /* rotateZ comes last, so it is the first turn applied and stays a roll in the
     card's own plane: the sheet spins about the face you are looking at however
     it is tilted. On the back — a mirrored face — that reads as the opposite
     direction on screen, which is what turning a real card over does. */
  function apply() {
    if (!card3d) return;
    card3d.style.transform = 'rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg)' +
      ' rotateZ(' + rz.toFixed(2) + 'deg)';
    zoomEl.style.transform =
      'translate(' + panX.toFixed(1) + 'px,' + panY.toFixed(1) + 'px) ' +
      'scale(' + zoom.toFixed(3) + ')';
  }

  function clampX(v) { return Math.max(-90, Math.min(90, v)); }

  function clampZoom(v) { return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v)); }

  /* Zoom about an arbitrary screen point, so whatever is under the pointer stays
     under it. A point sits at local offset v from the untransformed centre C and
     lands on screen at C + pan + zoom·v. Holding that landing spot at the cursor
     P across a zoom change of k = zoom'/zoom rearranges to

         pan' = d(1 - k) + k·pan,    d = P - C

     C is recovered from the live box rather than assumed: scaling happens about
     the centre, so the transformed centre is exactly C + pan. */
  function zoomAt(nextZoom, px, py) {
    if (!zoomEl) return;
    var k = nextZoom / zoom;
    if (k === 1) return;

    var r = zoomEl.getBoundingClientRect();
    var dx = px - (r.left + r.width / 2 - panX);
    var dy = py - (r.top + r.height / 2 - panY);

    panX = dx * (1 - k) + k * panX;
    panY = dy * (1 - k) + k * panY;
    zoom = nextZoom;

    clampPan();
    apply();
  }

  function stageCentre() {
    var r = stage.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  /* Panning is only ever a way to reach what the stage cannot show, so the limit
     on each axis is half the overflow. That ceiling shrinks with the card, which
     is what walks the pan back to centre on the way out: every notch of zoom-out
     leaves less overflow to hide in, and a card that fits is pinned dead centre
     with nothing to chase. Also why this re-runs after zooming, not just while
     dragging. Rotation is ignored — a tilted card only projects smaller, so the
     limit errs towards holding it on screen. */
  /* An odd quarter turn stands the card on its side, swapping which of its two
     dimensions faces which edge of the stage. */
  function quarterTurned(deg) { return Math.abs(Math.round(deg / 90)) % 2 === 1; }

  function clampPan() {
    if (!stage || !card3d) return;
    var r = stage.getBoundingClientRect();
    var q = quarterTurned(rz);
    var w = (q ? card3d.offsetHeight : card3d.offsetWidth) * zoom;
    var h = (q ? card3d.offsetWidth : card3d.offsetHeight) * zoom;
    var maxX = Math.max(0, (w - r.width) / 2);
    var maxY = Math.max(0, (h - r.height) / 2);
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

  /* ---------- tweened moves (flip / rotate / reset) ---------- */

  function cancelTween() {
    if (tweenFrame) { cancelAnimationFrame(tweenFrame); tweenFrame = null; }
    tweenTarget = null;
  }

  /* Everything the user drives directly — a drag, the wheel, an arrow key —
     takes the card off whatever it was doing first. */
  function stopMotion() { stopSpin(); cancelTween(); }

  function live(k) {
    return k === 'rx' ? rx : k === 'ry' ? ry : k === 'rz' ? rz :
           k === 'zoom' ? zoom : k === 'panX' ? panX : panY;
  }

  /* Where an axis is *heading*, which is not where it is while a tween runs.
     Buttons pressed mid-flight step from the pending target, so a second Rotate
     at 43° lands on 180 rather than 133: the discrete moves stay on the quarter
     and half turns however fast they are hammered. */
  function settled(k) { return tweenTarget ? tweenTarget[k] : live(k); }

  /* `to` is partial: an axis left out keeps its existing destination, which is
     how a flip turns the card without disturbing the roll, the zoom or the pan —
     and why interrupting one move with another finishes the axes the new move
     doesn't mention, instead of stranding them mid-tween. `done` runs on
     landing, animated or not. */
  function tweenTo(to, ms, done) {
    var from = { rx: rx, ry: ry, rz: rz, zoom: zoom, panX: panX, panY: panY };
    var at = function (k) { return to[k] === undefined ? settled(k) : to[k]; };
    var target = {                          // reads the old target, so it precedes stopMotion
      rx: at('rx'), ry: at('ry'), rz: at('rz'),
      zoom: at('zoom'), panX: at('panX'), panY: at('panY')
    };

    stopMotion();
    tweenTarget = target;

    function land() {
      rx = target.rx; ry = target.ry; rz = target.rz;
      zoom = target.zoom; panX = target.panX; panY = target.panY;
      /* Folding the roll back into 0–360 here, rather than in rotate(), keeps
         the accumulated turns off every later tween: four Rotates must not leave
         Reset unwinding a full circle. It is a no-op on screen. */
      rz = ((rz % 360) + 360) % 360;
      target.rz = rz;
      tweenTarget = null;
      apply();
      if (done) done();
    }

    if (reduceMotion) { land(); return; }

    var start = performance.now();

    function step(now) {
      var t = Math.min(1, (now - start) / ms);
      if (t >= 1) { tweenFrame = null; land(); return; }
      var e = 1 - Math.pow(1 - t, 3);          // ease-out cubic
      rx = from.rx + (target.rx - from.rx) * e;
      ry = from.ry + (target.ry - from.ry) * e;
      rz = from.rz + (target.rz - from.rz) * e;
      zoom = from.zoom + (target.zoom - from.zoom) * e;
      panX = from.panX + (target.panX - from.panX) * e;
      panY = from.panY + (target.panY - from.panY) * e;
      apply();
      tweenFrame = requestAnimationFrame(step);
    }
    tweenFrame = requestAnimationFrame(step);
  }

  function flip() {
    /* The closest half-turn to where the card is *headed*: at rest that is the
       nearest flat face to whatever angle a drag left behind, and mid-flight it
       is one face on from the pending target, so repeat presses alternate faces
       instead of compounding a part-finished flip. A quarter turn already under
       way carries on; the pan is left alone, since turning the card over is not
       a request to move it. */
    tweenTo({ rx: 0, ry: Math.round((settled('ry') + 180) / 180) * 180 }, 520);
  }

  /* What the card ends up at after a quarter turn. Standing a portrait card on
     its side makes it taller than the stage is deep, so the turn pulls the zoom
     back far enough to keep the whole card in view — but only from a card that
     already fitted. Past 1:1 the user is reading the print, and rescaling under
     them would lose their place. */
  function fitZoom(quarter) {
    var z = settled('zoom');                 // a reset in flight is already going to 1
    if (!stage || !card3d || z > 1) return z;
    var r = stage.getBoundingClientRect();
    var w = quarter ? card3d.offsetHeight : card3d.offsetWidth;
    var h = quarter ? card3d.offsetWidth : card3d.offsetHeight;
    if (!w || !h) return z;
    return Math.min(z, (r.width * 0.94) / w, (r.height * 0.94) / h);
  }

  /* A quarter turn in the card's own plane — for the landscape scans ArkhamDB
     stores upright, and for reading a sideways reverse. Stepping from the
     pending target rather than the live angle is what keeps a hammered button on
     the quarters; every press turns the same way round. */
  function rotate() {
    var target = settled('rz') + 90;
    tweenTo({ rz: target, zoom: fitZoom(quarterTurned(target)) }, 420, function () {
      clampPan();
      apply();
    });
  }

  function reset() { tweenTo({ rx: 0, ry: 0, rz: 0, zoom: 1, panX: 0, panY: 0 }, 420); }

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
      stopMotion();
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
    stopMotion();

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
        /* Anchored between the fingers — the touch reading of "zoom at the
           pointer", and the reason a pinch doesn't drift off the detail. */
        zoomAt(clampZoom(zoom * (d / pinchDist)),
               (p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2);
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
    stopMotion();
    zoomAt(clampZoom(zoom * (1 - e.deltaY * 0.0015)), e.clientX, e.clientY);
  }

  /* The keyboard has no pointer to zoom towards, so it works off the middle of
     the stage — whatever the user has centred stays centred. */
  function zoomStep(k) {
    stopMotion();
    var c = stageCentre();
    zoomAt(clampZoom(zoom * k), c.x, c.y);
  }

  function onKey(e) {
    switch (e.key) {
      case 'Escape': close(); break;
      case 'ArrowLeft':  stopMotion(); ry -= 10; apply(); e.preventDefault(); break;
      case 'ArrowRight': stopMotion(); ry += 10; apply(); e.preventDefault(); break;
      case 'ArrowUp':    stopMotion(); rx = clampX(rx + 10); apply(); e.preventDefault(); break;
      case 'ArrowDown':  stopMotion(); rx = clampX(rx - 10); apply(); e.preventDefault(); break;
      case '+': case '=': zoomStep(1.15); break;
      case '-': case '_': zoomStep(1 / 1.15); break;
      case 'f': case 'F': flip(); break;
      case 't': case 'T': rotate(); break;
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
    /* A narrower window leaves less overflow to pan into. */
    clampPan();
    apply();
  }

  /* ---------- open / close ---------- */

  /* opts.flipped — open showing the reverse, for a card the page has already
     turned over. */
  function open(card, opts) {
    if (root) close();
    opts = opts || {};

    var landscape = Card3D.isLandscape(card);
    var deckBack = CardBack.backFor(card);
    var art = Faces.art(card);               // API scan, then img/cards/<code>.png
    var reverse = Faces.back(card);          // this card's scan or its linked card's

    /* Only real card art is measured against the frame — see Card3D's
       orientation note; the generic backs are portrait by construction. A back
       is measured as 'fit', so a reverse printed the other way round turns
       within the card instead of reshaping it.

       `data-blank` opts a face into Card3D's candidate chain: fall through to
       the next image, then to the panel. */
    function faceImg(src, alt, orient, fallback, blank) {
      return '<img src="' + esc(src) + '" alt="' + esc(alt) + '"' +
        (orient ? ' data-orient="' + orient + '"' : '') +
        (fallback ? ' data-fallback="' + esc(fallback) + '"' : '') +
        (blank === undefined ? '' : ' data-blank="' + esc(blank || '') + '"') + '>';
    }

    var frontFace = '<div class="v-face v-front">' +
      faceImg(art.src, card.name + ' front', 'auto', art.fallback, card.name) + '</div>';

    /* A reverse with no candidate at all gets a panel, not the generic deck
       back — see Card3D's blankInner. */
    var backFace = reverse.missing
      ? '<div class="v-face v-back v-blank"><span class="face-blank">' +
          (reverse.name ? '<b>' + esc(reverse.name) + '</b>' : '') +
          '<span>No image</span></span></div>'
      : '<div class="v-face v-back">' +
          (reverse.src
            ? faceImg(reverse.src, (reverse.name || card.name) + ' back', 'fit',
                      reverse.fallback, reverse.name)
            : faceImg(deckBack, card.name + ' back')) +
        '</div>';

    /* The subtitle says what the other side actually is, since for a linked
       card that is a different card type from the one named in the title. */
    var backNote = reverse.real
      ? (reverse.card ? ' · back: ' + reverse.card.name +
          (reverse.card.type_name ? ' (' + reverse.card.type_name + ')' : '') : '')
      : reverse.missing
        ? ' · back: ' + (reverse.name || 'reverse') + ' — no image'
        : ' — generic ' + CardBack.kindFor(card) + ' back';

    rx = 0; ry = opts.flipped ? 180 : 0; rz = 0;
    zoom = 1; vx = 0; vy = 0; panX = 0; panY = 0;

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
            '<span class="vt-sub">' + esc(card.type_name) + esc(backNote) + '</span>' +
          '</div>' +
          '<button class="viewer-x" id="viewer-close" aria-label="Close preview">✕</button>' +
        '</div>' +

        '<div class="viewer-stage" data-close="1">' +
          '<div class="viewer-zoom">' +
            '<div class="viewer-card' + (landscape ? ' landscape' : '') + '" tabindex="-1">' +
              frontFace +
              backFace +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div class="viewer-controls">' +
          '<button class="btn-ghost" id="viewer-flip">Flip <kbd>F</kbd></button>' +
          '<button class="btn-ghost" id="viewer-rotate" aria-label="Rotate 90 degrees">' +
            'Rotate 90° <kbd>T</kbd></button>' +
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
    root.querySelector('#viewer-rotate').addEventListener('click', rotate);
    root.querySelector('#viewer-reset').addEventListener('click', reset);

    document.addEventListener('keydown', onKey);
    global.addEventListener('resize', syncSize);

    lastFocus = document.activeElement;
    root.querySelector('#viewer-close').focus();
  }

  function close() {
    if (!root) return;
    stopMotion();

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

  /* `resize` is also how Card3D asks for a re-measure after it has flipped the
     card's orientation under us. */
  global.Viewer = { open: open, close: close, resize: syncSize };
})(window);
