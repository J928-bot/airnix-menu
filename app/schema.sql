-- AIRNIX 個別メニュー（Web版）D1スキーマ v3（2026-10-18）
-- AirNixアプリからリンクで開く。お客様はスタッフが発行する「マイコード」でログインする（LINEログインは使わない）。
-- 店内：トレッドミルの段階①〜④（報告で自動調整）／来店外：NTCのプログラム指定（自己申告）／食事：あすけん（記録日数の自己申告）
-- 進捗：体重・ウエスト（スタッフが測定）→ 直近30日の効果レポート → 結果が出た方へプラン別の案内

CREATE TABLE IF NOT EXISTS members (
  id           TEXT PRIMARY KEY,                 -- ランダムな内部ID
  name         TEXT NOT NULL,                    -- スタッフが登録するお名前
  status       TEXT NOT NULL DEFAULT 'active',   -- active / check（体調確認中）/ archived（利用終了）
  plan         TEXT NOT NULL DEFAULT '',         -- ライト / メイン / プレミアム（hacomonoと同じものをスタッフが選ぶ）
  weekly       INTEGER NOT NULL DEFAULT 2,       -- 週の来店目標
  lad_json     TEXT NOT NULL,                    -- トレッドミルの段階 {machine,wl,wp,fp,fp0,hr,hr0,count}
  ntc_json     TEXT NOT NULL,                    -- NTCの状態 {track,idx,week,done[],hard,zero}
  start_weight REAL, start_waist REAL,           -- 開始時の測定
  target_weight REAL, target_waist REAL,         -- 目標
  target_date  TEXT,                             -- 目標の期日 YYYY-MM-DD
  upsell_at    TEXT,                             -- 最後に上位プラン等を案内した日（30日は再表示しない）
  last_date    TEXT,                             -- 最終来店日 YYYY-MM-DD
  code_hash    TEXT NOT NULL UNIQUE,             -- マイコードのハッシュ（コードそのものは保存しない）
  code_at      TEXT NOT NULL,                    -- マイコードの発行日時
  consent_ver  TEXT,                             -- 同意したプライバシーポリシーの版
  consent_at   TEXT,                             -- 同意日時
  archived_at  TEXT,                             -- 利用終了にした日時（1年たつと記録を自動で削除）
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- ログイン中の端末。token はハッシュで保存。role=member はお客様、staff はスタッフ
CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT PRIMARY KEY,
  role         TEXT NOT NULL,
  member_id    TEXT,                             -- role=member のとき
  staff_name   TEXT,                             -- role=staff のとき（操作記録用）
  pass_tag     TEXT,                             -- role=staff のとき：ログインした時の合言葉の目印（合言葉を変えると使えなくなる）
  expires_at   INTEGER NOT NULL,                 -- UNIX秒
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_member ON sessions(member_id);

-- ログインの試行回数（総当たり対策）
CREATE TABLE IF NOT EXISTS attempts (
  key          TEXT PRIMARY KEY,                 -- 例 member:IP / staff:IP
  count        INTEGER NOT NULL,
  reset_at     INTEGER NOT NULL                  -- UNIX秒
);

-- 報告（来店ごと）。kind=walk：トレッドミル／kind=ntc：前回からのNTC
CREATE TABLE IF NOT EXISTS reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id    TEXT NOT NULL,
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
CREATE INDEX IF NOT EXISTS idx_reports_member ON reports(member_id, date);

-- 体重・ウエストの測定（スタッフが来店直後・運動前に測る）
CREATE TABLE IF NOT EXISTS measurements (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id    TEXT NOT NULL,
  date         TEXT NOT NULL,
  weight       REAL,
  waist        REAL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_meas_member ON measurements(member_id, date);

-- あすけんで食事を記録した日数（週ごと・本人の自己申告）
CREATE TABLE IF NOT EXISTS asken (
  member_id    TEXT NOT NULL,
  week         TEXT NOT NULL,                    -- その週の月曜日 YYYY-MM-DD
  days         INTEGER NOT NULL,                 -- 0〜7
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (member_id, week)
);

-- 上位プラン・スタジオの案内の記録
CREATE TABLE IF NOT EXISTS upsells (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id    TEXT NOT NULL,
  date         TEXT NOT NULL,
  from_plan    TEXT NOT NULL,
  result       TEXT NOT NULL,                    -- yes（変更する）/ no（今は見送り）
  created_at   TEXT NOT NULL
);

-- スタッフの操作記録（誰が・いつ・何をしたか）
CREATE TABLE IF NOT EXISTS audit (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_name   TEXT NOT NULL,
  action       TEXT NOT NULL,
  member_id    TEXT,
  detail       TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL
);
