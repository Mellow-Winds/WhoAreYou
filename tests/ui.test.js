import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { migrateState } from '../src/domain.js';
import { STORAGE_KEY } from '../src/storage.js';
import { SNAPSHOT_PREFIX } from '../src/snapshots.js';
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
let counter = 0;
async function page(raw, options = {}) {
  const w = new Window({ url:'http://localhost:5173/#/map', settings:{ disableJavaScriptFileLoading:true, disableCSSFileLoading:true } });
  w.matchMedia = () => ({ matches:!options.motion });
  options.setup?.(w);
  if (raw !== undefined) w.localStorage.setItem(STORAGE_KEY, raw);
  w.document.write(html);
  Object.defineProperties(w.document.querySelector('#tree-scroll'), { clientWidth:{value:800}, clientHeight:{value:600} });
  globalThis.window = w; globalThis.document = w.document;
  await import('../src/app.js?test=' + counter++);
  return w;
}
function click(w, selector) { const el = w.document.querySelector(selector); assert.ok(el, selector); el.click(); return el; }
function choose(w, value, name='relation') {
  const input = [...w.document.querySelectorAll('input')].find(i => i.name===name && i.value===value);
  assert.ok(input, value); input.checked=true; input.dispatchEvent(new w.Event('change', {bubbles:true}));
}
function submit(w) { w.document.querySelector('#add-form').dispatchEvent(new w.Event('submit', {bubbles:true,cancelable:true})); }
const data = {version:1,people:[
  {id:'me',parentId:null,relation:null,title:'我'},
  {id:'dad',parentId:'me',relation:'f',title:'爸爸'},
  {id:'gm',parentId:'dad',relation:'m',title:'阿奶'},
  {id:'a',parentId:'gm',relation:'os',title:'大姨奶奶'},
  {id:'b',parentId:'gm',relation:'os',title:'二姨奶奶'},
]};

test('a damaged backup remains visible without blocking valid backups or recovery',async t=>{
  const w=await page(JSON.stringify(data),{setup(win){win.localStorage.setItem(SNAPSHOT_PREFIX+'broken','{broken');}});t.after(()=>w.happyDOM.close());
  click(w,'#clear-tree');click(w,'#confirm-action');
  click(w,'#show-backups');
  assert.match(w.document.querySelector('#backup-list').textContent,/损坏记录/);
  const version=w.document.querySelector('#backup-list button');assert.ok(version);version.click();click(w,'#version-before');click(w,'#confirm-action');
  assert.deepEqual(JSON.parse(w.localStorage.getItem(STORAGE_KEY)),migrateState(data));assert.equal(w.localStorage.getItem(SNAPSHOT_PREFIX+'broken'),'{broken');
});

test('add flow preserves custom titles, duplicate siblings require confirmation, and reload restores data', async t => {
  const w=await page(); t.after(()=>w.happyDOM.close());
  click(w,'.add-person'); choose(w,'f'); assert.equal(w.document.querySelector('#kin-title').value,'爸爸'); submit(w);
  let saved=JSON.parse(w.localStorage.getItem(STORAGE_KEY)); const dad=saved.people[1].id;
  click(w,`[data-id="${dad}"] .add-person`); choose(w,'m');
  assert.equal(w.document.querySelector('#kin-title').value,'奶奶');
  w.document.querySelector('#kin-title').value='阿奶'; submit(w);
  saved=JSON.parse(w.localStorage.getItem(STORAGE_KEY)); const gm=saved.people[2].id;
  assert.equal(w.document.querySelector('#detail-title').textContent,'阿奶');
  click(w,'#close-details'); click(w,`[data-id="${gm}"] .person-main`);
  assert.equal(w.document.querySelector('#detail-path').textContent,'我的爸爸的妈妈');
  for(const title of ['大姨奶奶','二姨奶奶']) {
    click(w,`[data-id="${gm}"] .add-person`); choose(w,'os');
    w.document.querySelector('#kin-title').value=title; submit(w);
    if(w.document.querySelector('dialog').open) {
      assert.match(w.document.querySelector('#form-error').textContent,/确认/);
      assert.equal(w.document.querySelector('#keep-original').textContent,'无视，直接添加');
      click(w,'#keep-original');
    }
  }
  const raw=w.localStorage.getItem(STORAGE_KEY), reopened=await page(raw);
  t.after(()=>reopened.happyDOM.close());
  assert.equal(reopened.document.querySelectorAll('.person').length,5);
  assert.equal(JSON.parse(raw).people.at(-1).title,'二姨奶奶');
});

test('empty title and cancel never create data; corrupt data cannot be overwritten', async t=>{
  const w=await page(); t.after(()=>w.happyDOM.close());
  click(w,'.add-person'); submit(w); assert.match(w.document.querySelector('#form-error').textContent,/请选择关系/);
  choose(w,'m'); w.document.querySelector('#kin-title').value=' '; submit(w);
  assert.match(w.document.querySelector('#form-error').textContent,/请填写称呼/); click(w,'#cancel');
  assert.equal(w.localStorage.getItem(STORAGE_KEY),null);
  const broken=await page('{broken'); t.after(()=>broken.happyDOM.close());
  assert.equal(broken.document.querySelector('#notice').hidden,false);
  assert.equal(broken.document.querySelectorAll('.add-person').length,0);
  assert.equal(broken.localStorage.getItem(STORAGE_KEY),'{broken');
});

