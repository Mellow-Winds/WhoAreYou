import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Window } from 'happy-dom';
import { createFirstPersonView, installLookControls } from '../src/first-person.js';
import { installMovementKeys } from '../src/keyboard.js';

function fixture(t,options={}) {
  const w=new Window(),surface=w.document.createElement('div');surface.tabIndex=0;w.document.body.append(surface);surface.focus();
  Object.defineProperties(surface,{clientWidth:{value:800},clientHeight:{value:600}});
  const captured=new Set();surface.setPointerCapture=id=>captured.add(id);surface.hasPointerCapture=id=>captured.has(id);surface.releasePointerCapture=id=>captured.delete(id);
  const camera=new THREE.PerspectiveCamera(48,800/600,1,100000);camera.position.set(380,260,700);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  const view=createFirstPersonView(camera,{height:()=>600,...options});let enabled=true;
  const look=installLookControls(surface,view,{enabled:()=>enabled});
  const pointer=(type,x,y,{id=1,target=surface,...fields}={})=>target.dispatchEvent(new w.PointerEvent(type,{pointerId:id,clientX:x,clientY:y,button:0,pointerType:'mouse',bubbles:true,cancelable:true,...fields}));
  t.after(()=>{look.dispose();return w.happyDOM.close();});
  return {w,surface,camera,view,look,pointer,captured,disable(){enabled=false;look.stop();}};
}

test('drag turns in place with a level horizon, bounded pitch and no modifier change',t=>{
  const f=fixture(t),position=f.camera.position.clone(),before=f.camera.getWorldDirection(new THREE.Vector3());
  f.pointer('pointerdown',0,0,{shiftKey:true});f.pointer('pointermove',100,40,{shiftKey:true});f.pointer('pointerup',100,40);
  assert.ok(f.camera.position.equals(position));assert.ok(f.camera.getWorldDirection(new THREE.Vector3()).distanceTo(before)>.1);
  const angles=new THREE.Euler().setFromQuaternion(f.camera.quaternion,'YXZ');assert.ok(Math.abs(angles.z)<1e-10);
  f.view.rotate(0,-100000);assert.ok(f.camera.getWorldDirection(new THREE.Vector3()).y<=Math.sin(85*Math.PI/180)+1e-10);
  f.view.rotate(0,100000);assert.ok(f.camera.getWorldDirection(new THREE.Vector3()).y>=-Math.sin(85*Math.PI/180)-1e-10);
  assert.ok(f.camera.position.equals(position));assert.equal(f.camera.fov,48);assert.equal(f.captured.size,0);
});

test('walk after turning follows the new view; simultaneous drag and W never creates an orbit',t=>{
  const f=fixture(t),callbacks=new Map();let id=0;
  const keyboard=installMovementKeys(f.surface,(x,y,z)=>f.view.move(x,y,z),{mode:'3d',requestFrame:cb=>{callbacks.set(++id,cb);return id;},cancelFrame:id=>callbacks.delete(id)});t.after(()=>keyboard.dispose());
  f.surface.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'w',code:'KeyW',bubbles:true}));
  f.pointer('pointerdown',0,0);f.pointer('pointermove',100,20);
  const position=f.camera.position.clone(),direction=f.camera.getWorldDirection(new THREE.Vector3()),orientation=f.camera.quaternion.clone();
  const callback=[...callbacks.values()][0];callbacks.clear();callback(16);
  assert.ok(f.camera.position.clone().sub(position).distanceTo(direction.multiplyScalar(5.6))<1e-8);assert.ok(f.camera.quaternion.equals(orientation));
  f.surface.dispatchEvent(new f.w.KeyboardEvent('keyup',{key:'w',code:'KeyW',bubbles:true}));f.pointer('pointerup',100,20);assert.equal(callbacks.size,0);
});

test('zoom changes field of view only, accumulates smoothly, and move interrupts it at the current value',t=>{
  const f=fixture(t),position=f.camera.position.clone(),orientation=f.camera.quaternion.clone();
  const wheel=new f.w.WheelEvent('wheel',{deltaY:-50,bubbles:true,cancelable:true});f.surface.dispatchEvent(wheel);assert.equal(wheel.defaultPrevented,true);
  f.view.tick(16);assert.ok(f.camera.fov<48&&f.camera.fov>18);const partial=f.camera.fov;
  f.view.zoom(1.2);f.view.tick(220);assert.ok(f.camera.fov<partial);assert.ok(f.camera.position.equals(position));assert.ok(f.camera.quaternion.equals(orientation));
  f.view.zoom(2);f.view.tick(16);const interrupted=f.camera.fov;f.view.move(0,0,10);f.view.tick(1000);assert.equal(f.camera.fov,interrupted);
  f.view.zoom(1000);f.view.tick(220);assert.equal(f.camera.fov,18);f.view.zoom(.00001);f.view.tick(220);assert.equal(f.camera.fov,90);
});

