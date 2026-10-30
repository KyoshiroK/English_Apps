# 設計・検証メモ

作成日：2026-10-30（日本時間）。iPhone Safari向けのオンラインWebアプリ。GitHub Pagesにフォルダの中身を置くだけでUIを配信できます。AI機能には利用者によるAPI接続設定が必要です。

## 要件との対応

| 要件 | 実装 |
|---|---|
| UI1：音声→文字起こし→AI回答 | MP4/AAC優先のMediaRecorder→音声文字起こしAPI→編集可能な問題欄→Responses API。SpeechRecognitionも選択可能 |
| UI2：左に写真、右にUI1 | iPhone縦横どちらも左右2列が初期表示。上下表示も選択可能 |
| 写真から問題文を文字起こし | Vision画像入力。答え・全文文字起こし・理由を区分して表示 |
| 自動実行 | 音声の無音後／停止ボタンで文字起こし＋回答。写真選択時に自動解析 |
| 高速化 | 画像縮小、単一の画像解析リクエスト、短文出力、SSE表示、左右の並行実行、重複送信抑制 |
| UI切替 | stickyなモードボタン。PCではAlt＋1／2も使用可能 |
| コピーして配置 | ビルド不要、外部CDN／ランタイム依存なし、プロジェクト内相対パス |
| 秘密の扱い | 個人用キーはメモリのみ。サーバー保管用の任意Worker同梱 |
| iPhone | Safari用録音コンテナ、カメラ入力、playsinline、safe-area、16px入力、44px以上のボタン、ホーム画面用設定 |

## 構成

フロントエンドはブラウザだけで実行されます。個人利用では利用者のキーでOpenAIへ直接HTTPS接続。任意構成ではCloudflare Workerへ接続し、Workerが保持するOpenAIキーで固定APIへ中継します。

フロントエンドの依存パッケージはありません。音声認識サービスやOpenAIへの外部通信は必要です。PWAのmanifestとapple-touch-iconは用意しますが、オフラインAI・オフラインキャッシュの機能は提供しません。

| API | 用途 | 通信 |
|---|---|---|
| `POST https://api.openai.com/v1/responses` | テキスト回答、画像文字起こし・回答 | JSON / SSE |
| `POST https://api.openai.com/v1/audio/transcriptions` | 完成した録音の文字起こし | multipart / JSON |
| `POST WorkerのURL /` | 任意の回答中継 | JSON / SSE |
| `POST WorkerのURL /transcribe` | 任意の録音文字起こし中継 | multipart / JSON |

モデル初期値は回答 `gpt-4.1-mini`、音声ファイル文字起こし `gpt-transcribe`。いずれもアカウントの提供状況を実利用時に確認してください。特定モデルが利用できない場合は設定画面（中継時は環境変数）から変更します。モデルの最速順位を保証する選定ではありません。

## 音声の方式

iPhoneは録音方式を初期選択します。MediaRecorderの対応形式を検出し、audio/mp4、audio/webm;codecs=opus、audio/webmの順に選択。音声を最大60秒に制限し、ファイル全体を文字起こししてから回答します。ストリーミング音声送信やRealtime APIセッションは使いません。

簡易無音検出はWeb AudioのRMSが0.018を超えた累積時間250ms以上で音声ありとし、その後1.2／1.8／3／5秒の無音で停止します。固定閾値のため環境に依存します。AudioContextが停止中または利用不可の場合、無音自動送信を行わず、手動停止と60秒制限で動作します。

SpeechRecognition方式では、全確定結果を毎回再構築して重複を防止し、途中結果は問題欄と分離します。認識結果が更新されるたびに無音待機タイマーをリセットし、未確定結果が残っていれば自動回答しません。認識サービスが終了しても無限に再起動しません。

音声認識中に問題欄を修正したときはマイクを停止します。録音・認識セッション番号で古いイベントを抑止します。再読み込みや画面ロックをまたぐ常時録音は提供しません。

## 写真

JPEG / PNG / WebP / GIFをブラウザでデコードし、長辺1280／1600／2048pxに縮小、JPEG品質0.86に変換します。小さい画像は拡大しません。createImageBitmapが使えない場合はHTMLImageElementのdecodeにフォールバックします。HEIC自体のデコードは保証しません。