test('failed persistence leaves dialog open and no unsaved node', async t=>{
  const w=await page(); t.after(()=>w.happyDOM.close()); click(w,'.add-person'); choose(w,'f');
  Object.defineProperty(w,'localStorage',{value:{getItem:()=>null,setItem:()=>{throw new Error('quota');}}});
  submit(w); assert.equal(w.document.querySelector('dialog').open,true);
  assert.match(w.document.querySelector('#form-error').textContent,/保存失败/);
  assert.equal(w.document.querySelectorAll('.person').length,1);
});

test('card path immediately focuses each ancestor and retains the full forward path', async t=>{
  const raw=JSON.stringify(data), w=await page(raw); t.after(()=>w.happyDOM.close());
  click(w,'.person[data-id="b"] .person-main');
  const chain=()=>[...w.document.querySelectorAll('.path-step')].map(b=>b.dataset.id);
  assert.deepEqual(chain(),['me','dad','gm','b']);
  for(const [id,title,lines] of [['dad','爸爸',1],['gm','阿奶',2],['b','二姨奶奶',3],['me','我',0]]) {
    click(w,`.path-step[data-id="${id}"]`);
    assert.equal(w.document.querySelector('#detail-title').textContent,title);
    assert.equal(w.document.querySelector('.person.selected').dataset.id,id);
    assert.equal(w.document.querySelectorAll('path.highlighted').length,lines);
    assert.equal(w.document.querySelector('.path-step[aria-current]').dataset.id,id);
    const node=w.document.querySelector(`.person[data-id="${id}"]`);
    assert.equal(parseFloat(node.style.left)+60,400); assert.equal(parseFloat(node.style.top)+18,300);
    assert.equal(w.document.querySelector('#details').closest('.person'),null);
    assert.equal(w.document.querySelector('#details').style.top,'');
    assert.deepEqual(chain(),['me','dad','gm','b']);
  }
  assert.equal(w.localStorage.getItem(STORAGE_KEY),raw);
  click(w,'#close-details'); assert.equal(w.document.querySelector('#details').hidden,true);
});

test('card wraps possessives, preserves long titles, and zoom keeps card typography fixed',async t=>{
  const title='很长的自定义称呼'.repeat(30);
  const w=await page(JSON.stringify({version:1,people:[data.people[0],{id:'sister',parentId:'me',relation:'ls',title:'妹妹'},{id:'son',parentId:'sister',relation:'s',title}]}));
  t.after(()=>w.happyDOM.close());
  const style=w.document.createElement('style'); style.textContent=await readFile(new URL('../src/style.css',import.meta.url),'utf8'); w.document.head.append(style);
  const person=w.document.querySelector('.person[data-id="son"]'), button=person.querySelector('.person-main'); button.click();
  assert.equal(w.document.querySelector('#detail-title').textContent,title);
  assert.deepEqual([...w.document.querySelectorAll('.path-step')].map(p=>p.textContent),['我的','妹妹的','儿子']);
  assert.equal(w.document.querySelectorAll('.path-step[aria-pressed="true"]').length,3);
  const card=w.document.querySelector('#details');
  const sizes=()=>[w.getComputedStyle(w.document.querySelector('#detail-title')).fontSize,w.getComputedStyle(card).width,w.getComputedStyle(button).width];
  assert.deepEqual(sizes(),['17px','340px','44px']);
  for(let n=0;n<5;n++) click(w,'#zoom-in');
  assert.ok(Number(w.document.querySelector('#tree-scroll').dataset.zoom)>2); assert.deepEqual(sizes(),['17px','340px','44px']);
  click(w,'.path-step[data-id="sister"]'); assert.equal(w.document.querySelectorAll('.path-step[aria-pressed="true"]').length,2);
  assert.equal(w.document.querySelector('.person[data-id="son"]'),person);
  click(w,'#reset-view'); assert.equal(Number(w.document.querySelector('#tree-scroll').dataset.zoom),1);
  click(w,'#close-details'); assert.equal(card.hidden,true);
});

test('son sister optimization needs explicit choice, custom title survives and cancellation saves nothing',async t=>{
  const raw=JSON.stringify({version:1,people:[data.people[0],{id:'son',parentId:'me',relation:'s',title:'儿子'}]});
  const w=await page(raw); t.after(()=>w.happyDOM.close());
  click(w,'.person[data-id="son"] .add-person'); choose(w,'ls');
  assert.equal(w.document.querySelector('#optimization').hidden,false); submit(w);
  assert.equal(w.localStorage.getItem(STORAGE_KEY),raw); click(w,'#optimization-cancel');
  assert.equal(w.localStorage.getItem(STORAGE_KEY),raw);
  click(w,'.person[data-id="son"] .add-person'); choose(w,'ls');
  w.document.querySelector('#kin-title').value='小宝'; click(w,'[data-decision="new:me:d"]');
  const saved=JSON.parse(w.localStorage.getItem(STORAGE_KEY));
  assert.equal(saved.people.at(-1).parentId,'me'); assert.equal(saved.people.at(-1).relation,'d');
  assert.equal(saved.people.at(-1).title,'小宝'); assert.deepEqual(saved.people.at(-1).sourcePaths,[['s','ls']]);
  assert.equal(w.localStorage.getItem(STORAGE_KEY+'.before-optimization'),raw);
});

