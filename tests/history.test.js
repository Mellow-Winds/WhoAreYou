import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, addPerson, updateAlias } from '../src/domain.js';
import { diffStates } from '../src/history.js';
import { commitWithBackup, createCheckpoint, listSnapshots, readSnapshot, SNAPSHOT_PREFIX, LEGACY_BACKUP_KEY } from '../src/snapshots.js';
import { loadState, STORAGE_KEY } from '../src/storage.js';

function storage(initial) {
  const data=new Map([[STORAGE_KEY,JSON.stringify(initial)]]);
  return {get length(){return data.size;},key:i=>[...data.keys()][i],getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
}

test('version differences describe added, renamed, moved and removed people',()=>{
  const root=initialState(),withDad=addPerson(root,'me','f','爸爸','dad');
  const renamed=updateAlias(withDad,'dad','老爸');
  assert.match(diffStates(root,withDad)[0].text,/添加「爸爸」/);
  assert.match(diffStates(withDad,renamed)[0].text,/昵称：无 → 老爸/);
  assert.match(diffStates(renamed,root)[0].text,/删除「老爸」/);
  const withGrandma=addPerson(withDad,'dad','m','奶奶','gm');
  const moved={...withGrandma,people:withGrandma.people.map(p=>p.id==='gm'?{...p,parentId:'me'}:p)};
  assert.match(diffStates(withGrandma,moved)[0].text,/关系：我 → 爸爸 → 妈妈 → 我 → 妈妈/);
  const anotherDad=addPerson(withGrandma,'me','f','另一位爸爸','other-dad');
  const movedToSamePath={...anotherDad,people:anotherDad.people.map(p=>p.id==='gm'?{...p,parentId:'other-dad'}:p)};
  assert.match(diffStates(anotherDad,movedToSamePath)[0].text,/上级「爸爸」 → 「另一位爸爸」/);
});

test('every committed change and named checkpoint retains two usable versions',()=>{
  const root=initialState(),store=storage(root),withDad=addPerson(root,'me','f','爸爸','dad');
  const addKey=commitWithBackup(store,root,withDad,'add');
  const alias=updateAlias(withDad,'dad','老爸'),aliasKey=commitWithBackup(store,withDad,alias,'alias');
  const checkpointKey=createCheckpoint(store,'过年前');
  assert.deepEqual(loadState(store),alias);
  assert.deepEqual(readSnapshot(store,addKey).before,root);
  assert.deepEqual(readSnapshot(store,addKey).after,withDad);
  assert.equal(readSnapshot(store,aliasKey).status,'committed');
  assert.equal(readSnapshot(store,checkpointKey).label,'过年前');
  assert.equal(listSnapshots(store).length,4);
  assert.ok(listSnapshots(store).some(entry=>entry.key===LEGACY_BACKUP_KEY));
  assert.throws(()=>createCheckpoint(store,' '),/名称/);
  assert.throws(()=>commitWithBackup(store,root,alias,'restore'),/已变化/);
});

test('failed main write leaves a visible pending safety copy and keeps current data',()=>{
  const root=initialState(),store=storage(root),withDad=addPerson(root,'me','f','爸爸','dad');
  const set=store.setItem;
  store.setItem=(key,value)=>{if(key===STORAGE_KEY)throw new Error('quota');set(key,value);};
  assert.throws(()=>commitWithBackup(store,root,withDad,'add'),/保存失败/);
  assert.deepEqual(loadState(store),root);
  const entry=listSnapshots(store)[0];
  assert.equal(entry.status,'pending');assert.ok(entry.key.startsWith(SNAPSHOT_PREFIX));
  assert.deepEqual(entry.before,root);assert.deepEqual(entry.after,withDad);
});

test('the original one-time backup remains inspectable and restorable as a legacy checkpoint',()=>{
  const root=initialState(),withDad=addPerson(root,'me','f','爸爸','dad'),store=storage(withDad);
  store.setItem(LEGACY_BACKUP_KEY,JSON.stringify(root));
  const legacy=readSnapshot(store,LEGACY_BACKUP_KEY);
  assert.equal(legacy.label,'早期资料备份');assert.deepEqual(legacy.before,root);
  assert.ok(listSnapshots(store).some(entry=>entry.key===LEGACY_BACKUP_KEY));
});
