// Shadow Protocol — a 2D top-down stealth game generator.
// Runs on Node.js 22 with only the standard library. No network, no
// dependencies, no wall-clock or unseeded randomness: the output is
// byte-identical on every run. Writes a self-contained index.html
// (all CSS + JS inline) into $MAKEFUN_OUTPUT_DIR.
import * as fs from "node:fs";
import * as path from "node:path";

const outDir = process.env.MAKEFUN_OUTPUT_DIR || "out";
fs.mkdirSync(outDir, { recursive: true });

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Shadow Protocol — Stealth Game</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; background: #05070d; }
  body {
    font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
    color: #cfd8e3; display: flex; flex-direction: column;
    align-items: center; justify-content: center; overflow: hidden;
    background: radial-gradient(1200px 700px at 50% -10%, #0d1526 0%, #05070d 60%);
  }
  #wrap { position: relative; width: 960px; max-width: 98vw; }
  canvas {
    display: block; width: 100%; height: auto; border-radius: 10px;
    background: #0a0e18; box-shadow: 0 0 0 1px #1c2a44, 0 18px 60px rgba(0,0,0,.7), 0 0 90px rgba(40,90,180,.12);
    cursor: crosshair;
  }
  #hud {
    display: flex; gap: 10px; align-items: center; margin-bottom: 10px;
    font-size: 13px; letter-spacing: .04em; flex-wrap: wrap;
  }
  .pill {
    background: #0e1626; border: 1px solid #22314f; border-radius: 999px;
    padding: 6px 12px; white-space: nowrap;
  }
  .pill b { color: #8fd3ff; font-weight: 600; }
  #alertPill b { color: #ffd166; }
  #alertPill.hot b { color: #ff5d5d; }
  #alertPill.calm b { color: #7ee2a8; }
  #barOuter { flex: 1 1 160px; min-width: 140px; height: 12px; background: #0e1626;
    border: 1px solid #22314f; border-radius: 999px; overflow: hidden; }
  #barInner { height: 100%; width: 0%; background: linear-gradient(90deg,#ffd166,#ff5d5d); transition: width .12s linear; }
  #help { margin-top: 10px; font-size: 12.5px; color: #7d8aa3; text-align: center; line-height: 1.7; }
  #help kbd {
    background: #16213a; border: 1px solid #2b3d63; border-bottom-width: 2px;
    border-radius: 5px; padding: 1px 7px; font-family: inherit; color: #cfe3ff; font-size: 12px;
  }
  #toast {
    position: absolute; left: 50%; top: 64px; transform: translateX(-50%);
    background: rgba(10,16,30,.92); border: 1px solid #2b3d63; color: #ffe9a8;
    padding: 8px 16px; border-radius: 999px; font-size: 13.5px; letter-spacing: .03em;
    opacity: 0; transition: opacity .25s; pointer-events: none; white-space: nowrap;
  }
</style>
</head>
<body>
<div id="wrap">
  <div id="hud">
    <span class="pill">LEVEL <b id="hudLevel">1 / 3</b></span>
    <span class="pill">INTEL <b id="hudChips">0 / 0</b></span>
    <span class="pill" id="alertPill">STATUS <b id="hudAlert">UNDETECTED</b></span>
    <span class="pill">TIME <b id="hudTime">0:00</b></span>
    <div id="barOuter" title="Detection"><div id="barInner"></div></div>
    <span class="pill">NOISE <b id="hudNoise">SILENT</b></span>
  </div>
  <canvas id="game" width="960" height="600"></canvas>
  <div id="toast"></div>
  <div id="help">
    <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / <kbd>&larr;</kbd><kbd>&uarr;</kbd><kbd>&darr;</kbd><kbd>&rarr;</kbd> move &nbsp;·&nbsp;
    <kbd>Shift</kbd> sneak (slow, quiet, harder to spot) &nbsp;·&nbsp;
    <kbd>Space</kbd> sprint (fast, loud) &nbsp;·&nbsp;
    <kbd>R</kbd> restart level &nbsp;·&nbsp; <kbd>M</kbd> mute<br>
    Stay out of the yellow vision cones. Hide in the dark shadow zones. Grab all intel chips, then reach the green exit.
  </div>
</div>
<script>
"use strict";
/* ================= SHADOW PROTOCOL =================
   Top-down stealth. Pure canvas + WebAudio (synthesised).
   Deterministic level data; no external resources. */
var canvas = document.getElementById("game");
var ctx = canvas.getContext("2d");
var W = 960, H = 600, TILE = 40;

