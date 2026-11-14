'use strict';
// 試験用のにせの鍵は、文字列を組み立てて作る（ファイルに鍵らしい並びを残さない）
const FAKE_PAT = ['ghp', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('_');
// node tools/test-ai-answer.js — 「答えに当たる一文を選ぶ」処理の試験。retrieve が以前と変わっていないことも確認する
const assert = require('assert');
const A = require('../ai-core.js');

let passed = 0, failed = 0;
function t(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n   ' + (e && e.message)); } }
const E = (id, term, summary, more) => Object.assign({ id, lang: 'js', kind: 'api', term, summary }, more || {});
const docs = A.fromPack({ builtAt: 1, entries: [
  E('1', 'addEventListener', 'ボタンのクリックなどに反応して、決めた処理を動かす命令。要素にイベントの待ち受けを登録する。', { form: 'el.addEventListener("click", fn)', example: 'btn.addEventListener("click", () => alert(1))' }),
  E('2', 'querySelector', 'CSSセレクターで最初に一致した要素を1つ取り出す命令。見つからなければnullを返す。'),
  E('3', 'localStorage', 'ブラウザーに文字列を保存し、閉じても残しておく仕組み。容量は小さい。'),
  E('4', 'fetch', 'ネットワークからデータを取ってくる命令。結果はPromiseで返る。'),
  E('5', 'Promise', '非同期の処理の結果を、あとで受け取るための入れ物。成功と失敗を分けて扱える。'),
  E('6', 'async await', 'Promiseを、上から順に読める書き方で扱う記法。awaitで結果を待つ。'),
  E('7', 'IndexedDB', 'ブラウザーに大量のデータを構造のまま保存する仕組み。localStorageより大きく保存できる。'),
  E('8', 'secretTest', '最初の説明です。\ntoken: ' + FAKE_PAT + '\n最後の説明です。')
] });

t('見出し語が質問に入っていれば sure で、その項目が先頭', () => {
  const r = A.quickAnswer(docs, 'querySelector とは？', {});
  assert.strictEqual(r.state, 'sure');
  assert.strictEqual(r.top.title, 'querySelector');
});
t('答えの一文は、質問に当たる文が選ばれる（無関係な文より優先）', () => {
  const r = A.quickAnswer(docs, 'querySelector が見つからないとき', {});
  assert.ok(r.snippet.includes('見つからなければnull'), r.snippet);
});
t('見出し語が質問に入っていれば、本文に同じ語が出てくる別の項目より上', () => {
  const r = A.quickAnswer(docs, 'localStorage とは', {});
  assert.strictEqual(r.top.title, 'localStorage');
});
t('見出し語が2つ入った質問は、どちらかを sure で答える', () => {
  const r = A.quickAnswer(docs, 'Promise async await の違い', {});
  assert.strictEqual(r.state, 'sure');
});
t('質問と文が重ならなくても、答えの一文は空にならない', () => {
  const r = A.quickAnswer(docs, 'localStorage', {});
  assert.ok(r.snippet.length > 0);
});
t('材料がない質問は none', () => {
  const r = A.quickAnswer(docs, 'まったく関係のない天気の話', {});
  assert.strictEqual(r.state, 'none');
  assert.strictEqual(r.top, null);
});
t('あいまいな質問は maybe（断定しない）', () => {
  const r = A.quickAnswer(docs, 'ブラウザーに保存', {});
  assert.notStrictEqual(r.state, 'none');
  assert.strictEqual(r.state, 'maybe');
});
t('秘密らしい行は、答えの一文に出ない', () => {
  const r = A.quickAnswer(docs, 'secretTest token', {});
  assert.strictEqual(r.top.title, 'secretTest');
  assert.ok(!r.snippet.includes('ghp_'), r.snippet);
});
t('答えの長さは上限を超えない', () => {
  const long = A.fromPack({ entries: [E('L', 'longOne', 'あ'.repeat(600))] });
  const r = A.quickAnswer(long, 'longOne', {});
  assert.ok(r.snippet.length <= 281, String(r.snippet.length));
});
t('👍の補正で上位が入れ替わる（育てた結果が答えに反映される）', () => {
  const a = A.quickAnswer(docs, 'ブラウザーに保存する仕組み', {});
  const second = a.more[0];
  assert.ok(second);
  const b = A.quickAnswer(docs, 'ブラウザーに保存する仕組み', { [second.id]: 3 });
  assert.strictEqual(b.top.id, second.id);
});
t('retrieve の並びが、確認済みの結果から変わっていない（変えたときは、中身を見て更新する）', () => {
  const EXPECT = {"querySelector とは？":["pk:2","pk:8","pk:1","pk:3"],"クリックで処理を動かす":["pk:1"],"ブラウザーに保存":["pk:3","pk:7"],"Promise の使い方":["pk:5","pk:4","pk:6","pk:1","pk:2","pk:8"],"天気":[],"async await の意味":["pk:6","pk:3"],"ネットワーク":["pk:4"],"IndexedDB と localStorage の違い":["pk:7","pk:3","pk:1","pk:2"],"x":[],"CSSセレクターで要素を取る":["pk:2"],"非同期の結果を待つ":["pk:5","pk:6"]};
  Object.keys(EXPECT).forEach((q) => {
    assert.deepStrictEqual(A.retrieve(docs, q, 6, {}).map((d) => d.id), EXPECT[q], q);
  });
});
t('どの項目にも出る語より、決め手になる語が優先される', () => {
  const many = [];
  for (let i = 0; i < 8; i++) many.push(E('c' + i, 'プロンプト項目' + i, 'プロンプトに関する、ごく一般的な説明の文章です。'));
  many.push(E('target', '例を見せる', '求める答えの例を入れて見せる方法。プロンプトに例を入れる。'));
  const ds = A.fromPack({ entries: many });
  assert.strictEqual(A.retrieve(ds, 'プロンプトに例を入れる', 3, {})[0].id, 'pk:target');
});
t('項目が増減したら、珍しさの計算もやり直す（古い数え方を使い回さない）', () => {
  const base = [E('a', '甲', '共通の語のある説明です'), E('b', '乙', '共通の語のある説明です。別の特別な言葉')];
  const q = '共通の語と特別な言葉';
  const r1 = A.quickAnswer(A.fromPack({ entries: base }), q, {});
  const more = base.concat([E('c', '丙', '特別な言葉を含む説明'), E('d', '丁', '特別な言葉を含む説明'), E('e', '戊', '特別な言葉を含む説明')]);
  const r2 = A.quickAnswer(A.fromPack({ entries: more }), q, {});
  const fresh = A.quickAnswer(A.fromPack({ entries: more }), q, {});
  assert.notStrictEqual(r1.score, r2.score);          // 項目が変わったので、数え直されている
  assert.strictEqual(r2.score, fresh.score);          // 同じ項目なら、同じ結果
});
t('関係のない質問は、偶然の一致で答えを出さない（none）', () => {
  assert.strictEqual(A.quickAnswer(docs, 'まったく関係のない天気の予報について', {}).state, 'none');
});
console.log(failed ? failed + ' FAILED' : 'ALL PASSED (' + passed + ')');
process.exit(failed ? 1 : 0);
