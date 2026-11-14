'use strict';
// 取説の更新チェック: 公式ページの本文ハッシュを前回と比べ、変化したものを一覧にする。
// 使い方: node tools\check-updates.js [--sources tools\manual-sources.json] [--state manual-state.json] [--init]
const fs = require('fs'), crypto = require('crypto'), path = require('path');

function normalize(html) {
  return String(html).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
const hash = t => crypto.createHash('sha256').update(t).digest('hex').slice(0, 16);

async function check(sources, state, fetchFn, now) {
  const res = { changed: [], same: [], fresh: [], failed: [], state: Object.assign({}, state) };
  for (const s of sources) {
    try {
      const r = await fetchFn(s.url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const h = hash(normalize(await r.text()));
      const prev = state[s.url];
      if (!prev) res.fresh.push(s);
      else if (prev.hash !== h) res.changed.push(s);
      else res.same.push(s);
      res.state[s.url] = { hash: h, checkedAt: now, changedAt: (prev && prev.hash !== h) ? now : (prev ? prev.changedAt : now) };
    } catch (e) { res.failed.push({ s, err: String(e.message || e) }); }
  }
  return res;
}
function report(r) {
  const L = [];
  L.push('変化あり: ' + r.changed.length + ' / 変化なし: ' + r.same.length + ' / 初回記録: ' + r.fresh.length + ' / 読めず: ' + r.failed.length);
  r.changed.forEach(s => L.push('  [変化] ' + s.company + ' ' + s.url + '  → 項目: ' + (s.entries || []).join(', ')));
  r.failed.forEach(f => L.push('  [読めず] ' + f.s.company + ' ' + f.s.url + ' (' + f.err + ')'));
  if (r.changed.length) L.push('→ 変化のあった会社名と上の行をClaudeに貼ると、取説の項目を作り直します。');
  L.push('注意: 日付や広告など動く部分で誤検知することがあります。内容の判断は公式ページで。');
  return L.join('\n');
}
module.exports = { normalize, hash, check, report };

if (require.main === module) {
  const a = process.argv.slice(2), opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  const src = opt('--sources', path.join(__dirname, 'manual-sources.json'));
  const st = opt('--state', path.join(process.cwd(), 'manual-state.json'));
  const sources = JSON.parse(fs.readFileSync(src, 'utf8')).sources;
  let state = {}; try { state = JSON.parse(fs.readFileSync(st, 'utf8')); } catch (e) {}
  const f = u => fetch(u, { headers: { 'user-agent': 'Mozilla/5.0 shirabeeru-check' }, redirect: 'follow' });
  check(sources, a.includes('--init') ? {} : state, f, Date.now()).then(r => {
    fs.writeFileSync(st, JSON.stringify(r.state, null, 1));
    console.log(report(r));
  });
}
