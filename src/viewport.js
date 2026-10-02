import { installMovementKeys } from './keyboard.js';
export const MIN_ZOOM = .001, MAX_ZOOM = 3;
const clamp = value => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
export function project(point, camera) {
  return { x: point.x * camera.zoom + camera.x, y: point.y * camera.zoom + camera.y };
}
export function zoomAt(camera, factor, anchor) {
  const zoom = clamp(camera.zoom * factor);
  return { zoom, x: anchor.x - (anchor.x - camera.x) * zoom / camera.zoom, y: anchor.y - (anchor.y - camera.y) * zoom / camera.zoom };
}
export function installViewport(element, onChange, options = {}) {
  let camera = { x: 0, y: 0, zoom: 1 };
  const enabled = options.enabled ?? (() => true);
  const host = element.ownerDocument.defaultView;
  const requestFrame = options.requestFrame ?? host.requestAnimationFrame.bind(host);
  const cancelFrame = options.cancelFrame ?? host.cancelAnimationFrame.bind(host);
  const reduceMotion = options.reducedMotion ?? (() => host.matchMedia('(prefers-reduced-motion: reduce)').matches);
  let frame = null, target = null, lastTime = null, keyboard = null;
  function stopMotion() {
    if (frame !== null) cancelFrame(frame);
    frame = null; target = null; lastTime = null;
  }
  function tick(time) {
    frame = null;
    if (!target) return;
    const dt = lastTime === null ? 16 : Math.min(50, time - lastTime);
    lastTime = time;
    if (target.kind === 'center') {
      target.elapsed += dt;
      const progress = Math.min(1, target.elapsed / 360);
      const eased = 1 - (1 - progress) ** 3;
      commit({ zoom:target.zoom, x:target.start.x + (target.x - target.start.x) * eased,
        y:target.start.y + (target.y - target.start.y) * eased });
      if (progress === 1) { target = null; lastTime = null; }
      else frame = requestFrame(tick);
      return;
    }
    const remaining = Math.log(target.zoom / camera.zoom);
    const settled = Math.abs(remaining) < .0002;
    const zoom = settled ? target.zoom : camera.zoom * Math.exp(remaining * (1 - Math.exp(-dt / 75)));
    commit({ zoom, x:target.anchor.x - target.world.x * zoom, y:target.anchor.y - target.world.y * zoom });
    if (settled) { target = null; lastTime = null; }
    else frame = requestFrame(tick);
  }
  function smoothZoom(factor, anchor) {
    if (reduceMotion()) { stopMotion(); commit(zoomAt(camera, factor, anchor)); return; }
    if (target?.kind === 'center') stopMotion();
    target = { kind:'zoom', zoom:clamp((target?.zoom ?? camera.zoom) * factor), anchor,
      world:{ x:(anchor.x - camera.x) / camera.zoom, y:(anchor.y - camera.y) / camera.zoom } };
    if (frame === null) frame = requestFrame(tick);
  }
  const pointers = new Map();
  const local = e => { const r = element.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const midpoint = points => ({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 });
  const distance = points => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  function commit(next) {
    camera = next;
    element.dataset.zoom = String(camera.zoom);
    onChange(camera);
  }
  const api = {
    stop() { stopMotion(); keyboard?.stop(); pointers.clear(); element.classList.remove('dragging'); },
    fit(bounds) {
      stopMotion(); const width=element.clientWidth, height=element.clientHeight;
      const zoom=clamp(Math.min((width-120)/Math.max(1,bounds.width),(height-260)/Math.max(1,bounds.height)));
      commit({zoom,x:width/2-bounds.x*zoom,y:(height-140)/2-bounds.y*zoom});
    },
    get camera() { return camera; }, get targetZoom() { return target?.zoom ?? camera.zoom; },
    zoom(factor, point = { x: element.clientWidth / 2, y: element.clientHeight / 2 }) { smoothZoom(factor, point); },
    center(point, reset = false, animate = false) {
      stopMotion();
      const zoom = reset ? 1 : camera.zoom;
      const next = { zoom, x:element.clientWidth / 2 - point.x * zoom, y:element.clientHeight / 2 - point.y * zoom };
      if (!animate || reduceMotion() || reset || Math.hypot(next.x - camera.x, next.y - camera.y) < .5) {
        commit(next); return;
      }
      target = { kind:'center', ...next, start:{ ...camera }, elapsed:0 };
      frame = requestFrame(tick);
    },
  };
  element.addEventListener('wheel', event => {
    if (!enabled() || event.target.closest('#details')) return;
    event.preventDefault();
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
    api.zoom(Math.exp(-Math.max(-300, Math.min(300, pixels)) * .002), local(event));
  }, { passive: false });
  element.addEventListener('pointerdown', event => {
    if (!enabled() || event.button > 0 || event.target.closest('button, #details')) return;
    stopMotion();
    pointers.set(event.pointerId, local(event));
    element.setPointerCapture?.(event.pointerId);
    element.classList.add('dragging');
  });
  element.addEventListener('pointermove', event => {
    if (!enabled() || !pointers.has(event.pointerId)) return;
    const before = [...pointers.values()];
    stopMotion();
    pointers.set(event.pointerId, local(event));
    const after = [...pointers.values()];
    if (after.length === 1) {
      commit({ ...camera, x: camera.x + after[0].x - before[0].x, y: camera.y + after[0].y - before[0].y });
    } else {
      const oldMid = midpoint(before), newMid = midpoint(after);
      const next = zoomAt(camera, distance(before) > 1 ? distance(after) / distance(before) : 1, oldMid);
      commit({ ...next, x: next.x + newMid.x - oldMid.x, y: next.y + newMid.y - oldMid.y });
    }
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) element.addEventListener(type, event => {
    pointers.delete(event.pointerId);
    if (!pointers.size) element.classList.remove('dragging');
  });
  element.addEventListener('keydown', event => {
    if (!enabled() || event.target !== element) return;
    const delta = { ArrowLeft: [50, 0], ArrowRight: [-50, 0], ArrowUp: [0, 50], ArrowDown: [0, -50] }[event.key];
    if (delta) { event.preventDefault(); stopMotion(); commit({ ...camera, x: camera.x + delta[0], y: camera.y + delta[1] }); }
    else if (event.key === '+' || event.key === '=') { event.preventDefault(); api.zoom(1.2); }
    else if (event.key === '-') { event.preventDefault(); api.zoom(1 / 1.2); }
  });
  keyboard = installMovementKeys(element, (x,y) => {
    stopMotion(); commit({ ...camera, x:camera.x-x, y:camera.y-y });
  }, { enabled, requestFrame, cancelFrame });
  return api;
}
