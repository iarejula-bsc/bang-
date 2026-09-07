/* Headless tests for game.js: a virtual clock plus a minimal DOM/canvas stub,
   so every duel can be played out instantly and deterministically.
   Run with:  node test/logic.js                                             */
const vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');

/* ---- virtual clock ------------------------------------------------------- */
let T = 1000, q = [], seq = 0;
const setT = (fn, ms) => { const id = ++seq; q.push({ t: T + (ms || 0), fn, id }); return id; };
const clrT = (id) => { q = q.filter(x => x.id !== id); };
function advance(ms) {
  const end = T + ms;
  for (;;) {
    q.sort((a, b) => a.t - b.t);
    if (!q.length || q[0].t > end) break;
    const n = q.shift(); T = n.t; n.fn();
  }
  T = end;
}
const advanceUntil = (pred, cap = 9000) => { let n = 0; while (!pred() && n < cap) { advance(5); n += 5; } return pred(); };

/* ---- DOM / canvas stubs -------------------------------------------------- */
const els = {};
const ctxStub = new Proxy({}, { get: (o, k) =>
  k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop() {} })
  : k === 'canvas' ? { width: 900, height: 506 } : () => {} });

function mkEl(id) {
  const set = new Set();
  return els[id] = {
    id, textContent: '', innerHTML: '', className: '', style: {}, children: [], offsetWidth: 1,
    classList: { add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c),
                 toggle: (c, on) => on ? set.add(c) : set.delete(c) },
    appendChild(c) { this.children.push(c); },
    getContext: () => ctxStub, addEventListener() {}, closest: () => null,
    click() { this.onclick && this.onclick(); },
  };
}

const store = {};                 /* shared "browser storage" across boots */

const file = process.argv[2] || path.join(__dirname, '..', 'game.js');
const src = fs.readFileSync(file, 'utf8') +
  '\n;globalThis.__g = { state, startLevel, startVersus, tap, LEVELS, save, scene, VS_WIN };';

/* boot game.js in a fresh context, as a page load would */
function boot(storage) {
  const handlers = {};
  ['cv','cue','hint','dirs','dL','dR','grid','pb','lvlname','menu','levels','result','hud','verdict',
   'rtime','rstars','rnote','next','retry','toLevels','toMenu','play','pick','vs','quit','mute','wipe',
   'pads','pad1','pad2'].forEach(mkEl);
  const sandbox = {
    console, Math, JSON, Object, Array, Date, String, Number, isNaN, parseInt, parseFloat,
    performance: { now: () => T },
    setTimeout: setT, clearTimeout: clrT, requestAnimationFrame: () => 0,
    localStorage: storage ||
      { getItem: k => store[k] || null, setItem: (k, v) => store[k] = String(v) },
    document: { getElementById: id => els[id] || mkEl(id), createElement: () => mkEl('t' + (++seq)) },
    window: { devicePixelRatio: 1, innerWidth: 1000, innerHeight: 600,
              addEventListener: (k, f) => handlers[k] = f },
  };
  sandbox.globalThis = sandbox; sandbox.window.document = sandbox.document;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: file });
  return { G: sandbox.__g, handlers };
}

const first = boot();
const G = first.G, H = first.handlers;

const tapAt = (x) => H.pointerdown({ clientX: x, target: { closest: () => null } });
const key = (k) => H.keydown({ key: k, preventDefault() {} });
const toBang = () => assert(advanceUntil(() => G.state.phase === 'bang'), 'never reached BANG');
const typeIdx = (t) => G.LEVELS.findIndex(l => l.type === t);

/* ---- tests --------------------------------------------------------------- */
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

console.log('\nready steady bang — logic tests');

t('menu is the start screen', () => assert.equal(G.state.screen, 'menu'));

t('a duel walks READY -> STEADY -> BANG', () => {
  G.startLevel(0);
  assert.equal(G.state.phase, 'lead');
  advance(500);
  assert.equal(G.state.phase, 'ready'); assert.equal(els.cue.textContent, 'READY');
  advance(900);
  assert.equal(els.cue.textContent, 'STEADY');
  assert.equal(G.state.phase, 'armed');   // armed = the real BANG is now pending
  toBang(); assert.equal(els.cue.textContent, 'BANG!');
});

t('shooting on time wins and records the reaction', () => {
  G.startLevel(0); toBang();
  advance(180); tapAt(100);
  assert.equal(G.state.phase, 'over');
  assert(Math.abs(G.state.react - 180) < 6, 'react=' + G.state.react);
  advance(1200);
  assert.equal(els.verdict.textContent, 'WINNER');
  assert(G.save.cleared.includes(0), 'level not marked cleared');
  assert(Math.abs(G.save.best[0] - 180) < 6);
});

