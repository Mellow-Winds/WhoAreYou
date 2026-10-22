import { validateState, familyRoot } from './domain.js';
const hash = text => { let value=2166136261; for(const char of text) value=Math.imul(value^char.charCodeAt(0),16777619); return (value>>>0)/4294967296; };
function familyLayout(state,rootId) {
  const children=new Map(state.people.map(p=>[p.id,[]]));
  for(const person of state.people) if(person.parentId) children.get(person.parentId).push(person);
  const positions=new Map([[rootId,{x:0,y:0,z:0}]]), queue=[{id:rootId,depth:0,theta:0,span:Math.PI*2}];
  let radius=0;
  for(let index=0;index<queue.length;index++) {
    const current=queue[index], relatives=children.get(current.id);
    relatives.forEach((person,i)=>{
      const span=current.span/Math.max(1,relatives.length), theta=current.theta-current.span/2+span*(i+.5);
      const depth=current.depth+1;
      const r=depth*180+Math.max(0,relatives.length-6)*12;
      const elevation=(hash(person.id)-.5)*1.6;
      const position={x:Math.cos(theta)*Math.cos(elevation)*r,y:Math.sin(elevation)*r,z:Math.sin(theta)*Math.cos(elevation)*r};
      positions.set(person.id,position);radius=Math.max(radius,r);
      queue.push({id:person.id,depth,theta,span:Math.max(span,.3)});
    });
  }
  return {positions,radius:Math.max(radius,100)};
}

export function layout3D(state){
  validateState(state);
  const layouts=state.people.filter(p=>p.parentId===null).sort((a,b)=>Number(b.id==='me')-Number(a.id==='me')).map(root=>familyLayout({people:state.people.filter(p=>familyRoot(state,p.id).id===root.id)},root.id));
  const positions=new Map();let offset=0,previous=0,radius=100;
  layouts.forEach((layout,index)=>{
    if(index)offset+=previous+layout.radius+240;
    for(const [id,p] of layout.positions)positions.set(id,{x:p.x+offset,y:p.y,z:p.z});
    previous=layout.radius;radius=Math.max(radius,offset+layout.radius);
  });
  return {positions,radius};
}
