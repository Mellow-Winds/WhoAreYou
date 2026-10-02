import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, addPerson, pathCodes, pathText, suggestTitle, validateState } from '../src/domain.js';
import { loadState, saveState, STORAGE_KEY } from '../src/storage.js';
import { layoutTree } from '../src/layout.js';
function fixture() {
  let s = addPerson(initialState(), 'me', 'f', '爸爸', 'dad');
  s = addPerson(s, 'dad', 'm', '奶奶', 'grandma');
  return s;
}
test('爸爸的妈妈 is 奶奶; paths use relations rather than custom titles', () => {
  const s = fixture();
  assert.equal(pathText(pathCodes(s, 'grandma')), '我 → 爸爸 → 妈妈');
  assert.equal(suggestTitle(pathCodes(s, 'grandma')), '奶奶');
  assert.equal(suggestTitle(['f','m','os']), '姨奶奶');
  assert.ok(suggestTitle(['d','lb','f','os']).length > 0);
});
test('same relation creates independent siblings and retains manually entered title', () => {
  const a = addPerson(fixture(), 'grandma', 'os', '大姨奶奶', 'a');
  const b = addPerson(a, 'grandma', 'os', '  二姨奶奶  ', 'b');
  assert.equal(b.people.length, 5);
  assert.equal(b.people.at(-1).title, '二姨奶奶');
  assert.equal(b.people.at(-2).title, '大姨奶奶');
  assert.deepEqual(pathCodes(b, 'a'), pathCodes(b, 'b'));
});
test('validation rejects unknown version, missing root, duplicate ids, broken parents and cycles', () => {
  for (const bad of [
    { version: 2, people: initialState().people }, { version: 1, people: [] },
    { version: 1, people: [...initialState().people, ...initialState().people] },
    { version: 1, people: [...initialState().people, { id:'x', parentId:'missing', relation:'f', title:'爸爸' }] },
    { version: 1, people: [...initialState().people, { id:'a', parentId:'b', relation:'f', title:'甲' }, { id:'b', parentId:'a', relation:'m', title:'乙' }] },
  ]) assert.throws(() => validateState(bad));
  assert.throws(() => addPerson(fixture(),'me','x','某人','x'));
  assert.throws(() => addPerson(fixture(),'me','f','  ','x'));
});
test('storage round trip keeps every node; corruption and storage failure stay visible', () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  assert.deepEqual(loadState(storage), initialState());
  saveState(storage, fixture());
  assert.deepEqual(loadState(storage), fixture());
  data.set(STORAGE_KEY, '{bad');
  assert.throws(() => loadState(storage), /无法解析/);
  assert.equal(data.get(STORAGE_KEY), '{bad');
  assert.throws(() => saveState({ setItem() { throw new Error('quota'); } }, fixture()), /保存失败/);
});
test('star layout centers me and spreads generations radially without overlapping labels', () => {
  let state = fixture();
  state = addPerson(state, 'me', 'm', '妈妈', 'mom');
  const layout = layoutTree(state, 900, 800);
  const { positions, width, height } = layout;
  const root = positions.get('me');
  assert.deepEqual(root, { x: width / 2, y: height / 2 });
  const distance = id => Math.hypot(positions.get(id).x - root.x, positions.get(id).y - root.y);
  assert.ok(distance('grandma') > distance('dad'));
  assert.ok(Math.abs(distance('mom') - distance('dad')) < 1e-6);
  const points = [...positions.values()];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      assert.ok(Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) >= 149);
    }
  }
  assert.deepEqual(layoutTree(state, 900, 800), layout);
});