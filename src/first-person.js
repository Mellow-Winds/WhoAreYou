import * as THREE from 'three';

const PITCH_LIMIT = THREE.MathUtils.degToRad(85);
export function moveView(camera, x, y, forward) {
  camera.updateMatrixWorld();
  const offset = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0).multiplyScalar(x)
    .addScaledVector(new THREE.Vector3(0,1,0),y)
    .addScaledVector(camera.getWorldDirection(new THREE.Vector3()),forward);
  if(offset.lengthSq()>1e-12) offset.setLength(Math.hypot(x,y,forward));
  camera.position.add(offset);
  return offset;
}

export function createFirstPersonView(camera, { inset = () => 0, height = () => 600, reducedMotion = () => false } = {}) {
  let tween=null, framingDistance=Math.max(180,camera.position.length());
  const angles=new THREE.Euler(0,0,0,'YXZ');
  const interrupt=()=>{tween=null;};
  function navigate(position,animate=true,distance=framingDistance) {
    framingDistance=distance;
    tween={kind:'position',start:camera.position.clone(),position:position.clone(),elapsed:0};
    if(!animate||reducedMotion()){camera.position.copy(position);tween=null;}
  }
  function destination(point,distance) {
    camera.updateMatrixWorld();
    const forward=camera.getWorldDirection(new THREE.Vector3());
    const up=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1);
    return point.clone().addScaledVector(forward,-distance)
      .addScaledVector(up,-Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*distance*inset()/Math.max(1,height()));
  }
  function rotate(x,y) {
    interrupt();angles.setFromQuaternion(camera.quaternion,'YXZ');
    angles.y-=x*.004;angles.x=THREE.MathUtils.clamp(angles.x-y*.004,-PITCH_LIMIT,PITCH_LIMIT);angles.z=0;
    camera.quaternion.setFromEuler(angles);camera.updateMatrixWorld();
  }
  function pan(x,y) {
    camera.updateMatrixWorld();
    const units=2*framingDistance*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))/Math.max(1,height());
    camera.position.addScaledVector(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0),-x*units)
      .addScaledVector(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1),y*units);
  }
  function nextFov(factor,from=camera.fov) {
    return THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(from/2))/factor)),18,90);
  }
  return {
    interrupt,rotate,
    move(x,y,z){interrupt();moveView(camera,x,y,z);},
    pan(x,y){interrupt();pan(x,y);},
    gesture(factor,x,y){interrupt();camera.fov=nextFov(factor);camera.updateProjectionMatrix();pan(x,y);},
    focus(point,animate=true){navigate(destination(point,framingDistance),animate);},
    fit(radius,animate=true){
      const usable=Math.max(.35,1-(inset()+70)/Math.max(1,height()));
      const angle=Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*Math.min(1,camera.aspect));
      const distance=radius/Math.sin(angle)/usable*1.2;
      navigate(destination(new THREE.Vector3(),distance),animate,distance);
    },
    zoom(factor){
      const fov=nextFov(factor,tween?.kind==='zoom'?tween.fov:camera.fov);
      tween={kind:'zoom',startFov:camera.fov,fov,elapsed:0};
      if(reducedMotion()){camera.fov=fov;camera.updateProjectionMatrix();tween=null;}
    },
    tick(dt){
      if(!tween)return;
      tween.elapsed+=dt;const progress=reducedMotion()?1:Math.min(1,tween.elapsed/(tween.kind==='zoom'?220:360));
      const ease=1-(1-progress)**3;
      if(tween.kind==='zoom'){camera.fov=THREE.MathUtils.lerp(tween.startFov,tween.fov,ease);camera.updateProjectionMatrix();}
      else camera.position.lerpVectors(tween.start,tween.position,ease);
      if(progress===1)tween=null;
    },
  };
}

export function installLookControls(surface, view, { enabled = () => true } = {}) {
  const document=surface.ownerDocument,host=document.defaultView,pointers=new Map(),listeners=[];
  let suppressClick=false;
  const eligible=event=>enabled()&&!document.hidden&&!document.querySelector('dialog[open]')&&
    !event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),#details');
  const capture=id=>{if(!surface.hasPointerCapture?.(id))surface.setPointerCapture?.(id);};
  function release(id){if(surface.hasPointerCapture?.(id))surface.releasePointerCapture?.(id);}
  function stop(){const ids=[...pointers.keys()];pointers.clear();for(const id of ids)release(id);surface.classList.remove('dragging');}
  function listen(target,type,callback,options){target.addEventListener(type,callback,options);listeners.push(()=>target.removeEventListener(type,callback,options));}
  listen(surface,'pointerdown',event=>{
    if(!eligible(event)||(event.pointerType!=='touch'&&event.button!==0&&event.button!==2))return;
    suppressClick=false;view.interrupt();
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY,dragged:false,button:event.button});
    if(!event.target.closest('button')){surface.focus({preventScroll:true});capture(event.pointerId);}
    surface.classList.add('dragging');
  },true);
  listen(document,'pointermove',event=>{
    const pointer=pointers.get(event.pointerId);if(!pointer)return;
    if(!eligible(event)){stop();return;}
    const dx=event.clientX-pointer.x,dy=event.clientY-pointer.y;
    if(pointers.size>=2){
      const other=[...pointers.entries()].find(([id])=>id!==event.pointerId)[1];
      const before=Math.hypot(pointer.x-other.x,pointer.y-other.y),after=Math.hypot(event.clientX-other.x,event.clientY-other.y);
      view.gesture(before>1?after/before:1,dx/2,dy/2);for(const item of pointers.values())item.dragged=true;
      suppressClick=true;capture(event.pointerId);
    }else if(pointer.dragged||Math.hypot(event.clientX-pointer.startX,event.clientY-pointer.startY)>6){
      const x=pointer.dragged?dx:event.clientX-pointer.startX,y=pointer.dragged?dy:event.clientY-pointer.startY;
      pointer.dragged=true;suppressClick=true;capture(event.pointerId);
      if(pointer.button===2)view.pan(x,y);else view.rotate(x,y);
    }
    pointer.x=event.clientX;pointer.y=event.clientY;if(pointer.dragged)event.preventDefault();
  },{passive:false});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])listen(document,type,event=>{
    pointers.delete(event.pointerId);release(event.pointerId);if(!pointers.size)surface.classList.remove('dragging');
  });
  listen(surface,'click',event=>{if(suppressClick&&event.detail!==0){suppressClick=false;event.preventDefault();event.stopImmediatePropagation();}},true);
  listen(surface,'contextmenu',event=>{if(eligible(event))event.preventDefault();});
  listen(surface,'wheel',event=>{
    if(!eligible(event)||event.target.closest('button'))return;
    event.preventDefault();const pixels=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?surface.clientHeight:1);
    view.zoom(Math.exp(-Math.max(-300,Math.min(300,pixels))*.002));
  },{passive:false});
  listen(host,'blur',stop);listen(document,'visibilitychange',stop);
  listen(document,'focusin',event=>{if(!eligible(event))stop();});
  return {stop,dispose(){stop();for(const remove of listeners)remove();}};
}
