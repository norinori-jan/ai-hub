# ネットワーク実務コマンドマスター｜作り方・切り分けガイド

目的：症状から必要な調査コマンドを選び、結果を読み、ネットワーク障害を段階的に切り分けて報告できるようになる。

## 1. コマンドを組み立てる考え方

調査を次の層に分ける。

1. 端末のIP・NIC設定
2. DNS名前解決
3. デフォルトゲートウェイ・経路
4. 宛先への疎通
5. TCPポート接続
6. HTTP/TLSなどアプリケーション応答

最初から設定変更せず、読み取り・確認コマンドで事実を集める。

## 2. OS別コマンド早見表

| 目的 | Windows / PowerShell | Linux / macOS |
|---|---|---|
| IP設定 | \`ipconfig /all\` / \`Get-NetIPConfiguration\` | \`ip addr\` / \`ifconfig\` |
| NIC状態 | \`Get-NetAdapter\` | \`ip link\` |
| DNS | \`Resolve-DnsName host\` / \`nslookup host\` | \`dig host\` / \`nslookup host\` |
| 疎通 | \`ping -n 4 host\` | \`ping -c 4 host\` |
| 経路 | \`tracert host\` / \`pathping host\` | \`traceroute host\` / \`tracepath host\` |
| TCPポート | \`Test-NetConnection host -Port 443\` | \`nc -vz host 443\` |
| 接続一覧 | \`netstat -ano\` / \`Get-NetTCPConnection\` | \`ss -tunap\` |
| HTTP | \`curl.exe -I https://host\` | \`curl -I https://host\` |
| ARP/近隣 | \`arp -a\` | \`ip neigh\` |
| ルート | \`route print\` | \`ip route\` |

コマンドのオプションはOS・バージョンによって異なる。macOSではLinuxと同じiproute2コマンドが標準搭載とは限らない。

## 3. 代表的なコマンドの意味

### IP設定
\`\`\`powershell
ipconfig /all
Get-NetIPConfiguration
Get-NetAdapter
\`\`\`
IPアドレス、サブネット、ゲートウェイ、DNS、NIC状態を確認する。

### DNS
\`\`\`powershell
Resolve-DnsName example.com
nslookup example.com
\`\`\`
名前解決に失敗したら、問い合わせ先DNS・レコード・社内検索サフィックス・VPN接続状態を確認する。

### 疎通と経路
\`\`\`powershell
ping -n 4 192.0.2.10
tracert example.com
route print
\`\`\`
pingが失敗してもICMP遮断の可能性があるため、即座にサーバーダウンと断定しない。経路途中の応答なしも同様。

### TCPポート
\`\`\`powershell
Test-NetConnection example.com -Port 443
Get-NetTCPConnection
\`\`\`
TCP接続の成否を確認する。UDPサービスの確認とは別である。ポートが閉じている場合、サービス停止・待受アドレス・Firewall・経路・NATなどを切り分ける。

### HTTP/TLS
\`\`\`powershell
curl.exe -I https://example.com
\`\`\`
HTTPステータス、応答ヘッダー、TLSエラーを確認する。認証トークン・Cookieを不用意に表示・保存・共有しない。

## 4. 障害別の組み立て例

### 症状A：Webサイトが開かない

\`\`\`powershell
ipconfig /all
Resolve-DnsName example.com
Test-NetConnection example.com -Port 443
curl.exe -I https://example.com
\`\`\`

判断：
- IP設定異常：NIC/DHCP/VPNを確認。
- DNS失敗：DNSサーバー・レコード・サフィックスを確認。
- DNS成功、443失敗：経路・Firewall・待受・プロキシを確認。
- 443成功、HTTP失敗：TLS・証明書・Webサーバー・アプリ応答を確認。

### 症状B：特定サーバーだけ接続できない

\`\`\`powershell
Resolve-DnsName server.example.local
Test-NetConnection server.example.local -Port 443
tracert server.example.local
\`\`\`

別端末・別ネットワークからの結果と比較する。許可された対象にだけ調査する。

### 症状C：社内だけ名前解決できない

\`\`\`powershell
ipconfig /all
Resolve-DnsName app.example.local
nslookup app.example.local
\`\`\`

VPNの有無、DNSサーバー、社内DNSゾーン、検索サフィックスを確認する。DNSキャッシュ削除や設定変更は、承認済み手順を確認してから。

## 5. 調査コマンドを自分で作るテンプレート

目的：「ホストXのTCPポートYへ接続できるか確認」

- 対象ホスト：変数 \`$TargetHost\`
- ポート：変数 \`$Port\`
- 実行：Test-NetConnection
- 出力：対象・ポート・成功/失敗・時刻

\`\`\`powershell
$TargetHost = 'server.example.local'
$Port = 443
$result = Test-NetConnection -ComputerName $TargetHost -Port $Port

[pscustomobject]@{
    TargetHost = $TargetHost
    Port       = $Port
    TcpSuccess = $result.TcpTestSucceeded
    RemoteIP   = $result.RemoteAddress
    CheckedAt  = Get-Date
}
\`\`\`

これは接続確認のみを行う例。ネットワーク設定は変更しない。

## 6. 結果の読み方と注意点

- ping応答なし＝必ずしも停止ではない。
- DNS解決成功＝アプリケーションが正常とは限らない。
- TCP 443成功＝Webアプリが正常とは限らない。
- tracertの途中ホップ無応答＝必ずしも経路断ではない。
- netstat/ssのLISTEN＝外部端末から到達可能とは限らない。
- ポートスキャンや広範囲調査は、明確な承認・対象範囲なしに実行しない。

## 7. 障害対応ワークフロー

受付 → 影響範囲（1台/部署/拠点/全社） → 有線/無線/VPN → IP → DNS → GW/経路 → TCPポート → アプリ応答 → 証跡保存 → エスカレーション → 復旧確認 → 報告。

## 8. 報告テンプレート

- 発生時刻・タイムゾーン：
- 対象端末・利用者・拠点：
- 宛先ホスト・ポート・プロトコル：
- 影響範囲：
- 実行コマンドと実行端末：
- 結果（成功/失敗、エラー全文）：
- 確認できた事実：
- 原因候補（確定と推測を分ける）：
- 実施した対応・承認：
- 復旧確認：
- 次の担当・期限：

## 9. 30日学習の目安

| 日 | テーマ | 演習 |
|---|---|---|
| 1-3 | IP・CIDR・NIC | 自端末の設定を説明 |
| 4-6 | DNS | 複数ドメインを引いて結果を読む |
| 7-9 | ping・経路 | 疎通と経路の差を理解 |
| 10-12 | TCP・ポート | 443/22等の接続確認 |
| 13-15 | HTTP・TLS | ステータス・証明書の読み方 |
| 16-18 | DHCP・VPN | 設定と経路を比較 |
| 19-21 | Firewall・接続一覧 | ルールと待受状態を理解 |
| 22-25 | 複合切り分け | Web接続不能の模擬演習 |
| 26-30 | 総合実技 | 調査コマンド作成・報告書作成 |

## 10. 到達目標

- OSに応じた基本コマンドを選べる。
- DNS・経路・TCP・HTTPを段階的に切り分けられる。
- 目的に合わせて複数コマンドを組み立てられる。
- 結果から断定できること・できないことを区別できる。
- 調査内容を再現可能な報告書にまとめられる。
