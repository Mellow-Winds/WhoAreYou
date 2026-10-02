import { kinshipResult } from './kinship.js';
import { pathCodes, addPerson, validateState } from './domain.js';
const equal = (a, b) => a.length === b.length && a.every((code, i) => code === b[i]);
function relationshipIssues(path) {
  const issues = [];
  for (let index = 1; index < path.length; index++) {
    const relation = path[index];
    if ((relation === 'h' || relation === 'w') && relation === path[index - 1]) {
      // A relationship chain cannot establish blood kinship or identify a partner.
      issues.push({ code:'repeated-spouse', at:index, path:path.slice(0, index + 1),
        message:`连续的${relation === 'h' ? '丈夫' : '妻子'}关系需要确认。` });
    }
  }
  return issues;
}
export function analyzeAddition(state, parentId, relation) {
  validateState(state);
  const originalPath = [...pathCodes(state, parentId), relation];
  const issues = relationshipIssues(originalPath);
  const inferred = kinshipResult(originalPath);
  const shorter = inferred.paths.filter(path => path.length < originalPath.length);
  const possibilities = new Map([[originalPath.join(','), originalPath], ...shorter.map(path => [path.join(','), path])]);
  const options = [];
  for (const person of state.people) {
    const path = pathCodes(state, person.id);
    if ([...possibilities.values()].some(possible => equal(possible, path))) {
      options.push({ key:'existing:' + person.id, kind:'existing', personId:person.id, path, title:person.title });
    }
  }
  for (const path of shorter) {
    if (!path.length) continue;
    const prefix = path.slice(0, -1);
    // Only attach to a known person; never invent unnamed intermediate people.
    for (const parent of state.people.filter(person => equal(pathCodes(state, person.id), prefix))) {
      options.push({ key:'new:' + parent.id + ':' + path.at(-1), kind:'new', parentId:parent.id, relation:path.at(-1), path });
    }
  }
  const unique = [...new Map(options.map(option => [option.key, option])).values()];
  return { originalPath, options:unique, suggestedPaths:shorter, ambiguous:inferred.ambiguous,
    issues, hasIssues:issues.length > 0, warning:issues.length > 0 || unique.length > 0 || shorter.length > 0 };
}
export function applyAddition(state, parentId, relation, title, id, decision) {
  validateState(state);
  const analysis = analyzeAddition(state, parentId, relation);
  if (analysis.hasIssues && decision === undefined) throw new Error('检测到问题，请确认关系后再添加。');
  if (decision === undefined || decision === 'original') return { state:addPerson(state, parentId, relation, title, id), personId:id };
  const option = analysis.options.find(candidate => candidate.key === decision);
  if (!option) throw new Error('优化建议已变化，请重新选择。');
  if (option.kind === 'existing') {
    const next = { ...state, people:state.people.map(person => person.id === option.personId
      ? { ...person, sourcePaths:[...new Map([...(person.sourcePaths || []), analysis.originalPath].map(path => [path.join(','), path])).values()] } : person) };
    return { state:validateState(next), personId:option.personId };
  }
  const next = addPerson(state, option.parentId, option.relation, title, id);
  next.people.at(-1).sourcePaths = [analysis.originalPath];
  return { state:validateState(next), personId:id };
}
