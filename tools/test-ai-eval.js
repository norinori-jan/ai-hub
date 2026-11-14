'use strict';
// 試験用のにせの鍵は、文字列を組み立てて作る（ファイルに鍵らしい並びを残さない）
const FAKE_PAT = ['ghp', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('_');
// node tools/test-ai-eval.js  — 一時フォルダーだけを使い、実データには触れない
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const E = require('./ai-eval.js');
const AI = require('../ai-core.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aieval-'));
const W = (rel, obj) => { const p = path.join(tmp, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf8'); return p; };
const entry = (id, term, summary, extra) => Object.assign({ id, lang: 'js', kind: 'api', term, summary, example: 'x' }, extra || {});
let passed = 0, failed = 0;
function t(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n   ' + (e && e.message)); } }

W('kb/code/js-0001.json', { app: 'dict-pack', builtAt: 1, entries: [
  entry('js-1', 'addEventListener', '要素にイベントの待ち受けを登録する命令。クリックなどに反応させる'),
  entry('js-2', 'querySelector', 'CSSセレクターで最初に一致した要素を1つ取り出す命令'),
  entry('js-3', 'localStorage', 'ブラウザーに文字列を保存し、閉じても残しておく仕組み'),
  entry('js-4', 'fetch', 'ネットワークからデータを取ってくる、Promiseを返す命令')
] });
W('kb/code/js-0002.json', { app: 'dict-pack', builtAt: 2, entries: [
  entry('js-3', 'localStorage', '保存し直した新しい説明。閉じても残る文字列の保管庫', { updatedAt: 99 }), // 同じid・新しい
  entry('py-1', 'enumerate', '繰り返しの中で、番号と値を同時に取り出す関数', { lang: 'py' })
] });
W('kb/general/other.json', { notAPack: true });
W('kb/broken.json', '{ broken');
W('kb/.hidden/skip.json', { entries: [entry('h-1', 'hidden', 'これは読まれない説明の文章です')] });
const qr = W('qr.json', { items: [
  { id: 'm1', title: '買い物メモ', body: '<p>牛乳と卵を買う予定の長めのメモです</p>', tags: [], updatedAt: 5 },
  { id: 'm2', title: '秘密の話', body: '中身', sensitive: true, tags: [] },
  { id: 'm3', title: 'AIが作った要約', body: '要約です要約です要約です', tags: ['AI作成'] },
  { id: 'm4', title: 'メモ with key', body: 'token: ' + FAKE_PAT + '\n普通の行です普通の行です', tags: [] }
] });

const snap = () => ['kb', 'qr.json'].map((r) => { const p = path.join(tmp, r); return fs.statSync(p).isDirectory() ? fs.readdirSync(p, { recursive: true }).sort().join('|') : fs.readFileSync(p, 'utf8'); }).join('#');
const before = snap();
const L = E.load({ kb: path.join(tmp, 'kb'), kd: [], qr: [qr] });

t('辞書パックを下の階層まで読み、隠しフォルダーと非パックは読まない', () => {
  assert.strictEqual(L.files.pack, 2);
  assert.ok(!L.docs.some((d) => d.title === 'hidden'));
  assert.ok(L.problems.some((p) => p.includes('broken.json')));
});
t('同じidは新しい方だけ残る', () => {
  const d = L.docs.filter((x) => x.id === 'pk:js-3');
  assert.strictEqual(d.length, 1);
  assert.ok(d[0].full.includes('新しい説明'));
  assert.strictEqual(L.rawCount - L.docs.length, 1);
});
t('メモ: 保護メモとAI作成タグは外れる', () => {
  const q = L.docs.filter((d) => d.src === 'qr').map((d) => d.id);
  assert.deepStrictEqual(q.sort(), ['qr:m1', 'qr:m4']);
});
t('点検: 秘密らしい行は件数だけ数える（中身は報告に出ない）', () => {
  const c = E.checkData(L.docs);
  assert.strictEqual(c.secretDocs, 1);
  assert.strictEqual(c.secretLines, 1);
  assert.ok(!JSON.stringify(c).includes('ghp_'));
});
t('golden: 引けた/引けないと順位が正しい', () => {
  const rows = E.runGolden(L.docs, [
    { q: 'addEventListener の使い方', expect: ['addEventListener'] },
    { q: 'まったく関係のない質問です', expect: ['fetch'] },
    { q: 'x', expect: [] }
  ], 6);
  assert.strictEqual(rows[0].rank, 1);
  assert.strictEqual(rows[1].rank, 0);
  assert.ok(rows[2].error);
  const s = E.summarize(rows, 6);
  assert.strictEqual(s.n, 2); assert.strictEqual(s.at1, 1); assert.strictEqual(s.invalid, 1);
});
t('自動の試験: 質問に見出し語そのものが含まれない／毎回同じ', () => {
  const a = E.makeProbes(L.docs, 3), b = E.makeProbes(L.docs, 3);
  assert.deepStrictEqual(a, b);
  assert.strictEqual(a.length, 3);
  a.forEach((p) => assert.ok(!p.q.includes(p.title), p.title));
});
t('自動の試験: 結果が数値で返る', () => {
  const rows = E.runProbes(L.docs, E.makeProbes(L.docs, 10), 6);
  const s = E.summarize(rows, 6);
  assert.ok(s.n > 0 && s.atk >= 0 && s.mrr >= 0 && s.mrr <= 1);
});
t('自動の試験: 説明文に見出し語が入っていても、質問からは伏せる', () => {
  const docs = AI.fromPack({ entries: [entry('z-1', 'mapFunction', 'mapFunction は配列の各要素を変換して新しい配列を作る命令です')] });
  const pr = E.makeProbes(docs, 5);
  assert.strictEqual(pr.length, 1);
  assert.ok(!pr[0].q.includes('mapFunction'), pr[0].q);
});
t('順位: 上位k件の外は「引けなかった」(0)', () => {
  const hits = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.strictEqual(E.rankOf(hits, (d) => d.id === 'c', 2), 0);
  assert.strictEqual(E.rankOf(hits, (d) => d.id === 'b', 2), 2);
});
t('シンボリックリンクは辿らない', () => {
  const real = path.join(tmp, 'linkreal'); fs.mkdirSync(real);
  fs.writeFileSync(path.join(real, 'x.json'), JSON.stringify({ entries: [entry('l-1', 'linked', 'リンク先にある説明の文章です')] }));
  const dir = path.join(tmp, 'linkdir'); fs.mkdirSync(dir);
  try { fs.symlinkSync(real, path.join(dir, 'lnk'), 'junction'); } catch (e) { return; } // 作れない環境では確認しない
  assert.deepStrictEqual(E.listJson(dir), []);
});
t('--kb の中に置いた quick-ref の書き出し（items）も、自動で入る（保護メモは外れる）', () => {
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'aieval2-'));
  fs.mkdirSync(path.join(d2, 'raw'));
  fs.copyFileSync(qr, path.join(d2, 'raw', 'quick-ref_export.json'));
  fs.writeFileSync(path.join(d2, 'dict.json'), JSON.stringify({ entries: [entry('z-1', 'テスト語', 'テストのための説明の文章です')] }));
  const L2 = E.load({ kb: d2, kd: [], qr: [] });
  assert.strictEqual(L2.files.qr, 1);
  assert.deepStrictEqual(L2.docs.filter((x) => x.src === 'qr').map((x) => x.id).sort(), ['qr:m1', 'qr:m4']);
  assert.ok(L2.docs.some((x) => x.src === 'pk'));
  fs.rmSync(d2, { recursive: true, force: true });
});
t('読み取り専用: 元のフォルダーは変わらない', () => {
  assert.strictEqual(snap(), before);
});
t('CLI: 結果は --out にだけ書かれる', () => {
  const out = path.join(os.tmpdir(), 'aieval-out-' + Date.now());
  const g = W('golden.json', [{ q: 'querySelector の意味', expect: ['querySelector'] }]);
  const r = cp.spawnSync(process.execPath, [path.join(__dirname, 'ai-eval.js'), '--kb', path.join(tmp, 'kb'), '--qr', qr, '--golden', g, '--out', out], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('自分の質問（golden）'));
  assert.ok(fs.existsSync(path.join(out, 'ai-eval-report.json')));
  assert.ok(!r.stdout.includes('ghp_') && !fs.readFileSync(path.join(out, 'ai-eval-report.json'), 'utf8').includes('ghp_'));
  fs.rmSync(out, { recursive: true, force: true });
});
t('CLI: 入力なしと不明な引数は止まる', () => {
  assert.strictEqual(cp.spawnSync(process.execPath, [path.join(__dirname, 'ai-eval.js')]).status, 2);
  assert.strictEqual(cp.spawnSync(process.execPath, [path.join(__dirname, 'ai-eval.js'), '--nope']).status, 1);
});
fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? failed + ' FAILED' : 'ALL PASSED (' + passed + ')');
process.exit(failed ? 1 : 0);