/* ---------- seeded RNG (deterministic) ---------- */
function mulberry32(seed) {
  var a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- audio (all synthesised, no files) ---------- */
var AC = null, muted = false, stepTimer = 0;
function audio() {
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { AC = null; } }
  if (AC && AC.state === "suspended") { AC.resume(); }
  return AC;
}
function beep(freq, dur, type, vol, slideTo) {
  if (muted) return;
  var ac = audio(); if (!ac) return;
  var o = ac.createOscillator(), g = ac.createGain();
  o.type = type || "sine"; o.frequency.setValueAtTime(freq, ac.currentTime);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, ac.currentTime + dur);
  g.gain.setValueAtTime(vol || 0.08, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
  o.connect(g); g.connect(ac.destination);
  o.start(); o.stop(ac.currentTime + dur);
}
function sfx(name) {
  if (name === "pickup") { beep(880, 0.12, "sine", 0.10); setTimeout(function(){ beep(1320, 0.16, "sine", 0.09); }, 70); }
  else if (name === "spotted") { beep(180, 0.35, "sawtooth", 0.12, 520); }
  else if (name === "caught") { beep(320, 0.5, "sawtooth", 0.14, 60); }
  else if (name === "exit") { beep(523, 0.14, "triangle", 0.10); setTimeout(function(){ beep(659, 0.14, "triangle", 0.10); }, 120); setTimeout(function(){ beep(784, 0.28, "triangle", 0.11); }, 240); }
  else if (name === "step") { beep(140 + Math.random() * 40, 0.05, "triangle", 0.03); }
  else if (name === "click") { beep(600, 0.06, "square", 0.05); }
}

/* ---------- levels ---------- */
/* Legend: # wall, . floor, S shadow floor, P player, C intel chip, E exit,
   1..9 guard spawn (patrol waypoints defined per level below, in tiles). */
var LEVELS = [
  {
    name: "LEVEL 1 — THE COURTYARD",
    brief: "Slip past two patrols. Grab 3 intel chips, then reach the exit.",
    map: [
      "#######################",
      "#P....#.......#.......#",
      "#.....#...C...#...S...#",
      "#..S..#.......#.......#",
      "#.....###.#####.###...#",
      "#..................C..#",
      "#.#####.#######.#####.#",
      "#.#.......#.......#...#",
      "#.#...S...#...C...#.E.#",
      "#.#.......#.......#...#",
      "#.#####...#...#####...#",
      "#.....#.......#.......#",
      "#..C..#...S...#...S...#",
      "#.....#.......#.......#",
      "#######################"
    ],
    guards: [
      { x: 5, y: 5, path: [[5,5],[17,5],[17,2],[5,2]], speed: 1.5 },
      { x: 12, y: 10, path: [[12,10],[12,13],[18,13],[18,10]], speed: 1.6 }
    ]
  },
  {
    name: "LEVEL 2 — THE VAULT WING",
    brief: "Four guards, tighter corridors. Shadows are your only friends.",
    map: [
      "#######################",
      "#P..#.....#.....#.....#",
      "#...#..C..#..S..#..C..#",
      "#.S.#.....#.....#.....#",
      "###.#######.#####.###.#",
      "#.......#.......#.....#",
      "#..C....#...S...#..S..#",
      "#.......#.......#.....#",
      "#.#####.###.#####.###.#",
      "#.#.......#.....#.....#",
      "#.#...S...#..C..#..S..#",
      "#.#.......#.....#.....#",
      "#.#######.#######.###.#",
      "#.....#.......#.....E.#",
      "#######################"
    ],
    guards: [
      { x: 3, y: 5, path: [[3,5],[9,5],[9,7],[3,7]], speed: 1.8 },
      { x: 14, y: 5, path: [[14,5],[14,7],[20,7],[20,5]], speed: 1.8 },
      { x: 6, y: 11, path: [[6,11],[11,11],[11,13],[6,13]], speed: 2.0 },
      { x: 16, y: 10, path: [[16,10],[20,10],[20,13],[16,13]], speed: 2.0 }
    ]
  },
  {
    name: "LEVEL 3 — THE CORE",
    brief: "Six guards on overlapping patrols. One mistake ends the run.",
    map: [
      "#######################",
      "#P....#....S....#.....#",
      "#..S..#.........#..C..#",
      "#.....#.#######.#.....#",
      "###.###.#.....#.#.###.#",
      "#.......#..C..#.#...#.#",
      "#..C....#.....#.#.S.#.#",
      "#.......#######.#...#.#",
      "#.#####.......#.#.#.#.#",
      "#.#...#..S....#.#.#.#.#",
      "#.#.S.#.......#.#.#.#.#",
      "#.#...#.#######.#.#.C.#",
      "#.#####.#.....#...#...#",
      "#.....#.#..C..#.S.#.E.#",
      "#######################"
    ],
    guards: [
      { x: 4, y: 5, path: [[4,5],[8,5],[8,1],[4,1]], speed: 2.1 },
      { x: 13, y: 5, path: [[13,5],[17,5],[17,8],[13,8]], speed: 2.1 },
      { x: 10, y: 9, path: [[10,9],[10,12],[16,12],[16,9]], speed: 2.2 },
      { x: 4, y: 11, path: [[4,11],[7,11],[7,13],[4,13]], speed: 2.2 },
      { x: 18, y: 11, path: [[18,11],[20,11],[20,13],[18,13]], speed: 2.3 },
      { x: 12, y: 2, path: [[12,2],[12,4],[15,4],[15,2]], speed: 2.3 }
    ]
  }
];

