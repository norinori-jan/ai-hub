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
      out.push({ id: 'kd:' + e.id, src: 'kd', title: String(e.term), full: fp.join('\n\n'), text: parts.join('\n'), tags: (e.tags || []).map(String), kind: e.kind || 'term', updatedAt: e.updatedAt || 0, link: (e.related || []).map(String), und: e.understanding || 'unknown', body: !!(e.oneLine || e.note || (by[e.id] || []).length), rid: String(e.id) });
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

  // ---------- 辞書パック（週末エージェントが作る辞書）→ 文書 ----------
  function srcLabel(src) { return src === 'kd' ? '辞書' : src === 'qr' ? 'メモ' : src === 'ah' ? '育てた答え' : src === 'pk' ? '辞書パック' : src; }
  function packText(e) {
    var L = [];
    if (e.summary) L.push(e.summary);
    if (e.form) L.push('【形】\n' + e.form);
    if (e.parts && e.parts.length) L.push('【部品の意味】\n' + e.parts.map(function (p) { return Array.isArray(p) ? '- ' + p[0] + '：' + (p[1] || '') : '- ' + p; }).join('\n'));
    if (e.example) L.push('【例】\n' + e.example);
    if (e.mistakes && e.mistakes.length) L.push('【よくある間違い】\n' + e.mistakes.map(function (m) { return '- ' + m; }).join('\n'));
    if (e.related && e.related.length) L.push('【関連】' + e.related.join('、'));
    if (e.sources && e.sources.length) L.push('【出どころ（自分のメモ）】' + e.sources.map(function (x) { return x.title || x.id; }).join(' ／ '));
    return L.join('\n\n');
  }
  function fromPack(pack) {
    var E = pack && Array.isArray(pack.entries) ? pack.entries : [], out = [];
    var seen = {};
    E.slice(0, 20000).forEach(function (e) {
      if (!e || typeof e.term !== 'string' || !e.term.trim()) return;
      var full = packText(e), id = String(e.id || (e.lang || 'x') + ':' + e.term);
      var ts = e.updatedAt || (pack && pack.builtAt) || 0;
      if (seen[id] !== undefined) { if (ts < out[seen[id]].updatedAt) return; out.splice(seen[id], 1); Object.keys(seen).forEach(function (k) { if (seen[k] > seen[id]) seen[k]--; }); }
      seen[id] = out.length;
      out.push({ id: 'pk:' + id, src: 'pk', title: e.term.trim(), full: full, text: full.slice(0, 1800), tags: [e.lang, e.kind].concat(e.tags || []).filter(Boolean).map(String), kind: 'pack', updatedAt: e.updatedAt || (pack && pack.builtAt) || 0, link: (e.related || []).map(String) });
    });
    return out;
  }
  // ---------- コピペ方式（API不使用）：普段のAIに貼る質問を作る／返事を取り込む ----------
  function makePaste(docs, question, opts) {
    opts = opts || {};
    var hits = retrieve(docs, question, opts.code ? 5 : 6, opts.boost), text;
    if (!hits.length) return { text: '', hits: [], removed: 0, none: true };
    if (opts.code) {
      var mt = hits.map(function (d, i) { return '【' + (i + 1) + '】' + material(d, 1600); }).join('\n\n');
      text = CODE_HEAD + '\n\n' + rulesText(opts.rules) + '\n\n【材料】\n' + mt + '\n\n【頼みたいこと】\n' + question;
    } else {
      text = buildPrompt(question, hits);
    }
    var r = redact(text);
    return { text: r.text, hits: hits, removed: r.removed, none: false };
  }
  function mdTables(text) {
    var L = String(text || '').split('\n'), out = [], i = 0;
    while (i < L.length) {
      if (/^\s*\|.*\|\s*$/.test(L[i]) && i + 1 < L.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(L[i + 1])) {
        var rows = [], j = i;
        while (j < L.length && /^\s*\|.*\|\s*$/.test(L[j])) {
          if (j !== i + 1) rows.push(L[j].trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return cell(c.replace(/\*\*/g, '')); }));
          j++;
        }
        if (rows.length >= 2) out.push({ op: 'table', title: '貼り付けた表', rows: rows.slice(0, 200) });
        i = j;
      } else i++;
    }
    return out;
  }
  function parsePasted(raw) {
    var text = String(raw || '').trim(), p = parseReply(text), acts = p.actions.slice(), jsonOk = acts.length > 0 || /\{\s*"answer"/.test(text);
    var answer = p.answer, code = extractCode(text).filter(function (c) { return !/^(json)?$/.test(c.lang) || !/^\s*\{[\s\S]*"answer"/.test(c.code); }).map(function (b) { b.warn = lintCode(b); return b; });
    if (!jsonOk) {
      mdTables(text).forEach(function (t) { if (acts.length < 4) acts.push(t); });
      var fl = text.split('\n').map(function (l) { return l.replace(/^[\s>*\-\d.)]+/, '').trim(); }).filter(function (l) { return /^[^|`]{1,40}\s*->\s*[^|`]{1,40}$/.test(l); });
      if (fl.length >= 2 && acts.length < 4) acts.push({ op: 'flow', title: '貼り付けた流れ', text: fl.slice(0, 60).join('\n') });
    }
    return { answer: answer, actions: acts, code: code, isCode: code.length > 0 && !jsonOk, fromJson: jsonOk };
  }
  // ---------- 辞書だけで作る（AI不使用）：検索結果を表・流れ・コード枠にする ----------
  function cellOf(x, n) { return String(x == null ? '' : x).replace(/[\t\r\n]+/g, ' ').replace(/->/g, '→').trim().slice(0, n || 60); }
  function secOf(full, name) { var m = String(full || '').match(new RegExp('【' + name + '】\\n([\\s\\S]*?)(?:\\n\\n【|$)')); return m ? m[1].trim() : ''; }
  function shortTitle(t) { return cellOf(String(t || '').replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, ''), 18) || cellOf(t, 18); }
  function localTable(hits) {
    var rows = [['項目', '種類', '要点', '形（先頭の行）', '出どころ']];
    (hits || []).forEach(function (d) {
      var first = String(d.text || '').split('\n').filter(function (l) { return l.trim(); })[0] || '';
      var form = secOf(d.full, '形').split('\n')[0] || '';
      rows.push([cellOf(d.title, 30), cellOf(d.kind, 10), cellOf(first.replace(/^一言：/, ''), 60), cellOf(form, 60), srcLabel(d.src)]);
    });
    return { op: 'table', title: '辞書から作った表', rows: rows };
  }
  function localFlow(hits) {
    var H = (hits || []).slice(0, 10), lines = [], seen = {};
    function find(r) { r = String(r); for (var i = 0; i < H.length; i++) { var d = H[i]; if (d.id === r || d.id === 'pk:' + r || d.id === 'kd:' + r || d.rid === r || String(d.title).toLowerCase() === r.toLowerCase()) return d; } return null; }
    H.forEach(function (d) { (d.link || []).forEach(function (r) { var t = find(r); if (t && t !== d) { var l = shortTitle(d.title) + ' -> ' + shortTitle(t.title); if (!seen[l]) { seen[l] = 1; lines.push(l); } } }); });
    var linked = lines.length > 0;
    if (!linked) for (var i = 0; i + 1 < H.length; i++) lines.push(shortTitle(H[i].title) + ' -> ' + shortTitle(H[i + 1].title));
    return { op: 'flow', title: linked ? '辞書のつながり' : '辞書の項目（関連順）', text: lines.join('\n'), linked: linked };
  }
  function localSnippets(hits) {
    var out = [];
    (hits || []).slice(0, 4).forEach(function (d) {
      var form = secOf(d.full, '形'), ex = secOf(d.full, '例');
      if (form || ex) out.push({ title: d.title, form: form, example: ex, mistakes: secOf(d.full, 'よくある間違い') });
    });
    return out;
  }
  // ---------- 整理：辞書の理解度から「次にやること」を出す（AI不使用） ----------
  var UNDL = { unknown: '未理解', learning: '理解中', known: '理解済' };
  function plan(docs) {
    var K = (docs || []).filter(function (d) { return d && d.src === 'kd'; }).slice(0, 1500);
    var stat = { n: K.length, unknown: 0, learning: 0, known: 0, empty: 0, noUnd: 0 };
    var byRid = {}, low = K.map(function (d) { return (d.full || d.text || '').toLowerCase(); });
    K.forEach(function (d) { byRid[d.rid] = d; });
    var refs = K.map(function () { return 0; });
    K.forEach(function (d, i) {
      var t = String(d.title || '').toLowerCase().trim(), c = 0;
      (d.link || []).forEach(function (r) { if (byRid[r] || K.some(function (x) { return String(x.title).toLowerCase() === String(r).toLowerCase(); })) c++; });
      if (t.length >= 3) low.forEach(function (tx, j) { if (j !== i && tx.indexOf(t) >= 0) c++; });
      refs[i] = c;
      if (d.und === undefined) stat.noUnd++;
      var u = d.und === 'known' || d.und === 'learning' ? d.und : 'unknown';
      stat[u]++; if (!d.body) stat.empty++;
    });
    var tags = {};
    K.forEach(function (d) {
      var u = d.und === 'known' || d.und === 'learning' ? d.und : 'unknown';
      (d.tags.length ? d.tags : ['（棚なし）']).forEach(function (t) { var o = tags[t] || (tags[t] = { tag: t, n: 0, unknown: 0, learning: 0, known: 0, empty: 0 }); o.n++; o[u]++; if (!d.body) o.empty++; });
    });
    var shelves = Object.keys(tags).map(function (k) {
      var o = tags[k]; o.pct = Math.round(o.known / o.n * 100);
      if (o.known / o.n >= 0.7) o.next = '復習だけ（3日後・7日後に見返す）';
      else if (o.learning > 0) o.next = '「理解中」の ' + o.learning + '件を先に仕上げる';
      else if (o.empty / o.n >= 0.6) o.next = '中身が空が多い。上位3件だけAIに説明させて「一言」を書く';
      else o.next = '上位3件を読み返して「理解中」にする';
      return o;
    }).sort(function (a, b) { return (b.unknown - a.unknown) || (b.n - a.n); }).slice(0, 40);
    var queue = K.map(function (d, i) {
      var u = d.und === 'known' ? 'known' : d.und === 'learning' ? 'learning' : 'unknown';
      var score = (u === 'unknown' ? 3 : u === 'learning' ? 2 : 0) + refs[i] + (d.body ? 0.5 : 0);
      return { id: d.id, title: d.title, tag: d.tags[0] || '（棚なし）', und: u, refs: refs[i], empty: !d.body, score: score,
        action: u === 'known' ? '復習（見返すだけ）' : (!d.body ? 'AIに説明させて、「一言」を書く' : u === 'learning' ? '読み返して、自分の言葉で「一言」を直す' : '読み返して「理解中」にする') };
    }).filter(function (x) { return x.und !== 'known'; }).sort(function (a, b) { return b.score - a.score; }).slice(0, 7);
    var all = K.map(function (d, i) {
      var u = d.und === 'known' ? 'known' : d.und === 'learning' ? 'learning' : 'unknown';
      return [d.title, d.tags[0] || '（棚なし）', UNDL[u], refs[i], d.body ? 'あり' : '空', u === 'known' ? '復習' : (!d.body ? '説明させる' : '読み返す')];
    });
    return { stat: stat, shelves: shelves, queue: queue, all: all };
  }
  function planActs(pl) {
    var cl = function (x) { return String(x == null ? '' : x).replace(/[\t\r\n]+/g, ' ').trim(); };
    var acts = {};
    acts.shelves = { op: 'table', title: '棚ごとの次の一手', rows: [['棚', '件数', '未理解', '理解中', '理解済', '次の一手']].concat(pl.shelves.map(function (o) { return [cl(o.tag), o.n, o.unknown, o.learning, o.known, cl(o.next)]; })) };
    acts.all = { op: 'table', title: '辞書の全項目と次の一手', rows: [['項目', '棚', '理解度', '参照', '中身', '次の一手']].concat(pl.all.slice(0, 150).map(function (r) { return r.map(cl); })) };
    var lines = ['開始 -> 1 ' + cl((pl.queue[0] || { title: '（なし）' }).title).slice(0, 16)];
    pl.queue.forEach(function (q, i) { var nx = pl.queue[i + 1]; lines.push('1 ' .replace('1', String(i + 1)) + cl(q.title).slice(0, 16) + ' -> ' + (nx ? (i + 2) + ' ' + cl(nx.title).slice(0, 16) : '理解度を更新')); });
    lines[0] = '開始 -> 1 ' + cl((pl.queue[0] || { title: '（なし）' }).title).slice(0, 16);
    lines.push('理解度を更新 -> 終わり');
    acts.flow = { op: 'flow', title: '今日の学習の流れ', text: lines.join('\n') };
    return acts;
  }
  // ---------- 自分のデータから構文・コマンドを拾う（AI不使用） ----------
  var MINE = [
    { lang: 'ps', re: /\b(?:Get|Set|New|Remove|Copy|Move|Test|Join|Select|Where|ForEach|Sort|Out|Write|Invoke|Start|Stop|Add|Clear|Compare|ConvertFrom|ConvertTo|Convert|Expand|Export|Import|Find|Format|Measure|Read|Rename|Resolve|Split|Unblock|Enable|Disable|Install|Uninstall|Register|Restart|Show|Wait|Push|Pop)-[A-Z][A-Za-z]+\b/g },
    { lang: 'js', re: /\b(?:document|window|navigator|localStorage|sessionStorage|indexedDB|JSON|Math|Object|Array|Promise|URL|Intl|Date|Number|String)\.[A-Za-z]+\b/g },
    { lang: 'js', re: /\b(?:fetch|addEventListener|querySelectorAll|querySelector|getElementById|setTimeout|setInterval|requestAnimationFrame)(?=\()/g },
    { lang: 'sql', re: /\b(?:SELECT|INSERT INTO|UPDATE|DELETE FROM|CREATE TABLE|LEFT JOIN|JOIN|GROUP BY|ORDER BY|WHERE|HAVING)\b/g }
  ];
  var CLI = /^\s*(?:PS [^>]*>|[$>%]\s*)?(git|gh|npm|npx|node|python3?|py|pip3?|curl|winget|wrangler|ssh|brew|claude|cd|ls|cp|mv|rm|mkdir|chmod|grep|find|cat|echo)\b(?:\s+([a-z][a-z-]*))?/;
  function mine(docs, opts) {
    opts = opts || {};
    var map = {};
    function hit(lang, term, d, line) {
      var k = lang + '\u0000' + term, m = map[k] || (map[k] = { lang: lang, term: term, count: 0, docs: {}, ex: [] });
      m.count++; m.docs[d.id] = d.title;
      var l = line.trim().slice(0, 160);
      if (l && m.ex.length < 3 && m.ex.indexOf(l) < 0 && !isSecret(l)) m.ex.push(l);
    }
    docs.forEach(function (d) {
      if (d.src !== 'kd' && d.src !== 'qr') return;
      fullText(d).split('\n').forEach(function (line) {
        if (line.length > 400) return;
        MINE.forEach(function (p) { var m; p.re.lastIndex = 0; while ((m = p.re.exec(line))) hit(p.lang, m[0].trim(), d, line); });
        var c = CLI.exec(line);
        if (c) { var sub = c[2] && !/^(the|and|for|is|to|a)$/.test(c[2]) ? ' ' + c[2] : ''; hit(c[1] === 'git' || c[1] === 'gh' ? c[1] : 'sh', c[1] + sub, d, line); }
      });
    });
    var min = opts.min || 1;
    return Object.keys(map).map(function (k) { return map[k]; }).filter(function (m) { return m.count >= min; })
      .sort(function (a, b) { return b.count - a.count || a.term.localeCompare(b.term); }).slice(0, opts.max || 400)
      .map(function (m) {
        var ids = Object.keys(m.docs);
        return { id: 'mn:' + m.lang + ':' + m.term, term: m.term, lang: m.lang, kind: 'mined', summary: '自分のメモで ' + m.count + '回、' + ids.length + '件のメモに出てきました（AIは使わず拾っただけ。意味の説明はまだありません）', example: m.ex.join('\n'), sources: ids.slice(0, 5).map(function (i) { return { id: i, title: m.docs[i] }; }), tags: ['自分の使い方'], count: m.count, updatedAt: Date.now() };
      });
  }
  // エージェント（PCのClaude Code）に渡す材料。保護メモは入口で外れている。さらに秘密らしい行を伏せる
  function exportRaw(docs) {
    var skipped = 0, L = [];
    docs.forEach(function (d) {
      if (d.src !== 'kd' && d.src !== 'qr') return;
      var r = redact(fullText(d)); skipped += r.removed;
      L.push({ id: d.id, src: d.src, title: redactTitle(d.title), tags: d.tags, updatedAt: d.updatedAt, text: r.text });
    });
    var mined = mine(docs).map(function (m) { return { term: m.term, lang: m.lang, count: m.count, example: m.example, sources: m.sources.map(function (x) { return x.title; }) }; });
    return { app: 'ai-hub-raw', version: 1, at: Date.now(), count: L.length, redactedLines: skipped, docs: L, mined: mined };
  }

  // ---------- 根拠の検索（見出し語・タグ・本文の重みつき） ----------
  // 珍しい2文字ほど重く数える（どの項目にも出る「プロンプト」「ブラウザー」などより、決め手になる語を優先）
  var DFC = { key: '', df: null };
  function docFreq(docs) {
    var sum = 0, last = docs.length ? docs[docs.length - 1].id : '';
    docs.forEach(function (d) { sum += (d.updatedAt || 0) % 1000003; });
    var key = docs.length + ':' + last + ':' + sum;
    if (DFC.key === key) return DFC.df;
    var df = {};
    docs.forEach(function (d) {
      var u = new Set();
      [d.title, d.tags.join(' '), d.text].forEach(function (f) { if (f) bigrams(f).forEach(function (g) { u.add(g); }); });
      u.forEach(function (g) { df[g] = (df[g] || 0) + 1; });
    });
    DFC.key = key; DFC.df = df;
    return df;
  }
  function scoreAll(docs, query, boost) {
    boost = boost || {};
    var qn = norm(query), qb = bigrams(query), df = docFreq(docs), N = docs.length || 1;
    function w(g) { return Math.log(1 + N / (df[g] || 1)); }
    var qs = 0; qb.forEach(function (g) { qs += w(g); });
    return docs.map(function (d) {
      var s = 0, tn = norm(d.title);
      if (tn.length >= 2 && qn.indexOf(tn) >= 0) s += 20;
      d.tags.forEach(function (t) { var n = norm(t); if (n.length >= 2 && qn.indexOf(n) >= 0) s += 8; });
      if (qb.size && qs > 0) {
        [[d.title, 6], [d.tags.join(' '), 4], [d.text, 1.5]].forEach(function (p) {
          if (!p[0]) return; var b = bigrams(p[0]), h = 0; qb.forEach(function (g) { if (b.has(g)) h += w(g); }); s += p[1] * (h / qs) * 10;
        });
      }
      if (s > 0 && boost[d.id]) s *= Math.max(0.2, 1 + 0.2 * Math.max(-3, Math.min(3, boost[d.id])));   // 👍は上へ、👎は下へ（育てる）
      return { d: d, s: s };
    }).filter(function (x) { return x.s >= 3; }).sort(function (a, b) { return b.s - a.s; });
  }
  function retrieve(docs, query, k, boost) {
    var scored = scoreAll(docs, query, boost);
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
  // ---------- 質問に当たる一文を選ぶ（AIなし） ----------
  function bestSnippet(d, query, maxLen) {
    maxLen = maxLen || 280;
    var text = redact(String(d.full || d.text || '')).text;
    var units = [];
    text.split(/\n+/).forEach(function (line) {
      var l = line.trim(); if (!l || l === HIDDEN) return;
      if (/^【[^】]*】$/.test(l)) return;                       // 見出しだけの行は材料にしない
      l.replace(/([。！？])/g, '$1\u0001').split('\u0001').forEach(function (u) { u = u.trim(); if (u.length >= 4) units.push(u); });
    });
    if (!units.length) return '';
    var qb = bigrams(query);
    var scored = units.map(function (u, i) { var b = bigrams(u), h = 0; qb.forEach(function (g) { if (b.has(g)) h++; }); return { u: u, i: i, h: h }; });
    var picked = scored.filter(function (x) { return x.h > 0; }).sort(function (a, b) { return b.h - a.h || a.i - b.i; }).slice(0, 2).sort(function (a, b) { return a.i - b.i; });
    if (!picked.length) picked = scored.slice(0, 2);
    var out = picked.map(function (x) { return x.u; }).join('\n');
    return out.length > maxLen ? out.slice(0, maxLen) + '…' : out;
  }
  // state: 'sure'（見出し語が質問に入っている等、はっきりしている）／'maybe'（近いが確信は高くない）／'none'（材料なし）
  function quickAnswer(docs, query, boost) {
    var sc = scoreAll(docs, query, boost);
    if (!sc.length) return { state: 'none', top: null, snippet: '', more: [] };
    var top = sc[0], second = sc[1], tn = norm(top.d.title);
    var titleHit = tn.length >= 2 && norm(query).indexOf(tn) >= 0;
    var sure = titleHit || (top.s >= 12 && (!second || top.s >= 1.5 * second.s));
    return { state: sure ? 'sure' : 'maybe', top: top.d, score: top.s, snippet: bestSnippet(top.d, query), more: sc.slice(1, 7).map(function (x) { return x.d; }) };
  }
  function fullText(d) { return d.full || d.text || ''; }
  function material(d, budget, whole) {
    var t = '■[' + srcLabel(d.src) + ':' + redactTitle(d.title) + ']' + (d.tags.length ? '\nタグ：' + d.tags.join(' ') : '') + (d.text ? '\n' + d.text : '');
    if (whole) t = '■[' + srcLabel(d.src) + ':' + redactTitle(d.title) + ']\n' + fullText(d);
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

  // ---------- まとめ忘れ探し（メモにあるのに、辞書にまだ無い話題を見つける。AIなし） ----------
  // memos: メモの文書（fromQR など）／ pk: 辞書パックの文書（fromPack）。保護メモは、入口の fromQR で外れている。
  function gapScan(memos, pk, weakBelow, covMin) {
    var wb = weakBelow || 6, cm = covMin == null ? 0.5 : covMin, rows = [], tagAll = {}, tagGap = {};
    // 題の語（数字を除く）が、一番近い辞書項目の題・タグにどれだけ含まれるか。低いなら、似ているだけで、その話題は無い
    function titleCover(title, top) {
      var tb = bigrams(String(title || '').replace(/[0-9０-９]+/g, '')), hb = bigrams((top && top.title || '') + ' ' + ((top && top.tags) || []).join(' ')), n = 0, c = 0;
      tb.forEach(function (g) { n++; if (hb.has(g)) c++; });
      return n ? c / n : 1;
    }
    (memos || []).forEach(function (d) {
      var a = quickAnswer(pk || [], String(d.title || '').length >= 2 ? d.title : (d.title + ' ' + (d.tags || []).join(' ')), {}); // 題だけで引く（タグを混ぜると、同じタグの別項目で「引けた」と誤る）
      var st = a.state === 'none' ? 'none' : (a.state === 'sure' ? 'sure' : ((a.score || 0) < wb ? 'weak' : 'maybe'));
      var cov = a.top ? titleCover(d.title, a.top) : 0;
      if (st === 'maybe' && cov < cm) st = 'weak';
      rows.push({ doc: d, state: st, top: a.top ? a.top.title : '', cover: Math.round(cov * 100) / 100 });
      (d.tags || []).forEach(function (t) { tagAll[t] = (tagAll[t] || 0) + 1; if (st === 'none' || st === 'weak') tagGap[t] = (tagGap[t] || 0) + 1; });
    });
    var cnt = function (s) { return rows.filter(function (r) { return r.state === s; }).length; };
    var tags = Object.keys(tagAll).map(function (t) { return { tag: t, memos: tagAll[t], gaps: tagGap[t] || 0 }; })
      .sort(function (a, b) { return b.gaps - a.gaps || b.memos - a.memos; });
    return { total: rows.length, sure: cnt('sure'), maybe: cnt('maybe'), weak: cnt('weak'), none: cnt('none'), rows: rows, tags: tags };
  }
  function shortHash(s) { var h = 5381; s = String(s); for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(16); }
  // 穴のメモ1件から、「辞書の項目を1つ作って」と頼む文を作る（普通のAIに貼る用）。秘密らしい行は伏せる。
  function gapPrompt(d, now) {
    var id = 'qr-' + shortHash(d.id), body = redact(fullText(d)).text.slice(0, 1400);
    return '次の「私のメモ」だけを根拠に、辞書の項目を1つ作ってください。\n' +
      '- メモに書いていないことは足さない。足りない点は「要確認」と書く。\n- 説明は、やさしい日本語で、3〜5文。使い方の例があれば example に。\n' +
      '- 出力は、次の形のJSONだけ（説明文やコードブロックの記号は不要）。id と updatedAt は、そのまま。\n' +
      '{"id":"' + id + '","lang":"qr","kind":"term","term":"見出し語","summary":"説明","example":"","mistakes":[],"related":[],"tags":[],"updatedAt":' + (now || Date.now()) + '}\n\n' +
      '【メモの題】' + redactTitle(d.title) + '\n【タグ】' + (d.tags || []).join(' ') + '\n【メモ】\n' + body;
  }
  // 返ってきたJSONを、辞書パックの項目として検める。秘密らしい行を含む項目・形の違う項目は、入れない（中身は報告しない）。
  function parseEntries(text, now) {
    var t = String(text || '').trim().replace(/^```[A-Za-z]*\s*/, '').replace(/```\s*$/, '').trim(), j, out = [], rejected = [];
    try { j = JSON.parse(t); } catch (e) { return { entries: [], rejected: ['JSONとして読めませんでした'] }; }
    var arr = Array.isArray(j) ? j : (j && Array.isArray(j.entries) ? j.entries : (j && typeof j === 'object' ? [j] : []));
    arr.forEach(function (e, i) {
      if (!e || typeof e !== 'object') { rejected.push((i + 1) + '件目: 形が違います'); return; }
      var term = String(e.term || '').trim(), sum = String(e.summary || '').trim();
      if (!term || term.length > 80) { rejected.push((i + 1) + '件目: 見出し語がありません（または長すぎます）'); return; }
      if (sum.length < 10 || sum.length > 1500) { rejected.push((i + 1) + '件目: 説明が短すぎる／長すぎます'); return; }
      var strs = function (v) { return (Array.isArray(v) ? v : []).map(String).filter(Boolean).slice(0, 12); };
      var n = { id: String(e.id || 'qr-' + shortHash(term)).slice(0, 80), lang: String(e.lang || 'qr').slice(0, 16), kind: String(e.kind || 'term').slice(0, 16), term: term, summary: sum, updatedAt: now || Date.now() };
      if (e.form) n.form = String(e.form).slice(0, 400);
      if (e.example) n.example = String(e.example).slice(0, 800);
      ['mistakes', 'related', 'tags'].forEach(function (k) { var a = strs(e[k]); if (a.length) n[k] = a; });
      var all = [n.term, n.summary, n.form || '', n.example || ''].concat(n.mistakes || [], n.related || [], n.tags || []).join('\n');
      if (all.split('\n').some(isSecret)) { rejected.push((i + 1) + '件目: 秘密らしい行を含むため入れません'); return; }
      out.push(n);
    });
    return { entries: out, rejected: rejected };
  }
  // 今の辞書パックに足す（同じidは、新しい方）。元のパックは変えず、新しいパックを返す。
  function mergeEntries(pack, entries) {
    var base = pack && Array.isArray(pack.entries) ? pack.entries : [], map = {}, added = 0, replaced = 0, order = [];
    base.forEach(function (e) { map[e.id] = e; order.push(e.id); });
    (entries || []).forEach(function (e) {
      var o = map[e.id];
      if (!o) { map[e.id] = e; order.push(e.id); added++; }
      else if ((e.updatedAt || 0) >= (o.updatedAt || 0)) { map[e.id] = e; replaced++; }
    });
    var np = {}; for (var k in (pack || {})) np[k] = pack[k];
    np.app = 'dict-pack'; np.version = 1; np.builtAt = Date.now(); np.entries = order.map(function (id) { return map[id]; });
    return { pack: np, added: added, replaced: replaced };
  }

  var api = { gapScan: gapScan, gapPrompt: gapPrompt, parseEntries: parseEntries, mergeEntries: mergeEntries, fromKD: fromKD, fromQR: fromQR, fetchBox: fetchBox, loadFeed: loadFeed, retrieve: retrieve, quickAnswer: quickAnswer, bestSnippet: bestSnippet, material: material, buildPrompt: buildPrompt,
    callAI: callAI, ask: ask, fullText: fullText, fromPack: fromPack, makePaste: makePaste, parsePasted: parsePasted, localTable: localTable, localFlow: localFlow, localSnippets: localSnippets, plan: plan, planActs: planActs, mine: mine, exportRaw: exportRaw, srcLabel: srcLabel, VERB: VERB, parseReply: parseReply, extractCode: extractCode, lintCode: lintCode, rulesText: rulesText, redact: redact, redactTitle: redactTitle, isSecret: isSecret, config: config, plain: plain, EXCLUDE_TAGS: EXCLUDE_TAGS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.AICore = api;
})(typeof window !== 'undefined' ? window : globalThis);