t('best time only improves', () => {
  G.startLevel(0); toBang(); advance(400); tapAt(100); advance(1200);
  assert(Math.abs(G.save.best[0] - 180) < 6, 'best got worse: ' + G.save.best[0]);
  G.startLevel(0); toBang(); advance(90); tapAt(100); advance(1200);
  assert(Math.abs(G.save.best[0] - 90) < 6, 'best not improved: ' + G.save.best[0]);
});

t('drawing before BANG is a false start', () => {
  G.startLevel(0); advance(600); tapAt(100);
  assert.equal(els.cue.textContent, 'TOO SOON!');
  advance(1200); assert.equal(els.verdict.textContent, 'YOU DIED');
});

t('a slow draw loses, and a late tap cannot undo it', () => {
  G.startLevel(0); toBang();
  advance(G.LEVELS[0].opp + 30);
  assert.equal(G.state.phase, 'over');
  advance(1200); assert.equal(els.verdict.textContent, 'YOU DIED');
  tapAt(100); assert.equal(els.verdict.textContent, 'YOU DIED');
});

t('feint: decoy words appear and do not end the round', () => {
  const i = typeIdx('feint');
  G.startLevel(i); advance(1300);
  let sawDecoy = false;
  for (let k = 0; k < 800 && G.state.phase !== 'bang'; k++) {
    advance(5);
    const c = els.cue.textContent;
    if (c && c !== 'BANG!' && c !== 'STEADY') sawDecoy = true;
  }
  assert(sawDecoy, 'no decoy word ever appeared');
  assert.equal(G.state.phase, 'bang');
  advance(120); tapAt(100); advance(1200);
  assert.equal(els.verdict.textContent, 'WINNER');
});

t('aim: wrong side loses, right side wins', () => {
  const i = typeIdx('aim');
  G.startLevel(i); toBang();
  advance(100); tapAt(G.state.side === 'L' ? 900 : 100); advance(1400);
  assert.equal(els.verdict.textContent, 'YOU DIED');
  G.startLevel(i); toBang();
  advance(100); tapAt(G.state.side === 'L' ? 100 : 900); advance(1400);
  assert.equal(els.verdict.textContent, 'WINNER');
});

t('aim: arrow keys pick a side', () => {
  const i = typeIdx('aim');
  G.startLevel(i); toBang();
  advance(100); key(G.state.side === 'L' ? 'ArrowLeft' : 'ArrowRight'); advance(1400);
  assert.equal(els.verdict.textContent, 'WINNER');
});

t('dodge: duck the cheap shot, then draw', () => {
  const i = typeIdx('dodge');
  G.startLevel(i);
  assert(advanceUntil(() => G.state.phase === 'dodge'), 'no dodge cue');
  advance(100); tapAt(100);
  assert.equal(G.state.phase, 'armed2');
  toBang(); advance(150); tapAt(100); advance(1200);
  assert.equal(els.verdict.textContent, 'WINNER');
});

t('dodge: standing still gets you shot', () => {
  const i = typeIdx('dodge');
  G.startLevel(i);
  assert(advanceUntil(() => G.state.phase === 'dodge'), 'no dodge cue');
  advance(600);
  assert.equal(G.state.phase, 'over');
  advance(1200); assert.equal(els.verdict.textContent, 'YOU DIED');
});

t('double: two bandits need two shots', () => {
  const i = typeIdx('double');
  G.startLevel(i); toBang();
  advance(150); tapAt(100);
  assert.equal(G.state.phase, 'bang', 'round ended after one shot');
  advance(150); tapAt(100);
  assert.equal(G.state.phase, 'over');
  advance(1200);
  assert.equal(els.verdict.textContent, 'WINNER');
  assert(G.scene.foes.every(f => f.fall > 0), 'a bandit is still standing');
});

t('double: one shot in time is not enough', () => {
  const i = typeIdx('double');
  G.startLevel(i); toBang();
  advance(150); tapAt(100);
  advance(G.LEVELS[i].opp + 50); advance(1200);
  assert.equal(els.verdict.textContent, 'YOU DIED');
});

t('space draws, escape bails out to level select', () => {
  G.startLevel(0); toBang(); advance(120); key(' ');
  assert.equal(G.state.phase, 'over');
  advance(1200); key('Escape');
  assert.equal(G.state.screen, 'levels');
});

t('progress unlocks exactly one duel ahead', () => {
  G.save.cleared = [0, 1];
  els.grid.children = [];
  els.pick.onclick();
  assert.equal(els.grid.children.length, G.LEVELS.length);
  assert(els.grid.children[2].onclick, 'level 3 should be unlocked');
  assert(!els.grid.children[4].onclick, 'level 5 should still be locked');
});

t('progress is persisted', () => {
  assert(store['rsb.save.v1'], 'nothing persisted');
  const back = JSON.parse(store['rsb.save.v1']);
  assert(back.best && Object.keys(back.best).length, 'no best times persisted');
});

/* ---- local 2-player -------------------------------------------------- */