/* ---------- state ---------- */
var state = "title"; // title | playing | caught | levelclear | victory
var levelIndex = 0, level = null;
var player = null, guards = [], chips = [], exitTile = null;
var detection = 0, alertLevel = 0; // 0 calm, 1 suspicious, 2 alerted/chase
var timeSec = 0, totalTime = 0, caughtBy = null;
var keys = {}, particles = [], floaters = [], noiseEvents = [];
var toastTimer = null, flash = 0, shake = 0;
var rng = mulberry32(1337);

function tileAt(tx, ty) {
  if (ty < 0 || ty >= level.map.length || tx < 0 || tx >= level.map[0].length) return "#";
  return level.map[ty].charAt(tx);
}
function isWall(tx, ty) { return tileAt(tx, ty) === "#"; }
function isShadow(tx, ty) { return tileAt(tx, ty) === "S"; }
function px(tx) { return tx * TILE + TILE / 2; }

function loadLevel(idx) {
  levelIndex = idx; level = LEVELS[idx];
  rng = mulberry32(1337 + idx * 101);
  guards = []; chips = []; particles = []; floaters = []; noiseEvents = [];
  detection = 0; alertLevel = 0; timeSec = 0; flash = 0; shake = 0;
  for (var y = 0; y < level.map.length; y++) {
    for (var x = 0; x < level.map[y].length; x++) {
      var c = level.map[y].charAt(x);
      if (c === "P") player = { x: px(x), y: px(y), r: 12, dir: 0, moving: false, sneaking: false, sprinting: false };
      if (c === "C") chips.push({ x: px(x), y: px(y), taken: false, bob: rng() * 6.28 });
      if (c === "E") exitTile = { x: x, y: y };
    }
  }
  level.guards.forEach(function (g) {
    var path = g.path.map(function (p) { return { x: px(p[0]), y: px(p[1]) }; });
    guards.push({
      x: px(g.x), y: px(g.y), r: 12, path: path, wp: 1,
      dir: Math.atan2(path[1].y - path[0].y, path[1].x - path[0].x),
      speed: g.speed * TILE, state: "patrol", pause: 0,
      investigate: null, lastSeen: null, sweep: 0
    });
  });
  updateHUD();
  showToast(level.name);
}

function startGame() { loadLevel(0); state = "playing"; }
function restartLevel() { loadLevel(levelIndex); state = "playing"; }

