// お客様の画面・スタッフの画面・効果レポートで使う集計（DBから読む）
import { type Env, type Member, ladderOf, ntcOf, todayJst } from "./lib";
import { addDays, weekStart, streak, hitWeeks, daysBetween, ntcProg, UPSELL } from "./logic";

export async function loadDetail(env: Env, m: Member) {
  const id = m.line_user_id;
  const today = todayJst();
  const [rep, meas, ask] = await Promise.all([
    env.DB.prepare("SELECT kind, date, feel, pain, machine, km, ntc_count, note FROM reports WHERE line_user_id=? ORDER BY id DESC LIMIT 120").bind(id).all(),
    env.DB.prepare("SELECT date, weight, waist FROM measurements WHERE line_user_id=? ORDER BY date, id").bind(id).all(),
    env.DB.prepare("SELECT week, days FROM asken WHERE line_user_id=? ORDER BY week DESC LIMIT 8").bind(id).all(),
  ]);
  const reports = (rep.results || []) as Record<string, unknown>[];
  const measurements = (meas.results || []) as { date: string; weight: number | null; waist: number | null }[];
  const asken = (ask.results || []) as { week: string; days: number }[];
  const visits = [...new Set(reports.filter((r) => r.kind === "walk").map((r) => String(r.date)))].sort();
  return { today, reports, measurements, asken, visits };
}

// 直近30日の効果レポート
export function report30(m: Member, d: Awaited<ReturnType<typeof loadDetail>>) {
  const from = addDays(d.today, -29);
  const rs = d.reports.filter((r) => String(r.date) >= from);
  const visits = new Set(rs.filter((r) => r.kind === "walk").map((r) => r.date)).size;
  const ntc = rs.filter((r) => r.kind === "ntc").reduce((a, r) => a + Number(r.ntc_count || 0), 0);
  const km = Math.round(rs.filter((r) => r.km).reduce((a, r) => a + Number(r.km), 0) * 10) / 10;
  const asken = d.asken.filter((a) => a.week >= weekStart(from)).reduce((a, x) => a + x.days, 0);
  const ms = d.measurements;
  const base = [...ms].reverse().find((x) => x.date < from) || ms[0];
  const last = ms[ms.length - 1];
  const diff = (k: "weight" | "waist") =>
    base && last && base[k] != null && last[k] != null && last.date !== base.date ? Math.round((Number(last[k]) - Number(base[k])) * 10) / 10 : null;
  const weekly = Number(m.weekly || 2);
  const dw = diff("weight"), dwa = diff("waist");
  const good: string[] = [];
  if (visits >= weekly * 4) good.push(`週${weekly}回のペースで通えました`);
  if (dwa != null && dwa < 0) good.push(`ウエストが${-dwa}cm細くなりました`);
  if (dw != null && dw < 0) good.push(`体重が${-dw}kg減りました`);
  if (ntc > 0) good.push(`来店以外の日にNTCを${ntc}回続けました`);
  const n = ntcOf(m);
  const next = visits < weekly * 4 ? `来月は週${weekly}回のペースを目指しましょう。`
    : asken < 12 ? "来月は、あすけんで食事を記録する日を週3日以上に増やしてみましょう。"
    : `この調子で、${ntcProg(n).name}を続けていきましょう。`;
  return {
    from, to: d.today, visits, ntc, km, asken, dw, dwa, last: last || null, good, next,
    streak: streak(d.visits, d.today), ntcName: ntcProg(n).name, ntcWeek: n.week,
  };
}

// スタッフ向けの注意・案内
export function flags(m: Member, d: Awaited<ReturnType<typeof loadDetail>>) {
  const out: { label: string; level: "d" | "w" | "a" | "b"; say: string }[] = [];
  const lv = d.visits[d.visits.length - 1] || null;
  const gap = lv ? daysBetween(lv, d.today) : 999;
  if (m.status === "pending") out.push({ label: "登録待ち", level: "w", say: "ミニアプリを開いた方です。名前・プラン・トレッドミルの基準を登録してください。" });
  if (m.status === "check") out.push({ label: "体調の確認", level: "d", say: "痛み・体調の変化の申告がありました。様子を聞いて、問題なければ「確認した」を押してください。" });
  if (m.status !== "active") return out;
  if (gap >= 21) out.push({ label: `${gap}日来店なし`, level: "d", say: "LINEで様子を聞き、次の予約を案内する。" });
  else if (gap >= 10) out.push({ label: `${gap}日来店なし`, level: "w", say: "LINEで次の来店を案内する。" });
  const lm = d.measurements[d.measurements.length - 1];
  if (!lm || daysBetween(lm.date, d.today) >= 14) out.push({ label: "測定なし", level: "w", say: "体重・ウエストの測定が2週間以上ありません。次の来店時に測る。" });
  const ntcReports = d.reports.filter((r) => r.kind === "ntc");
  if (d.visits.length >= 2 && ntcReports.length === 0) out.push({ label: "NTC報告なし", level: "b", say: "NTCの報告がまだありません。来店時にアプリの入れ方と今のメニューを案内する。" });
  // 案内のタイミング：週の目標を4週連続達成／8週連続来店／目標に到達。10日以上来ていない方・30日以内に案内済みの方は出さない
  const weekly = Number(m.weekly || 2);
  const up: string[] = [];
  const hw = hitWeeks(d.visits, weekly, d.today), st = streak(d.visits, d.today);
  if (hw >= 4) up.push(`週${weekly}回を${hw}週続けて達成`);
  if (st >= 8) up.push(`${st}週連続`);
  if (lm && ((m.target_weight != null && lm.weight != null && lm.weight <= Number(m.target_weight)) ||
    (m.target_waist != null && lm.waist != null && lm.waist <= Number(m.target_waist)))) up.push("目標に到達");
  const snooze = m.upsell_at && daysBetween(String(m.upsell_at), d.today) < 30;
  const u = UPSELL[String(m.plan)];
  if (up.length && !snooze && gap < 10 && u) out.push({ label: "案内のタイミング", level: "a", say: `${up.join("・")}。効果レポートを見せて、${u.to}を案内する。` });
  return out;
}

export function ladderView(m: Member) {
  const l = ladderOf(m);
  return l ? { ...l } : null;
}
