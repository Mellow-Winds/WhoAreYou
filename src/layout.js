import { familyRoot } from './domain.js';
// Each branch owns an angular sector; generations move outward from "me".
function familyLayout(state, minWidth = 600, minHeight = 600, rootId = 'me') {
  const children = new Map(state.people.map(p => [p.id, []]));
  state.people.forEach(p => { if (p.parentId !== null) children.get(p.parentId).push(p.id); });
  const depths = new Map([[rootId, 0]]), order = [], stack = [rootId];
  while (stack.length) {
    const id = stack.pop(); order.push(id);
    for (const child of [...children.get(id)].reverse()) {
      depths.set(child, depths.get(id) + 1); stack.push(child);
    }
  }
  const weights = new Map();
  for (const id of [...order].reverse()) {
    weights.set(id, Math.max(1, children.get(id).reduce((sum, child) => sum + weights.get(child), 0)));
  }
  const angles = new Map([[rootId, -Math.PI / 2]]);
  const sectors = new Map([[rootId, [-Math.PI * 1.5, Math.PI / 2]]]);
  const rings = new Map();
  for (const id of order) {
    const [start, end] = sectors.get(id);
    let cursor = start;
    for (const child of children.get(id)) {
      const span = (end - start) * weights.get(child) / weights.get(id);
      sectors.set(child, [cursor, cursor + span]);
      angles.set(child, cursor + span / 2);
      cursor += span;
      const depth = depths.get(child);
      if (!rings.has(depth)) rings.set(depth, []);
      rings.get(depth).push(angles.get(child));
    }
  }
  let step = 150;
  // Space every ring enough to keep both the star and its label separate.
  for (const [depth, ring] of rings) {
    if (ring.length < 2) continue;
    ring.sort((a, b) => a - b);
    for (let i = 0; i < ring.length; i++) {
      const gap = (i === ring.length - 1 ? ring[0] + Math.PI * 2 : ring[i + 1]) - ring[i];
      step = Math.max(step, 150 / (2 * Math.sin(gap / 2)) / depth);
    }
  }
  const maxDepth = Math.max(...depths.values());
  const diameter = 2 * maxDepth * step + 240;
  const width = Math.max(minWidth, diameter), height = Math.max(minHeight, diameter);
  const positions = new Map();
  for (const id of order) {
    const radius = depths.get(id) * step;
    positions.set(id, { x: width / 2 + Math.cos(angles.get(id)) * radius, y: height / 2 + Math.sin(angles.get(id)) * radius });
  }
  return { positions, width, height };
}

export function layoutTree(state,minWidth=600,minHeight=600){
  const roots=state.people.filter(p=>p.parentId===null).sort((a,b)=>Number(b.id==='me')-Number(a.id==='me'));
  if(roots.length===1)return familyLayout(state,minWidth,minHeight);
  const positions=new Map();let width=0,height=minHeight;
  for(const root of roots){
    const family={people:state.people.filter(p=>familyRoot(state,p.id).id===root.id)};
    const layout=familyLayout(family,minWidth,minHeight,root.id);
    for(const [id,p] of layout.positions)positions.set(id,{x:p.x+width,y:p.y});
    width+=layout.width+180;height=Math.max(height,layout.height);
  }
  return {positions,width:width-180,height};
}