/* ---------- line of sight ---------- */
function losClear(x0, y0, x1, y1) {
  var dx = x1 - x0, dy = y1 - y0;
  var dist = Math.sqrt(dx * dx + dy * dy);
  var steps = Math.ceil(dist / 8);
  for (var i = 1; i < steps; i++) {
    var t = i / steps;
    if (isWall(Math.floor((x0 + dx * t) / TILE), Math.floor((y0 + dy * t) / TILE))) return false;
  }
  return true;
}
function angleDiff(a, b) {
  var d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
function playerInShadow() {
  return isShadow(Math.floor(player.x / TILE), Math.floor(player.y / TILE));
}

/* ---------- update ---------- */
function update(dt) {
  if (state !== "playing") return;
  timeSec += dt;

  // --- player movement ---
  var mx = 0, my = 0;
  if (keys["arrowleft"] || keys["a"]) mx -= 1;
  if (keys["arrowright"] || keys["d"]) mx += 1;
  if (keys["arrowup"] || keys["w"]) my -= 1;
  if (keys["arrowdown"] || keys["s"]) my += 1;
  var sneaking = !!keys["shift"];
  var sprinting = !!(keys[" "] || keys["space"]) && !sneaking && (mx || my);
  var speed = sneaking ? 95 : (sprinting ? 235 : 150);
  player.sneaking = sneaking; player.sprinting = sprinting;
  player.moving = !!(mx || my);
  if (mx || my) {
    var len = Math.sqrt(mx * mx + my * my);
    mx /= len; my /= len;
    player.dir = Math.atan2(my, mx);
    moveEntity(player, mx * speed * dt, my * speed * dt);
    stepTimer -= dt * (sprinting ? 2.2 : sneaking ? 0.6 : 1.4);
    if (stepTimer <= 0) {
      stepTimer = 0.34;
      if (!sneaking) sfx("step");
      if (sprinting) emitNoise(player.x, player.y, 230);
      else if (!sneaking) emitNoise(player.x, player.y, 70);
    }
  }

  // --- chips ---
  var allTaken = true;
  chips.forEach(function (c) {
    c.bob += dt * 3;
    if (!c.taken) {
      allTaken = false;
      var d = Math.hypot(player.x - c.x, player.y - c.y);
      if (d < 26) {
        c.taken = true; sfx("pickup");
        burst(c.x, c.y, "#7ee2a8", 16);
        addFloater(c.x, c.y - 14, "+ INTEL", "#7ee2a8");
        showToast("Intel secured (" + chips.filter(function (k) { return k.taken; }).length + " / " + chips.length + ")");
      }
    }
  });
  var chipsLeft = chips.filter(function (k) { return !k.taken; }).length;

  // --- exit ---
  if (chipsLeft === 0 && exitTile) {
    var ex = px(exitTile.x), ey = px(exitTile.y);
    if (Math.hypot(player.x - ex, player.y - ey) < 30) {
      sfx("exit");
      totalTime += timeSec;
      if (levelIndex >= LEVELS.length - 1) { state = "victory"; }
      else { state = "levelclear"; }
      updateHUD();
      return;
    }
  }

  // --- guards ---
  var maxSee = 0, anyChase = false;
  guards.forEach(function (g) {
    updateGuard(g, dt);
    var d = Math.hypot(player.x - g.x, player.y - g.y);
    if (g.state === "chase") anyChase = true;
    // vision
    var see = 0;
    var VIEW = 190, FOV = 1.25;
    if (d < VIEW) {
      var ang = Math.atan2(player.y - g.y, player.x - g.x);
      if (Math.abs(angleDiff(ang, g.dir)) < FOV / 2 && losClear(g.x, g.y, player.x, player.y)) {
        var prox = 1 - d / VIEW;               // closer = faster detection
        var rate = 0.55 + prox * 1.5;          // per second
        if (playerInShadow()) rate *= 0.35;    // shadows hide you
        if (player.sneaking) rate *= 0.55;
        if (player.sprinting) rate *= 1.6;
        see = rate;
      }
    }
    if (see > maxSee) maxSee = see;
    if (d < 26 && g.state === "chase") { caught(g); return; }
    if (d < 34 && g.state !== "chase" && losClear(g.x, g.y, player.x, player.y)) {
      // bumped into a guard at point blank
      detection = 1; g.state = "chase"; g.lastSeen = { x: player.x, y: player.y };
    }
  });

  // noise investigation
  noiseEvents.forEach(function (n) {
    guards.forEach(function (g) {
      if (g.state === "chase") return;
      var d = Math.hypot(n.x - g.x, n.y - g.y);
      if (d < n.r) {
        g.state = "investigate";
        g.investigate = { x: n.x, y: n.y };
        addFloater(g.x, g.y - 22, "?", "#ffd166");
      }
    });
  });
  noiseEvents = [];

  // detection meter
  if (maxSee > 0) detection += maxSee * dt;
  else detection -= dt * 0.35;
  detection = Math.max(0, Math.min(1, detection));
  if (detection >= 1) {
    guards.forEach(function (g) {
      if (g.state !== "chase") { g.state = "chase"; g.lastSeen = { x: player.x, y: player.y }; }
    });
    if (alertLevel < 2) { sfx("spotted"); showToast("SPOTTED! Run for the shadows!"); flash = 0.5; shake = 8; }
    alertLevel = 2;
  } else if (detection > 0.45) {
    if (alertLevel < 1) showToast("Something sees you…");
    alertLevel = 1;
  } else if (detection <= 0.05 && alertLevel === 1 && !anyChase) {
    alertLevel = 0;
  }
  if (anyChase) alertLevel = 2;
  if (alertLevel === 2 && !anyChase && detection < 0.5) alertLevel = 1;

  // particles / floaters
  particles.forEach(function (p) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; });
  particles = particles.filter(function (p) { return p.life > 0; });
  floaters.forEach(function (f) { f.y -= 26 * dt; f.life -= dt; });
  floaters = floaters.filter(function (f) { return f.life > 0; });
  if (flash > 0) flash -= dt;
  if (shake > 0) shake = Math.max(0, shake - dt * 30);
  updateHUD();
}

