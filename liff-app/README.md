# AIRNIX 個別メニュー（LINEミニアプリ）

用賀店モニターのシステム化。お客様がLINEの中で報告 → AI（Claude）が次回メニューを作成 → 記録 → スタッフの声掛けリスト。

## 中身（2026-10-05・試作 第14版と同じ動き）
- **店内**：トレッドミルの段階①〜④。来店ごとの報告（楽／ちょうど／きつい・痛み）で自動で上げ下げ。14日あいたら1つ軽く、28日あいたら①から
- **来店外**：NTC（ナイキ トレーニング クラブ）のプログラムを目的別の順番で指定（「NTCで開く」ボタン）。来店時に「今週何回できたか」を自己申告 → 実施率70%以上で次のプログラムへ
- **食事**：あすけんで記録。AIRNIXは「今週何日記録したか」だけを自己申告で預かる
- **進捗**：体重・ウエストはスタッフが測定 → 直近30日の効果レポート（お客様・スタッフ両方で表示）
- **スタッフ**：注意（体調・来店なし・測定なし・NTC報告なし）と、結果が出た方へのプラン別の案内（ライト・メイン→プレミアム／プレミアム→スタジオ）。登録・測定・体調確認・NTCの目的の変更
- **AIは使わない**（決まったルールで動く）。費用はCloudflareの無料枠の見込み
- 用賀店のモニター（3〜5名）から始める（2026-10-05 ジェイさん決定）

## 構成
- 画面：`public/`（LIFF SDK）
- サーバー：Cloudflare Pages Functions（`functions/api/`）＋共通処理 `src/lib.ts`
- 保存先：Cloudflare D1（`schema.sql`）
- 決まり：`src/logic.ts`（トレッドミル・NTC・案内）、集計：`src/summary.ts`

## 公開までの手順
1. **Node.js を入れる**（このMacには未インストール）
2. **Cloudflare アカウント**を作成（無料枠で足りる見込み）
3. `npm install` → `npx wrangler login`
4. D1を作る：`npx wrangler d1 create airnix-menu` → 表示された `database_id` を `wrangler.toml` に貼る → `npm run db:init`
5. **LINE Developers**：用賀の公式アカウント（@430tauan）と同じプロバイダーで「LINEミニアプリ」チャネルを作成
   - エンドポイントURL：Cloudflare Pagesの公開URL（例 `https://airnix-menu.pages.dev/`）
   - スコープ：`openid`, `profile`
   - 控えるもの：**チャネルID** → `wrangler.toml` の `LINE_CHANNEL_ID`／**LIFF ID** → `public/common.js` の `LIFF_ID`
7. 公開：`npm run deploy`
8. スタッフのLINEユーザーIDを `STAFF_USER_IDS` に入れて再公開（スタッフが一度ミニアプリを開くと、D1の `members` に userId が残るので、そこから拾える）
9. 公式LINEのリッチメニューに「個別メニュー」ボタン（ミニアプリのURL）を追加。スタッフは同じURLの `/staff.html`

## 公開前に決めること
- **プライバシーポリシー**（ミニアプリ公開に必要。体調など健康に関わる情報を扱う旨を明記）
- LINEの審査を通した正式公開にするか、審査なしの形で使うか（最新の規約で確認）
- 対象：まず用賀のモニター3〜5名（10/5決定）
- プライバシーポリシー：`public/privacy.html` に案あり。運営会社名・連絡先・制定日を確定する

## 未実装（次の段階）
- ヘルスケア（NTC・あすけん）からの自動取得（iPhoneアプリ化が必要）
- hacomonoの来店・プランとの自動連携（今はスタッフが登録時にプランを選ぶ）
- 公式LINEへの自動通知（Messaging APIのプッシュ）

## 動作確認について
2026-10-05：仮のデータで画面の表示と送信内容を確認済み。このMacにNode.jsがないため、サーバー側の型チェック・ローカル実行は未実施。公開前に `npm run check` と `npm run dev` で確認すること。
