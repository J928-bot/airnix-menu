import { type Env, json, verifyLine, todayJst, nowIso, getMember } from "../../src/lib";
import { weekStart } from "../../src/logic";

// 今週、あすけんで食事を記録した日数（本人の自己申告・0〜7）
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await verifyLine(request, env);
  if (!me) return json({ error: "LINEのログインを確認できませんでした" }, 401);
  const m = await getMember(env, me.userId);
  if (!m || m.status === "pending") return json({ error: "まだ登録されていません。スタッフにお声がけください" }, 403);
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const days = Number(b?.days);
  if (!Number.isInteger(days) || days < 0 || days > 7) return json({ error: "0〜7日で選んでください" }, 400);
  await env.DB.prepare(`INSERT INTO asken (line_user_id, week, days, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(line_user_id, week) DO UPDATE SET days=excluded.days, updated_at=excluded.updated_at`)
    .bind(me.userId, weekStart(todayJst()), days, nowIso()).run();
  return json({ ok: true });
};
