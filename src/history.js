import { displayName, pathCodes, pathText, migrateState, personPathText } from './domain.js';

export const HISTORY_LABELS = { add:'添加', alias:'资料', organize:'整理', delete:'删除', clear:'清除', restore:'恢复', checkpoint:'存档点' };
export function diffStates(before, after) {
  before=migrateState(before); after=migrateState(after);
  const oldPeople = new Map(before.people.map(person => [person.id, person]));
  const newPeople = new Map(after.people.map(person => [person.id, person]));
  const changes = [];
  for (const person of after.people) {
    const old = oldPeople.get(person.id);
    if (!old) { changes.push({ kind:'add', id:person.id, text:'添加「'+displayName(person,after)+'」 · '+personPathText(after,person.id) }); continue; }
    const oldPath=pathCodes(before,person.id),newPath=pathCodes(after,person.id);
    if (old.parentId !== person.parentId || old.relation !== person.relation || oldPath.join(',') !== newPath.join(',')) {
      const parentChanged=old.parentId!==person.parentId && oldPath.join(',')===newPath.join(',');
      const oldParent=oldPeople.get(old.parentId),newParent=newPeople.get(person.parentId);
      changes.push({ kind:'relation', id:person.id, text:'「'+displayName(person,after)+'」关系：'+
        (parentChanged?'上级「'+displayName(oldParent,before)+'」 → 「'+displayName(newParent,after)+'」':personPathText(before,person.id)+' → '+personPathText(after,person.id)) });
    }
    const oldSocial=before.socialEdges.find(e=>e.to===person.id),newSocial=after.socialEdges.find(e=>e.to===person.id);
    if(oldSocial?.relation!==newSocial?.relation)changes.push({kind:'relation',id:person.id,text:'社交关系：'+(oldSocial?.relation||'无')+' → '+(newSocial?.relation||'无')});
    if (old.title !== person.title) changes.push({ kind:'title', id:person.id, text:'「'+displayName(person,after)+'」称呼：'+old.title+' → '+person.title });
    if ((old.name||'') !== (person.name||'')) changes.push({kind:'name',id:person.id,text:'姓名：'+(old.name||'未填写')+' → '+(person.name||'未填写')});
    if ((old.nickname||old.alias||'') !== (person.nickname||person.alias||'')) changes.push({ kind:'alias', id:person.id, text:'「'+displayName(person,after)+'」昵称：'+(old.nickname||old.alias||'无')+' → '+(person.nickname||person.alias||'无') });
    if (JSON.stringify(old.sourcePaths||[]) !== JSON.stringify(person.sourcePaths||[]) || JSON.stringify(old.mergeHistory||[]) !== JSON.stringify(person.mergeHistory||[]))
      changes.push({ kind:'history', id:person.id, text:'「'+displayName(person,after)+'」原关系或合并记录更新' });
  }
  for (const person of before.people) if (!newPeople.has(person.id))
    changes.push({ kind:'delete', id:person.id, text:'删除「'+displayName(person,before)+'」 · '+personPathText(before,person.id) });
  return changes;
}
