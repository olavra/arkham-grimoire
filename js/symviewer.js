/* Full-screen preview of one expansion symbol.

   The same overlay the card viewer uses — backdrop, bar, close, Esc — with the
   3D taken out: a symbol is a flat mark, so there is nothing to turn over and
   nothing to tilt. It keeps the .viewer chrome classes so the two previews
   stay the same object to the reader, and adds only its own stage.

   Drawn as a mask over brass, exactly as the grid tile draws it: the files are
   black on transparent, and a black mark on the night-blue sheet is invisible. */
(function (global) {
  'use strict';

  var esc = Markup.escapeHtml;
  var reduceMotion = global.matchMedia &&
    global.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var root = null;          // overlay element while open
  var lastFocus = null;

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  }

  /* opts: { url, name, set } — the mask URL, the cleaned name for the title and
     the set it belongs to for the subtitle. Not the file name: it is the same
     words as the title with the punctuation put back, and it is on the tile's
     tooltip for anyone who wants it. */
  function open(opts) {
    if (root) close();
    opts = opts || {};

    root = document.createElement('div');
    root.className = 'viewer symview';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', opts.name + ' — symbol');

    root.innerHTML = '' +
      '<div class="viewer-backdrop" data-close="1"></div>' +
      '<div class="viewer-shell">' +
        '<div class="viewer-bar">' +
          '<div class="viewer-title">' +
            '<span class="vt-name">' + esc(opts.name) + '</span>' +
            '<span class="vt-sub">' + esc(opts.set || '') + '</span>' +
          '</div>' +
          '<button class="viewer-x" id="symview-close" aria-label="Close preview">✕</button>' +
        '</div>' +

        '<div class="symview-stage" data-close="1">' +
          '<span class="symview-mark" style="--sym:url(&quot;' + esc(opts.url) + '&quot;)" ' +
            'role="img" aria-label="' + esc(opts.name) + '"></span>' +
        '</div>' +

        '<div class="viewer-controls">' +
        /* No <kbd> in the hint: .viewer-controls hides those on this theme, and
           the sentence has to still read without them. */
          '<span class="viewer-hint">Click or press Esc to close</span>' +
        '</div>' +
      '</div>';

    document.body.appendChild(root);
    document.body.classList.add('viewer-open');

    requestAnimationFrame(function () { root.classList.add('in'); });

    root.addEventListener('click', function (e) {
      if (e.target.dataset && e.target.dataset.close) close();
    });
    root.querySelector('#symview-close').addEventListener('click', close);

    document.addEventListener('keydown', onKey);

    lastFocus = document.activeElement;
    root.querySelector('#symview-close').focus();
  }

  function close() {
    if (!root) return;
    document.removeEventListener('keydown', onKey);

    var dying = root;
    root = null;

    dying.classList.remove('in');
    document.body.classList.remove('viewer-open');

    var remove = function () { if (dying.parentNode) dying.parentNode.removeChild(dying); };
    if (reduceMotion) remove();
    else setTimeout(remove, 220);

    if (lastFocus && lastFocus.focus) lastFocus.focus();
    lastFocus = null;
  }

  global.SymViewer = { open: open, close: close };
})(window);