function moveEntity(e, dx, dy) {
  var nx = e.x + dx;
  if (!circleHitsWall(nx, e.y, e.r)) e.x = nx;
  var ny = e.y + dy;
  if (!circleHitsWall(e.x, ny, e.r)) e.y = ny;
}
function circleHitsWall(x, y, r) {
  var pts = [[-r, 0], [r, 0], [0, -r], [0, r], [-r * 0.7, -r * 0.7], [r * 0.7, r * 0.7], [-r * 0.7, r * 0.7], [r * 0.7, -r * 0.7]];
  for (var i = 0; i < pts.length; i++) {
    if (isWall(Math.floor((x + pts[i][0]) / TILE), Math.floor((y + pts[i][1]) / TILE))) return true;
  }
  return false;
}

function updateGuard(g, dt) {
  var target = null, spd = g.speed;
  if (g.state === "chase") {
    target = g.lastSeen || { x: player.x, y: player.y };
    spd = g.speed * 1.35;
    var d = Math.hypot(player.x - g.x, player.y - g.y);
    if (d < 200 && losClear(g.x, g.y, player.x, player.y)) g.lastSeen = { x: player.x, y: player.y };
    else if (d > 320) { g.state = "investigate"; g.investigate = g.lastSeen; }
    if (g.lastSeen && Math.hypot(g.x - g.lastSeen.x, g.y - g.lastSeen.y) < 18) {
      g.state = "investigate"; g.investigate = g.lastSeen; g.lastSeen = null;
    }
  } else if (g.state === "investigate" && g.investigate) {
    target = g.investigate;
    spd = g.speed * 1.15;
    if (Math.hypot(g.x - target.x, g.y - target.y) < 16) {
      g.pause += dt;
      g.sweep += dt * 2.2;
      g.dir += Math.sin(g.sweep) * dt * 1.4;
      if (g.pause > 2.2) { g.pause = 0; g.state = "patrol"; g.investigate = null; }
      return;
    }
  } else {
    g.state = "patrol";
    target = g.path[g.wp];
    if (Math.hypot(g.x - target.x, g.y - target.y) < 12) {
      g.wp = (g.wp + 1) % g.path.length;
      target = g.path[g.wp];
      g.pause = 0.35;
    }
    if (g.pause > 0) { g.pause -= dt; return; }
  }
  if (!target) return;
  var dx = target.x - g.x, dy = target.y - g.y;
  var dist = Math.hypot(dx, dy);
  if (dist < 1) return;
  var want = Math.atan2(dy, dx);
  var diff = angleDiff(want, g.dir);
  g.dir += Math.max(-3.2 * dt, Math.min(3.2 * dt, diff));
  var step = Math.min(dist, spd * dt);
  var nx = g.x + Math.cos(g.dir) * step, ny = g.y + Math.sin(g.dir) * step;
  if (!circleHitsWall(nx, ny, g.r)) { g.x = nx; g.y = ny; }
  else { g.wp = (g.wp + 1) % g.path.length; }
}

function caught(g) {
  if (state !== "playing") return;
  state = "caught"; caughtBy = g; sfx("caught");
  flash = 0.8; shake = 14;
  burst(player.x, player.y, "#ff5d5d", 26);
  updateHUD();
}

function emitNoise(x, y, r) {
  noiseEvents.push({ x: x, y: y, r: r });
  particles.push({ x: x, y: y, vx: 0, vy: 0, life: 0.5, max: 0.5, size: r, ring: true, color: "255,209,102" });
}
function burst(x, y, color, n) {
  for (var i = 0; i < n; i++) {
    var a = rng() * Math.PI * 2, s = 40 + rng() * 120;
    particles.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + rng() * 0.4, max: 0.9, size: 2 + rng() * 3, color: color });
  }
}
function addFloater(x, y, text, color) {
  floaters.push({ x: x, y: y, text: text, color: color, life: 1.1 });
}

