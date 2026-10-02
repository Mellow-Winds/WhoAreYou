import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,addPerson,validateState,pathCodes} from '../src/domain.js';
import {scanTree,applyDecisions,fingerprint} from '../src/organize.js';
import {commitWithBackup,listSnapshots,readSnapshot,restoreSnapshot,SNAPSHOT_PREFIX} from '../src/snapshots.js';
import {STORAGE_KEY,loadState} from '../src/storage.js';
import {layout3D} from '../src/layout3d.js';
const add=(s,parent,relation,id,title=id)=>addPerson(s,parent,relation,title,id);
function store(state){const data=new Map([[STORAGE_KEY,JSON.stringify(state)]]);return {data,get length(){return data.size;},key:i=>[...data.keys()][i],getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};}
const immediate=()=>Promise.resolve();

test('scan is read only and cancellable; sibling ambiguity and actual person ids are preserved',async()=>{
  let state=add(initialState(),'me','ob','bro','哥哥');state=add(state,'bro','lb','younger','弟弟');state=add(state,'me','lb','other','弟弟');
  const before=fingerprint(state),results=await scanTree(state,{yieldControl:immediate});
  const suggestion=results.find(s=>s.personId==='younger');assert.equal(suggestion.ambiguous,true);
  for(const key of ['existing:me','existing:bro','existing:other'])assert.ok(suggestion.options.some(o=>o.key===key));
  assert.equal(fingerprint(state),before);
  const abort=new AbortController();await assert.rejects(scanTree(state,{signal:abort.signal,onProgress:()=>abort.abort(),yieldControl:immediate}),{name:'AbortError'});
  assert.equal(fingerprint(state),before);
});

test('shortening preserves id, custom title, children and original descendant paths',()=>{
  let state=add(initialState(),'me','s','son');state=add(state,'son','ls','daughter','小宝');state=add(state,'daughter','s','grandchild','宝宝');
  const next=applyDecisions(state,[{personId:'daughter',optionKey:'new:me:d'}]).state;
  assert.equal(next.people.length,state.people.length);assert.equal(next.people.find(p=>p.id==='daughter').title,'小宝');
  assert.deepEqual(pathCodes(next,'grandchild'),['d','s']);assert.deepEqual(next.people.find(p=>p.id==='grandchild').sourcePaths,[['s','ls','s']]);
  assert.equal(state.people.find(p=>p.id==='daughter').parentId,'son');
});

test('merging into root preserves whole subtrees and duplicate children without cycles',()=>{
  let state=add(initialState(),'me','h','husband');state=add(state,'husband','w','duplicate','阿我');state=add(state,'duplicate','s','a','儿子');state=add(state,'duplicate','s','b','儿子');state=add(state,'b','d','c','孙女');
  const result=applyDecisions(state,[{personId:'duplicate',optionKey:'existing:me',titleChoice:'target'}]);
  assert.equal(result.state.people.length,state.people.length-1);assert.equal(result.state.people[0].id,'me');assert.equal(result.state.people[0].parentId,null);
  for(const id of ['a','b'])assert.equal(result.state.people.find(p=>p.id===id).parentId,'me');
  assert.deepEqual(pathCodes(result.state,'c'),['s','d']);assert.equal(result.state.people[0].mergeHistory[0].title,'阿我');validateState(result.state);
  assert.equal(result.remap.get('duplicate'),'me');
});

test('merge title conflicts and dependent decisions block application; alternate titles remain in history',()=>{
  let state=add(initialState(),'me','os','a','姐姐A');state=add(state,'me','os','b','姐姐B');state=add(state,'me','os','c','姐姐C');
  const before=fingerprint(state);
  assert.throws(()=>applyDecisions(state,[{personId:'a',optionKey:'existing:b'}]),/称呼/);
  assert.throws(()=>applyDecisions(state,[{personId:'a',optionKey:'existing:b',titleChoice:'target'},{personId:'b',optionKey:'existing:a',titleChoice:'target'}]),/依赖/);
  assert.throws(()=>applyDecisions(state,[{personId:'a',optionKey:'existing:c',titleChoice:'source'},{personId:'b',optionKey:'existing:c',titleChoice:'source'}]),/冲突/);
  assert.equal(fingerprint(state),before);
  const result=applyDecisions(state,[{personId:'a',optionKey:'existing:b',titleChoice:'source'}]);
  const retained=result.state.people.find(p=>p.id==='b');assert.equal(retained.title,'姐姐A');assert.ok(retained.mergeHistory.some(p=>p.title==='姐姐B'));
});

test('snapshots restore exact data and stale baselines or failed writes never replace current data',()=>{
  const original=add(initialState(),'me','f','dad','爸爸'),storage=store(original);
  storage.setItem('unrelated','keep');
  const key=commitWithBackup(storage,original,initialState(),'clear');assert.equal(loadState(storage).people.length,1);
  assert.deepEqual(readSnapshot(storage,key).before,original);assert.equal(storage.getItem('unrelated'),'keep');
  restoreSnapshot(storage,key,initialState());assert.deepEqual(loadState(storage),original);assert.equal(listSnapshots(storage).filter(entry=>entry.key.startsWith(SNAPSHOT_PREFIX)).length,2);
  assert.throws(()=>commitWithBackup(storage,initialState(),original,'clear'),/已变化/);
  for(const failOn of ['backup','main']){
    const broken=store(original),before=broken.getItem(STORAGE_KEY),write=broken.setItem;
    broken.setItem=(key,value)=>{if(failOn==='backup'?key.startsWith(SNAPSHOT_PREFIX):key===STORAGE_KEY)throw new Error('quota');write(key,value);};
    assert.throws(()=>commitWithBackup(broken,original,initialState(),'clear'),/失败/);assert.equal(broken.getItem(STORAGE_KEY),before);
  }
});

test('3D layout has real depth, is stable and leaves persisted data untouched',()=>{
  let state=initialState();for(let i=0;i<30;i++)state=add(state,'me',i%2?'s':'d','p'+i);
  const before=fingerprint(state),a=layout3D(state),b=layout3D(state);
  assert.deepEqual(a,b);assert.deepEqual(a.positions.get('me'),{x:0,y:0,z:0});
  assert.ok(new Set([...a.positions.values()].map(p=>p.z.toFixed(2))).size>5);
  for(const point of a.positions.values())assert.ok(Object.values(point).every(Number.isFinite));
  assert.equal(fingerprint(state),before);
});
