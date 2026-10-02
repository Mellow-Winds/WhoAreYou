import test from 'node:test';
import assert from 'node:assert/strict';
import { RELATIONS, initialState, addPerson, suggestTitle, validateState } from '../src/domain.js';
import { kinshipResult } from '../src/kinship.js';
import { analyzeAddition, applyAddition } from '../src/optimization.js';
import { saveState, STORAGE_KEY } from '../src/storage.js';

test('every 1–4 step combination returns a title or readable descriptive path',()=>{
  let count=0, named=0, descriptive=0;
  function visit(path) {
    if(path.length) {
      const result=kinshipResult(path); assert.ok(suggestTitle(path).trim());
      assert.ok(result.paths.every(p=>p.every(c=>RELATIONS.some(r=>r.code===c))));
      count++; if(count%1000===0) console.log('checked',count,path.join(',')); if(result.descriptive) descriptive++; else named++;
    }
    if(path.length<4) for(const relation of RELATIONS) visit([...path,relation.code]);
  }
  visit([]); assert.equal(count,11110); console.log({combinations:count,named,descriptive});
  assert.deepEqual(kinshipResult(['h','w']).paths,[[]]);
  assert.ok(kinshipResult(['ob','lb']).ambiguous);
  assert.match(suggestTitle(['f','os','s','w']),/姑表/);
});

test('optimization reduces daughter path; existing person reuse preserves title and tree',()=>{
  let state=addPerson(initialState(),'me','s','儿子','son');
  let result=applyAddition(state,'son','ls','女儿','d','new:me:d');
  assert.equal(result.state.people.at(-1).parentId,'me'); assert.deepEqual(result.state.people.at(-1).sourcePaths,[['s','ls']]);
  state=addPerson(state,'me','d','小宝','daughter');
  const options=analyzeAddition(state,'son','ls').options;
  assert.ok(options.some(o=>o.key==='existing:daughter'));
  result=applyAddition(state,'son','ls','别的名字','unused','existing:daughter');
  assert.equal(result.state.people.length,state.people.length); assert.equal(result.state.people.at(-1).title,'小宝');
  assert.equal(result.personId,'daughter'); validateState(result.state);
  const repeated=applyAddition(result.state,'son','ls','其他称呼','unused','existing:daughter');
  assert.deepEqual(repeated.state.people.at(-1).sourcePaths,[['s','ls']]);
  assert.equal(state.people.at(-1).sourcePaths,undefined);
  assert.throws(()=>applyAddition(state,'son','ls','女儿','new','existing:missing'),/建议已变化/);
});

test('ambiguous siblings are candidates not identities; unknown shortened parents are not fabricated',()=>{
  let state=addPerson(initialState(),'me','ob','哥哥','bro');
  const analysis=analyzeAddition(state,'bro','lb');
  assert.equal(analysis.ambiguous,true);
  assert.ok(analysis.options.some(o=>o.key==='existing:me'));
  assert.ok(analysis.options.some(o=>o.key==='new:me:lb'));
  const original=applyAddition(state,'bro','lb','弟弟','new');
  assert.equal(original.state.people.at(-1).parentId,'bro');
  state=addPerson(state,'bro','f','父亲','father');
  const another=analyzeAddition(state,'father','os');
  for(const option of another.options.filter(o=>o.kind==='new')) assert.ok(state.people.some(p=>p.id===option.parentId));
});

test('old data backup is captured once; failed backup never changes main data',()=>{
  const data=new Map([[STORAGE_KEY,JSON.stringify(initialState())]]);
  const storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
  const before=data.get(STORAGE_KEY); saveState(storage,addPerson(initialState(),'me','h','老公','h'));
  assert.equal(data.get(STORAGE_KEY+'.before-optimization'),before);
  saveState(storage,initialState()); assert.equal(data.get(STORAGE_KEY+'.before-optimization'),before);
  data.delete(STORAGE_KEY+'.before-optimization');
  assert.throws(()=>saveState({getItem:storage.getItem,setItem(){throw new Error('quota');}},initialState()),/保存失败/);
  assert.equal(data.get(STORAGE_KEY),before);
});