/* ---------- HUD ---------- */
var hudLevel = document.getElementById("hudLevel");
var hudChips = document.getElementById("hudChips");
var hudAlert = document.getElementById("hudAlert");
var hudTime = document.getElementById("hudTime");
var hudNoise = document.getElementById("hudNoise");
var barInner = document.getElementById("barInner");
var alertPill = document.getElementById("alertPill");
var toastEl = document.getElementById("toast");
function fmtTime(s) {
  var m = Math.floor(s / 60), ss = Math.floor(s % 60);
  return m + ":" + (ss < 10 ? "0" : "") + ss;
}
function updateHUD() {
  if (!level) return;
  hudLevel.textContent = (levelIndex + 1) + " / " + LEVELS.length;
  var got = chips.filter(function (c) { return c.taken; }).length;
  hudChips.textContent = got + " / " + chips.length;
  var label = alertLevel === 2 ? "ALERTED — RUN!" : alertLevel === 1 ? "SUSPICIOUS" : "UNDETECTED";
  hudAlert.textContent = label;
  alertPill.className = "pill " + (alertLevel === 2 ? "hot" : alertLevel === 1 ? "" : "calm");
  hudTime.textContent = fmtTime(totalTime + timeSec);
  hudNoise.textContent = player ? (player.sprinting ? "LOUD" : player.sneaking ? "SILENT" : "NORMAL") : "SILENT";
  barInner.style.width = Math.round(detection * 100) + "%";
}
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.style.opacity = "1";
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { toastEl.style.opacity = "0"; }, 2200);
}

