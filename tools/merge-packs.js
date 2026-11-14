#!/usr/bin/env node
/* merge-packs.js — knowledge-base の辞書パック（dict_*.json）を、1つの dict-pack.json にまとめる
 *
 *   node tools/merge-packs.js --kb C:\Users\norin\knowledge-base [--out <ファイル>]
 *
 * - 読むのは --kb の下の、entries を持つ JSON だけ（隠しフォルダー、.bak は読まない）
 * - すでにある出力先（前の dict-pack.json）も材料にする。前に入っていた項目（自分のデータから拾った分など）が、消えないようにするため
 * - 同じ id が複数あれば、updatedAt が新しい方を採用（同じなら、後から読んだ方）
 * - 出力先に、すでにファイルがあれば、消さずに「.bak-日時」を付けて残してから、書く
 * - 元のパックは変更しない。一時ファイルに書いてから、置き換える
 */
'use strict';
const fs = require('fs');
const path = require('path');

function listPacks(dir) {
  const out = [];
  (function walk(d, depth) {
    if (depth > 6) return;
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    ents.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of ents) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.isSymbolicLink()) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.isFile() && /\.json$/i.test(e.name) && !/\.bak-/.test(e.name)) out.push(p);
    }
  })(dir, 0);
  return out;
}

function merge(kb, outPath) {
  const byId = new Map(), report = { files: 0, skipped: 0, entries: 0, replaced: 0, kept: 0 };
  for (const p of listPacks(kb)) {
    let j; try { j = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { report.skipped++; continue; }
    const list = Array.isArray(j) ? j : (j && Array.isArray(j.entries) ? j.entries : null);
    if (!list) { report.skipped++; continue; }
    report.files++;
    const built = (j && j.builtAt) || 0;
    for (const e of list) {
      if (!e || typeof e.term !== 'string' || !e.term.trim()) continue;
      const id = String(e.id || (e.lang || 'x') + ':' + e.term), ts = e.updatedAt || built || 0;
      report.entries++;
      const old = byId.get(id);
      if (old && (old.updatedAt || old.__built || 0) > ts) { report.kept++; continue; }
      if (old) report.replaced++;
      byId.set(id, Object.assign({}, e, { id }));
    }
  }
  const entries = Array.from(byId.values());
  return { pack: { app: 'dict-pack', version: 1, builtAt: Date.now(), entries }, report };
}

function writeSafely(outPath, pack) {
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  let backup = null;
  if (fs.existsSync(outPath)) {
    const t = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    backup = outPath + '.bak-' + t;
    let n = 1; while (fs.existsSync(backup)) backup = outPath + '.bak-' + t + '-' + (n++);
    fs.copyFileSync(outPath, backup);
  }
  const tmp = outPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(pack), 'utf8');
  fs.renameSync(tmp, outPath);
  return backup;
}

function main() {
  const a = process.argv.slice(2);
  let kb = null, out = null;
  for (let i = 0; i < a.length; i++) { if (a[i] === '--kb') kb = a[++i]; else if (a[i] === '--out') out = a[++i]; else throw new Error('不明な引数: ' + a[i]); }
  if (!kb) { console.log('使い方: node tools/merge-packs.js --kb <knowledge-base のフォルダー> [--out <ファイル>]'); process.exit(2); }
  out = out || path.join(kb, 'dict-pack.json');
  const { pack, report } = merge(kb, out);
  if (!pack.entries.length) { console.log('項目が1件も見つかりませんでした。何も書き込みません。'); process.exit(1); }
  const backup = writeSafely(out, pack);
  console.log('まとめました: ' + pack.entries.length + ' 件（パック ' + report.files + ' ファイル、読まなかった ' + report.skipped + '、重複の置き換え ' + report.replaced + '）');
  console.log('出力: ' + path.resolve(out));
  if (backup) console.log('前の dict-pack.json は残しました: ' + backup);
}
module.exports = { merge, writeSafely, listPacks };
if (require.main === module) { try { main(); } catch (e) { console.error('失敗しました: ' + ((e && e.message) || e)); process.exit(1); } }
