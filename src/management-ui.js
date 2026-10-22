import { initialState, pathText, suggestTitle, displayName, subtreePeople, deleteSubtree, personPathText, rootLabel } from './domain.js';
import { loadState } from './storage.js';
import { scanTree, applyDecisions, fingerprint } from './organize.js';
import { commitWithBackup, createCheckpoint, listSnapshots, readSnapshot } from './snapshots.js';
import { diffStates, HISTORY_LABELS } from './history.js';
import { buildHistoryGraph, renderHistoryGraph } from './history-graph.js';
export function installManagement({ storage, onChange, onError }) {
  const $=id=>document.getElementById(id);
  const create=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
  const timeText=snapshot=>snapshot.createdAt?new Date(snapshot.createdAt).toLocaleString():'日期未知';
  const choice=(text,value)=>{const option=create('option',text);option.value=value;return option;};
  let scan=null, baseline=null, suggestions=[],pending=null,returnDialog=null,lastBackup=null;
  function closeAll(){for(const id of ['organize-dialog','backup-dialog','help-dialog'])if($(id).open)$(id).close();}
  function fail(error,id='organize-error'){$(id).textContent=error.message;$(id).hidden=false;}
  function confirmed(description,items,action,back=null){
    closeAll();pending=action;returnDialog=back;$('confirm-description').textContent=description;
    $('confirm-items').replaceChildren(...items.map(item=>create('li',item)));$('confirm-error').hidden=true;
    $('confirm-action').textContent=description.startsWith('删除')?'确认删除':description.startsWith('清除')?'确认清除':description.startsWith('恢复')?'确认恢复':'确认应用';$('confirm-dialog').showModal();
  }
  function feedback(key,text){lastBackup=key;$('undo-last').hidden=false;$('feedback-text').textContent=text;$('action-feedback').hidden=false;}
  function refreshRecovery(){
    try{const state=loadState(storage),snapshots=listSnapshots(storage);$('restore-cleared').hidden=state.people.length>1||!snapshots.some(s=>s.kind==='clear');$('clear-tree').disabled=state.people.length===1;}
    catch(error){$('restore-cleared').hidden=true;onError(error.message);}
  }
  async function organize(){
    closeAll();$('organize-dialog').showModal();$('organize-error').hidden=true;$('suggestions').replaceChildren();$('preview-organize').disabled=true;
    scan?.abort();const controller=new AbortController();scan=controller;
    try{
      baseline=loadState(storage);suggestions=await scanTree(baseline,{signal:controller.signal,onProgress:(n,total)=>{$('scan-progress').textContent='正在检查 '+n+' / '+total;}});
      if(scan!==controller)return;
      $('scan-progress').textContent=suggestions.length?'发现 '+suggestions.length+' 项建议，选择后预览。':'暂无整理建议';
      for(const suggestion of suggestions){
        const person=baseline.people.find(p=>p.id===suggestion.personId),row=create('section');row.className='suggestion';row.dataset.id=person.id;
        row.append(create('h3',displayName(person,baseline)+' · 记录 '+baseline.people.findIndex(p=>p.id===person.id)),create('p',pathText(suggestion.originalPath,rootLabel(baseline,person.id))));
        if(suggestion.ambiguous)row.append(create('p','存在多种可能，请按实际人物选择。'));
        const select=create('select');select.setAttribute('aria-label','整理'+displayName(person,baseline));select.className='decision';select.append(choice('保留原关系','keep'));
        for(const option of suggestion.options)select.append(choice(option.kind==='existing'
          ?'合并到 '+displayName(baseline.people.find(p=>p.id===option.personId),baseline)+' · '+pathText(option.path,rootLabel(baseline,person.id))+' · 记录 '+baseline.people.findIndex(p=>p.id===option.personId)
          :'缩短为 '+pathText(option.path,rootLabel(baseline,person.id))+'（'+suggestTitle(option.path)+'）',option.key));
        const titleChoice=create('select');titleChoice.className='title-choice';titleChoice.setAttribute('aria-label','合并后称呼');titleChoice.hidden=true;
        select.addEventListener('change',()=>{
          const option=suggestion.options.find(o=>o.key===select.value),target=option?.kind==='existing'?baseline.people.find(p=>p.id===option.personId):null;
          titleChoice.replaceChildren();titleChoice.hidden=!target||displayName(target,baseline)===displayName(person,baseline);
          if(!titleChoice.hidden)titleChoice.append(choice('请选择保留的称呼',''),choice('保留 '+displayName(target,baseline)+'（原称呼：'+target.title+'）','target'),choice('使用 '+displayName(person,baseline)+'（原称呼：'+person.title+'）','source'));
        });
        row.append(select,titleChoice);$('suggestions').append(row);
      }
      $('preview-organize').disabled=!suggestions.length;
    }catch(error){if(error.name!=='AbortError')fail(error);}
  }
  function preview(){try{
    if(fingerprint(loadState(storage))!==fingerprint(baseline))throw new Error('资料已变化，请关闭后重新扫描。');
    const decisions=[...$('suggestions').children].map(row=>({personId:row.dataset.id,optionKey:row.querySelector('.decision').value,titleChoice:row.querySelector('.title-choice').value}));
    const result=applyDecisions(baseline,decisions);
    const items=result.changes.map(change=>{
      const source=baseline.people.find(p=>p.id===change.personId);
      if(change.kind==='shorten')return displayName(source)+'：'+personPathText(baseline,source.id)+' → '+personPathText(result.state,source.id);
      const target=result.state.people.find(p=>p.id===change.targetId),children=baseline.people.filter(p=>p.parentId===source.id);
      return '合并 '+displayName(source)+'（'+personPathText(baseline,source.id)+'）到 '+displayName(target)+'（'+personPathText(result.state,target.id)+'）；直接后代 '+children.length+' 位随同保留，最终称呼：'+displayName(target);
    });
    confirmed('应用 '+result.changes.length+' 项整理，亲人数 '+(baseline.people.length-1)+' → '+(result.state.people.length-1)+'。操作前会保存完整备份。',items,()=>{
      const key=commitWithBackup(storage,baseline,result.state,'organize');onChange(result.state,result.remap);feedback(key,'整理已完成');
    },'organize-dialog');
  }catch(error){fail(error);}}
  function deletePerson(id){try{
    const before=loadState(storage),people=subtreePeople(before,id);
    if(id==='me')throw new Error('不能删除“我”。');
    const person=before.people.find(p=>p.id===id);
    confirmed('删除「'+displayName(person,before)+'」及其全部后代，共 '+people.length+' 位。操作前保存备份，可撤销。',
      people.map(p=>displayName(p,before)+' · '+personPathText(before,p.id)),()=>{
        const next=deleteSubtree(before,id),key=commitWithBackup(storage,before,next,'delete');
        onChange(next,null,{clearSelection:true,preserveView:true,preserveLayout:true});feedback(key,'已删除 '+people.length+' 位，可撤销');
      });
  }catch(error){onError(error.message);}}
  function clear(){try{
    const before=loadState(storage);if(before.people.length===1)return;
    confirmed('清除当前全部 '+(before.people.length-1)+' 位亲人，重置为“我”。备份保留，可恢复。',before.people.filter(p=>p.id!=='me').map(p=>displayName(p,before)+' · '+personPathText(before,p.id)),()=>{
      const next=initialState(),key=commitWithBackup(storage,before,next,'clear');onChange(next);feedback(key,'已清除，可撤销');
    });
  }catch(error){onError(error.message);}}
  function restore(key,stage='before'){try{
    const snapshot=readSnapshot(storage,key),before=loadState(storage),target=snapshot[stage];
    if(!target)throw new Error('找不到该版本。');
    if(fingerprint(before)===fingerprint(target))throw new Error('当前资料已经是该版本。');
    const back=$('backup-dialog').open?'backup-dialog':$('help-dialog').open?'help-dialog':null;
    const changes=diffStates(before,target);
    confirmed('恢复到'+(snapshot.label?'「'+snapshot.label+'」':'所选记录')+'的操作'+(stage==='before'?'前':'后')+'，亲人数 '+(before.people.length-1)+' → '+(target.people.length-1)+'。当前资料会先保存为新版本。',
      changes.map(change=>change.text).length?changes.map(change=>change.text):['资料内容已变化'],
      ()=>{const backup=commitWithBackup(storage,before,target,'restore',undefined,{key,stage});onChange(target);feedback(backup,'资料已恢复');},back);
  }catch(error){if($('backup-dialog').open)fail(error,'version-error');else onError(error.message);}}
  function showVersion(key){try{
    const snapshot=readSnapshot(storage,key),changes=diffStates(snapshot.before,snapshot.after),current=loadState(storage);
    $('version-detail').hidden=false;
    $('backup-dialog').classList.add('has-detail');
    for(const row of $('backup-list').querySelectorAll('[data-snapshot-key]'))row.setAttribute('aria-pressed',String(row.dataset.snapshotKey===key));
    $('version-title').textContent=(snapshot.label||HISTORY_LABELS[snapshot.kind])+' · '+timeText(snapshot);
    $('version-counts').textContent='操作前 '+(snapshot.before.people.length-1)+' 位 → 操作后 '+(snapshot.after.people.length-1)+' 位'+(snapshot.status==='pending'?' · 写入状态待确认':'');
    $('version-source').hidden=!snapshot.restoreSource;
    if(snapshot.restoreSource){
      try{const source=readSnapshot(storage,snapshot.restoreSource.key);
        $('version-source').textContent='恢复来源：'+(source.label||HISTORY_LABELS[source.kind])+' · '+timeText(source)+' · 操作'+(snapshot.restoreSource.stage==='before'?'前':'后');
      }catch(error){$('version-source').textContent='恢复来源记录无法读取：'+error.message;}
    }
    $('version-diff').replaceChildren(...(changes.length?changes.map(change=>create('li',change.text)):[create('li','资料未变化')]));
    const currentChanges=diffStates(current,snapshot.after);
    $('version-current-diff').replaceChildren(...(currentChanges.length?currentChanges.map(change=>create('li',change.text)):[create('li','与当前资料相同')]));
    for(const [stage,id]of [['before','version-before'],['after','version-after']]){
      const button=$(id);button.disabled=fingerprint(current)===fingerprint(snapshot[stage]);
      button.onclick=()=>restore(key,stage);
    }
    $('version-error').hidden=true;
  }catch(error){fail(error,'version-error');}}
  function backups(){try{
    closeAll();const snapshots=listSnapshots(storage),current=loadState(storage);$('version-detail').hidden=true;$('version-error').hidden=true;
    $('backup-dialog').classList.remove('has-detail');
    $('version-current').textContent=(current.people.length-1)+' 位亲人';
    renderHistoryGraph($('backup-list'),buildHistoryGraph(snapshots,current),showVersion);
    $('backup-dialog').showModal();
  }catch(error){onError(error.message);}}
  $('show-help').addEventListener('click',()=>{closeAll();refreshRecovery();$('help-dialog').showModal();});
  $('organize-tree').addEventListener('click',organize);$('preview-organize').addEventListener('click',preview);$('clear-tree').addEventListener('click',clear);$('show-backups').addEventListener('click',backups);
  $('checkpoint-form').addEventListener('submit',event=>{event.preventDefault();try{const key=createCheckpoint(storage,$('checkpoint-name').value);$('checkpoint-name').value='';backups();showVersion(key);}catch(error){fail(error,'version-error');}});
  for(const button of document.querySelectorAll('[data-close-dialog]'))button.addEventListener('click',()=>$(button.dataset.closeDialog).close());
  $('organize-dialog').addEventListener('close',()=>{scan?.abort();scan=null;});
  $('confirm-cancel').addEventListener('click',()=>{$('confirm-dialog').close();if(returnDialog)$(returnDialog).showModal();pending=null;});
  $('confirm-dialog').addEventListener('cancel',()=>{pending=null;});
  $('confirm-action').addEventListener('click',()=>{if(!pending)return;try{pending();pending=null;$('confirm-dialog').close();refreshRecovery();}catch(error){fail(error,'confirm-error');}});
  $('undo-last').addEventListener('click',()=>{if(lastBackup)restore(lastBackup);});$('dismiss-feedback').addEventListener('click',()=>{$('action-feedback').hidden=true;});
  $('restore-cleared').addEventListener('click',()=>{try{const snapshot=listSnapshots(storage).find(s=>s.kind==='clear');if(snapshot)restore(snapshot.key);}catch(error){onError(error.message);}});
  return {refreshRecovery,deletePerson,close(){scan?.abort();closeAll();if($('confirm-dialog').open)$('confirm-dialog').close();pending=null;}};
}
