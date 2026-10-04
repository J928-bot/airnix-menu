import Anthropic from "@anthropic-ai/sdk";

export interface Env {
  DB: D1Database;
  ANTHROPIC_API_KEY: string;
  LINE_CHANNEL_ID: string;
  STAFF_USER_IDS: string;
}

export const ACTIONS = ["ウォーキング", "早歩き", "きつめの早歩き", "ランニング"] as const;
export type Action = (typeof ACTIONS)[number];
export interface Segment { min: number; action: Action; pace: [number, number]; resistance: number | null }
export interface Menu { machine: string; segments: Segment[] }
export interface ReportInput { machine: string; done: number; change: "なし" | "あり"; rpe: number; pain: "なし" | "あり"; comment: string }

// ---- 共通 ----
export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });

export const todayJst = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
export const nowIso = () => new Date().toISOString();

// ---- LINEログインの確認（LIFFのIDトークンを検証） ----
export async function verifyLine(request: Request, env: Env): Promise<{ userId: string; name: string } | null> {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const res = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: token, client_id: env.LINE_CHANNEL_ID }),
  });
  if (!res.ok) return null;
  const p = (await res.json()) as { sub?: string; name?: string };
  return p.sub ? { userId: p.sub, name: p.name || "" } : null;
}

export const isStaff = (env: Env, userId: string) =>
  env.STAFF_USER_IDS.split(",").map((s) => s.trim()).filter(Boolean).includes(userId);

// ---- メニューの検証（モニターAI v4.27 の出荷前検証を簡略化） ----
export function validMenu(m: unknown, machine?: string): m is Menu {
  const x = m as Menu;
  if (!x || typeof x !== "object" || !/^[A-G]$/.test(x.machine)) return false;
  if (machine && x.machine !== machine) return false;
  const hasR = /^[ABC]$/.test(x.machine);
  if (!Array.isArray(x.segments) || x.segments.length === 0 || x.segments.length > 12) return false;
  let total = 0;
  for (const s of x.segments) {
    if (!Number.isInteger(s.min) || s.min <= 0) return false;
    total += s.min;
    if (!ACTIONS.includes(s.action)) return false;
    if (!Array.isArray(s.pace) || s.pace.length !== 2) return false;
    const [lo, hi] = s.pace;
    if (!(lo > 0) || !(hi >= lo) || hi > 20) return false;
    if (hasR) { if (!Number.isInteger(s.resistance) || (s.resistance as number) < 1 || (s.resistance as number) > 6) return false; }
    else if (s.resistance !== null) return false;
  }
  return total === 30;
}

// ---- 初回メニュー（基本4型） ----
export type Template = "walk" | "resist" | "runwalk" | "run";
// 初回メニュー。速さ・きつめの抵抗は初回のトレッドミルで本人と確かめた数字を使う（初期値で決め打ちしない）
// 交代走法はモニターで最も結果が出た構成：5分ウォーキング →（3分早歩き・抵抗1＋1分きつめ・抵抗X）×5 → 5分ウォーキング
// きつめの速さは早歩きより約1km/h遅く（モニター実績：早歩き5.3〜6.0→抵抗3で4.0〜4.8、4.6〜5.0→3.5〜4.0）
export function initialMenu(machine: string, template: Template, walk: number, fast: number, run: number, hardRes?: number): Menu {
  const r = /^[ABC]$/.test(machine);
  const W = (min: number): Segment => ({ min, action: "ウォーキング", pace: [walk, round1(walk + 0.5)], resistance: r ? 1 : null });
  const F = (min: number): Segment => ({ min, action: "早歩き", pace: [fast, round1(fast + 0.5)], resistance: r ? 1 : null });
  const H = (min: number): Segment => ({ min, action: "きつめの早歩き",
    pace: [Math.max(3, round1(fast - 1.3)), Math.max(3.5, round1(fast - 0.7))], resistance: r ? (hardRes ?? 3) : null });
  const R = (min: number): Segment => ({ min, action: "ランニング", pace: [run, round1(run + 1.0)], resistance: r ? 1 : null });
  let segments: Segment[];
  if (template === "resist" && r) segments = [W(5), ...[1, 2, 3, 4, 5].flatMap(() => [F(3), H(1)]), W(5)];
  else if (template === "runwalk") segments = [W(3), R(6), W(3), R(6), W(3), R(6), W(3)];
  else if (template === "run") segments = [W(5), R(20), W(5)];
  else segments = [W(3), F(6), W(3), F(6), W(3), F(6), W(3)];
  return { machine, segments };
}
const round1 = (n: number) => Math.round(n * 10) / 10;

