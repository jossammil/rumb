// A draggable, keyboard-adjustable divider that sets --cmp-size on its host:
// beside the map on wide screens, below it on narrow ones.

export function setupSplitter(bar, host, onResize) {
  const narrow = matchMedia("(max-width: 760px)");
  let size = 45,
    mobileSize = 55;
  function update(value) {
    value = Math.min(75, Math.max(30, value));
    if (narrow.matches) mobileSize = value;
    else size = value;
    host.style.setProperty("--cmp-size", value + "%");
    bar.setAttribute("aria-valuenow", String(Math.round(value)));
    bar.setAttribute("aria-orientation", narrow.matches ? "horizontal" : "vertical");
    onResize();
  }
  bar.setAttribute("aria-valuemin", "30");
  bar.setAttribute("aria-valuemax", "75");
  narrow.onchange = () => update(narrow.matches ? mobileSize : size);
  narrow.onchange();
  bar.onpointerdown = (ev) => bar.setPointerCapture(ev.pointerId);
  bar.onpointermove = (ev) => {
    if (!bar.hasPointerCapture(ev.pointerId)) return;
    const r = host.getBoundingClientRect();
    update(
      100 * (narrow.matches ? (r.bottom - ev.clientY) / r.height : (r.right - ev.clientX) / r.width),
    );
  };
  bar.onkeydown = (ev) => {
    const keys = narrow.matches ? ["ArrowDown", "ArrowUp"] : ["ArrowRight", "ArrowLeft"];
    if (!keys.includes(ev.key)) return;
    ev.preventDefault();
    update((narrow.matches ? mobileSize : size) + (ev.key === keys[1] ? 5 : -5));
  };
}
