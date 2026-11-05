# The simulation in a background thread (design note, cloud copy, 2026-11-05)

**Status: proposed; slices 1–2 (the engine side) built and tested 2026-11-05, see Results.** Not in the roadmap yet. It belongs under Phase 18 (deep simulation and rendering
optimization) and Phase 17 (the new UI). The owner asked whether MadColony should be a Windows game to run
better (2026-11-05). The answer given: the speed limit is the simulation's work, not the browser, and a Windows
wrapper (Tauri or Electron) would run the same code at the same speed. What helps smoothness most is to run the
simulation in a background thread (a Web Worker), so a slow tick never freezes the picture. The owner said
"keep going". This note is the plan; the engine side can be built and tested in the cloud, the UI side only at
home.

## What it changes, and what it does not
- **Smoother frames:** the screen is drawn on the main thread, the simulation runs in the worker. A 20–100 ms
  tick (Phase 18 measured them on the grown world) delays the next simulated tick, not the next frame. Panning,
  zooming, hover and menus stay at the browser's frame rate.
- **Saves no longer freeze the screen:** writing the grown world's save takes about 560 ms (measured below). In
  the worker it runs beside the drawing.
- **Not faster simulation:** the same ticks cost the same time. At high speeds the worker still runs as many
  ticks a second as the machine allows. Phase 18's slices remain the way to cut tick time.
- **Determinism unchanged:** the worker runs the same `Game.tick()` in the same order. God commands are already
  queued with the tick they apply at (`god.js issueCommand`), so it does not matter which thread sends them.
  Hashes do not change.
- **One frame of delay** for what the UI reads from the simulation (hover cards, panels): it asks, and the answer
  comes with the next message, normally within one frame (16.7 ms).

## Measured on the grown world (868 people, 62 villages; World preset, seed 7, day 300)
Scripts in the scratchpad (`workerprobe.mjs`, `viewprobe.mjs`), cloud machine, best of 3–20 runs:

| What | Size | Time |
|---|---|---|
| Copy the whole state (`structuredClone`) | — | 480–500 ms |
| Write the save (`serializeGame` + JSON) | 20 MB | 560 ms |
| Terrain (typed array of palette indexes) | 3 MB | 0.6 ms to copy |
| Positions of everyone who moves (873 people and animals, 3 floats each in this probe; the host sends 2) | 10 KB | 0.05 ms |
| Everything in a 64×40-tile view (521 buildings, 83 stacks, 61 crops, 130 nodes, 22 people) | 144 KB as JSON | 2 ms to gather and copy |
| The same, 128×80 tiles | 282 KB | 4 ms |
| The same, 256×160 tiles | 830 KB | 16 ms |
| Tiles that change per tick (`tileChanged` calls) | 0.12 a tick | — |

- **The whole state cannot be sent each frame** (500 ms). The UI must keep a mirror built from small messages.
- **Positions every frame are nearly free.** Buildings, stacks and crops in view cost 2–16 ms, so they go a few
  times a second and when the camera moves, not every frame.
- **One thing in the state cannot be copied at all:** `s.map.terrain` is an array-like Proxy over the terrain
  store (`tiles.js arrayView`, kept for old callers). The worker never copies the state, so this matters only to
  anything that tries; the terrain itself is `g._ts.idx` (a typed array) with its palette `g._ts.pal`.

## The design
The worker owns the `Game`. The main thread owns the canvas, the DOM, sound and browser storage.

**Messages from the main thread to the worker:**
- `init`: the mod packages (plain data, as `buildRegistry` already takes), the enabled ids, and either new-game
  options or a save's text.
- `speed` (0 for pause, 1, 2, 4, ...): the worker runs 60 ticks a second at 1×, as the browser does today.
- `command`: a god command (`power`, `args`), passed to `issueCommand` (it applies at the next tick, as now).
- `call`: one of the direct calls in `docs/integration-contract.md` §3b (laws, attacks, trade offers, founding),
  by name from a fixed list, with its arguments; the result comes back with the call's id.
- `camera`: the visible tile rectangle and zoom.
- `query`: a hover card, an inspector panel or a tab's data, by kind and subject; answered with plain data built
  by the same functions the UI calls today (`explain.js` and the per-phase readers in the contract).
- `save`: the worker writes the save and sends its text back; the main thread stores it (workers have no
  `localStorage`; IndexedDB works in both).

**Messages from the worker to the main thread** (at most one a frame, about 60 a second):
- `frame`: the tick and clock; the positions of everyone who moves in a transferable typed array (facing: later),
  with the id list only when it changed; tiles that changed since the last frame; log and chronicle entries
  since the last frame (each once, kept by a set of the lines sent); favour and the speed actually reached (ticks
  a second).
- `area`: what lies in the camera's rectangle (buildings, stacks, crops, nodes and the people's display fields),
  sent when the camera moves or the ground in view changes, and otherwise at most about 4 times a second; at most
  256 tiles a side. At the measured 4–16 ms that is 1.6–6% of the worker's time.
- `world`: for the zoomed-out world view, the village summaries and territory the world view already draws,
  once an hour of game time and on change.
- `result`: the answer to a `call`, `query` or `save`, with its id.

