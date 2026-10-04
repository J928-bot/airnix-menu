import { type Env, json, verifyLine, todayJst, nowIso } from "../../src/lib";

// 食事：あすけんの「摂取カロリー」（1日分）と「目標カロリー」を本人が入力する。
// カロリーの目標値はAIRNIXでは計算しない（あすけんが出した目標をそのまま使う）。
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await verifyLine(request, env);
  if (!me) return json({ error: "LINEのログインを確認できませんでした" }, 401);
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return json({ error: "入力内容を確認してください" }, 400);

  const m = await env.DB.prepare("SELECT status FROM members WHERE line_user_id=?").bind(me.userId).first<{ status: string }>();
  if (!m || m.status === "pending") return json({ error: "まだ登録されていません。スタッフにお声がけください" }, 403);

  const t = nowIso();
  const stmts = [];
  if (b.kcal !== undefined && b.kcal !== "") {
    const kcal = Number(b.kcal);
    if (!Number.isInteger(kcal) || kcal < 300 || kcal > 6000) return json({ error: "カロリーは300〜6000の数字で入力してください" }, 400);
    const date = typeof b.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.date) && b.date <= todayJst() ? b.date : todayJst();
    stmts.push(env.DB.prepare(
      "INSERT INTO meals (line_user_id, date, kcal, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(line_user_id, date) DO UPDATE SET kcal=excluded.kcal, updated_at=excluded.updated_at",
    ).bind(me.userId, date, kcal, t));
  }
  if (b.kcalTarget !== undefined && b.kcalTarget !== "") {
    const target = Number(b.kcalTarget);
    if (!Number.isInteger(target) || target < 800 || target > 5000) return json({ error: "目標カロリーは800〜5000の数字で入力してください" }, 400);
    stmts.push(env.DB.prepare("UPDATE members SET kcal_target=?, updated_at=? WHERE line_user_id=?").bind(target, t, me.userId));
  }
  if (!stmts.length) return json({ error: "カロリーを入力してください" }, 400);
  await env.DB.batch(stmts);
  return json({ ok: true });
};
