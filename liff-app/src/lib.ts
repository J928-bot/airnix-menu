// サーバー共通：環境変数・LINEログインの確認・DBの読み書き
import { type Ladder, type NtcState, ntcNew } from "./logic";

export interface Env {
  DB: D1Database;
  LINE_CHANNEL_ID: string;
  STAFF_USER_IDS: string;
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });

export const todayJst = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
export const nowIso = () => new Date().toISOString();

// LIFFのIDトークンをLINEに問い合わせて確認する
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
  (env.STAFF_USER_IDS || "").split(",").map((s) => s.trim()).filter(Boolean).includes(userId);

export type Member = Record<string, unknown> & { line_user_id: string; status: string; lad_json: string | null; ntc_json: string | null };
export const ladderOf = (m: Member): Ladder | null => (m.lad_json ? (JSON.parse(m.lad_json) as Ladder) : null);
export const ntcOf = (m: Member): NtcState => (m.ntc_json ? (JSON.parse(m.ntc_json) as NtcState) : ntcNew("base"));

export async function getMember(env: Env, id: string) {
  return env.DB.prepare("SELECT * FROM members WHERE line_user_id = ?").bind(id).first<Member>();
}

export const numOrNull = (v: unknown, min: number, max: number) => {
  const n = Number(v);
  return v === "" || v === null || v === undefined || !Number.isFinite(n) || n < min || n > max ? null : Math.round(n * 10) / 10;
};