// ---- 簡易ルール（AIが使えない・ルール外のときの予備） ----
export function ruleClass(i: ReportInput): "少し引き上げ" | "維持" | "少し引き下げ" {
  if (i.done < 80 || i.rpe >= 9) return "少し引き下げ";
  if (i.done >= 90 && i.rpe <= 6 && i.change === "なし") return "少し引き上げ";
  return "維持";
}
export function ruleMenu(prev: Menu, i: ReportInput): Menu {
  const cls = ruleClass(i);
  const d = cls === "少し引き上げ" ? 0.3 : cls === "少し引き下げ" ? -0.3 : 0;
  const r = /^[ABC]$/.test(i.machine);
  return {
    machine: i.machine,
    segments: prev.segments.map((s) => {
      const pace: [number, number] = d && (s.action === "早歩き" || s.action === "ランニング")
        ? [Math.max(3, round1(s.pace[0] + d)), Math.max(3, round1(s.pace[1] + d))]
        : [s.pace[0], s.pace[1]];
      const resistance = r ? (Number.isInteger(s.resistance) ? s.resistance : s.action === "きつめの早歩き" ? 3 : 1) : null;
      return { ...s, pace, resistance };
    }),
  };
}

// ---- AIで次回メニュー（Claude） ----
const RULES = `あなたは低酸素ジムAIRNIX用賀店の個別メニュー作成係です。次のルールだけで次回の30分メニューを作ります。
- 分類は「維持」「少し引き上げ」「少し引き下げ」「構成変更」のどれか1つ。
- 達成度が高く体感が適正なら維持。完遂・途中変更なし・きつさ6以下で余裕があれば少し引き上げ。達成度の低下やきつさ9以上なら少し引き下げ。同じ構成で3回以上停滞しているか本人の要望があれば構成変更（ペース・抵抗は原則維持）。
- 強度を上げるときに変える要素は1つだけ（ペース・抵抗・本数のどれか）、小幅に。前回うまくいった要素は変えない。下げる方向と上げる方向を取り違えない。迷ったら慎重な方を選ぶ。
- 合計は必ず30分。各区間の分は正の整数。累積時間は書かない。同じ種類の反復区間は同じ時間にする。
- 動作名は「ウォーキング」「早歩き」「きつめの早歩き」「ランニング」だけ。
- 目安ペースはkm/hの範囲 [下限, 上限]。マシンA〜Cは各区間に抵抗1〜6の整数を付ける。マシンD〜Gは抵抗を0にする。
- 交代走法（抵抗1の早歩きと、抵抗を上げたきつめの早歩きの交互）の場合、モニターの実績に合わせる：きつめ区間は1〜2分、きつめの速さは早歩きより約1km/h遅く、抵抗を上げるときは1段階ずつ（上げた回は速さを変えない）。
- 医療的な判断はしない。`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["classification", "reason", "menu"],
  properties: {
    classification: { type: "string", enum: ["維持", "少し引き上げ", "少し引き下げ", "構成変更"] },
    reason: { type: "string" },
    menu: {
      type: "object",
      additionalProperties: false,
      required: ["machine", "segments"],
      properties: {
        machine: { type: "string" },
        segments: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["min", "action", "pace_low", "pace_high", "resistance"],
            properties: {
              min: { type: "integer" },
              action: { type: "string", enum: [...ACTIONS] },
              pace_low: { type: "number" },
              pace_high: { type: "number" },
              resistance: { type: "integer" },
            },
          },
        },
      },
    },
  },
} as const;

type AiRaw = {
  classification: string; reason: string;
  menu: { machine: string; segments: { min: number; action: Action; pace_low: number; pace_high: number; resistance: number }[] };
};

export async function aiMenu(env: Env, prev: Menu, history: unknown[], i: ReportInput): Promise<{ classification: string; reason: string; menu: Menu } | null> {
  if (!env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const content = `前回のメニュー: ${JSON.stringify(prev)}
直近の記録（古い順）: ${JSON.stringify(history)}
今回の報告: 使ったマシン${i.machine} / 達成度${i.done}% / 途中の変更:${i.change} / きつさ${i.rpe} / 感想:${i.comment || "なし"}
次回もマシン${i.machine}で作ってください。reasonは20字以内。`;
  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      // @ts-expect-error: SDKの型定義が追いつくまで（fallbacks の "default" 形式）
      fallbacks: "default",
      system: RULES,
      messages: [{ role: "user", content }],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
    });
    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return null;
    const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const raw = JSON.parse(text) as AiRaw;
    const r = /^[ABC]$/.test(raw.menu.machine);
    const menu: Menu = {
      machine: raw.menu.machine,
      segments: raw.menu.segments.map((s) => ({
        min: s.min, action: s.action, pace: [s.pace_low, s.pace_high], resistance: r ? s.resistance : null,
      })),
    };
    if (!validMenu(menu, i.machine)) return null;
    return { classification: raw.classification, reason: raw.reason, menu };
  } catch (e) {
    console.error("aiMenu failed", e);
    return null;
  }
}

