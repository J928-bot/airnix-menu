import { type Env, json, currentMember, nowIso, POLICY_VERSION, readJson } from "../../src/lib";

// プライバシーポリシーへの同意（体調などの情報を扱うため、最初に必ず同意をもらう）
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const a = await currentMember(request, env);
  if (a instanceof Response) return a;
  const b = await readJson(request);
  if (b?.agree !== true) return json({ error: "内容をご確認のうえ、同意にチェックしてください" }, 400);
  await env.DB.prepare("UPDATE members SET consent_ver=?, consent_at=?, updated_at=? WHERE id=?")
    .bind(POLICY_VERSION, nowIso(), nowIso(), a.m.id).run();
  return json({ ok: true });
};