test('husband wife can reuse self without cycle; brother brother has no automatic selection',async t=>{
  const w=await page(JSON.stringify({version:1,people:[data.people[0],{id:'husband',parentId:'me',relation:'h',title:'丈夫'},{id:'bro',parentId:'me',relation:'ob',title:'哥哥'}]}));
  t.after(()=>w.happyDOM.close());
  click(w,'.person[data-id="husband"] .add-person'); choose(w,'w');
  assert.equal(w.document.querySelector('#kin-title').value,'我');
  click(w,'[data-decision="existing:me"]');
  const saved=JSON.parse(w.localStorage.getItem(STORAGE_KEY)); assert.equal(saved.people.length,3);
  assert.equal(saved.people[0].parentId,null); assert.equal(w.document.querySelector('#detail-title').textContent,'我');
  click(w,'.person[data-id="bro"] .add-person'); choose(w,'lb');
  assert.match(w.document.querySelector('#optimization-reason').textContent,/多种可能/);
  assert.equal(w.document.querySelectorAll('input[name="optimization"]').length,0);
  assert.ok(w.document.querySelector('[data-decision="existing:me"]'));
  click(w,'#keep-original'); assert.equal(JSON.parse(w.localStorage.getItem(STORAGE_KEY)).people.at(-1).parentId,'bro');
});

test('bottom information panel stays fixed during drag, zoom and person switches; the complete selected prefix shares its highlight',async t=>{
  const w=await page(JSON.stringify({version:1,people:[data.people[0],{id:'bro',parentId:'me',relation:'ob',title:'哥哥'},{id:'son',parentId:'bro',relation:'s',title:'侄子'}]}));
  t.after(()=>w.happyDOM.close());
  const style=w.document.createElement('style');style.textContent=await readFile(new URL('../src/style.css',import.meta.url),'utf8');w.document.head.append(style);
  click(w,'.person[data-id="bro"] .person-main');
  const card=w.document.querySelector('#details'), canvas=w.document.querySelector('#tree-scroll');
  const placement=()=>{const s=w.getComputedStyle(card);return [s.position,s.left,s.bottom,s.transform,s.width];};
  const before=placement();assert.equal(before[0],'fixed');assert.equal(before[1],'50%');assert.equal(before[3],'translateX(-50%)');
  const highlights=()=>[...w.document.querySelectorAll('#detail-path .path-step[aria-pressed="true"]')].map(el=>{
    const s=w.getComputedStyle(el);return [s.color,s.backgroundColor,s.borderColor];
  });
  assert.equal(highlights().length,2);assert.deepEqual(highlights()[0],highlights()[1]);
  assert.notEqual(highlights()[0][2],'transparent');
  const node=w.document.querySelector('.person[data-id="bro"]'), nodeBefore=node.style.left;
  canvas.dispatchEvent(new w.PointerEvent('pointerdown',{pointerId:1,button:0,clientX:30,clientY:30}));
  canvas.dispatchEvent(new w.PointerEvent('pointermove',{pointerId:1,clientX:150,clientY:100}));
  canvas.dispatchEvent(new w.PointerEvent('pointerup',{pointerId:1}));
  assert.notEqual(node.style.left,nodeBefore);assert.deepEqual(placement(),before);
  click(w,'#zoom-in');assert.deepEqual(placement(),before);
  click(w,'.person[data-id="son"] .person-main');assert.deepEqual(placement(),before);
  assert.equal(highlights().length,3);
  click(w,'#detail-path .path-step[data-id="bro"]');
  assert.equal(highlights().length,2);assert.equal(w.document.querySelector('#detail-path .path-step[data-id="son"]').getAttribute('aria-pressed'),'false');
  assert.deepEqual(placement(),before);assert.equal(card.style.left,'');assert.equal(card.style.top,'');
});

test('selection keeps the camera still while content cross-fades and rapid changes cancel obsolete content',async t=>{
  const callbacks=new Map(), animations=[];let frameId=0,time=0;
  const w=await page(JSON.stringify(data),{motion:true,setup(w){
    w.requestAnimationFrame=callback=>{callbacks.set(++frameId,callback);return frameId;};
    w.cancelAnimationFrame=id=>callbacks.delete(id);
    Object.defineProperty(w.HTMLElement.prototype,'animate',{value:function(keyframes,timing){
      const animation={target:this,keyframes,timing,cancelled:false,onfinish:null,cancel(){this.cancelled=true;}};
      animations.push(animation);return animation;
    }});
  }});
  t.after(()=>w.happyDOM.close());
  const step=()=>{const pending=[...callbacks.values()];callbacks.clear();for(const callback of pending)callback(time+=16);};
  const dad=w.document.querySelector('.person[data-id="dad"]'), original=dad.style.top;
  click(w,'.person[data-id="dad"] .person-main');assert.equal(dad.style.top,original);assert.equal(callbacks.size,0);
  click(w,'.person[data-id="gm"] .person-main');
  assert.equal(w.document.querySelector('#detail-title').textContent,'阿奶');assert.equal(animations.length,2);
  assert.equal(animations[0].timing.duration,180);assert.equal(w.document.querySelectorAll('.detail-content.outgoing').length,1);
  assert.equal(w.document.querySelector('.detail-content.outgoing').getAttribute('aria-hidden'),'true');
  const gm=w.document.querySelector('.person[data-id="gm"]'), midway=gm.style.left;
  click(w,'.person[data-id="b"] .person-main');
  assert.equal(gm.style.left,midway);assert.equal(animations[0].cancelled,true);assert.equal(animations[1].cancelled,true);
  assert.equal(w.document.querySelector('#detail-title').textContent,'二姨奶奶');
  assert.equal(w.document.querySelectorAll('.detail-content.outgoing').length,1);
  for(const id of ['details','detail-content','detail-title','detail-path']) assert.equal(w.document.querySelectorAll('#'+id).length,1);
  animations.at(-1).onfinish();assert.equal(w.document.querySelectorAll('.detail-content.outgoing').length,0);
  for(let n=0;callbacks.size&&n<40;n++)step();assert.equal(callbacks.size,0);
  const final=w.document.querySelector('.person[data-id="b"]');const still={left:final.style.left,top:final.style.top};
  click(w,'#detail-path .path-step[data-id="dad"]');assert.equal(w.document.querySelectorAll('.detail-content.outgoing').length,1);
  assert.ok(callbacks.size>0);assert.deepEqual({left:final.style.left,top:final.style.top},still);
  click(w,'#close-details');assert.equal(w.document.querySelectorAll('.detail-content.outgoing').length,0);assert.equal(w.document.querySelector('#details').hidden,true);
});