test('navigation is a single translation; later turns remain in place and manual input cancels the destination',t=>{
  const f=fixture(t),point=new THREE.Vector3(1200,200,400);f.view.focus(point);f.view.tick(100);
  const midway=f.camera.position.clone();f.view.rotate(50,0);f.view.tick(1000);assert.ok(f.camera.position.equals(midway));
  f.view.focus(point,false);f.camera.updateMatrixWorld();const projected=point.clone().project(f.camera);assert.ok(Math.abs(projected.x)<1e-8&&Math.abs(projected.y)<1e-8);
  const arrived=f.camera.position.clone();f.view.rotate(-100,-30);assert.ok(f.camera.position.equals(arrived));
  f.view.focus(new THREE.Vector3());f.view.tick(16);f.view.move(20,0,0);const walked=f.camera.position.clone();f.view.tick(1000);assert.ok(f.camera.position.equals(walked));
});

test('selection or deletion interrupts 3D camera motion at its current position and field of view',t=>{
  const f=fixture(t);
  f.view.focus(new THREE.Vector3(1200,100,0));f.view.tick(80);
  const position=f.camera.position.clone(),orientation=f.camera.quaternion.clone();
  f.view.interrupt();f.view.tick(1000);
  assert.ok(f.camera.position.equals(position));assert.ok(f.camera.quaternion.equals(orientation));
  f.view.zoom(1.8);f.view.tick(40);const fov=f.camera.fov;
  f.view.interrupt();f.view.tick(1000);
  assert.equal(f.camera.fov,fov);assert.ok(f.camera.position.equals(position));
});

test('full view fits a bounding sphere in wide and narrow screens with reserved card space',t=>{
  for(const aspect of [1.5,.5]){
    const f=fixture(t,{inset:()=>180});f.camera.aspect=aspect;f.camera.updateProjectionMatrix();f.view.rotate(120,50);f.view.fit(400,false);f.camera.updateMatrixWorld();
    for(const point of [[400,0,0],[-400,0,0],[0,400,0],[0,-400,0],[0,0,400],[0,0,-400]]){
      const p=new THREE.Vector3(...point).project(f.camera);assert.ok(Math.abs(p.x)<1&&Math.abs(p.y)<1&&p.z>=-1&&p.z<=1,JSON.stringify({aspect,p}));
    }
  }
});

test('tap selects a person while dragging over a button blocks the synthetic click',t=>{
  const f=fixture(t),button=f.w.document.createElement('button');f.surface.append(button);let clicks=0;button.addEventListener('click',()=>clicks++);
  const click=()=>button.dispatchEvent(new f.w.MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));
  f.pointer('pointerdown',10,10,{target:button});f.pointer('pointermove',12,12,{target:button});f.pointer('pointerup',12,12,{target:button});click();assert.equal(clicks,1);
  f.pointer('pointerdown',10,10,{target:button});f.pointer('pointermove',90,50,{target:button});f.pointer('pointerup',90,50);click();assert.equal(clicks,1);
  button.click();assert.equal(clicks,2);assert.equal(f.captured.size,0);
});

test('blur, cancellation, inactive mode and open dialogs stop look gestures; disposal removes listeners',t=>{
  const f=fixture(t),orientation=f.camera.quaternion.clone();f.pointer('pointerdown',0,0);f.w.dispatchEvent(new f.w.Event('blur'));f.pointer('pointermove',100,100);assert.ok(f.camera.quaternion.equals(orientation));
  f.pointer('pointerdown',0,0);f.pointer('pointercancel',0,0);f.pointer('pointermove',100,100);assert.ok(f.camera.quaternion.equals(orientation));
  const dialog=f.w.document.createElement('dialog');f.w.document.body.append(dialog);dialog.showModal();f.pointer('pointerdown',0,0);f.pointer('pointermove',100,100);assert.ok(f.camera.quaternion.equals(orientation));dialog.close();
  f.disable();f.pointer('pointerdown',0,0);f.pointer('pointermove',100,100);assert.ok(f.camera.quaternion.equals(orientation));assert.equal(f.captured.size,0);
  f.look.dispose();f.view.zoom(1);f.pointer('pointermove',100,100);assert.ok(f.camera.quaternion.equals(orientation));
});

test('two fingers directly zoom and pan; reduced motion navigation and zoom are immediate',t=>{
  const f=fixture(t,{reducedMotion:()=>true}),orientation=f.camera.quaternion.clone();
  f.pointer('pointerdown',0,0,{id:1,pointerType:'touch'});f.pointer('pointerdown',100,0,{id:2,pointerType:'touch'});
  f.pointer('pointermove',180,40,{id:2,pointerType:'touch'});assert.ok(f.camera.fov<48);assert.ok(f.camera.quaternion.equals(orientation));
  f.pointer('pointerup',0,0,{id:1,pointerType:'touch'});f.pointer('pointerup',180,40,{id:2,pointerType:'touch'});assert.equal(f.captured.size,0);
  const before=f.camera.position.clone();f.view.focus(new THREE.Vector3(1000,0,0));assert.ok(!f.camera.position.equals(before));
  const arrived=f.camera.position.clone();f.view.zoom(1.2);const fov=f.camera.fov;f.view.tick(1000);assert.equal(f.camera.fov,fov);assert.ok(f.camera.position.equals(arrived));
});
