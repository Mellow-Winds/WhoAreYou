import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import * as THREE from 'three';
import { installMovementKeys } from '../src/keyboard.js';
import { installViewport } from '../src/viewport.js';
import { moveCamera } from '../src/scene3d.js';

function fixture(t) {
  const w = new Window(), surface = w.document.createElement('div');
  surface.tabIndex=0; w.document.body.append(surface); surface.focus();
  const callbacks=new Map();let id=0,time=0;
  const frames={requestFrame:cb=>{callbacks.set(++id,cb);return id;},cancelFrame:id=>callbacks.delete(id)};
  const step=()=>{time+=16;const pending=[...callbacks.values()];callbacks.clear();for(const cb of pending)cb(time);};
  const key=(type,value,target=surface,extra={})=>{const event=new w.KeyboardEvent(type,{key:value,bubbles:true,cancelable:true,...extra});target.dispatchEvent(event);return event;};
  t.after(()=>w.happyDOM.close());return {w,surface,callbacks,frames,step,key};
}
test('WASD moves continuously, normalizes diagonals and stops on release or blur',t=>{
  const f=fixture(t),moves=[];const keyboard=installMovementKeys(f.surface,(x,y)=>moves.push([x,y]),f.frames);
  assert.equal(f.key('keydown','W').defaultPrevented,true);f.step();f.step();assert.equal(moves.length,2);assert.deepEqual(moves[0],[0,-5.6]);
  f.key('keydown','d');f.key('keydown','d');f.step();assert.ok(Math.abs(Math.hypot(...moves.at(-1))-5.6)<1e-10);
  f.key('keyup','w');f.step();assert.deepEqual(moves.at(-1),[5.6,0]);
  f.key('keyup','d');assert.equal(f.callbacks.size,0);
  f.key('keydown','a');f.w.dispatchEvent(new f.w.Event('blur'));assert.equal(f.callbacks.size,0);
  keyboard.dispose();f.key('keydown','s');assert.equal(f.callbacks.size,0);
});

test('movement remains available after clicking a view toolbar button',t=>{
  const f=fixture(t),moves=[],toolbar=f.w.document.createElement('button');f.w.document.body.append(toolbar);
  const keyboard=installMovementKeys(f.surface,(x,y)=>moves.push([x,y]),f.frames);toolbar.focus();
  assert.equal(f.key('keydown','d',toolbar).defaultPrevented,true);f.step();assert.deepEqual(moves,[[5.6,0]]);
  keyboard.dispose();
});
test('typing, shortcuts, modal dialogs and disabled views never move the canvas',t=>{
  const f=fixture(t);let enabled=true,count=0;
  const keyboard=installMovementKeys(f.surface,()=>count++,{...f.frames,enabled:()=>enabled});
  for(const tag of ['input','textarea','select','div']){
    const field=f.w.document.createElement(tag);if(tag==='div')field.contentEditable='true';f.surface.append(field);field.focus();
    assert.equal(f.key('keydown','w',field).defaultPrevented,false);assert.equal(f.callbacks.size,0);
  }
  f.surface.focus();f.key('keydown','w',f.surface,{ctrlKey:true});f.key('keydown','a',f.surface,{isComposing:true});assert.equal(f.callbacks.size,0);
  const dialog=f.w.document.createElement('dialog');f.w.document.body.append(dialog);dialog.showModal();f.key('keydown','d');assert.equal(f.callbacks.size,0);dialog.close();
  const outside=f.w.document.createElement('button');f.w.document.body.append(outside);outside.focus();
  f.surface.dispatchEvent(new f.w.PointerEvent('pointerdown',{bubbles:true}));assert.equal(f.w.document.activeElement,f.surface);
  enabled=false;f.key('keydown','s');assert.equal(f.callbacks.size,0);
  enabled=true;f.key('keydown','w');enabled=false;f.step();assert.equal(count,0);assert.equal(f.callbacks.size,0);keyboard.dispose();
});
test('2D keyboard movement preserves scale and interrupts automatic centering',t=>{
  const f=fixture(t),viewport=installViewport(f.surface,()=>{},{...f.frames,reducedMotion:()=>false});
  viewport.center({x:500,y:500},false,true);f.step();const before={...viewport.camera};
  f.key('keydown','d');f.step();const current={...viewport.camera};f.step();
  assert.ok(viewport.camera.x<current.x);assert.equal(viewport.camera.y,current.y);assert.equal(viewport.camera.zoom,before.zoom);
  viewport.stop();assert.equal(f.callbacks.size,0);
});
test('3D forward follows the view, sideways follows screen right and rise follows world up',()=>{
  for(const position of [[0,0,500],[380,260,700],[-500,0,0]]) {
    const camera=new THREE.PerspectiveCamera(48,800/600,1,100000),target=new THREE.Vector3();camera.position.set(...position);camera.lookAt(target);camera.updateMatrixWorld();
    const orientation=camera.quaternion.clone(),distance=camera.position.distanceTo(target),start=camera.position.clone(),direction=camera.getWorldDirection(new THREE.Vector3());
    moveCamera(camera,target,0,0,50);assert.ok(camera.position.clone().sub(start).distanceTo(direction.multiplyScalar(50))<1e-8);
    moveCamera(camera,target,0,0,-50);assert.ok(camera.position.distanceTo(start)<1e-8);
    const right=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0);moveCamera(camera,target,30,0,0);
    assert.ok(camera.position.clone().sub(start).distanceTo(right.multiplyScalar(30))<1e-8);
    const before=camera.position.clone();moveCamera(camera,target,0,40,0);assert.ok(camera.position.clone().sub(before).distanceTo(new THREE.Vector3(0,40,0))<1e-8);
    assert.ok(Math.abs(camera.position.distanceTo(target)-distance)<1e-8);assert.ok(camera.quaternion.equals(orientation));assert.equal(camera.fov,48);
  }
});

