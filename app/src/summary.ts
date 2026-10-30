// お客様の画面・スタッフの画面・効果レポートで使う集計（DBから読む）
import { type Env, type Member, ntcOf, todayJst } from "./lib";
import { addDays, weekStart, streak, hitWeeks, daysBetween, ntcProg, lastOf, measDiff, UPSELL } from "./logic";

type Rep = Record<string, unknown>;
type Meas = { member_id?: string; date: string; weight: number | null; waist: number | null };
type Ask = { member_id?: string; week: string; days: number };
export interface Detail { today: string; reports: Rep[]; measurements: Meas[]; asken: Ask[]; visits: string[] }

const toDetail = (today: string, reports: Rep[], measurements: Meas[], asken: Ask[]): Detail => {
  const visits = [...new Set(reports.filter((r) => r.kind === "walk").map((r) => String(r.date)))].sort();
  return { today, reports, measurements, asken, visits };
};

// 1人分（お客様の画面）
export async function loadDetail(env: Env, m: Member): Promise<Detail> {
  const id = m.id;
  const [rep, meas, ask] = await env.DB.batch([
    env.DB.prepare("SELECT kind, date, feel, pain, machine, km, ntc_count, note FROM reports WHERE member_id=? ORDER BY id DESC LIMIT 120").bind(id),
    env.DB.prepare("SELECT date, weight, waist FROM measurements WHERE member_id=? ORDER BY date, id").bind(id),
    env.DB.prepare("SELECT week, days FROM asken WHERE member_id=? ORDER BY week DESC LIMIT 8").bind(id),
  ]);
  return toDetail(todayJst(), (rep.results || []) as Rep[], (meas.results || []) as Meas[], (ask.results || []) as Ask[]);
}

// 全員分（スタッフの一覧）。1人ずつ読むとD1の1回あたりの問い合わせ上限（無料プラン50回）を超えるため、3回の問い合わせでまとめて読む
export async function loadDetails(env: Env, archived: boolean): Promise<Map<string, Detail>> {
  const where = archived ? "m.status = 'archived'" : "m.status != 'archived'";
  const [rep, meas, ask] = await env.DB.batch([
    env.DB.prepare(`SELECT member_id, kind, date, feel, pain, machine, km, ntc_count, note FROM (
      SELECT r.*, ROW_NUMBER() OVER (PARTITION BY r.member_id ORDER BY r.id DESC) AS rn FROM reports r JOIN members m ON m.id = r.member_id WHERE ${where}
    ) WHERE rn <= 120 ORDER BY member_id, id DESC`),
    env.DB.prepare(`SELECT x.member_id, x.date, x.weight, x.waist FROM measurements x JOIN members m ON m.id = x.member_id WHERE ${where} ORDER BY x.member_id, x.date, x.id`),
    env.DB.prepare(`SELECT member_id, week, days FROM (
      SELECT a.*, ROW_NUMBER() OVER (PARTITION BY a.member_id ORDER BY a.week DESC) AS rn FROM asken a JOIN members m ON m.id = a.member_id WHERE ${where}
    ) WHERE rn <= 8 ORDER BY member_id, week DESC`),
  ]);
  const group = <T extends { member_id?: unknown }>(rows: T[]) => {
    const g = new Map<string, T[]>();
    for (const r of rows) {
      const k = String(r.member_id);
      const list = g.get(k);
      if (list) list.push(r); else g.set(k, [r]);
    }
    return g;
  };
  const R = group((rep.results || []) as Rep[]), M = group((meas.results || []) as Meas[]), A = group((ask.results || []) as Ask[]);
  const today = todayJst();
  const ids = new Set([...R.keys(), ...M.keys(), ...A.keys()]);
  const out = new Map<string, Detail>();
  for (const id of ids) out.set(id, toDetail(today, R.get(id) || [], M.get(id) || [], A.get(id) || []));
  return out;
}
export const emptyDetail = (): Detail => toDetail(todayJst(), [], [], []);

