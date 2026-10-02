import { defaultKinshipTitle } from './kinship.js';
export const RELATIONS = [
  { code: 'f', short: '父', label: '爸爸' }, { code: 'm', short: '母', label: '妈妈' },
  { code: 'ob', short: '兄', label: '哥哥' }, { code: 'lb', short: '弟', label: '弟弟' },
  { code: 'os', short: '姐', label: '姐姐' }, { code: 'ls', short: '妹', label: '妹妹' },
  { code: 's', short: '子', label: '儿子' }, { code: 'd', short: '女', label: '女儿' },
  { code: 'h', short: '夫', label: '丈夫' }, { code: 'w', short: '妻', label: '妻子' },
];
const relationMap = new Map(RELATIONS.map(r => [r.code, r]));
const names = {
  f:'爸爸', m:'妈妈', ob:'哥哥', lb:'弟弟', os:'姐姐', ls:'妹妹', s:'儿子', d:'女儿',
  'f,f':'爷爷', 'f,m':'奶奶', 'm,f':'外公', 'm,m':'外婆',
  'f,ob':'伯伯', 'f,lb':'叔叔', 'f,os':'姑姑', 'f,ls':'姑姑',
  'm,ob':'舅舅', 'm,lb':'舅舅', 'm,os':'姨妈', 'm,ls':'小姨',
  'ob,s':'侄子', 'lb,s':'侄子', 'ob,d':'侄女', 'lb,d':'侄女',
  'os,s':'外甥', 'ls,s':'外甥', 'os,d':'外甥女', 'ls,d':'外甥女',
  's,s':'孙子', 's,d':'孙女', 'd,s':'外孙', 'd,d':'外孙女',
  'f,f,f':'曾祖父', 'f,f,m':'曾祖母', 'f,m,f':'曾外祖父', 'f,m,m':'曾外祖母',
  'f,f,ob':'伯公', 'f,f,lb':'叔公', 'f,f,os':'姑奶奶', 'f,f,ls':'姑奶奶',
  'f,m,ob':'舅爷爷', 'f,m,lb':'舅爷爷', 'f,m,os':'姨奶奶', 'f,m,ls':'姨奶奶',
};
export function initialState() {
  return { version: 1, people: [{ id: 'me', parentId: null, relation: null, title: '我' }] };
}
export function validateState(state) {
  if (!state || state.version !== 1 || !Array.isArray(state.people) || !state.people.length)
    throw new Error('本地数据格式或版本无法识别。');
  const map = new Map();
  for (const person of state.people) {
    if (!person || typeof person.id !== 'string' || !person.id || map.has(person.id) ||
        typeof person.title !== 'string' || !person.title.trim())
      throw new Error('人物编号重复或资料不完整。');
    if (person.alias !== undefined && (typeof person.alias !== 'string' || person.alias.length > 80))
      throw new Error('备注名必须是最多 80 个字符的文字。');
    if (person.sourcePaths !== undefined && (!Array.isArray(person.sourcePaths) || person.sourcePaths.some(path => !Array.isArray(path) || path.some(code => !relationMap.has(code)))))
      throw new Error('人物的原始关系记录无效。');
    map.set(person.id, person);
  }
  const roots = state.people.filter(p => p.parentId === null);
  if (roots.length !== 1 || roots[0].id !== 'me' || roots[0].relation !== null)
    throw new Error('关系树必须有唯一的“我”作为起点。');
  for (const person of state.people) {
    if (person.id !== 'me' && (!map.has(person.parentId) || !relationMap.has(person.relation)))
      throw new Error('人物的上级或关系无效。');
  }
  const checked = new Set(['me']);
  for (const person of state.people) {
    let cursor = person;
    const chain = new Set();
    while (!checked.has(cursor.id)) {
      if (chain.has(cursor.id)) throw new Error('关系中存在循环。');
      chain.add(cursor.id);
      cursor = map.get(cursor.parentId);
    }
    for (const id of chain) checked.add(id);
  }
  return state;
}
export function pathCodes(state, id) {
  const map = new Map(state.people.map(p => [p.id, p]));
  let person = map.get(id);
  if (!person) throw new Error('找不到这位亲人。');
  const codes = [], visited = new Set();
  while (person.parentId !== null) {
    if (visited.has(person.id)) throw new Error('关系中存在循环。');
    visited.add(person.id);
    codes.push(person.relation);
    person = map.get(person.parentId);
    if (!person) throw new Error('人物的上级不存在。');
  }
  return codes.reverse();
}
export function pathText(codes) {
  return ['我', ...codes.map(c => relationMap.get(c)?.label ?? c)].join(' → ');
}
export function suggestTitle(codes) {
  if (!codes.length) return '我';
  const full = names[codes.join(',')];
  if (full) return full;
  return defaultKinshipTitle(codes);
}
export function addPerson(state, parentId, relation, title, id) {
  validateState(state);
  if (!state.people.some(p => p.id === parentId)) throw new Error('当前人物已不存在，请重新选择。');
  if (!relationMap.has(relation)) throw new Error('请选择关系。');
  if (typeof title !== 'string' || !title.trim()) throw new Error('请填写称呼。');
  const next = { ...state, version: 1, people: [...state.people, { id, parentId, relation, title: title.trim() }] };
  return validateState(next);
}
export function displayName(person) {
  return person.alias?.trim() || person.title;
}
export function updateAlias(state, id, alias) {
  validateState(state);
  if (!state.people.some(person => person.id === id)) throw new Error('当前人物已不存在，请重新选择。');
  if (typeof alias !== 'string' || alias.length > 80) throw new Error('备注名必须是最多 80 个字符的文字。');
  const value = alias.trim();
  return validateState({ ...state, people: state.people.map(person => {
    if (person.id !== id) return person;
    const next = { ...person };
    if (value) next.alias = value;
    else delete next.alias;
    return next;
  }) });
}
export function subtreePeople(state, id) {
  validateState(state);
  if (!state.people.some(person => person.id === id)) throw new Error('当前人物已不存在，请重新选择。');
  const children = new Map();
  for (const person of state.people) {
    if (!children.has(person.parentId)) children.set(person.parentId, []);
    children.get(person.parentId).push(person.id);
  }
  const ids = new Set([id]), pending = [id];
  for (let index = 0; index < pending.length; index++) {
    for (const child of children.get(pending[index]) || []) { ids.add(child); pending.push(child); }
  }
  return state.people.filter(person => ids.has(person.id));
}
export function deleteSubtree(state, id) {
  if (id === 'me') throw new Error('“我”不能删除。');
  const ids = new Set(subtreePeople(state, id).map(person => person.id));
  return validateState({ ...state, people: state.people.filter(person => !ids.has(person.id)) });
}
