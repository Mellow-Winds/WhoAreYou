import { migrateState } from './domain.js';
import { loadState, saveState, STORAGE_KEY } from './storage.js';
import { fingerprint } from './organize.js';
export const SNAPSHOT_PREFIX = 'whoareyou.snapshot.v1.';
export const LEGACY_BACKUP_KEY = STORAGE_KEY + '.before-optimization';
export const MIGRATION_BACKUP_KEY = STORAGE_KEY + '.before-v2';
const isRawBackup=key=>key===LEGACY_BACKUP_KEY||key===MIGRATION_BACKUP_KEY;
const snapshotKinds = new Set(['organize', 'clear', 'restore', 'delete', 'add', 'alias', 'checkpoint']);
function validateRestoreSource(source, kind) {
  if (source === undefined) return;
  if (kind !== 'restore' || !source || typeof source.key !== 'string' ||
      !(source.key.startsWith(SNAPSHOT_PREFIX) || isRawBackup(source.key)) ||
      !['before','after'].includes(source.stage)) throw new Error('恢复来源无效。');
}
export function readSnapshot(storage, key) {
  if (isRawBackup(key)) {
    let state;
    try { state = JSON.parse(storage.getItem(key)); }
    catch { throw new Error('早期资料备份无法读取，原始内容已保留。'); }
    state=migrateState(state);
    return { version:1, kind:'checkpoint', label:key===MIGRATION_BACKUP_KEY?'升级前资料':'早期资料备份', createdAt:'', before:state, after:state, status:'committed', legacy:true };
  }
  if (!key.startsWith(SNAPSHOT_PREFIX)) throw new Error('备份编号无效。');
  let record;
  try { record = JSON.parse(storage.getItem(key)); }
  catch { throw new Error('备份无法读取，原始内容已保留。'); }
  if (!record || record.version !== 1 || !snapshotKinds.has(record.kind) || typeof record.createdAt !== 'string' ||
      (record.label !== undefined && (typeof record.label !== 'string' || record.label.length > 80)) ||
      (record.status !== undefined && !['pending','committed'].includes(record.status))) throw new Error('备份格式无效。');
  validateRestoreSource(record.restoreSource, record.kind);
  record.before=migrateState(record.before); record.after=migrateState(record.after);
  return record;
}
export function listSnapshots(storage) {
  const entries = [];
  // Preserve newest-first order for records written in the same millisecond.
  for (let i = storage.length - 1; i >= 0; i--) {
    const key = storage.key(i);
    if (key?.startsWith(SNAPSHOT_PREFIX) || isRawBackup(key)) { try { entries.push({ key, ...readSnapshot(storage, key) }); } catch(error) { entries.push({key,invalid:true,error:error.message,createdAt:''}); } }
  }
  return entries.sort((a,b) => b.createdAt.localeCompare(a.createdAt));
}
export function commitWithBackup(storage, baseline, next, kind, label, restoreSource) {
  next=migrateState(next); baseline=migrateState(baseline);
  if (!snapshotKinds.has(kind) || kind === 'checkpoint') throw new Error('备份操作类型无效。');
  if (label !== undefined && (typeof label !== 'string' || label.length > 80)) throw new Error('存档名称无效。');
  validateRestoreSource(restoreSource, kind);
  if (restoreSource && fingerprint(readSnapshot(storage, restoreSource.key)[restoreSource.stage]) !== fingerprint(next))
    throw new Error('恢复来源与目标资料不一致。');
  if (fingerprint(loadState(storage)) !== fingerprint(baseline)) throw new Error('资料已变化，请重新扫描或确认。');
  const key = SNAPSHOT_PREFIX + crypto.randomUUID();
  const record = { version:1, kind, createdAt:new Date().toISOString(), before:baseline, after:next, status:'pending' };
  if (label) record.label = label;
  if (restoreSource) record.restoreSource = { key:restoreSource.key, stage:restoreSource.stage };
  try { storage.setItem(key, JSON.stringify(record)); }
  catch { throw new Error('备份保存失败，当前资料未更改。请检查浏览器存储空间。'); }
  if (fingerprint(loadState(storage)) !== fingerprint(baseline)) throw new Error('资料已变化，操作已取消，原备份仍保留。');
  try { saveState(storage, next); }
  catch { throw new Error('保存失败，当前资料未更改，操作前备份已保留。'); }
  try { storage.setItem(key, JSON.stringify({ ...record, status:'committed' })); }
  catch { /* A complete before/after copy remains available even if its status cannot be updated. */ }
  return key;
}
export function createCheckpoint(storage, label) {
  if (typeof label !== 'string' || !label.trim() || label.trim().length > 80) throw new Error('请输入 1–80 字的存档名称。');
  const state = loadState(storage), key = SNAPSHOT_PREFIX + crypto.randomUUID();
  const record = { version:1, kind:'checkpoint', label:label.trim(), createdAt:new Date().toISOString(), before:state, after:state, status:'committed' };
  try { storage.setItem(key, JSON.stringify(record)); }
  catch { throw new Error('存档保存失败，当前资料未更改。'); }
  return key;
}
export function restoreSnapshot(storage, key, baseline) {
  return commitWithBackup(storage, baseline, readSnapshot(storage,key).before, 'restore', undefined, {key,stage:'before'});
}
