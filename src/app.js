import { RELATIONS, pathCodes, pathText, suggestTitle, displayName, updateAlias } from './domain.js';
import { loadState } from './storage.js';
import { layoutTree } from './layout.js';
import { ancestorChain } from './query.js';
import { installViewport, project } from './viewport.js';
import { analyzeAddition, applyAddition } from './optimization.js';
import { installManagement } from './management-ui.js';
import { fingerprint } from './organize.js';
import { commitWithBackup } from './snapshots.js';

const $ = id => document.getElementById(id);
const details = $('details'), dialog = $('add-dialog'), form = $('add-form');
const relationByCode = new Map(RELATIONS.map(r => [r.code, r]));
const nodesById = new Map();
let state, selectedId = null, queryId = null, parentId = null, autoTitle = '', positions = new Map();
let aliasEdit = null, additionBaseline = null;
const svgNS = 'http://www.w3.org/2000/svg';
let scene3d = null, viewMode = '2d', desiredMode = '3d', modeRequest = 0, management = null;
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function notice(message) { $('notice-text').textContent = message; $('notice').hidden = !message; }
function findNode(id) { return nodesById.get(id); }
function centerOn(id, animate = true) { if (viewMode === '3d') scene3d?.focus(id, animate); else if (positions.has(id)) viewport.center(positions.get(id), false, animate); }
function stopViewMotion() { if (viewMode === '3d') scene3d?.interrupt(); else viewport.stop(); }
let detailTransition = null;
function cancelDetailTransition() {
  if (!detailTransition) return;
  detailTransition.incoming.cancel();
  detailTransition.outgoing?.cancel();
  detailTransition.ghost?.remove();
  detailTransition = null;
}
function renderDetails(chain) {
  const content = $('detail-content');
  const changed = !details.hidden && selectedId && details.dataset.personId !== queryId;
  const animate = changed && !window.matchMedia('(prefers-reduced-motion: reduce)').matches && typeof content.animate === 'function';
  const opacity = animate ? window.getComputedStyle(content).opacity : '1';
  const ghost = animate ? content.cloneNode(true) : null;
  cancelDetailTransition();
  details.hidden = !selectedId;
  $('detail-path').replaceChildren();
  if(aliasEdit?.id!==queryId)cancelAlias(false);
  if (!selectedId) { cancelAlias(false); delete details.dataset.personId; return; }
  details.dataset.personId = queryId;
  const displayed=chain.find(person => person.id === queryId);
  $('detail-title').textContent = displayName(displayed);
  $('detail-title').setAttribute('aria-label','修改'+displayName(displayed)+'的备注名');
  $('delete-person').hidden=displayed.id==='me';
  const activeIndex = chain.findIndex(person => person.id === queryId);
  for (const [index, person] of chain.entries()) {
    const label = person.id === 'me' ? '我' : relationByCode.get(person.relation).label;
    const button = element('button', 'path-step', label + (index < chain.length - 1 ? '的' : ''));
    button.type = 'button'; button.dataset.id = person.id;
    button.setAttribute('aria-pressed', String(index <= activeIndex));
    if (person.id === queryId) button.setAttribute('aria-current', 'step');
    button.addEventListener('click', () => {
      queryId = person.id; updateSelection(); centerOn(person.id);
      [...$('detail-path').querySelectorAll('button')].find(b => b.dataset.id === person.id)?.focus({ preventScroll:true });
      $('announcement').textContent = '已回溯到' + displayName(person);
    });
    $('detail-path').append(button);
  }
  if (animate) {
    ghost.removeAttribute('id');
    for (const node of ghost.querySelectorAll('[id]')) node.removeAttribute('id');
    ghost.classList.add('outgoing'); ghost.setAttribute('aria-hidden', 'true'); ghost.inert = true;
    for (const button of ghost.querySelectorAll('button')) button.tabIndex = -1;
    details.append(ghost);
    const timing = { duration:180, easing:'ease-out' };
    const incoming = content.animate([{ opacity:.25 }, { opacity:1 }], timing);
    const outgoing = ghost.animate([{ opacity:Number(opacity) || 1 }, { opacity:0 }], timing);
    const transition = { incoming, outgoing, ghost };
    detailTransition = transition;
    outgoing.onfinish = () => {
      ghost.remove();
      if (detailTransition === transition) detailTransition = null;
    };
  }
}
function render({ preserveLayout = false } = {}) {
  const tree = $('tree');
  const layout = layoutTree(state, Math.max(320, $('tree-scroll').clientWidth), Math.max(500, $('tree-scroll').clientHeight));
  positions = preserveLayout ? new Map([...layout.positions].map(([id,point])=>[id,positions.get(id) ?? point])) : layout.positions;
  tree.style.width = '100%'; tree.style.height = '100%';
  tree.replaceChildren();
  nodesById.clear();
  const lines = document.createElementNS(svgNS, 'svg');
  lines.setAttribute('width', '100%'); lines.setAttribute('height', '100%');
  lines.setAttribute('aria-hidden', 'true'); lines.classList.add('connections');
  for (const person of state.people) {
    if (person.parentId === null) continue;
    const line = document.createElementNS(svgNS, 'path');
    line.dataset.id = person.id; line.dataset.parentId = person.parentId; lines.append(line);
  }
  tree.append(lines);
  for (const [index, person] of state.people.entries()) {
    const wrap = element('div', 'person' + (person.id === 'me' ? ' root-person' : ''));
    wrap.dataset.id = person.id; wrap.style.setProperty('--breath-delay', '-' + index * .61 + 's');
    const node = element('button', 'person-main');
    node.type = 'button'; node.title = displayName(person);
    node.setAttribute('aria-label', '查看' + displayName(person) + '的信息'); node.setAttribute('aria-controls', 'details');
    const star = element('span', 'person-symbol'); star.setAttribute('aria-hidden', 'true');
    node.append(star, element('span', 'person-title', displayName(person)));
    node.addEventListener('click', () => {
      stopViewMotion();
      selectedId = queryId === person.id ? null : person.id; queryId = selectedId;
      updateSelection();
      findNode(person.id)?.querySelector('.person-main').focus({ preventScroll:true });
    });
    const plus = element('button', 'add-person', '+');
    plus.type = 'button'; plus.setAttribute('aria-label', '为' + displayName(person) + '添加亲人');
    plus.addEventListener('click', () => openAdder(person.id));
    for (const button of [node,plus]) {
      let start=null,dragged=false;
      button.addEventListener('pointerdown',event=>{start={x:event.clientX,y:event.clientY};dragged=false;event.stopPropagation();});
      button.addEventListener('pointermove',event=>{if(start&&Math.hypot(event.clientX-start.x,event.clientY-start.y)>6)dragged=true;});
      button.addEventListener('pointercancel',()=>{dragged=true;start=null;});
      button.addEventListener('click',event=>{start=null;if(dragged){event.preventDefault();event.stopImmediatePropagation();dragged=false;}},true);
    }
    wrap.append(node, plus); tree.append(wrap); nodesById.set(person.id,wrap);
  }
  scene3d?.update(state,{preservePositions:preserveLayout}); updateHome();
  updateSelection();
}
function updateSelection() {
  const chain = selectedId ? ancestorChain(state, selectedId) : [];
  if (selectedId && !chain.some(p => p.id === queryId)) queryId = selectedId;
  const included = new Set(chain.slice(0, chain.findIndex(p => p.id === queryId) + 1).map(p => p.id));
  for (const node of $('tree').querySelectorAll('.person')) {
    const active = node.dataset.id === queryId;
    node.classList.toggle('selected', active);
    node.querySelector('.person-main').setAttribute('aria-expanded', String(active));
  }
  for (const line of $('tree').querySelectorAll('.connections path')) line.classList.toggle('highlighted', included.has(line.dataset.id));
  scene3d?.select(queryId, included);
  renderDetails(chain); applyCamera(viewport.camera);
}
function applyCamera(camera) {
  if (viewMode === '3d') return;
  for (const node of $('tree').querySelectorAll('.person')) {
    const point = project(positions.get(node.dataset.id), camera);
    node.style.left = (point.x - 60) + 'px'; node.style.top = (point.y - 18) + 'px';
  }
  for (const line of $('tree').querySelectorAll('.connections path')) {
    const start = project(positions.get(line.dataset.parentId), camera), end = project(positions.get(line.dataset.id), camera);
    line.setAttribute('d', 'M ' + start.x + ' ' + start.y + ' L ' + end.x + ' ' + end.y);
  }
  $('tree').style.backgroundPosition = camera.x * .15 + 'px ' + camera.y * .15 + 'px';
}
function formError(message) { $('form-error').textContent = message; $('form-error').hidden = !message; }
function cancelAlias(focus=true){
  aliasEdit=null;$('alias-form').hidden=true;$('detail-title').hidden=false;$('alias-error').hidden=true;
  if(focus&&!details.hidden)$('detail-title').focus({preventScroll:true});
}
$('detail-title').addEventListener('click',()=>{
  const person=state.people.find(p=>p.id===queryId);if(!person)return;
  cancelDetailTransition();aliasEdit={id:person.id,before:JSON.stringify(person)};
  $('alias-input').value=person.alias??displayName(person);$('alias-input').placeholder='清空后显示：'+person.title;
  $('alias-error').hidden=true;$('detail-title').hidden=true;$('alias-form').hidden=false;
  $('alias-input').focus();$('alias-input').select();
});
$('alias-cancel').addEventListener('click',()=>cancelAlias());
$('alias-form').addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancelAlias();}});
$('alias-form').addEventListener('submit',event=>{
  event.preventDefault();if(!aliasEdit)return;
  try{
    const latest=loadState(window.localStorage),person=latest.people.find(p=>p.id===aliasEdit.id);
    if(JSON.stringify(person)!==aliasEdit.before)throw new Error('人物资料已变化，请取消后重新编辑。');
    const next=updateAlias(latest,aliasEdit.id,$('alias-input').value);
    if(fingerprint(next)!==fingerprint(latest))commitWithBackup(window.localStorage,latest,next,'alias');
    state=next;cancelAlias(false);render();$('detail-title').focus({preventScroll:true});$('announcement').textContent='备注名已保存';
  }catch(error){$('alias-error').textContent=error.message;$('alias-error').hidden=false;}
});
$('delete-person').addEventListener('click',()=>{cancelAlias(false);management?.deletePerson(queryId);});
function closeAdder() { dialog.close(); }
function openAdder(id) {
  parentId = id; form.reset(); autoTitle = ''; additionBaseline=null; $('kin-title').value = '';
  $('path-preview').textContent = pathText(pathCodes(state, id)) + ' → …';
  $('dialog-title').textContent = '为' + displayName(state.people.find(p => p.id === id)) + '添加亲人';
  $('optimization').hidden = true; $('optimization-options').replaceChildren();$('add-actions').hidden=false;
  formError(''); dialog.showModal(); $('relation-options').querySelector('input').focus();
}
function renderOptimization(analysis,source=state) {
  $('optimization').hidden = !analysis.warning;
  $('add-actions').hidden = analysis.warning;
  additionBaseline=analysis.warning?fingerprint(source):null;
  $('optimization-options').replaceChildren();
  if (!analysis.warning) return;
  $('optimization-heading').textContent=analysis.hasIssues?'检测到问题':'检测到可优化的树关系';
  const issues=(analysis.issues||[]).map(issue=>issue.message).join(' ');
  $('optimization-reason').textContent=(issues?issues+' ':'')+pathText(analysis.originalPath)+
    (analysis.ambiguous?'。存在多种可能，请按实际人物选择。':'');
  for (const option of analysis.options) {
    const button=element('button','optimization-action secondary');button.type='button';button.dataset.decision=option.key;
    const name=option.kind==='existing'?displayName(source.people.find(p=>p.id===option.personId)):suggestTitle(option.path);
    button.append(element('span','','修改为：'+(option.kind==='existing'?'复用':'新建')+'「'+name+'」'),element('small','',pathText(option.path)));
    button.addEventListener('click',()=>saveAddition(option.key));$('optimization-options').append(button);
  }
}
for (const relation of RELATIONS) {
  const label = element('label', 'relation-option'), input = element('input');
  input.type = 'radio'; input.name = 'relation'; input.value = relation.code; input.setAttribute('aria-label', relation.label);
  label.append(input, element('span', '', relation.short));
  input.addEventListener('change', () => {
    try {
      const codes = [...pathCodes(state, parentId), relation.code];
      $('path-preview').textContent = pathText(codes); autoTitle = suggestTitle(codes); $('kin-title').value = autoTitle;
      renderOptimization(analyzeAddition(state, parentId, relation.code)); formError('');
    } catch (error) { formError(error.message); }
  });
  $('relation-options').append(label);
}
function saveAddition(decision) {
  if (!dialog.open) return;
  try {
    const relation = form.querySelector('input[name="relation"]:checked')?.value;
    if (!relation) throw new Error('请选择关系。');
    const title = $('kin-title').value.trim();
    if (!title) { $('kin-title').focus(); throw new Error('请填写称呼。'); }
    const latest = loadState(window.localStorage), analysis = analyzeAddition(latest, parentId, relation);
    if(decision!==undefined&&additionBaseline!==fingerprint(latest)){
      renderOptimization(analysis,latest);throw new Error('资料已变化，请重新选择。');
    }
    if (decision === undefined && analysis.warning) {
      renderOptimization(analysis,latest);
      throw new Error('请确认一个处理选项。');
    }
    const choice = analysis.options.find(o => o.key === decision);
    const savedTitle = choice?.kind === 'new' && title === autoTitle ? suggestTitle(choice.path) : title;
    const result = applyAddition(latest, parentId, relation, savedTitle, crypto.randomUUID(), decision ?? 'original');
    commitWithBackup(window.localStorage,latest,result.state,'add');
    state = result.state; selectedId = result.personId; queryId = result.personId; render(); closeAdder(); centerOn(result.personId);
    $('announcement').textContent = decision?.startsWith('existing:') ? '已定位到已有亲人' : '已添加亲人';
    findNode(result.personId)?.querySelector('.person-main').focus({ preventScroll:true });
  } catch (error) { formError(error.message); }
}
form.addEventListener('submit', event => { event.preventDefault(); saveAddition(); });
$('keep-original').addEventListener('click', () => saveAddition('original'));
for (const id of ['cancel', 'cancel-x','optimization-cancel']) $(id).addEventListener('click', closeAdder);
dialog.addEventListener('close', () => findNode(parentId)?.querySelector('.add-person').focus({ preventScroll:true }));
$('close-details').addEventListener('click', () => {
  const previous = queryId; selectedId = null; queryId = null; updateSelection();
  findNode(previous)?.querySelector('.person-main').focus({ preventScroll:true });
});
function load() {
  try {
    state = loadState(window.localStorage);
    if (selectedId && !state.people.some(p => p.id === selectedId)) { selectedId = null; queryId = null; }
    notice(''); render(); centerOn(queryId ?? 'me', false); management?.refreshHome();
  } catch (error) {
    notice('无法读取亲友资料：' + error.message + ' 原数据未被覆盖。');
    $('tree').replaceChildren(); details.hidden = true;
  }
}
$('retry').addEventListener('click', load);
window.addEventListener('storage', event => { if (!event.key || event.key === 'whoareyou.family.v1') { if (dialog.open) closeAdder(); management?.close(); load(); } });
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (state && $('notice').hidden) { render(); if(viewMode==='2d')centerOn(queryId ?? 'me', false); } }, 100);
});
const viewport = installViewport($('tree-scroll'), applyCamera, {
  enabled:()=>viewMode==='2d' && !$('map-page').hidden && $('notice').hidden && !document.hidden,
});
$('zoom-in').addEventListener('click', () => { if(viewMode==='3d')scene3d?.zoom(1.2);else viewport.zoom(1.2); });
$('zoom-out').addEventListener('click', () => { if(viewMode==='3d')scene3d?.zoom(1/1.2);else viewport.zoom(1/1.2); });
$('reset-view').addEventListener('click', () => { if(viewMode==='3d')scene3d?.focus('me');else if (positions.has('me')) viewport.center(positions.get('me'), true); });
load();

