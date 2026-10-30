import { type Env, json, currentMember, todayJst, nowIso, POLICY_VERSION, readJson } from "../../src/lib";
import { weekStart } from "../../src/logic";

// 今週、あすけんで食事を記録した日数（本人の自己申告・0〜7）
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const a = await currentMember(request, env);
  if (a instanceof Response) return a;
  if (a.m.consent_ver !== POLICY_VERSION) return json({ error: "先にプライバシーポリシーへの同意が必要です" }, 403);
  const b = await readJson(request);
  const days = Number(b?.days);
  if (!Number.isInteger(days) || days < 0 || days > 7) return json({ error: "0〜7日で選んでください" }, 400);
  await env.DB.prepare(`INSERT INTO asken (member_id, week, days, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(member_id, week) DO UPDATE SET days=excluded.days, updated_at=excluded.updated_at`)
    .bind(a.m.id, weekStart(todayJst()), days, nowIso()).run();
  return json({ ok: true });
};
