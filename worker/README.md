# 任意：Cloudflare WorkerでAPIキーを非公開にする

個人利用はアプリの「個人用：OpenAIへ直接接続」だけで使えます。共通のAPIキーをサーバー側に保持する場合にこの手順を使用します。Workerの公開にはCloudflareアカウントが別途必要です。以下は利用者の環境で実行する操作です。

## ダッシュボードで設定（Node.js不要）

1. Cloudflareにログインし、「Workers & Pages」からWorkerを新規作成します。メニュー名はサービスの更新で変わる場合があります。Hello World等の最小Workerを作成してください。
2. Workerのコード編集画面で、同梱の `worker.js` 全文を貼り付け、保存・デプロイします。
3. Workerの「Settings → Variables and Secrets」で、次を設定します。値を保存後、必要に応じて再デプロイしてください。

| 名前 | 種類 | 値 |
|---|---|---|
| `OPENAI_API_KEY` | Secret | 自分のOpenAI APIキー |
| `APP_TOKEN` | Secret | 自分で生成した十分長いランダムな接続パスワード（目安32文字以上） |
| `ALLOWED_ORIGIN` | Text | `https://自分のGitHubユーザー名.github.io` |
| `MODEL` | Text | `gpt-4.1-mini` |
| `TRANSCRIBE_MODEL` | Text | `gpt-transcribe` |

4. Workerの `https://名前.サブドメイン.workers.dev` URLをコピーします。末尾のパスやクエリは付けません。
5. GitHub Pages側アプリの「接続・設定」で「中継サーバー経由」を選び、URLと `APP_TOKEN` の値を入力します。
6. 「設定を適用」→サンプル問題を回答して確認します。ブラウザでWorker URLを直接開いたときは403等になるのが正常です。アプリからのみ呼び出してください。

独自のPagesドメインを使う場合はALLOWED_ORIGINをそのオリジンに変更します。Worker自体の独自ドメインはこのアプリの初期CSPで許可していないため、workers.dev URLを使ってください。

## CLIで設定（任意）

Node.jsとCloudflareへのログインが必要です。`wrangler.toml` の `ALLOWED_ORIGIN` を変更してから、`worker` フォルダで実行します。

```bash
npx wrangler login
npx wrangler deploy
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put APP_TOKEN
```

対話欄に秘密の値を入力します。秘密をコードやwrangler.toml、GitHubリポジトリに書き込まないでください。

## 中継の範囲と運用

- 回答は `/`、録音文字起こしは `/transcribe`。OpenAI Responses APIと音声ファイル文字起こしAPIへの固定中継。クライアント指定の任意URL、任意ツール、任意モデルは転送しません。
- 回答モデルはWorkerのMODEL、音声モデルはTRANSCRIBE_MODELに固定、出力は最大2000トークン。アプリのモデル欄は中継時には使いません。
- Origin許可に加え、Bearerパスワードを検証します。Originだけは認証になりません。
- ストリームをバッファせず返却します。写真はアプリが生成するJPEGのdata URLのみ許可、回答入力本文6MiB以下。音声は12MiB以下、multipart本文13MiB以下。
- パスワードは利用者が知る共通の秘密です。第三者への配布や公開リポジトリへの記載は避けてください。漏れたらAPP_TOKENを更新します。
- 本中継は個人／信頼できる少人数向けです。ユーザー単位のログイン、課金管理、永続レート制限は実装していません。不特定多数への公開には別途認証とレート制限が必要です。OpenAIとCloudflare側の利用状況も確認してください。
- フロント側の「中止」は受信を中断します。中継・上流側に中断が伝わるかは通信環境次第で、既に開始した生成の料金が必ずゼロになるものではありません。
