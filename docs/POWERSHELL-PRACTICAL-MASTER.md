# PowerShell実務マスター｜完全学習・コマンド作成ガイド

版 1.0 / 2026-11-25

> 目的：PowerShellを「読める」「調べられる」「組み立てられる」「安全に実行できる」「報告できる」状態にする。まずは読み取り専用の調査コマンドを習得し、変更系は検証環境・承認・ロールバックがそろってから扱う。

## 1. 最初に覚える考え方

PowerShellは単なる文字列コマンドではなく、.NETオブジェクトをパイプラインで次のコマンドへ渡すシェル兼スクリプト言語。

| 部品 | 意味 | 例 |
|---|---|---|
| Verb | 動作 | Get / Set / New / Remove / Test |
| Noun | 対象 | Service / Process / ChildItem |
| Parameter | オプション | -Name / -ComputerName |
| Argument | パラメーターに渡す値 | -Name 'Spooler' |
| Pipeline | 前の結果を次へ渡す | \`|\` |
| Variable | 値を保持 | \`$computerName\` |
| Script | コマンドをまとめたファイル | \`.ps1\` |
| Function | 再利用できる処理 | \`function Get-X {}\` |

基本形：

\`\`\`powershell
Verb-Noun -ParameterName 'Value'
\`\`\`

例：

\`\`\`powershell
Get-Service -Name 'Spooler'
\`\`\`

## 2. コマンドを自分で作る7ステップ

1. **目的を一文にする**：「何を」「どこから」「どんな条件で」「どうしたい」。
2. **対象を特定する**：端末名、サービス名、ファイルパス、期間など。
3. **Get-Commandで候補を探す**：\`Get-Command *Service*\`。
4. **Get-Helpで構文を調べる**：\`Get-Help Get-Service -Examples\`。
5. **まず1コマンドだけ試す**：読み取り専用で出力を確認。
6. **Where / Select / Sort / Measureで加工する**：小さな段階に分けてつなぐ。
7. **安全性・エラー・結果を確認する**：変更系ならWhatIf、承認、バックアップ、ロールバックを用意。

### 依頼をコマンドに変換する例

依頼：「停止しているサービスを一覧にして、サービス名と表示名を見たい」

- 対象：サービス
- 条件：Status が Stopped
- 出力：Name、DisplayName
- コマンド：

\`\`\`powershell
Get-Service |
    Where-Object { $_.Status -eq 'Stopped' } |
    Select-Object Name, DisplayName
\`\`\`

## 3. パイプラインの読み方

\`Get-Service | Where-Object ... | Select-Object ...\` は左から右へ読む。

| コマンド | 役割 | 覚え方 |
|---|---|---|
| Get-* | 取得 | まず現状を見る |
| Where-Object | 条件で絞る | 必要なものだけ残す |
| Select-Object | 列・件数を選ぶ | 見たい情報だけ |
| Sort-Object | 並べ替え | 大きい順・新しい順 |
| Measure-Object | 集計 | 件数・合計・平均 |
| Group-Object | 分類 | 状態別・部署別 |
| Format-Table | 画面表示 | 最後に見た目を整える |
| Export-Csv | ファイル出力 | 後でExcel等で確認 |

**重要：** Format-Table / Format-List は表示用。後続処理でデータを使う場合は、パイプラインの途中に入れない。CSV出力はFormat-Tableより前のオブジェクトに対して行う。

## 4. 最初に覚える基本コマンド

### 調べる・ヘルプ
\`\`\`powershell
$PSVersionTable
Get-Command *Service*
Get-Help Get-Service -Examples
Get-Help Get-Service -Full
Get-Service | Get-Member
\`\`\`

### PC・OS情報
\`\`\`powershell
$env:COMPUTERNAME
Get-ComputerInfo | Select-Object WindowsProductName, OsVersion, CsDomain
Get-CimInstance Win32_OperatingSystem |
    Select-Object Caption, Version, LastBootUpTime
\`\`\`

### サービス・プロセス
\`\`\`powershell
Get-Service
Get-Service -Name 'Spooler'
Get-Service | Where-Object Status -eq 'Running'
Get-Process | Sort-Object CPU -Descending | Select-Object -First 10 Name, Id, CPU
\`\`\`

### ネットワーク
\`\`\`powershell
Get-NetIPConfiguration
Get-NetAdapter
Resolve-DnsName 'example.com'
Test-NetConnection 'example.com' -Port 443
Get-NetRoute -AddressFamily IPv4
\`\`\`

### ディスク・ファイル
\`\`\`powershell
Get-Volume
Get-ChildItem -LiteralPath $env:TEMP -File
Test-Path -LiteralPath 'C:\Logs'
Get-ChildItem -LiteralPath 'C:\Logs' -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 20 Name, Length, LastWriteTime
\`\`\`

### イベントログ
\`\`\`powershell
Get-WinEvent -ListLog 'System'
Get-WinEvent -FilterHashtable @{
    LogName = 'System'
    StartTime = (Get-Date).AddHours(-2)
} -MaxEvents 30 |
    Select-Object TimeCreated, Id, LevelDisplayName, ProviderName, Message
\`\`\`

### CSV
\`\`\`powershell
$users = Import-Csv -LiteralPath '.\users.csv'
$users | Select-Object Name, Department
$users | Export-Csv -LiteralPath '.\users-report.csv' -NoTypeInformation -Encoding utf8
\`\`\`

CSVには個人情報・機密情報を含めないか、社内承認済みの保管先とアクセス制御を使う。

## 5. 比較演算子・条件・ループ

| 演算子 | 意味 | 例 |
|---|---|---|
| -eq | 等しい | \`$x -eq 10\` |
| -ne | 等しくない | \`$x -ne 0\` |
| -gt / -ge | より大きい / 以上 | \`$free -lt 10\` |
| -lt / -le | より小さい / 以下 | \`$count -le 5\` |
| -like | ワイルドカード一致 | \`$name -like 'SRV*'\` |
| -match | 正規表現一致 | \`$text -match 'error'\` |
| -and / -or / -not | 論理演算 | \`$a -and $b\` |

\`\`\`powershell
if ($freeGB -lt 10) {
    '容量が少ない'
}
elseif ($freeGB -lt 20) {
    '容量に注意'
}
else {
    '容量は十分'
}
\`\`\`

\`\`\`powershell
$computers = @('PC-001', 'PC-002')
foreach ($computer in $computers) {
    "確認対象: $computer"
}
\`\`\`

## 6. 変数・配列・ハッシュテーブル

\`\`\`powershell
$computerName = $env:COMPUTERNAME
$servers = @('SRV-01', 'SRV-02')
$report = [pscustomobject]@{
    ComputerName = $computerName
    CheckedAt    = Get-Date
    Result       = '確認済み'
}
$report | Format-List
\`\`\`

- 変数は \`$\` で始まる。
- 配列は複数の値を順番に保持。
- ハッシュテーブルはキーと値を保持。
- \`[pscustomobject]\` は列名のあるレポートデータを作るときに便利。

## 7. 関数・スクリプトの作り方

\`\`\`powershell
function Get-ComputerSummary {
    [CmdletBinding()]
    param(
        [string]$ComputerName = $env:COMPUTERNAME
    )

    Get-CimInstance -ClassName Win32_OperatingSystem -ComputerName $ComputerName |
        Select-Object CSName, Caption, Version, LastBootUpTime
}

Get-ComputerSummary
\`\`\`

スクリプトファイル例：\`Get-ComputerSummary.ps1\`

\`\`\`powershell
[CmdletBinding()]
param(
    [string]$ComputerName = $env:COMPUTERNAME,
    [string]$OutputPath = '.\computer-summary.csv'
)

$ErrorActionPreference = 'Stop'

try {
    $result = Get-CimInstance -ClassName Win32_OperatingSystem -ComputerName $ComputerName |
        Select-Object CSName, Caption, Version, LastBootUpTime

    $result | Export-Csv -LiteralPath $OutputPath -NoTypeInformation -Encoding utf8
    Write-Host "出力しました: $OutputPath"
}
catch {
    Write-Error "取得に失敗しました: $($_.Exception.Message)"
    throw
}
\`\`\`

最初は読み取り専用のスクリプトから始める。実行前に内容を読み、対象端末・出力先・アクセス権を確認する。

## 8. 実務シーン別レシピ

### A. PCの基本情報を確認
\`\`\`powershell
[pscustomobject]@{
    ComputerName = $env:COMPUTERNAME
    UserName     = $env:USERNAME
    PowerShell   = $PSVersionTable.PSVersion.ToString()
    CheckedAt    = Get-Date
}
\`\`\`

### B. 停止中のサービスをCSVへ出す
\`\`\`powershell
Get-Service |
    Where-Object Status -eq 'Stopped' |
    Select-Object Name, DisplayName, Status |
    Export-Csv -LiteralPath '.\stopped-services.csv' -NoTypeInformation -Encoding utf8
\`\`\`
注意：停止中でも正常なサービスはある。状態だけで障害と断定しない。

### C. CPU使用率上位プロセスを表示
\`\`\`powershell
Get-Process |
    Sort-Object CPU -Descending |
    Select-Object -First 10 Name, Id, CPU
\`\`\`
CPU値はプロセス開始後の累積値で、瞬間的なCPU使用率そのものではない。

### D. DNSとHTTPS接続を切り分ける
\`\`\`powershell
Resolve-DnsName 'example.com'
Test-NetConnection 'example.com' -Port 443
\`\`\`
名前解決結果とTCPポート接続結果を別々に見る。社内DNSやプロキシの構成によって結果は異なる。

### E. 直近2時間のSystemログを確認
\`\`\`powershell
$start = (Get-Date).AddHours(-2)
Get-WinEvent -FilterHashtable @{ LogName='System'; StartTime=$start } -MaxEvents 50 |
    Select-Object TimeCreated, Id, LevelDisplayName, ProviderName, Message
\`\`\`
ログの時刻・イベントIDだけで原因を断定せず、前後のイベントと変更履歴を照合する。

### F. フォルダー容量を集計（対象を確認してから）
\`\`\`powershell
Get-ChildItem -LiteralPath 'C:\Logs' -File |
    Measure-Object -Property Length -Sum
\`\`\`
フォルダーを再帰的に調べる場合は \`-Recurse\` を追加するが、対象範囲・処理時間・アクセス権を先に確認する。

## 9. エラーを直す手順

1. エラー全文を読む。特に CategoryInfo / FullyQualifiedErrorId / 行番号を見る。
2. コマンド名のスペルと引用符・括弧を確認。
3. パラメーター名と型を \`Get-Help -Full\` で確認。
4. 対象の存在を \`Test-Path\` / \`Get-Service\` 等で確認。
5. 権限・接続・モジュール・PowerShellバージョンを確認。
6. 小さなコマンドに分割して再現。
7. 修正前後の結果を記録。

エラー調査に使う例：

\`\`\`powershell
$Error[0] | Format-List * -Force
$PSVersionTable
Get-Command Get-Service
Get-Module -ListAvailable
\`\`\`

## 10. 安全に作業する原則

| リスク | 必須確認 |
|---|---|
| 削除・上書き | 対象一覧、件数、バックアップ、承認、復旧方法 |
| サービス再起動 | 対象サービス、依存関係、利用者影響、作業時間、承認 |
| アカウント・権限変更 | 申請、承認者、最小権限、対象者、期限、監査 |
| リモート実行 | 許可された端末・接続方式・権限・ログ |
| 外部スクリプト | 配布元、内容、署名、ハッシュ、組織ポリシー |
| 機密データ出力 | データ最小化、保存先、アクセス制御、削除期限 |

- まずGet系・Test系で状態を調べる。
- \`-WhatIf\` は対応コマンドで変更内容のシミュレーションに使う。すべてのコマンドが対応しているわけではない。
- 実行ポリシーを安易に変更・回避しない。組織ポリシーと署名要件を守る。
- 管理者権限は必要な場合に限り、承認された範囲で使う。
- 本番環境での変更・削除・再起動は独断で行わない。

## 11. 障害対応ワークフロー（PowerShellを使う場合）

受付 → 影響範囲 → 対象端末/サーバー → 読み取り調査 → ログ保全 → 原因候補整理 → エスカレーション/承認 → 対策 → 復旧確認 → 報告。

### 調査メモ
- 発生時刻・タイムゾーン：
- 対象端末/サーバー：
- 実行したコマンド：
- コマンドの出力：
- エラー全文：
- 影響範囲：
- 確認できた事実：
- 未確認事項・原因候補：
- 次の対応・担当・期限：

## 12. 30日集中マスター計画（1日60〜90分）

| 日 | 学習テーマ | 手を動かす課題 |
|---|---|---|
| 1 | PowerShellとは・起動・バージョン | \`$PSVersionTable\` を読み解く |
| 2 | Get-Command / Get-Help | サービス関連コマンドを5つ探す |
| 3 | オブジェクト / Get-Member | Get-Serviceのプロパティを調べる |
| 4 | パイプライン | Get→Where→Selectを作る |
| 5 | Sort / Measure / Group | サービス状態を集計 |
| 6 | 変数・型 | PC名・日時を変数に入れる |
| 7 | 配列・ハッシュ | 端末一覧と調査結果を作る |
| 8 | if / switch | 閾値で注意メッセージを出す |
| 9 | foreach | 複数のサンプル端末名を処理 |
| 10 | 関数 | Get-ComputerSummaryを作る |
| 11 | param | 端末名を引数で受け取る |
| 12 | try / catch | 存在しないパスのエラーを処理 |
| 13 | CSV | サンプルCSVを読み書き |
| 14 | ファイル調査 | 一時フォルダーの一覧を出す |
| 15 | サービス | 状態を一覧・CSV化 |
| 16 | プロセス | CPU上位を表示し解釈 |
| 17 | イベントログ | 直近ログを抽出 |
| 18 | IP / DNS | IP設定と名前解決を確認 |
| 19 | ポート / 経路 | Test-NetConnectionを理解 |
| 20 | ストレージ | ボリューム容量を確認 |
| 21 | リモート管理の概念 | Remotingの前提と権限を学ぶ |
| 22 | 実行ポリシー・署名 | 現在のポリシーを読む |
| 23 | ログ・監査 | Transcriptの使い方を学ぶ |
| 24 | 安全設計 | WhatIf・Confirmの意味を説明 |
| 25 | スクリプト構成 | param / try / catch / Export-Csvをまとめる |
| 26 | PC調査演習 | 端末基本情報レポートを作る |
| 27 | ネットワーク演習 | DNS/443の切り分けメモを書く |
| 28 | 障害演習 | ログ調査→事実/仮説を分ける |
| 29 | 総合スクリプト | 読み取り専用の端末点検スクリプト |
| 30 | 実技試験 | 目的から自分でコマンドを作り、説明・報告 |

## 13. 合格基準

- Get-Helpを使って未知のコマンドを自分で調べられる。
- Verb-Noun、パラメーター、パイプラインを説明できる。
- Get / Where / Select / Sort / Export-Csvを組み合わせられる。
- 変数、配列、if、foreach、function、paramを使える。
- エラーから原因候補を絞り込める。
- 読み取り専用の点検スクリプトを作成し、結果を報告できる。
- 変更系コマンドの危険性、承認、WhatIf、ロールバックを説明できる。

## 14. 学習時のルール

この教材の例は学習用であり、実際の社内環境ではOS・PowerShellバージョン・モジュール・権限・社内規程によって使えるコマンドが異なる。実務ではまず \`$PSVersionTable\` と \`Get-Command\` を確認し、社内の承認済み手順を優先する。
