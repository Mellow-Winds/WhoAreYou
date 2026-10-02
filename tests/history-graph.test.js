import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, addPerson, updateAlias } from '../src/domain.js';
import { buildHistoryGraph } from '../src/history-graph.js';
import { commitWithBackup, createCheckpoint, listSnapshots, readSnapshot, restoreSnapshot, SNAPSHOT_PREFIX } from '../src/snapshots.js';
import { loadState, STORAGE_KEY } from '../src/storage.js';

function storage(initial) {
  const data=new Map([[STORAGE_KEY,JSON.stringify(initial)]]);
  return {get length(){return data.size;},key:i=>[...data.keys()][i],getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
}
const root=initialState(),dad=addPerson(root,'me','f','爸爸','dad'),alias=updateAlias(dad,'dad','老爸');

test('graph connects verified changes and marks the newest matching checkpoint as current',()=>{
  const store=storage(root),add=commitWithBackup(store,root,dad,'add'),rename=commitWithBackup(store,dad,alias,'alias'),checkpoint=createCheckpoint(store,'过年前');
  for(const key of [add,rename,checkpoint])store.setItem(key,JSON.stringify({...readSnapshot(store,key),createdAt:'2026-10-02T00:00:00Z'}));
  const records=listSnapshots(store),graph=buildHistoryGraph(records,alias);
  assert.deepEqual(graph.rows.slice(0,3).map(row=>row.key),[checkpoint,rename,add]);
  assert.equal(graph.rows.find(row=>row.isCurrent).key,checkpoint);
  assert.match(graph.rows[1].summary,/备注名：老爸/);
  assert.deepEqual(graph.edges.filter(edge=>edge.kind==='change'),[{kind:'change',from:0,to:1},{kind:'change',from:1,to:2}]);
  assert.equal(graph.edges.some(edge=>edge.to===3),false,'legacy safety copy has no inferred parent');
  assert.equal(records.some(record=>record.isCurrent),false,'render model must not mutate stored records');
});

test('restore before and after retain exact source and draw curved links after re-reading storage',()=>{
  const store=storage(root),add=commitWithBackup(store,root,dad,'add');
  const rename=commitWithBackup(store,dad,alias,'alias');
  const restored=restoreSnapshot(store,rename,alias);
  assert.deepEqual(readSnapshot(store,restored).restoreSource,{key:rename,stage:'before'});
  assert.deepEqual(loadState(store),dad);
  const another=commitWithBackup(store,dad,alias,'restore',undefined,{key:rename,stage:'after'});
  const graph=buildHistoryGraph(listSnapshots(store),loadState(store));
  assert.equal(graph.rows.find(row=>row.isCurrent).key,another);
  const links=graph.edges.filter(edge=>edge.kind==='restore');
  assert.equal(links.length,2);
  assert.deepEqual(links.map(edge=>edge.stage),['after','before']);
  for(const link of links){assert.equal(graph.rows[link.to].key,rename);assert.ok(link.to>link.from);}
  assert.notEqual(links[0].lane,links[1].lane,'overlapping restore links have separate lanes');
  assert.deepEqual(readSnapshot(store,add).after,dad,'earlier history remains intact');
});

test('invalid, pending and unrecorded states stay visible without invented ancestry or a false current marker',()=>{
  const store=storage(root),key=commitWithBackup(store,root,dad,'add');
  const committed=readSnapshot(store,key);
  const pending={key:SNAPSHOT_PREFIX+'pending',...committed,before:dad,after:alias,status:'pending'};
  const records=[pending,{key:SNAPSHOT_PREFIX+'broken',invalid:true,error:'无法读取'},...listSnapshots(store)];
  const graph=buildHistoryGraph(records,alias);
  assert.equal(graph.rows[0].kind,'current');assert.equal(graph.rows[0].isCurrent,true);
  assert.equal(graph.rows.filter(row=>row.isCurrent).length,1);
  assert.ok(graph.rows.some(row=>row.invalid));assert.ok(graph.rows.some(row=>row.status==='pending'));
  assert.equal(graph.edges.length,0);
  assert.deepEqual(buildHistoryGraph([],root).rows,[{kind:'current',summary:'当前资料',isCurrent:true}]);
});

test('restore source validation rejects mismatched targets before writing data',()=>{
  const store=storage(root),key=commitWithBackup(store,root,dad,'add'),count=store.length;
  assert.throws(()=>commitWithBackup(store,dad,alias,'restore',undefined,{key,stage:'after'}),/不一致/);
  assert.throws(()=>commitWithBackup(store,dad,root,'restore',undefined,{key,stage:'unknown'}),/来源无效/);
  assert.equal(store.length,count);assert.deepEqual(loadState(store),dad);
  const old={...readSnapshot(store,key),kind:'restore',before:dad,after:root};
  store.setItem(SNAPSHOT_PREFIX+'old',JSON.stringify(old));
  const raw=store.getItem(SNAPSHOT_PREFIX+'old');
  const graph=buildHistoryGraph(listSnapshots(store),dad);
  assert.equal(graph.edges.some(edge=>edge.kind==='restore'),false,'old restores without source stay readable without fake branches');
  assert.equal(store.getItem(SNAPSHOT_PREFIX+'old'),raw);
});
