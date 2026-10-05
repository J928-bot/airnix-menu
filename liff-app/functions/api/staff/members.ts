import { type Env, type Member, json, verifyLine, isStaff, nowIso, todayJst, getMember, ladderOf, ntcOf, numOrNull } from "../../../src/lib";
import { loadDetail, report30, flags } from "../../../src/summary";
import { ntcNew, ntcProg, NTC_TRACKS, UPSELL, streak, type Ladder } from "../../../src/logic";

async function staffOnly(request: Request, env: Env) {
  const me = await verifyLine(request, env);
  if (!me) return { error: json({ error: "LINEのログインを確認できませんでした" }, 401) };
  if (!isStaff(env, me.userId)) return { error: json({ error: "スタッフ用の画面です" }, 403) };
  return { me };
}

const PLANS = ["ライト", "メイン", "プレミアム"];

// 一覧：全員の状態・注意・案内・効果レポート
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const a = await staffOnly(request, env);
  if (a.error) return a.error;
  const rows = ((await env.DB.prepare("SELECT * FROM members ORDER BY updated_at DESC").all()).results || []) as Member[];
  const members = await Promise.all(rows.map(async (m) => {
    const d = await loadDetail(env, m);
    const l = ladderOf(m), n = ntcOf(m);
    return {
      id: m.line_user_id, name: m.name || m.line_name, lineName: m.line_name, status: m.status, plan: m.plan, weekly: m.weekly,
      ladder: l, ntc: { ...n, name: ntcProg(n).name, weeks: ntcProg(n).weeks },
      target: { startWeight: m.start_weight, startWaist: m.start_waist, weight: m.target_weight, waist: m.target_waist, date: m.target_date },
      lastVisit: d.visits[d.visits.length - 1] || null, streak: streak(d.visits, d.today),
      lastReport: d.reports[0] || null, lastMeasure: d.measurements[d.measurements.length - 1] || null, measurements: d.measurements,
      flags: flags(m, d), report: m.status === "pending" ? null : report30(m, d), upsell: UPSELL[String(m.plan)] || null,
    };
  }));
  const rank = (x: (typeof members)[number]) => {
    const lv = x.flags.map((f) => f.level);
    return lv.includes("d") ? 0 : x.status === "pending" ? 1 : lv.includes("w") ? 2 : lv.includes("a") ? 3 : 4;
  };
  members.sort((p, q) => rank(p) - rank(q));
  return json({ today: todayJst(), members, tracks: Object.fromEntries(Object.entries(NTC_TRACKS).map(([k, v]) => [k, v.label])) });
};

// 操作：登録／測定／体調確認済み／NTCの目的の変更／案内の記録
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const a = await staffOnly(request, env);
  if (a.error) return a.error;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b.id !== "string") return json({ error: "対象の方を選んでください" }, 400);
  const m = await getMember(env, b.id);
  if (!m) return json({ error: "見つかりませんでした" }, 404);
  const t = nowIso(), today = todayJst();

  if (b.action === "register") {
    // 初回：スタッフがお客様と一緒にトレッドミルで速さの基準を測定し、その数字で登録する
    const name = String(b.name || "").trim().slice(0, 40);
    const plan = String(b.plan || "");
    const weekly = Number(b.weekly);
    const machine = String(b.machine || "");
    const fp = numOrNull(b.fast, 3, 9), wp = numOrNull(b.walk, 2, 7), hr = Number(b.hardRes || 3);
    if (!name || !PLANS.includes(plan) || !Number.isInteger(weekly) || weekly < 1 || weekly > 7) return json({ error: "名前・プラン・週の目標を入れてください" }, 400);
    if (!/^[A-G]$/.test(machine) || fp == null || wp == null || !(hr >= 1 && hr <= 6)) return json({ error: "マシン・速さ（ゆっくり／早歩き）・きつめの抵抗を入れてください" }, 400);
    const lad: Ladder = { machine, wl: 1, wp, fp, fp0: fp, hr, hr0: hr, count: 0 };
    const sw = numOrNull(b.startWeight, 25, 250), sc = numOrNull(b.startWaist, 40, 200);
    const tw = numOrNull(b.targetWeight, 25, 250), tc = numOrNull(b.targetWaist, 40, 200);
    const td = /^\d{4}-\d{2}-\d{2}$/.test(String(b.targetDate)) ? String(b.targetDate) : null;
    const stmts = [env.DB.prepare(`UPDATE members SET name=?, plan=?, weekly=?, status='active', lad_json=?, ntc_json=?, start_weight=?, start_waist=?,
      target_weight=?, target_waist=?, target_date=?, updated_at=? WHERE line_user_id=?`)
      .bind(name, plan, weekly, JSON.stringify(lad), JSON.stringify(ntcNew(String(b.track || "base"))), sw, sc, tw, tc, td, t, m.line_user_id)];
    if (sw != null || sc != null) stmts.push(env.DB.prepare("INSERT INTO measurements (line_user_id, date, weight, waist, created_at) VALUES (?, ?, ?, ?, ?)").bind(m.line_user_id, today, sw, sc, t));
    await env.DB.batch(stmts);
    return json({ ok: true });
  }

  if (b.action === "measure") {
    const w = numOrNull(b.weight, 25, 250), c = numOrNull(b.waist, 40, 200);
    if (w == null && c == null) return json({ error: "体重かウエストを入れてください" }, 400);
    await env.DB.prepare("INSERT INTO measurements (line_user_id, date, weight, waist, created_at) VALUES (?, ?, ?, ?, ?)").bind(m.line_user_id, today, w, c, t).run();
    return json({ ok: true });
  }

  if (b.action === "resolve") {
    await env.DB.prepare("UPDATE members SET status='active', updated_at=? WHERE line_user_id=? AND status='check'").bind(t, m.line_user_id).run();
    return json({ ok: true });
  }

  if (b.action === "track") {
    const track = String(b.track || "");
    if (!NTC_TRACKS[track]) return json({ error: "目的を選んでください" }, 400);
    if (ntcOf(m).track === track) return json({ ok: true });
    await env.DB.prepare("UPDATE members SET ntc_json=?, updated_at=? WHERE line_user_id=?").bind(JSON.stringify(ntcNew(track)), t, m.line_user_id).run();
    return json({ ok: true });
  }

  if (b.action === "upsell") {
    // 案内した結果を記録。プランの変更そのものは hacomono で行う（ここは表示用のプランを合わせるだけ）
    const result = b.result === "yes" ? "yes" : "no";
    const from = String(m.plan || "");
    const plan = result === "yes" && from !== "プレミアム" ? "プレミアム" : from;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO upsells (line_user_id, date, from_plan, result, created_at) VALUES (?, ?, ?, ?, ?)").bind(m.line_user_id, today, from, result, t),
      env.DB.prepare("UPDATE members SET upsell_at=?, plan=?, updated_at=? WHERE line_user_id=?").bind(today, plan, t, m.line_user_id),
    ]);
    return json({ ok: true });
  }

  return json({ error: "操作が分かりませんでした" }, 400);
};
