/* Ready Steady Bang - a browser replica.
   Tap / click / SPACE = draw. Everything is timed off performance.now(). */
'use strict';

/* ------------------------------------------------------------------ config */

let W = 900, H = 506;             // logical canvas size = viewport CSS pixels
let GROUND = H * 0.80;            // horizon line
let S = 1;                        // gunslinger scale for the current viewport
const TAU = Math.PI * 2;

// palettes: [skyTop, skyBottom, sun, hills, ground]
const PALETTES = [
  ['#f7b24a', '#e8562f', '#fff0b8', '#7a2d1f', '#3a170f'], // dusk
  ['#8fd3e8', '#f2e2a8', '#fffbe0', '#4a6b5c', '#26301f'], // noon
  ['#2b2b5e', '#7d3f6b', '#ffe9a8', '#1d1a35', '#0f0d1c'], // night
  ['#ffd9a0', '#c2452f', '#fff3c4', '#5d2419', '#2a1109'], // blood dusk
];

/* type:
   duel      - classic: draw on BANG
   feint     - decoy words appear before the real BANG
   aim       - after BANG a side lights up, shoot that side
   dodge     - dodge the first shot, then draw
   double    - two bandits, two taps
*/
const LEVELS = [
  { n:'The Rookie',   type:'duel',   opp: 620, pal:0, wait:[900,2000] },
  { n:'Dusty Pete',   type:'duel',   opp: 540, pal:0, wait:[900,2400] },
  { n:'The Trickster',type:'feint',  opp: 520, pal:1, wait:[1400,3000], decoys:1 },
  { n:'Quickdraw Sal',type:'duel',   opp: 460, pal:1, wait:[800,2600] },
  { n:'Two Guns Ray', type:'aim',    opp: 520, pal:3, wait:[900,2400] },
  { n:'The Sheriff',  type:'duel',   opp: 410, pal:3, wait:[900,2800] },
  { n:'Liar Lopez',   type:'feint',  opp: 430, pal:1, wait:[1600,3400], decoys:2 },
  { n:'Cheap Shot',   type:'dodge',  opp: 470, pal:2, wait:[800,2200] },
  { n:'Silver Kid',   type:'duel',   opp: 370, pal:2, wait:[900,3000] },
  { n:'The Brothers', type:'double', opp: 760, pal:0, wait:[900,2600] },
  { n:'Crosseye Jim', type:'aim',    opp: 400, pal:2, wait:[900,2600] },
  { n:'Mad Molly',    type:'feint',  opp: 360, pal:3, wait:[1600,3600], decoys:3 },
  { n:'Backshooter',  type:'dodge',  opp: 390, pal:3, wait:[800,2400] },
  { n:'The Gang',     type:'double', opp: 600, pal:2, wait:[900,2800] },
  { n:'El Diablo',    type:'duel',   opp: 300, pal:3, wait:[1000,3600] },
];

const STARS = [230, 320, 460];    // ms thresholds for 3 / 2 / 1 stars
const VS_WIN = 3;                 // rounds needed to take a local match
const PN = ['P1', 'P2'];

/* ------------------------------------------------------------------- utils */

const $  = (id) => document.getElementById(id);
const now = () => performance.now();
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

let timers = [];
function after(ms, fn) { timers.push(setTimeout(fn, ms)); }
function clearTimers() { timers.forEach(clearTimeout); timers = []; }

/* ------------------------------------------------------------------- save */

