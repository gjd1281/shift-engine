/* ============================================================================
   wheeldates.js — The Ultimate Shift Engine
   ----------------------------------------------------------------------------
   WHAT THIS DOES
   Adds the day of the week to the date numbers around the roster wheel, so a
   label reads

        FRI
         28

   instead of just "28". At a glance you can see whether a night block lands
   over a weekend without counting round the ring.

   WHY IT'S A SEPARATE FILE
   Same approach as attachments.js / backup.js / crib.js — one <script> line in
   index.html, and every future change to this feature is a same-filename
   replacement. No hunting for a line number on a phone keyboard.

   HOW IT FINDS THE LABELS (no class names needed)
   The script does not need to know how the wheel is built. It looks for leaf
   elements whose entire text is a number between 1 and 31, works out which
   container holds the most of them (that's the wheel — nothing else on the
   page has ~28 bare numbers), and rewrites only those.

   HOW IT WORKS OUT THE WEEKDAY
   Each label is just a day-of-month. Across a 28-day window, any given
   day-of-month can only be one real date, so the script picks whichever
   calendar date with that number sits closest to today. Month and year
   rollovers therefore handle themselves — no anchor date, no config.

   INSTALL
   Add this one line in index.html, just before </body>, after the other
   bolt-ons:

        <script src="wheeldates.js"></script>

   ========================================================================== */

