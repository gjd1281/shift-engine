/* ============================================================================
   holidays.js  —  The Ultimate Shift Engine        v2
   ----------------------------------------------------------------------------
   WHAT THIS DOES
     Adds a "Holidays" card directly under the roster wheel, above the
     D / N / PJ / T / HOME legend. Tapping it opens a sheet where the user enters
     leave (annual leave, RDO, long service, unpaid, public holiday, shift swap)
     as a first day + last day. Any of those days falling inside the 28 days
     drawn on the wheel get a small badge on the shift tile, so leave shows up on
     its own as it comes around.

   WHY UNDER THE WHEEL AND NOT A SEVENTH TAB
     The nav row already carries six tabs across a phone screen. A seventh would
     squeeze them all. Sitting under the wheel also puts the control right next
     to the thing it changes.

   WHY IT'S A SEPARATE FILE
     Same reason as attachments.js / crib.js / wheeldates.js: Gavin edits from a
     phone. A bolt-on means future changes are a same-filename replacement with
     no line hunting inside index.html.

   HOW TO INSTALL
     Drop holidays.js in the repo root next to index.html, then add ONE line
     just before </body>, after the other bolt-ons:

         <script src="holidays.js"></script>

     Nothing else in index.html changes.

   DESIGN NOTES (the non-obvious bits)
     1. Colours are sampled from the running page rather than hard-coded, so the
        card and sheet follow whichever of the six themes is active.
     2. Badges are drawn in a fixed-position overlay layer over the top of the
        wheel. Nothing in the wheel's own markup is touched, so wheeldates.js
        and anything drawn later can't fight with it.
     3. Badge placement is RADIAL. The date numbers sit outside the ring and the
        shift tiles sit inside it, so the badge is pushed from the date number
        toward the wheel centre by CFG.badgeInward. The centre is worked out
        from the average position of all 28 cells — no assumptions about how the
        wheel is built.
     4. Storage is localStorage, not IndexedDB. Holidays are a few hundred bytes
        of text; the quota problem that pushed attachments into IndexedDB was
        base64 photos, which this file never touches.

   PUBLIC API (for a future Pay tab / leave accrual)
     window.SEHolidays.getAll()            -> array of records
     window.SEHolidays.isHoliday(dateObj)  -> record or null
     window.SEHolidays.refresh()           -> rebuild and redraw now
     window.SEHolidays.open()              -> open the sheet
============================================================================ */

