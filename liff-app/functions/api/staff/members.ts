import { type Env, type Template, json, verifyLine, isStaff, nowIso, todayJst, initialMenu, validMenu, numOrNull } from "../../../src/lib";

async function staffOnly(request: Request, env: Env) {
  const me = await verifyLine(request, env);
  if (!me) return { error: json({ error: "LINEのログインを確認できませんでした" }, 401) };
  if (!isStaff(env, me.userId)) return { error: json({ error: "スタッフ用の画面です" }, 403) };
  return { me };
}

// 一覧：状態・目標・最新の測定・直近3回の報告・直近7日の食事
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const a = await staffOnly(request, env);
  if (a.error) return a.error;
  const members = await env.DB.prepare(
    `SELECT line_user_id, line_name, name, status, goal, count, last_date, menu_no, strength_level, strength_count,
            height, sex, start_weight, start_waist, target_weight, target_waist, target_date, kcal_target FROM members ORDER BY updated_at DESC`,
  ).all();
  const reports = await env.DB.prepare(
    `SELECT line_user_id, kind, date, session_no, done, rpe, pain, result, made_by FROM reports
     WHERE id IN (SELECT id FROM reports r2 WHERE r2.line_user_id = reports.line_user_id ORDER BY id DESC LIMIT 3) ORDER BY id`,
  ).all();
  const meas = await env.DB.prepare(
    `SELECT line_user_id, date, weight, waist FROM measurements
     WHERE id IN (SELECT id FROM measurements m2 WHERE m2.line_user_id = measurements.line_user_id ORDER BY date DESC, id DESC LIMIT 1)`,
  ).all();
  const since = new Date(Date.now() + 9 * 3600e3 - 7 * 864e5).toISOString().slice(0, 10);
  const meals = await env.DB.prepare(
    "SELECT line_user_id, COUNT(*) AS days, ROUND(AVG(kcal)) AS avg FROM meals WHERE date > ? GROUP BY line_user_id",
  ).bind(since).all();

  const group = <T extends Record<string, unknown>>(rows: T[]) => {
    const o: Record<string, T[]> = {};
    for (const r of rows) (o[String(r.line_user_id)] ||= []).push(r);
    return o;
  };
  const rep = group(reports.results || []), ms = group(meas.results || []), ml = group(meals.results || []);
  return json({
    today: todayJst(),
    members: (members.results || []).map((m) => ({
      ...m,
      recent: rep[String(m.line_user_id)] || [],
      lastMeasure: (ms[String(m.line_user_id)] || [])[0] || null,
      meals7: (ml[String(m.line_user_id)] || [])[0] || null,
    })),
  });
};

