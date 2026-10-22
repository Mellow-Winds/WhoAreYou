import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, addPerson, pathCodes } from '../src/domain.js';
import { analyzeAddition, applyAddition } from '../src/optimization.js';

function chain(codes) {
  let state = initialState(), parentId = 'me';
  for (const [index, relation] of codes.entries()) {
    const id = 'person-' + index;
    state = addPerson(state, parentId, relation, '人物' + index, id);
    parentId = id;
  }
  return { state, parentId };
}

test('consecutive same spouse relations warn at the root and inside longer paths', () => {
  for (const codes of [['h','h'], ['w','w'], ['f','os','h','h']]) {
    const { state, parentId } = chain(codes.slice(0, -1));
    const before = JSON.stringify(state);
    const analysis = analyzeAddition(state, parentId, codes.at(-1));
    assert.equal(analysis.hasIssues, true);
    assert.equal(analysis.warning, true);
    assert.equal(analysis.issues.length, 1);
    assert.equal(analysis.issues[0].code, 'spouse-confirmation');
    assert.match(analysis.issues[0].message, /请确认/);
    assert.doesNotMatch(analysis.issues[0].message, /乱伦|近亲|同性/);
    assert.deepEqual(analysis.originalPath, codes);
    assert.equal(JSON.stringify(state), before);
  }
});

test('ordinary relatives and spouses do not become issues from missing titles', () => {
  for (const codes of [['f','m'], ['f','w'], ['m','h'], ['ob','w'], ['os','h'], ['s','w'], ['d','h'], Array(13).fill('f')]) {
    const { state, parentId } = chain(codes.slice(0, -1));
    const analysis = analyzeAddition(state, parentId, codes.at(-1));
    assert.equal(analysis.hasIssues, false, codes.join(','));
    assert.deepEqual(analysis.issues, []);
  }
});

test('opposite spouse chain remains a possible return to self and preserves existing data', () => {
  for (const codes of [['h','w'], ['w','h']]) {
    const { state, parentId } = chain(codes.slice(0, -1));
    const before = JSON.stringify(state);
    const analysis = analyzeAddition(state, parentId, codes.at(-1));
    assert.equal(analysis.hasIssues, false);
    assert.equal(analysis.warning, true);
    assert.ok(analysis.options.some(option => option.key === 'existing:me'));
    const result = applyAddition(state, parentId, codes.at(-1), '自定义称呼', 'unused', 'existing:me');
    assert.equal(result.personId, 'me');
    assert.equal(result.state.people.length, state.people.length);
    assert.equal(result.state.people[0].title, '我');
    assert.deepEqual(result.state.people[0].sourcePaths, [codes]);
    assert.equal(JSON.stringify(state), before);
  }
});

test('problematic chains require explicit confirmation and never mutate input state', () => {
  const { state, parentId } = chain(['h']);
  const before = JSON.stringify(state);
  assert.throws(() => applyAddition(state, parentId, 'h', '另一位', 'new'), /检测到问题/);
  assert.throws(() => applyAddition(state, parentId, 'h', '另一位', 'new', 'existing:missing'), /建议已变化/);
  const result = applyAddition(state, parentId, 'h', '另一位', 'new', 'original');
  assert.equal(result.personId, 'new');
  assert.equal(result.state.people.at(-1).title, '另一位');
  assert.deepEqual(pathCodes(result.state, 'new'), ['h','h']);
  assert.equal(JSON.stringify(state), before);
});

test('normal addition and shorter alternatives retain the established behavior', () => {
  const { state, parentId } = chain(['s']);
  const original = applyAddition(state, parentId, 'ls', '女儿', 'original');
  assert.deepEqual(pathCodes(original.state, 'original'), ['s','ls']);
  const optimized = applyAddition(state, parentId, 'ls', '小宝', 'short', 'new:me:d');
  assert.deepEqual(pathCodes(optimized.state, 'short'), ['d']);
  assert.equal(optimized.state.people.at(-1).title, '小宝');
  assert.deepEqual(optimized.state.people.at(-1).sourcePaths, [['s','ls']]);
});

test('analysis and application reject invalid current data before proposing or reusing a person', () => {
  const state = initialState();
  const broken = { ...state, people:[...state.people, { id:'other', parentId:'missing', relation:'h', title:'老公' }] };
  assert.throws(() => analyzeAddition(broken, 'me', 'h'), /上级或关系无效/);
  assert.throws(() => applyAddition(broken, 'me', 'h', '老公', 'new', 'existing:other'), /上级或关系无效/);
  assert.throws(() => analyzeAddition(state, 'missing', 'h'), /找不到/);
  assert.throws(() => analyzeAddition(state, 'me', 'unknown'), /关系类型/);
});
