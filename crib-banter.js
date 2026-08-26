/* The Ultimate Shift Engine — crib game banter, distractions & tempo  (v2)

   Replaces crib-banter.js. Same filename in the repo, nothing else changes.

   v2 adds the difficulty curve WITHOUT touching index.html. The game's
   speed() lives inside a closure we can't reach, so instead we control how
   many physics steps run per animation frame. More steps = the whole game
   runs faster: slew, gravity, the driver's patience timer, all of it.

   The curve, by score:
      0-250     normal        finding your feet
      250-600   1.3x          picking up
      600-1000  1.55x         flat out
      1000-1400 1.15x         SMOKO - backs right off
      1400-2000 1.65x         back into it
      2000+     1.9x          hanging on

   pointer-events:none on the whole overlay — tapping must still tip the
   bucket, so nothing here can swallow a tap. */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var wrap = $('gameWrap');
  var hudScore = $('hudScore');
  var hudLives = $('hudLives');
  var overlay = $('gameOverlay');
  var cribPanel = $('tab-crib');
  if (!wrap || !hudScore || !overlay) return;

  function score() {
    return parseInt(String(hudScore.textContent).replace(/[^0-9]/g, ''), 10) || 0;
  }

  function playing() {
    return overlay.classList.contains('hide') &&
           cribPanel && cribPanel.classList.contains('on');
  }

  /* ================= TEMPO ================= */

  function tempo() {
    var s = score();
    if (s < 250)  return 1.00;
    if (s < 600)  return 1.30;
    if (s < 1000) return 1.55;
    if (s < 1400) return 1.15;   // smoko
    if (s < 2000) return 1.65;
    return 1.90;
  }

  var rawRAF = window.requestAnimationFrame.bind(window);
  var acc = 0;
  var inLoop = false;
  var reReg = null;

  window.requestAnimationFrame = function (cb) {
    // While we're driving extra steps, swallow the game's own re-registration
    // and keep hold of it, otherwise each extra step spawns another loop.
    if (inLoop) { reReg = cb; return 0; }

    return rawRAF(function (t) {
      if (!playing()) { acc = 0; cb(t); return; }

      acc += tempo();
      var steps = Math.floor(acc);
      acc -= steps;

      if (steps < 1) {            // running slow: skip this frame
        window.requestAnimationFrame(cb);
        return;
      }

      var next = cb;
      for (var i = 0; i < steps; i++) {
        inLoop = true;
        reReg = null;
        next(t);
        inLoop = false;
        if (!reReg) return;       // game ended, it stopped rescheduling
        next = reReg;
      }
      window.requestAnimationFrame(next);
    });
  };

  /* ================= BANTER ================= */

  var DIGGER = [
    'Hurry up!', 'Get a wriggle on', 'Any day now',
    'You reversing or parking?', 'Wakey wakey', 'Pull up, princess',
    'I could dig it by hand quicker', 'Are we on smoko or what',
    'Straighten her up', 'Come on, daylight burning'
  ];

  var DIGGER_GOOD = [
    'Beautiful', 'That will do', 'Load her up', 'Too easy', 'Off ya go'
  ];

  var TRUCKIE = [
    'Piss off', 'Yeah yeah', 'Settle down', 'Watch the paint',
    'Righto Picasso', 'Fill it properly', 'That was half a bucket',
    'Keep your hair on', 'Some of us have a job to do', 'You right there champ?'
  ];

  var TRUCKIE_MISS = [
    'On the deck again!', 'Nice one Rembrandt', 'That is coming out of your pay',
    'Bloody hopeless', 'Cleanup on aisle three', 'You are paying for that',
    'Blind as a bat'
  ];

  var CHATTER = [
    'RADIO: smoko in five', 'RADIO: watch the pit road',
    'RADIO: who is on the water cart', 'RADIO: crib truck is late',
    'RADIO: dust it down mate', 'RADIO: supervisor doing a lap',
    'RADIO: fuel truck inbound'
  ];

  /* ---------- overlay ---------- */
  var css = document.createElement('style');
  css.textContent =
    '#cribFx{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:5}' +
    '.cbub{position:absolute;max-width:47%;padding:7px 11px;border-radius:11px;' +
      'font-family:Archivo,system-ui,sans-serif;font-size:12.5px;font-weight:600;' +
      'line-height:1.25;opacity:0;transform:translateY(6px);' +
      'transition:opacity .16s,transform .16s;box-shadow:0 3px 10px rgba(0,0,0,.45)}' +
    '.cbub.on{opacity:1;transform:translateY(0)}' +
    '.cbub.dig{left:4%;background:var(--day);color:var(--ink);border-bottom-left-radius:3px}' +
    '.cbub.trk{right:4%;text-align:right;background:var(--night);color:#fff;' +
      'border-bottom-right-radius:3px}' +
    '.cbub.bad{background:var(--bad);color:#fff}' +
    '#cribRadio{position:absolute;left:0;right:0;top:0;padding:6px 10px;' +
      'font-family:"IBM Plex Mono",monospace;font-size:10px;letter-spacing:.12em;' +
      'text-transform:uppercase;color:var(--muted);background:rgba(0,0,0,.55);' +
      'opacity:0;transition:opacity .3s;text-align:center}' +
    '#cribRadio.on{opacity:1}' +
    '#cribSmoko{position:absolute;left:0;right:0;top:38%;text-align:center;' +
      'font-family:Archivo,system-ui,sans-serif;font-size:30px;font-weight:800;' +
      'color:var(--home);opacity:0;transition:opacity .35s;' +
      'text-shadow:0 3px 12px rgba(0,0,0,.6)}' +
    '#cribSmoko.on{opacity:1}' +
    '.cdust{position:absolute;inset:0;background:radial-gradient(120% 80% at 50% 70%,' +
      'rgba(190,160,120,.55),rgba(190,160,120,0) 70%);opacity:0;transition:opacity .5s}' +
    '.cdust.on{opacity:1}' +
    '.cute{position:absolute;bottom:11%;width:46px;height:19px;border-radius:3px;' +
      'background:var(--home);opacity:.85}' +
    '.cute:after{content:"";position:absolute;right:5px;top:-7px;width:18px;height:8px;' +
      'border-radius:2px;background:var(--home)}' +
    '.cbird{position:absolute;font-size:15px;opacity:.75}';
  document.head.appendChild(css);

  if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';

  var fx = document.createElement('div');
  fx.id = 'cribFx';
  fx.innerHTML = '<div id="cribRadio"></div>' +
                 '<div class="cdust" id="cribDust"></div>' +
                 '<div id="cribSmoko">SMOKO</div>';
  wrap.appendChild(fx);

  var radio = $('cribRadio');
  var dust = $('cribDust');
  var smoko = $('cribSmoko');

  var pick = function (a) { return a[Math.floor(Math.random() * a.length)]; };

  var lastBubble = 0;

  function bubble(side, text, bad) {
    var now = Date.now();
    if (now - lastBubble < 900) return;
    lastBubble = now;

    var b = document.createElement('div');
    b.className = 'cbub ' + (side === 'dig' ? 'dig' : 'trk') + (bad ? ' bad' : '');
    b.textContent = text;
    b.style.top = (side === 'dig' ? 26 : 44) + '%';
    fx.appendChild(b);
    requestAnimationFrame(function () { b.classList.add('on'); });

    setTimeout(function () {
      b.classList.remove('on');
      setTimeout(function () { b.remove(); }, 260);
    }, 1750);
  }

  function exchange(first, firstText, secondList, bad) {
    bubble(first, firstText, bad);
    setTimeout(function () {
      lastBubble = 0;
      bubble(first === 'dig' ? 'trk' : 'dig', pick(secondList), false);
    }, 1150);
  }

  /* ---------- distractions ---------- */
  function radioCall() {
    radio.textContent = pick(CHATTER);
    radio.classList.add('on');
    setTimeout(function () { radio.classList.remove('on'); }, 2400);
  }

  function dustGust() {
    dust.classList.add('on');
    setTimeout(function () { dust.classList.remove('on'); }, 1400);
  }

  function ute() {
    var el = document.createElement('div');
    el.className = 'cute';
    var rtl = Math.random() < 0.5;
    el.style.left = rtl ? '104%' : '-16%';
    fx.appendChild(el);
    var x = rtl ? 104 : -16, dir = rtl ? -1 : 1, t = 0;
    var iv = setInterval(function () {
      x += dir * 1.7; t++;
      el.style.left = x + '%';
      if (t > 90 || x < -20 || x > 108) { clearInterval(iv); el.remove(); }
    }, 16);
  }

  function bird() {
    var el = document.createElement('div');
    el.className = 'cbird';
    el.textContent = '\uD83D\uDC26';
    var y = 8 + Math.random() * 22;
    el.style.top = y + '%';
    el.style.left = '-8%';
    fx.appendChild(el);
    var x = -8, t = 0;
    var iv = setInterval(function () {
      x += 1.5; t++;
      el.style.left = x + '%';
      el.style.top = (y + Math.sin(t / 9) * 3) + '%';
      if (x > 110) { clearInterval(iv); el.remove(); }
    }, 16);
  }

  var DISTRACTIONS = [radioCall, dustGust, ute, bird];

  /* ---------- watch the game ---------- */
  var running = false;
  var sc = 0, lives = 3;
  var lastChange = Date.now();
  var nextNag = 0, nextDistract = 0;
  var smokoShown = false;

  function lifeCount() {
    return (hudLives ? hudLives.textContent : '').replace(/[^\u25CF]/g, '').length;
  }

  function reset() {
    sc = 0; lives = 3; acc = 0; smokoShown = false;
    lastChange = Date.now();
    nextNag = Date.now() + 5000;
    nextDistract = Date.now() + 9000;
    fx.querySelectorAll('.cbub,.cute,.cbird').forEach(function (n) { n.remove(); });
    radio.classList.remove('on');
    dust.classList.remove('on');
    smoko.classList.remove('on');
  }

  setInterval(function () {
    if (!playing()) { running = false; return; }
    if (!running) { running = true; reset(); }

    var s = score(), l = lifeCount(), now = Date.now();

    if (l < lives) {
      lives = l;
      exchange('trk', pick(TRUCKIE_MISS), DIGGER, true);
      lastChange = now;
      nextNag = now + 6000;
      return;
    }
    lives = l;

    // announce the let-up so it reads as deliberate, not a glitch
    if (!smokoShown && s >= 1000 && s < 1400) {
      smokoShown = true;
      smoko.classList.add('on');
      setTimeout(function () { smoko.classList.remove('on'); }, 1800);
    }

    if (s > sc) {
      var jump = s - sc;
      sc = s;
      lastChange = now;
      nextNag = now + 5500;
      if (jump >= 60) exchange('dig', pick(DIGGER_GOOD), TRUCKIE);
      else if (Math.random() < 0.14) bubble('trk', pick(TRUCKIE));
      return;
    }

    if (now > nextNag && now - lastChange > 4500) {
      exchange('dig', pick(DIGGER), TRUCKIE);
      nextNag = now + 7000 + Math.random() * 4000;
    }

    if (now > nextDistract) {
      pick(DISTRACTIONS)();
      var gap = sc > 1500 ? 3500 : sc > 700 ? 5500 : 8000;
      nextDistract = now + gap + Math.random() * gap * 0.5;
    }
  }, 220);
})();