test('3D physical keys support forward, rise and only left Shift, with normalized combined speed',t=>{
  const f=fixture(t),moves=[];
  const keyboard=installMovementKeys(f.surface,(...movement)=>moves.push(movement),{...f.frames,mode:'3d'});
  // Physical key code works even if the keyboard layout produces a different letter.
  f.key('keydown','z',f.surface,{code:'KeyW'});f.step();assert.deepEqual(moves.at(-1),[0,0,5.6]);
  f.key('keydown',' ',f.surface,{code:'Space'});f.key('keydown','d',f.surface,{code:'KeyD'});f.step();
  assert.ok(moves.at(-1).every(value=>value>0));assert.ok(Math.abs(Math.hypot(...moves.at(-1))-5.6)<1e-8);
  f.key('keyup','z',f.surface,{code:'KeyW'});f.key('keyup','d',f.surface,{code:'KeyD'});f.key('keyup',' ',f.surface,{code:'Space'});assert.equal(f.callbacks.size,0);
  f.key('keydown','Shift',f.surface,{code:'ShiftRight',location:2});assert.equal(f.callbacks.size,0);
  f.key('keydown','Shift',f.surface,{code:'ShiftLeft',location:1});f.step();assert.deepEqual(moves.at(-1),[0,-5.6,0]);
  f.key('keydown',' ',f.surface,{code:'Space'});const count=moves.length;f.step();assert.equal(moves.length,count);
  keyboard.dispose();assert.equal(f.callbacks.size,0);
});

test('only the active mode moves and pitched combinations keep a constant world speed',t=>{
  const f=fixture(t),camera=new THREE.PerspectiveCamera(48,1,1,10000),target=new THREE.Vector3();
  camera.position.set(100,300,500);camera.lookAt(target);let mode='2d';
  const viewport=installViewport(f.surface,()=>{},{...f.frames,enabled:()=>mode==='2d'});
  const keyboard=installMovementKeys(f.surface,(x,y,z)=>moveCamera(camera,target,x,y,z),{...f.frames,mode:'3d',enabled:()=>mode==='3d'});
  const origin=camera.position.clone();f.key('keydown','w');f.step();assert.notEqual(viewport.camera.y,0);assert.ok(camera.position.equals(origin));
  viewport.stop();mode='3d';const before={...viewport.camera};
  f.key('keydown','w');f.key('keydown',' ',f.surface,{code:'Space'});f.step();
  assert.deepEqual(viewport.camera,before);assert.ok(Math.abs(camera.position.distanceTo(origin)-5.6)<1e-8);
  keyboard.stop();mode='2d';f.step();assert.equal(f.callbacks.size,0);keyboard.dispose();viewport.stop();
});