t('versus: SPACE wins the round for P1', () => {
  G.startVersus(true);
  toBang();
  advance(140); key(' ');
  assert.equal(G.state.phase, 'over');
  assert.deepEqual(G.state.score, [1, 0]);
  advance(1200);
  assert.equal(els.verdict.textContent, 'P1 TAKES IT');
  assert.equal(els.next.textContent, 'NEXT ROUND');
});

t('versus: a click on the right half wins for P2', () => {
  G.startVersus(true);
  toBang();
  advance(140); tapAt(900);
  assert.deepEqual(G.state.score, [0, 1]);
  advance(1200);
  assert.equal(els.verdict.textContent, 'P2 TAKES IT');
});

t('versus: the left half is P1 on a touch screen', () => {
  G.startVersus(true); toBang();
  advance(140); tapAt(80);
  assert.deepEqual(G.state.score, [1, 0]);
});

t('versus: flinching hands the round to the other one', () => {
  G.startVersus(true);
  advance(700); tapAt(900);            // P2 draws during READY
  assert.equal(els.cue.textContent, 'P2 FLINCHED!');
  assert.deepEqual(G.state.score, [1, 0]);
  advance(1400);
  assert.equal(els.verdict.textContent, 'P1 TAKES IT');
});

t('versus: nobody draws -> standoff, no score', () => {
  G.startVersus(true); toBang();
  advance(4200);
  assert.deepEqual(G.state.score, [0, 0]);
  advance(1200);
  assert.equal(els.verdict.textContent, 'STANDOFF');
});

t('versus: match runs to the round limit, then offers a rematch', () => {
  G.startVersus(true);
  for (let r = 0; r < G.VS_WIN; r++) {
    if (r) els.next.click();
    toBang(); advance(120); key(' '); advance(1200);
  }
  assert.deepEqual(G.state.score, [G.VS_WIN, 0]);
  assert.equal(els.verdict.textContent, 'P1 WINS THE MATCH');
  assert.equal(els.next.textContent, 'REMATCH');
  els.next.click();                    // rematch resets the score
  assert.deepEqual(G.state.score, [0, 0]);
});

t('versus: leaving restores single player', () => {
  G.startVersus(true);
  els.quit.onclick();
  assert.equal(G.state.mode, 'solo');
  assert.equal(G.state.screen, 'menu');
  G.startLevel(0); toBang(); advance(120); tapAt(100); advance(1200);
  assert.equal(els.verdict.textContent, 'WINNER');
});

t('every level is reachable and winnable', () => {
  for (let i = 0; i < G.LEVELS.length; i++) {
    G.startLevel(i);
    if (G.LEVELS[i].type === 'dodge') {
      assert(advanceUntil(() => G.state.phase === 'dodge'), 'lvl ' + (i + 1) + ': no dodge cue');
      advance(80); tapAt(100);
    }
    assert(advanceUntil(() => G.state.phase === 'bang'), 'lvl ' + (i + 1) + ': no BANG');
    advance(80);
    tapAt(G.state.side === 'L' ? 100 : 900);
    if (G.LEVELS[i].type === 'double') { advance(80); tapAt(100); }
    advance(1400);
    assert.equal(els.verdict.textContent, 'WINNER', 'lvl ' + (i + 1) + ' unwinnable');
  }
});

/* ---- browser storage (these re-boot the page, so they run last) ------- */

t('a cleared level is still cleared after a page reload', () => {
  G.save.cleared = []; G.save.best = {};
  G.startLevel(0); toBang(); advance(210); tapAt(100); advance(1200);   // clear level 1
  G.startLevel(1); toBang(); advance(190); tapAt(100); advance(1200);   // clear level 2

  const r = boot();                                                    // fresh page load
  assert.deepEqual(r.G.save.cleared.slice().sort(), [0, 1], 'unlocks lost on reload');
  assert(Math.abs(r.G.save.best[0] - 210) < 6, 'best time lost on reload');
  assert(Math.abs(r.G.save.best[1] - 190) < 6, 'best time lost on reload');
  els.grid.children = []; els.pick.onclick();
  assert(els.grid.children[2].onclick, 'level 3 locked again after reload');
  assert(!els.grid.children[3].onclick, 'level 4 unlocked out of order');
});

t('blocked storage (private window) still boots and plays', () => {
  const denied = { getItem() { throw new Error('denied'); },
                   setItem() { throw new Error('denied'); } };
  const r = boot(denied);
  assert.deepEqual(r.G.save.cleared, [], 'should start empty when storage is unreadable');
  r.G.startLevel(0);
  assert(advanceUntil(() => r.G.state.phase === 'bang'), 'no BANG without storage');
  advance(150);
  r.handlers.pointerdown({ clientX: 100, target: { closest: () => null } });
  assert.equal(r.G.state.phase, 'over');
  advance(1200);
  assert.equal(els.verdict.textContent, 'WINNER', 'cannot win without storage');
  assert(r.G.save.cleared.includes(0), 'in-memory progress lost');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
