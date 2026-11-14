'use strict';
// 試験用のにせの鍵は、文字列を組み立てて作る（ファイルに鍵らしい並びを残さない）
const FAKE_SK = ['sk', 'abcdefghijklmnopqrstuvwx'].join('-'), FAKE_HEX = 'abcdef0123456789' + 'abcdef0123456789';
const assert = require('assert');
const A = require('../ai-core.js');
let ok = 0, ng = 0;
const t = (n, f) => { try { f(); ok++; console.log('PASS ' + n); } catch (e) { ng++; console.log('FAIL ' + n + '\n   ' + e.message); } };
const pk = A.fromPack({ entries: [
  { id: 'd1', lang: 'net', kind: 'term', term: 'キャッシュ', summary: '一度取得した内容を手元に残して次は取りに行かずに使う仕組み。', tags: ['キャッシュ'], updatedAt: 1 },
  { id: 'd2', lang: 'net', kind: 'term', term: 'ポート番号', summary: '通信の出入り口を区別する番号。', updatedAt: 1 } ] });
const memo = (id, title, body, tags) => ({ id: 'qr:' + id, src: 'qr', title, full: body, text: body, tags: tags || [], kind: 'memo', updatedAt: 1, link: [] });

t('gapScan: 辞書にある話題は引け、無い話題は穴になる', () => {
  const r = A.gapScan([memo('a', 'キャッシュが古い', '反映されない', ['キャッシュ']), memo('b', '蔵干の読み方', '地支に隠れた天干', ['占い'])], pk);
  const by = Object.fromEntries(r.rows.map((x) => [x.doc.title, x.state]));
  assert(['sure', 'maybe'].includes(by['キャッシュが古い']), JSON.stringify(by));
  assert(['none', 'weak'].includes(by['蔵干の読み方']), JSON.stringify(by));
  assert.strictEqual(r.total, 2); assert.strictEqual(r.tags[0].tag, '占い');
});
t('gapScan: 辞書が空なら全部が穴', () => {
  const r = A.gapScan([memo('a', 'なにか', 'x', [])], []);
  assert.strictEqual(r.none, 1);
});
t('gapPrompt: 秘密らしい行を伏せ、見出しの鍵らしい題も伏せる', () => {
  const p = A.gapPrompt(memo('c', 'メモ', '普通の行\nAuthorization: Bearer ' + FAKE_HEX + '\n' + FAKE_SK , ['x']), 5);
  assert(/普通の行/.test(p)); assert(!/abcdef0123|sk-abcdefgh|Bearer/.test(p), '秘密が出ている');
  assert(/"updatedAt":5/.test(p)); assert(/"id":"qr-[0-9a-f]+"/.test(p));
  assert(!/sk-abcdef/.test(A.gapPrompt(memo('d', FAKE_SK , '本文', []), 1)), '題の鍵が出ている');
});
t('gapPrompt: 同じメモは同じid', () => {
  const m = memo('e', 'A', 'b', []);
  assert.strictEqual(A.gapPrompt(m, 1).match(/"id":"([^"]+)"/)[1], A.gapPrompt(m, 2).match(/"id":"([^"]+)"/)[1]);
});
t('parseEntries: コードブロック付き・配列・entries 形式を読める', () => {
  const e = { id: 'x1', term: '語', summary: '説明は十分な長さのある文です。' };
  assert.strictEqual(A.parseEntries('```json\n' + JSON.stringify(e) + '\n```').entries.length, 1);
  assert.strictEqual(A.parseEntries(JSON.stringify([e, Object.assign({}, e, { id: 'x2', term: '語2' })])).entries.length, 2);
  assert.strictEqual(A.parseEntries(JSON.stringify({ entries: [e] })).entries.length, 1);
});
t('parseEntries: 壊れたJSON・短い説明・秘密らしい行は、入れない（中身は報告に出さない）', () => {
  assert.strictEqual(A.parseEntries('{ broken').entries.length, 0);
  assert.strictEqual(A.parseEntries(JSON.stringify({ term: '語', summary: '短い' })).entries.length, 0);
  const r = A.parseEntries(JSON.stringify({ term: '語', summary: 'これは長さは十分です。\nAuthorization: Bearer ' + FAKE_HEX  }));
  assert.strictEqual(r.entries.length, 0); assert(!/abcdef0123|Bearer/.test(r.rejected.join('')), '報告に中身が出ている');
  assert.strictEqual(A.parseEntries(JSON.stringify({ term: '語', summary: '十分な長さの説明です。', example: FAKE_SK  })).entries.length, 0, 'exampleの鍵を見逃した');
});
t('parseEntries: updatedAt は、こちらで付ける（返事の値は使わない）', () => {
  const r = A.parseEntries(JSON.stringify({ id: 'x', term: '語', summary: '十分な長さの説明です。', updatedAt: 99999999999999 }), 123);
  assert.strictEqual(r.entries[0].updatedAt, 123);
});
t('mergeEntries: 既存を失わず、同じidは新しい方、元のパックは変えない', () => {
  const pack = { app: 'dict-pack', version: 1, entries: [{ id: 'a', term: 'A', summary: 'old', updatedAt: 5 }, { id: 'b', term: 'B', summary: 'keep', updatedAt: 5 }] };
  const before = JSON.stringify(pack);
  const m = A.mergeEntries(pack, [{ id: 'a', term: 'A2', summary: 'new', updatedAt: 9 }, { id: 'b', term: 'Bx', summary: 'older', updatedAt: 1 }, { id: 'c', term: 'C', summary: 'add', updatedAt: 9 }]);
  const by = Object.fromEntries(m.pack.entries.map((e) => [e.id, e.term]));
  assert.deepStrictEqual(by, { a: 'A2', b: 'B', c: 'C' }); assert.strictEqual(m.added, 1); assert.strictEqual(m.replaced, 1);
  assert.strictEqual(JSON.stringify(pack), before, '元のパックが変わった');
});
t('mergeEntries: パックが無くても動く', () => {
  const m = A.mergeEntries(null, [{ id: 'z', term: 'Z', summary: 'x', updatedAt: 1 }]);
  assert.strictEqual(m.pack.entries.length, 1); assert.strictEqual(m.pack.app, 'dict-pack');
});
t('gapScan: 同じタグの別項目があっても、題の話題が無ければ穴のまま', () => {
  const pk2 = A.fromPack({ entries: [{ id: 'u1', lang: 'qr', kind: 'term', term: '蔵干', summary: '地支の中に隠れている天干のこと。', tags: ['占い'], updatedAt: 1 }] });
  const r = A.gapScan([memo('x', '八字の大運の数え方', '節入りからの日数', ['占い'])], pk2);
  assert(['none', 'weak'].includes(r.rows[0].state), r.rows[0].state);
});
console.log(ng ? 'FAILED ' + ng : 'ALL PASSED (' + ok + ')'); process.exit(ng ? 1 : 0);
