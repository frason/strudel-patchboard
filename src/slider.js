// Strudel's editor registers sliderWithID(); a bare transpiler call to slider(...) needs it. We provide it here.
// Moving a Slider module updates the live value directly (no re-evaluation needed), and the code panel rewrites in step.
export const sliderValues = {};
// store: where the values live. The player uses sliderValues (so moving a Slider module changes the sound); the offline evaluator that draws pictures and
// lists the sounds a piece needs uses a store of its own, so asking "what would this play" can never reset a Slider you are holding.
export function makeSliderWithID(ref, store = sliderValues) {
  return (id, value) => {
    store[id] = value;
    return ref(() => store[id]);
  };
}
