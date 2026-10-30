import { type Env, json, normalizeCode, codeHash, createSession, tooMany, clearAttempts, clientIp, readJson } from "../../src/lib";

// お客様のログイン：スタッフが発行したマイコード（8文字）を入れる
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const key = "member:" + clientIp(request);
  // 店内のWi-Fiは全員が同じ回線になるため、少し多めの30回（コードは約8,500億通りあるので、30回では当たらない）
  if (await tooMany(env, key, 30)) return json({ error: "何度も間違えたため、15分ほどお待ちください" }, 429);
  const b = await readJson(request);
  const code = normalizeCode(b?.code);
  if (code.length !== 8) return json({ error: "マイコード（8文字）を入れてください" }, 400);
  const m = await env.DB.prepare("SELECT id, status FROM members WHERE code_hash=?").bind(await codeHash(code)).first<{ id: string; status: string }>();
  if (!m) return json({ error: "マイコードが違います。もう一度お確かめください" }, 400);
  if (m.status === "archived") return json({ error: "ご利用が終了しています。スタッフにお声がけください" }, 403);
  await clearAttempts(env, key);
  return json({ ok: true }, 200, { "set-cookie": await createSession(env, "member", m.id) });
};