// 直近30日の効果レポート
export function report30(m: Member, d: Detail) {
  const from = addDays(d.today, -29);
  const rs = d.reports.filter((r) => String(r.date) >= from);
  const visits = new Set(rs.filter((r) => r.kind === "walk").map((r) => r.date)).size;
  const ntc = rs.filter((r) => r.kind === "ntc").reduce((a, r) => a + Number(r.ntc_count || 0), 0);
  const km = Math.round(rs.filter((r) => r.km).reduce((a, r) => a + Number(r.km), 0) * 10) / 10;
  const asken = d.asken.filter((a) => a.week >= weekStart(from)).reduce((a, x) => a + x.days, 0);
  const ms = d.measurements;
  const last = ms.length ? { date: ms[ms.length - 1].date, weight: lastOf(ms, "weight"), waist: lastOf(ms, "waist") } : null;
  const weekly = Number(m.weekly || 2);
  const dw = measDiff(ms, "weight", from), dwa = measDiff(ms, "waist", from);
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

// ISOの日時（UTC）→ 日本時間の日付 YYYY-MM-DD。読めなければ空文字
const jstDate = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10) : "";
};

// スタッフ向けの注意・案内
export function flags(m: Member, d: Detail) {
  const out: { label: string; level: "d" | "w" | "a" | "b"; say: string }[] = [];
  const lv = d.visits[d.visits.length - 1] || null;
  // まだ一度も報告がない方は、登録日から数える（登録したばかりの方を「すぐ対応」にしない）
  const since = lv || jstDate(String(m.created_at || "")) || d.today;
  const gap = daysBetween(since, d.today);
  const gapLabel = lv ? `${gap}日来店なし` : `登録から${gap}日、報告なし`;
  if (m.status === "check") out.push({ label: "体調の確認", level: "d", say: "痛み・体調の変化の申告がありました。「その後、お体の具合はいかがですか？」と様子をうかがい、問題がなければ「体調を確認した」を押してください。気になる様子のときは、店長に相談してください。" });
  if (m.status !== "active") return out;
  if (gap >= 21) out.push({ label: gapLabel, level: "d", say: "LINEで様子をうかがい、次の予約をご案内してください。" });
  else if (gap >= 10) out.push({ label: gapLabel, level: "w", say: "LINEで次の来店をご案内してください。" });
  const lm = d.measurements[d.measurements.length - 1];
  if (!lm || daysBetween(lm.date, d.today) >= 14) out.push({ label: "測定なし", level: "w", say: "体重・ウエストの測定が2週間以上ありません。来店されたら、運動の前に測ってください。" });
  const ntcReports = d.reports.filter((r) => r.kind === "ntc");
  if (d.visits.length >= 2 && ntcReports.length === 0) out.push({ label: "NTC報告なし", level: "b", say: "NTCの報告がまだありません。来店されたら、NTCアプリの入れ方と今のメニューをご案内してください。" });
  // 案内のタイミング：週の目標を4週連続達成／8週連続来店／目標に到達。10日以上来ていない方・30日以内に案内済みの方は出さない
  const weekly = Number(m.weekly || 2);
  const up: string[] = [];
  const hw = hitWeeks(d.visits, weekly, d.today), st = streak(d.visits, d.today);
  if (hw >= 4) up.push(`週${weekly}回を${hw}週続けて達成`);
  if (st >= 8) up.push(`${st}週連続`);
  const lw = lastOf(d.measurements, "weight"), lc = lastOf(d.measurements, "waist");
  if ((m.target_weight != null && lw != null && lw <= Number(m.target_weight)) ||
    (m.target_waist != null && lc != null && lc <= Number(m.target_waist))) up.push("目標に到達");
  const snooze = m.upsell_at && daysBetween(String(m.upsell_at), d.today) < 30;
  const u = UPSELL[String(m.plan)];
  if (up.length && !snooze && gap < 10 && u) out.push({ label: "案内のタイミング", level: "a", say: `${up.join("・")}。効果レポートを見せて、${u.to}をご案内してください。` });
  return out;
}

