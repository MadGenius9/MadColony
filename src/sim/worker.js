// The simulation's Web Worker (docs/proposals/sim-worker.md, slice 2). The UI starts it with
//   new Worker(new URL('../sim/worker.js', import.meta.url), { type: 'module' })
// and talks to it with the messages listed in simhost.js. postMessage copies every message, so the host does
// not copy them first (copy: false); the movers' positions and terrain are moved, not copied (transfer).
// In Node, tools/node-worker.mjs provides `self` and runs this file in a worker thread (tests).
import { createSimHost } from './simhost.js';

const host = createSimHost({ post: (m, transfer) => self.postMessage(m, transfer), copy: false });
self.onmessage = (e) => host.receive(e.data);