(function () {
  'use strict';

  /* --------------------------------------------------------------------------
     SETTINGS — the only things you'd normally want to change
     ------------------------------------------------------------------------ */

  var DAY_FORMAT = 'short';   // 'short' = MON TUE WED, 'letter' = M T W
  var DAY_POSITION = 'above'; // 'above' or 'below' the date number
  var MIN_LABELS = 12;        // ignore any container with fewer numbers than
                              // this, so the "12 / 28" cycle card is never hit

  var SHORT_DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  var LETTER_DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  /* --------------------------------------------------------------------------
     STYLES
     The day line is deliberately small and dimmed. The date number keeps
     whatever size, weight and colour the wheel already gives it — including the
     bold treatment on today — because we only change what is inside the label
     element, never the element itself.
     ------------------------------------------------------------------------ */

  var CSS = [
    '.swd-label{display:flex;flex-direction:column;align-items:center;',
    'justify-content:center;line-height:1.05;}',
    '.swd-dow{font-size:0.60em;letter-spacing:0.08em;opacity:0.62;',
    'font-weight:600;}',
    '.swd-dom{display:block;}'
  ].join('');

  function injectStyles() {
    if (document.getElementById('swd-styles')) return;
    var tag = document.createElement('style');
    tag.id = 'swd-styles';
    tag.textContent = CSS;
    document.head.appendChild(tag);
  }

  /* --------------------------------------------------------------------------
     DATE HELPERS
     ------------------------------------------------------------------------ */

  // Midnight today — comparing at midnight keeps the "closest date" maths
  // stable no matter what time of day the app is opened.
  function todayMidnight() {
    var n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }

  // Given a day-of-month (1–31), return the real calendar date nearest to
  // today. Checks last month, this month and next month. The getDate() test
  // throws out impossible dates — asking for the 31st of a 30-day month rolls
  // over into the next month, and we don't want that one.
  function nearestDateFor(dayOfMonth, today) {
    var best = null;
    var bestGap = Infinity;

    for (var offset = -1; offset <= 1; offset++) {
      var candidate = new Date(
        today.getFullYear(),
        today.getMonth() + offset,
        dayOfMonth
      );
      if (candidate.getDate() !== dayOfMonth) continue; // rolled over, skip
      var gap = Math.abs(candidate.getTime() - today.getTime());
      if (gap < bestGap) {
        bestGap = gap;
        best = candidate;
      }
    }
    return best;
  }

  function dayNameFor(date) {
    var table = DAY_FORMAT === 'letter' ? LETTER_DAYS : SHORT_DAYS;
    return table[date.getDay()];
  }

  /* --------------------------------------------------------------------------
     FINDING THE WHEEL
     ------------------------------------------------------------------------ */

  // A "date label" is an element with no element children whose whole text is
  // a number from 1 to 31. Elements we've already rewritten are recognised by
  // their data attribute rather than their text, so re-runs stay accurate.
  function collectNumericLeaves() {
    var found = [];
    var all = document.body.getElementsByTagName('*');

    for (var i = 0; i < all.length; i++) {
      var el = all[i];

      // Already ours — read the number back off the data attribute.
      if (el.hasAttribute('data-swd-dom')) {
        found.push({ el: el, num: parseInt(el.getAttribute('data-swd-dom'), 10) });
        continue;
      }

      if (el.children.length > 0) continue; // not a leaf
      var text = (el.textContent || '').trim();
      if (!/^\d{1,2}$/.test(text)) continue;

      var num = parseInt(text, 10);
      if (num < 1 || num > 31) continue;

      found.push({ el: el, num: num });
    }
    return found;
  }

  // Every ancestor of a date label technically "contains" it, right up to
  // <body>. We want the tightest box that still holds them all, so we count
  // hits per ancestor and then keep the deepest element sharing the top count.
  function findWheelContainer(labels) {
    if (labels.length < MIN_LABELS) return null;

    var nodes = [];
    var counts = [];

    for (var i = 0; i < labels.length; i++) {
      var node = labels[i].el.parentNode;
      while (node && node.nodeType === 1) {
        var idx = nodes.indexOf(node);
        if (idx === -1) {
          nodes.push(node);
          counts.push(1);
        } else {
          counts[idx]++;
        }
        node = node.parentNode;
      }
    }

    var topCount = Math.max.apply(null, counts);
    if (topCount < MIN_LABELS) return null;

    var winner = null;
    var winnerDepth = -1;

    for (var j = 0; j < nodes.length; j++) {
      if (counts[j] !== topCount) continue;
      var depth = 0;
      var walk = nodes[j];
      while (walk) {
        depth++;
        walk = walk.parentNode;
      }
      if (depth > winnerDepth) {
        winnerDepth = depth;
        winner = nodes[j];
      }
    }
    return winner;
  }

  /* --------------------------------------------------------------------------
     REWRITING A LABEL
     Two shapes are handled: SVG <text>, which needs <tspan> and manual line
     spacing, and ordinary HTML, which gets a small flex column.
     ------------------------------------------------------------------------ */

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function renderSvgLabel(el, dayText, dateText) {
    var x = el.getAttribute('x') || 0;
    while (el.firstChild) el.removeChild(el.firstChild);

    // dy is in em so it scales with whatever font-size the wheel already uses.
    var first = DAY_POSITION === 'above' ? dayText : dateText;
    var second = DAY_POSITION === 'above' ? dateText : dayText;

    var line1 = document.createElementNS(SVG_NS, 'tspan');
    line1.setAttribute('x', x);
    line1.setAttribute('dy', '-0.35em');
    line1.textContent = first;
    if (first === dayText) line1.setAttribute('class', 'swd-dow');

    var line2 = document.createElementNS(SVG_NS, 'tspan');
    line2.setAttribute('x', x);
    line2.setAttribute('dy', '1.05em');
    line2.textContent = second;
    if (second === dayText) line2.setAttribute('class', 'swd-dow');

    el.appendChild(line1);
    el.appendChild(line2);
  }

  function renderHtmlLabel(el, dayText, dateText) {
    var dow = '<span class="swd-dow">' + dayText + '</span>';
    var dom = '<span class="swd-dom">' + dateText + '</span>';
    el.classList.add('swd-label');
    el.innerHTML = DAY_POSITION === 'above' ? dow + dom : dom + dow;
  }

  /* --------------------------------------------------------------------------
     MAIN PASS
     ------------------------------------------------------------------------ */

  var wheel = null; // remembered so the observer can watch the right subtree

  function decorate() {
    var labels = collectNumericLeaves();
    var container = findWheelContainer(labels);
    if (!container) return false;
    wheel = container;

    var today = todayMidnight();

    for (var i = 0; i < labels.length; i++) {
      var item = labels[i];

      // Only touch numbers that live inside the wheel.
      if (!container.contains(item.el)) continue;

      var date = nearestDateFor(item.num, today);
      if (!date) continue;

      var dayText = dayNameFor(date);
      var dateText = String(item.num);

      // Store the original number so a later re-run reads the date off the
      // attribute instead of trying to parse "FRI28" back out of the text.
      item.el.setAttribute('data-swd-dom', dateText);

      if (item.el.namespaceURI === SVG_NS) {
        renderSvgLabel(item.el, dayText, dateText);
      } else {
        renderHtmlLabel(item.el, dayText, dateText);
      }
    }
    return true;
  }

  /* --------------------------------------------------------------------------
     KEEPING UP WITH REDRAWS
     The wheel is rebuilt when the anchor date, roster preset or theme changes.
     A debounced observer re-decorates afterwards. The guard flag stops our own
     edits from triggering another pass.
     ------------------------------------------------------------------------ */

  var busy = false;
  var pending = null;

  function scheduleDecorate() {
    if (busy) return;
    clearTimeout(pending);
    pending = setTimeout(function () {
      busy = true;
      try {
        decorate();
      } catch (err) {
        console.warn('[wheeldates] pass failed:', err);
      }
      // Let our own mutations settle before listening again.
      setTimeout(function () { busy = false; }, 50);
    }, 80);
  }

  function start() {
    injectStyles();

    // First pass. If the wheel isn't drawn yet, the observer below catches it.
    try {
      decorate();
    } catch (err) {
      console.warn('[wheeldates] first pass failed:', err);
    }

    if (typeof MutationObserver === 'undefined') return;

    var target = wheel || document.body;
    var observer = new MutationObserver(scheduleDecorate);
    observer.observe(target, { childList: true, subtree: true });

    // Tab switches and midnight rollover both change what should be shown.
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) scheduleDecorate();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
