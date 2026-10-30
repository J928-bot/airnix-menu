import { type Env, json, currentMember, ladderOf, ntcOf, POLICY_VERSION } from "../../src/lib";
import { loadDetail, report30 } from "../../src/summary";
import { ladderMenu, ntcProg, NTC_URL, weekStart } from "../../src/logic";

// お客様が開いたとき：今日のメニュー・NTC・目標と進捗・あすけん・効果レポートを返す
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const a = await currentMember(request, env);
  if (a instanceof Response) return a;
  const m = a.m;
  const headers: Record<string, string> = a.refresh ? { "set-cookie": a.refresh } : {};
  if (m.consent_ver !== POLICY_VERSION) return json({ needConsent: true, name: m.name }, 200, headers);

  const d = await loadDetail(env, m);
  const l = ladderOf(m);
  const n = ntcOf(m);
  const p = ntcProg(n);
  const wk = weekStart(d.today);
  return json({
    status: m.status,
    name: m.name,
    plan: m.plan,
    weekly: m.weekly,
    count: l.count,
    ladder: l,
    menu: ladderMenu(l),
    ntc: { ...n, program: p, url: NTC_URL + p.url },
    target: { startWeight: m.start_weight, startWaist: m.start_waist, weight: m.target_weight, waist: m.target_waist, date: m.target_date },
    measurements: d.measurements,
    visits: d.visits,
    askenThisWeek: (d.asken.find((x) => x.week === wk) || { days: null }).days,
    report: report30(m, d),
    lastNote: (d.reports[0] && String(d.reports[0].note)) || "",
    reportedToday: d.visits.includes(d.today),
    ntcAsk: d.visits.length >= 1 && !d.reports.some((r) => r.kind === "ntc" && String(r.date) >= wk), // NTCは週の最初の報告でだけ聞く
    today: d.today,
  }, 200, headers);
};
