// Strudel's editor registers sliderWithID(); a bare transpiler call to slider(...) needs it. We provide it here.
// Moving a Slider module updates the live value directly (no re-evaluation needed), and the code panel rewrites in step.
export const sliderValues = {};
export function makeSliderWithID(ref) {
  return (id, value) => {
    sliderValues[id] = value;
    return ref(() => sliderValues[id]);
  };
}
