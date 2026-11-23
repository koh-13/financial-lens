# Financial Lens

Windowsデスクトップを主対象にした財務諸表分析Webアプリ。最初の画面に指標・推移グラフ・財務諸表を並べ、保存済み分析は左の履歴から開きます。白を基調とした半透明ガラスUI、遷移アニメーション、全画面スケルトンを備えます。

## 現在の状態

UI、Excel出力、Google OAuth・EDINET・Cloudflareの接続コードを実装済みです。**本番のEDINET APIキー、Google OAuthクライアント、Cloudflareアカウントは未設定です。実サービスへの接続検証はまだ完了していません。** サンプル企業・数値は架空であり、実際の決算データではありません。接続未設定で分析成功を装う動作はありません。

Sitesへの公開版は操作確認用です。Sites自体のアクセス制御はアプリ内のGoogle認証とは別です。Google認証だけで利用する本番環境には、下記のCloudflare直接デプロイを使います。

## 技術選定と理由

| 技術 | 選定理由 |
|---|---|
| React 19 | 表・グラフ・履歴・モーダルが共有する選択状態を一元管理できるため。 |
| TypeScript | 財務データの欠損値をnullとして型で区別し、画面でゼロと混同しないため。 |
| Vite | 開発時の即時反映と、本番JS/CSSの最適化を簡潔に扱うため。 |
| Cloudflare Workers | 秘密のEDINET APIキーをブラウザに出さず、取得APIと認証を同じオリジンで提供するため。 |
| Cloudflare D1 | GoogleユーザーIDを所有者とする履歴と、証券コード別の提出書類索引をSQLで管理するため。 |
| Cloudflare R2 | PDF原本をDBに格納せず保存し、所有者確認後に配信するため。 |
| Google OpenID Connect + jose | Googleだけのログインを実装し、署名・issuer・audience・nonceを検証するため。認可コード、PKCE、state、HttpOnly Cookieを使用。 |
| EDINET API v2 | 金融庁の一次資料を取得するため。PDFはtype=2、分析用の同じ提出書類のXBRL由来CSVはtype=5。 |
| fflate | Workersで構造化データのZIPを展開するため。展開後のサイズを制限。 |
| Recharts | Reactで複合グラフを描画し、レスポンシブ表示とツールチップを扱うため。 |
| ExcelJS | 本物の.xlsxを作成し、財務三表・指標・出典を5シートで保存するため。必要時だけ動的ロード。 |
| Lucide | 一貫した線画アイコンで操作を識別しやすくするため。 |
| CSS backdrop-filter / system fonts | Liquid Glassの透過・ぼかしを軽量に実現し、Windows標準フォントで初回のフォント取得待ちをなくすため。 |
| esbuild | UIの静的ファイルとAPIを単一Worker ESMとして配布できるため。 |
| Node標準テストランナー | パーサー、所有権、CSRF、未設定時の挙動を追加のテストフレームワークなしで検証するため。 |

## ローカル実行

Node.js 22以上を使用します。

```sh
npm ci
npm run dev
```

`http://127.0.0.1:5173/` を開きます。通常のdevはサンプル閲覧専用で、秘密情報を読み込みません。

```sh
npm run typecheck
npm test
npm run build
```

## Cloudflare本番設定

1. CloudflareアカウントでWranglerにログインします。
2. `npx wrangler d1 create financial-lens` でD1を作り、返却されたIDで `wrangler.jsonc` の `database_id` を置き換えます。
3. `npx wrangler r2 bucket create financial-lens-pdfs` でPDF用バケットを作ります。
4. `npx wrangler d1 migrations apply financial-lens --remote` でスキーマを作ります。
5. Google Cloud ConsoleでWebアプリ用OAuthクライアントを作成し、同意画面と必要なテストユーザーを設定します。リダイレクトURIに `https://<公開ホスト>/auth/callback` を登録します。
6. EDINETでAPI利用登録を行い、APIキーを発行します。
7. 次の値を `npx wrangler secret put KEY_NAME` で入力します。秘密値をGitに書かないでください。

| キー | 値 |
|---|---|
| `EDINET_API_KEY` | EDINETのSubscription-Key |
| `GOOGLE_CLIENT_ID` | Google OAuthクライアントID |
| `GOOGLE_CLIENT_SECRET` | Google OAuthクライアントシークレット |
| `SESSION_SECRET` | 暗号学的乱数で作った32バイト以上のランダム値 |
| `APP_ORIGIN` | 公開オリジン。末尾のスラッシュなし |

8. `npm run deploy` で公開します。
9. Googleログイン→証券コード入力→分析→原本PDF→Excel→再ログイン後の履歴を実データで確認します。

Workers Cronは毎日UTC 16:00（日本時間01:00）に直近2日の提出索引を更新します。初回の分析検索は7日ずつ最大370日さかのぼります。取得済み日付はD1にキャッシュするため、初回は時間がかかります。対象は有価証券報告書です。

## 数値処理と制約

- PDFをOCRで数値化せず、同じ書類IDの構造化データを使います。PDF原本は別に取得してR2へ保存します。
- 連結・当期／過去4期の既知の要素IDだけを抽出します。日本基準・IFRSでも未対応の要素はあります。銀行など特殊な業種、個別決算のみの書類、未知のタクソノミは未対応です。
- 元の円を百万円へ変換。外貨、非数値、セグメント値、個別値を混在させません。欠損値は「—」、Excelでは空欄にします。
- 営業利益率＝営業利益÷売上高。自己資本比率＝自己資本÷総資産。流動比率＝流動資産÷流動負債。ROE＝当期純利益÷期首期末平均自己資本。すべて100倍して%で表示します。
- 日本基準の自己資本を開示自己資本比率×総資産で概算する場合は注意を表示します。純資産を自己資本として扱いません。
- 分母が0以下、欠損値、前年が負の場合の増減率は計算しません。
- 同一要素・同一期間に異なる値が複数ある場合は自動選択しません。
- 訂正有価証券報告書を検出した決算期は自動分析を停止します。訂正内容の自動マージは未実装です。
- 原本PDF閲覧にはブラウザのPDF表示機能が必要です。別タブでも開けます。
- 実際のEDINETデータ・Google認証・D1/R2を通した結合テストは、上記の本番設定後に必要です。

## 一次資料

- [EDINET公式API仕様書](https://disclosure2dl.edinet-fsa.go.jp/guide/static/disclosure/download/ESE140206.pdf)
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)

`docs/verification.md` に実施した検証と未実施の検証を記載しています。