function updateHome() {
  $('home-count').textContent=(state.people.length-1)+' 位亲人';$('enter-map').textContent=state.people.length>1?'继续探索':'开始探索';
  $('enter-map').disabled=false;$('clear-tree').disabled=state.people.length===1;
}
function updateModeButton() {
  const button=$('view-mode'),label=viewMode==='3d'?'切换到 2D':'切换到 3D';
  button.textContent=viewMode.toUpperCase();button.dataset.tooltip=label;button.setAttribute('aria-label',label);
}
async function setMode(mode) {
  desiredMode=mode;const request=++modeRequest;
  viewport.stop();scene3d?.setActive(false);
  if(mode==='3d') {
    $('view-status').hidden=false;$('view-status').textContent='正在打开 3D 星云…';
    try {
      if(typeof window.WebGL2RenderingContext!=='function')throw new Error('当前设备无法启用 3D，已切换为 2D。');
      if(!scene3d){const {createScene3D}=await import('./scene3d.js');if(request!==modeRequest)return;
        scene3d=createScene3D($('scene-host'),$('tree-scroll'),findNode,{inset:()=>details.hidden?0:(details.offsetHeight||140)+90,onError:message=>{$('view-status').textContent=message;$('view-status').hidden=false;},onReady:()=>{$('view-status').hidden=true;}});
        scene3d.update(state);scene3d.fit(false);
      }
      if(request!==modeRequest)return;
      viewMode='3d';$('map-page').classList.add('mode-3d');$('scene-host').hidden=false;updateModeButton();$('view-status').hidden=true;
      $('tree-scroll').setAttribute('aria-label','三维亲友星云：拖动原地转头，WASD 移动，空格上升，左 Shift 下降，滚轮缩放视野');
      updateSelection();scene3d.setActive(!$('map-page').hidden&&!document.hidden);
      if(!$('map-page').hidden)$('tree-scroll').focus({preventScroll:true});return;
    }catch(error){if(request!==modeRequest)return;desiredMode='2d';$('view-status').hidden=false;$('view-status').textContent=error.message+' 可继续使用 2D。';}
  }else{$('view-status').hidden=true;}
  viewMode='2d';$('map-page').classList.remove('mode-3d');$('scene-host').hidden=true;updateModeButton();
  $('tree-scroll').setAttribute('aria-label','二维亲友星图：拖动或 WASD 平移，滚轮缩放');
  for(const node of $('tree').querySelectorAll('.person')){node.hidden=false;node.style.zIndex='';node.classList.remove('label-muted');}
  applyCamera(viewport.camera);
  if(!$('map-page').hidden)$('tree-scroll').focus({preventScroll:true});
}
function route() {
  const map=window.location.hash==='#/map';$('home-page').hidden=map;$('map-page').hidden=!map;
  if(!map){modeRequest++;viewport.stop();scene3d?.setActive(false);management?.close();cancelAlias(false);if(dialog.open)closeAdder();}
  else if(state&&$('notice').hidden){if(scene3d&&viewMode==='3d')scene3d.setActive(!document.hidden);else if(desiredMode==='3d')setMode('3d');}
  if(map)$('tree-scroll').focus({preventScroll:true});else $('enter-map').focus({preventScroll:true});
}
$('enter-map').addEventListener('click',()=>{window.location.hash='/map';route();});
$('go-home').addEventListener('click',()=>{window.location.hash='/home';route();});
$('view-mode').addEventListener('click',()=>setMode(viewMode==='3d'?'2d':'3d'));
$('fit-view').addEventListener('click',()=>{if(viewMode==='3d')scene3d.fit();else{const points=[...positions.values()];const xs=points.map(p=>p.x),ys=points.map(p=>p.y);viewport.fit({x:(Math.min(...xs)+Math.max(...xs))/2,y:(Math.min(...ys)+Math.max(...ys))/2,width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)});}});
management=installManagement({storage:window.localStorage,onError:message=>{ $('feedback-text').textContent=message; $('action-feedback').hidden=false; $('undo-last').hidden=true; },onChange:(next,remap,options={})=>{
  cancelAlias(false);
  if(options.preserveView)stopViewMotion();
  state=next;selectedId=remap?.get(selectedId)||selectedId;queryId=remap?.get(queryId)||queryId;
  if(options.clearSelection){selectedId=null;queryId=null;}
  if(!next.people.some(p=>p.id===selectedId)){selectedId=null;queryId=null;}
  render({preserveLayout:options.preserveLayout});if(!options.preserveView)centerOn(queryId||'me');management.refreshHome();
}});
management.refreshHome();window.addEventListener('hashchange',route);
document.addEventListener('visibilitychange',()=>{viewport.stop();if(viewMode==='3d')scene3d?.setActive(!document.hidden&&!$('map-page').hidden);});
window.addEventListener('pagehide',()=>{scene3d?.dispose();scene3d=null;});
window.addEventListener('resize',()=>scene3d?.resize());
route();

window.addEventListener('pageshow',event=>{if(event.persisted)route();});