const KEY = 'rsb.save.v1';
let save = { best: {}, cleared: [], mute: false };
try { Object.assign(save, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
function persist() { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) {} }
const unlocked = (i) => i === 0 || save.cleared.includes(i - 1);

/* ------------------------------------------------------------------ audio */

let ac = null;
function actx() {
  if (!ac) { const C = window.AudioContext || window.webkitAudioContext; if (C) ac = new C(); }
  if (ac && ac.state === 'suspended') ac.resume();
  return ac;
}
function tone(freq, dur, type, vol, slideTo) {
  if (save.mute) return;
  const c = actx(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain(), t = c.currentTime;
  o.type = type || 'square';
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol || 0.12, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol) {
  if (save.mute) return;
  const c = actx(); if (!c) return;
  const n = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.2);
  const s = c.createBufferSource(), g = c.createGain();
  s.buffer = buf; g.gain.value = vol || 0.3;
  s.connect(g).connect(c.destination); s.start();
}
const sfx = {
  tick:  () => tone(660, 0.05, 'square', 0.06),
  cue:   () => tone(990, 0.09, 'square', 0.09),
  shot:  () => { noise(0.22, 0.45); tone(120, 0.16, 'sawtooth', 0.16, 40); },
  win:   () => { tone(523, 0.1, 'square', 0.1); after(90, () => tone(784, 0.16, 'square', 0.1)); },
  lose:  () => tone(200, 0.5, 'sawtooth', 0.12, 70),
  early: () => tone(140, 0.35, 'square', 0.12, 90),
};

/* ------------------------------------------------------------------ canvas */

const cv = $('cv'), ctx = cv.getContext('2d');
/* The scene fills the viewport at any aspect ratio: logical units are CSS
   pixels, and everything is placed relative to W / H / S instead of a fixed
   canvas, so nothing gets letterboxed or cropped on a phone. */
function fit() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = Math.max(320, window.innerWidth);
  H = Math.max(320, window.innerHeight);
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  S = clamp(Math.min(W / 700, H / 560), 0.62, 1.5);
  GROUND = H * (H > W ? 0.74 : 0.80);
}
window.addEventListener('resize', fit);
window.addEventListener('orientationchange', fit);

/* ------------------------------------------------------------------- scene */

const scene = {
  pal: 0, t: 0, shake: 0, flash: 0,
  hero: { px: 0.23, dir: 1, arm: 0, fall: 0, lean: 0, flash: 0, accent: '#3f6fa8' },
  foes: [],
};

function resetScene(level, foeCount) {
  scene.pal = level.pal; scene.shake = 0; scene.flash = 0;
  Object.assign(scene.hero, { arm: 0, fall: 0, lean: 0, flash: 0 });
  scene.foes = [];
  for (let i = 0; i < foeCount; i++) {
    scene.foes.push({
      px: foeCount === 1 ? 0.77 : 0.66 + i * 0.15, dir: -1,
      arm: 0, fall: 0, lean: 0, flash: 0, accent: i ? '#7c4a86' : '#b3402c',
    });
  }
}

function shoot(who) { who.arm = 1; who.flash = 1; scene.shake = 1; sfx.shot(); }
function drop(who)  { if (!who.fall) { who.fall = 0.0001; who.hit = now(); } }

/* --------------------------------------------------------------- rendering */

function mesa(x, y, w, h, col) {
  ctx.fillStyle = col; ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w * 0.18, y - h * 0.82);
  ctx.lineTo(x + w * 0.34, y - h);
  ctx.lineTo(x + w * 0.70, y - h * 0.94);
  ctx.lineTo(x + w * 0.86, y - h * 0.6);
  ctx.lineTo(x + w, y);
  ctx.closePath(); ctx.fill();
}

/* one continuous foreground ridge, so the sun is occluded without leaving
   V-shaped gaps between separate mesas */
function ridge(col, h) {
  ctx.fillStyle = col; ctx.beginPath();
  ctx.moveTo(0, GROUND); ctx.lineTo(0, GROUND - h * 0.45);
  ctx.lineTo(W * 0.13, GROUND - h * 0.95); ctx.lineTo(W * 0.27, GROUND - h * 0.58);
  ctx.lineTo(W * 0.43, GROUND - h * 0.82); ctx.lineTo(W * 0.57, GROUND - h * 0.52);
  ctx.lineTo(W * 0.73, GROUND - h * 0.90); ctx.lineTo(W * 0.88, GROUND - h * 0.50);
  ctx.lineTo(W, GROUND - h * 0.66); ctx.lineTo(W, GROUND);
  ctx.closePath(); ctx.fill();
}

