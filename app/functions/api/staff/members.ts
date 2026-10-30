import {
  type Env, type Member, json, currentStaff, nowIso, todayJst, getMember, ladderOf, ntcOf, numOrNull, readJson, audit,
  newCode, codeHash, formatCode, randomToken,
} from "../../../src/lib";
import { loadDetails, emptyDetail, report30, flags } from "../../../src/summary";
import { ntcNew, ntcProg, NTC_TRACKS, UPSELL, PLANS, streak, type Ladder } from "../../../src/logic";

// ひとりの記録をすべて消す文（操作記録は残すが、お名前など個人の情報は消す）
const deleteMember = (env: Env, id: string) => [
  ...["reports", "measurements", "asken", "upsells", "sessions"].map((tb) => env.DB.prepare(`DELETE FROM ${tb} WHERE member_id=?`).bind(id)),
  env.DB.prepare("DELETE FROM members WHERE id=?").bind(id),
  env.DB.prepare("UPDATE audit SET detail='' WHERE member_id=?").bind(id),
];

// 保存期間（プライバシーポリシー5.）：利用終了から1年たった方の記録を削除する。スタッフが一覧を開くたびに確認。
// 1人あたり8文。無料プランの「1回50問い合わせ」に収まるよう、1回に3人まで（残りは次に一覧を開いたときに消す）
const RETENTION_DAYS = 365;
async function purgeExpired(env: Env) {
  const limit = new Date(Date.now() - RETENTION_DAYS * 86400 * 1000).toISOString();
  const old = (await env.DB.prepare("SELECT id FROM members WHERE status='archived' AND archived_at IS NOT NULL AND archived_at < ? LIMIT 3").bind(limit).all<{ id: string }>()).results || [];
  if (old.length) await env.DB.batch(old.flatMap((o) => [...deleteMember(env, o.id), audit(env, "自動", "retention-delete", o.id)]));
}

// 一覧：利用中の全員の状態・注意・案内・効果レポート（?archived=1 で利用終了の方）
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const staff = await currentStaff(request, env);
  if (staff instanceof Response) return staff;
  await purgeExpired(env);
  const archived = new URL(request.url).searchParams.get("archived") === "1";
  const [rows, details] = await Promise.all([
    env.DB.prepare(`SELECT * FROM members WHERE status ${archived ? "=" : "!="} 'archived' ORDER BY updated_at DESC`).all<Member>(),
    loadDetails(env, archived),
  ]);
  const members = (rows.results || []).map((m) => {
    const d = details.get(m.id) || emptyDetail();
    const l = ladderOf(m), n = ntcOf(m);
    return {
      id: m.id, name: m.name, status: m.status, plan: m.plan, weekly: m.weekly, consent: !!m.consent_ver,
      ladder: l, ntc: { ...n, name: ntcProg(n).name, weeks: ntcProg(n).weeks },
      target: { startWeight: m.start_weight, startWaist: m.start_waist, weight: m.target_weight, waist: m.target_waist, date: m.target_date },
      lastVisit: d.visits[d.visits.length - 1] || null, streak: streak(d.visits, d.today),
      lastReport: d.reports[0] || null, lastMeasure: d.measurements[d.measurements.length - 1] || null, measurements: d.measurements,
      flags: archived ? [] : flags(m, d), report: report30(m, d), upsell: UPSELL[m.plan] || null,
    };
  });
  const rank = (x: (typeof members)[number]) => {
    const lv = x.flags.map((f) => f.level);
    return lv.includes("d") ? 0 : lv.includes("w") ? 1 : lv.includes("a") ? 2 : 3;
  };
  members.sort((p, q) => rank(p) - rank(q));
  return json({
    today: todayJst(), staff, members, plans: PLANS,
    tracks: Object.fromEntries(Object.entries(NTC_TRACKS).map(([k, v]) => [k, v.label])),
  });
};

// 入力された開始時の情報を確認する（新規登録・修正で共通）。足りないときはエラーの文を返す
interface Profile { name: string; plan: string; weekly: number; tw: number | null; tc: number | null; td: string | null }
function readProfile(b: Record<string, unknown>): Profile | string {
  const name = String(b.name || "").trim().slice(0, 40);
  const plan = String(b.plan || "");
  const weekly = Number(b.weekly);
  if (!name || !PLANS.includes(plan) || !Number.isInteger(weekly) || weekly < 1 || weekly > 7) return "名前・プラン・週の目標を入れてください";
  const tw = numOrNull(b.targetWeight, 25, 250), tc = numOrNull(b.targetWaist, 40, 200);
  const td = /^\d{4}-\d{2}-\d{2}$/.test(String(b.targetDate)) ? String(b.targetDate) : null;
  return { name, plan, weekly, tw, tc, td };
}

