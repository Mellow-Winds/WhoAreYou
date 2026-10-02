import { initialState, validateState } from './domain.js';
export const STORAGE_KEY = 'whoareyou.family.v1';
export function loadState(storage) {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return initialState();
  let state;
  try { state = JSON.parse(raw); }
  catch { throw new Error('本地资料无法解析，原始内容已保留。'); }
  return validateState(state);
}
export function saveState(storage, state) {
  validateState(state);
  try {
    const previous = storage.getItem?.(STORAGE_KEY);
    const backupKey = STORAGE_KEY + '.before-optimization';
    if (previous && storage.getItem(backupKey) === null) storage.setItem(backupKey, previous);
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
  catch { throw new Error('保存失败：浏览器存储不可用或空间不足。请保留当前页面并重试。'); }
}
