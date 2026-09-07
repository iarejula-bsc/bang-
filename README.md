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

Controls: **tap / click / SPACE** to draw, **← →** for the aim duels,
**ESC** to leave a duel.

Progress (cleared levels, best times, mute) lives in `localStorage` under
`rsb.save.v1`, so it survives reloads and closing the browser. It is per browser
and per origin: `file://` and `http://localhost:8000` keep separate saves, and a
private window forgets everything on close. If storage is unavailable the game
still runs, it just cannot remember. *RESET SAVE* in the level list wipes it.

## Single player — 15 duels

Opponents get faster the deeper you go (620 ms down to 300 ms). Five kinds:

| type     | rule |
|----------|------|
| `duel`   | READY, STEADY, BANG — draw after the bang, never before |
| `feint`  | decoy words flash first (`BANK!`, `BANANA!`), only `BANG!` counts |
| `aim`    | after the bang one side lights up; shoot that side |
| `dodge`  | he shoots early — tap to duck, then win the real draw |
| `double` | two bandits, two taps, one time budget |

Drawing before the bang always loses. Stars: 3 under 230 ms, 2 under 320 ms.

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

## Tests

    node test/logic.js

The suite runs `game.js` inside a `vm` context with a virtual clock and a stub
DOM, so every duel type is played out deterministically (reaction timing, false
starts, unlocks, both control schemes in versus mode). Two of them re-boot the
script against the same fake storage to prove progress survives a page reload,
and that a browser refusing storage does not break the game.

## Level tweaking

`LEVELS` at the top of `game.js`: `opp` is the opponent's reaction time in ms,
`wait` the random window before the bang, `pal` the palette, `decoys` the number
of feints. `index.html#lvl7` jumps straight into a level while working on it.
