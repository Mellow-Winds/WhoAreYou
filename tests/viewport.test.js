import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { project, zoomAt, installViewport, MIN_ZOOM, MAX_ZOOM } from '../src/viewport.js';

test('zoom keeps the cursor world point fixed and clamps the scale', () => {
  const camera = { x: 30, y: -42, zoom: 1.4 }, anchor = { x: 210, y: 150 };
  const world = { x: (anchor.x - camera.x) / camera.zoom, y: (anchor.y - camera.y) / camera.zoom };
  const after = project(world, zoomAt(camera, 1.5, anchor));
  assert.ok(Math.abs(after.x - anchor.x) < 1e-8 && Math.abs(after.y - anchor.y) < 1e-8);
  assert.equal(zoomAt(camera, 100, anchor).zoom, MAX_ZOOM);
  assert.equal(zoomAt(camera, MIN_ZOOM / camera.zoom / 2, anchor).zoom, MIN_ZOOM);
});
test('pointer drag pans in both axes, cancel stops it, and controls do not initiate dragging', async () => {
  const w = new Window(), canvas = w.document.createElement('div');
  w.document.body.append(canvas);
  const controller = installViewport(canvas, () => {});
  const pointer = (type, x, y, id = 1, target = canvas) => target.dispatchEvent(new w.PointerEvent(type, { clientX:x, clientY:y, pointerId:id, button:0, bubbles:true }));
  pointer('pointerdown', 10, 20); pointer('pointermove', 90, 70);
  assert.deepEqual(controller.camera, { x:80, y:50, zoom:1 });
  pointer('pointermove', 0, 0);
  assert.deepEqual(controller.camera, { x:-10, y:-20, zoom:1 });
  pointer('pointercancel', 0, 0); pointer('pointermove', 200, 300);
  assert.deepEqual(controller.camera, { x:-10, y:-20, zoom:1 });
  const button = w.document.createElement('button'); canvas.append(button);
  pointer('pointerdown', 10, 10, 2, button); pointer('pointermove', 100, 100, 2);
  assert.deepEqual(controller.camera, { x:-10, y:-20, zoom:1 });
  await w.happyDOM.close();
});
test('two fingers zoom and move the midpoint; releasing one continues as pan', async () => {
  const w = new Window(), canvas = w.document.createElement('div');
  w.document.body.append(canvas);
  const controller = installViewport(canvas, () => {});
  const pointer = (type, x, y, id) => canvas.dispatchEvent(new w.PointerEvent(type, { clientX:x, clientY:y, pointerId:id, pointerType:'touch', button:0, bubbles:true }));
  pointer('pointerdown', 0, 0, 1); pointer('pointerdown', 100, 0, 2);
  pointer('pointermove', 200, 0, 2);
  assert.equal(controller.camera.zoom, 2);
  assert.deepEqual(project({ x:50, y:0 }, controller.camera), { x:100, y:0 });
  pointer('pointerup', 200, 0, 2); pointer('pointermove', 30, 40, 1);
  assert.equal(controller.camera.x, 30); assert.equal(controller.camera.y, 40);
  await w.happyDOM.close();
});


test('smooth zoom interpolates between frames, accumulates input, anchors cursor and stops for drag',async()=>{
  const w=new Window(), canvas=w.document.createElement('div'); w.document.body.append(canvas);
  let callback=null, frameId=0; const frames=[];
  const controller=installViewport(canvas,c=>frames.push({...c}),{
    requestFrame:cb=>{callback=cb;return ++frameId;},cancelFrame:()=>{callback=null;},reducedMotion:()=>false,
  });
  const anchor={x:210,y:150}; controller.zoom(2,anchor); assert.equal(controller.camera.zoom,1);
  let time=0; const step=()=>{const cb=callback;callback=null;cb(time+=16);}; step();
  assert.ok(controller.camera.zoom>1&&controller.camera.zoom<2);
  controller.zoom(1.2,anchor); assert.equal(controller.targetZoom,2.4);
  for(let n=0;callback&&n<100;n++)step();
  assert.equal(controller.camera.zoom,2.4); assert.ok(frames.length>10);
  for(const camera of frames) {
    const point=project(anchor,camera); assert.ok(Math.abs(point.x-anchor.x)<1e-8&&Math.abs(point.y-anchor.y)<1e-8);
  }
  controller.zoom(.5,anchor); step();
  canvas.dispatchEvent(new w.PointerEvent('pointerdown',{pointerId:1,button:0,clientX:10,clientY:10}));
  assert.equal(callback,null); const zoom=controller.camera.zoom;
  canvas.dispatchEvent(new w.PointerEvent('pointermove',{pointerId:1,clientX:50,clientY:60}));
  assert.equal(controller.camera.zoom,zoom);
  await w.happyDOM.close();
});

