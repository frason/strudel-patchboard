// Two Strudel evaluators live in the page: the audio player's and the offline one that draws pictures and finds the sounds a piece needs. They share the same Strudel
// classes, and every evaluate() first points the shared names (stack, note, .p, setcpm ...) at itself. So two evaluations must never overlap: one at a time.
let chain = Promise.resolve();
export function exclusive(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}