test('startup opens the map directly and help preserves existing data',async t=>{
  const raw=JSON.stringify(data),w=await page(raw);t.after(()=>w.happyDOM.close());
  assert.equal(w.document.querySelector('#home-page'),null);assert.equal(w.document.querySelector('#map-page').hidden,false);
  click(w,'#show-help');assert.equal(w.document.querySelector('#help-dialog').open,true);
  assert.match(w.document.querySelector('#help-dialog').textContent,/WASD/);
  click(w,'[data-close-dialog="help-dialog"]');assert.equal(w.localStorage.getItem(STORAGE_KEY),raw);
});

test('2D keyboard moves after toolbar focus and mode fallback, but never in help or forms',async t=>{
  const callbacks=new Map();let frame=0,time=0;
  const w=await page(JSON.stringify(data),{setup(win){win.requestAnimationFrame=cb=>{callbacks.set(++frame,cb);return frame;};win.cancelAnimationFrame=id=>callbacks.delete(id);}});t.after(()=>w.happyDOM.close());
  const step=()=>{time+=16;const pending=[...callbacks.values()];callbacks.clear();for(const cb of pending)cb(time);};
  const key=(type,code,target=w.document.activeElement)=>target.dispatchEvent(new w.KeyboardEvent(type,{key:code.slice(-1).toLowerCase(),code,bubbles:true,cancelable:true}));
  const node=w.document.querySelector('.person[data-id="me"]');
  for(const direction of ['KeyW','KeyS','KeyA','KeyD']){
    w.document.querySelector('#zoom-in').focus();const before={x:parseFloat(node.style.left),y:parseFloat(node.style.top)};
    key('keydown',direction);step();key('keyup',direction);
    if(direction==='KeyW')assert.ok(parseFloat(node.style.top)>before.y);
    if(direction==='KeyS')assert.ok(parseFloat(node.style.top)<before.y);
    if(direction==='KeyA')assert.ok(parseFloat(node.style.left)>before.x);
    if(direction==='KeyD')assert.ok(parseFloat(node.style.left)<before.x);
  }
  const modeButton=w.document.querySelector('#view-mode');modeButton.focus();modeButton.click();assert.equal(w.document.activeElement.id,'tree-scroll');
  const before=parseFloat(node.style.left);key('keydown','KeyD');step();key('keyup','KeyD');assert.ok(parseFloat(node.style.left)<before);
  click(w,'.person[data-id="me"] .add-person');const input=w.document.querySelector('#kin-title');input.focus();key('keydown','KeyW');assert.equal(callbacks.size,0);click(w,'#cancel');
  click(w,'#show-help');key('keydown','KeyD');step();assert.equal(callbacks.size,0);
  click(w,'[data-close-dialog="help-dialog"]');key('keydown','KeyD');step();key('keyup','KeyD');assert.equal(callbacks.size,0);
});

