/* ============================================================================
   THE ULTIMATE SHIFT ENGINE — LOAD THE TRUCKS  (crib.js)
   ============================================================================

   WHAT THIS IS
   The whole crib game, moved out of index.html into its own file so it can be
   changed without touching anything else. From here on, a game change is a
   same-filename replacement of this file — no hunting for lines.

   HOW IT TAKES OVER
   index.html still contains the original game code. Rather than make you cut
   it out by hand, this module rebuilds the contents of #sub-play from scratch
   on load. The old code captured its canvas and its Start button when it ran;
   once we replace those elements its references point at detached nodes and
   its Start button no longer exists, so the old game can never start. It sits
   there inert. Nothing to delete.

   The one consequence: the old script's stopGame() still fires when you leave
   the Crib tab. It acts on its own null state and does nothing. Harmless.

   WHAT'S NEW OVER THE ORIGINAL
     · Difficulty curve   fast, faster, SMOKO, faster again (see TEMPO)
     · Weather            rain arrives from shift 2 and changes how it plays
     · Hazards            lightning, blown tyre, lights out, wind, oversize
     · Truck variety      drives in from the right, or reverses in from the
                          left; sometimes leaves the way it came
     · Small trays        some trucks only take 3
     · Banter             digger op and truckie giving it to each other

   LAYOUT NOTES
   Canvas is a fixed 360x480 and CSS scales it to the container width, so all
   coordinates below are in that fixed space. GY is ground level.
   ========================================================================= */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var host = $('sub-play');
  if (!host) return;

  /* =========================================================================
     1. MARKUP
     Rebuilt with the same ids and classes the original used, so the existing
     stylesheet covers it and nothing looks different.
     ====================================================================== */

  host.innerHTML =
    '<section style="margin-bottom:18px">' +
      '<div class="gameWrap" id="gameWrap">' +
        '<canvas id="gameCanvas" width="360" height="480"></canvas>' +
        '<div class="gameOverlay" id="gameOverlay">' +
          '<div class="goTitle" id="goTitle">Load the Trucks</div>' +
          '<div class="goBody" id="goBody">Tap to tip the bucket. Fill the tray ' +
            'before the driver pulls out. Chain them for a multiplier, hit dead ' +
            'centre for double &mdash; three on the deck and you&rsquo;re done.' +
            '<br><br>Watch the weather.</div>' +
          '<button class="solid" id="goBtn" style="max-width:200px">Start</button>' +
        '</div>' +
      '</div>' +
      '<div class="hud">' +
        '<span id="hudScore">0</span>' +
        '<span id="hudLives">&#9679;&#9679;&#9679;</span>' +
      '</div>' +
      '<div class="scoreHero">' +
        '<div class="lab">Your best</div>' +
        '<div class="n2" id="bestScore">&mdash;</div>' +
        '<div class="note" id="bestNote" style="font-size:12px;color:var(--muted);' +
          'margin-top:4px"></div>' +
      '</div>' +
    '</section>';

  var wrap = $('gameWrap');
  var cv = $('gameCanvas');
  var cx = cv.getContext('2d');
  var overlay = $('gameOverlay');
  var goTitle = $('goTitle');
  var goBody = $('goBody');
  var goBtn = $('goBtn');
  var hudScore = $('hudScore');
  var hudLives = $('hudLives');

  /* =========================================================================
     2. GEOMETRY AND TUNING
     Everything you'd want to fiddle with lives here, not scattered about.
     ====================================================================== */

  var W = 360, H = 480;          // canvas, fixed
  var GY = 404;                  // ground line
  var PX = 100, PY = 344;        // excavator slew centre
  var ARM = 158;                 // boom length
  var PARK = 168;                // where the truck stops

  var SWL = -2.12;               // slew limit, over the muck pile
  var SWR = -0.34;               // slew limit, over the tray
  var ARC = SWR - SWL;

  var TRUCK_W = 150;             // overall truck length, for mirroring
  var TRAY_W = 98;               // tray opening
  var TRAY_OFF = 18;             // tray offset from truck origin, facing left
  var TRAY_TOP = GY - 70;        // height the load has to reach

  var LIVES = 3;
  var BIG_CAP = 5;               // normal tray
  var SMALL_CAP = 3;             // the little fella

  /* =========================================================================
     3. TEMPO — the difficulty curve
     Slew speed and the driver's patience both derive from this, so one curve
     drives the whole feel. Patience is DERIVED from cycle time, never a fixed
     number, which guarantees a full load is always physically possible.
     ====================================================================== */

  function baseSpeed(lvl) {
    return Math.min(0.078, 0.030 + (lvl - 1) * 0.0062);
  }

  // Shifts 5-7 are smoko: it backs right off, then climbs again harder.
  function tempoFor(lvl) {
    if (lvl >= 5 && lvl <= 7) return 0.84;
    return 1;
  }

  function speed() {
    var s = baseSpeed(G.lvl) * tempoFor(G.lvl);
    if (G.wx === 'rain') s *= 0.94;   // greasy, slew eases off a touch
    if (G.overheat > 0) s *= 0.35;    // hydraulics cooked
    return s;
  }

  var cycleFrames = function () { return 2 * ARC / speed(); };

  // How long the driver waits. Scales with tray size so a small tray isn't
  // a free ride, and tightens as the shifts go on.
  function patience(cap) {
    return Math.round(cycleFrames() * cap * Math.max(1.18, 2.05 - (G.lvl - 1) * 0.11));
  }

  /* =========================================================================
     4. WEATHER
     Clear until shift 2. After that it can set in and change how it plays:
     the load drifts on the wind, the bucket goes greasy and lets go early,
     and the truck takes longer to pull up on the wet.
     ====================================================================== */

  var WEATHER = ['clear', 'clear', 'rain'];

  function rollWeather() {
    if (G.lvl < 2) { G.wx = 'clear'; return; }
    var pick = WEATHER[Math.floor(Math.random() * WEATHER.length)];
    if (pick !== G.wx) {
      G.wx = pick;
      banner(pick === 'rain' ? 'RAIN' : 'CLEARING', pick === 'rain' ? C.night : C.home);
      if (pick === 'rain') seedRain();
    }
  }

  function seedRain() {
    G.rain = [];
    for (var i = 0; i < 90; i++) {
      G.rain.push({
        x: Math.random() * (W + 60) - 30,
        y: Math.random() * H,
        l: 8 + Math.random() * 10,
        v: 9 + Math.random() * 6
      });
    }
  }

  /* =========================================================================
     5. HAZARDS
     Each one is short, readable on screen, and takes something away rather
     than just killing you. The nastiest is the blown tyre: the truck can't
     leave, but you can't load it either, and the clock keeps running.
     ====================================================================== */

  var HAZARDS = [
    {
      id: 'lightning',                 // rain only
      wet: true,
      from: 3,
      go: function () {
        G.flashWhite = 8;
        G.thunder = 26;
        // 60% of the time it takes a tyre out
        if (Math.random() < 0.6 && G.truck.state === 'load' && !G.truck.flat) {
          G.truck.flat = 140;          // frames the tray is out of action
          pop(trayMid(), TRAY_TOP - 30, 'TYRE OUT', C.bad);
          say('trk', 'She has blown a tyre!', true);
          buzz([30, 60, 30]);
        } else {
          pop(W / 2, 90, 'LIGHTNING', C.night);
        }
      }
    },
    {
      id: 'lightsout',
      from: 3,
      go: function () {
        G.dark = 300;                  // ~5 seconds of near blackout
        banner('LIGHTS OUT', C.bad);
        say('dig', 'Who killed the lights?');
        buzz(60);
      }
    },
    {
      id: 'gust',
      from: 2,
      go: function () {
        G.gust = 120;
        G.gustDir = Math.random() < 0.5 ? -1 : 1;
        pop(W / 2, 110, 'WIND', C.muted);
      }
    },
    {
      id: 'overheat',
      from: 4,
      go: function () {
        G.overheat = 150;
        banner('HYDRAULICS HOT', C.day);
        say('dig', 'She is running hot');
      }
    },
    {
      id: 'oversize',
      from: 2,
      go: function () {
        G.nextOversize = true;         // next bucket is one big rock
        pop(bx(), by() - 34, 'OVERSIZE', C.day);
      }
    },
    {
      id: 'super',
      from: 5,
      go: function () {
        G.super = 420;                 // supervisor on the pad
        banner('SUPERVISOR ON THE PAD', C.travel);
        say('trk', 'Look busy');
      }
    }
  ];

  function maybeHazard() {
    if (G.hazCool > 0) { G.hazCool--; return; }
    if (G.lvl < 2) return;
    // gets more likely as the shifts stack up
    var chance = 0.0016 + (G.lvl - 2) * 0.0007;
    if (Math.random() > chance) return;

    var pool = HAZARDS.filter(function (h) {
      if (G.lvl < h.from) return false;
      if (h.wet && G.wx !== 'rain') return false;
      return true;
    });
    if (!pool.length) return;

    pool[Math.floor(Math.random() * pool.length)].go();
    G.hazCool = 420;                   // no back-to-back pile-ons
  }

  /* =========================================================================
     6. STATE
     ====================================================================== */

  var G = null, raf = null, C = {}, STAR = [];
  for (var i = 0; i < 26; i++) {
    STAR.push({ x: Math.random() * W, y: Math.random() * 250, r: Math.random() * 1.3 + 0.4 });
  }

  function colours() {
    var cs = getComputedStyle(document.documentElement);
    var g = function (k) { return cs.getPropertyValue('--' + k).trim(); };
    C = {
      bg: g('bg'), surf: g('surface-2'), line: g('line'), text: g('text'),
      muted: g('muted'), day: g('day'), day2: g('day2'), night: g('night'),
      night2: g('night2'), home: g('home'), bad: g('bad'), ink: g('ink')
    };
  }

  var buzz = function (n) { try { navigator.vibrate && navigator.vibrate(n); } catch (e) {} };
  var night = function () { return G.lvl >= 3; };

  function newGame() {
    colours();
    G = {
      score: 0, lives: LIVES, combo: 0, bestCombo: 0, lvl: 1, hauled: 0,
      shake: 0, flash: 0, flashWhite: 0, thunder: 0, banner: 0, bannerTxt: '',
      bannerCol: null,
      swing: SWL, dir: 1, bucket: 1, gold: false, tipA: 0, load: null,
      dust: [], spill: [], pops: [], truck: null, over: false, beacon: 0,
      wx: 'clear', rain: [], gust: 0, gustDir: 1, dark: 0, overheat: 0,
      super: 0, nextOversize: false, hazCool: 300, t: 0
    };
    nextTruck(true);
  }

  function lvlUp() {
    G.lvl++;
    banner(G.lvl === 3 ? 'NIGHT SHIFT' : 'SHIFT ' + G.lvl, C.day);
    buzz([15, 40, 15]);
    rollWeather();
  }

  function banner(txt, col) {
    G.banner = 76; G.bannerTxt = txt; G.bannerCol = col || C.day;
  }

  /* =========================================================================
     7. TRUCKS
     Two approaches. Driving in from the right is the familiar one. Reversing
     in from the left flips the whole picture, so your aim point and your
     timing both move and you have to read it fresh.
     ====================================================================== */

  function nextTruck(first) {
    // from shift 2 on, one in three reverses in from the left
    var reverse = G.lvl >= 2 && Math.random() < 0.34;
    // small tray shows up from shift 3
    var small = G.lvl >= 3 && Math.random() < 0.28;

    G.truck = {
      face: reverse ? -1 : 1,
      x: reverse ? -TRUCK_W - 60 : W + 90,
      state: 'in',
      fill: 0,
      cap: small ? SMALL_CAP : BIG_CAP,
      tip: 0,
      timer: 0,
      creep: 0,
      roll: 0,
      flat: 0,
      backOut: Math.random() < 0.35   // leaves the way it came
    };
    G.window = patience(G.truck.cap);
    if (!first) G.hauled++;
    if (small) pop(PARK + 66, TRAY_TOP - 44, 'SMALL TRAY', C.travel);
  }

  // Left edge of the tray opening, accounting for which way the truck faces.
  function trayX() {
    var t = G.truck;
    var off = t.face === 1 ? TRAY_OFF : (TRUCK_W - TRAY_OFF - TRAY_W);
    return t.x + t.creep + off;
  }
  function trayMid() { return trayX() + TRAY_W / 2; }

  /* =========================================================================
     8. EXCAVATOR AND THE LOAD
     ====================================================================== */

  var bx = function () { return PX + Math.cos(G.swing) * ARM; };
  var by = function () { return PY + Math.sin(G.swing) * ARM; };

  function pop(x, y, t, c) { G.pops.push({ x: x, y: y, t: t, c: c || C.text, l: 44 }); }

  function puff(x, y, n, c, p) {
    for (var i = 0; i < n; i++) {
      G.dust.push({
        x: x, y: y, vx: (Math.random() - 0.5) * (p || 2.2),
        vy: -Math.random() * 1.7, r: 2.5 + Math.random() * 3,
        l: 24 + Math.random() * 20, c: c || C.muted
      });
    }
  }

  function tipBucket() {
    if (!G || G.over || G.load || !G.bucket) return;
    G.load = {
      x: bx(), y: by(), vy: 0,
      vx: Math.cos(G.swing) * 0.6,
      gold: G.gold,
      big: G.oversize,                 // oversize: dead centre or it bounces
      rk: [[0, 0], [-6, 3], [6, 2], [1, -6]]
    };
    G.bucket = 0; G.gold = false; G.oversize = false; G.tipA = 14;
  }

  cv.addEventListener('pointerdown', function (e) { e.preventDefault(); tipBucket(); });

  /* =========================================================================
     9. TICK — one step of the simulation
     ====================================================================== */

  function tick() {
    G.t++;
    if (G.flash > 0) G.flash--;
    if (G.flashWhite > 0) G.flashWhite--;
    if (G.thunder > 0) G.thunder--;
    if (G.shake > 0) G.shake--;
    if (G.banner > 0) G.banner--;
    if (G.tipA > 0) G.tipA--;
    if (G.gust > 0) G.gust--;
    if (G.dark > 0) G.dark--;
    if (G.overheat > 0) G.overheat--;
    if (G.super > 0) G.super--;
    G.beacon += 0.11;

    // level up on score
    var want = 1 + Math.floor(G.score / 250);
    if (want > G.lvl) lvlUp();

    maybeHazard();

    /* ---- slew ---- */
    G.swing += speed() * G.dir;
    if (G.swing > SWR) { G.swing = SWR; G.dir = -1; }
    if (G.swing < SWL) { G.swing = SWL; G.dir = 1; }

    // refill at the pile
    if (!G.bucket && !G.load && G.swing < SWL + 0.12) {
      G.bucket = 1;
      G.gold = G.lvl >= 2 && Math.random() < 0.15;
      G.oversize = G.nextOversize; G.nextOversize = false;
      puff(bx(), by() + 16, 6, C.muted, 3);
    }

    // greasy bucket: in the rain it sometimes lets go on its own
    if (G.wx === 'rain' && G.bucket && !G.load && Math.random() < 0.0009) {
      say('dig', 'She slipped!');
      tipBucket();
    }

    /* ---- truck ---- */
    var tr = G.truck;

    if (tr.state === 'in') {
      var approach = (G.wx === 'rain' ? 3.4 : 4.6) * tr.face;
      tr.x -= approach;                       // face -1 makes this move right
      tr.roll -= 0.09 * tr.face;
      if (G.t % 3 === 0) puff(tr.x + 40, GY - 4, 1, C.line, 1.2);

      var there = tr.face === 1 ? (tr.x <= PARK) : (tr.x >= PARK);
      if (there) { tr.x = PARK; tr.state = 'load'; tr.timer = G.window; }
    }

    else if (tr.state === 'load') {
      if (tr.flat > 0) {
        tr.flat--;                            // stuck on the flat, tray closed
        if (G.t % 8 === 0) puff(tr.x + 30, GY - 6, 1, C.bad, 1.4);
        if (tr.flat === 0) {
          pop(trayMid(), TRAY_TOP - 30, 'TYRE ON', C.home);
          say('trk', 'Righto, back in it');
        }
      } else {
        tr.timer--;
        if (G.lvl >= 4) tr.creep += 0.14;     // impatient driver rolls forward
      }

      if (tr.fill >= tr.cap) {
        var bonus = 70 + G.combo * 12;
        G.score += bonus;
        pop(trayMid(), TRAY_TOP - 48, 'FULL LOAD +' + bonus, C.home);
        say('dig', 'Off ya go');
        tr.state = 'off'; G.flash = 26; buzz(50);
      } else if (tr.timer <= 0) {
        tr.state = 'off';
        pop(trayMid(), TRAY_TOP - 48, 'DRIVER GONE', C.bad);
      }
    }

    else if (tr.state === 'off') {
      tr.tip = Math.min(1, tr.tip + 0.05);
      // backOut sends him out the way he came, otherwise he carries on through
      var out = tr.backOut ? -tr.face : tr.face;
      tr.x -= 5.6 * out;
      tr.roll -= 0.12 * out;
      if (G.t % 2 === 0) puff(tr.x + 40, GY - 4, 1, C.line, 1.6);
      if (tr.x < -TRUCK_W - 120 || tr.x > W + 160) nextTruck();
    }

    /* ---- the load in the air ---- */
    if (G.load) {
      G.load.vy += 0.44;
      G.load.y += G.load.vy;
      G.load.x += G.load.vx;

      // wind pushes it sideways — the whole point of the gust hazard
      if (G.gust > 0) G.load.x += G.gustDir * 0.55;
      else if (G.wx === 'rain') G.load.x += Math.sin(G.t / 40) * 0.18;

      var tx = trayX();
      var inTray = G.load.y >= TRAY_TOP && tr.state === 'load' && tr.flat === 0 &&
                   G.load.x > tx && G.load.x < tx + TRAY_W;

      if (inTray) {
        var mid = tx + TRAY_W / 2;
        var dead = Math.abs(G.load.x - mid) < 21;

        // oversize has to be dead centre or it bounces straight back out
        if (G.load.big && !dead) {
          pop(G.load.x, TRAY_TOP - 14, 'BOUNCED OUT', C.bad);
          puff(G.load.x, TRAY_TOP, 10, C.day, 3);
          G.combo = 0; G.load = null; buzz(40);
        } else {
          G.combo++;
          if (G.combo > G.bestCombo) G.bestCombo = G.combo;
          var mult = Math.min(5, 1 + Math.floor(G.combo / 3));
          var pts = 15 * mult;
          if (dead) pts *= 2;
          if (G.load.gold) pts *= 3;
          if (G.load.big) pts *= 4;
          G.score += pts;
          tr.fill++;
          pop(G.load.x, TRAY_TOP - 12,
              (G.load.big ? 'OVERSIZE ' : G.load.gold ? 'GOLD ' : dead ? 'DEAD CENTRE ' : '') +
              '+' + pts,
              G.load.big ? C.travel : G.load.gold ? C.day : dead ? C.home : C.text);
          puff(G.load.x, TRAY_TOP + 4, 9, G.load.gold ? C.day : C.muted, 3);
          buzz(dead ? 25 : 12);
          if (Math.random() < 0.13) say('trk', pickFrom(TRUCKIE));
          G.load = null;
        }
      }

      else if (G.load.y >= GY - 8) {
        // on the deck. Costs two lives if the supervisor's watching.
        var cost = G.super > 0 ? 2 : 1;
        G.lives -= cost;
        G.combo = 0; G.shake = 15;
        puff(G.load.x, GY - 6, 14, C.bad, 3.4);
        G.spill.push({ x: G.load.x, s: 0 });
        pop(G.load.x, GY - 46, cost > 1 ? 'ON THE DECK x2' : 'ON THE DECK', C.bad);
        say('trk', pickFrom(TRUCKIE_MISS), true);
        G.load = null; buzz(80);
        if (G.lives <= 0) return endGame();
      }
    }

    /* ---- particles ---- */
    G.dust.forEach(function (d) { d.x += d.vx; d.y += d.vy; d.vy += 0.028; d.l--; });
    G.dust = G.dust.filter(function (d) { return d.l > 0; });
    G.pops.forEach(function (p) { p.y -= 0.9; p.l--; });
    G.pops = G.pops.filter(function (p) { return p.l > 0; });
    G.spill.forEach(function (p) { p.s = Math.min(1, p.s + 0.06); });

    if (G.wx === 'rain') {
      G.rain.forEach(function (r) {
        r.y += r.v; r.x += 1.6 + (G.gust > 0 ? G.gustDir * 2.2 : 0);
        if (r.y > H) { r.y = -12; r.x = Math.random() * (W + 60) - 30; }
      });
    }

    idleBanter();

    hudScore.textContent = G.score.toLocaleString('en-AU');
    hudLives.textContent = '\u25CF'.repeat(Math.max(0, G.lives));
  }

  /* =========================================================================
     10. BANTER
     Digger op and truckie giving each other a serve. Drawn on the canvas so
     it can't ever swallow a tap.
     ====================================================================== */

  var DIGGER = ['Hurry up!', 'Get a wriggle on', 'Any day now',
    'You reversing or parking?', 'Wakey wakey', 'Pull up, princess',
    'I could dig it by hand quicker', 'Are we on smoko or what',
    'Straighten her up', 'Daylight burning'];

  var TRUCKIE = ['Piss off', 'Yeah yeah', 'Settle down', 'Watch the paint',
    'Righto Picasso', 'Fill it properly', 'That was half a bucket',
    'Keep your hair on', 'You right there champ?'];

  var TRUCKIE_MISS = ['On the deck again!', 'Nice one Rembrandt', 'Bloody hopeless',
    'That is coming out of your pay', 'Blind as a bat', 'Cleanup on aisle three'];

  function pickFrom(a) { return a[Math.floor(Math.random() * a.length)]; }

  // one bubble at a time, so they never stack up and cover the tray
  function say(who, txt, bad) {
    if (G.bub && G.bub.l > 40) return;
    G.bub = { who: who, txt: txt, bad: !!bad, l: 110 };
  }

  var lastAction = 0;
  function idleBanter() {
    if (G.bub) { G.bub.l--; if (G.bub.l <= 0) G.bub = null; }
    if (G.truck.state !== 'load' || G.truck.fill > 0) { lastAction = G.t; return; }
    if (G.t - lastAction > 260 && Math.random() < 0.02) {
      say('dig', pickFrom(DIGGER));
      lastAction = G.t;
    }
  }

  /* =========================================================================
     11. DRAWING
     ====================================================================== */

  function rr(x, y, w, h, r) {
    cx.beginPath(); cx.moveTo(x + r, y);
    cx.arcTo(x + w, y, x + w, y + h, r); cx.arcTo(x + w, y + h, x, y + h, r);
    cx.arcTo(x, y + h, x, y, r); cx.arcTo(x, y, x + w, y, r);
    cx.closePath(); cx.fill();
  }

  function bigWheel(x, y, r, roll, flat) {
    cx.fillStyle = '#0a0a0a';
    cx.beginPath();
    if (flat) cx.ellipse(x, y + r * 0.25, r, r * 0.72, 0, 0, 7);
    else cx.arc(x, y, r, 0, 7);
    cx.fill();
    cx.fillStyle = C.muted;
    cx.beginPath(); cx.arc(x, y, r * 0.40, 0, 7); cx.fill();
    cx.strokeStyle = C.line; cx.lineWidth = 2;
    for (var i = 0; i < 5; i++) {
      var a = roll + i * 1.256;
      cx.beginPath(); cx.moveTo(x, y);
      cx.lineTo(x + Math.cos(a) * r * 0.36, y + Math.sin(a) * r * 0.36);
      cx.stroke();
    }
  }

  function haulTruck(tr) {
    cx.save();
    // mirror the whole truck when it's reversed in from the left
    if (tr.face === -1) {
      cx.translate(tr.x + tr.creep + TRUCK_W, GY);
      cx.scale(-1, 1);
      cx.translate(0, -GY);
      cx.translate(-0, 0);
      drawTruckBody(tr, 0);
    } else {
      drawTruckBody(tr, tr.x + tr.creep);
    }
    cx.restore();
  }

  function drawTruckBody(tr, x) {
    var y = GY;

    if (night()) {                                  // headlight wash
      cx.fillStyle = C.day; cx.globalAlpha = 0.12;
      cx.beginPath();
      cx.moveTo(x + 150, y - 40); cx.lineTo(x + 250, y - 66);
      cx.lineTo(x + 250, y - 2); cx.closePath(); cx.fill();
      cx.globalAlpha = 1;
    }

    // dump body, tips up when he pulls out
    cx.save();
    cx.translate(x + 18, y - 38);
    cx.rotate(-tr.tip * 0.52);
    cx.fillStyle = C.line;
    cx.beginPath();
    cx.moveTo(0, -6); cx.lineTo(-8, -40); cx.lineTo(104, -32);
    cx.lineTo(104, 6); cx.lineTo(4, 6); cx.closePath(); cx.fill();
    cx.fillStyle = C.muted; cx.fillRect(92, -46, 26, 10);

    if (tr.fill > 0) {                              // heaped dirt
      var f = tr.fill / tr.cap;
      cx.fillStyle = C.day2;
      cx.beginPath(); cx.moveTo(2, 4);
      for (var i = 0; i <= 6; i++) {
        var px = 2 + i * 16;
        var h = Math.sin(i / 6 * Math.PI) * 26 * f + 8 * f;
        cx.lineTo(px, 4 - h);
      }
      cx.lineTo(98, 4); cx.closePath(); cx.fill();
    }
    cx.restore();

    // chassis, cab, stacks
    cx.fillStyle = C.day2; rr(x + 8, y - 30, 124, 18, 3);
    cx.fillStyle = C.day; rr(x + 112, y - 56, 30, 28, 3);
    cx.fillStyle = night() ? C.home : C.night; rr(x + 117, y - 51, 20, 13, 2);
    cx.fillStyle = C.line;
    cx.fillRect(x + 104, y - 62, 5, 16);
    cx.fillRect(x + 96, y - 58, 5, 12);
    if (night()) {
      cx.fillStyle = C.day;
      cx.beginPath(); cx.arc(x + 142, y - 44, 3.5, 0, 7); cx.fill();
    }

    bigWheel(x + 36, y - 12, 19, tr.roll, tr.flat > 0);
    bigWheel(x + 66, y - 12, 19, tr.roll, false);
    bigWheel(x + 126, y - 11, 17, tr.roll, false);
  }

  function excavator() {
    cx.fillStyle = '#0a0a0a'; rr(PX - 58, GY - 30, 116, 26, 12);
    cx.fillStyle = C.line;
    for (var i = 0; i < 8; i++) cx.fillRect(PX - 51 + i * 14, GY - 27, 8, 20);
    cx.fillStyle = C.muted;
    cx.beginPath(); cx.arc(PX - 42, GY - 17, 9, 0, 7); cx.arc(PX + 42, GY - 17, 9, 0, 7); cx.fill();
    cx.fillStyle = C.line; rr(PX - 26, GY - 38, 52, 10, 3);
    cx.fillStyle = C.day2; rr(PX - 44, GY - 70, 80, 34, 5);
    cx.fillStyle = C.line; rr(PX - 58, GY - 64, 18, 26, 3);
    cx.fillStyle = C.muted; cx.fillRect(PX - 20, GY - 84, 6, 15);
    cx.fillStyle = C.day; rr(PX + 10, GY - 92, 30, 30, 4);
    cx.fillStyle = night() ? C.home : C.night; rr(PX + 15, GY - 87, 20, 15, 2);

    // beacon — goes red while the hydraulics are hot
    var bl = (Math.sin(G.beacon) + 1) / 2;
    cx.globalAlpha = 0.35 + bl * 0.65;
    cx.fillStyle = G.overheat > 0 ? C.bad : C.day;
    cx.beginPath(); cx.arc(PX + 25, GY - 96, 4.5, 0, 7); cx.fill();
    cx.globalAlpha = 1;

    // boom and stick
    var ex = PX + Math.cos(G.swing + 0.36) * (ARM * 0.55);
    var ey = PY + Math.sin(G.swing + 0.36) * (ARM * 0.55);
    cx.lineCap = 'round';
    cx.strokeStyle = C.line; cx.lineWidth = 16;
    cx.beginPath(); cx.moveTo(PX, PY); cx.lineTo(ex, ey); cx.stroke();
    cx.strokeStyle = C.day2; cx.lineWidth = 11;
    cx.beginPath(); cx.moveTo(PX, PY); cx.lineTo(ex, ey); cx.stroke();
    cx.strokeStyle = C.line; cx.lineWidth = 13;
    cx.beginPath(); cx.moveTo(ex, ey); cx.lineTo(bx(), by()); cx.stroke();
    cx.strokeStyle = C.day2; cx.lineWidth = 8;
    cx.beginPath(); cx.moveTo(ex, ey); cx.lineTo(bx(), by()); cx.stroke();

    // bucket
    cx.save();
    cx.translate(bx(), by());
    cx.rotate(G.swing + 1.57 + (G.tipA / 14) * 1.15);
    cx.fillStyle = C.line;
    cx.beginPath(); cx.moveTo(-15, -5); cx.lineTo(15, -5);
    cx.lineTo(10, 20); cx.lineTo(-10, 20); cx.closePath(); cx.fill();
    cx.fillStyle = C.text;
    for (var j = -1; j < 2; j++) cx.fillRect(j * 8 - 2, 19, 4, 6);
    if (G.bucket) {
      cx.fillStyle = G.oversize ? C.travel : G.gold ? C.day : C.day2;
      cx.beginPath();
      if (G.oversize) {                              // one big rock
        cx.moveTo(-13, -5); cx.lineTo(13, -5); cx.lineTo(6, -26); cx.lineTo(-8, -24);
      } else {
        cx.moveTo(-12, -5); cx.lineTo(12, -5); cx.lineTo(0, -20);
      }
      cx.closePath(); cx.fill();
    }
    cx.restore();
  }

  function backdrop() {
    var sky = cx.createLinearGradient(0, 0, 0, GY);
    if (night()) { sky.addColorStop(0, '#060910'); sky.addColorStop(1, C.bg); }
    else if (G.wx === 'rain') { sky.addColorStop(0, '#1b2330'); sky.addColorStop(1, C.surf); }
    else { sky.addColorStop(0, C.bg); sky.addColorStop(1, C.surf); }
    cx.fillStyle = sky; cx.fillRect(-20, -20, W + 40, H + 40);

    if (night() && G.wx !== 'rain') {
      cx.fillStyle = C.text;
      STAR.forEach(function (s) {
        cx.globalAlpha = 0.5;
        cx.beginPath(); cx.arc(s.x, s.y, s.r, 0, 7); cx.fill();
      });
      cx.globalAlpha = 1;
    }

    // pit benches
    cx.fillStyle = C.line; cx.globalAlpha = night() ? 0.32 : 0.5;
    cx.beginPath();
    cx.moveTo(-20, GY - 4); cx.lineTo(-20, 300); cx.lineTo(70, 296);
    cx.lineTo(96, 266); cx.lineTo(210, 262); cx.lineTo(238, 236);
    cx.lineTo(W + 20, 232); cx.lineTo(W + 20, GY - 4);
    cx.closePath(); cx.fill(); cx.globalAlpha = 1;

    cx.fillStyle = C.surf; cx.globalAlpha = night() ? 0.5 : 0.85;
    cx.beginPath();
    cx.moveTo(-20, GY - 4); cx.lineTo(-20, 336); cx.lineTo(120, 332);
    cx.lineTo(150, 306); cx.lineTo(W + 20, 302); cx.lineTo(W + 20, GY - 4);
    cx.closePath(); cx.fill(); cx.globalAlpha = 1;
  }

  function drawRain() {
    cx.strokeStyle = C.night; cx.globalAlpha = 0.35; cx.lineWidth = 1.4;
    cx.beginPath();
    G.rain.forEach(function (r) {
      cx.moveTo(r.x, r.y);
      cx.lineTo(r.x - 2.5, r.y + r.l);
    });
    cx.stroke(); cx.globalAlpha = 1;
  }

  function drawBubble() {
    if (!G.bub) return;
    var b = G.bub;
    var left = b.who === 'dig';
    cx.font = '700 13px Archivo, sans-serif';
    var w = Math.min(150, cx.measureText(b.txt).width + 20);
    var x = left ? 14 : W - 14 - w;
    var y = left ? 128 : 178;
    cx.globalAlpha = Math.min(1, b.l / 26);
    cx.fillStyle = b.bad ? C.bad : left ? C.day : C.night;
    rr(x, y, w, 28, 8);
    cx.fillStyle = b.bad ? '#fff' : left ? C.ink : '#fff';
    cx.textAlign = 'center';
    cx.fillText(b.txt, x + w / 2, y + 19);
    cx.globalAlpha = 1;
  }

  function draw() {
    cx.save();
    if (G.shake > 0) cx.translate((Math.random() - 0.5) * G.shake, (Math.random() - 0.5) * G.shake);

    backdrop();

    // pad
    cx.fillStyle = C.surf; cx.fillRect(-20, GY - 6, W + 40, H - GY + 26);
    cx.strokeStyle = C.line; cx.lineWidth = 2;
    cx.beginPath(); cx.moveTo(-20, GY - 6); cx.lineTo(W + 20, GY - 6); cx.stroke();

    // muck pile
    cx.fillStyle = C.line;
    cx.beginPath(); cx.moveTo(-20, GY - 6); cx.lineTo(26, GY - 104);
    cx.lineTo(92, GY - 6); cx.closePath(); cx.fill();

    G.spill.forEach(function (p) {
      cx.fillStyle = C.bad; cx.globalAlpha = 0.4;
      cx.beginPath(); cx.ellipse(p.x, GY - 5, 16 * p.s, 4.5 * p.s, 0, 0, 7);
      cx.fill(); cx.globalAlpha = 1;
    });

    haulTruck(G.truck);
    excavator();

    // aim line
    if (G.bucket && !G.load && G.truck.state === 'load' && G.truck.flat === 0) {
      cx.strokeStyle = C.home; cx.globalAlpha = 0.45; cx.lineWidth = 2;
      cx.setLineDash([5, 6]);
      cx.beginPath(); cx.moveTo(bx(), by() + 20); cx.lineTo(bx(), TRAY_TOP - 4); cx.stroke();
      cx.setLineDash([]); cx.globalAlpha = 1;
    }

    if (G.load) {
      cx.fillStyle = G.load.big ? C.travel : G.load.gold ? C.day : C.day2;
      if (G.load.big) {
        cx.beginPath(); cx.arc(G.load.x, G.load.y, 10, 0, 7); cx.fill();
      } else {
        G.load.rk.forEach(function (r) {
          cx.beginPath(); cx.arc(G.load.x + r[0], G.load.y + r[1], 4.5, 0, 7); cx.fill();
        });
      }
    }

    G.dust.forEach(function (d) {
      cx.globalAlpha = Math.max(0, d.l / 46); cx.fillStyle = d.c;
      cx.beginPath(); cx.arc(d.x, d.y, d.r, 0, 7); cx.fill(); cx.globalAlpha = 1;
    });

    if (G.wx === 'rain') drawRain();

    /* ---- HUD on canvas ---- */
    cx.textAlign = 'center';
    var tr = G.truck;
    if (tr.state === 'load') {
      var tx = trayX();
      cx.fillStyle = C.muted; cx.font = '600 12px "IBM Plex Mono",monospace';
      cx.fillText(tr.fill + ' / ' + tr.cap, tx + TRAY_W / 2, TRAY_TOP - 34);
      var bw = Math.max(0, tr.timer / G.window) * TRAY_W;
      cx.fillStyle = C.line; cx.fillRect(tx, TRAY_TOP - 28, TRAY_W, 5);
      cx.fillStyle = tr.flat > 0 ? C.bad : tr.timer < 140 ? C.bad : C.home;
      cx.fillRect(tx, TRAY_TOP - 28, bw, 5);
    }

    G.pops.forEach(function (p) {
      cx.globalAlpha = Math.min(1, p.l / 26); cx.fillStyle = p.c;
      cx.font = '700 13px "IBM Plex Mono",monospace';
      cx.fillText(p.t, p.x, p.y); cx.globalAlpha = 1;
    });

    drawBubble();

    cx.textAlign = 'left'; cx.font = '700 13px "IBM Plex Mono",monospace';
    cx.fillStyle = C.muted;
    cx.fillText((night() ? 'NIGHT ' : '') + 'SHIFT ' + G.lvl +
                (G.wx === 'rain' ? ' \u00b7 WET' : ''), 12, 24);
    cx.fillText(G.hauled + ' AWAY', 12, 42);

    if (G.combo >= 3) {
      cx.textAlign = 'right'; cx.fillStyle = C.day;
      cx.font = '800 22px "IBM Plex Mono",monospace';
      cx.fillText('x' + Math.min(5, 1 + Math.floor(G.combo / 3)), W - 12, 28);
    }

    if (G.super > 0) {
      cx.textAlign = 'right'; cx.fillStyle = C.travel;
      cx.font = '700 11px "IBM Plex Mono",monospace';
      cx.fillText('SUPERVISOR WATCHING', W - 12, 48);
    }

    if (G.banner > 0) {
      cx.globalAlpha = Math.min(1, G.banner / 26);
      cx.textAlign = 'center'; cx.fillStyle = G.bannerCol;
      cx.font = '800 30px Archivo,sans-serif';
      cx.fillText(G.bannerTxt, W / 2, 150);
      cx.globalAlpha = 1;
    }

    // lights out — everything but the beacon and headlights goes
    if (G.dark > 0) {
      cx.globalAlpha = Math.min(0.93, G.dark / 40);
      cx.fillStyle = '#000'; cx.fillRect(-20, -20, W + 40, H + 40);
      cx.globalAlpha = 1;
    }

    if (G.flashWhite > 0) {
      cx.globalAlpha = G.flashWhite / 10;
      cx.fillStyle = '#fff'; cx.fillRect(-20, -20, W + 40, H + 40);
      cx.globalAlpha = 1;
    }

    if (G.flash > 0) {
      cx.globalAlpha = G.flash / 50;
      cx.fillStyle = C.home; cx.fillRect(-20, -20, W + 40, H + 40);
      cx.globalAlpha = 1;
    }

    cx.restore();
  }

  /* =========================================================================
     12. LOOP AND LIFECYCLE
     ====================================================================== */

  function loop() {
    if (!G || G.over) return;
    tick();
    if (G && !G.over) draw();
    raf = requestAnimationFrame(loop);
  }

  function startGame() {
    newGame();
    overlay.classList.add('hide');
    cancelAnimationFrame(raf);
    loop();
  }

  function stopGame() {
    cancelAnimationFrame(raf);
    if (G) G.over = true;
  }

  function endGame() {
    G.over = true;
    cancelAnimationFrame(raf);
    draw();
    var best = bestScore();
    goTitle.textContent = G.score.toLocaleString('en-AU');
    goBody.textContent = (G.score > best ? 'New best. Get in ya beauty. ' : '') +
      G.hauled + ' truck' + (G.hauled === 1 ? '' : 's') + ' away \u00b7 ' +
      'best run of ' + G.bestCombo + ' \u00b7 shift ' + G.lvl;
    goBtn.textContent = 'Go again';
    overlay.classList.remove('hide');
    if (G.score > 0) recordScore(G.score);
  }

  goBtn.addEventListener('click', startGame);

  // leaving the Crib tab stops the loop so it isn't burning battery
  document.querySelectorAll('.subtabs button').forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.dataset.sub !== 'play') stopGame();
    });
  });
  document.querySelectorAll('nav button').forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.dataset.tab !== 'crib') stopGame();
    });
  });

  /* =========================================================================
     13. SCORES
     Kept under our own key so we never fight the main script's snapshot.
     ====================================================================== */

  var SKEY = 'se.crib.scores';

  function readScores() {
    try { return JSON.parse(localStorage.getItem(SKEY) || '[]'); }
    catch (e) { return []; }
  }

  function bestScore() {
    var s = readScores();
    return s.length ? s[0].n : 0;
  }

  function recordScore(n) {
    var s = readScores();
    s.push({ n: Math.round(n), t: Date.now() });
    s.sort(function (a, b) { return b.n - a.n; });
    s = s.slice(0, 25);
    try { localStorage.setItem(SKEY, JSON.stringify(s)); } catch (e) {}
    renderBest();
  }

  function renderBest() {
    var s = readScores();
    var el = $('bestScore'), note = $('bestNote');
    if (el) el.textContent = s.length ? s[0].n.toLocaleString('en-AU') : '\u2014';
    if (note) note.textContent = s.length
      ? s.length + ' game' + (s.length > 1 ? 's' : '') + ' played'
      : 'Have a go and it lands here.';
  }

  renderBest();
})();
