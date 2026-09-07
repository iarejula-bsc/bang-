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
  let html = '';
  const el = {
    id, textContent: '', className: '', style: {}, children: [], offsetWidth: 1,
    classList: { add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c),
                 toggle: (c, on) => on ? set.add(c) : set.delete(c) },
    appendChild(c) { this.children.push(c); },
    getContext: () => ctxStub, addEventListener() {}, closest: () => null,
    click() { this.onclick && this.onclick(); },
  };
  Object.defineProperty(el, 'innerHTML', {
    get: () => html,
    set(v) { html = String(v); if (!html) el.children.length = 0; },
  });
  return els[id] = el;
}

const store = {};                 /* shared "browser storage" across boots */

const file = process.argv[2] || path.join(__dirname, '..', 'game.js');
const src = fs.readFileSync(file, 'utf8') +
  '\n;globalThis.__g = { state, startLevel, startVersus, tap, LEVELS, save, scene, VS_WIN, ITEMS, findItem, pickItem, openShop, buildShelf };';

/* boot game.js in a fresh context, as a page load would */
function boot(storage) {
  const handlers = {};
  ['cv','cue','hint','dirs','dL','dR','grid','pb','lvlname','menu','levels','result','hud','verdict',
   'rtime','rstars','rnote','rcoins','next','retry','toLevels','toMenu','play','pick','vs','quit','mute',
   'wipe','pads','pad1','pad2','shop','shelf','wallet','menuwallet','toShop','shopBack'].forEach(mkEl);
  const sandbox = {
    console, Math, JSON, Object, Array, Date, String, Number, isNaN, parseInt, parseFloat,
    performance: { now: () => T },
    setTimeout: setT, clearTimeout: clrT, requestAnimationFrame: () => 0,
    localStorage: storage ||
      { getItem: k => store[k] || null, setItem: (k, v) => store[k] = String(v) },
    document: { getElementById: id => els[id] || mkEl(id), createElement: () => mkEl('t' + (++seq)) },
    confirm: () => true,
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

t('gang: two bandits need two shots', () => {
  const i = G.LEVELS.findIndex(l => l.type === 'gang' && l.foes === 2);
  G.startLevel(i); toBang();
  advance(150); tapAt(100);
  assert.equal(G.state.phase, 'bang', 'round ended after one shot');
  advance(150); tapAt(100);
  assert.equal(G.state.phase, 'over');
  advance(1200);
  assert.equal(els.verdict.textContent, 'WINNER');
  assert(G.scene.foes.every(f => f.fall > 0), 'a bandit is still standing');
});

t('gang: one shot in time is not enough', () => {
  const i = G.LEVELS.findIndex(l => l.type === 'gang' && l.foes === 2);
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

t('gang: a bigger gang needs a shot each', () => {
  for (const n of [3, 4]) {
    const i = G.LEVELS.findIndex(l => l.type === 'gang' && l.foes === n);
    assert(i >= 0, 'no gang of ' + n);
    G.startVersus && 0;
    G.startLevel(i); toBang();
    assert.equal(G.scene.foes.length, n, 'wrong crowd size');
    for (let k = 0; k < n; k++) {
      advance(60); tapAt(100);
      const standing = G.scene.foes.filter(f => !f.fall).length;
      assert.equal(standing, n - k - 1, 'bandit ' + (k + 1) + ' still up');
      if (k < n - 1) assert.equal(G.state.phase, 'bang', 'round ended early');
    }
    advance(1400);
    assert.equal(els.verdict.textContent, 'WINNER', 'gang of ' + n + ' unwinnable');
  }
});

t('aim duels stand a bandit on each flank', () => {
  const i = typeIdx('aim');
  G.startLevel(i);
  assert.equal(G.scene.foes.length, 2);
  assert.equal(G.scene.foes[0].dir, 1);      // left one faces right
  assert.equal(G.scene.foes[1].dir, -1);
  assert.equal(G.scene.hero.px, 0.5);        // hero in the middle
});

t('aim: two steps alternate sides and drop both bandits', () => {
  const i = G.LEVELS.findIndex(l => l.type === 'aim' && l.steps === 2);
  assert(i >= 0, 'no two-step aim level');
  G.startLevel(i); toBang();
  const first = G.state.side;
  advance(90); tapAt(first === 'L' ? 100 : 900);
  assert.equal(G.state.phase, 'bang', 'ended after one target');
  assert.notEqual(G.state.side, first, 'the other flank should light up');
  advance(90); tapAt(G.state.side === 'L' ? 100 : 900);
  assert.equal(G.state.phase, 'over');
  assert(G.scene.foes.every(f => f.fall > 0), 'a flank is still standing');
  advance(1400);
  assert.equal(els.verdict.textContent, 'WINNER');
});

t('aim: missing a later step still loses', () => {
  const i = G.LEVELS.findIndex(l => l.type === 'aim' && l.steps === 2);
  G.startLevel(i); toBang();
  advance(90); tapAt(G.state.side === 'L' ? 100 : 900);
  advance(G.LEVELS[i].opp + 60); advance(1400);
  assert.equal(els.verdict.textContent, 'YOU DIED');
});

t('mirror: you must shoot the side that did NOT light up', () => {
  const i = typeIdx('mirror');
  assert(i >= 0, 'no mirror level');
  G.startLevel(i); toBang();
  advance(90); tapAt(G.state.side === 'L' ? 100 : 900);   // obedient = wrong
  advance(1400);
  assert.equal(els.verdict.textContent, 'YOU DIED');

  G.startLevel(i); toBang();
  advance(90); tapAt(G.state.side === 'L' ? 900 : 100);   // the other one
  advance(1400);
  assert.equal(els.verdict.textContent, 'WINNER');
});

t('sudden: no countdown, and flinching still loses', () => {
  const i = typeIdx('sudden');
  assert(i >= 0, 'no sudden level');
  G.startLevel(i);
  assert.equal(G.state.phase, 'armed', 'sudden levels skip READY/STEADY');
  assert.equal(els.cue.textContent, '');
  tapAt(100);                                            // drew before the bang
  assert.equal(els.cue.textContent, 'TOO SOON!');
  advance(1400);
  assert.equal(els.verdict.textContent, 'YOU DIED');

  G.startLevel(i); toBang();
  advance(120); tapAt(100); advance(1400);
  assert.equal(els.verdict.textContent, 'WINNER');
});

t('dodge: three cheap shots must all be ducked', () => {
  const i = G.LEVELS.findIndex(l => l.type === 'dodge' && l.dodges === 3);
  assert(i >= 0, 'no three-dodge level');
  G.startLevel(i);
  for (let k = 0; k < 3; k++) {
    assert(advanceUntil(() => G.state.phase === 'dodge'), 'dodge ' + (k + 1) + ' never came');
    advance(60); tapAt(100);
    assert.equal(G.state.dodged, k + 1);
  }
  toBang(); advance(120); tapAt(100); advance(1400);
  assert.equal(els.verdict.textContent, 'WINNER');
});

t('dodge: missing the second cheap shot loses', () => {
  const i = G.LEVELS.findIndex(l => l.type === 'dodge' && l.dodges >= 2);
  G.startLevel(i);
  assert(advanceUntil(() => G.state.phase === 'dodge'));
  advance(60); tapAt(100);                                // first one ducked
  assert(advanceUntil(() => G.state.phase === 'dodge'));
  advance(700);                                           // stand still for the second
  advance(1400);
  assert.equal(els.verdict.textContent, 'YOU DIED');
});

t('no two levels in a row use the same mechanic (after the opening pair)', () => {
  // levels 1-2 are both plain duels on purpose: they teach the timing before
  // any twist shows up. From level 3 on, every level changes the mechanic.
  for (let i = 2; i < G.LEVELS.length; i++) {
    assert.notEqual(G.LEVELS[i].type, G.LEVELS[i - 1].type,
      'levels ' + i + ' and ' + (i + 1) + ' are both ' + G.LEVELS[i].type);
  }
});

t('each mechanic gets harder every time it comes back', () => {
  const seen = {};
  const load = (l) => l.type === 'gang' ? l.foes : l.type === 'dodge' ? l.dodges
             : l.type === 'feint' ? l.decoys : l.steps || 1;
  for (const l of G.LEVELS) {
    const prev = seen[l.type];
    if (prev) {
      const harder = load(l) > load(prev) || l.opp < prev.opp;
      assert(harder, l.n + ' is not harder than ' + prev.n);
    }
    seen[l.type] = l;
  }
});

/* ---- cosmetics store ------------------------------------------------- */

const coins = () => G.save.coins;

t('store: you start with the free gear on and no coin', () => {
  G.save.coins = 0; G.save.owned = ['hat.stetson', 'bandana.blue', 'extra.none'];
  G.save.equipped = { hat: 'stetson', bandana: 'blue', extra: 'none' };
  assert.equal(coins(), 0);
  G.openShop();
  assert.equal(G.state.screen, 'shop');
  assert.equal(G.scene.foes.length, 0, 'the showroom should be empty');
  assert.equal(G.scene.hero.px, 0.5);
  assert.equal(G.scene.hero.style.hat, 'stetson');
});

t('store: the shelf lists every item under its slot', () => {
  G.buildShelf();
  const racks = els.shelf.children.filter(c => c.className === 'rack');
  assert.equal(racks.length, 3, 'expected hats / bandanas / extras');
  const listed = racks.reduce((n, r) => n + r.children.length, 0);
  assert.equal(listed, G.ITEMS.length, 'not every item is on the shelf');
  assert(els.wallet.innerHTML.indexOf(String(coins())) >= 0, 'wallet not shown');
});

t('duels pay coin: first clear plus a bonus per star', () => {
  G.save.cleared = []; G.save.best = {}; G.save.coins = 0;
  G.startLevel(0); toBang(); advance(200); tapAt(100); advance(1200);
  assert.equal(coins(), 15 + 5 * 3, 'first 3-star clear should pay 30');
  assert.equal(els.rcoins.innerHTML.indexOf('+30'), 0, 'reward not shown: ' + els.rcoins.innerHTML);

  G.startLevel(0); toBang(); advance(300); tapAt(100); advance(1200);   // 2 stars, replay
  assert.equal(coins(), 30 + 10, 'a replay should pay stars only');
  G.startLevel(0); toBang(); advance(400); tapAt(100); advance(1200);   // 1 star
  assert.equal(coins(), 40 + 5, 'a one-star win should pay 5');
});

t('losing pays nothing', () => {
  const before = coins();
  G.startLevel(0); advance(600); tapAt(100); advance(1400);   // false start
  assert.equal(coins(), before);
  assert.equal(els.rcoins.innerHTML, '');
});

t('store: buying takes the coin, equips it, and sticks', () => {
  G.save.coins = 200;
  const hat = G.findItem('hat', 'sombrero');
  assert(hat && hat.p > 0);
  assert.equal(G.pickItem(hat), true);
  assert.equal(coins(), 200 - hat.p);
  assert(G.save.owned.indexOf('hat.sombrero') >= 0, 'not owned after buying');
  assert.equal(G.save.equipped.hat, 'sombrero');
  assert.equal(G.scene.hero.style.hat, 'sombrero', 'the hero is still bare-headed');
});

t('store: re-equipping something you own is free', () => {
  const before = coins();
  G.pickItem(G.findItem('hat', 'stetson'));
  assert.equal(coins(), before, 'charged twice for the same hat');
  assert.equal(G.save.equipped.hat, 'stetson');
  G.pickItem(G.findItem('hat', 'sombrero'));
  assert.equal(coins(), before, 'charged again for an owned hat');
});

t('store: no credit — an item you cannot afford is refused', () => {
  G.save.coins = 5;
  const pricey = G.ITEMS.filter(it => it.p > 5 && !G.save.owned.includes(it.slot + '.' + it.id))[0];
  assert(pricey, 'everything is already owned');
  assert.equal(G.pickItem(pricey), false);
  assert.equal(coins(), 5, 'coin went missing');
  assert.equal(G.save.equipped[pricey.slot] === pricey.id, false, 'equipped without paying');
});

t('store: a bandana recolours the hero', () => {
  G.save.coins = 300;
  const red = G.findItem('bandana', 'crimson');
  G.pickItem(red);
  assert.equal(G.scene.hero.accent, red.c);
  G.startLevel(0);                     // and it survives into a duel
  assert.equal(G.scene.hero.accent, red.c);
  assert.equal(G.scene.foes[0].accent === red.c, false, 'the bandit copied your look');
});

t('store: cosmetics are cosmetic — the duel still plays the same', () => {
  G.save.coins = 300;
  G.pickItem(G.findItem('extra', 'poncho'));
  G.pickItem(G.findItem('hat', 'tophat'));
  G.startLevel(0); toBang(); advance(150); tapAt(100); advance(1200);
  assert.equal(els.verdict.textContent, 'WINNER');
});

t('store: RESET SAVE clears coin and gear too', () => {
  G.save.coins = 99;
  els.wipe.onclick();                  // confirm() is stubbed truthy below
  assert.equal(coins(), 0);
  assert.deepEqual(G.save.owned, ['hat.stetson', 'bandana.blue', 'extra.none']);
  assert.equal(G.save.equipped.hat, 'stetson');
  assert.equal(G.scene.hero.style.hat, 'stetson');
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
    const L = G.LEVELS[i], tag = 'lvl ' + (i + 1) + ' (' + L.n + ')';
    G.startLevel(i);

    for (let d = 0; d < (L.dodges || 0); d++) {            // duck everything first
      assert(advanceUntil(() => G.state.phase === 'dodge'), tag + ': no dodge cue');
      advance(70); tapAt(100);
    }
    assert(advanceUntil(() => G.state.phase === 'bang'), tag + ': no BANG');

    const shots = L.type === 'gang' ? L.foes : (L.steps || 1);
    for (let k = 0; k < shots; k++) {
      advance(70);
      const want = L.type === 'mirror' ? (G.state.side === 'L' ? 'R' : 'L') : G.state.side;
      tapAt(want === 'L' ? 100 : want === 'R' ? 900 : 100);
    }
    advance(1400);
    assert.equal(els.verdict.textContent, 'WINNER', tag + ' unwinnable');
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

t('bought cosmetics survive a page reload', () => {
  G.save.coins = 300;
  G.pickItem(G.findItem('hat', 'sheriff'));
  G.pickItem(G.findItem('bandana', 'gold'));
  const left = G.save.coins;

  const r = boot();
  assert.equal(r.G.save.coins, left, 'coin balance lost on reload');
  assert(r.G.save.owned.indexOf('hat.sheriff') >= 0, 'hat lost on reload');
  assert.equal(r.G.save.equipped.hat, 'sheriff');
  assert.equal(r.G.save.equipped.bandana, 'gold');
  assert.equal(r.G.scene.hero.style.hat, 'sheriff', 'gear not applied at boot');
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
