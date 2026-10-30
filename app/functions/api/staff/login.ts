import { type Env, json, sha256, createSession, endSession, tooMany, clearAttempts, clientIp, readJson, audit } from "../../../src/lib";

// スタッフのログイン：名前（操作記録用）＋店舗の合言葉
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const key = "staff:" + clientIp(request);
  if (await tooMany(env, key, 5)) return json({ error: "何度も間違えたため、15分ほどお待ちください" }, 429);
  const b = await readJson(request);
  const name = String(b?.name || "").trim().slice(0, 20);
  const pass = String(b?.password || "");
  if (!name || !pass) return json({ error: "お名前と合言葉を入れてください" }, 400);
  if (!env.STAFF_PASSWORD || env.STAFF_PASSWORD.length < 10) return json({ error: "合言葉がまだ設定されていません。店長に連絡してください" }, 500);
  if ((await sha256(pass)) !== (await sha256(env.STAFF_PASSWORD))) return json({ error: "合言葉が違います" }, 400);
  await clearAttempts(env, key);
  const cookie = await createSession(env, "staff", name);
  await audit(env, name, "login", null).run();
  return json({ ok: true }, 200, { "set-cookie": cookie });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) =>
  json({ ok: true }, 200, { "set-cookie": await endSession(request, env, "staff") });
