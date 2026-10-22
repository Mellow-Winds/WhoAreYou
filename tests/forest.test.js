import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,addPerson,displayName,updateProfile,migrateState,validateState,pathCodes,familyRoot,graphEdges,deleteSubtree,KIN_RELATIONS} from '../src/domain.js';
import {analyzeAddition,applyAddition} from '../src/optimization.js';
import {scanTree,applyDecisions,fingerprint} from '../src/organize.js';
import {layoutTree} from '../src/layout.js';
import {layout3D} from '../src/layout3d.js';
import {ancestorChain} from '../src/query.js';
import {loadState,saveState,STORAGE_KEY} from '../src/storage.js';
import {readSnapshot,commitWithBackup,restoreSnapshot,listSnapshots,MIGRATION_BACKUP_KEY,SNAPSHOT_PREFIX} from '../src/snapshots.js';
import {diffStates} from '../src/history.js';
const add=(state,parent,relation,id,name='')=>addPerson(state,parent,relation,relation==='f'?'爸爸':relation==='friend'?'朋友':relation,id,name);
const store=raw=>{const data=new Map(raw?[[STORAGE_KEY,raw]]:[]);return {data,get length(){return data.size;},key:i=>[...data.keys()][i],getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};};
function forest(){let s=add(initialState(),'me','f','mydad');s=add(s,'me','friend','li','李四');s=add(s,'li','f','lidad');s=add(s,'me','coworker','wang','王五');return add(s,'wang','f','wangdad');}

test('social roots have required names and separate edges; family titles and query chains retain context',()=>{
 const s=forest();assert.equal(s.people.find(p=>p.id==='li').parentId,null);
 assert.equal(s.socialEdges.length,2);assert.equal(graphEdges(s).length,s.people.length-1);
 assert.deepEqual(pathCodes(s,'lidad'),['f']);assert.equal(familyRoot(s,'lidad').id,'li');
 assert.deepEqual(ancestorChain(s,'lidad').map(p=>p.id),['me','li','lidad']);
 assert.equal(displayName(s.people.find(p=>p.id==='li'),s),'李四（朋友）');
 assert.equal(displayName(s.people.find(p=>p.id==='lidad'),s),'李四的爸爸');
 const named=updateProfile(s,'lidad','张三','老爸');assert.equal(displayName(named.people.find(p=>p.id==='lidad'),named),'张三（李四的老爸）');
 const renamed=updateProfile(named,'li','李小四','');assert.equal(displayName(renamed.people.find(p=>p.id==='lidad'),renamed),'张三（李小四的老爸）');
 assert.deepEqual(diffStates(s,named).map(d=>d.kind),['name','alias']);
 for(const relation of ['friend','coworker','buddy'])assert.throws(()=>add(s,'me',relation,'unnamed'),/必须填写姓名/);
 assert.throws(()=>add(s,'li','friend','other','朋友'),/从“我”/);
 assert.throws(()=>updateProfile(s,'li','',''),/必须填写姓名/);
 assert.throws(()=>validateState({...s,socialEdges:[]}),/社交连接/);
 assert.throws(()=>validateState({...s,socialEdges:[...s.socialEdges,s.socialEdges[0]]}),/社交连接/);
 assert.throws(()=>validateState({...s,socialEdges:[null]}),/社交连接/);
});

test('duplicate candidates and whole-tree decisions never cross family roots',async()=>{
 let s=forest();assert.deepEqual(analyzeAddition(s,'li','f').options.map(o=>o.personId),['lidad']);
 assert.deepEqual(await scanTree(s,{yieldControl:async()=>{}}),[]);
 s=add(s,'li','s','son');s=add(s,'son','ls','daughter');
 const analysis=analyzeAddition(s,'son','ls');assert.ok(analysis.options.some(o=>o.key==='new:li:d'));
 assert.ok(analysis.options.every(o=>familyRoot(s,o.personId||o.parentId).id==='li'));
 assert.throws(()=>applyAddition(s,'li','f','爸爸','new','existing:mydad'),/已变化/);
 assert.throws(()=>applyDecisions(s,[{personId:'lidad',optionKey:'existing:mydad'}]),/已变化/);
 const next=applyDecisions(s,[{personId:'daughter',optionKey:'new:li:d'}]).state;
 assert.deepEqual(pathCodes(next,'daughter'),['d']);assert.equal(familyRoot(next,'daughter').id,'li');
 const deleted=deleteSubtree(next,'li');assert.deepEqual(deleted.people.map(p=>p.id),['me','mydad','wang','wangdad']);assert.deepEqual(deleted.socialEdges,[s.socialEdges[1]]);
});