/* ---------- rendering ---------- */
function drawVisionCone(g) {
  var VIEW = 190, FOV = 1.25, RAYS = 26;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(g.x, g.y);
  for (var i = 0; i <= RAYS; i++) {
    var a = g.dir - FOV / 2 + (FOV * i) / RAYS;
    var d = VIEW;
    for (var r = 8; r <= VIEW; r += 8) {
      var tx = g.x + Math.cos(a) * r, ty = g.y + Math.sin(a) * r;
      if (isWall(Math.floor(tx / TILE), Math.floor(ty / TILE))) { d = r; break; }
    }
    ctx.lineTo(g.x + Math.cos(a) * d, g.y + Math.sin(a) * d);
  }
  ctx.closePath();
  var col = g.state === "chase" ? "255,70,70" : g.state === "investigate" ? "255,209,102" : "255,214,90";
  var grad = ctx.createRadialGradient(g.x, g.y, 10, g.x, g.y, VIEW);
  grad.addColorStop(0, "rgba(" + col + ",0.30)");
  grad.addColorStop(1, "rgba(" + col + ",0.05)");
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

  if (!level) { ctx.restore(); return; }

  // floor + walls
  for (var y = 0; y < level.map.length; y++) {
    for (var x = 0; x < level.map[y].length; x++) {
      var c = level.map[y].charAt(x);
      var px0 = x * TILE, py0 = y * TILE;
      if (c === "#") {
        ctx.fillStyle = "#1a2438";
        ctx.fillRect(px0, py0, TILE, TILE);
        ctx.fillStyle = "#232f4a";
        ctx.fillRect(px0, py0, TILE, 4);
        ctx.fillStyle = "#121a2c";
        ctx.fillRect(px0, py0 + TILE - 3, TILE, 3);
        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        ctx.strokeRect(px0 + 0.5, py0 + 0.5, TILE - 1, TILE - 1);
      } else {
        ctx.fillStyle = (x + y) % 2 === 0 ? "#0d1322" : "#0c111e";
        ctx.fillRect(px0, py0, TILE, TILE);
        if (c === "S") {
          ctx.fillStyle = "rgba(40,70,140,0.20)";
          ctx.fillRect(px0, py0, TILE, TILE);
          ctx.fillStyle = "rgba(120,160,255,0.10)";
          ctx.fillRect(px0 + 6, py0 + 6, TILE - 12, TILE - 12);
        }
      }
    }
  }

  // exit pad
  if (exitTile) {
    var ex = px(exitTile.x), ey = px(exitTile.y);
    var open = chips.filter(function (k) { return !k.taken; }).length === 0;
    ctx.save();
    ctx.globalAlpha = open ? 0.95 : 0.4;
    ctx.fillStyle = open ? "#1d5c38" : "#26303f";
    ctx.beginPath(); ctx.arc(ex, ey, 20, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = open ? "#7ee2a8" : "#5a6b84";
    ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = open ? "#7ee2a8" : "#8fa1bb";
    ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(open ? "EXIT" : "LOCKED", ex, ey);
    ctx.restore();
  }

  // chips
  chips.forEach(function (c) {
    if (c.taken) return;
    var bobY = Math.sin(c.bob) * 3;
    ctx.save();
    ctx.shadowColor = "#7ee2a8"; ctx.shadowBlur = 14;
    ctx.fillStyle = "#7ee2a8";
    ctx.beginPath();
    ctx.moveTo(c.x, c.y + bobY - 9);
    ctx.lineTo(c.x + 7, c.y + bobY);
    ctx.lineTo(c.x, c.y + bobY + 9);
    ctx.lineTo(c.x - 7, c.y + bobY);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#0a0e18";
    ctx.font = "bold 9px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("i", c.x, c.y + bobY + 0.5);
  });

  // vision cones (under characters)
  guards.forEach(drawVisionCone);

  // guards
  guards.forEach(function (g) {
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.shadowColor = g.state === "chase" ? "#ff5d5d" : "#ffd166";
    ctx.shadowBlur = g.state === "patrol" ? 6 : 16;
    ctx.fillStyle = g.state === "chase" ? "#c0392b" : g.state === "investigate" ? "#b7791f" : "#8a6d1f";
    ctx.beginPath(); ctx.arc(0, 0, g.r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#0a0e18"; ctx.lineWidth = 2; ctx.stroke();
    // facing tick + eyes
    ctx.rotate(g.dir);
    ctx.fillStyle = "#ffe9a8";
    ctx.beginPath(); ctx.arc(5, -4, 2.2, 0, Math.PI * 2); ctx.arc(5, 4, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // state mark
    if (g.state === "chase") { ctx.fillStyle = "#ff5d5d"; ctx.font = "bold 16px sans-serif"; ctx.textAlign = "center"; ctx.fillText("!", g.x, g.y - 20); }
    else if (g.state === "investigate") { ctx.fillStyle = "#ffd166"; ctx.font = "bold 15px sans-serif"; ctx.textAlign = "center"; ctx.fillText("?", g.x, g.y - 20); }
  });

  // player
  if (player) {
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.shadowColor = player.sneaking ? "#7ee2a8" : "#8fd3ff";
    ctx.shadowBlur = 12;
    ctx.fillStyle = player.sneaking ? "#2e7d5b" : "#2b6cb0";
    ctx.beginPath(); ctx.arc(0, 0, player.r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#d6ecff"; ctx.lineWidth = 2; ctx.stroke();
    ctx.rotate(player.dir);
    ctx.fillStyle = "#d6ecff";
    ctx.beginPath(); ctx.moveTo(13, 0); ctx.lineTo(4, -5); ctx.lineTo(4, 5); ctx.closePath(); ctx.fill();
    ctx.restore();
    if (player.sneaking) {
      ctx.fillStyle = "rgba(126,226,168,0.9)";
      ctx.font = "11px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("SNEAKING", player.x, player.y - 20);
    }
  }

  // particles
  particles.forEach(function (p) {
    if (p.ring) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life / p.max) * 0.5;
      ctx.strokeStyle = "rgba(" + p.color + ",1)";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 - p.life / p.max) + 10, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    } else {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  });

  // floaters
  floaters.forEach(function (f) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, f.life);
    ctx.fillStyle = f.color;
    ctx.font = "bold 13px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(f.text, f.x, f.y);
    ctx.restore();
  });

  // darkness / lighting: dim everything except near the player
  ctx.save();
  var dark = ctx.createRadialGradient(player.x, player.y, 60, player.x, player.y, 320);
  dark.addColorStop(0, "rgba(3,5,10,0)");
  dark.addColorStop(0.55, "rgba(3,5,10,0.18)");
  dark.addColorStop(1, "rgba(3,5,10,0.62)");
  ctx.fillStyle = dark;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // red flash when spotted / caught
  if (flash > 0) {
    ctx.fillStyle = "rgba(255,40,40," + Math.min(0.35, flash * 0.4) + ")";
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();

  drawOverlay();
}

function drawOverlay() {
  ctx.save();
  ctx.textAlign = "center";
  if (state === "title") {
    ctx.fillStyle = "rgba(4,7,13,0.78)"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#8fd3ff"; ctx.font = "bold 58px sans-serif";
    ctx.shadowColor = "#2b6cb0"; ctx.shadowBlur = 30;
    ctx.fillText("SHADOW PROTOCOL", W / 2, 190);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#cfd8e3"; ctx.font = "20px sans-serif";
    ctx.fillText("A top-down stealth game — stay unseen, steal the intel, vanish.", W / 2, 235);
    ctx.fillStyle = "#7d8aa3"; ctx.font = "16px sans-serif";
    ctx.fillText("WASD / arrows to move  ·  Shift to sneak  ·  Space to sprint (loud!)", W / 2, 285);
    ctx.fillText("Avoid the vision cones. Hide in the shadows. Collect every intel chip,", W / 2, 312);
    ctx.fillText("then reach the green exit. 3 levels. One mistake can end the run.", W / 2, 339);
    ctx.fillStyle = "#ffd166"; ctx.font = "bold 22px sans-serif";
    ctx.fillText("Press ENTER or click to begin", W / 2, 410);
    ctx.fillStyle = "#5a6b84"; ctx.font = "14px sans-serif";
    ctx.fillText("M mute  ·  R restart level", W / 2, 450);
  } else if (state === "caught") {
    ctx.fillStyle = "rgba(20,4,6,0.72)"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#ff5d5d"; ctx.font = "bold 52px sans-serif";
    ctx.shadowColor = "#ff0000"; ctx.shadowBlur = 26;
    ctx.fillText("CAUGHT!", W / 2, 230);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#cfd8e3"; ctx.font = "19px sans-serif";
    ctx.fillText("A guard spotted you on Level " + (levelIndex + 1) + ". The run ends here.", W / 2, 280);
    ctx.fillStyle = "#ffd166"; ctx.font = "bold 21px sans-serif";
    ctx.fillText("Press R to retry the level  ·  ENTER for the title screen", W / 2, 340);
  } else if (state === "levelclear") {
    ctx.fillStyle = "rgba(4,14,8,0.72)"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#7ee2a8"; ctx.font = "bold 48px sans-serif";
    ctx.shadowColor = "#2e7d5b"; ctx.shadowBlur = 24;
    ctx.fillText("LEVEL CLEAR", W / 2, 220);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#cfd8e3"; ctx.font = "19px sans-serif";
    ctx.fillText(level.name + " — ghosted in " + fmtTime(timeSec) + ".", W / 2, 272);
    ctx.fillStyle = "#ffd166"; ctx.font = "bold 21px sans-serif";
    ctx.fillText("Press ENTER to infiltrate Level " + (levelIndex + 2), W / 2, 330);
  } else if (state === "victory") {
    ctx.fillStyle = "rgba(4,14,8,0.78)"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#7ee2a8"; ctx.font = "bold 54px sans-serif";
    ctx.shadowColor = "#2e7d5b"; ctx.shadowBlur = 28;
    ctx.fillText("GHOST — ALL LEVELS CLEAR", W / 2, 210);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#cfd8e3"; ctx.font = "20px sans-serif";
    ctx.fillText("Every intel chip stolen. No alarms that mattered.", W / 2, 262);
    ctx.fillText("Total time: " + fmtTime(totalTime) + "  ·  You were never really there.", W / 2, 296);
    ctx.fillStyle = "#ffd166"; ctx.font = "bold 21px sans-serif";
    ctx.fillText("Press ENTER to play again", W / 2, 360);
  }
  ctx.restore();
}

/* ---------- input ---------- */
function keyName(e) {
  var k = (e.key || "").toLowerCase();
  if (k === " ") return "space";
  return k;
}
window.addEventListener("keydown", function (e) {
  var k = keyName(e);
  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].indexOf(k) >= 0) e.preventDefault();
  audio();
  if (k === "m") { muted = !muted; showToast(muted ? "Sound muted" : "Sound on"); return; }
  if (k === "r" && (state === "playing" || state === "caught")) { sfx("click"); restartLevel(); return; }
  if (k === "enter") {
    sfx("click");
    if (state === "title") startGame();
    else if (state === "levelclear") { loadLevel(levelIndex + 1); state = "playing"; }
    else if (state === "victory") { totalTime = 0; startGame(); }
    else if (state === "caught") { state = "title"; loadLevel(0); }
    return;
  }
  keys[k] = true;
});
window.addEventListener("keyup", function (e) { keys[keyName(e)] = false; });
canvas.addEventListener("mousedown", function () {
  audio();
  if (state === "title") { sfx("click"); startGame(); }
  else if (state === "levelclear") { loadLevel(levelIndex + 1); state = "playing"; }
  else if (state === "victory") { totalTime = 0; startGame(); }
});

/* ---------- main loop ---------- */
loadLevel(0);
state = "title";
var last = performance.now();
function frame(now) {
  var dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(outDir, "index.html"), html, "utf8");
console.log("wrote " + path.join(outDir, "index.html") + " (" + html.length + " bytes)");
