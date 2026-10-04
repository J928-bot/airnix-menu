import {
  type Env, type Menu, json, verifyLine, todayJst, nowIso, parseReport, parseStrengthReport,
  aiMenu, ruleClass, ruleMenu, nextStrengthLevel, strengthMenu,
} from "../../src/lib";

// お客様の報告（歩く／筋トレ）を受け取り、次回メニューを作って保存する。
// 痛み・体調変化「あり」はメニューを作らず、スタッフ確認（status=check）に回す。
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await verifyLine(request, env);
  if (!me) return json({ error: "LINEのログインを確認できませんでした" }, 401);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const kind = body?.kind === "strength" ? "strength" : "walk";

  const m = await env.DB.prepare("SELECT * FROM members WHERE line_user_id = ?").bind(me.userId).first<Record<string, unknown>>();
  if (!m || m.status === "pending") return json({ error: "まだ登録されていません。スタッフにお声がけください" }, 403);
  if (m.status === "done") return json({ error: "モニター期間は終了しています" }, 409);
  if (m.status === "check") return json({ error: "スタッフが体調を確認中です。確認後に次回メニューをお届けします" }, 409);

  const today = todayJst();
  const t = nowIso();
  const ins = (sessionNo: number, machine: string, r: { done: number; change: string; rpe: number; pain: string; comment: string }, result: string, madeBy: string, next: unknown) =>
    env.DB.prepare(`INSERT INTO reports (line_user_id, kind, date, session_no, machine, done, change, rpe, pain, comment, result, made_by, next_menu_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(me.userId, kind, today, sessionNo, machine, r.done, r.change, r.rpe, r.pain, r.comment, result, madeBy, next ? JSON.stringify(next) : null, t);

  // ---- 筋トレ ----
  if (kind === "strength") {
    const r = parseStrengthReport(body);
    if (!r) return json({ error: "入力内容を確認してください" }, 400);
    const sessionNo = Number(m.strength_count) + 1;
    if (r.pain === "あり") {
      await env.DB.batch([
        ins(sessionNo, "", r, "要確認", "stop", null),
        env.DB.prepare("UPDATE members SET status='check', strength_count=?, last_date=?, updated_at=? WHERE line_user_id=?").bind(sessionNo, today, t, me.userId),
      ]);
      return json({ stopped: true });
    }
    const { cls, level } = nextStrengthLevel(Number(m.strength_level), r);
    const next = strengthMenu(level);
    await env.DB.batch([
      ins(sessionNo, "", r, cls, "rule", next),
      env.DB.prepare("UPDATE members SET strength_level=?, strength_count=?, last_date=?, updated_at=? WHERE line_user_id=?").bind(level, sessionNo, today, t, me.userId),
    ]);
    return json({ kind, classification: cls, strength: next });
  }

  // ---- 歩く ----
  const input = parseReport(body);
  if (!input) return json({ error: "入力内容を確認してください" }, 400);
  if (!m.menu_json) return json({ error: "メニューがまだ登録されていません。スタッフにお声がけください" }, 409);
  const sessionNo = Number(m.count) + 1;

  if (input.pain === "あり") {
    await env.DB.batch([
      ins(sessionNo, input.machine, input, "要確認", "stop", null),
      env.DB.prepare("UPDATE members SET status='check', count=?, last_date=?, updated_at=? WHERE line_user_id=?").bind(sessionNo, today, t, me.userId),
    ]);
    return json({ stopped: true });
  }

  const goal = Number(m.goal);
  if (sessionNo >= goal) {
    await env.DB.batch([
      ins(sessionNo, input.machine, input, "終了", "rule", null),
      env.DB.prepare("UPDATE members SET status='done', count=?, last_date=?, menu_json=NULL, updated_at=? WHERE line_user_id=?").bind(sessionNo, today, t, me.userId),
    ]);
    return json({ finished: true });
  }

  const prev = JSON.parse(String(m.menu_json)) as Menu;
  const hist = await env.DB.prepare("SELECT date, machine, done, change, rpe, pain, result FROM reports WHERE line_user_id=? AND kind='walk' ORDER BY id DESC LIMIT 3")
    .bind(me.userId).all();
  const history = (hist.results || []).reverse();

  const ai = await aiMenu(env, prev, history, input);
  const next = ai ? ai.menu : ruleMenu(prev, input);
  const classification = ai ? ai.classification : ruleClass(input);
  const menuNo = Number(m.menu_no) + 1;

  await env.DB.batch([
    ins(sessionNo, input.machine, input, classification, ai ? "ai" : "rule", next),
    env.DB.prepare("UPDATE members SET count=?, last_date=?, menu_json=?, menu_no=?, updated_at=? WHERE line_user_id=?")
      .bind(sessionNo, today, JSON.stringify(next), menuNo, t, me.userId),
  ]);

  return json({ kind, classification, reason: ai?.reason || "", madeBy: ai ? "ai" : "rule", menuNo, menu: next, isFinal: sessionNo + 1 >= goal });
};