// 操作：新規登録／修正／測定／体調確認済み／NTCの目的の変更／案内の記録／マイコード再発行／利用終了・再開／データ削除
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const staff = await currentStaff(request, env);
  if (staff instanceof Response) return staff;
  const b = await readJson(request);
  if (!b) return json({ error: "内容を読み取れませんでした" }, 400);
  const t = nowIso(), today = todayJst();

  if (b.action === "create") {
    // 初回：スタッフがお客様と一緒にトレッドミルで速さの基準を測定し、その数字で登録する
    const p = readProfile(b);
    if (typeof p === "string") return json({ error: p }, 400);
    const machine = String(b.machine || "");
    const fp = numOrNull(b.fast, 3, 9), wp = numOrNull(b.walk, 2, 7), hr = Number(b.hardRes || 3);
    if (!/^[A-G]$/.test(machine) || fp == null || wp == null || !Number.isInteger(hr) || hr < 1 || hr > 6) return json({ error: "マシン・速さ（ゆっくり／早歩き）・きつめの抵抗を入れてください" }, 400);
    if (wp >= fp) return json({ error: "早歩きは、ゆっくりより速い数字にしてください" }, 400);
    const track = NTC_TRACKS[String(b.track)] ? String(b.track) : "base";
    const lad: Ladder = { machine, wl: 1, wp, fp, fp0: fp, hr, hr0: hr, count: 0 };
    const sw = numOrNull(b.startWeight, 25, 250), sc = numOrNull(b.startWaist, 40, 200);
    const id = "m_" + randomToken(12);
    const code = newCode();
    const stmts = [
      env.DB.prepare(`INSERT INTO members (id, name, status, plan, weekly, lad_json, ntc_json, start_weight, start_waist, target_weight, target_waist, target_date,
        code_hash, code_at, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, p.name, p.plan, p.weekly, JSON.stringify(lad), JSON.stringify(ntcNew(track)), sw, sc, p.tw, p.tc, p.td, await codeHash(code), t, t, t),
      audit(env, staff, "create", id, p.name),
    ];
    if (sw != null || sc != null) stmts.push(env.DB.prepare("INSERT INTO measurements (member_id, date, weight, waist, created_at) VALUES (?, ?, ?, ?, ?)").bind(id, today, sw, sc, t));
    await env.DB.batch(stmts);
    return json({ ok: true, id, name: p.name, code: formatCode(code) });
  }

  if (typeof b.id !== "string") return json({ error: "対象の方を選んでください" }, 400);
  const m = await getMember(env, b.id);
  if (!m) return json({ error: "見つかりませんでした" }, 404);

  if (b.action === "edit") {
    const p = readProfile(b);
    if (typeof p === "string") return json({ error: p }, 400);
    await env.DB.batch([
      env.DB.prepare("UPDATE members SET name=?, plan=?, weekly=?, target_weight=?, target_waist=?, target_date=?, updated_at=? WHERE id=?")
        .bind(p.name, p.plan, p.weekly, p.tw, p.tc, p.td, t, m.id),
      audit(env, staff, "edit", m.id),
    ]);
    return json({ ok: true });
  }

  if (b.action === "measure") {
    const w = numOrNull(b.weight, 25, 250), c = numOrNull(b.waist, 40, 200);
    if (w == null && c == null) return json({ error: "体重（25〜250kg）かウエスト（40〜200cm）を入れてください" }, 400);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO measurements (member_id, date, weight, waist, created_at) VALUES (?, ?, ?, ?, ?)").bind(m.id, today, w, c, t),
      audit(env, staff, "measure", m.id),
    ]);
    return json({ ok: true });
  }

  if (b.action === "resolve") {
    await env.DB.batch([
      env.DB.prepare("UPDATE members SET status='active', updated_at=? WHERE id=? AND status='check'").bind(t, m.id),
      audit(env, staff, "resolve", m.id),
    ]);
    return json({ ok: true });
  }

  if (b.action === "track") {
    const track = String(b.track || "");
    if (!NTC_TRACKS[track]) return json({ error: "目的を選んでください" }, 400);
    if (ntcOf(m).track === track) return json({ ok: true });
    await env.DB.batch([
      env.DB.prepare("UPDATE members SET ntc_json=?, updated_at=? WHERE id=?").bind(JSON.stringify(ntcNew(track)), t, m.id),
      audit(env, staff, "track", m.id, track),
    ]);
    return json({ ok: true });
  }

  if (b.action === "upsell") {
    // 案内した結果を記録。プランの変更そのものは hacomono で行う（ここは表示用のプランを合わせるだけ）
    const result = b.result === "yes" ? "yes" : "no";
    const from = m.plan;
    const plan = result === "yes" && from !== "プレミアム" ? "プレミアム" : from;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO upsells (member_id, date, from_plan, result, created_at) VALUES (?, ?, ?, ?, ?)").bind(m.id, today, from, result, t),
      env.DB.prepare("UPDATE members SET upsell_at=?, plan=?, updated_at=? WHERE id=?").bind(today, plan, t, m.id),
      audit(env, staff, "upsell", m.id, result),
    ]);
    return json({ ok: true });
  }

  if (b.action === "reissue") {
    // マイコードを作り直す（前のコードとログイン中の端末は使えなくなる）
    const code = newCode();
    await env.DB.batch([
      env.DB.prepare("UPDATE members SET code_hash=?, code_at=?, updated_at=? WHERE id=?").bind(await codeHash(code), t, t, m.id),
      env.DB.prepare("DELETE FROM sessions WHERE member_id=?").bind(m.id),
      audit(env, staff, "reissue", m.id),
    ]);
    return json({ ok: true, name: m.name, code: formatCode(code) });
  }

  if (b.action === "archive" || b.action === "restore") {
    const st = b.action === "archive" ? "archived" : "active";
    const stmts = [
      env.DB.prepare("UPDATE members SET status=?, archived_at=?, updated_at=? WHERE id=?").bind(st, st === "archived" ? t : null, t, m.id),
      audit(env, staff, String(b.action), m.id),
    ];
    if (st === "archived") stmts.push(env.DB.prepare("DELETE FROM sessions WHERE member_id=?").bind(m.id));
    await env.DB.batch(stmts);
    return json({ ok: true });
  }

  if (b.action === "delete") {
    // ご本人の申し出による削除。取り消せないため、お名前の入力で確認する
    if (String(b.confirmName || "").trim() !== m.name) return json({ error: "確認のため、お名前を登録どおりに入れてください" }, 400);
    await env.DB.batch([...deleteMember(env, m.id), audit(env, staff, "delete", m.id)]);
    return json({ ok: true });
  }

  return json({ error: "操作が分かりませんでした" }, 400);
};