test('reduced motion zoom is immediate and wheel accepts fine continuous deltas',async()=>{
  const w=new Window(),canvas=w.document.createElement('div');w.document.body.append(canvas);
  const controller=installViewport(canvas,()=>{},{reducedMotion:()=>true});
  const wheel=new w.WheelEvent('wheel',{deltaY:1,cancelable:true});
  Object.defineProperties(wheel,{clientX:{value:100},clientY:{value:100}});
  canvas.dispatchEvent(wheel);
  assert.equal(controller.camera.zoom,Math.exp(-.002));
  assert.ok(Number.isFinite(controller.camera.x) && Number.isFinite(controller.camera.y));
  controller.zoom(100); assert.equal(controller.camera.zoom,MAX_ZOOM);
  await w.happyDOM.close();
});

function animatedViewport(t,reducedMotion=false) {
  const w=new Window(),canvas=w.document.createElement('div');w.document.body.append(canvas);t.after(()=>w.happyDOM.close());
  Object.defineProperties(canvas,{clientWidth:{value:800},clientHeight:{value:600}});
  const callbacks=new Map();let id=0,time=0;
  const controller=installViewport(canvas,()=>{},{requestFrame:cb=>{callbacks.set(++id,cb);return id;},cancelFrame:id=>callbacks.delete(id),reducedMotion:()=>reducedMotion});
  const step=()=>{const pending=[...callbacks.values()];callbacks.clear();for(const cb of pending)cb(time+=16);};
  const settle=()=>{for(let n=0;callbacks.size&&n<100;n++)step();assert.equal(callbacks.size,0);};
  return {w,canvas,controller,callbacks,step,settle};
}

test('person centering progresses across frames and retargets from its current position to the last selection',t=>{
  const {controller,step,settle}=animatedViewport(t);
  controller.center({x:800,y:0},false,true);assert.deepEqual(controller.camera,{x:0,y:0,zoom:1});
  step();assert.ok(controller.camera.x<0&&controller.camera.x>-400);assert.ok(controller.camera.y>0&&controller.camera.y<300);
  const current={...controller.camera};controller.center({x:0,y:600},false,true);assert.deepEqual(controller.camera,current);
  step();assert.ok(controller.camera.x>current.x&&controller.camera.y<current.y);
  settle();assert.deepEqual(controller.camera,{x:400,y:-300,zoom:1});
});

test('drag and wheel interrupt centering without returning to the abandoned person',t=>{
  const {w,canvas,controller,callbacks,step,settle}=animatedViewport(t);
  controller.center({x:800,y:0},false,true);step();const current={...controller.camera};
  canvas.dispatchEvent(new w.PointerEvent('pointerdown',{pointerId:1,button:0,clientX:10,clientY:10}));assert.equal(callbacks.size,0);
  canvas.dispatchEvent(new w.PointerEvent('pointermove',{pointerId:1,clientX:50,clientY:60}));
  assert.deepEqual(controller.camera,{...current,x:current.x+40,y:current.y+50});
  canvas.dispatchEvent(new w.PointerEvent('pointerup',{pointerId:1}));
  controller.center({x:0,y:600},false,true);step();const before={...controller.camera},anchor={x:200,y:150};
  const world={x:(anchor.x-before.x)/before.zoom,y:(anchor.y-before.y)/before.zoom};
  // happy-dom's WheelEvent omits client coordinates; supply the browser's event fields.
  const wheel=new w.WheelEvent('wheel',{deltaY:-40,cancelable:true});
  Object.defineProperties(wheel,{clientX:{value:anchor.x},clientY:{value:anchor.y}});
  canvas.dispatchEvent(wheel);
  settle();assert.equal(controller.camera.zoom,Math.exp(.08));
  const projected=project(world,controller.camera);assert.ok(Math.abs(projected.x-anchor.x)<1e-8&&Math.abs(projected.y-anchor.y)<1e-8);
});

test('centering cancels unfinished zoom and reduced motion centers immediately without scheduling',t=>{
  const normal=animatedViewport(t);normal.controller.zoom(2);normal.step();const zoom=normal.controller.camera.zoom;
  normal.controller.center({x:800,y:0},false,true);normal.settle();
  assert.equal(normal.controller.camera.zoom,zoom);assert.deepEqual(project({x:800,y:0},normal.controller.camera),{x:400,y:300});
  const reduced=animatedViewport(t,true);reduced.controller.center({x:800,y:0},false,true);
  assert.deepEqual(reduced.controller.camera,{zoom:1,x:-400,y:300});assert.equal(reduced.callbacks.size,0);
});