function cactus(x, y, s, col) {
  s *= S;
  ctx.fillStyle = col; ctx.lineWidth = 7 * s; ctx.strokeStyle = col;
  ctx.lineCap = 'round'; ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x, y - 46 * s);
  ctx.moveTo(x, y - 24 * s); ctx.lineTo(x - 13 * s, y - 24 * s); ctx.lineTo(x - 13 * s, y - 36 * s);
  ctx.moveTo(x, y - 32 * s); ctx.lineTo(x + 12 * s, y - 32 * s); ctx.lineTo(x + 12 * s, y - 44 * s);
  ctx.stroke();
}

function drawBackground() {
  const p = PALETTES[scene.pal];
  const hill = 150 * S, near = 104 * S;
  const sky = ctx.createLinearGradient(0, 0, 0, GROUND);
  sky.addColorStop(0, p[0]); sky.addColorStop(1, p[1]);
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, GROUND);

  // sun + halo
  const sx = W / 2, sy = GROUND - 92 * S, sr = 66 * S;
  const halo = ctx.createRadialGradient(sx, sy, sr * 0.15, sx, sy, sr * 3.6);
  halo.addColorStop(0, 'rgba(255,240,190,.55)'); halo.addColorStop(1, 'rgba(255,240,190,0)');
  ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(sx, sy, sr * 3.6, 0, TAU); ctx.fill();
  ctx.fillStyle = p[2]; ctx.beginPath(); ctx.arc(sx, sy, sr, 0, TAU); ctx.fill();

  // mesas: two far ridges, two nearer ones
  ctx.globalAlpha = .55;
  mesa(-W * 0.05, GROUND, W * 0.46, hill, p[3]);
  mesa(W * 0.60, GROUND, W * 0.50, hill * 1.16, p[3]);
  ctx.globalAlpha = 1;
  ridge(p[4], near);

  // ground
  ctx.fillStyle = p[4]; ctx.fillRect(0, GROUND, W, H - GROUND);
  ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fillRect(0, GROUND, W, 4);
  ctx.fillStyle = 'rgba(0,0,0,.18)';
  for (let i = 0; i < 7; i++) {
    const y = GROUND + (14 + i * 15) * S;
    if (y > H) break;
    ctx.fillRect((i * 137) % W, y, (60 + i * 22) * S, 3 * S);
  }
  cactus(W * 0.08, GROUND + 6 * S, 1.1, p[4]);
  cactus(W * 0.93, GROUND + 10 * S, 1.3, p[4]);
}

