/* The Ultimate Shift Engine — crib game banter & distractions
   Fourth bolt-on. Sits on top of the canvas as a DOM layer, so it needs
   no changes to the game code itself.

   pointer-events:none throughout — tapping the screen must still tip the
   bucket, so nothing here can ever swallow a tap.

   Reads the game state off the HUD: score going up is a hit, a life
   disappearing is a miss, the overlay coming back is game over. */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var wrap = $('gameWrap');
  var hudScore = $('hudScore');
  var hudLives = $('hudLives');
  var overlay = $('gameOverlay');
  if (!wrap || !hudScore || !overlay) return;

  /* ---------- the banter ---------- */

  // digger op, giving it to the truckie
  var DIGGER = [
    'Hurry up!',
    'Get a wriggle on',
    'Any day now',
    'You reversing or parking?',
    'Wakey wakey',
    'Pull up, princess',
    'I could dig it by hand quicker',
    'Are we on smoko or what',
    'Straighten her up',
    'Come on, daylight burning'
  ];

  // digger op when it's going well
  var DIGGER_GOOD = [
    'Beautiful',
    'That will do',
    'Load her up',
    'Too easy',
    'Off ya go'
  ];

  // truckie, giving it back
  var TRUCKIE = [
    'Piss off',
    'Yeah yeah',
    'Settle down',
    'Watch the paint',
    'Righto Picasso',
    'Fill it properly',
    'That was half a bucket',
    'Keep your hair on',
    'Some of us have a job to do',
    'You right there champ?'
  ];

  // truckie when the operator drops one on the deck
  var TRUCKIE_MISS = [
    'On the deck again!',
    'Nice one Rembrandt',
    'That is coming out of your pay',
    'Bloody hopeless',
    'Cleanup on aisle three',
    'You are paying for that',
    'Blind as a bat'
  ];

  /* ---------- distractions ---------- */
  var CHATTER = [
    'RADIO: smoko in five',
    'RADIO: watch the pit road',
    'RADIO: who is on the water cart',
    'RADIO: crib truck is late',
    'RADIO: dust it down mate',
    'RADIO: supervisor doing a lap',
    'RADIO: fuel truck inbound'
  ];

  /* ---------- layer ---------- */
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
    '.cdust{position:absolute;inset:0;background:radial-gradient(120% 80% at 50% 70%,' +
      'rgba(190,160,120,.55),rgba(190,160,120,0) 70%);opacity:0;' +
      'transition:opacity .5s}' +
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
  fx.innerHTML = '<div id="cribRadio"></div><div class="cdust" id="cribDust"></div>';
  wrap.appendChild(fx);

  var radio = $('cribRadio');
  var dust = $('cribDust');

  var pick = function (a) { return a[Math.floor(Math.random() * a.length)]; };

  /* ---------- bubbles ---------- */
  var lastBubble = 0;

  function bubble(side, text, bad) {
    var now = Date.now();
    if (now - lastBubble < 900) return;   // don't stack them
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

  // a quick back-and-forth
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
  var score = 0, lives = 3;
  var lastChange = Date.now();
  var nextNag = 0, nextDistract = 0;

  function num(el) {
    return parseInt(String(el ? el.textContent : '0').replace(/[^0-9]/g, ''), 10) || 0;
  }
  function lifeCount() {
    return (hudLives ? hudLives.textContent : '').replace(/[^\u25CF]/g, '').length;
  }

  function reset() {
    score = 0; lives = 3;
    lastChange = Date.now();
    nextNag = Date.now() + 5000;
    nextDistract = Date.now() + 9000;
    fx.querySelectorAll('.cbub,.cute,.cbird').forEach(function (n) { n.remove(); });
    radio.classList.remove('on');
    dust.classList.remove('on');
  }

  // overlay hidden = a game is running
  new MutationObserver(function () {
    var nowRunning = !overlay.classList.contains('hide');
    if (running && nowRunning) {            // just ended
      running = false;
      setTimeout(function () {
        fx.querySelectorAll('.cbub').forEach(function (n) { n.remove(); });
      }, 200);
    } else if (!running && !nowRunning) {   // just started
      running = true;
      reset();
    }
    running = !nowRunning;
  }).observe(overlay, { attributes: true, attributeFilter: ['class'] });

  setInterval(function () {
    if (overlay.classList.contains('hide') === false) return;  // not playing
    if (!running) { running = true; reset(); }

    var s = num(hudScore), l = lifeCount();
    var now = Date.now();

    // dropped one on the deck
    if (l < lives) {
      lives = l;
      exchange('trk', pick(TRUCKIE_MISS), DIGGER, true);
      lastChange = now;
      nextNag = now + 6000;
      return;
    }
    lives = l;

    if (s > score) {
      var jump = s - score;
      score = s;
      lastChange = now;
      nextNag = now + 5500;
      if (jump >= 60) {                       // full load bonus
        exchange('dig', pick(DIGGER_GOOD), TRUCKIE);
      } else if (Math.random() < 0.14) {
        bubble('trk', pick(TRUCKIE));
      }
      return;
    }

    // nothing happening — the digger op gets impatient
    if (now > nextNag && now - lastChange > 4500) {
      exchange('dig', pick(DIGGER), TRUCKIE);
      nextNag = now + 7000 + Math.random() * 4000;
    }

    // distractions build up as the score does
    if (now > nextDistract) {
      pick(DISTRACTIONS)();
      var gap = score > 1500 ? 3500 : score > 700 ? 5500 : 8000;
      nextDistract = now + gap + Math.random() * gap * 0.5;
    }
  }, 220);
})();
