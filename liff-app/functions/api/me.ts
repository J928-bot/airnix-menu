import { type Env, json, verifyLine, nowIso, isStaff, strengthMenu, todayJst } from "../../src/lib";

// お客様がミニアプリを開いたとき：目標・進捗・今回のメニュー（歩く／筋トレ）・食事を返す。
// 初めての方は「登録待ち」として記録し、スタッフの画面に出す。
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await verifyLine(request, env);
  if (!me) return json({ error: "LINEのログインを確認できませんでした" }, 401);

  let row = await env.DB.prepare("SELECT * FROM members WHERE line_user_id = ?").bind(me.userId).first<Record<string, unknown>>();
  if (!row) {
    const t = nowIso();
    await env.DB.prepare("INSERT INTO members (line_user_id, line_name, status, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?)")
      .bind(me.userId, me.name, t, t).run();
    return json({ status: "pending", name: me.name, isStaff: isStaff(env, me.userId) });
  }

  const meas = await env.DB.prepare("SELECT date, weight, waist FROM measurements WHERE line_user_id=? ORDER BY date DESC, id DESC LIMIT 12")
    .bind(me.userId).all();
  const meals = await env.DB.prepare("SELECT date, kcal FROM meals WHERE line_user_id=? ORDER BY date DESC LIMIT 14")
    .bind(me.userId).all();
  const goal = Number(row.goal ?? 8), count = Number(row.count ?? 0);
  const today = todayJst();
  const todayMeal = (meals.results || []).find((m) => m.date === today);

  return json({
    status: row.status,
    name: row.name || row.line_name,
    goal, count,
    menuNo: Number(row.menu_no ?? 1),
    isFinal: count + 1 >= goal,
    menu: row.menu_json ? JSON.parse(String(row.menu_json)) : null,
    strength: strengthMenu(Number(row.strength_level ?? 1)),
    strengthCount: Number(row.strength_count ?? 0),
    target: {
      startWeight: row.start_weight, startWaist: row.start_waist,
      weight: row.target_weight, waist: row.target_waist, date: row.target_date,
    },
    measurements: (meas.results || []).reverse(),
    kcalTarget: row.kcal_target ?? null,
    meals: (meals.results || []).reverse(),
    todayKcal: todayMeal ? todayMeal.kcal : null,
    isStaff: isStaff(env, me.userId),
  });
};
