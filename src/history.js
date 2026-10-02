import { displayName, pathCodes, pathText, validateState } from './domain.js';

export const HISTORY_LABELS = { add:'添加', alias:'备注名', organize:'整理', delete:'删除', clear:'清除', restore:'恢复', checkpoint:'存档点' };
export function diffStates(before, after) {
  validateState(before); validateState(after);
  const oldPeople = new Map(before.people.map(person => [person.id, person]));
  const newPeople = new Map(after.people.map(person => [person.id, person]));
  const changes = [];
  for (const person of after.people) {
    const old = oldPeople.get(person.id);
    if (!old) { changes.push({ kind:'add', id:person.id, text:'添加「'+displayName(person)+'」 · '+pathText(pathCodes(after,person.id)) }); continue; }
    const oldPath=pathCodes(before,person.id),newPath=pathCodes(after,person.id);
    if (old.parentId !== person.parentId || old.relation !== person.relation || oldPath.join(',') !== newPath.join(',')) {
      const parentChanged=old.parentId!==person.parentId && oldPath.join(',')===newPath.join(',');
      const oldParent=oldPeople.get(old.parentId),newParent=newPeople.get(person.parentId);
      changes.push({ kind:'relation', id:person.id, text:'「'+displayName(person)+'」关系：'+
        (parentChanged?'上级「'+displayName(oldParent)+'」 → 「'+displayName(newParent)+'」':pathText(oldPath)+' → '+pathText(newPath)) });
    }
    if (old.title !== person.title) changes.push({ kind:'title', id:person.id, text:'「'+displayName(person)+'」称呼：'+old.title+' → '+person.title });
    if ((old.alias||'') !== (person.alias||'')) changes.push({ kind:'alias', id:person.id, text:'「'+displayName(person)+'」备注名：'+(old.alias||'无')+' → '+(person.alias||'无') });
    if (JSON.stringify(old.sourcePaths||[]) !== JSON.stringify(person.sourcePaths||[]) || JSON.stringify(old.mergeHistory||[]) !== JSON.stringify(person.mergeHistory||[]))
      changes.push({ kind:'history', id:person.id, text:'「'+displayName(person)+'」原关系或合并记录更新' });
  }
  for (const person of before.people) if (!newPeople.has(person.id))
    changes.push({ kind:'delete', id:person.id, text:'删除「'+displayName(person)+'」 · '+pathText(pathCodes(before,person.id)) });
  return changes;
}
