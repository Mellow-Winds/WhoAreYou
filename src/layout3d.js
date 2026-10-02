import { validateState } from './domain.js';
const hash = text => { let value=2166136261; for(const char of text) value=Math.imul(value^char.charCodeAt(0),16777619); return (value>>>0)/4294967296; };
export function layout3D(state) {
  validateState(state);
  const children=new Map(state.people.map(p=>[p.id,[]]));
  for(const person of state.people) if(person.parentId) children.get(person.parentId).push(person);
  const positions=new Map([['me',{x:0,y:0,z:0}]]), queue=[{id:'me',depth:0,theta:0,span:Math.PI*2}];
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