test('both layouts include every independent root and retain deterministic positions without writing data',()=>{
 const s=forest(),before=JSON.stringify(s);
 for(const layout of [layoutTree,layout3D]){const a=layout(s),b=layout(s);assert.deepEqual(a,b);assert.equal(a.positions.size,s.people.length);
 const keys=new Set([...a.positions.values()].map(p=>JSON.stringify(p)));assert.equal(keys.size,s.people.length);
 for(const p of a.positions.values())for(const n of Object.values(p))assert.ok(Number.isFinite(n));}
 assert.deepEqual(layout3D({...s,people:[...s.people].reverse()}).positions.get('me'),{x:0,y:0,z:0});
 assert.equal(JSON.stringify(s),before);
});

test('all ten gendered relations trigger only their specified spouse rule, including friend descendants',()=>{
 for(const root of ['me','li'])for(const relation of KIN_RELATIONS){let s=forest();s=add(s,root,relation.code,'subject','任意名字');
 for(const spouse of ['h','w']){const expected=(spouse==='h'?['f','ob','lb','s','h']:['m','os','ls','d','w']).includes(relation.code);
 assert.equal(analyzeAddition(s,'subject',spouse).hasIssues,expected,root+relation.code+spouse);}}
 const s=forest();for(const root of ['me','li'])for(const spouse of ['h','w'])assert.equal(analyzeAddition(s,root,spouse).hasIssues,false);
 let confirmed=add(s,'li','h','husband');confirmed=applyAddition(confirmed,'husband','h','丈夫','partner','original').state;
 assert.equal(analyzeAddition(confirmed,'partner','s').hasIssues,false);
});

test('v1 migration preserves raw state and snapshots, backs up before saving, and restores legacy aliases',()=>{
 const old={version:1,people:[{id:'me',parentId:null,relation:null,title:'我'},{id:'dad',parentId:'me',relation:'f',title:'爸爸',alias:'老爸'}]},raw=JSON.stringify(old),storage=store(raw);
 const state=loadState(storage);assert.equal(state.version,2);assert.equal(state.people[1].nickname,'老爸');assert.equal(state.people[1].title,'爸爸');assert.equal(storage.getItem(STORAGE_KEY),raw);
 assert.equal(fingerprint(old),fingerprint(state));
 const oldKey=SNAPSHOT_PREFIX+'old',oldRecord=JSON.stringify({version:1,kind:'alias',createdAt:'2026-09-30',before:old,after:old});storage.setItem(oldKey,oldRecord);
 const next=add(state,'me','friend','li','李四');const key=commitWithBackup(storage,state,next,'add');
 assert.equal(storage.getItem(MIGRATION_BACKUP_KEY),raw);assert.equal(storage.getItem(oldKey),oldRecord);
 assert.deepEqual(readSnapshot(storage,oldKey).before,migrateState(old));assert.ok(listSnapshots(storage).some(s=>s.key===MIGRATION_BACKUP_KEY));
 restoreSnapshot(storage,key,next);assert.deepEqual(loadState(storage),state);
 restoreSnapshot(storage,oldKey,loadState(storage));assert.equal(loadState(storage).people[1].nickname,'老爸');
 const blocked=store(raw),write=blocked.setItem;blocked.setItem=(k,v)=>{if(k===MIGRATION_BACKUP_KEY)throw Error('quota');write(k,v);};
 assert.throws(()=>saveState(blocked,next),/保存失败/);assert.equal(blocked.getItem(STORAGE_KEY),raw);
});
