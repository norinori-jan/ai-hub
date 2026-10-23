/* ai-core.js — 統合AIの共通部品（DOM非依存・依存ライブラリなし）
 *  役割: ①知識の窓口(feed) ②秘密除外(redact) ③根拠の検索(retrieve) ④AI呼び出し(callAI) ⑤答えの組み立て(ask)
 *  知識の窓口は、knowledge-dictionary と quick-ref の同期データを「同じ形の文書」にそろえる。
 *    文書: { id, src:'kd'|'qr', title, text, tags[], kind, updatedAt, link:[] }
 *  保護メモ(sensitive)・暗号化メモ・AI作成/まとまり/用語/スライス タグは、ここで外す（1か所）。
 */
(function (root) {
  'use strict';
  var EXCLUDE_TAGS = ['AI作成', 'まとまり', '用語', 'スライス'];
  var BOX = { kd: 'knowledge-dictionary', qr: 'quick-ref' };

  // ---------- 秘密除外（quick-ref の cluster-items.js と同じ規則＋知識辞書側の規則） ----------
  var SECRET = /[0-9a-f]{20,}|bearer|token|secret|api[-_]?key|password|passwd|private[-_ ]?key|authorization|sk-[A-Za-z0-9_\-]{10,}|ghp_|github_pat_|AIza[0-9A-Za-z_\-]{20,}|-----BEGIN/i;
  var LONGTOK = /(?=[A-Za-z0-9_\-+\/=]*[A-Za-z])(?=[A-Za-z0-9_\-+\/=]*\d)[A-Za-z0-9_\-+\/=]{24,}/;
  var HIDDEN = '（秘密らしい行のため非表示）';
  function isSecret(s) { s = String(s || ''); return SECRET.test(s) || LONGTOK.test(s) || /[A-Za-z0-9_\-]{32,}/.test(s); }
  function redact(text) {
    var removed = 0;
    var out = String(text || '').split('\n').map(function (l) { if (isSecret(l)) { removed++; return HIDDEN; } return l; }).join('\n');
    return { text: out, removed: removed };
  }
  function redactTitle(t) { t = String(t || ''); return isSecret(t) ? '（秘密らしい題名のため非表示）' : t; }

  // ---------- 接続設定（各アプリの保存先を順に借りる） ----------
  function ls(k) { try { return (root.localStorage && root.localStorage.getItem(k)) || ''; } catch (_) { return ''; } }
  function config() {
    return {
      endpoint: (ls('ah_endpoint') || ls('kd_endpoint') || ls('qr_sync_endpoint') || ls('tp_sync_endpoint')).trim().replace(/\/+$/, ''),
      token: (ls('ah_token') || ls('kd_token') || ls('qr_sync_token') || ls('tp_sync_token')).trim(),
      provider: ls('ah_provider') || ls('kd_provider') || 'gemini',
      model: (ls('ah_model') || ls('kd_model')).trim()
    };
  }
  var DEFAULT_MODEL = { gemini: 'gemini-3.5-flash-lite', openai: 'gpt-4o-mini', claude: 'claude-sonnet-4-6' };

  // ---------- 文字の下ごしらえ ----------
  function norm(s) { return String(s == null ? '' : s).normalize('NFKC').toLowerCase().trim(); }
  function plain(h) {
    return String(h || '').replace(/<\/(td|th)>/gi, ' | ').replace(/<(br|\/p|\/div|\/li|\/tr)[^>]*>/gi, '\n').replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }
  function bigrams(s) {
    var t = norm(s).replace(/\s+/g, ''), r = new Set();
    for (var i = 0; i < t.length - 1; i++) r.add(t.substr(i, 2));
    return r;
  }

  // ---------- 知識の窓口：同期データ → 文書 ----------
  function fromKD(data) {
    var E = data && Array.isArray(data.entries) ? data.entries : [], Q = data && Array.isArray(data.qas) ? data.qas : [];
    var by = {}; Q.forEach(function (q) { if (q && q.entryId) (by[q.entryId] = by[q.entryId] || []).push(q); });
    var out = [];
    E.forEach(function (e) {
      if (!e || !e.id || !e.term || e.sensitive || e.protected || e.encrypted) return;
      var parts = [];
      if (e.oneLine) parts.push('一言：' + e.oneLine);
      if (e.note) parts.push('自分の理解：' + e.note);
      (by[e.id] || []).slice(0, 4).forEach(function (q) {
        if (q.sensitive) return;
        parts.push('Q：' + String(q.question || '').slice(0, 200) + '\nA：' + String(q.answer || '').slice(0, 600) + (q.judgment ? '\n自分の判断：' + String(q.judgment).slice(0, 300) : ''));
      });
      var fp = [String(e.term)]; if (e.oneLine) fp.push('一言：' + e.oneLine); if (e.note) fp.push('自分の理解：\n' + e.note);
      (by[e.id] || []).forEach(function (q) { if (!q.sensitive) fp.push('――――\nQ：' + (q.question || '') + '\n\nA：\n' + (q.answer || '') + (q.judgment ? '\n\n自分の判断：\n' + q.judgment : '')); });
      out.push({ id: 'kd:' + e.id, src: 'kd', title: String(e.term), full: fp.join('\n\n'), text: parts.join('\n'), tags: (e.tags || []).map(String), kind: e.kind || 'term', updatedAt: e.updatedAt || 0, link: (e.related || []).map(String) });
    });
    return out;
  }
  function fromQR(data) {
    var I = data && Array.isArray(data.items) ? data.items : [];
    var out = [];
    I.forEach(function (x) {
      if (!x || !x.id || x.sensitive || x.protected || x.encrypted || x.encBody) return;
      var tg = (x.tags || []).map(String);
      if (tg.some(function (t) { return EXCLUDE_TAGS.indexOf(t) >= 0; })) return;
      var text = plain(x.body);
      if (x.qa && (x.qa.question || x.qa.answer)) text = 'Q：' + String(x.qa.question || '').slice(0, 200) + '\nA：' + String(x.qa.answer || '').slice(0, 600) + '\n' + text;
      var fullQ = x.qa && (x.qa.question || x.qa.answer) ? 'Q：' + (x.qa.question || '') + '\n\nA：\n' + (x.qa.answer || '') + '\n\n' + plain(x.body) : plain(x.body);
      out.push({ id: 'qr:' + x.id, src: 'qr', title: String(x.title || '(無題)'), full: fullQ, text: text.slice(0, 2000), tags: tg, kind: 'memo', updatedAt: x.updatedAt || x.createdAt || 0, link: [] });
    });
    return out;
  }
  async function fetchBox(name) {
    var c = config();
    if (!c.endpoint || !c.token) throw new Error('接続が未設定です（エンドポイントとトークン）');
    var r = await root.fetch(c.endpoint + '/sync/' + encodeURIComponent(name), { headers: { Authorization: 'Bearer ' + c.token } });
    if (r.status === 404) return null;
    if (r.status === 401 || r.status === 403) throw new Error('トークンが違います（' + r.status + '）');
    if (!r.ok) throw new Error('受け取りに失敗（' + r.status + '）');
    var d = await r.json(); return d && d.data !== undefined ? d.data : d;
  }
  // 戻り値: { docs, stat:{kd:n, qr:n, skipped:n}, err:{kd?,qr?} }
  async function loadFeed(opts) {
    opts = opts || {};
    var docs = [], stat = { kd: 0, qr: 0 }, err = {};
    var jobs = [['kd', fromKD], ['qr', fromQR]].filter(function (j) { return !opts.only || opts.only.indexOf(j[0]) >= 0; });
    await Promise.all(jobs.map(async function (j) {
      try { var d = await fetchBox(BOX[j[0]]); if (d) { var L = j[1](d); stat[j[0]] = L.length; docs = docs.concat(L); } }
      catch (e) { err[j[0]] = (e && e.message) || String(e); }
    }));
    return { docs: docs, stat: stat, err: err };
  }

  // ---------- 根拠の検索（見出し語・タグ・本文の重みつき） ----------
  function retrieve(docs, query, k, boost) {
    boost = boost || {};
    var qn = norm(query), qb = bigrams(query);
    var scored = docs.map(function (d) {
      var s = 0, tn = norm(d.title);
      if (tn.length >= 2 && qn.indexOf(tn) >= 0) s += 20;
      d.tags.forEach(function (t) { var n = norm(t); if (n.length >= 2 && qn.indexOf(n) >= 0) s += 8; });
      if (qb.size) {
        [[d.title, 6], [d.tags.join(' '), 4], [d.text, 1.5]].forEach(function (p) {
          if (!p[0]) return; var b = bigrams(p[0]), h = 0; qb.forEach(function (g) { if (b.has(g)) h++; }); s += p[1] * (h / qb.size) * 10;
        });
      }
      if (s > 0 && boost[d.id]) s *= Math.max(0.2, 1 + 0.2 * Math.max(-3, Math.min(3, boost[d.id])));   // 👍は上へ、👎は下へ（育てる）
      return { d: d, s: s };
    }).filter(function (x) { return x.s >= 3; }).sort(function (a, b) { return b.s - a.s; });
    var out = scored.slice(0, k || 6).map(function (x) { return x.d; });
    // 見出し語どうしのつながり（related）を少し足す
    var have = {}; out.forEach(function (d) { have[d.id] = 1; });
    out.slice(0, 2).forEach(function (d) {
      d.link.forEach(function (name) {
        if (out.length >= (k || 6) + 2) return;
        var hit = docs.filter(function (x) { return x.src === 'kd' && norm(x.title) === norm(name) && !have[x.id]; })[0];
        if (hit) { have[hit.id] = 1; out.push(hit); }
      });
    });
    return out;
  }
  function fullText(d) { return d.full || d.text || ''; }
  function material(d, budget, whole) {
    var t = '■[' + (d.src === 'kd' ? '辞書' : 'メモ') + ':' + redactTitle(d.title) + ']' + (d.tags.length ? '\nタグ：' + d.tags.join(' ') : '') + (d.text ? '\n' + d.text : '');
    if (whole) t = '■[' + (d.src === 'kd' ? '辞書' : 'メモ') + ':' + redactTitle(d.title) + ']\n' + fullText(d);
    return redact(t).text.slice(0, budget || 1400);
  }

  // ---------- AI呼び出し（sync-worker /ai。全アプリ共通の入口） ----------
  async function callAI(prompt, opts) {
    opts = opts || {};
    var c = config();
    if (!c.endpoint || !c.token) throw new Error('AIの接続が未設定です');
    if (!/^[\x21-\x7e]+$/.test(c.token)) throw new Error('トークンに使えない文字が含まれています');
    var safe = redact(prompt);   // 送る直前に必ず通す
    var model = /^[A-Za-z0-9._-]{3,60}$/.test(c.model) ? c.model : DEFAULT_MODEL[c.provider];
    var ctl = new root.AbortController(), tm = setTimeout(function () { ctl.abort(); }, opts.timeout || 90000);
    try {
      var r = await root.fetch(c.endpoint + '/ai', { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.token },
        body: JSON.stringify({ provider: c.provider, model: model, maxTokens: c.provider === 'gemini' ? undefined : (opts.maxTokens || 900), prompt: safe.text }) });
      if (r.status === 401) throw new Error('同期トークンが違います');
      if (!r.ok) throw new Error('AI中継がエラーを返しました（' + r.status + '）');
      var d = await r.json();
      return { text: d && typeof d.text === 'string' ? d.text : '', removed: safe.removed, model: model };
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('時間切れです（90秒）');
      throw e;
    } finally { clearTimeout(tm); }
  }

  // ---------- 答えの組み立て ----------
  var RULES = 'あなたは、私の個人の辞書とメモだけを根拠に答えるアシスタントです。\nルール:\n- 下の【材料】に書かれていることだけで答える。書かれていないことは「材料にはありません」と言う。\n- 根拠にした材料は、答え(answer)の中で [1] [2] のように番号で示す。\n- やさしい日本語で、短く。\n- 返事は JSON だけ: {"answer":"文章","actions":[]}\n- actions は、私が「表にして」「集合で比べて」「流れ図にして」など作ることを頼んだときだけ入れる。頼まれていなければ空の [] にする。\n  表: {"op":"table","title":"題","rows":[["見出し1","見出し2"],["値","値"]]}（1行目は見出し）\n  集合: {"op":"sets","sets":[{"name":"集合名","items":["材料にある語"]}]}\n  流れ図: {"op":"flow","title":"題","text":"開始 -> 確認\\n確認 -> 完了"}（1行に「A -> B」。短い言葉で）\n- actions の中身も、材料にあることだけで作る。';
  var GENERAL = 'あなたは、やさしい日本語で短く答えるアシスタントです。私の辞書にはこの話の材料がありません。一般的な知識で答え、答えの最初に「（辞書の材料なし・一般知識）」と書いてください。返事は JSON だけ: {"answer":"文章","actions":[]}。actions は表・集合・流れ図を頼まれたときだけ（形は {"op":"table","title":"題","rows":[[見出し...],[値...]]} / {"op":"sets","sets":[{"name":"","items":[]}]} / {"op":"flow","title":"題","text":"A -> B"}）。';
  function buildPrompt(question, hits) {
    var mat = hits.map(function (d, i) { return '【' + (i + 1) + '】' + material(d); }).join('\n\n');
    return RULES + '\n\n【材料】\n' + (mat || '(該当なし)') + '\n\n【質問】\n' + question;
  }
  function cell(v) { return String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ').trim().slice(0, 200); }
  // AIの返事 → { answer, actions }。actions は形と大きさを確かめたものだけ（実行は人が押したときだけ）
  function parseReply(raw) {
    var s = String(raw || '').replace(/```[a-z]*/gi, '').trim(), a = s.indexOf('{'), b = s.lastIndexOf('}'), o = null;
    if (a >= 0 && b > a) { try { o = JSON.parse(s.slice(a, b + 1)); } catch (_) { o = null; } }
    if (!o || typeof o !== 'object' || typeof o.answer !== 'string') return { answer: s, actions: [] };
    var acts = [];
    (Array.isArray(o.actions) ? o.actions : []).slice(0, 4).forEach(function (x) {
      if (!x || typeof x !== 'object') return;
      if (x.op === 'table' && Array.isArray(x.rows) && x.rows.length >= 1)
        acts.push({ op: 'table', title: cell(x.title).slice(0, 40) || 'AIが作った表', rows: x.rows.slice(0, 200).map(function (r) { return (Array.isArray(r) ? r : [r]).slice(0, 20).map(cell); }) });
      else if (x.op === 'sets' && Array.isArray(x.sets) && x.sets.length >= 2)
        acts.push({ op: 'sets', sets: x.sets.slice(0, 6).map(function (t) { return { name: cell(t && t.name).slice(0, 30) || '集合', items: (Array.isArray(t && t.items) ? t.items : []).slice(0, 200).map(cell).filter(Boolean) }; }) });
      else if (x.op === 'flow' && typeof x.text === 'string' && /->/.test(x.text))
        acts.push({ op: 'flow', title: cell(x.title).slice(0, 40) || 'AIが作ったフロー', text: x.text.split('\n').slice(0, 60).map(function (l) { return l.replace(/\s+/g, ' ').trim().slice(0, 80); }).filter(Boolean).join('\n') });
    });
    return { answer: o.answer.trim(), actions: acts };
  }
  // ---------- コードを書いてもらう（自分のルール帳を必ず前に置く） ----------
  var CODE_HEAD = 'あなたは「私専用」のコーディング助手です。次の【ルール帳】を必ず守ってください。\n- 「ダメ」の項目に触れる案は出さない。どうしても必要なら、触れる理由を先に1行で言って、代わりの案を出す。\n- 「よい」の項目は、そのまま従う。\n- 【材料】に私の過去のコード・メモがあれば、その書き方（命名・構成）に合わせる。無ければ無理に使わない。\n- 最初に「前提」を1〜3行（わからない点は推測と書く）。次に、貼ればそのまま動く完成コードを、言語つきのコードブロック1つで。最後に確かめ方を1〜2行。\n- 鍵・トークン・パスワードの値は書かない。<ここに入れる> のような穴あきは作らない。';
  function rulesText(rules) {
    rules = rules || [];
    var ng = rules.filter(function (r) { return r.type === 'ng'; }).map(function (r) { return '- ' + r.text; }), ok = rules.filter(function (r) { return r.type !== 'ng'; }).map(function (r) { return '- ' + r.text; });
    return '【ルール帳】\nダメ:\n' + (ng.join('\n') || '- (なし)') + '\nよい:\n' + (ok.join('\n') || '- (なし)');
  }
  function extractCode(text) {
    var out = [], re = /```([A-Za-z0-9+#_-]*)[^\n]*\n([\s\S]*?)```/g, m;
    while ((m = re.exec(String(text || '')))) out.push({ lang: (m[1] || '').toLowerCase(), code: m[2].replace(/\s+$/, '') });
    return out;
  }
  // 実行はしない。形だけ点検する（構文・秘密・穴あき・外部ライブラリ）
  function lintCode(c) {
    var w = [], code = c.code, lang = c.lang;
    code.split('\n').some(function (l) { return isSecret(l) && (w.push('鍵やトークンらしい行があります。値は書かないでください'), true); });
    if (/<[^<>\n]{0,30}(を入れ|に置き換え|ここ|your|YOUR|xxx)[^<>\n]*>/.test(code)) w.push('「<ここに…>」のような穴あきがあります（貼ってそのまま動きません）');
    if (/<script[^>]+src=["']https?:\/\//i.test(code) || /\bnpm (i|install)\b|\byarn add\b|\bpnpm add\b/.test(code)) w.push('外部ライブラリ／ビルドツールを使っています（単一ファイル方針に合うか確認）');
    var js = [];
    if (/^(js|javascript|mjs)$/.test(lang)) js.push(code);
    if (/^(html|htm)$/.test(lang)) code.replace(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi, function (_, x) { if (x.trim()) js.push(x); return ''; });
    js.forEach(function (x) { try { new Function(x); } catch (e) { w.push('JavaScript の構文エラー：' + e.message); } });
    if (/^(json)$/.test(lang)) { try { JSON.parse(code); } catch (e) { w.push('JSON が壊れています：' + e.message); } }
    return w;
  }
  var VERB = /全文|そのまま|原文|プロンプト|コマンド|スクリプト|コピペ|貼って|貼り付け/;
  var VERB_HEAD = 'あなたは私の辞書とメモの「引き出し係」です。下の【材料】に、頼まれたプロンプト・コマンド・文章があるときは、省略も要約も言い換えもせず、原文のまま全文を出してください。コードやコマンドはコードブロックに入れる。足りない部分があっても、材料に無いものは作らず「材料にはありません」と書く。前置きは1行まで。根拠は [1] のように番号で示す。';
  async function ask(docs, question, opts) {
    opts = opts || {};
    if (opts.code) {
      var ch = retrieve(docs, question, opts.k || 5, opts.boost), mt = ch.map(function (d, i) { return '【' + (i + 1) + '】' + material(d, 1600); }).join('\n\n');
      var cr = await callAI(CODE_HEAD + '\n\n' + rulesText(opts.rules) + '\n\n【材料】\n' + (mt || '(なし)') + '\n\n【頼みたいこと】\n' + question, { maxTokens: opts.maxTokens || 2500, timeout: opts.timeout || 120000 });
      var blocks = extractCode(cr.text).map(function (b) { b.warn = lintCode(b); return b; });
      return { answer: cr.text, actions: [], code: blocks, hits: ch, removed: cr.removed, model: cr.model, none: false, isCode: true };
    }
    if (!opts.general && VERB.test(question)) {   // 全文モード：プロンプト・コマンドは要約せず原文のまま
      var vh = retrieve(docs, question, 2, opts.boost);
      if (vh.length) {
        var vm = vh.map(function (d, i) { return '【' + (i + 1) + '】' + material(d, 7000, true); }).join('\n\n');
        var vr = await callAI(VERB_HEAD + '\n\n【材料】\n' + vm + '\n\n【頼みたいこと】\n' + question, { maxTokens: 4000, timeout: 120000 });
        return { answer: vr.text, actions: [], hits: vh, removed: vr.removed, model: vr.model, none: false, verbatim: true };
      }
    }
    var hits = opts.general ? [] : retrieve(docs, question, opts.k || 6, opts.boost);
    if (!hits.length && !opts.general) return { answer: '', actions: [], hits: [], none: true };
    var prompt = opts.general ? GENERAL + '\n\n【質問】\n' + question : buildPrompt(question, hits);
    var r = await callAI(prompt, opts), p = parseReply(r.text);
    return { answer: p.answer, actions: p.actions, hits: hits, removed: r.removed, model: r.model, none: false, general: !!opts.general };
  }

  var api = { fromKD: fromKD, fromQR: fromQR, fetchBox: fetchBox, loadFeed: loadFeed, retrieve: retrieve, material: material, buildPrompt: buildPrompt,
    callAI: callAI, ask: ask, fullText: fullText, VERB: VERB, parseReply: parseReply, extractCode: extractCode, lintCode: lintCode, rulesText: rulesText, redact: redact, redactTitle: redactTitle, isSecret: isSecret, config: config, plain: plain, EXCLUDE_TAGS: EXCLUDE_TAGS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.AICore = api;
})(typeof window !== 'undefined' ? window : globalThis);