**The same interface without a thread.** A local host runs the same message handling in the main thread. It is
for tests, the headless tools, and as a fallback where workers are unavailable. The UI is written against the
messages, not against `g`.

## What has to change at home (UI)
- Today's UI reads `g` directly (render, hover cards, panels, the World tab). Each reader moves either to the
  mirror (what is drawn) or to a `query` (what is explained). An inventory of those reads comes first; it decides
  the size of the work, and it fits Phase 17's plan to rebuild the UI anyway.
- Saves move from a direct `serializeGame` call to the `save` message.
- Sound plans from events (`soundplan.js` already plans from events and state); it reads the `frame` log entries.
- Mod import and validation can run in either thread; the registry the worker builds is the one that counts.

## Slices
1. **Engine (cloud):** `src/sim/view.js`: pure readers that build the `frame`, `area` and `world` messages from a
   `Game`, with a "since" marker for log entries and changed tiles; and `src/sim/simhost.js`: the message handling
   (init, speed, command, call, camera, query, save) as a function that takes a `post` callback and a clock, so
   it runs the same in a worker, in the main thread or in a test. Tests: a run through the host gives the same
   hash as ticking the game directly; save and load through the host continue identically; a query answers with
   plain data; nothing sent contains anything that cannot be copied.
2. **The worker file (cloud):** `src/sim/worker.js`, a few lines that connect the host to `postMessage`. Tested
   in Node with `worker_threads`, measuring the frame message's size and the time between frames while a slow
   tick runs.
3. **The UI (home):** the inventory of direct reads, then the mirror and the queries, behind the local host
   first (no thread, nothing changes for the player), then switched to the worker.
4. **Measure (home):** Phase 18's browser matrix with and without the worker: frame p95 and p99 at 1×, 4× and
   the highest speed, on the grown world, with a war and the chronicle open.

## Risks and open points
- **The UI's direct reads** are the unknown; the inventory at home sizes them.
- **Panels one frame late:** a hover card that waits for its answer could flicker. Keep the last answer until the
  new one arrives.
- **Memory:** the mirror holds only what is in view and the world view's summaries, a few MB at most.
- **Browser support:** module workers are in every current browser. A Tauri or Electron wrapper later runs them
  the same way.

## Results: slices 1–2 (built and tested, 2026-11-05)
- **Built:**
  - `src/sim/view.js`: the readers `moversFrame`, `changedChunks` (from the existing per-chunk change counts,
    `g._chg`), `logSince` (by the last line sent, safe when the log is trimmed), `areaSnapshot` (clipped to the
    map and to 512 tiles a side) and `worldSummary`. They change nothing; the sender copies what they return once.
  - `src/sim/simhost.js`: `createSimHost({ post, now, schedule, cancel, copy })` with the messages above, plus
    `step` (run N ticks now; tests and single-stepping). Calls and queries come from fixed lists (`CALLS`,
    `QUERIES`); a village argument must name an existing village, and prototype keys (`__proto__`, `constructor`,
  `prototype`) are refused anywhere in a message. An error while the game runs pauses it and sends an `error`
  (`of: 'tick'`). The loop runs 60 ticks a second times the speed, at most 12 ms of ticking per frame, and owes at
    most a second of ticks when the machine falls behind (`frame.tps` says what was reached).
  - `src/sim/worker.js`: the Web Worker (four lines); `tools/node-worker.mjs` runs it in a Node thread.
  - Deviations from the plan: a command's power is named `power` (the message's own kind is `type`); positions are
  x, y only; no territory yet (listed in `docs/ui-todo.md`). Added the same day: herds and bodies in `area`,
  and `frame.overlays` (fires, storms, weather, plague, caravans, travellers; at most 4 a second).
- **Review** (an independent read of the slice): found that a `call` naming `__proto__` as its village could set a
  law on `Object.prototype` (and so on every village); also an area resent for changes out of view, a loop that
  stopped silently on an error, log lines that could be lost after a trim, a terrain mirror wrong past 256 kinds,
  a stale `tps`. All fixed, each with a test.
- **Tested** (`tests/cloud-simhost.test.js`, 12 tests): the host runs the same game as ticking it directly,
  commands included; a save written through the host loads through it and continues identically; frames send the
  id list only when it changes, every log line once and in order, the whole terrain first and then only changed
  chunks; the camera's contents are copies the game never sees; unknown calls, queries and messages are refused;
  60 ticks a second at 1×, at most a second owed after a stall, no timers after a pause; in a real worker thread
  the save equals the in-thread host's, positions arrive as a typed array and half a second at 1× runs 15–40 ticks
  in at least 10 frames; prototype keys and unknown villages are refused; an error while running pauses the game;
  a change out of view does not resend the area. Full suite: 350 passed. Hashes unchanged (nothing in the game changed).
- **Measured on the grown world** (in this thread, cloud machine): a frame costs 0.36 ms (p50), 0.58 ms (p95);
  a frame with a 128×80 camera's contents about 5 ms (p95 7 ms), at most 4 times a second. Loading the save and
  the first frame (the whole terrain) took 2.5 s.
- **Not done (home):** slice 3 (the UI's direct reads moved to the mirror and queries) and slice 4 (browser
  frame times with and without the worker). Nothing is playable through the worker until then.
