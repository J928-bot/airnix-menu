-- AIRNIX 個別メニュー（LINEミニアプリ）D1スキーマ
-- 流れ：目標設定 → 歩く＋筋トレのメニュー → 食事（カロリー） → 進捗管理（体重・ウエスト）
CREATE TABLE IF NOT EXISTS members (
  line_user_id TEXT PRIMARY KEY,         -- LINEのユーザーID（ログインで自動取得）
  line_name    TEXT NOT NULL DEFAULT '', -- LINEの表示名（参考）
  name         TEXT NOT NULL DEFAULT '', -- スタッフが登録するお名前
  status       TEXT NOT NULL DEFAULT 'pending', -- pending / active / check / done
  goal         INTEGER NOT NULL DEFAULT 8,      -- モニター回数（歩くメニューの回数）
  count        INTEGER NOT NULL DEFAULT 0,      -- 歩くメニューの実施済み回数
  last_date    TEXT,                            -- 最終来店日 YYYY-MM-DD
  menu_json    TEXT,                            -- 次回の歩くメニュー
  menu_no      INTEGER NOT NULL DEFAULT 1,
  strength_level INTEGER NOT NULL DEFAULT 1,    -- 筋トレメニューの段階 1〜5
  strength_count INTEGER NOT NULL DEFAULT 0,    -- 筋トレの実施回数
  height       REAL,                            -- 身長 cm（目標の目安＝BMI・標準体重に使う）
  sex          TEXT,                            -- m / f / NULL（ウエストの目安 85/90cm に使う）
  start_weight REAL, start_waist REAL,          -- 開始時の測定
  target_weight REAL, target_waist REAL,        -- 目標
  target_date  TEXT,                            -- 目標の期日 YYYY-MM-DD
  kcal_target  INTEGER,                         -- 食事の目標カロリー（あすけんの目標値を本人が入力）
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  line_user_id TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'walk',   -- walk（歩く）/ strength（筋トレ）
  date         TEXT NOT NULL,           -- YYYY-MM-DD（日本時間）
  session_no   INTEGER NOT NULL,
  machine      TEXT NOT NULL DEFAULT '',-- 歩くメニューのみ
  done         INTEGER NOT NULL,        -- 達成度 %
  change       TEXT NOT NULL,           -- なし / あり
  rpe          INTEGER NOT NULL,        -- きつさ 1-10
  pain         TEXT NOT NULL,           -- なし / あり
  comment      TEXT NOT NULL DEFAULT '',
  result       TEXT,                    -- 判定（維持など）/ 要確認
  made_by      TEXT,                    -- ai / rule / stop
  next_menu_json TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_user ON reports(line_user_id, id);

-- 体重・ウエストの測定（スタッフが来店直後・運動前に測る）
CREATE TABLE IF NOT EXISTS measurements (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  line_user_id TEXT NOT NULL,
  date         TEXT NOT NULL,
  weight       REAL,
  waist        REAL,
  note         TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_meas_user ON measurements(line_user_id, date);

-- 食事（1日1件。あすけんの摂取カロリーを本人が入力）
CREATE TABLE IF NOT EXISTS meals (
  line_user_id TEXT NOT NULL,
  date         TEXT NOT NULL,
  kcal         INTEGER NOT NULL,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (line_user_id, date)
);
