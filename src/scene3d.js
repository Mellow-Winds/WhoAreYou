import * as THREE from 'three';
import { layout3D } from './layout3d.js';
import { installMovementKeys } from './keyboard.js';
import { createFirstPersonView, installLookControls, moveView } from './first-person.js';
export function moveCamera(camera, target, x, y, forward) {
  target.add(moveView(camera,x,y,forward));
}
export function createScene3D(host, surface, nodes, { inset = () => 0, onError = () => {}, onReady = () => {} } = {}) {
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1,2)); renderer.setClearColor(0x000000);
  renderer.domElement.className='space-canvas'; host.append(renderer.domElement);
  const scene=new THREE.Scene(), camera=new THREE.PerspectiveCamera(48,1,1,100000);
  camera.position.set(380,260,700);
  camera.lookAt(0,0,0);
  let active=false,lost=false,disposed=false,frame=null,last=0,time=0,layoutTween=null;
  let state=null,points=null,lines=null,geometry=null,lineGeometry=null,positions=new Map(),targetPositions=new Map(),selected=null,path=new Set(),radius=100;
  const reduce=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const callbacks=new AbortController();
  const view=createFirstPersonView(camera,{inset,height:()=>surface.clientHeight,reducedMotion:reduce});
  const enabled=()=>active&&!lost&&!disposed;
  const look=installLookControls(surface,view,{enabled});
  const keyboard=installMovementKeys(surface,(x,y,z)=>view.move(x,y,z),{mode:'3d',enabled});
  const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,vertexColors:true,
    uniforms:{time:{value:0},pixelRatio:{value:renderer.getPixelRatio()},motion:{value:1}},
    vertexShader:'attribute float phase; varying vec3 tint; uniform float time; uniform float pixelRatio; uniform float motion; void main(){tint=color;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);gl_PointSize=pixelRatio*(21.0+motion*4.0*sin(time*1.96+phase));}',
    fragmentShader:'varying vec3 tint; void main(){float r=length(gl_PointCoord-0.5)*2.0;if(r>1.0)discard;float a=exp(-r*r*7.0);gl_FragColor=vec4(tint,a);}' });
  const lineMaterial=new THREE.LineBasicMaterial({vertexColors:true,transparent:true,opacity:.65,depthWrite:false});
  const starsGeometry=new THREE.BufferGeometry(),starPositions=[];
  for(let i=0;i<600;i++){const a=i*2.399963,y=1-2*(i+.5)/600,r=Math.sqrt(1-y*y);starPositions.push(Math.cos(a)*r*18000,y*18000,Math.sin(a)*r*18000);}
  starsGeometry.setAttribute('position',new THREE.Float32BufferAttribute(starPositions,3));
  const starsMaterial=new THREE.PointsMaterial({color:0x53617b,size:1.4,sizeAttenuation:false,transparent:true,opacity:.6,depthWrite:false,depthTest:false});const background=new THREE.Points(starsGeometry,starsMaterial);background.renderOrder=-10;scene.add(background);
  function resize(){const w=Math.max(1,surface.clientWidth),h=Math.max(1,surface.clientHeight);camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false);}
  function focus(id,animate=true){
    const point=positions.get(id);if(point)view.focus(point,animate);
  }
  function fit(animate=true){
    resize();view.fit(radius,animate);
  }
  function zoom(factor){view.zoom(factor);}
  function update(next,{preservePositions=false}={}){
    state=next;const layout=layout3D(state);radius=layout.radius;camera.far=Math.max(100000,radius*60);camera.updateProjectionMatrix();targetPositions=new Map([...layout.positions].map(([id,p])=>[id,new THREE.Vector3(p.x,p.y,p.z)]));
    if(preservePositions)for(const [id]of targetPositions)if(positions.has(id))targetPositions.set(id,positions.get(id).clone());
    const starts=new Map();for(const person of state.people)starts.set(person.id,(positions.get(person.id)||positions.get(person.parentId)||targetPositions.get(person.id)).clone());
    positions=starts;layoutTween=preservePositions?null:{starts:new Map([...starts].map(([id,p])=>[id,p.clone()])),elapsed:0};
    if(points){scene.remove(points,lines);geometry.dispose();lineGeometry.dispose();}
    geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(state.people.length*3),3));
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(state.people.length*3),3));geometry.setAttribute('phase',new THREE.Float32BufferAttribute(state.people.map((_,i)=>i*.61),1));
    points=new THREE.Points(geometry,material);points.frustumCulled=false;scene.add(points);
    lineGeometry=new THREE.BufferGeometry();lineGeometry.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array((state.people.length-1)*6),3));lineGeometry.setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array((state.people.length-1)*6),3));
    lines=new THREE.LineSegments(lineGeometry,lineMaterial);lines.frustumCulled=false;scene.add(lines);
    paint(0);if(reduce())paint(500);
  }
  function paint(dt){
    if(!state)return;
    if(layoutTween){layoutTween.elapsed+=dt;const p=reduce()?1:Math.min(1,layoutTween.elapsed/450),ease=1-(1-p)**3;
      for(const [id,target]of targetPositions)positions.get(id).lerpVectors(layoutTween.starts.get(id),target,ease);if(p===1)layoutTween=null;}
    const buffer=geometry.attributes.position,colors=geometry.attributes.color,lineBuffer=lineGeometry.attributes.position,lineColors=lineGeometry.attributes.color;
    const blend=reduce()?1:1-Math.exp(-dt/100);
    let edge=0;state.people.forEach((person,i)=>{
      const p=positions.get(person.id);buffer.setXYZ(i,p.x,p.y,p.z);
      const color=new THREE.Color(person.id===selected?0xffffff:path.has(person.id)?0xbdd9ff:person.id==='me'?0xe5eeff:0x94a5c4);colors.setXYZ(i,THREE.MathUtils.lerp(colors.getX(i),color.r,blend),THREE.MathUtils.lerp(colors.getY(i),color.g,blend),THREE.MathUtils.lerp(colors.getZ(i),color.b,blend));
      if(person.parentId){const parent=positions.get(person.parentId);lineBuffer.setXYZ(edge,parent.x,parent.y,parent.z);lineBuffer.setXYZ(edge+1,p.x,p.y,p.z);
        const c=new THREE.Color(path.has(person.id)?0xa7c7ff:0x39465c);lineColors.setXYZ(edge,c.r,c.g,c.b);lineColors.setXYZ(edge+1,c.r,c.g,c.b);edge+=2;}
    });
    for(const attr of [buffer,colors,lineBuffer,lineColors])attr.needsUpdate=true;
  }
  function projectNodes(){
    camera.updateMatrixWorld();const width=surface.clientWidth,height=surface.clientHeight,occupied=[];
    const projected=state.people.map(person=>({person,p:positions.get(person.id).clone().project(camera)}));
    projected.sort((a,b)=>Number(b.person.id===selected)-Number(a.person.id===selected)||Number(path.has(b.person.id))-Number(path.has(a.person.id))||a.p.z-b.p.z);
    for(const {person,p}of projected){const node=nodes(person.id);if(!node)continue;
      const visible=p.z>=-1&&p.z<=1&&Math.abs(p.x)<1.15&&Math.abs(p.y)<1.15;node.hidden=!visible;if(!visible)continue;
      const x=(p.x+1)*width/2,y=(1-p.y)*height/2;node.style.left=(x-60)+'px';node.style.top=(y-18)+'px';node.style.zIndex=String(10+Math.round((1-p.z)*100000));
      const overlaps=occupied.some(q=>Math.abs(x-q.x)<115&&Math.abs(y-q.y)<34);
      node.classList.toggle('label-muted',overlaps&&!path.has(person.id)&&person.id!==selected);if(!overlaps)occupied.push({x,y});
    }
  }
  function tick(now){frame=null;if(!active||lost||disposed)return;const dt=last?Math.min(40,now-last):16;last=now;time+=dt/1000;
    view.tick(dt);paint(dt);material.uniforms.time.value=time;material.uniforms.motion.value=reduce()?0:1;
    projectNodes();background.position.copy(camera.position);renderer.render(scene,camera);frame=requestAnimationFrame(tick);
  }
  function setActive(value){active=value;keyboard.stop();look.stop();view.interrupt();last=0;if(frame!==null)cancelAnimationFrame(frame);frame=null;if(value&&!lost&&!disposed){resize();frame=requestAnimationFrame(tick);}}
  renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();lost=true;keyboard.stop();look.stop();view.interrupt();if(frame!==null)cancelAnimationFrame(frame);frame=null;onError('3D 显示中断，可切换到 2D；资料已保留。');},{signal:callbacks.signal});
  renderer.domElement.addEventListener('webglcontextrestored',()=>{lost=false;onReady();setActive(active);},{signal:callbacks.signal});
  renderer.debug.onShaderError=()=>{lost=true;setActive(false);onError('3D 绘图初始化失败，请切换到 2D；资料已保留。');};
  resize();
  return {update,focus,fit,zoom,resize,setActive,interrupt(){view.interrupt();},select(id,included){selected=id;path=included;},dispose(){disposed=true;setActive(false);keyboard.dispose();look.dispose();callbacks.abort();geometry?.dispose();lineGeometry?.dispose();material.dispose();lineMaterial.dispose();starsGeometry.dispose();starsMaterial.dispose();renderer.dispose();renderer.domElement.remove();}};
}