/* one gunslinger, silhouette style */
function drawGuy(g, tick) {
  const x = clamp(g.px * W, 150 * S, W - 150 * S);
  const bob = g.fall ? 0 : Math.sin(tick / 520 + g.px * 9) * 1.4;
  ctx.save();
  ctx.translate(x, GROUND + 6 * S);
  ctx.scale(g.dir * S, S);
  if (g.fall) ctx.rotate(-Math.min(g.fall, 1) * 1.42);
  ctx.rotate(g.lean * -0.30);
  ctx.translate(0, bob);

  const ink = '#150f0c';
  const arm = g.arm;                       // 0 holstered .. 1 aimed
  const ang = (1 - arm) * 1.15;            // radians below horizontal
  const shX = 9, shY = -96;
  const hx = shX + Math.cos(ang) * 30, hy = shY + Math.sin(ang) * 30;

  ctx.lineCap = 'round';

  // shadow
  ctx.save(); ctx.rotate(g.lean * 0.30);
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  ctx.beginPath(); ctx.ellipse(0, 2, 30, 7, 0, 0, TAU); ctx.fill();
  ctx.restore();

  // back leg / front leg
  ctx.fillStyle = ink;
  ctx.beginPath(); ctx.moveTo(-4, -60); ctx.lineTo(-16, -56); ctx.lineTo(-22, 0); ctx.lineTo(-6, 0); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(4, -60); ctx.lineTo(16, -56); ctx.lineTo(19, 0); ctx.lineTo(3, 0); ctx.closePath(); ctx.fill();
  // boots
  ctx.fillRect(-25, -6, 22, 6); ctx.fillRect(2, -6, 21, 6);

  // coat / torso
  ctx.beginPath();
  ctx.moveTo(-15, -104); ctx.lineTo(15, -104); ctx.lineTo(20, -66);
  ctx.lineTo(14, -40); ctx.lineTo(-14, -40); ctx.lineTo(-20, -66);
  ctx.closePath(); ctx.fill();
  // gun belt
  ctx.fillStyle = g.accent; ctx.fillRect(-19, -66, 38, 7);
  ctx.fillStyle = ink; ctx.fillRect(14, -66, 9, 16);   // holster

  // back arm
  ctx.strokeStyle = ink; ctx.lineWidth = 9;
  ctx.beginPath(); ctx.moveTo(-8, -98); ctx.lineTo(-15, -70); ctx.stroke();

  // head, bandana, hat
  ctx.fillStyle = ink;
  ctx.beginPath(); ctx.arc(2, -118, 12, 0, TAU); ctx.fill();
  ctx.fillStyle = g.accent;
  ctx.beginPath(); ctx.moveTo(-8, -108); ctx.lineTo(10, -108); ctx.lineTo(1, -98); ctx.closePath(); ctx.fill();
  ctx.fillStyle = ink;
  ctx.beginPath(); ctx.ellipse(1, -128, 27, 5.5, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-11, -128); ctx.lineTo(-8, -144); ctx.lineTo(11, -144); ctx.lineTo(13, -128); ctx.closePath(); ctx.fill();

  // gun arm
  ctx.strokeStyle = ink; ctx.lineWidth = 10;
  ctx.beginPath(); ctx.moveTo(shX, shY); ctx.lineTo(hx, hy); ctx.stroke();

  // revolver in hand
  if (arm > 0.25) {
    ctx.save(); ctx.translate(hx, hy); ctx.rotate(ang * 0.5);
    ctx.fillStyle = ink; ctx.fillRect(0, -4, 20, 5); ctx.fillRect(-1, -3, 6, 9);
    if (g.flash > 0) {
      ctx.globalAlpha = g.flash;
      ctx.fillStyle = '#fff3b0';
      ctx.beginPath(); ctx.moveTo(19, -2); ctx.lineTo(19 + 26 * g.flash, -11 * g.flash);
      ctx.lineTo(19 + 34 * g.flash, 0); ctx.lineTo(19 + 26 * g.flash, 11 * g.flash);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  // rim light on the sun-facing edge
  ctx.strokeStyle = 'rgba(255,225,170,.30)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-15, -104); ctx.lineTo(-20, -66); ctx.lineTo(-14, -40); ctx.stroke();

  // hat blown off when hit
  if (g.fall > 0.05) {
    const f = Math.min(g.fall, 1.6);
    ctx.save(); ctx.translate(6 + f * 26, -150 - Math.sin(Math.min(f, 1) * Math.PI) * 40); ctx.rotate(f * 2.4);
    ctx.fillStyle = ink;
    ctx.beginPath(); ctx.ellipse(0, 0, 24, 5, 0, 0, TAU); ctx.fill();
    ctx.fillRect(-10, -14, 21, 14);
    ctx.restore();
  }
  ctx.restore();
}

function draw(tick, dt) {
  // decay
  scene.hero.flash = Math.max(0, scene.hero.flash - dt / 90);
  scene.foes.forEach(f => { f.flash = Math.max(0, f.flash - dt / 90); if (f.fall) f.fall += dt / 260; });
  if (scene.hero.fall) scene.hero.fall += dt / 260;
  scene.shake = Math.max(0, scene.shake - dt / 260);
  scene.flash = Math.max(0, scene.flash - dt / 160);

  ctx.save();
  if (scene.shake > 0) {
    const s = scene.shake * 7;
    ctx.translate(rnd(-s, s), rnd(-s, s));
  }
  drawBackground();
  scene.foes.forEach(f => drawGuy(f, tick));
  drawGuy(scene.hero, tick);
  ctx.restore();

  if (scene.flash > 0) {
    ctx.fillStyle = 'rgba(255,246,214,' + (scene.flash * 0.5).toFixed(3) + ')';
    ctx.fillRect(0, 0, W, H);
  }
  // vignette
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.45)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
}

let last = 0;
function loop(t) {
  const dt = Math.min(50, t - last || 16); last = t;
  scene.t = t;
  draw(t, dt);
  requestAnimationFrame(loop);
}

/* ------------------------------------------------------------------- screens */

function show(name) {
  ['menu', 'levels', 'result'].forEach(id => $(id).classList.toggle('on', id === name));
  $('hud').classList.toggle('on', name === 'play');
  state.screen = name;
}
const cueEl = $('cue'), hintEl = $('hint'), dirsEl = $('dirs');
function cue(txt, small) {
  cueEl.textContent = txt;
  cueEl.className = small ? 'small' : '';
  cueEl.style.color = txt === 'BANG!' ? '#f2b338' : '#f6e7c8';
  if (txt) { cueEl.classList.remove('flash'); void cueEl.offsetWidth; cueEl.classList.add('flash'); }
}
const hint = (t) => hintEl.textContent = t || '';

function fmt(ms) { return (ms / 1000).toFixed(3) + 's'; }
function stars(ms) { return ms <= STARS[0] ? 3 : ms <= STARS[1] ? 2 : 1; }

function buildGrid() {
  const g = $('grid'); g.innerHTML = '';
  LEVELS.forEach((L, i) => {
    const open = unlocked(i), done = save.cleared.includes(i), best = save.best[i];
    const c = document.createElement('div');
    c.className = 'cell' + (done ? ' done' : '') + (open ? '' : ' locked');
    c.innerHTML = '<div>' + (open ? (i + 1) : '&#128274;') + '</div>' +
      '<div class="nm">' + (open ? L.n : '???') + '</div>' +
      '<div class="st">' + (best ? '&#9733;'.repeat(stars(best)) : '') + '</div>' +
      '<div class="ms">' + (best ? fmt(best) : '') + '</div>';
    if (open) c.onclick = () => startLevel(i);
    g.appendChild(c);
  });
  const all = Object.values(save.best);
  $('pb').textContent = all.length ? fmt(Math.min.apply(null, all)) : '—';
}

/* ---------------------------------------------------------------- game flow */

const state = { screen: 'menu', mode: 'solo', i: 0, phase: 'idle', bangAt: 0, hits: 0,
                side: null, react: 0, score: [0, 0], round: 0 };
let L = LEVELS[0];

function startLevel(i) {
  clearTimers();
  state.mode = 'solo'; $('pads').classList.remove('on');
  $('quit').innerHTML = '&#8592; LEVELS';
  state.i = i; L = LEVELS[i];
  state.phase = 'lead'; state.hits = 0; state.side = null; state.react = 0;
  resetScene(L, L.type === 'double' ? 2 : 1);
  $('lvlname').textContent = 'LVL ' + (i + 1) + ' · ' + L.n.toUpperCase();
  dirsEl.style.opacity = 0; $('dL').className = 'd'; $('dR').className = 'd';
  cue(''); hint(L.type === 'dodge' ? 'HE PLAYS DIRTY — DODGE, THEN DRAW' :
              L.type === 'aim' ? 'TAP THE SIDE THAT LIGHTS UP  (or \u2190 \u2192)' :
              L.type === 'double' ? 'TWO BANDITS — TWO SHOTS' :
              L.type === 'feint' ? 'ONLY "BANG!" COUNTS' : 'DRAW ON BANG!');
  show('play');
  actx();

  after(450, () => { state.phase = 'ready'; cue('READY'); sfx.tick(); });
  after(1250, () => {
    state.phase = 'steady'; cue('STEADY'); sfx.tick(); hint('');
    const wait = rnd(L.wait[0], L.wait[1]);
    if (L.type === 'dodge') {
      const d1 = rnd(700, 1700);
      after(d1, () => {
        state.phase = 'dodge'; cue('DODGE!', true); sfx.cue();
        shoot(scene.foes[0]); scene.flash = .5;
        after(430, () => {
          if (state.phase !== 'dodge') return;
          drop(scene.hero); finish(false, 'You ate lead. Should have ducked.');
        });
      });
    } else {
      state.phase = 'armed';
      if (L.type === 'feint') {
        const words = ['BANK!', 'BANG?', 'BANANA!', 'BENG!', 'BAND!', 'BLANK!'];
        const n = L.decoys || 1;
        for (let k = 0; k < n; k++) {
          const t = 400 + (wait - 900) * ((k + 0.5 + Math.random() * .4) / n);
          after(t, () => {
            if (state.phase !== 'armed') return;
            cue(words[Math.floor(Math.random() * words.length)], true); sfx.tick();
            after(320, () => { if (state.phase === 'armed') cue(''); });
          });
        }
      }
      after(wait, bang);
    }
  });
}

function bang() {
  if (state.phase !== 'armed' && state.phase !== 'armed2') return;
  state.phase = 'bang'; state.bangAt = now();
  cue('BANG!'); sfx.cue(); scene.flash = .35;

  if (L.type === 'aim') {
    state.side = Math.random() < .5 ? 'L' : 'R';
    dirsEl.style.opacity = 1;
    $(state.side === 'L' ? 'dL' : 'dR').className = 'd hot';
  }
  if (state.mode === 'vs') { after(4000, vsStalemate); return; }

  after(L.opp, () => {
    if (state.phase !== 'bang') return;
    shoot(scene.foes.find(f => !f.fall) || scene.foes[0]);
    drop(scene.hero);
    state.react = now() - state.bangAt;
    finish(false, 'He drew in ' + fmt(L.opp) + '. You were still reaching' +
      (state.hits ? ' for the second one.' : '.'));
  });
}

function falseStart() {
  if (state.phase === 'over') return;
  state.phase = 'over'; clearTimers();
  cue('TOO SOON!'); sfx.early();
  scene.hero.arm = 1; scene.shake = .6;
  finish(false, 'Itchy trigger finger. Wait for the BANG.');
}

function playerShoots(sideTapped) {
  const react = now() - state.bangAt;

  if (L.type === 'aim' && sideTapped !== state.side) {
    state.phase = 'over'; clearTimers();
    shoot(scene.hero); scene.flash = .3;
    after(260, () => { shoot(scene.foes[0]); drop(scene.hero); });
    finish(false, 'Wrong side, cowboy.');
    return;
  }

  shoot(scene.hero);
  const target = scene.foes.find(f => !f.fall);
  if (target) drop(target);
  state.hits++;

  if (L.type === 'double' && scene.foes.some(f => !f.fall)) return;   // keep going

  state.phase = 'over'; clearTimers();
  state.react = react;
  finish(true, L.type === 'double'
    ? 'Both of them, in ' + fmt(react) + '. Cold blooded.'
    : 'He never cleared the holster.');
}

function finish(win, note) {
  state.phase = 'over'; clearTimers();
  dirsEl.style.opacity = 0;
  const ms = state.react;
  if (win) {
    sfx.win();
    if (!save.cleared.includes(state.i)) save.cleared.push(state.i);
    if (!save.best[state.i] || ms < save.best[state.i]) save.best[state.i] = ms;
    persist();
  } else sfx.lose();

  after(win ? 850 : 1000, () => {
    $('verdict').textContent = win ? 'WINNER' : 'YOU DIED';
    $('verdict').style.color = win ? '#f2b338' : '#e0562f';
    $('rtime').textContent = win && ms ? fmt(ms) : '';
    $('rstars').innerHTML = win && ms ? '★'.repeat(stars(ms)) + '<span style="opacity:.2">' +
      '★'.repeat(3 - stars(ms)) + '</span>' : '';
    $('rnote').textContent = note || '';
    const isLast = state.i >= LEVELS.length - 1;
    $('next').textContent = isLast ? 'BACK TO LEVELS' : 'NEXT DUEL';
    $('next').style.display = win ? '' : 'none';
    $('retry').textContent = 'AGAIN';
    show('result');
    buildGrid();
  });
}

/* ------------------------------------------------------- local 2-player mode */

function startVersus(fresh) {
  clearTimers();
  state.mode = 'vs';
  if (fresh) { state.score = [0, 0]; state.round = 0; }
  state.round++;
  L = { n: 'LOCAL DUEL', type: 'duel', opp: 0, pal: state.round % PALETTES.length,
        wait: [900, 3400] };
  state.phase = 'lead'; state.react = 0; state.hits = 0; state.side = null;
  resetScene(L, 1);
  scene.foes[0].accent = '#b3402c';
  showScore();
  $('pads').classList.add('on');
  $('quit').innerHTML = '&#8592; MENU';
  $('pad1').innerHTML = '<b>P1</b>SPACE / LEFT SIDE';
  $('pad2').innerHTML = '<b>P2</b>CLICK / RIGHT SIDE';
  dirsEl.style.opacity = 0;
  cue(''); hint('FIRST TO ' + VS_WIN + ' ROUNDS');
  show('play'); actx();

  after(450, () => { state.phase = 'ready'; cue('READY'); sfx.tick(); });
  after(1250, () => {
    state.phase = 'armed'; cue('STEADY'); sfx.tick(); hint('');
    after(rnd(L.wait[0], L.wait[1]), bang);
  });
}

const showScore = () =>
  $('lvlname').textContent = 'P1  ' + state.score[0] + ' — ' + state.score[1] + '  P2';
const duellists = () => [scene.hero, scene.foes[0]];

function vsShoot(p) {
  state.phase = 'over'; clearTimers();
  const g = duellists(), react = now() - state.bangAt;
  shoot(g[p]); drop(g[1 - p]);
  state.react = react; state.score[p]++;
  vsRound(p, 'Cleared leather in ' + fmt(react) + '.', react);
}

function vsFlinch(p) {
  if (state.phase === 'over') return;
  state.phase = 'over'; clearTimers();
  const g = duellists();
  cue(PN[p] + ' FLINCHED!'); sfx.early();
  g[p].arm = 1; scene.shake = .6;
  after(420, () => { shoot(g[1 - p]); drop(g[p]); });
  state.score[1 - p]++;
  vsRound(1 - p, PN[p] + ' drew before the bang. Round goes to ' + PN[1 - p] + '.', 0);
}

function vsStalemate() {
  if (state.phase !== 'bang') return;
  state.phase = 'over'; clearTimers();
  cue('FROZEN!', true);
  vsRound(-1, 'Neither of you drew. Nothing counts.', 0);
}

function vsRound(w, note, react) {
  showScore();
  const done = w >= 0 && state.score[w] >= VS_WIN;
  if (w >= 0) sfx.win(); else sfx.lose();
  after(900, () => {
    $('verdict').textContent = w < 0 ? 'STANDOFF' : done ? PN[w] + ' WINS THE MATCH' : PN[w] + ' TAKES IT';
    $('verdict').style.color = w === 1 ? '#e0562f' : w === 0 ? '#7fb1e8' : '#f6e7c8';
    $('rtime').textContent = react ? fmt(react) : '';
    $('rstars').innerHTML = 'P1 <b>' + state.score[0] + '</b> — <b>' + state.score[1] + '</b> P2';
    $('rnote').textContent = note;
    $('next').style.display = '';
    $('next').textContent = done ? 'REMATCH' : 'NEXT ROUND';
    $('retry').textContent = 'RESET MATCH';
    show('result');
  });
}

/* -------------------------------------------------------------------- input */

function tap(sideTapped, src) {
  if (state.screen !== 'play') return;
  const vs = state.mode === 'vs';
  // versus: SPACE and the left half are P1, the mouse / right half is P2
  const p = vs ? (src === 'key' ? 0 : sideTapped === 'L' ? 0 : 1) : 0;
  switch (state.phase) {
    case 'lead': case 'ready': case 'steady': case 'armed': case 'armed2':
      vs ? vsFlinch(p) : falseStart(); break;
    case 'dodge':
      clearTimers();
      scene.hero.lean = -1; scene.flash = .2; sfx.tick();
      state.phase = 'armed2';
      hint('NOW GET HIM');
      cue('MISSED!', true);
      after(520, () => { scene.hero.lean = 0; cue(''); });
      after(rnd(900, 2000), bang);
      break;
    case 'bang':
      vs ? vsShoot(p) : playerShoots(sideTapped); break;
  }
}

window.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.btn, .back, .cell')) return;
  const side = e.clientX < window.innerWidth / 2 ? 'L' : 'R';
  tap(side, 'pointer');
}, { passive: true });

