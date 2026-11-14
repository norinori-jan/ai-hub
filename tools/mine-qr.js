#!/usr/bin/env node
/* mine-qr.js — quick-ref のメモを読んで、「辞書にまだ無い話題」を見つける道具
 * （AIなし・通信なし・読み取りだけ）
 *
 *   node tools\mine-qr.js --qr C:\path\quick-ref.json --kb C:\Users\norin\knowledge-base --out mine-out
 *
 *   --qr <ファイル>   quick-ref の書き出し（items）。複数可。--kb 内の items も自動で読む
 *   --kb <フォルダー>  辞書パック（entries）のあるフォルダー。下の階層も読む
 *   --out <フォルダー> 結果の置き場（既定 ./mine-out）
 *   --with-titles     topics-for-claude.txt に、メモの題名も入れる（既定は、タグ名と件数だけ）
 *
 * 保護メモ・AI作成/まとまり/用語/スライスのタグ・秘密らしい題名は、ai-core が外すか、伏せます。
 * 書き出す gap-report.txt には、本文は入れません（題名とタグだけ）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const AI = require('../ai-core.js');

function walk(dir, out) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of ents) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.isFile() && /\.json$/i.test(e.name)) out.push(p);
  }
  return out;
}
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); }

function load(args) {
  const qr = [], pk = [], problems = [];
  const files = args.kb ? walk(args.kb, []) : [];
  for (const p of args.qr) files.push(p);
  for (const p of files) {
    let j; try { j = readJson(p); } catch (e) { problems.push('読めない: ' + path.basename(p)); continue; }
    if (!j || Array.isArray(j)) continue;
    if (Array.isArray(j.items)) qr.push(...AI.fromQR(j));
    else if (Array.isArray(j.entries)) pk.push(...AI.fromPack(j));
  }
  const uniq = (a) => Array.from(new Map(a.map((d) => [d.id, d])).values());
  return { qr: uniq(qr), pk: uniq(pk), problems };
}

// メモごとに、辞書で引けるかを調べる（中身は ai-core の gapScan。アプリの「まとめ忘れ探し」と同じ）
function analyze(qr, pk, opts) {
  const r = AI.gapScan(qr, pk, opts && opts.weakBelow);
  const rows = r.rows.map((x) => ({ title: AI.redactTitle(x.doc.title), tags: x.doc.tags, state: x.state, top: x.top }));
  return { total: r.total, sure: r.sure, maybe: r.maybe, weak: r.weak, none: r.none, rows, tags: r.tags };
}

function writeReports(res, outDir, withTitles) {
  fs.mkdirSync(outDir, { recursive: true });
  const gaps = res.rows.filter((r) => r.state === 'none' || r.state === 'weak');
  const L = [];
  L.push('メモ ' + res.total + ' 件のうち、辞書でしっかり引けた ' + res.sure + ' / 近いものはある ' + res.maybe + ' / 弱い ' + res.weak + ' / 引けない ' + res.none);
  L.push('', '■ 話題（タグ）ごとの、辞書の穴（多い順）');
  res.tags.filter((t) => t.gaps > 0).slice(0, 40).forEach((t) => L.push('  ' + t.tag + '  穴 ' + t.gaps + ' / メモ ' + t.memos));
  L.push('', '■ 辞書で引けない・弱いメモの題名（最大200件）');
  gaps.slice(0, 200).forEach((r) => L.push('  [' + (r.state === 'none' ? '無' : '弱') + '] ' + r.title + (r.tags.length ? '  #' + r.tags.join(' #') : '')));
  fs.writeFileSync(path.join(outDir, 'gap-report.txt'), L.join('\n') + '\n', 'utf8');
  const T = ['# 辞書を厚くしたい話題（本文は含みません）', ''];
  res.tags.filter((t) => t.gaps > 0).slice(0, 40).forEach((t) => T.push('- ' + t.tag + '（穴 ' + t.gaps + '件）'));
  if (withTitles) { T.push('', '## 題名'); gaps.slice(0, 100).forEach((r) => T.push('- ' + r.title)); }
  fs.writeFileSync(path.join(outDir, 'topics-for-claude.txt'), T.join('\n') + '\n', 'utf8');
  return gaps.length;
}

function main(argv) {
  const a = { kb: null, qr: [], out: 'mine-out', withTitles: false };
  for (let i = 2; i < argv.length; i++) {
    const f = argv[i];
    if (f === '--kb') a.kb = argv[++i]; else if (f === '--qr') a.qr.push(argv[++i]); else if (f === '--out') a.out = argv[++i]; else if (f === '--with-titles') a.withTitles = true;
    else { console.error('知らない指定: ' + f); process.exit(2); }
  }
  const { qr, pk, problems } = load(a);
  if (!qr.length) { console.error('quick-ref のメモが読めませんでした（--qr か、--kb の中の書き出しを確認）。'); process.exit(1); }
  if (!pk.length) { console.error('辞書パックが読めませんでした（--kb を確認）。'); process.exit(1); }
  const res = analyze(qr, pk);
  const n = writeReports(res, a.out, a.withTitles);
  console.log('■ メモ ' + res.total + ' 件 / 辞書 ' + pk.length + ' 件');
  console.log('  しっかり引けた ' + res.sure + ' / 近いもの ' + res.maybe + ' / 弱い ' + res.weak + ' / 引けない ' + res.none);
  problems.forEach((p) => console.log('  ! ' + p));
  console.log('結果: ' + path.resolve(a.out) + '（gap-report.txt, topics-for-claude.txt）  穴 ' + n + ' 件');
}
if (require.main === module) main(process.argv);
module.exports = { analyze, load, writeReports, walk };
