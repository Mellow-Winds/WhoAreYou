// The active view owns shortcuts even when a toolbar button has focus.
export function installMovementKeys(surface, move, { enabled = () => true, mode = '2d', requestFrame, cancelFrame } = {}) {
  const document = surface.ownerDocument, host = document.defaultView;
  requestFrame ??= host.requestAnimationFrame.bind(host);
  cancelFrame ??= host.cancelAnimationFrame.bind(host);
  const keys = new Set(), listeners = [];
  const directions = mode === '3d'
    ? { KeyW:[0,0,1], KeyS:[0,0,-1], KeyA:[-1,0,0], KeyD:[1,0,0], Space:[0,1,0], ShiftLeft:[0,-1,0] }
    : { KeyW:[0,-1,0], KeyS:[0,1,0], KeyA:[-1,0,0], KeyD:[1,0,0] };
  const keyCode = event => event.code || ({w:'KeyW',a:'KeyA',s:'KeyS',d:'KeyD',' ':'Space'}[event.key.toLowerCase()] ?? (event.key==='Shift' && event.location===1 ? 'ShiftLeft' : ''));
  let frame = null, last = null;
  function eligible(target) {
    return enabled() && !document.hidden && target?.closest &&
      !document.querySelector('dialog[open]') &&
      !target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), #details');
  }
  function stop() {
    keys.clear(); last = null;
    if (frame !== null) cancelFrame(frame);
    frame = null;
  }
  function tick(time) {
    frame = null;
    if (!eligible(document.activeElement)) { stop(); return; }
    const dt = last === null ? 16 : Math.min(40, time-last); last = time;
    let x = 0, y = 0, z = 0;
    for (const key of keys) { x += directions[key][0]; y += directions[key][1]; z += directions[key][2]; }
    const length = Math.hypot(x,y,z);
    if (length) move(x/length * dt * .35, y/length * dt * .35, z/length * dt * .35);
    if (keys.size) frame = requestFrame(tick);
    else last = null;
  }
  function listen(target, type, callback) { target.addEventListener(type, callback); listeners.push(() => target.removeEventListener(type, callback)); }
  listen(host, 'keydown', event => {
    const key = keyCode(event);
    if (!directions[key] || event.ctrlKey || event.altKey || event.metaKey || event.isComposing || !eligible(event.target)) return;
    event.preventDefault(); keys.add(key);
    if (frame === null) frame = requestFrame(tick);
  });
  listen(host, 'keyup', event => {
    const key=keyCode(event);
    if (keys.has(key)) event.preventDefault();
    keys.delete(key); if (!keys.size) stop();
  });
  listen(host, 'blur', stop);
  listen(surface, 'pointerdown', event => {
    if (eligible(event.target) && !event.target.closest('button')) surface.focus({preventScroll:true});
  });
  listen(document, 'visibilitychange', stop);
  listen(document, 'focusin', event => { if (!eligible(event.target)) stop(); });
  return { stop, dispose() { stop(); for (const remove of listeners) remove(); } };
}
