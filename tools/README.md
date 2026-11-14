# tools/ai-eval.js — 辞書とメモが「引けるか」を測る

AIも通信も使いません。読み取りだけで、結果は `--out`（既定 `./ai-eval-out`）にだけ書きます。

```powershell
node tools\ai-eval.js --kb C:\Users\norin\knowledge-base --qr C:\path\to\quick-ref.json --golden tools\golden.json
```

- `--kb`: 辞書パックのフォルダー。下の階層も読む。`entries` のある JSON だけが対象（それ以外は読まない）。
- `--kb` のフォルダーに置いた quick-ref の書き出し（`items`）と knowledge-dictionary の書き出し（`qas`）は、形を見て自動で入る（`--qr` / `--kd` で別の場所のファイルも足せる）。保護メモ・暗号化メモ・AI作成/まとまり/用語/スライスのタグは、`ai-core.js` が外す。
- `--golden`: 自分の本当の質問と、出てほしい見出し語（`golden.example.json` を写して編集）。
- 見方: 「1位で引けた」「上位k件で引けた」「MRR（1に近いほど上位に出る）」。引けなかった質問は、一覧に出る。
- 自動の試験: 辞書の説明文から、見出し語を伏せた質問を作り、その語が引けるかを測る（意味から引ける辞書か）。
- 秘密らしい行は、件数だけ数え、中身は表示も保存もしない。

数字が上がるように、辞書を足し・直し、もう一度測る。これが「育てる」の1周になる。

試験: `node tools\test-ai-eval.js`

# tools/merge-packs.js — 辞書パックを1つにまとめる

```powershell
node tools\merge-packs.js --kb C:\Users\norin\knowledge-base --out C:\Users\norin\knowledge-base\dict-pack.json
```

`dict_*.json` を全部まとめ、同じ id は新しい方を採用します。前の `dict-pack.json` の項目も引き継ぎ、書き換える前に `.bak-日時` を残します（消しません）。できた `dict-pack.json` を、アプリの「知識」→「辞書パック」から読み込みます。

試験: `node tools\test-merge-packs.js` / `node tools\test-ai-answer.js`

# tools/mine-qr.js — quick-ref のメモから「辞書に無い話題」を見つける

```powershell
node tools\mine-qr.js --kb C:\Users\norin\knowledge-base --qr C:\path\quick-ref.json --out $HOME\mine-out
```

AIも通信も使いません。メモの題名とタグで辞書を引き、引けない・弱いものを「穴」として数えます。
- `gap-report.txt`: 話題（タグ）ごとの穴の数と、引けないメモの題名（本文は入れません）。
- `topics-for-claude.txt`: 辞書を厚くしたい話題の一覧。**既定ではタグ名と件数だけ**です。題名も足したいときだけ `--with-titles`。
- 保護メモ・AI作成等のタグ・秘密らしい題名は外すか伏せます。元のファイルは変えません。

試験: `node tools\test-mine-qr.js`

## アプリの「🌱 育てる → 🔎 まとめ忘れ探し」
mine-qr.js と同じ判定（ai-core の `gapScan`）を、アプリの中で使えます。メモの題で辞書を引き、引けない話題を並べます。
- 「頼む文をコピー」: そのメモ（秘密らしい行は伏せ済み）から、辞書の項目を1つ作る依頼文を作ります。普通のAIに貼ります。
- 返ってきたJSONを「辞書に足す」へ貼ると、今の辞書パックに足されます（置き換えません）。秘密らしい行を含む項目は入りません。
- 「今は不要」で、その候補を外せます（この端末のみ）。

試験: `node tools\test-gap.js`
