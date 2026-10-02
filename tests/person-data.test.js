import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, addPerson, validateState, pathCodes, displayName, updateAlias, subtreePeople, deleteSubtree } from '../src/domain.js';
import { applyDecisions, fingerprint, suggestionsFor } from '../src/organize.js';
import { commitWithBackup, readSnapshot, restoreSnapshot, SNAPSHOT_PREFIX } from '../src/snapshots.js';
import { loadState, saveState, STORAGE_KEY } from '../src/storage.js';

const add = (state, parent, relation, id, title = id) => addPerson(state, parent, relation, title, id);
function store(state) {
  const data = new Map([[STORAGE_KEY, JSON.stringify(state)]]);
  return { data, get length() { return data.size; }, key: index => [...data.keys()][index], getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}

test('aliases preserve original titles and paths, clear cleanly and round trip with legacy data', () => {
  const original = add(initialState(), 'me', 'h', 'husband', '老公');
  assert.equal(displayName(original.people[1]), '老公');
  const before = fingerprint(original), named = updateAlias(original, 'husband', '  先生  '), husband = named.people[1];
  assert.equal(displayName(husband), '先生');
  assert.equal(husband.alias, '先生');
  assert.equal(husband.title, '老公');
  assert.deepEqual(pathCodes(named, 'husband'), ['h']);
  assert.equal(fingerprint(original), before);
  const storage = store(original); saveState(storage, named);
  assert.deepEqual(loadState(storage), named);
  const cleared = updateAlias(named, 'husband', '  ');
  assert.equal(Object.hasOwn(cleared.people[1], 'alias'), false);
  assert.equal(displayName(cleared.people[1]), '老公');
  assert.equal(named.people[1].alias, '先生');
  assert.throws(() => updateAlias(named, 'missing', '名字'), /不存在/);
  for (const alias of [null, 2, {}, '字'.repeat(81)]) {
    assert.throws(() => updateAlias(named, 'husband', alias), /备注名/);
    assert.throws(() => validateState({ ...named, people: [named.people[0], { ...husband, alias }] }), /备注名/);
  }
  assert.equal(updateAlias(named, 'husband', '字'.repeat(80)).people[1].alias.length, 80);
});

test('subtree deletion removes all descendants despite array order and retains unrelated data without mutations', () => {
  let state = add(initialState(), 'me', 'f', 'dad', '爸爸');
  state = add(state, 'dad', 'm', 'grandma', '奶奶');
  state = add(state, 'grandma', 'os', 'aunt', '姨奶奶');
  state = add(state, 'dad', 'lb', 'uncle', '叔叔');
  state = add(state, 'me', 'm', 'mom', '妈妈');
  state = updateAlias(state, 'grandma', '奶奶备注');
  state.people.find(person => person.id === 'grandma').mergeHistory = [{ id: 'old', title: '旧名', alias: '旧备注' }];
  state.people = [...state.people].reverse();
  const before = fingerprint(state);
  assert.deepEqual(subtreePeople(state, 'dad').map(person => person.id), ['uncle', 'aunt', 'grandma', 'dad']);
  const next = deleteSubtree(state, 'dad');
  assert.deepEqual(next.people.map(person => person.id), ['mom', 'me']);
  assert.deepEqual(next.people, state.people.filter(person => ['mom', 'me'].includes(person.id)));
  assert.equal(fingerprint(state), before);
  assert.throws(() => deleteSubtree(state, 'me'), /不能删除/);
  assert.throws(() => deleteSubtree(state, 'missing'), /不存在/);
  const storage = store(state), key = commitWithBackup(storage, state, next, 'delete');
  assert.equal(readSnapshot(storage, key).kind, 'delete');
  assert.deepEqual(loadState(storage), next);
  restoreSnapshot(storage, key, next);
  assert.deepEqual(loadState(storage), state);
});

test('failed delete backups and stale delete confirmations never replace current data', () => {
  const state = add(initialState(), 'me', 'f', 'dad', '爸爸'), next = deleteSubtree(state, 'dad');
  for (const target of ['backup', 'main']) {
    const storage = store(state), write = storage.setItem;
    storage.setItem = (key, value) => { if (target === 'backup' ? key.startsWith(SNAPSHOT_PREFIX) : key === STORAGE_KEY) throw new Error('quota'); write(key, value); };
    assert.throws(() => commitWithBackup(storage, state, next, 'delete'), /失败/);
    assert.deepEqual(loadState(storage), state);
  }
  const storage = store(state), newer = add(state, 'dad', 'm', 'grandma', '奶奶');
  saveState(storage, newer);
  assert.throws(() => commitWithBackup(storage, state, next, 'delete'), /已变化/);
  assert.deepEqual(loadState(storage), newer);
  const legacyKey = SNAPSHOT_PREFIX + 'legacy';
  storage.setItem(legacyKey, JSON.stringify({ version: 1, kind: 'clear', createdAt: '2026-09-28T00:00:00.000Z', before: state, after: initialState() }));
  assert.deepEqual(readSnapshot(storage, legacyKey).before, state);
});

test('merge requires a visible name choice and preserves complete source and replaced target metadata', () => {
  let state = add(initialState(), 'me', 'os', 'source', '姐姐');
  state = add(state, 'me', 'os', 'target', '姐姐');
  state = updateAlias(state, 'source', '大姐'); state = updateAlias(state, 'target', '姐姐备注');
  const source = state.people.find(person => person.id === 'source'), target = state.people.find(person => person.id === 'target');
  source.mergeHistory = [{ id: 'older-source', title: '源旧称呼', alias: '源旧备注' }];
  target.mergeHistory = [{ id: 'older-target', title: '目标旧称呼', alias: '目标旧备注' }];
  target.sourcePaths = [['f', 'd']];
  const before = fingerprint(state);
  assert.equal(suggestionsFor(state, source).options.find(option => option.personId === 'target').title, '姐姐备注');
  assert.throws(() => applyDecisions(state, [{ personId: 'source', optionKey: 'existing:target' }]), /称呼/);
  const kept = applyDecisions(state, [{ personId: 'source', optionKey: 'existing:target', titleChoice: 'target' }]).state.people.find(person => person.id === 'target');
  assert.equal(kept.alias, '姐姐备注');
  assert.deepEqual(kept.mergeHistory.find(person => person.id === 'source'), { ...source, originalPath: ['os'] });
  const replaced = applyDecisions(state, [{ personId: 'source', optionKey: 'existing:target', titleChoice: 'source' }]).state.people.find(person => person.id === 'target');
  assert.equal(replaced.title, source.title); assert.equal(replaced.alias, source.alias);
  assert.deepEqual(replaced.mergeHistory.find(person => person.id === 'target'), { ...target, originalPath: ['os'] });
  assert.equal(fingerprint(state), before);
});

test('merge choice copies the original title and alias as a pair, while shortening preserves aliases', () => {
  let state = add(initialState(), 'me', 'os', 'source', '大姐');
  state = add(state, 'me', 'os', 'target', '姐姐'); state = updateAlias(state, 'target', '大姐');
  const defaultTarget = applyDecisions(state, [{ personId: 'source', optionKey: 'existing:target' }]).state.people.find(person => person.id === 'target');
  assert.equal(defaultTarget.title, '姐姐'); assert.equal(defaultTarget.alias, '大姐');
  const chosenSource = applyDecisions(state, [{ personId: 'source', optionKey: 'existing:target', titleChoice: 'source' }]).state.people.find(person => person.id === 'target');
  assert.equal(chosenSource.title, '大姐'); assert.equal(Object.hasOwn(chosenSource, 'alias'), false);
  assert.ok(chosenSource.mergeHistory.some(person => person.id === 'target' && person.title === '姐姐' && person.alias === '大姐'));
  let branch = add(initialState(), 'me', 's', 'son', '儿子');
  branch = add(branch, 'son', 'ls', 'daughter', '女儿'); branch = updateAlias(branch, 'daughter', '小宝');
  const shortened = applyDecisions(branch, [{ personId: 'daughter', optionKey: 'new:me:d' }]).state;
  assert.equal(shortened.people.find(person => person.id === 'daughter').alias, '小宝');
  assert.deepEqual(pathCodes(shortened, 'daughter'), ['d']);
});
