import { displayName } from './domain.js';
import { diffStates, HISTORY_LABELS } from './history.js';
import { fingerprint } from './organize.js';

const ROW_HEIGHT = 44;
const COLORS = ['#b5a0ee', '#e4b36f', '#74c6b6', '#e99eb9'];

function summary(snapshot) {
  if (snapshot.invalid) return '损坏记录（已保留）：' + snapshot.error;
  if (snapshot.label) return snapshot.label;
  const label = HISTORY_LABELS[snapshot.kind];
  const changes = diffStates(snapshot.before, snapshot.after);
  if (!changes.length) return label;
  const ids = [...new Set(changes.map(change => change.id))];
  const people = new Map([...snapshot.before.people, ...snapshot.after.people].map(person => [person.id, person]));
  const names = ids.slice(0, 2).map(id => displayName(people.get(id))).join('、');
  return label + '：' + names + (ids.length > 2 ? '等 ' + ids.length + ' 位' : '');
}

export function buildHistoryGraph(snapshots, current) {
  const currentHash = fingerprint(current);
  const rows = snapshots.map(snapshot => ({
    ...snapshot, summary:summary(snapshot),
    committed:!snapshot.invalid && !snapshot.legacy && snapshot.status !== 'pending',
    beforeHash:snapshot.invalid ? null : fingerprint(snapshot.before),
    afterHash:snapshot.invalid ? null : fingerprint(snapshot.after),
  }));
  const currentRow = rows.find(row => row.committed && row.afterHash === currentHash);
  if (currentRow) currentRow.isCurrent = true;
  else rows.unshift({ kind:'current', summary:'当前资料', isCurrent:true });

  const edges = [];
  let previous = null;
  rows.forEach((row, index) => {
    if (!row.committed) return;
    // Connect only verified continuity; legacy/pending records are not assumed to be ancestors.
    if (previous !== null && rows[previous].beforeHash === row.afterHash)
      edges.push({ kind:'change', from:previous, to:index });
    previous = index;
  });
  const indices = new Map(rows.map((row, index) => [row.key, index]));
  const laneEnds = [];
  rows.forEach((row, from) => {
    if (!row.committed || !row.restoreSource) return;
    const to = indices.get(row.restoreSource.key), stage = row.restoreSource.stage;
    if (to === undefined || to <= from || rows[to].invalid ||
        row.afterHash !== rows[to][stage === 'before' ? 'beforeHash' : 'afterHash']) return;
    let lane = laneEnds.findIndex(end => end < from);
    if (lane < 0) lane = laneEnds.length < COLORS.length ? laneEnds.length : laneEnds.indexOf(Math.min(...laneEnds));
    laneEnds[lane] = to;
    edges.push({ kind:'restore', from, to, stage, lane, color:COLORS[lane] });
  });
  return { rows, edges, gutter:36 + laneEnds.length * 14, rowHeight:ROW_HEIGHT };
}

export function renderHistoryGraph(container, graph, onSelect) {
  const doc = container.ownerDocument;
  const el = (tag, className, text) => {
    const node = doc.createElement(tag);node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const list = el('div', 'history-graph');list.setAttribute('role', 'list');
  list.style.setProperty('--graph-gutter', graph.gutter + 'px');
  list.style.setProperty('--history-row-height', graph.rowHeight + 'px');
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('history-lines');svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', graph.gutter);svg.setAttribute('height', graph.rows.length * graph.rowHeight);
  for (const edge of graph.edges) {
    const path = doc.createElementNS(svg.namespaceURI, 'path');
    const y1 = edge.from * graph.rowHeight + graph.rowHeight / 2, y2 = edge.to * graph.rowHeight + graph.rowHeight / 2;
    const x = 34 + (edge.lane || 0) * 14;
    path.setAttribute('d', edge.kind === 'change' ? `M 18 ${y1} L 18 ${y2}` :
      `M 18 ${y1} C ${x} ${y1} ${x} ${y1 + 8} ${x} ${y1 + 20} L ${x} ${y2 - 20} C ${x} ${y2 - 8} ${x} ${y2} 18 ${y2}`);
    path.setAttribute('class', 'history-edge history-' + edge.kind + '-edge');
    if (edge.color) path.style.stroke = edge.color;
    svg.append(path);
  }
  list.append(svg);
  for (const row of graph.rows) {
    const wrapper = el('div', 'backup-row');wrapper.setAttribute('role', 'listitem');
    const selectable = row.key && !row.invalid;
    const button = el(selectable ? 'button' : 'div', 'history-row');
    button.dataset.kind = row.kind || 'invalid';
    if (selectable) {
      button.type = 'button';button.dataset.snapshotKey = row.key;
      button.setAttribute('aria-pressed', 'false');button.setAttribute('aria-controls', 'version-detail');
      button.addEventListener('click', () => onSelect(row.key));
    }
    if (row.isCurrent) { button.classList.add('is-current');button.setAttribute('aria-current', 'true'); }
    if (row.status === 'pending') button.classList.add('is-pending');
    if (row.invalid) button.classList.add('is-invalid');
    const node = el('span', 'history-node');node.setAttribute('aria-hidden', 'true');
    const title = el('span', 'history-summary', row.summary);title.title = row.summary;
    button.append(node, title);
    if (row.isCurrent) button.append(el('span', 'history-badge current-badge', '当前'));
    if (row.legacy) button.append(el('span', 'history-badge', '旧备份'));
    else if (row.kind === 'checkpoint') button.append(el('span', 'history-badge', '存档'));
    if (row.status === 'pending') button.append(el('span', 'history-badge pending-badge', '待确认'));
    if (row.restoreSource) button.append(el('span', 'sr-only', '恢复来源：所选记录的操作' + (row.restoreSource.stage === 'before' ? '前' : '后')));
    if (row.createdAt) {
      const date = new Date(row.createdAt), valid = Number.isFinite(date.getTime());
      const time = el('time', 'history-date', valid ? date.toLocaleString('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false }) : '日期未知');
      if (valid) { time.dateTime = date.toISOString();time.title = date.toLocaleString(); }
      button.append(time);
    }
    wrapper.append(button);list.append(wrapper);
  }
  container.replaceChildren(list);
}