async function scanned(w){for(let n=0;n<200;n++){if(!w.document.querySelector('#scan-progress').textContent.startsWith('正在检查'))return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Scan did not finish');}

test('whole-tree organize previews selected shortening, confirms it and restores the exact tree',async t=>{
  const raw=JSON.stringify({version:1,people:[data.people[0],{id:'son',parentId:'me',relation:'s',title:'儿子'},{id:'daughter',parentId:'son',relation:'ls',title:'小宝'}]}),w=await page(raw);t.after(()=>w.happyDOM.close());
  click(w,'#organize-tree');await scanned(w);
  const select=w.document.querySelector('.suggestion[data-id="daughter"] .decision');assert.ok(select);assert.equal(select.value,'keep');
  select.value='new:me:d';select.dispatchEvent(new w.Event('change'));
  click(w,'#preview-organize');assert.equal(w.document.querySelector('#confirm-dialog').open,true);assert.equal(w.localStorage.getItem(STORAGE_KEY),raw);
  click(w,'#confirm-action');const saved=JSON.parse(w.localStorage.getItem(STORAGE_KEY));assert.equal(saved.people.find(p=>p.id==='daughter').parentId,'me');assert.equal(saved.people.find(p=>p.id==='daughter').title,'小宝');
  click(w,'#undo-last');click(w,'#confirm-action');assert.deepEqual(JSON.parse(w.localStorage.getItem(STORAGE_KEY)),migrateState(JSON.parse(raw)));
});

test('clear needs confirmation, preserves backups and can recover after page reload',async t=>{
  const raw=JSON.stringify(data),w=await page(raw);t.after(()=>w.happyDOM.close());
  click(w,'#clear-tree');assert.match(w.document.querySelector('#confirm-description').textContent,/4 位/);
  click(w,'#confirm-cancel');assert.equal(w.localStorage.getItem(STORAGE_KEY),raw);
  click(w,'#clear-tree');click(w,'#confirm-action');assert.equal(JSON.parse(w.localStorage.getItem(STORAGE_KEY)).people.length,1);
  const savedKeys=Array.from({length:w.localStorage.length},(_,i)=>w.localStorage.key(i)).map(key=>[key,w.localStorage.getItem(key)]);
  const reopened=await page(undefined,{setup(win){for(const [key,value]of savedKeys)win.localStorage.setItem(key,value);}});t.after(()=>reopened.happyDOM.close());
  click(reopened,'#show-help');assert.equal(reopened.document.querySelector('#restore-cleared').hidden,false);
  click(reopened,'#restore-cleared');click(reopened,'#confirm-action');assert.deepEqual(JSON.parse(reopened.localStorage.getItem(STORAGE_KEY)),migrateState(data));
});

test('organize title conflicts require choice and stale clear confirmation cannot overwrite a new relative',async t=>{
  const raw=JSON.stringify({version:1,people:[data.people[0],{id:'a',parentId:'me',relation:'os',title:'姐姐A'},{id:'b',parentId:'me',relation:'os',title:'姐姐B'}]}),w=await page(raw);t.after(()=>w.happyDOM.close());
  click(w,'#organize-tree');await scanned(w);
  const row=w.document.querySelector('.suggestion[data-id="a"]'),decision=row.querySelector('.decision');decision.value='existing:b';decision.dispatchEvent(new w.Event('change'));
  click(w,'#preview-organize');assert.match(w.document.querySelector('#organize-error').textContent,/称呼/);assert.equal(w.localStorage.getItem(STORAGE_KEY),raw);
  row.querySelector('.title-choice').value='target';click(w,'#preview-organize');click(w,'#confirm-action');assert.equal(JSON.parse(w.localStorage.getItem(STORAGE_KEY)).people.length,2);
  click(w,'#clear-tree');const newer=JSON.parse(w.localStorage.getItem(STORAGE_KEY));newer.people.push({id:'new',parentId:'me',relation:'s',title:'儿子'});w.localStorage.setItem(STORAGE_KEY,JSON.stringify(newer));
  click(w,'#confirm-action');assert.match(w.document.querySelector('#confirm-error').textContent,/已变化/);assert.deepEqual(JSON.parse(w.localStorage.getItem(STORAGE_KEY)),newer);
});

test('card title edits an alias without changing the relationship or original title',async t=>{
  const w=await page(JSON.stringify(data));t.after(()=>w.happyDOM.close());
  click(w,'.person[data-id="gm"] .person-main');click(w,'#detail-title');
  const input=w.document.querySelector('#alias-input');assert.equal(input.value,'');
  input.value='奶奶昵称';w.document.querySelector('#alias-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  let saved=JSON.parse(w.localStorage.getItem(STORAGE_KEY));
  assert.equal(saved.people.find(p=>p.id==='gm').title,'阿奶');
  assert.equal(saved.people.find(p=>p.id==='gm').nickname,'奶奶昵称');
  assert.equal(w.document.querySelector('#detail-title').textContent,'奶奶昵称');
  assert.equal(w.document.querySelector('.person[data-id="gm"] .person-title').textContent,'奶奶昵称');
  assert.equal(w.document.querySelector('#detail-path').textContent,'我的爸爸的妈妈');
  click(w,'#detail-title');input.value=' ';click(w,'#alias-cancel');
  assert.equal(w.document.querySelector('#detail-title').textContent,'奶奶昵称');
  click(w,'#detail-title');input.value=' ';w.document.querySelector('#alias-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  saved=JSON.parse(w.localStorage.getItem(STORAGE_KEY));assert.equal(Object.hasOwn(saved.people.find(p=>p.id==='gm'),'alias'),false);
  assert.equal(w.document.querySelector('#detail-title').textContent,'阿奶');
});

test('delete acts on the displayed ancestor, confirms the whole subtree, and can restore it',async t=>{
  const raw=JSON.stringify(data),w=await page(raw);t.after(()=>w.happyDOM.close());
  click(w,'.person[data-id="b"] .person-main');click(w,'.path-step[data-id="gm"]');
  click(w,'#delete-person');
  assert.match(w.document.querySelector('#confirm-description').textContent,/3 位/);
  assert.equal(w.document.querySelector('#confirm-items').children.length,3);
  click(w,'#confirm-cancel');assert.equal(w.localStorage.getItem(STORAGE_KEY),raw);
  click(w,'#delete-person');click(w,'#confirm-action');
  assert.deepEqual(JSON.parse(w.localStorage.getItem(STORAGE_KEY)).people.map(p=>p.id),['me','dad']);
  assert.equal(w.document.querySelector('#details').hidden,true);
  assert.equal(w.document.querySelectorAll('.person').length,2);
  click(w,'#undo-last');click(w,'#confirm-action');
  assert.deepEqual(JSON.parse(w.localStorage.getItem(STORAGE_KEY)),migrateState(data));
  click(w,'.person[data-id="me"] .person-main');
  assert.equal(w.document.querySelector('#delete-person').hidden,true);
});

test('repeated spouse warning offers vertical one-click choices and needs an explicit action',async t=>{
  const raw=JSON.stringify({version:1,people:[data.people[0],{id:'husband',parentId:'me',relation:'h',title:'老公'}]});
  const w=await page(raw);t.after(()=>w.happyDOM.close());
  click(w,'.person[data-id="husband"] .add-person');choose(w,'h');
  assert.equal(w.document.querySelector('#optimization-heading').textContent,'检测到需要核对的关系');
  assert.match(w.document.querySelector('#optimization-reason').textContent,/为男性关系人物添加丈夫/);
  assert.equal(w.document.querySelector('#add-actions').hidden,true);
  assert.deepEqual([...w.document.querySelectorAll('#optimization button')].map(button=>button.textContent.split('我')[0].trim()).filter(Boolean).at(0),'无视，直接添加');
  submit(w);assert.equal(w.localStorage.getItem(STORAGE_KEY),raw);
  click(w,'#keep-original');
  const saved=JSON.parse(w.localStorage.getItem(STORAGE_KEY));
  assert.equal(saved.people.length,3);assert.equal(saved.people.at(-1).parentId,'husband');
  assert.equal(saved.people.at(-1).relation,'h');
});

test('alias changes reject stale people and failed writes without changing the visible saved name',async t=>{
  const raw=JSON.stringify(data),w=await page(raw);t.after(()=>w.happyDOM.close());
  click(w,'.person[data-id="gm"] .person-main');click(w,'#detail-title');
  w.document.querySelector('#alias-input').value='新备注';
  const newer=structuredClone(data);newer.people.find(p=>p.id==='gm').title='更新的原称呼';
  w.localStorage.setItem(STORAGE_KEY,JSON.stringify(newer));
  w.document.querySelector('#alias-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  assert.match(w.document.querySelector('#alias-error').textContent,/已变化/);
  assert.deepEqual(JSON.parse(w.localStorage.getItem(STORAGE_KEY)),newer);
  const failed=await page(JSON.stringify(newer));t.after(()=>failed.happyDOM.close());
  click(failed,'.person[data-id="gm"] .person-main');click(failed,'#detail-title');
  const backing=failed.localStorage,originalSet=backing.setItem.bind(backing);
  Object.defineProperty(failed,'localStorage',{configurable:true,value:{getItem:key=>backing.getItem(key),setItem:(key,value)=>{if(key===STORAGE_KEY)throw new Error('quota');originalSet(key,value);}}});
  failed.document.querySelector('#alias-input').value='新备注';
  failed.document.querySelector('#alias-form').dispatchEvent(new failed.Event('submit',{bubbles:true,cancelable:true}));
  assert.match(failed.document.querySelector('#alias-error').textContent,/保存失败/);
  assert.equal(failed.document.querySelector('#alias-form').hidden,false);
  assert.deepEqual(JSON.parse(backing.getItem(STORAGE_KEY)),newer);
});

test('stale delete confirmation cannot erase a newly added descendant',async t=>{
  const raw=JSON.stringify(data),w=await page(raw);t.after(()=>w.happyDOM.close());
  click(w,'.person[data-id="gm"] .person-main');click(w,'#delete-person');
  const newer=structuredClone(data);newer.people.push({id:'new',parentId:'gm',relation:'s',title:'儿子'});
  w.localStorage.setItem(STORAGE_KEY,JSON.stringify(newer));
  click(w,'#confirm-action');
  assert.match(w.document.querySelector('#confirm-error').textContent,/已变化/);
  assert.deepEqual(JSON.parse(w.localStorage.getItem(STORAGE_KEY)),newer);
});

test('change management shows diffs, saves a named checkpoint and restores an earlier version',async t=>{
  const raw=JSON.stringify({version:1,people:[data.people[0],data.people[1]]}),w=await page(raw);t.after(()=>w.happyDOM.close());
  click(w,'.person[data-id="dad"] .add-person');choose(w,'m');submit(w);
  const added=JSON.parse(w.localStorage.getItem(STORAGE_KEY));assert.equal(added.people.length,3);
  click(w,'#show-backups');
  assert.equal(w.document.querySelector('#backup-title').textContent,'变更管理');
  assert.match(w.document.querySelector('#backup-list').textContent,/添加/);
  assert.equal(w.document.querySelectorAll('.current-badge').length,1);
  click(w,'#backup-list button');
  assert.match(w.document.querySelector('#version-diff').textContent,/添加「奶奶」/);
  assert.equal(w.document.querySelector('#version-before').disabled,false);
  w.document.querySelector('#checkpoint-name').value='过年前';
  w.document.querySelector('#checkpoint-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  assert.match(w.document.querySelector('#backup-list').textContent,/过年前/);
  assert.equal(w.document.querySelector('.history-row[aria-current="true"] .history-summary').textContent,'过年前');
  const addRow=[...w.document.querySelectorAll('.backup-row')].find(row=>row.textContent.includes('添加'));
  addRow.querySelector('button').click();
  assert.equal(addRow.querySelector('button').getAttribute('aria-pressed'),'true');
  assert.equal(w.document.querySelector('.history-row[aria-current="true"] .history-summary').textContent,'过年前','selection does not move the current-version marker');
  click(w,'#version-before');
  assert.match(w.document.querySelector('#confirm-items').textContent,/删除「奶奶」/);
  click(w,'#confirm-action');assert.deepEqual(JSON.parse(w.localStorage.getItem(STORAGE_KEY)),migrateState(JSON.parse(raw)));
  click(w,'#show-backups');
  assert.match(w.document.querySelector('#backup-list').textContent,/恢复/);
  assert.equal(w.document.querySelectorAll('.history-restore-edge').length,1);
  click(w,'.history-row[data-kind="restore"]');
  assert.match(w.document.querySelector('#version-source').textContent,/恢复来源：添加.*操作前/);
  assert.match(w.document.querySelector('#backup-list').textContent,/过年前/);
  const checkpointRow=[...w.document.querySelectorAll('.backup-row')].find(row=>row.textContent.includes('过年前'));
  checkpointRow.querySelector('button').click();click(w,'#version-after');click(w,'#confirm-action');
  assert.deepEqual(JSON.parse(w.localStorage.getItem(STORAGE_KEY)),added);
  const entries=Array.from({length:w.localStorage.length},(_,index)=>[w.localStorage.key(index),w.localStorage.getItem(w.localStorage.key(index))]);
  const reopened=await page(undefined,{setup(win){for(const [key,value]of entries)win.localStorage.setItem(key,value);}});t.after(()=>reopened.happyDOM.close());
  click(reopened,'#show-backups');
  assert.match(reopened.document.querySelector('#backup-list').textContent,/过年前/);
  assert.match(reopened.document.querySelector('#backup-list').textContent,/恢复/);
  assert.equal(reopened.document.querySelectorAll('.history-restore-edge').length,2);
});

test('compact management actions are direct, clear state stays fresh and every view control has a text hint',async t=>{
  const w=await page();t.after(()=>w.happyDOM.close());
  assert.equal(w.document.querySelector('#manage'),null);
  assert.equal(w.document.querySelector('#management-dialog'),null);
  assert.deepEqual([...w.document.querySelectorAll('.management-card button')].map(button=>button.id),['show-help','organize-tree','show-backups','clear-tree']);
  const toolbar=w.document.querySelector('.viewport-controls');
  assert.equal(toolbar.querySelector('#view-mode').textContent,'2D');
  for(const button of toolbar.querySelectorAll('button'))assert.equal(button.dataset.tooltip,button.getAttribute('aria-label'));
  assert.equal(toolbar.querySelector('#reset-view').dataset.tooltip,'回到原点');
  assert.equal(w.document.querySelector('#clear-tree').disabled,true);
  click(w,'#show-backups');
  assert.equal(w.document.querySelector('#backup-dialog').open,true);
  assert.equal(w.document.querySelector('.history-row.is-current .history-summary').textContent,'当前资料');
  click(w,'[data-close-dialog="backup-dialog"]');
  click(w,'.add-person');choose(w,'f');submit(w);
  assert.equal(w.document.querySelector('#clear-tree').disabled,false);
  click(w,'#clear-tree');assert.equal(w.document.querySelector('#confirm-dialog').open,true);
  click(w,'#confirm-cancel');assert.equal(JSON.parse(w.localStorage.getItem(STORAGE_KEY)).people.length,2);
  click(w,'#clear-tree');click(w,'#confirm-action');
  assert.equal(w.document.querySelector('#clear-tree').disabled,true);
});

test('history renders checkpoint names as literal text and keeps full text available for truncated rows',async t=>{
  const w=await page(JSON.stringify(data));t.after(()=>w.happyDOM.close());click(w,'#show-backups');
  const name='<img src=x onerror=alert(1)>很长的存档点名称';
  w.document.querySelector('#checkpoint-name').value=name;
  w.document.querySelector('#checkpoint-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  const row=w.document.querySelector('.history-row[data-kind="checkpoint"]');
  assert.equal(row.querySelector('.history-summary').textContent,name);
  assert.equal(row.querySelector('.history-summary').title,name);
  assert.equal(w.document.querySelector('#backup-list img'),null);
  assert.equal(w.document.querySelectorAll('.history-row[aria-pressed="true"]').length,1);
  assert.equal(w.document.querySelector('#version-detail').hidden,false);
});

test('deleting a branch preserves 2D zoom, camera placement and all surviving star coordinates',async t=>{
  const w=await page(JSON.stringify(data));t.after(()=>w.happyDOM.close());
  click(w,'.person[data-id="gm"] .person-main');click(w,'.path-step[data-id="dad"]');
  click(w,'#zoom-in');click(w,'#zoom-in');
  const state=()=>({zoom:w.document.querySelector('#tree-scroll').dataset.zoom,
    me:[w.document.querySelector('.person[data-id="me"]').style.left,w.document.querySelector('.person[data-id="me"]').style.top],
    dad:[w.document.querySelector('.person[data-id="dad"]').style.left,w.document.querySelector('.person[data-id="dad"]').style.top]});
  const before=state();
  click(w,'.person[data-id="gm"] .person-main');assert.deepEqual(state(),before);
  click(w,'#delete-person');click(w,'#confirm-action');
  assert.deepEqual(state(),before);
  assert.equal(w.document.querySelectorAll('.person').length,2);
});

test('selecting a star stops an unfinished 2D zoom at the visible scale',async t=>{
  const callbacks=new Map();let id=0;
  const w=await page(JSON.stringify(data),{motion:true,setup(win){win.requestAnimationFrame=cb=>{callbacks.set(++id,cb);return id;};win.cancelAnimationFrame=key=>callbacks.delete(key);}});
  t.after(()=>w.happyDOM.close());
  click(w,'#zoom-in');
  const tick=[...callbacks.values()][0];callbacks.clear();tick(16);
  const zoom=w.document.querySelector('#tree-scroll').dataset.zoom;
  assert.ok(Number(zoom)>1);
  click(w,'.person[data-id="dad"] .person-main');assert.equal(callbacks.size,0);
  assert.equal(w.document.querySelector('#tree-scroll').dataset.zoom,zoom);
});


test('named friends build independent trees, edit names in place and delete only their own branch',async t=>{
 const w=await page();t.after(()=>w.happyDOM.close());
 click(w,'.person[data-id="me"] .add-person');choose(w,'friend');submit(w);
 assert.match(w.document.querySelector('#form-error').textContent,/必须填写姓名/);assert.equal(w.localStorage.getItem(STORAGE_KEY),null);
 w.document.querySelector('#kin-name').value='李四';submit(w);
 let saved=JSON.parse(w.localStorage.getItem(STORAGE_KEY)),friend=saved.people.at(-1).id;
 assert.equal(w.document.querySelector('#detail-title').textContent,'李四（朋友）');
 click(w,`.person[data-id="${friend}"] .add-person`);assert.equal(w.document.querySelector('input[value="friend"]').disabled,true);choose(w,'f');submit(w);
 saved=JSON.parse(w.localStorage.getItem(STORAGE_KEY));const dad=saved.people.at(-1).id;
 assert.equal(w.document.querySelector('#detail-title').textContent,'李四的爸爸');assert.equal(w.document.querySelector('#detail-path').textContent,'我的朋友李四的爸爸');
 assert.equal(w.document.querySelectorAll('#detail-path [aria-pressed="true"]').length,3);
 click(w,'#detail-title');w.document.querySelector('#person-name').value='张三';w.document.querySelector('#alias-input').value='老爸';
 const point=w.document.querySelector(`.person[data-id="${dad}"]`).style.cssText;
 w.document.querySelector('#alias-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 assert.equal(w.document.querySelector('#detail-title').textContent,'张三（李四的老爸）');assert.equal(w.document.querySelector(`.person[data-id="${dad}"]`).style.cssText,point);
 click(w,`#detail-path [data-id="${friend}"]`);assert.equal(w.document.querySelectorAll('#detail-path [aria-pressed="true"]').length,2);
 const me=w.document.querySelector('.person[data-id="me"]').style.cssText;
 click(w,'#delete-person');assert.match(w.document.querySelector('#confirm-description').textContent,/2 位/);click(w,'#confirm-action');
 saved=JSON.parse(w.localStorage.getItem(STORAGE_KEY));assert.equal(saved.people.length,1);assert.deepEqual(saved.socialEdges,[]);assert.equal(w.document.querySelector('.person[data-id="me"]').style.cssText,me);
 click(w,'#undo-last');click(w,'#confirm-action');assert.equal(w.document.querySelectorAll('.person').length,3);
});

test('relation review offers outlined actions and changing relation preserves entered name and custom title',async t=>{
 const w=await page(JSON.stringify(data));t.after(()=>w.happyDOM.close());
 const style=w.document.createElement('style');style.textContent=await readFile(new URL('../src/style.css',import.meta.url),'utf8');w.document.head.append(style);
 click(w,'.person[data-id="dad"] .add-person');choose(w,'h');
 w.document.querySelector('#kin-name').value='张三';w.document.querySelector('#kin-title').value='自定义称呼';
 for(const button of w.document.querySelectorAll('#optimization button')){const css=w.getComputedStyle(button);assert.equal(css.borderTopStyle,'solid');assert.notEqual(css.borderTopColor,'transparent');}
 click(w,'#change-relation');choose(w,'w');assert.equal(w.document.querySelector('#kin-name').value,'张三');assert.equal(w.document.querySelector('#kin-title').value,'自定义称呼');
 click(w,'#cancel');assert.equal(w.localStorage.getItem(STORAGE_KEY),JSON.stringify(data));
});


test('WASD resumes after path navigation and profile save without changing zoom',async t=>{
 const callbacks=new Map();let frame=0,time=0;
 const w=await page(JSON.stringify(data),{setup(win){win.requestAnimationFrame=cb=>{callbacks.set(++frame,cb);return frame;};win.cancelAnimationFrame=id=>callbacks.delete(id);}});t.after(()=>w.happyDOM.close());
 const step=()=>{time+=16;const pending=[...callbacks.values()];callbacks.clear();for(const cb of pending)cb(time);};
 const move=()=>{const node=w.document.querySelector('.person[data-id="me"]'),surface=w.document.querySelector('#tree-scroll'),before=parseFloat(node.style.left),zoom=surface.dataset.zoom;
 const button=w.document.activeElement;button.dispatchEvent(new w.KeyboardEvent('keydown',{key:'d',code:'KeyD',bubbles:true,cancelable:true}));step();button.dispatchEvent(new w.KeyboardEvent('keyup',{key:'d',code:'KeyD',bubbles:true}));
 assert.ok(parseFloat(node.style.left)<before);assert.equal(surface.dataset.zoom,zoom);assert.equal(callbacks.size,0);};
 click(w,'.person[data-id="gm"] .person-main');click(w,'#detail-path [data-id="dad"]');assert.equal(w.document.activeElement.dataset.id,'dad');move();
 click(w,'#detail-title');w.document.querySelector('#alias-input').value='老爸';w.document.querySelector('#alias-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 assert.equal(w.document.activeElement.id,'detail-title');move();
});
