'use strict';
// 試験用のにせの鍵は、文字列を組み立てて作る（ファイルに鍵らしい並びを残さない）
const FAKE_SK = ['sk', 'abcdefghijklmnopqrstuvwx'].join('-'), FAKE_HEX = 'abcdef0123456789' + 'abcdef0123456789';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const M = require('./mine-qr.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mq-'));
const W = (rel, o) => { const p = path.join(tmp, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o)); return p; };
let ok = 0, ng = 0;
const t = (n, f) => { try { f(); ok++; console.log('PASS ' + n); } catch (e) { ng++; console.log('FAIL ' + n + '\n   ' + e.message); } };
const dict = { entries: [
  { id: 'd1', lang: 'net', kind: 'term', term: 'キャッシュ', summary: '一度取得した内容を手元に残して次は取りに行かずに使う仕組み。更新が反映されない原因になる。', tags: ['キャッシュ'], updatedAt: 1 },
  { id: 'd2', lang: 'net', kind: 'term', term: 'ポート番号', summary: '通信の出入り口を区別する番号。', tags: ['ポート'], updatedAt: 1 } ] };
const qr = { items: [
  { id: 'a', title: 'キャッシュが古い', body: '更新が反映されない', tags: ['キャッシュ'], updatedAt: 1 },
  { id: 'b', title: '四柱推命の蔵干の読み方', body: '蔵干は地支に隠れた天干', tags: ['占い'], updatedAt: 1 },
  { id: 'c', title: '保護メモ', body: 'ひみつ', tags: ['占い'], sensitive: true, updatedAt: 1 },
  { id: 'd', title: 'AI作成のまとめ', body: 'まとめ', tags: ['AI作成'], updatedAt: 1 },
  { id: 'e', title: 'キーは' + FAKE_SK , body: '占い', tags: ['占い'], updatedAt: 1 } ] };
const dp = W('kb/dict/d.json', dict), qp = W('kb/raw/q.json', qr);

t('保護メモ・AI作成タグは数えない', () => {
  const { qr: q } = M.load({ kb: path.join(tmp, 'kb'), qr: [] });
  assert.strictEqual(q.length, 3);
  assert(!q.some((d) => d.title === '保護メモ' || d.title === 'AI作成のまとめ'));
});
t('辞書にある話題は引け、無い話題は穴になる', () => {
  const { qr: q, pk } = M.load({ kb: path.join(tmp, 'kb'), qr: [] });
  const r = M.analyze(q, pk);
  const by = Object.fromEntries(r.rows.map((x) => [x.title, x.state]));
  assert(['sure', 'maybe'].includes(by['キャッシュが古い']), JSON.stringify(by));
  assert(['none', 'weak'].includes(by['四柱推命の蔵干の読み方']), JSON.stringify(by));
});
t('秘密らしい題名は、報告に出ない', () => {
  const { qr: q, pk } = M.load({ kb: path.join(tmp, 'kb'), qr: [] });
  const out = path.join(tmp, 'out'); M.writeReports(M.analyze(q, pk), out, true);
  const all = fs.readFileSync(path.join(out, 'gap-report.txt'), 'utf8') + fs.readFileSync(path.join(out, 'topics-for-claude.txt'), 'utf8');
  assert(!/sk-abcdef/.test(all)); assert(!/ひみつ|蔵干は地支/.test(all), '本文が出ている');
});
t('既定では題名を出さず、タグ名と件数だけ', () => {
  const { qr: q, pk } = M.load({ kb: path.join(tmp, 'kb'), qr: [] });
  const out = path.join(tmp, 'out2'); M.writeReports(M.analyze(q, pk), out, false);
  const s = fs.readFileSync(path.join(out, 'topics-for-claude.txt'), 'utf8');
  assert(/占い/.test(s)); assert(!/蔵干/.test(s));
});
t('元のファイルを変えない／コマンドで動く', () => {
  const b1 = fs.readFileSync(qp, 'utf8') + fs.readFileSync(dp, 'utf8');
  const r = cp.spawnSync(process.execPath, [path.join(__dirname, 'mine-qr.js'), '--kb', path.join(tmp, 'kb'), '--out', path.join(tmp, 'o3')], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(fs.readFileSync(qp, 'utf8') + fs.readFileSync(dp, 'utf8'), b1);
  assert(fs.existsSync(path.join(tmp, 'o3', 'gap-report.txt')));
});
t('メモが無いときは、はっきり止まる', () => {
  W('kb3/dict/d.json', dict);
  const r = cp.spawnSync(process.execPath, [path.join(__dirname, 'mine-qr.js'), '--kb', path.join(tmp, 'kb3'), '--out', path.join(tmp, 'o4')], { encoding: 'utf8' });
  assert.strictEqual(r.status, 1);
});
console.log(ng ? 'FAILED ' + ng : 'ALL PASSED (' + ok + ')'); process.exit(ng ? 1 : 0);