問題の小さい文字を読むため、Vision detailはhigh。低解像度detailを固定する方式は文字の判読に不利なので使用しません。代わりに送信画像そのものを縮小します。特定領域のクロップUIは用意せず、撮影時に問題が大きく写るよう案内します。

写真の自動モードは1回のAPI呼出しで `[ANSWER]` → `[TRANSCRIPT]` → `[REASON]` を生成します。文字起こしの完了前に回答を見せるための順序です。マーカーの部分受信も考慮して表示します。マーカーや文字起こしが欠ける場合は未完了として再試行を案内します。モデルは出力形式から逸脱する場合があり、その場合は「文字起こしのみ」またはテキスト修正で回復します。

## 並行処理と古い結果の防止

写真・音声の回答には別々のAbortControllerとリクエスト番号を持ちます。同じ側で新しい問題を処理すると前の通信を中止し、古い受信イベントは番号で破棄します。入力欄の編集でも前の回答を中止します。写真を差し替えた場合はデコード完了順序を番号で制御します。

写真文脈を音声回答に含める場合のみ、写真の読み取り中は右の回答開始を保留する案内を出します。通常は左右が互いを待ちません。モード変更時も入力を維持し、写真の文脈が変わる場合に限って古い音声処理を中止します。

SSEはUTF-8の分割、CRLF、複数イベントを処理します。response.completedがない切断は完了扱いしません。失敗・不完全応答を明示し、60秒でクライアント側を中断します。中断は既に始まった生成の料金を保証するものではありません。

## セキュリティ境界

- DOM表示はtextContent／valueを使用し、AI出力をHTMLとして挿入しません。
- CSPでscript/styleを同一サイトに限定。connect-srcはOpenAIとworkers.devに限定します。
- キーはメモリのみ。localStorageには接続設定などの非秘密値だけを保存します。
- WorkerはOriginとBearerの共通パスワードを検証します。CORSだけで認証を代用しません。
- Workerはモデル、出力上限、転送先を固定し、任意URLへのプロキシとして使えない設計です。
- 回答入力6MiB、音声ファイル12MiB、音声multipart本文13MiBの制限を設けます。
- ユーザー別ログインや永続レート制限はありません。共通パスワード方式は信頼できる少人数向けです。

## 検証範囲

`npm test` はNode.js標準テストで、20件（サブテストを含む）が通過しました。

| 確認 | 結果・方法 |
|---|---|
| 分割UTF-8 / CRLFのSSE | テスト通過 |
| 切断・失敗・出力上限の検出 | テスト通過 |
| 写真の出力解析／1回の画像送信 | テスト通過 |
| RMS無音・無音未検出・最大時間 | テスト通過 |
| WorkerのOrigin／認証／固定転送先 | モックfetchで通過 |
| Workerのサーバーモデル固定／音声multipart | モックfetchで通過 |
| APIキーをlocalStorageに保存しない | モックDOMで通過 |
| 写真と音声の画面操作／切替 | モックDOMで通過 |
| iPhoneの録音MP4選択→文字起こし→回答 | モックMediaRecorder／APIで通過 |
| 編集時の古い回答の中止 | モックDOM／fetchで通過 |
| JavaScript構文 | Node.js構文検査通過 |
| 実ブラウザの描画・Safariの表示 | 未実施 |
| iPhone実機のマイク／カメラ／無音判定 | 未実施 |
| 実際のOpenAI API・認識精度・遅延 | キー未設定につき未実施 |
| GitHub Pages／Workerへの公開 | 利用者のアカウントで行う手順を同梱。未公開 |

モックは端末や外部サービスの実動作を保証しません。実機で確認する手順はREADMEに記載しています。

## 参照した公式資料

- [GitHub Pagesの静的ホスティング](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [OpenAI Responsesのストリーミング](https://developers.openai.com/api/docs/guides/streaming-responses)
- [OpenAI画像入力](https://developers.openai.com/api/docs/guides/images-vision)
- [OpenAI音声ファイル文字起こし](https://developers.openai.com/api/docs/guides/speech-to-text)
- [WebKit MediaRecorder / MP4対応](https://webkit.org/blog/11353/mediarecorder-api/)
- [SpeechRecognition途中結果](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/interimResults)
- [Cloudflare WorkerのCORS](https://developers.cloudflare.com/workers/examples/cors-header-proxy/)
- [Cloudflare WorkerのSecrets](https://developers.cloudflare.com/workers/configuration/secrets/)