(function () {
  'use strict';

  /* ==========================================================================
     1. CONFIG
     Everything adjustable lives here so nothing below needs hunting through.
     ========================================================================== */

  var CFG = {
    // localStorage key. Versioned so a future format change can migrate cleanly.
    storageKey: 'se_holidays_v1',

    // Day 0 of the wheel. The wheel puts TODAY at the pointer and runs 28 days
    // forward, so cell index 0 = today. If that ever changes, change this.
    wheelStartOffset: 0,

    // How far to push the badge from the date number toward the wheel centre,
    // as a fraction of the distance to the centre. 0 = sits on the date number,
    // 0.25 = a quarter of the way in. THIS IS THE ONE NUMBER TO NUDGE if the
    // badge doesn't land nicely on the shift tile.
    badgeInward: 0.22,

    // Badge size in px on the wheel.
    badgeSize: 15,

    // Selectors tried first when looking for the wheel. Auto-detection handles
    // it if none match; this is just a shortcut.
    wheelSelectors: ['#wheel', '.wheel', '#roster-wheel', '.roster-wheel', '[data-wheel]'],

    // Words used to find the legend row, so the card can be slotted above it.
    legendWords: ['HOME', 'TRAVEL', 'NIGHT']
  };

  // Leave types. `glyph` is what shows on the wheel.
  var TYPES = [
    { id: 'annual', label: 'Annual leave',   glyph: '🌴' },
    { id: 'public', label: 'Public holiday', glyph: '🎉' },
    { id: 'rdo',    label: 'RDO',            glyph: '💤' },
    { id: 'lsl',    label: 'Long service',   glyph: '🏅' },
    { id: 'unpaid', label: 'Unpaid',         glyph: '⏸'  },
    { id: 'swap',   label: 'Shift swap',     glyph: '🔁' }
  ];

  function typeById(id) {
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i].id === id) return TYPES[i];
    return TYPES[0];
  }

  /* ==========================================================================
     2. DATE HELPERS
     All dates are handled as LOCAL dates and stored as 'YYYY-MM-DD' strings.
     ========================================================================== */

  // NOTE: deliberately NOT using toISOString(). Queensland is UTC+10, so local
  // midnight is 2pm the PREVIOUS day in UTC and toISOString() would hand back
  // yesterday's date. This builds the string from the local parts instead.
  function iso(d) {
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  // Parsed at midday so daylight-saving shifts in other states can't roll a
  // date backwards or forwards a day.
  function parseISO(s) {
    var p = String(s).split('-');
    return new Date(+p[0], +p[1] - 1, +p[2], 12, 0, 0, 0);
  }

  function addDays(d, n) {
    var c = new Date(d.getTime());
    c.setDate(c.getDate() + n);
    return c;
  }

  function today() {
    var n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate(), 12, 0, 0, 0);
  }

  function dayCount(startISO, endISO) {
    var a = parseISO(startISO), b = parseISO(endISO);
    return Math.round((b - a) / 86400000) + 1; // inclusive of both ends
  }

  function daysFromToday(isoStr) {
    return Math.round((parseISO(isoStr) - today()) / 86400000);
  }

  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function pretty(isoStr) {
    var d = parseISO(isoStr);
    return DOW[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()];
  }

  /* ==========================================================================
     3. STORAGE
     Records look like: { id, type, start, end, note }
     ========================================================================== */

  var records = [];

  function load() {
    try {
      var raw = localStorage.getItem(CFG.storageKey);
      records = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(records)) records = [];
    } catch (e) {
      // Corrupt or blocked storage shouldn't take the card down with it.
      console.warn('[holidays] could not read storage:', e);
      records = [];
    }
    sortRecords();
  }

  function save() {
    try {
      localStorage.setItem(CFG.storageKey, JSON.stringify(records));
      return true;
    } catch (e) {
      console.warn('[holidays] could not write storage:', e);
      return false;
    }
  }

  function sortRecords() {
    records.sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
  }

  // Fast lookup of every individual holiday date, rebuilt whenever records
  // change. Cheap: even a year of leave is only a few hundred entries.
  var dateIndex = {};

  function rebuildIndex() {
    dateIndex = {};
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      var d = parseISO(r.start), end = parseISO(r.end), guard = 0;
      while (d <= end && guard++ < 800) { // guard against a bad end date
        dateIndex[iso(d)] = r;
        d = addDays(d, 1);
      }
    }
  }

  // The next block of leave that hasn't finished yet — shown on the card.
  function nextUp() {
    var t = iso(today());
    for (var i = 0; i < records.length; i++) if (records[i].end >= t) return records[i];
    return null;
  }

  /* ==========================================================================
     4. THEME SAMPLING
     Rather than hard-coding colours (which would clash with five of the six
     themes), read what the app is already using and build from that.
     ========================================================================== */

  var theme = { bg: '#fff', fg: '#222', line: 'rgba(128,128,128,.3)', accent: '#e07b28' };

  function sampleTheme() {
    var cs = getComputedStyle(document.body);
    if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') theme.bg = cs.backgroundColor;
    if (cs.color) theme.fg = cs.color;

    // Borrow the accent from the active tab's underline or text colour if one
    // can be found; otherwise fall back to the Shift Engine orange.
    var act = document.querySelector('.tab.active, .active, [aria-selected="true"]');
    if (act) {
      var as = getComputedStyle(act);
      if (as.borderBottomWidth !== '0px' && as.borderBottomColor) theme.accent = as.borderBottomColor;
      else if (as.color) theme.accent = as.color;
    }
  }

  /* ==========================================================================
     5. FINDING THE WHEEL
     ========================================================================== */

  var cellCache = null, cacheStamp = 0;

  // Find the elements holding each day number on the wheel.
  // Heuristic: the biggest group of sibling leaf elements whose text is just a
  // 1-2 digit number. The weekday labels wheeldates.js adds ("MON") are
  // non-numeric and the D/N/T tiles are letters, so neither can be picked up by
  // mistake.
  function findDayCells() {
    // Re-detect at most once a second; this runs on scroll.
    if (cellCache && Date.now() - cacheStamp < 1000) return cellCache;

    var root = null;
    for (var i = 0; i < CFG.wheelSelectors.length; i++) {
      root = document.querySelector(CFG.wheelSelectors[i]);
      if (root) break;
    }
    var scope = root || document.body;

    var leaves = scope.querySelectorAll('text, tspan, div, span, li, td, b, strong');
    var groups = {}, keys = [];

    for (var j = 0; j < leaves.length; j++) {
      var el = leaves[j];
      if (el.children.length) continue;
      if (!/^\d{1,2}$/.test((el.textContent || '').trim())) continue;
      if (!el.parentNode) continue;

      var key = groupKey(el.parentNode); // group by parent to find one ring
      if (!groups[key]) { groups[key] = []; keys.push(key); }
      groups[key].push(el);
    }

    var best = null;
    for (var k = 0; k < keys.length; k++) {
      var g = groups[keys[k]];
      if (g.length >= 20 && (!best || g.length > best.length)) best = g;
    }

    cellCache = best;
    cacheStamp = Date.now();
    return best;
  }

  // Cheap identity for a parent node, used only for grouping.
  function groupKey(node) {
    if (!node.__seHolKey) node.__seHolKey = 'g' + Math.random().toString(36).slice(2);
    return node.__seHolKey;
  }

  // Walk up from the cells until we find the element containing all of them.
  // Used as the fallback anchor for slotting the card in underneath.
  function wheelContainer(cells) {
    if (!cells || !cells.length) return null;
    var node = cells[0].parentNode, last = cells[cells.length - 1], guard = 0;
    while (node && node !== document.body && guard++ < 30) {
      if (node.contains && node.contains(last)) return node;
      node = node.parentNode;
    }
    return null;
  }

  /* ==========================================================================
     6. THE CARD (sits under the wheel, above the legend)
     ========================================================================== */

  var card = null;

  // The legend row is the landmark: the card goes immediately before it. Looks
  // for the smallest element that carries all the legend words, so we don't
  // grab a big wrapper by mistake.
  function findLegend() {
    var all = document.querySelectorAll('div, p, ul, section');
    var best = null;
    for (var i = 0; i < all.length; i++) {
      var t = (all[i].textContent || '').toUpperCase();
      if (t.length > 220) continue;                 // too big to be the legend
      var hits = 0;
      for (var j = 0; j < CFG.legendWords.length; j++) {
        if (t.indexOf(CFG.legendWords[j]) !== -1) hits++;
      }
      if (hits === CFG.legendWords.length) {
        if (!best || t.length < (best.textContent || '').length) best = all[i];
      }
    }
    return best;
  }

  function buildCard() {
    if (document.getElementById('se-hol-card')) return true;

    var legend = findLegend();
    var anchorParent, anchorBefore;

    if (legend && legend.parentNode) {
      anchorParent = legend.parentNode;
      anchorBefore = legend;
    } else {
      // Fallback: straight after the wheel.
      var wc = wheelContainer(findDayCells());
      if (!wc || !wc.parentNode) return false;
      anchorParent = wc.parentNode;
      anchorBefore = wc.nextSibling;
    }

    card = document.createElement('button');
    card.id = 'se-hol-card';
    card.type = 'button';
    card.style.cssText = [
      'display:block', 'width:100%', 'box-sizing:border-box',
      'margin:14px 0', 'padding:14px 16px',
      'border:1px solid ' + theme.line, 'border-radius:12px',
      'background:transparent', 'color:' + theme.fg,
      'font:inherit', 'text-align:left', 'cursor:pointer'
    ].join(';');

    card.addEventListener('click', openSheet);
    anchorParent.insertBefore(card, anchorBefore);
    paintCard();
    return true;
  }

  // Card contents change with the data: an invitation when empty, the next
  // block of leave once something is saved.
  function paintCard() {
    if (!card) return;
    var next = nextUp();

    if (!next) {
      card.innerHTML =
        '<div style="font-size:.72rem;letter-spacing:.12em;opacity:.55">HOLIDAYS</div>' +
        '<div style="font-size:1.05rem;font-weight:700;margin-top:4px">Add your leave 🥳</div>' +
        '<div style="font-size:.85rem;opacity:.65;margin-top:2px">It shows on the wheel when it comes around</div>';
      return;
    }

    var t = typeById(next.type);
    var n = dayCount(next.start, next.end);
    var away = daysFromToday(next.start);
    var when = away > 0 ? 'In ' + away + (away === 1 ? ' day' : ' days') + ' — ' + pretty(next.start)
             : away === 0 ? 'Starts today'
             : 'On now until ' + pretty(next.end);

    card.innerHTML =
      '<div style="font-size:.72rem;letter-spacing:.12em;opacity:.55">HOLIDAYS</div>' +
      '<div style="font-size:1.05rem;font-weight:700;margin-top:4px">' + t.glyph + ' ' + t.label +
        ' <span style="font-weight:500;opacity:.7">· ' + n + (n === 1 ? ' day' : ' days') + '</span></div>' +
      '<div style="font-size:.85rem;opacity:.65;margin-top:2px">' + when + '</div>';
  }

  /* ==========================================================================
     7. THE SHEET (add / manage leave)
     Full-screen rather than a real tab panel: hooking into the app's own tab
     switching would mean guessing at its internals, and a sheet over the top
     can't break the other six tabs.
     ========================================================================== */

  var sheet = null, listEl = null, formState = { type: 'annual' };

  function buildSheet() {
    sheet = document.createElement('div');
    sheet.id = 'se-hol-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', 'Holidays');
    sheet.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:9998', 'display:none',
      'overflow-y:auto', '-webkit-overflow-scrolling:touch',
      'background:' + theme.bg, 'color:' + theme.fg,
      'font:inherit', 'padding:16px 16px 40px'
    ].join(';');

    sheet.innerHTML = [
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px">',
        '<h2 style="margin:0;font-size:1.35rem;font-weight:700">Holidays</h2>',
        '<button id="se-hol-close" style="border:1px solid ' + theme.line + ';background:transparent;color:inherit;font:inherit;padding:8px 14px;border-radius:8px">Close</button>',
      '</div>',

      '<p style="margin:0 0 18px;opacity:.7;line-height:1.5">Add your leave and it shows on the roster wheel when it comes around.</p>',

      // ---- add form -------------------------------------------------------
      '<div style="border:1px solid ' + theme.line + ';border-radius:12px;padding:14px;margin-bottom:22px">',
        '<div id="se-hol-types" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px"></div>',
        '<label style="display:block;margin-bottom:10px">',
          '<span style="display:block;font-size:.85rem;opacity:.75;margin-bottom:4px">First day</span>',
          '<input type="date" id="se-hol-start" style="width:100%;box-sizing:border-box;padding:11px;border-radius:8px;border:1px solid ' + theme.line + ';background:transparent;color:inherit;font:inherit">',
        '</label>',
        '<label style="display:block;margin-bottom:10px">',
          '<span style="display:block;font-size:.85rem;opacity:.75;margin-bottom:4px">Last day</span>',
          '<input type="date" id="se-hol-end" style="width:100%;box-sizing:border-box;padding:11px;border-radius:8px;border:1px solid ' + theme.line + ';background:transparent;color:inherit;font:inherit">',
        '</label>',
        '<label style="display:block;margin-bottom:14px">',
          '<span style="display:block;font-size:.85rem;opacity:.75;margin-bottom:4px">Note (optional)</span>',
          '<input type="text" id="se-hol-note" maxlength="60" placeholder="Fishing trip" style="width:100%;box-sizing:border-box;padding:11px;border-radius:8px;border:1px solid ' + theme.line + ';background:transparent;color:inherit;font:inherit">',
        '</label>',
        '<button id="se-hol-save" style="width:100%;padding:14px;border:0;border-radius:10px;background:' + theme.accent + ';color:#fff;font:inherit;font-weight:700">Save holiday</button>',
        '<div id="se-hol-msg" style="margin-top:10px;font-size:.85rem;min-height:1.2em"></div>',
      '</div>',

      // ---- saved list -----------------------------------------------------
      '<div id="se-hol-list"></div>'
    ].join('');

    document.body.appendChild(sheet);

    // Type chips
    var wrap = sheet.querySelector('#se-hol-types');
    TYPES.forEach(function (t) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.dataset.type = t.id;
      chip.textContent = t.glyph + ' ' + t.label;
      chip.style.cssText = 'padding:9px 13px;border-radius:999px;border:1px solid ' + theme.line +
                           ';background:transparent;color:inherit;font:inherit;font-size:.85rem';
      chip.addEventListener('click', function () { formState.type = t.id; paintChips(); });
      wrap.appendChild(chip);
    });
    paintChips();

    sheet.querySelector('#se-hol-close').addEventListener('click', closeSheet);
    sheet.querySelector('#se-hol-save').addEventListener('click', onSave);

    // Filling in the first day auto-fills the last day, since most entries are
    // a single day and re-typing it is the kind of friction the crew flagged.
    sheet.querySelector('#se-hol-start').addEventListener('change', function () {
      var end = sheet.querySelector('#se-hol-end');
      if (!end.value || end.value < this.value) end.value = this.value;
    });

    listEl = sheet.querySelector('#se-hol-list');
  }

  function paintChips() {
    var chips = sheet.querySelectorAll('#se-hol-types button');
    for (var i = 0; i < chips.length; i++) {
      var on = chips[i].dataset.type === formState.type;
      chips[i].style.background = on ? theme.accent : 'transparent';
      chips[i].style.color = on ? '#fff' : 'inherit';
      chips[i].style.borderColor = on ? theme.accent : theme.line;
    }
  }

  function msg(text, bad) {
    var el = sheet.querySelector('#se-hol-msg');
    el.textContent = text || '';
    el.style.color = bad ? '#c9483a' : theme.fg;
    el.style.opacity = bad ? '1' : '.7';
  }

  function onSave() {
    var start = sheet.querySelector('#se-hol-start').value;
    var end = sheet.querySelector('#se-hol-end').value || start;
    var note = sheet.querySelector('#se-hol-note').value.trim();

    if (!start) { msg('Pick a first day.', true); return; }
    if (end < start) { msg('The last day is before the first day.', true); return; }
    if (dayCount(start, end) > 366) { msg('That block is over a year. Split it up.', true); return; }

    records.push({
      id: 'h' + Date.now() + Math.floor(Math.random() * 1000),
      type: formState.type, start: start, end: end, note: note
    });
    sortRecords();

    if (!save()) msg('Saved on screen but storage is full — back up and clear some files.', true);
    else msg('Saved. It will show on the wheel.');

    sheet.querySelector('#se-hol-note').value = '';
    refreshAll();
  }

  function removeRecord(id) {
    records = records.filter(function (r) { return r.id !== id; });
    save();
    refreshAll();
  }

  function refreshAll() {
    rebuildIndex();
    renderList();
    paintCard();
    drawBadges();
  }

  function renderList() {
    if (!listEl) return;

    if (!records.length) {
      listEl.innerHTML = '<p style="opacity:.6;line-height:1.5">No holidays yet. Add your leave dates above.</p>';
      return;
    }

    var todayISO = iso(today());
    var upcoming = records.filter(function (r) { return r.end >= todayISO; });
    var past = records.filter(function (r) { return r.end < todayISO; });

    listEl.innerHTML = '';
    if (upcoming.length) listEl.appendChild(section('Coming up', upcoming, false));
    if (past.length) listEl.appendChild(section('Been and gone', past, true));
  }

  function section(title, rows, dim) {
    var box = document.createElement('div');
    box.style.marginBottom = '22px';

    var h = document.createElement('h3');
    h.textContent = title;
    h.style.cssText = 'margin:0 0 10px;font-size:1rem;font-weight:700;opacity:' + (dim ? '.55' : '1');
    box.appendChild(h);

    rows.forEach(function (r) {
      var t = typeById(r.type);
      var n = dayCount(r.start, r.end);

      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:flex-start;gap:10px;padding:12px 0;border-top:1px solid ' +
                          theme.line + ';opacity:' + (dim ? '.5' : '1');

      var body = document.createElement('div');
      body.style.flex = '1';
      body.innerHTML =
        '<div style="font-weight:700">' + t.glyph + ' ' +
          pretty(r.start) + (r.start === r.end ? '' : ' – ' + pretty(r.end)) + '</div>' +
        '<div style="font-size:.85rem;opacity:.7;margin-top:2px">' +
          t.label + ' · ' + n + (n === 1 ? ' day' : ' days') +
          (r.note ? ' · ' + escapeHTML(r.note) : '') + '</div>';

      var del = document.createElement('button');
      del.textContent = 'Remove';
      del.style.cssText = 'border:1px solid ' + theme.line + ';background:transparent;color:inherit;' +
                          'font:inherit;font-size:.8rem;padding:7px 11px;border-radius:8px';
      del.addEventListener('click', function () { removeRecord(r.id); });

      row.appendChild(body);
      row.appendChild(del);
      box.appendChild(row);
    });

    return box;
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function openSheet() {
    if (!sheet) buildSheet();
    renderList();
    sheet.style.display = 'block';
    sheet.scrollTop = 0;
    hideBadges(); // wheel is behind the sheet; don't leave badges floating on top
  }

  function closeSheet() {
    if (sheet) sheet.style.display = 'none';
    drawBadges();
  }

  /* ==========================================================================
     8. WHEEL BADGES
     ========================================================================== */

  var overlay = null;

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'se-hol-overlay';
    // pointer-events:none is what keeps the wheel itself tappable underneath.
    overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:60';
    document.body.appendChild(overlay);
    return overlay;
  }

  function hideBadges() {
    if (overlay) overlay.innerHTML = '';
  }

  function drawBadges() {
    if (sheet && sheet.style.display === 'block') return hideBadges();
    if (!records.length) return hideBadges();

    var cells = findDayCells();
    if (!cells || !cells.length) return hideBadges();

    // Wheel centre = average of every cell's centre. That works because the day
    // numbers are spaced evenly around a full circle.
    var sx = 0, sy = 0, boxes = [], visible = 0, c, bx;
    for (c = 0; c < cells.length; c++) {
      bx = cells[c].getBoundingClientRect();
      boxes.push(bx);
      if (bx.width || bx.height) {
        sx += bx.left + bx.width / 2;
        sy += bx.top + bx.height / 2;
        visible++;
      }
    }
    if (!visible) return hideBadges();   // roster tab isn't on screen
    var cx = sx / visible, cy = sy / visible;

    var layer = ensureOverlay();
    layer.innerHTML = '';

    var t0 = today(), vh = window.innerHeight, vw = window.innerWidth, half = CFG.badgeSize / 2;

    for (var i = 0; i < cells.length; i++) {
      var d = addDays(t0, i + CFG.wheelStartOffset);
      var rec = dateIndex[iso(d)];
      if (!rec) continue;

      var box = boxes[i];
      if (!box.width && !box.height) continue;
      if (box.bottom < 0 || box.top > vh || box.right < 0 || box.left > vw) continue;

      // Slide from the date number toward the centre so the badge lands on the
      // shift tile instead of the empty margin outside the ring.
      var px = box.left + box.width / 2, py = box.top + box.height / 2;
      px += (cx - px) * CFG.badgeInward;
      py += (cy - py) * CFG.badgeInward;

      var t = typeById(rec.type);
      var b = document.createElement('div');
      b.textContent = t.glyph;
      b.title = t.label;
      b.style.cssText = [
        'position:absolute',
        'left:' + (px - half) + 'px', 'top:' + (py - half) + 'px',
        'width:' + CFG.badgeSize + 'px', 'height:' + CFG.badgeSize + 'px',
        'line-height:' + CFG.badgeSize + 'px',
        'font-size:' + (CFG.badgeSize - 3) + 'px',
        'text-align:center',
        'filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))'
      ].join(';');
      layer.appendChild(b);
    }
  }

  /* ==========================================================================
     9. KEEPING EVERYTHING IN PLACE
     The overlay is fixed-position, so it has to be redrawn whenever the page
     moves or the wheel is rebuilt. All of it is rAF-throttled so scrolling on a
     phone stays smooth.
     ========================================================================== */

  var queued = false;
  function queueDraw() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; drawBadges(); });
  }

  function watch() {
    window.addEventListener('scroll', queueDraw, { passive: true });
    window.addEventListener('resize', function () { cellCache = null; queueDraw(); }, { passive: true });
    window.addEventListener('orientationchange', function () { cellCache = null; queueDraw(); });

    // The wheel redraws when roster settings change or tabs switch. Watching the
    // body for structural changes catches all of it without this file knowing
    // which function did the redrawing. It also puts the card back if a redraw
    // wipes it out.
    if (window.MutationObserver) {
      var mo = new MutationObserver(function () {
        cellCache = null;
        if (!document.getElementById('se-hol-card')) buildCard();
        queueDraw();
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }

    // Coming back from the lock screen: the date may have rolled over, which
    // shifts every cell by a day.
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { cellCache = null; paintCard(); queueDraw(); }
    });
  }

  /* ==========================================================================
     10. BOOT
     The wheel and legend may not exist yet depending on where the script tag
     lands, so this retries for a few seconds before giving up quietly.
     ========================================================================== */

  function boot() {
    load();
    rebuildIndex();
    sampleTheme();

    var tries = 0;
    (function attach() {
      if (buildCard()) { watch(); queueDraw(); return; }
      if (++tries < 40) setTimeout(attach, 250); // ~10 seconds
      else console.warn('[holidays] wheel/legend not found — card not added');
    })();

    // Public API for a future Pay tab / leave accrual.
    window.SEHolidays = {
      getAll: function () { return records.slice(); },
      isHoliday: function (dateObj) { return dateIndex[iso(dateObj)] || null; },
      refresh: function () { cellCache = null; refreshAll(); },
      open: openSheet
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
