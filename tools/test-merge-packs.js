'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const M = require('./merge-packs.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mrg-'));
const W = (rel, o) => { const p = path.join(tmp, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof o === 'string' ? o : JSON.stringify(o)); return p; };
let ok = 0, ng = 0;
const t = (n, f) => { try { f(); ok++; console.log('PASS ' + n); } catch (e) { ng++; console.log('FAIL ' + n + '\n   ' + e.message); } };
const en = (id, term, ts) => ({ id, lang: 'x', term, summary: term + 'の説明です', updatedAt: ts });
W('kb/dict/code/a.json', { entries: [en('1', '古い', 1), en('2', '二', 5)] });
W('kb/dict/general/b.json', { entries: [en('1', '新しい', 9), en('3', '三', 1)] });
W('kb/dict/x.json', '{ broken');
W('kb/dict/y.json', { nothing: true });
W('kb/.hidden/h.json', { entries: [en('9', '隠し', 1)] });
const before = ['kb/dict/code/a.json', 'kb/dict/general/b.json'].map((f) => fs.readFileSync(path.join(tmp, f), 'utf8'));

t('同じidは新しい方が残り、すべて集まる（隠しフォルダー・壊れたファイルは除く）', () => {
  const { pack, report } = M.merge(path.join(tmp, 'kb'), path.join(tmp, 'kb', 'dict-pack.json'));
  const by = Object.fromEntries(pack.entries.map((e) => [e.id, e.term]));
  assert.deepStrictEqual(by, { 1: '新しい', 2: '二', 3: '三' });
  assert.strictEqual(report.skipped, 2); assert.strictEqual(report.files, 2); assert.strictEqual(report.replaced, 1);
});
t('読む順が逆でも、新しい方が残る', () => {
  W('kb2/dict/a.json', { entries: [en('1', '新しい', 9)] });
  W('kb2/dict/b.json', { entries: [en('1', '古い', 1)] });
  const { pack, report } = M.merge(path.join(tmp, 'kb2'), path.join(tmp, 'kb2', 'dict-pack.json'));
  assert.strictEqual(pack.entries[0].term, '新しい'); assert.strictEqual(report.kept, 1);
});
t('出力先に前のファイルがあれば、消さずに .bak を残す', () => {
  const out = path.join(tmp, 'out', 'dict-pack.json');
  M.writeSafely(out, { entries: [{ term: 'v1' }] });
  const b = M.writeSafely(out, { entries: [{ term: 'v2' }] });
  assert.ok(b && fs.existsSync(b));
  assert.strictEqual(JSON.parse(fs.readFileSync(b, 'utf8')).entries[0].term, 'v1');
  assert.strictEqual(JSON.parse(fs.readFileSync(out, 'utf8')).entries[0].term, 'v2');
  const b2 = M.writeSafely(out, { entries: [{ term: 'v3' }] });
  assert.notStrictEqual(b, b2); assert.ok(fs.existsSync(b) && fs.existsSync(b2));
});
t('前の dict-pack.json の項目は引き継ぐ（消さない）。.bak は読まない', () => {
  const out = path.join(tmp, 'kb', 'dict-pack.json');
  fs.writeFileSync(out, JSON.stringify({ entries: [en('77', '前から入っていた項目', 99)] }));
  fs.writeFileSync(out + '.bak-1', JSON.stringify({ entries: [en('78', 'バックアップ', 99)] }));
  const { pack } = M.merge(path.join(tmp, 'kb'), out);
  assert.ok(pack.entries.some((e) => e.id === '77'));
  assert.ok(!pack.entries.some((e) => e.id === '78'));
  M.writeSafely(out, pack);
  const again = M.merge(path.join(tmp, 'kb'), out).pack;   // 2回続けて実行しても、項目が増減しない
  assert.strictEqual(again.entries.length, pack.entries.length);
});
t('元のパックは変更されない', () => {
  assert.deepStrictEqual(['kb/dict/code/a.json', 'kb/dict/general/b.json'].map((f) => fs.readFileSync(path.join(tmp, f), 'utf8')), before);
});
t('CLI: 項目が0件なら何も書かない／引数なしは使い方を出す', () => {
  fs.mkdirSync(path.join(tmp, 'empty'));
  const out = path.join(tmp, 'empty', 'dict-pack.json');
  const r = cp.spawnSync(process.execPath, [path.join(__dirname, 'merge-packs.js'), '--kb', path.join(tmp, 'empty')], { encoding: 'utf8' });
  assert.strictEqual(r.status, 1); assert.ok(!fs.existsSync(out));
  assert.strictEqual(cp.spawnSync(process.execPath, [path.join(__dirname, 'merge-packs.js')]).status, 2);
});
t('CLI: まとめた結果は、アプリが読める形（entries と builtAt）', () => {
  const r = cp.spawnSync(process.execPath, [path.join(__dirname, 'merge-packs.js'), '--kb', path.join(tmp, 'kb2')], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const j = JSON.parse(fs.readFileSync(path.join(tmp, 'kb2', 'dict-pack.json'), 'utf8'));
  assert.ok(Array.isArray(j.entries) && j.builtAt > 0 && j.app === 'dict-pack');
});
fs.rmSync(tmp, { recursive: true, force: true });
console.log(ng ? ng + ' FAILED' : 'ALL PASSED (' + ok + ')'); process.exit(ng ? 1 : 0);