window.addEventListener('keydown', (e) => {
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    if (state.screen === 'menu') startLevel(firstUnplayed());
    else if (state.screen === 'levels') void 0;
    else if (state.screen === 'result') $('next').style.display === 'none' ? startLevel(state.i) : $('next').click();
    else tap(null, 'key');
  } else if (e.key === 'ArrowLeft') tap('L', 'key');
  else if (e.key === 'ArrowRight') tap('R', 'key');
  else if (e.key === 'Escape') bail();
});

function firstUnplayed() {
  for (let i = 0; i < LEVELS.length; i++) if (!save.cleared.includes(i)) return i;
  return 0;
}

/* ------------------------------------------------------------------ wire up */

function bail() {
  clearTimers();
  if (state.mode === 'vs') { state.mode = 'solo'; $('pads').classList.remove('on'); show('menu'); }
  else { buildGrid(); show('levels'); }
}

$('play').onclick    = () => startLevel(firstUnplayed());
$('vs').onclick      = () => startVersus(true);
$('pick').onclick    = () => { buildGrid(); show('levels'); };
$('toMenu').onclick  = () => show('menu');
$('toLevels').onclick= bail;
$('retry').onclick   = () => state.mode === 'vs' ? startVersus(true) : startLevel(state.i);
$('next').onclick    = () => {
  if (state.mode === 'vs') {
    startVersus(state.score[0] >= VS_WIN || state.score[1] >= VS_WIN);
  } else if (state.i >= LEVELS.length - 1) { buildGrid(); show('levels'); }
  else startLevel(state.i + 1);
};
$('quit').onclick    = bail;
$('mute').onclick    = (e) => {
  save.mute = !save.mute; persist();
  e.currentTarget.textContent = save.mute ? '✕' : '♫';
};
$('wipe').onclick = () => {
  if (!confirm('Erase all times and progress?')) return;
  save = { best: {}, cleared: [], mute: save.mute }; persist(); buildGrid();
};

$('mute').textContent = save.mute ? '✕' : '♫';
resetScene(LEVELS[0], 1);
buildGrid();
fit();
requestAnimationFrame(loop);

// deep link for testing:  index.html#lvl7
{
  const m = typeof location === 'undefined' ? null : /^#lvl(\d+)$/.exec(location.hash);
  if (m) { const i = clamp(+m[1] - 1, 0, LEVELS.length - 1); after(60, () => startLevel(i)); }
}
