// サーバー共通：環境変数・ログイン（マイコード／スタッフ）・DBの読み書き
import { type Ladder, type NtcState, ntcNew, NTC_TRACKS } from "./logic";

export interface Env {
  DB: D1Database;
  STAFF_PASSWORD: string; // スタッフ画面の合言葉（wrangler secret で設定。コードには書かない）
}

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });

export const todayJst = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
export const nowIso = () => new Date().toISOString();
export const nowSec = () => Math.floor(Date.now() / 1000);

// ---------- 乱数・ハッシュ ----------
const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));
export async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// マイコード：読み間違えやすい文字（0/O・1/I/L）を除いた8文字。表示は XXXX-XXXX
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function newCode() {
  let out = "";
  while (out.length < 8) {
    for (const x of crypto.getRandomValues(new Uint8Array(16))) {
      if (x < 248 && out.length < 8) out += CODE_CHARS[x % 31]; // 248 = 31×8（偏りをなくす）
    }
  }
  return out;
}
export const normalizeCode = (s: unknown) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const formatCode = (c: string) => c.slice(0, 4) + "-" + c.slice(4);
export const codeHash = (c: string) => sha256("airnix-menu:" + c);

// ---------- Cookie・セッション ----------
export const COOKIE = { member: "am_m", staff: "am_s" } as const;
export const MEMBER_DAYS = 180; // お客様：最後に開いてから180日ログインを保つ
export const STAFF_HOURS = 12; // スタッフ：12時間

