export function ancestorChain(state, id) {
  const people = new Map(state.people.map(person => [person.id, person]));
  const chain = [], visited = new Set();
  let current = people.get(id);
  if (!current) throw new Error('找不到这位亲人。');
  while (current) {
    if (visited.has(current.id)) throw new Error('关系中存在循环。');
    visited.add(current.id); chain.push(current);
    if (current.parentId === null) break;
    current = people.get(current.parentId);
    if (!current) throw new Error('人物的上级不存在。');
  }
  return chain.reverse();
}
