// Runs src/sim/worker.js in a Node worker thread, as a browser runs it in a Web Worker (tests and tools):
//   new Worker(new URL('../tools/node-worker.mjs', import.meta.url))
// It gives the worker file the two things it uses from a browser worker: self.postMessage and self.onmessage.
import { parentPort } from 'node:worker_threads';

globalThis.self = {
  postMessage: (m, transfer) => parentPort.postMessage(m, transfer),
  set onmessage(f) { parentPort.on('message', (data) => f({ data })); },
};
await import('../src/sim/worker.js');
