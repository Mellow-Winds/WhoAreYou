import { defaultKinshipTitle } from './kinship.js';
export const KIN_RELATIONS = [
  { code: 'f', short: '父', label: '爸爸' }, { code: 'm', short: '母', label: '妈妈' },
  { code: 'ob', short: '兄', label: '哥哥' }, { code: 'lb', short: '弟', label: '弟弟' },
  { code: 'os', short: '姐', label: '姐姐' }, { code: 'ls', short: '妹', label: '妹妹' },
  { code: 's', short: '子', label: '儿子' }, { code: 'd', short: '女', label: '女儿' },
  { code: 'h', short: '夫', label: '丈夫' }, { code: 'w', short: '妻', label: '妻子' },
];
export const SOCIAL_RELATIONS = [{code:'friend',short:'朋友',label:'朋友'},{code:'coworker',short:'同事',label:'同事'},{code:'buddy',short:'搭子',label:'搭子'}];
export const RELATIONS = [...KIN_RELATIONS,...SOCIAL_RELATIONS];
export const isSocial = code => SOCIAL_RELATIONS.some(r=>r.code===code);
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
  return { version: 2, socialEdges: [], people: [{ id: 'me', parentId: null, relation: null, title: '我' }] };
}
export function validateState(state) {
  if (!state || ![1,2].includes(state.version) || !Array.isArray(state.people) || !state.people.length)
    throw new Error('本地数据格式或版本无法识别。');
  const map = new Map();
  for (const person of state.people) {
    if (!person || typeof person.id !== 'string' || !person.id || map.has(person.id) ||
        typeof person.title !== 'string' || !person.title.trim())
      throw new Error('人物编号重复或资料不完整。');
    for (const field of ['name','nickname']) if(person[field] !== undefined && (typeof person[field] !== 'string' || person[field].length > 80)) throw new Error('姓名和昵称最多 80 个字符。');
    if (person.alias !== undefined && (typeof person.alias !== 'string' || person.alias.length > 80))
      throw new Error('备注名必须是最多 80 个字符的文字。');
    if (person.sourcePaths !== undefined && (!Array.isArray(person.sourcePaths) || person.sourcePaths.some(path => !Array.isArray(path) || path.some(code => !relationMap.has(code)||isSocial(code)))))
      throw new Error('人物的原始关系记录无效。');
    map.set(person.id, person);
  }
  const roots = state.people.filter(p => p.parentId === null);
  if (!roots.some(p=>p.id==='me') || roots.some(p=>p.relation!==null)) throw new Error('关系树起点无效。');
  if (state.version===1 && roots.length!==1) throw new Error('旧资料必须以“我”为唯一根节点。');
  if (state.version===2) {
    if(!Array.isArray(state.socialEdges)) throw new Error('社交连接无效。');
    const linked=new Set();
    for(const edge of state.socialEdges){
      if(!edge||typeof edge!=='object')throw new Error('社交连接无效。');
      const root=map.get(edge.to);
      if(edge.from!=='me'||!root||root.id==='me'||root.parentId!==null||!isSocial(edge.relation)||linked.has(root.id)) throw new Error('社交连接无效。');
      if(!root.name?.trim()) throw new Error('朋友、同事和搭子必须填写姓名。');
      linked.add(root.id);
    }
    if(roots.length!==linked.size+1) throw new Error('亲属树缺少社交连接。');
  }
  for (const person of state.people) {
    if (person.parentId !== null && (!map.has(person.parentId) || !relationMap.has(person.relation) || isSocial(person.relation)))
      throw new Error('人物的上级或关系无效。');
  }
  const checked = new Set(roots.map(p=>p.id));
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
export function pathText(codes, rootName='我') {
  return [rootName, ...codes.map(c => relationMap.get(c)?.label ?? c)].join(' → ');
}
export function suggestTitle(codes) {
  if (!codes.length) return '我';
  const full = names[codes.join(',')];
  if (full) return full;
  return defaultKinshipTitle(codes);
}
export function addPerson(state, parentId, relation, title, id, name='') {
  state=migrateState(state);
  if (!state.people.some(p => p.id === parentId)) throw new Error('当前人物已不存在，请重新选择。');
  if (!relationMap.has(relation)) throw new Error('请选择关系。');
  if (typeof title !== 'string' || !title.trim()) throw new Error('请填写称呼。');
  if(isSocial(relation)&&parentId!=='me') throw new Error('请从“我”添加朋友、同事或搭子。');
  if(typeof name!=='string'||name.length>80)throw new Error('姓名最多 80 个字符。');
  const social=isSocial(relation);
  const next = { ...state, people: [...state.people, { id, parentId:social?null:parentId, relation:social?null:relation, title: title.trim(), ...(name.trim()?{name:name.trim()}:{}) }], socialEdges:social?[...state.socialEdges,{from:'me',to:id,relation}]:state.socialEdges };
  return validateState(next);
}
export function migrateState(state) {
  validateState(state);
  if(state.version===2)return state;
  return validateState({...state,version:2,socialEdges:[],people:state.people.map(person=>{
    const {alias,...rest}=person;return {...rest,...(alias?.trim()?{nickname:alias.trim()}:{})};
  })});
}
export function familyRoot(state,id){
  const map=new Map(state.people.map(p=>[p.id,p]));let p=map.get(id);if(!p)throw new Error('找不到这位亲人。');const seen=new Set();
  while(p?.parentId!==null){if(!p||seen.has(p.id))throw new Error('关系路径无效。');seen.add(p.id);p=map.get(p.parentId);}return p;
}
export function rootLabel(state,id){const root=familyRoot(state,id);return root.id==='me'?'我':root.name;}
export function personPathText(state,id){return pathText(pathCodes(state,id),rootLabel(state,id));}
export function graphEdges(state){return [...state.people.filter(p=>p.parentId!==null).map(p=>({from:p.parentId,to:p.id})),...(state.socialEdges||[])];}
export function displayName(person,state) {
  let title=person.nickname?.trim()||person.alias?.trim()||person.title;
  if(state&&person.parentId!==null){const root=familyRoot(state,person.id);if(root.id!=='me')title=root.name+'的'+title;}
  return person.name?.trim()?person.name.trim()+'（'+title+'）':title;
}
export function updateProfile(state,id,name,nickname){
  state=migrateState(state);
  if(!state.people.some(p=>p.id===id))throw new Error('当前人物已不存在，请重新选择。');
  if(typeof name!=='string'||typeof nickname!=='string'||name.length>80||nickname.length>80)throw new Error('姓名和昵称最多 80 个字符。');
  return validateState({...state,people:state.people.map(person=>{
    if(person.id!==id)return person;
    const next={...person};
    delete next.alias;
    for(const [field,value] of Object.entries({name,nickname})){
      if(value.trim())next[field]=value.trim();else delete next[field];
    }
    return next;
  })});
}
export function updateAlias(state,id,alias){return updateProfile(state,id,state.people.find(p=>p.id===id)?.name||'',alias);}
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
  return validateState({ ...state, ...(state.socialEdges?{socialEdges:state.socialEdges.filter(edge=>!ids.has(edge.to))}:{}), people: state.people.filter(person => !ids.has(person.id)) });
}
