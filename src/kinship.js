import relationship from 'relationship.js';
const labels = { f:'爸爸', m:'妈妈', ob:'哥哥', lb:'弟弟', os:'姐姐', ls:'妹妹', s:'儿子', d:'女儿', h:'丈夫', w:'妻子' };
const decode = {
  爸爸:['f'], 妈妈:['m'], 哥哥:['ob'], 弟弟:['lb'], 姐姐:['os'], 妹妹:['ls'],
  兄弟:['ob','lb'], 姐妹:['os','ls'], 儿子:['s'], 女儿:['d'],
  老公:['h'], 丈夫:['h'], 老婆:['w'], 妻子:['w'], 自己:[],
};
const cache = new Map();
export function kinshipResult(codes) {
  if (codes.some(code => !labels[code])) throw new Error('关系类型无法识别。');
  if (codes.length > 12) return { titles:[], paths:[], ambiguous:false, descriptive:true };
  const key = codes.join(',');
  if (cache.has(key)) return cache.get(key);
  const text = codes.map(code => labels[code]).join('的');
  const titles = codes.length ? [...new Set(relationship({ text, sex:-1 }).map(name => name === '自己' ? '我' : name))] : ['我'];
  const chains = codes.length ? relationship({ text, sex:-1, type:'chain', optimal:true }) : ['自己'];
  const paths = new Map();
  for (const chain of chains) {
    if (chain === '自己') { paths.set('', []); continue; }
    let expanded = [[]];
    for (const term of chain.split('的')) {
      const possibilities = decode[term];
      if (!possibilities) { expanded = []; break; }
      expanded = expanded.flatMap(prefix => possibilities.map(code => [...prefix, code]));
    }
    for (const path of expanded) paths.set(path.join(','), path);
  }
  const result = { titles, paths:[...paths.values()], ambiguous:titles.length > 1, descriptive:titles.length === 0 };
  if (cache.size > 12000) cache.clear();
  cache.set(key, result);
  return result;
}
export function defaultKinshipTitle(codes) {
  const result = kinshipResult(codes);
  return result.titles.join(' / ') || codes.map(code => labels[code]).join('的') || '我';
}
