# Ready Steady Bang (replica)

A browser replica of the mobile quick-draw duel game: wait for **BANG!**, draw
faster than the other guy. Vanilla HTML/CSS/JS canvas, no build step, no deps.

    index.html      markup + styles + overlays (menu, level select, results)
    game.js         levels, scene rendering, duel logic, audio
    test/logic.js   headless tests (virtual clock + DOM stub)
    build.sh        bundles both into a single shareable readysteadybang.html

## Play

Open `index.html` in a browser, or serve the folder to play on a phone:

    python3 -m http.server 8000
    # desktop: http://localhost:8000
    # phone (same wifi): http://<your-lan-ip>:8000

Controls: **tap / click / SPACE** to draw, **← →** for the aim and mirror
duels, **ESC** to leave a duel or the store.

Progress (cleared levels, best times, coin, wardrobe, mute) lives in
`localStorage` under
`rsb.save.v1`, so it survives reloads and closing the browser. It is per browser
and per origin: `file://` and `http://localhost:8000` keep separate saves, and a
private window forgets everything on close. If storage is unavailable the game
still runs, it just cannot remember. *RESET SAVE* in the level list wipes it.

## Single player — 24 duels

Seven mechanics, each coming back harder instead of repeating, and no two
levels in a row using the same one (bar the two opening duels, which teach the
timing):

| type     | rule | escalates |
|----------|------|-----------|
| `duel`   | READY, STEADY, BANG — draw after the bang, never before | 620 ms → 290 ms |
| `feint`  | decoy words flash first (`BANK!`, `BANANA!`), only `BANG!` counts | 1 → 4 decoys, each flashing shorter |
| `aim`    | a bandit on each flank; shoot the side that lights up | 1 → 2 targets, sides alternate |
| `mirror` | same setup, inverted: shoot the side that stays dark | 1 → 2 targets |
| `dodge`  | he shoots early — duck, then win the real draw | 1 → 3 cheap shots, shrinking window |
| `gang`   | 2, 3 or 4 bandits, one shot each, one budget | The Brothers → The Gang → The Cartel |
| `sudden` | no READY, no STEADY: the bang can land at 250 ms | 520 ms → 400 ms |

Drawing before the bang always loses. Stars: 3 under 230 ms, 2 under 320 ms.

## The general store

Wins pay coin: **15 for a first clear, plus 5 per star** (so 30 for a first
3-star draw, 5-15 on a replay). Losing pays nothing, and the two-player mode
pays nothing either — no farming your friend.

Coin buys looks, never advantages: **hats** (Sheriff, Head Rag, Bowler,
Sombrero, Undertaker) change the silhouette, **bandanas** recolour the neck,
belt and trim, and **extras** add a cigar, a tin star or a poncho. One click
buys and wears an item; clicking something you own just wears it. The store
doubles as a showroom — your gunslinger stands below the shelf wearing whatever
you pick, and the gear follows you into every duel.

## Two players, same screen

**2 PLAYERS · SAME SCREEN** in the menu. First to 3 rounds.

* **P1** — `SPACE`, or the left half of the screen
* **P2** — mouse click, or the right half of the screen

Whoever draws first after the bang takes the round; whoever flinches before it
hands the round over. Nobody draws within 4 s: standoff, no score.

## Sharing it

    ./build.sh                  # -> readysteadybang.html, one self-contained file

That single file has the CSS and JS inlined, so it runs from `file://` with no
server and no unzipping — just send it. Rebuild it after editing `game.js`.

### GitHub Pages

`.github/workflows/pages.yml` runs the tests, runs `./build.sh` and publishes
the bundle on every push to `main` — so the live site is always built from
source and `readysteadybang.html` stays out of git.

    https://iarejula-bsc.github.io/bang-/                     # the game
    https://iarejula-bsc.github.io/bang-/readysteadybang.html # same file, direct link

One-time setup: **Settings → Pages → Build and deployment → Source: GitHub
Actions**. After that, *Actions → Deploy to Pages → Run workflow* redeploys by
hand.

## Tests

    node test/logic.js

47 cases. The suite runs `game.js` inside a `vm` context with a virtual clock
and a stub DOM, so every duel is played out deterministically: reaction timing,
false starts, each mechanic and its failure modes, the difficulty curve (never
repeats, always escalates), coin rewards, buying and equipping, unlocks, and
both control schemes in versus mode. Three cases re-boot the script against the
same fake storage to prove progress and purchases survive a page reload, and
that a browser refusing storage does not break the game.

## Level tweaking

`LEVELS` at the top of `game.js`: `opp` is the opponent's reaction time in ms
(the whole budget for `gang` and multi-step `aim`), `wait` the random window
before the bang, `pal` the palette, and `decoys` / `dodges` / `foes` / `steps`
dial the mechanic up. `ITEMS` right below it is the store catalogue — `p` is the
price, `c` a bandana colour. `index.html#lvl7` jumps straight into a level.