// ---- 筋トレメニュー（自重・スタジオ） ----
// 段階1〜5の固定テンプレート。AIは使わず、報告に応じて段階を上げ下げする。
// ※種目と回数は試案。公開前にスタッフ・宮内さんの確認を取ること。
export interface StrengthItem { name: string; reps?: number; seconds?: number; sets: number; note?: string }
export interface StrengthMenu { level: number; items: StrengthItem[]; restSec: number }
const S = (name: string, sets: number, reps?: number, seconds?: number, note?: string): StrengthItem => ({ name, sets, reps, seconds, note });
export const STRENGTH_LEVELS: StrengthMenu[] = [
  { level: 1, restSec: 60, items: [S("椅子スクワット", 2, 10), S("壁腕立て", 2, 10), S("ヒップリフト", 2, 10), S("膝つきプランク", 2, undefined, 20), S("カーフレイズ", 2, 15)] },
  { level: 2, restSec: 60, items: [S("スクワット", 2, 10), S("膝つき腕立て", 2, 8), S("ヒップリフト", 2, 12), S("膝つきプランク", 2, undefined, 30), S("カーフレイズ", 2, 15)] },
  { level: 3, restSec: 45, items: [S("スクワット", 2, 15), S("膝つき腕立て", 2, 12), S("ヒップリフト", 2, 15), S("プランク", 2, undefined, 20), S("バックランジ", 2, 8, undefined, "左右それぞれ")] },
  { level: 4, restSec: 45, items: [S("スクワット", 3, 15), S("膝つき腕立て", 3, 15), S("ヒップリフト", 3, 15), S("プランク", 3, undefined, 30), S("バックランジ", 2, 10, undefined, "左右それぞれ")] },
  { level: 5, restSec: 45, items: [S("スクワット", 3, 20), S("腕立て伏せ", 3, 10), S("ヒップリフト", 3, 20), S("プランク", 3, undefined, 45), S("バックランジ", 3, 12, undefined, "左右それぞれ")] },
];
export const strengthMenu = (level: number) => STRENGTH_LEVELS[Math.min(5, Math.max(1, level)) - 1];
export function nextStrengthLevel(level: number, i: { done: number; rpe: number; change: string }) {
  const cls = ruleClass({ machine: "A", comment: "", pain: "なし", ...i } as ReportInput);
  const next = cls === "少し引き上げ" ? level + 1 : cls === "少し引き下げ" ? level - 1 : level;
  return { cls, level: Math.min(5, Math.max(1, next)) };
}

// ---- 入力チェック ----
export function parseStrengthReport(b: unknown) {
  const x = b as Record<string, unknown>;
  if (!x || typeof x !== "object") return null;
  const done = Number(x.done), rpe = Number(x.rpe);
  const change = x.change === "あり" ? "あり" : x.change === "なし" ? "なし" : null;
  const pain = x.pain === "あり" ? "あり" : x.pain === "なし" ? "なし" : null;
  if (!Number.isFinite(done) || done < 0 || done > 100 || !Number.isInteger(rpe) || rpe < 1 || rpe > 10 || !change || !pain) return null;
  return { done, rpe, change, pain, comment: String(x.comment || "").slice(0, 300) } as const;
}
export const numOrNull = (v: unknown, min: number, max: number) => {
  const n = Number(v);
  return v === "" || v === null || v === undefined || !Number.isFinite(n) || n < min || n > max ? null : Math.round(n * 10) / 10;
};
export function parseReport(b: unknown): ReportInput | null {
  const x = b as Record<string, unknown>;
  if (!x || typeof x !== "object") return null;
  const machine = String(x.machine || "");
  const done = Number(x.done), rpe = Number(x.rpe);
  const change = x.change === "あり" ? "あり" : x.change === "なし" ? "なし" : null;
  const pain = x.pain === "あり" ? "あり" : x.pain === "なし" ? "なし" : null;
  if (!/^[A-G]$/.test(machine) || !Number.isFinite(done) || done < 0 || done > 100) return null;
  if (!Number.isInteger(rpe) || rpe < 1 || rpe > 10 || !change || !pain) return null;
  return { machine, done, change, rpe, pain, comment: String(x.comment || "").slice(0, 300) };
}
