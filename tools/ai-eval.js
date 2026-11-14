#!/usr/bin/env node
/* ai-eval.js — 辞書とメモが「引けるか」を測る道具（AIなし・通信なし・読み取りだけ）
 *
 * 使い方（PC / Node.js）:
 *   node tools/ai-eval.js --kb C:\Users\norin\knowledge-base --qr quick-ref.json --golden tools/golden.json
 *
 *   --kb <フォルダー>   knowledge-base。下の階層まで全部読み、形で見分ける:
 *                        辞書パック（entries）／quick-ref の書き出し（items）／knowledge-dictionary の書き出し（qas）
 *                        quick-ref の書き出しを、このフォルダーの raw\\ などに置けば、自動で入ります
 *   --kd <ファイル>     knowledge-dictionary の書き出し（entries / qas）。複数可
 *   --qr <ファイル>     quick-ref の書き出し（items）。複数可。保護メモ・AI作成等のタグは ai-core が外す
 *   --golden <ファイル> 自分の「本当の質問」と、出てほしい見出し語。[{ "q": "...", "expect": ["見出し語", ...] }]
 *   --k <数>            上位何件までを「引けた」とみなすか（既定 6）
 *   --probes <数>       自動の試験の件数（既定 200）。辞書の説明文から語を伏せて質問を作る
 *   --out <フォルダー>  結果の置き場（既定 ./ai-eval-out）。元データには書き込まない
 *
 * 読み取り専用: 元のファイルは変更しません。結果は --out だけに書きます。
 * 秘密らしい行は件数だけ数え、中身は表示も保存もしません。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const AI = require('../ai-core.js');

function parseArgs(argv) {
  const a = { kb: null, kd: [], qr: [], golden: null, k: 6, probes: 200, out: 'ai-eval-out' };
  for (let i = 2; i < argv.length; i++) {
    const f = argv[i], v = argv[i + 1];
    if (f === '--kb') { a.kb = v; i++; }
    else if (f === '--kd') { a.kd.push(v); i++; }
    else if (f === '--qr') { a.qr.push(v); i++; }
    else if (f === '--golden') { a.golden = v; i++; }
    else if (f === '--k') { a.k = Math.max(1, parseInt(v, 10) || 6); i++; }
    else if (f === '--probes') { a.probes = Math.max(0, parseInt(v, 10) || 0); i++; }
    else if (f === '--out') { a.out = v; i++; }
    else throw new Error('不明な引数: ' + f);
  }
  return a;
}

function listJson(dir) {
  const out = [];
  (function walk(d, depth) {
    if (depth > 6) return;
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    ents.sort((x, y) => x.name.localeCompare(y.name));
    for (const e of ents) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.isFile() && /\.json$/i.test(e.name)) out.push(p);
    }
  })(dir, 0);
  return out;
}
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));

function load(args) {
  const docs = [], problems = [], files = { pack: 0, kd: 0, qr: 0, skipped: 0 };
  if (args.kb) {
    for (const p of listJson(args.kb)) {
      let j; try { j = readJson(p); } catch (e) { problems.push('読めない: ' + path.basename(p)); files.skipped++; continue; }
      // 形で見分ける: quick-ref の書き出し（items）／knowledge-dictionary の書き出し（qas）／辞書パック（entries）
      if (j && !Array.isArray(j) && Array.isArray(j.items)) { const d = AI.fromQR(j); d.forEach((x) => { x.file = path.basename(p); }); docs.push(...d); files.qr++; continue; }
      if (j && !Array.isArray(j) && Array.isArray(j.qas)) { const d = AI.fromKD(j); d.forEach((x) => { x.file = path.basename(p); }); docs.push(...d); files.kd++; continue; }
      const pack = Array.isArray(j) ? { entries: j } : j;
      if (!pack || !Array.isArray(pack.entries)) { files.skipped++; continue; } // 辞書パックの形ではない
      const d = AI.fromPack(pack);
      if (!d.length) { problems.push('項目が0件: ' + path.basename(p)); files.skipped++; continue; }
      d.forEach((x) => { x.file = path.basename(p); });
      docs.push(...d); files.pack++;
    }
  }
  for (const p of args.kd) { try { docs.push(...AI.fromKD(readJson(p))); files.kd++; } catch (e) { problems.push('読めない: ' + path.basename(p)); } }
  for (const p of args.qr) { try { docs.push(...AI.fromQR(readJson(p))); files.qr++; } catch (e) { problems.push('読めない: ' + path.basename(p)); } }
  // 同じ id は、新しい方だけ残す（パック同士の重複への備え）
  const byId = new Map();
  for (const d of docs) { const o = byId.get(d.id); if (!o || (d.updatedAt || 0) >= (o.updatedAt || 0)) byId.set(d.id, d); }
  return { docs: Array.from(byId.values()), problems, files, rawCount: docs.length };
}

const norm = (s) => String(s == null ? '' : s).normalize('NFKC').toLowerCase().trim();

function checkData(docs) {
  const bySrc = {}, byLang = {};
  const titles = new Map();
  let empty = 0, secretDocs = 0, secretLines = 0, short = 0;
  for (const d of docs) {
    bySrc[d.src] = (bySrc[d.src] || 0) + 1;
    if (d.src === 'pk') { const lang = (d.tags && d.tags[0]) || '(不明)'; byLang[lang] = (byLang[lang] || 0) + 1; }
    const body = d.full || d.text || '';
    if (!body.trim()) empty++;
    else if (body.trim().length < 20) short++;
    const n = body.split('\n').filter((l) => AI.isSecret(l)).length;
    if (n) { secretDocs++; secretLines += n; }
    const k = d.src + '\u0000' + norm(d.title);
    if (!titles.has(k)) titles.set(k, []);
    titles.get(k).push(d.id);
  }
  const dupTitles = Array.from(titles.values()).filter((v) => v.length > 1).map((v) => v.length);
  return { total: docs.length, bySrc, byLang, empty, short, secretDocs, secretLines, dupTitleGroups: dupTitles.length };
}

function rankOf(hits, matcher, k) {
  const top = hits.slice(0, k);
  for (let i = 0; i < top.length; i++) if (matcher(top[i])) return i + 1;
  return 0;
}

function runGolden(docs, golden, k) {
  const rows = [];
  for (const g of golden) {
    if (!g || typeof g.q !== 'string' || !Array.isArray(g.expect) || !g.expect.length) { rows.push({ q: String(g && g.q), error: '形が不正（q と expect が必要）' }); continue; }
    const exp = g.expect.map(norm);
    const hits = AI.retrieve(docs, g.q, k, {});
    const rank = rankOf(hits, (d) => exp.includes(norm(d.title)) || exp.includes(norm(d.id)), k);
    rows.push({ q: g.q, expect: g.expect, rank, got: hits.slice(0, k).map((d) => d.title) });
  }
  return rows;
}

// 辞書の説明文から、見出し語を伏せた質問を作る（「意味から引けるか」の試験）
function makeProbes(docs, limit) {
  const pool = docs.filter((d) => d.src === 'pk' && d.title && d.full);
  const probes = [];
  for (const d of pool) {
    const first = String(d.full).split('\n').find((l) => l.trim() && !l.startsWith('【')) || '';
    let q = first.trim();
    if (!q) continue;
    const t = d.title.trim();
    q = q.split(t).join('').split(t.toLowerCase()).join('').replace(/[（(][^）)]*[）)]/g, '').trim();
    if (norm(q).length < 6) continue;
    probes.push({ id: d.id, title: d.title, q: q.slice(0, 120) });
  }
  if (probes.length <= limit) return probes;
  const step = probes.length / limit; // 一定間隔で拾う（毎回同じ結果になる）
  return Array.from({ length: limit }, (_, i) => probes[Math.floor(i * step)]);
}

function runProbes(docs, probes, k) {
  return probes.map((p) => {
    const hits = AI.retrieve(docs, p.q, k, {});
    return { id: p.id, title: p.title, q: p.q, rank: rankOf(hits, (d) => d.id === p.id, k) };
  });
}

function summarize(rows, k) {
  const valid = rows.filter((r) => !r.error);
  const n = valid.length;
  const at1 = valid.filter((r) => r.rank === 1).length;
  const atk = valid.filter((r) => r.rank > 0).length;
  const mrr = n ? valid.reduce((s, r) => s + (r.rank ? 1 / r.rank : 0), 0) / n : 0;
  return { n, at1, atk, k, rate1: n ? at1 / n : 0, ratek: n ? atk / n : 0, mrr, invalid: rows.length - n };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.kb && !args.kd.length && !args.qr.length) { console.log('使い方は、ファイルの先頭の説明を見てください（--kb / --kd / --qr のどれかが必要です）。'); process.exit(2); }
  const L = load(args);
  const data = checkData(L.docs);
  const report = { when: new Date().toISOString(), k: args.k, files: L.files, problems: L.problems, rawCount: L.rawCount, data };
  const lines = [];
  const pct = (x) => (x * 100).toFixed(1) + '%';
  lines.push('■ 読み込み: ' + data.total + ' 件（辞書パック ' + L.files.pack + ' / 辞書 ' + L.files.kd + ' / メモ ' + L.files.qr + ' ファイル、読まなかった ' + L.files.skipped + '）');
  lines.push('  内訳: ' + Object.entries(data.bySrc).map(([k2, v]) => AI.srcLabel(k2) + ' ' + v).join(' / '));
  if (Object.keys(data.byLang).length) lines.push('  辞書パックの分野: ' + Object.entries(data.byLang).sort((a, b) => b[1] - a[1]).map(([k2, v]) => k2 + ' ' + v).join(' / '));
  if (L.rawCount !== data.total) lines.push('  同じidの重複を ' + (L.rawCount - data.total) + ' 件まとめました（新しい方を採用）');
  lines.push('■ 点検: 本文が空 ' + data.empty + ' / 極端に短い ' + data.short + ' / 同じ見出しが複数 ' + data.dupTitleGroups + ' グループ / 秘密らしい行を含む ' + data.secretDocs + ' 件（' + data.secretLines + ' 行。中身は表示しません）');
  L.problems.forEach((p) => lines.push('  ! ' + p));

  if (args.golden) {
    let g; try { g = readJson(args.golden); } catch (e) { g = null; lines.push('! golden が読めません: ' + args.golden); }
    if (g) {
      const rows = runGolden(L.docs, g, args.k); const s = summarize(rows, args.k);
      report.golden = { summary: s, misses: rows.filter((r) => !r.error && !r.rank).map((r) => ({ q: r.q, expect: r.expect, got: r.got })), invalid: rows.filter((r) => r.error) };
      lines.push('■ 自分の質問（golden）: ' + s.n + ' 問 → 1位で引けた ' + pct(s.rate1) + ' / 上位' + s.k + '件で引けた ' + pct(s.ratek) + ' / MRR ' + s.mrr.toFixed(3) + (s.invalid ? '（形が不正 ' + s.invalid + ' 問）' : ''));
      report.golden.misses.slice(0, 10).forEach((m) => lines.push('   × ' + m.q + '  （出てほしい: ' + m.expect.join('、') + ' ／ 実際: ' + (m.got.slice(0, 3).join('、') || 'なし') + '）'));
    }
  }
  if (args.probes > 0) {
    const probes = makeProbes(L.docs, args.probes);
    if (probes.length) {
      const rows = runProbes(L.docs, probes, args.k); const s = summarize(rows, args.k);
      report.probes = { summary: s, misses: rows.filter((r) => !r.rank).map((r) => ({ id: r.id, title: r.title, q: r.q })) };
      lines.push('■ 意味から引く試験（自動）: ' + s.n + ' 問 → 1位 ' + pct(s.rate1) + ' / 上位' + s.k + '件 ' + pct(s.ratek) + ' / MRR ' + s.mrr.toFixed(3));
      report.probes.misses.slice(0, 5).forEach((m) => lines.push('   × 「' + m.title + '」が、説明文からは引けませんでした'));
    } else lines.push('■ 意味から引く試験: 作れる問題がありません（辞書パックの説明文が必要です）');
  }
  fs.mkdirSync(args.out, { recursive: true });
  fs.writeFileSync(path.join(args.out, 'ai-eval-report.json'), JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(path.join(args.out, 'ai-eval-report.txt'), lines.join('\n') + '\n', 'utf8');
  console.log(lines.join('\n'));
  console.log('\n結果を保存しました: ' + path.resolve(args.out));
}

module.exports = { rankOf, parseArgs, load, checkData, runGolden, makeProbes, runProbes, summarize, listJson };
if (require.main === module) { try { main(); } catch (e) { console.error('失敗しました: ' + ((e && e.message) || e)); process.exit(1); } }
