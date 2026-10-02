// Each branch owns an angular sector; generations move outward from "me".
export function layoutTree(state, minWidth = 600, minHeight = 600) {
  const children = new Map(state.people.map(p => [p.id, []]));
  state.people.forEach(p => { if (p.parentId !== null) children.get(p.parentId).push(p.id); });
  const depths = new Map([['me', 0]]), order = [], stack = ['me'];
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
  const angles = new Map([['me', -Math.PI / 2]]);
  const sectors = new Map([['me', [-Math.PI * 1.5, Math.PI / 2]]]);
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
