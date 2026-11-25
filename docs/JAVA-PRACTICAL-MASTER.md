# Java実務マスター｜コードを自分で作る学習ガイド

目的：Javaの文法を暗記するだけでなく、要求を小さな処理へ分解し、読みやすくテスト可能なコードを作り、エラーを調査して説明できるようになる。

## 1. Javaの実行環境

- JDK：開発に必要なコンパイラーやツールを含む。
- JVM：Javaバイトコードを実行する仮想マシン。
- JREという表現は実行環境を指す概念として使われるが、配布形態はJDKやランタイム構成によって異なる。

確認コマンド：

\`\`\`bash
java -version
javac -version
\`\`\`

## 2. ソースをコンパイルして実行

Hello.java：

\`\`\`java
public class Hello {
    public static void main(String[] args) {
        System.out.println("Hello, Java!");
    }
}
\`\`\`

\`\`\`bash
javac Hello.java
java Hello
\`\`\`

public class名とファイル名を一致させる。コンパイル時のエラーと実行時の例外を区別する。

## 3. コードを作る基本手順

1. 要求を一文で書く（入力・処理・出力）。
2. 必要なデータ型と変数を決める。
3. 処理をメソッドに分割する。
4. 正常系・異常系・境界値を考える。
5. 小さな単位でコンパイル・実行する。
6. ログや例外を確認し、修正する。
7. テストとレビューを通してから配布する。

## 4. 基本文法

### 変数と型

\`\`\`java
String hostname = "app01.example.local";
int port = 443;
boolean enabled = true;
long timeoutMillis = 5000L;
\`\`\`

### 条件分岐

\`\`\`java
if (port == 443) {
    System.out.println("HTTPS");
} else if (port == 80) {
    System.out.println("HTTP");
} else {
    System.out.println("Other");
}
\`\`\`

### 配列・ループ

\`\`\`java
String[] hosts = {"app01", "db01"};
for (String host : hosts) {
    System.out.println(host);
}
\`\`\`

### メソッド

\`\`\`java
static boolean isValidPort(int port) {
    return port >= 1 && port <= 65535;
}
\`\`\`

### クラスとカプセル化

\`\`\`java
public class ServerInfo {
    private final String hostname;
    private final int port;

    public ServerInfo(String hostname, int port) {
        this.hostname = hostname;
        this.port = port;
    }

    public String getHostname() { return hostname; }
    public int getPort() { return port; }
}
\`\`\`

## 5. コレクション

\`\`\`java
List<String> hosts = List.of("app01", "db01");
Map<String, Integer> ports = Map.of("https", 443, "http", 80);
Set<String> uniqueHosts = new HashSet<>(hosts);
\`\`\`

- List：順序を保った複数要素。
- Set：重複を避ける集合。
- Map：キーと値の対応。

## 6. 例外処理

\`\`\`java
try {
    int value = Integer.parseInt("123");
    System.out.println(value);
} catch (NumberFormatException ex) {
    System.err.println("数値に変換できません: " + ex.getMessage());
}
\`\`\`

例外を空のcatchで握りつぶさない。利用者向けメッセージと調査用ログを分け、必要な情報を残す。パスワード・トークン・個人情報をログへ出さない。

## 7. ファイル操作

\`\`\`java
Path path = Path.of("application.log");
if (Files.exists(path)) {
    System.out.println(Files.size(path));
}
\`\`\`

ファイルの書き換えや削除を行う場合は、パス・権限・バックアップ・承認を確認する。ユーザー入力をそのままパスへ連結しない。

## 8. HTTP API呼び出しの基本（Java 11+）

\`\`\`java
HttpClient client = HttpClient.newBuilder()
    .connectTimeout(Duration.ofSeconds(5))
    .build();

HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create("https://example.com/health"))
    .timeout(Duration.ofSeconds(10))
    .GET()
    .build();

HttpResponse<String> response =
    client.send(request, HttpResponse.BodyHandlers.ofString());

System.out.println(response.statusCode());
\`\`\`

実務ではTLS証明書検証を無効化しない。認証情報はソースへ直書きせず、秘密情報管理機構を使う。タイムアウト・リトライ・HTTPステータス・応答サイズを設計する。

## 9. TCP Socketの基本

\`\`\`java
try (Socket socket = new Socket()) {
    socket.connect(new InetSocketAddress("localhost", 8080), 3000);
    System.out.println("connected=" + socket.isConnected());
}
\`\`\`

接続タイムアウト、読み取りタイムアウト、リソース解放、文字コード、プロトコル仕様を考える。許可されたテスト先だけに接続する。

## 10. ビルド・テストコマンド

Maven：

\`\`\`bash
mvn -version
mvn test
mvn package
\`\`\`

Gradle Wrapper：

\`\`\`bash
./gradlew tasks
./gradlew test
./gradlew build
\`\`\`

Windowsでは \`gradlew.bat\` を使う。プロジェクトのREADMEとWrapper設定を優先する。

## 11. テストの考え方

- 正常系：期待どおりの入力。
- 異常系：不正な値、接続失敗、ファイル不在。
- 境界値：0、最大値、空文字、null。
- 回帰テスト：修正で既存機能が壊れていないか。

## 12. Javaアプリ障害の調査

1. 発生時刻・対象バージョン・環境を記録。
2. 例外クラス・メッセージ・スタックトレースを確認。
3. 直近のデプロイ・設定変更・依存先変更を確認。
4. DB・DNS・ポート・認証・外部APIなど依存先を切り分ける。
5. 必要に応じて承認された方法でJVM情報を採取。

\`\`\`bash
jcmd -l
jcmd <PID> VM.version
jcmd <PID> Thread.print
\`\`\`

スレッドダンプ等には内部情報が含まれることがあるため、保管・共有先を制限する。ヒープダンプは大容量かつ機密データを含み得るので、承認なしに採取・転送しない。

## 13. 30日学習の目安

| 日 | テーマ | 課題 |
|---|---|---|
| 1-3 | JDK・コンパイル・実行 | Helloを自分で作る |
| 4-6 | 型・変数・条件・ループ | 入力値チェック |
| 7-9 | メソッド・クラス | ServerInfoを作る |
| 10-12 | List・Map・Set | サーバー一覧を管理 |
| 13-15 | 例外・ファイル・ログ | 安全なログ読込 |
| 16-18 | Maven/Gradle・JUnit | テストを実行 |
| 19-21 | HTTP・Socket | ヘルスチェック |
| 22-25 | デバッグ・障害調査 | 例外原因を説明 |
| 26-30 | 総合演習 | 小さな監視ツールを作成 |

## 14. 到達目標

- 要求を入力・処理・出力に分けられる。
- クラス・メソッド・コレクションを使える。
- 例外を適切に処理できる。
- ビルドとテストを実行できる。
- HTTP/TCPの基本的なコードを書ける。
- ログ・スタックトレースから原因候補を説明できる。
