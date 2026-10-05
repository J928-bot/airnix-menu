import { type Env, json, verifyLine, nowIso, isStaff, getMember, ladderOf, ntcOf } from "../../src/lib";
import { loadDetail, report30 } from "../../src/summary";
import { ladderMenu, ntcProg, NTC_URL, weekStart } from "../../src/logic";

// お客様がミニアプリを開いたとき：今日のメニュー・NTC・目標と進捗・あすけん・効果レポートを返す。
// 初めての方は「登録待ち」として記録し、スタッフの画面に出す。
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const me = await verifyLine(request, env);
  if (!me) return json({ error: "LINEのログインを確認できませんでした" }, 401);

  const m = await getMember(env, me.userId);
  if (!m) {
    const t = nowIso();
    await env.DB.prepare("INSERT INTO members (line_user_id, line_name, status, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?)")
      .bind(me.userId, me.name, t, t).run();
    return json({ status: "pending", name: me.name, isStaff: isStaff(env, me.userId) });
  }
  if (m.status === "pending") return json({ status: "pending", name: m.line_name, isStaff: isStaff(env, me.userId) });

  const d = await loadDetail(env, m);
  const l = ladderOf(m);
  const n = ntcOf(m);
  const p = ntcProg(n);
  const wk = weekStart(d.today);
  return json({
    status: m.status,
    name: m.name || m.line_name,
    plan: m.plan,
    weekly: m.weekly,
    count: l ? l.count : 0,
    ladder: l,
    menu: l ? ladderMenu(l) : null,
    ntc: { ...n, program: p, url: NTC_URL + p.url },
    target: { startWeight: m.start_weight, startWaist: m.start_waist, weight: m.target_weight, waist: m.target_waist, date: m.target_date },
    measurements: d.measurements,
    visits: d.visits,
    askenThisWeek: (d.asken.find((a) => a.week === wk) || { days: null }).days,
    report: report30(m, d),
    lastNote: (d.reports[0] && String(d.reports[0].note)) || "",
    today: d.today,
    isStaff: isStaff(env, me.userId),
  });
};
