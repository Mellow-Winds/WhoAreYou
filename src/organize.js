import { validateState, pathCodes, displayName, familyRoot, migrateState } from './domain.js';
import { kinshipResult } from './kinship.js';
const clone = value => structuredClone(value);
const uniquePaths = paths => [...new Map(paths.map(path => [path.join(','), path])).values()];
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export const fingerprint = state => JSON.stringify(canonical(migrateState(state)));
function descendants(state, id) {
  const found = new Set([id]);
  let changed = true;
  while (changed) { changed = false; for (const person of state.people) if (found.has(person.parentId) && !found.has(person.id)) { found.add(person.id); changed = true; } }
  return found;
}
function scanContext(state) {
  const paths=new Map(),byPath=new Map();
  for(const person of state.people){const path=pathCodes(state,person.id),key=JSON.stringify([familyRoot(state,person.id).id,path]);paths.set(person.id,path);if(!byPath.has(key))byPath.set(key,[]);byPath.get(key).push(person);}
  return {paths,byPath};
}
export function suggestionsFor(state, person, context=scanContext(state)) {
  if(person.parentId===null)return null;
  const key=path=>JSON.stringify([familyRoot(state,person.id).id,path]);
  const originalPath=context.paths.get(person.id),inferred=kinshipResult(originalPath),branch=descendants(state,person.id);
  const alternatives=[...new Map([originalPath,...inferred.paths.filter(path=>path.length<=originalPath.length)].map(path=>[path.join(','),path])).values()];
  const options=[];
  for(const path of alternatives)for(const target of context.byPath.get(key(path))||[])if(!branch.has(target.id))options.push({key:'existing:'+target.id,kind:'existing',personId:target.id,path,title:displayName(target)});
  for(const path of alternatives.filter(path=>path.length>0&&path.length<originalPath.length))for(const parent of context.byPath.get(key(path.slice(0,-1)))||[]){
    if(!branch.has(parent.id))options.push({key:'new:'+parent.id+':'+path.at(-1),kind:'new',parentId:parent.id,relation:path.at(-1),path});
  }
  const unique=[...new Map(options.map(option=>[option.key,option])).values()];
  return unique.length?{personId:person.id,originalPath,ambiguous:inferred.ambiguous,options:unique}:null;
}export async function scanTree(state, { signal, onProgress = () => {}, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
  validateState(state); const results = [], context=scanContext(state);
  for (let index = 0; index < state.people.length; index++) {
    if (signal?.aborted) throw new DOMException('扫描已取消', 'AbortError');
    const suggestion = suggestionsFor(state, state.people[index], context);
    if (suggestion) results.push(suggestion);
    onProgress(index + 1, state.people.length);
    // Yield after each person: long trees must not trap the cancel control.
    await yieldControl();
  }
  if (signal?.aborted) throw new DOMException('扫描已取消', 'AbortError');
  return results;
}
export function applyDecisions(state, decisions) {
  validateState(state);
  const selected = decisions.filter(d => d.optionKey && d.optionKey !== 'keep');
  if (!selected.length) throw new Error('请先选择需要应用的整理建议。');
  const touched = new Set(), context=scanContext(state), targetTitles=new Map();
  const operations = selected.map(decision => {
    if (touched.has(decision.personId)) throw new Error('同一人物有相互冲突的整理选择。');
    touched.add(decision.personId);
    const person = state.people.find(p => p.id === decision.personId);
    const option = person && suggestionsFor(state, person, context)?.options.find(o => o.key === decision.optionKey);
    if (!option) throw new Error('整理建议已变化，请重新扫描。');
    if(option.kind==='existing'){
      const target=state.people.find(p=>p.id===option.personId),chosen=decision.titleChoice==='source'?person:target;
      const title=JSON.stringify([chosen.title,chosen.nickname ?? chosen.alias ?? null,chosen.name ?? null]);
      if(targetTitles.has(target.id)&&targetTitles.get(target.id)!==title)throw new Error('同一存留人物的称呼选择冲突，请调整。');
      targetTitles.set(target.id,title);
    }
    return { ...decision, option };
  });
  // Dependent mutations need another scan; do not guess which choice takes priority.
  for (const operation of operations) {
    const dependency = operation.option.kind === 'existing' ? operation.option.personId : operation.option.parentId;
    if (touched.has(dependency)) throw new Error('所选建议互相依赖，请保留其中一项，应用后重新扫描。');
  }
  const next = clone(state), originalPaths = new Map(state.people.map(p => [p.id, pathCodes(state, p.id)]));
  const remap = new Map(), changes = [];
  for (const operation of operations) {
    const source = next.people.find(p => p.id === operation.personId), option = operation.option;
    if (option.kind === 'new') {
      source.parentId = option.parentId; source.relation = option.relation;
      changes.push({ kind:'shorten', personId:source.id });
    } else {
      const target = next.people.find(p => p.id === option.personId);
      if (displayName(source) !== displayName(target) && !['source','target'].includes(operation.titleChoice)) throw new Error('请选择合并后保留的称呼。');
      const previousTarget = clone(target);
      const record = clone(source);
      target.mergeHistory = [...(target.mergeHistory || []), { ...record, originalPath:originalPaths.get(source.id) }];
      target.sourcePaths = uniquePaths([...(target.sourcePaths || []), ...(source.sourcePaths || []), originalPaths.get(source.id)]);
      if (operation.titleChoice === 'source' && (target.title !== source.title || target.alias !== source.alias || target.nickname !== source.nickname || target.name !== source.name)) {
        target.mergeHistory.push({ ...previousTarget, originalPath:originalPaths.get(target.id) });
        target.title = source.title;
        for(const field of ['name','nickname']){if(source[field]!==undefined)target[field]=source[field];else if(field!=='name'||target.parentId!==null)delete target[field];}
        if (source.alias !== undefined) target.alias = source.alias;
        else delete target.alias;
      }
      for (const child of next.people) if (child.parentId === source.id) child.parentId = target.id;
      next.people = next.people.filter(p => p.id !== source.id);
      remap.set(source.id, target.id); changes.push({ kind:'merge', personId:source.id, targetId:target.id });
    }
  }
  validateState(next);
  for (const person of next.people) {
    const before = originalPaths.get(person.id), after = pathCodes(next, person.id);
    if (before.join(',') !== after.join(',')) person.sourcePaths = uniquePaths([...(person.sourcePaths || []), before]);
  }
  return { state:validateState(next), remap, changes };
}
