-- AIRNIX 個別メニュー（LINEミニアプリ）D1スキーマ v2（2026-10-05・試作 第14版の仕組み）
-- 店内：トレッドミルの段階①〜④（報告で自動調整）／来店外：NTCのプログラム指定（自己申告）／食事：あすけん（記録日数の自己申告）
-- 進捗：体重・ウエスト（スタッフが測定）→ 直近30日の効果レポート → 結果が出た方へプラン別の案内

CREATE TABLE IF NOT EXISTS members (
  line_user_id TEXT PRIMARY KEY,                 -- LINEのユーザーID（ログインで自動取得）
  line_name    TEXT NOT NULL DEFAULT '',         -- LINEの表示名（参考）
  name         TEXT NOT NULL DEFAULT '',         -- スタッフが登録するお名前
  status       TEXT NOT NULL DEFAULT 'pending',  -- pending（登録待ち）/ active / check（体調確認中）
  plan         TEXT NOT NULL DEFAULT '',         -- ライト / メイン / プレミアム（hacomonoと同じものをスタッフが選ぶ）
  weekly       INTEGER NOT NULL DEFAULT 2,       -- 週の来店目標
  lad_json     TEXT,                             -- トレッドミルの段階 {machine,wl,wp,fp,fp0,hr,hr0,count}
  ntc_json     TEXT,                             -- NTCの状態 {track,idx,week,done[],hard,zero}
  start_weight REAL, start_waist REAL,           -- 開始時の測定
  target_weight REAL, target_waist REAL,         -- 目標
  target_date  TEXT,                             -- 目標の期日 YYYY-MM-DD
  upsell_at    TEXT,                             -- 最後に上位プラン等を案内した日（30日は再表示しない）
  last_date    TEXT,                             -- 最終来店日 YYYY-MM-DD
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- 報告（来店ごと）。kind=walk：トレッドミル／kind=ntc：前回からのNTC
CREATE TABLE IF NOT EXISTS reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  line_user_id TEXT NOT NULL,
  kind         TEXT NOT NULL,                    -- walk / ntc
  date         TEXT NOT NULL,                    -- YYYY-MM-DD（日本時間）
  feel         TEXT,                             -- easy / ok / hard
  pain         INTEGER NOT NULL DEFAULT 0,       -- 痛み・体調の変化 0/1
  machine      TEXT,                             -- walk：使ったマシン A〜G
  km           REAL,                             -- walk：トレッドミルの距離（任意）
  ntc_count    INTEGER,                          -- ntc：今週できた回数
  note         TEXT NOT NULL DEFAULT '',         -- 変更内容（自動）
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_user ON reports(line_user_id, date);

-- 体重・ウエストの測定（スタッフが来店直後・運動前に測る）
CREATE TABLE IF NOT EXISTS measurements (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  line_user_id TEXT NOT NULL,
  date         TEXT NOT NULL,
  weight       REAL,
  waist        REAL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_meas_user ON measurements(line_user_id, date);

-- あすけんで食事を記録した日数（週ごと・本人の自己申告）
CREATE TABLE IF NOT EXISTS asken (
  line_user_id TEXT NOT NULL,
  week         TEXT NOT NULL,                    -- その週の月曜日 YYYY-MM-DD
  days         INTEGER NOT NULL,                 -- 0〜7
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (line_user_id, week)
);

-- 上位プラン・スタジオの案内の記録
CREATE TABLE IF NOT EXISTS upsells (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  line_user_id TEXT NOT NULL,
  date         TEXT NOT NULL,
  from_plan    TEXT NOT NULL,
  result       TEXT NOT NULL,                    -- yes（変更する）/ no（今は見送り）
  created_at   TEXT NOT NULL
);