export function getCookie(request: Request, name: string) {
  const c = request.headers.get("cookie") || "";
  for (const part of c.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return ""; }
    }
  }
  return "";
}
export const setCookie = (name: string, value: string, maxAge: number) =>
  `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;

// スタッフのログインに付ける「合言葉の目印」。合言葉を変えると、それまでのスタッフのログインはすべて使えなくなる
export const passTag = async (env: Env) => (await sha256("staff-pass:" + (env.STAFF_PASSWORD || ""))).slice(0, 16);

export async function createSession(env: Env, role: "member" | "staff", who: string) {
  const token = randomToken();
  const ttl = role === "member" ? MEMBER_DAYS * 86400 : STAFF_HOURS * 3600;
  const now = nowSec();
  await env.DB.batch([
    // ログインのついでに、期限切れの端末・試行回数を片づける
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM attempts WHERE reset_at < ?").bind(now),
    env.DB.prepare("INSERT INTO sessions (token_hash, role, member_id, staff_name, pass_tag, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(await sha256(token), role, role === "member" ? who : null, role === "staff" ? who : null, role === "staff" ? await passTag(env) : null, now + ttl, nowIso()),
  ]);
  return setCookie(COOKIE[role], token, ttl);
}

export async function readSession(request: Request, env: Env, role: "member" | "staff") {
  const token = getCookie(request, COOKIE[role]);
  if (!token) return null;
  const h = await sha256(token);
  const s = await env.DB.prepare("SELECT * FROM sessions WHERE token_hash=? AND role=?").bind(h, role)
    .first<{ token_hash: string; member_id: string | null; staff_name: string | null; pass_tag: string | null; expires_at: number }>();
  if (!s) return null;
  if (s.expires_at < nowSec()) {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(h).run();
    return null;
  }
  // お客様は使うたびに期限を延ばす（1日1回まで）
  let refresh: string | null = null;
  if (role === "member" && s.expires_at - nowSec() < MEMBER_DAYS * 86400 - 86400) {
    await env.DB.prepare("UPDATE sessions SET expires_at=? WHERE token_hash=?").bind(nowSec() + MEMBER_DAYS * 86400, h).run();
    refresh = setCookie(COOKIE.member, token, MEMBER_DAYS * 86400);
  }
  return { ...s, refresh };
}

export async function endSession(request: Request, env: Env, role: "member" | "staff") {
  const token = getCookie(request, COOKIE[role]);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await sha256(token)).run();
  return setCookie(COOKIE[role], "", 0);
}

// ---------- 総当たり対策：15分にlimit回まで ----------
export async function tooMany(env: Env, key: string, limit: number) {
  const now = nowSec();
  const r = await env.DB.prepare("SELECT count, reset_at FROM attempts WHERE key=?").bind(key).first<{ count: number; reset_at: number }>();
  if (r && r.reset_at > now && r.count >= limit) return true;
  if (!r || r.reset_at <= now) await env.DB.prepare("INSERT OR REPLACE INTO attempts (key, count, reset_at) VALUES (?, 1, ?)").bind(key, now + 900).run();
  else await env.DB.prepare("UPDATE attempts SET count = count + 1 WHERE key=?").bind(key).run();
  return false;
}
export const clearAttempts = (env: Env, key: string) => env.DB.prepare("DELETE FROM attempts WHERE key=?").bind(key).run();
// 回数制限の単位。IPv6は /64 ごとにまとめる（1台で末尾だけ変えて回数制限をすり抜けられないように）
export function clientIp(request: Request) {
  const ip = (request.headers.get("cf-connecting-ip") || "local").toLowerCase();
  if (!ip.includes(":")) return ip;
  if (ip.includes(".")) return ip.slice(ip.lastIndexOf(":") + 1); // ::ffff:1.2.3.4 は IPv4 として扱う
  const [head, tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [], t = tail ? tail.split(":") : [];
  const full: string[] = ip.includes("::") ? [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  return full.slice(0, 4).map((x) => x.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

// ---------- お客様 ----------
export const POLICY_VERSION = "2026-10"; // プライバシーポリシーを変えたら上げる（お客様に再同意を求める）

export type Member = Record<string, unknown> & {
  id: string; name: string; status: string; plan: string; weekly: number; lad_json: string; ntc_json: string;
  consent_ver: string | null; last_date: string | null; upsell_at: string | null;
};
export const ladderOf = (m: Member) => JSON.parse(m.lad_json) as Ladder;
// NTCの状態。壊れた値・なくなった目的のときは「基本」の最初に戻す（画面が止まらないように）
export const ntcOf = (m: Member): NtcState => {
  try {
    const s = JSON.parse(m.ntc_json) as NtcState;
    if (s && NTC_TRACKS[s.track] && NTC_TRACKS[s.track].list[s.idx]) return s;
  } catch { /* 下で作り直す */ }
  return ntcNew("base");
};
export const getMember = (env: Env, id: string) => env.DB.prepare("SELECT * FROM members WHERE id = ?").bind(id).first<Member>();

// ログイン中のお客様（利用終了の方は入れない）。ログインしていなければ、そのまま返すエラー（Response）
export async function currentMember(request: Request, env: Env): Promise<Response | { m: Member; refresh: string | null }> {
  const s = await readSession(request, env, "member");
  if (!s || !s.member_id) return json({ error: "ログインしてください", login: true }, 401);
  const m = await getMember(env, s.member_id);
  if (!m || m.status === "archived") return json({ error: "ご利用が終了しています。スタッフにお声がけください", login: true }, 401);
  return { m, refresh: s.refresh };
}

// ログイン中のスタッフの名前。ログインしていなければ、そのまま返すエラー（Response）
export async function currentStaff(request: Request, env: Env): Promise<Response | string> {
  const s = await readSession(request, env, "staff");
  if (!s || !s.staff_name || s.pass_tag !== (await passTag(env))) return json({ error: "スタッフのログインが必要です", login: true }, 401);
  return s.staff_name;
}

export const audit = (env: Env, staff: string, action: string, memberId: string | null, detail = "") =>
  env.DB.prepare("INSERT INTO audit (staff_name, action, member_id, detail, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(staff, action, memberId, detail.slice(0, 300), nowIso());

export const numOrNull = (v: unknown, min: number, max: number) => {
  const n = Number(v);
  return v === "" || v === null || v === undefined || !Number.isFinite(n) || n < min || n > max ? null : Math.round(n * 10) / 10;
};

// 送られてきたJSON（10KBまで・オブジェクトだけ）。読めなければ null
export const readJson = async (request: Request): Promise<Record<string, unknown> | null> => {
  if (Number(request.headers.get("content-length") || 0) > 10_000) return null;
  const text = await request.text().catch(() => "");
  if (text.length > 10_000) return null;
  try {
    const v: unknown = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch { return null; }
};