// 操作：登録（目標＋初回メニュー）／測定の記録／体調確認済み／メニュー差し替え
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const a = await staffOnly(request, env);
  if (a.error) return a.error;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b.lineUserId !== "string") return json({ error: "対象の方を選んでください" }, 400);
  const id = b.lineUserId;
  const t = nowIso();
  const today = todayJst();

  if (b.action === "register") {
    const name = String(b.name || "").trim().slice(0, 40);
    const goal = Number(b.goal);
    const machine = String(b.machine || "");
    const template = String(b.template || "resist") as Template;
    const walk = Number(b.walk), fast = Number(b.fast), run = Number(b.run), hardRes = Number(b.hardRes);
    const weight = numOrNull(b.weight, 20, 250), waist = numOrNull(b.waist, 40, 200);
    const tWeight = numOrNull(b.targetWeight, 20, 250), tWaist = numOrNull(b.targetWaist, 40, 200);
    const tDate = typeof b.targetDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.targetDate) ? b.targetDate : null;
    const height = numOrNull(b.height, 100, 230);
    const sex = b.sex === "m" || b.sex === "f" ? b.sex : null;
    if (!name || !Number.isInteger(goal) || goal < 1 || goal > 60 || !/^[A-G]$/.test(machine)) return json({ error: "お名前・回数・マシンを確認してください" }, 400);
    // 速さ・抵抗は初回のトレッドミルで本人と確かめた数字（型ごとに必要なものだけ）
    if (!(walk > 0)) return json({ error: "初回に確かめたウォーキングの速さを入力してください" }, 400);
    if (template === "resist") {
      if (!/^[ABC]$/.test(machine)) return json({ error: "交代走法は抵抗のあるマシン（A〜C）を選んでください" }, 400);
      if (!(fast > 0) || !Number.isInteger(hardRes) || hardRes < 2 || hardRes > 6) return json({ error: "早歩きの速さと、きつめの抵抗（2〜6）を入力してください" }, 400);
    } else if (template === "walk" && !(fast > 0)) return json({ error: "早歩きの速さを入力してください" }, 400);
    else if ((template === "runwalk" || template === "run") && !(run > 0)) return json({ error: "ランニングの速さを入力してください" }, 400);
    if (weight === null || waist === null) return json({ error: "開始時の体重とウエストを入力してください" }, 400);
    if ((tWeight === null && tWaist === null) || !tDate || tDate <= today) return json({ error: "目標（体重かウエスト）と期日を入力してください" }, 400);
    const menu = initialMenu(machine, template, walk, fast || walk, run || walk, hardRes || undefined);
    if (!validMenu(menu)) return json({ error: "初回メニューを作れませんでした。条件を見直してください" }, 400);
    await env.DB.batch([
      env.DB.prepare(`UPDATE members SET name=?, goal=?, status='active', count=0, menu_no=1, menu_json=?, strength_level=1, strength_count=0,
        height=?, sex=?, start_weight=?, start_waist=?, target_weight=?, target_waist=?, target_date=?, updated_at=? WHERE line_user_id=?`)
        .bind(name, goal, JSON.stringify(menu), height, sex, weight, waist, tWeight, tWaist, tDate, t, id),
      env.DB.prepare("INSERT INTO measurements (line_user_id, date, weight, waist, note, created_at) VALUES (?, ?, ?, ?, '開始時', ?)")
        .bind(id, today, weight, waist, t),
    ]);
    return json({ ok: true, menu });
  }

  if (b.action === "setGoal") {
    // 目標の見直し。回数・メニュー・記録はそのまま。
    const tWeight = numOrNull(b.targetWeight, 20, 250), tWaist = numOrNull(b.targetWaist, 40, 200);
    const tDate = typeof b.targetDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.targetDate) ? b.targetDate : null;
    const height = numOrNull(b.height, 100, 230);
    const sex = b.sex === "m" || b.sex === "f" ? b.sex : null;
    const goal = Number(b.goal);
    if ((tWeight === null && tWaist === null) || !tDate || tDate <= today) return json({ error: "目標（体重かウエスト）と期日を入力してください" }, 400);
    if (!Number.isInteger(goal) || goal < 1 || goal > 60) return json({ error: "回数を確認してください" }, 400);
    await env.DB.prepare(`UPDATE members SET height=?, sex=?, target_weight=?, target_waist=?, target_date=?, goal=?, updated_at=?
      WHERE line_user_id=? AND status<>'pending'`).bind(height, sex, tWeight, tWaist, tDate, goal, t, id).run();
    return json({ ok: true });
  }

  if (b.action === "measure") {
    const weight = numOrNull(b.weight, 20, 250), waist = numOrNull(b.waist, 40, 200);
    if (weight === null && waist === null) return json({ error: "体重かウエストを入力してください" }, 400);
    await env.DB.prepare("INSERT INTO measurements (line_user_id, date, weight, waist, note, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, today, weight, waist, String(b.note || "").slice(0, 100), t).run();
    return json({ ok: true });
  }

  if (b.action === "clearCheck") {
    // 体調を確認して再開。メニューは前回のまま（強度を上げない）。
    await env.DB.prepare("UPDATE members SET status='active', updated_at=? WHERE line_user_id=? AND status='check'").bind(t, id).run();
    return json({ ok: true });
  }

  if (b.action === "setMenu") {
    if (!validMenu(b.menu)) return json({ error: "メニューの内容を確認してください（合計30分など）" }, 400);
    await env.DB.prepare("UPDATE members SET menu_json=?, updated_at=? WHERE line_user_id=?").bind(JSON.stringify(b.menu), t, id).run();
    return json({ ok: true });
  }

  return json({ error: "不明な操作です" }, 400);
};
