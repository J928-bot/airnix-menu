import { type Env, json, currentMember, todayJst, nowIso, ladderOf, ntcOf, numOrNull, POLICY_VERSION, readJson } from "../../src/lib";
import { applyWalk, gapAdjust, ntcAdvance, ntcProg, weekStart } from "../../src/logic";

// 来店時の報告：トレッドミル（楽／ちょうど／きつい）＋前回からのNTC（今週の回数・きつさ）＋痛み・体調の変化。
// 痛み・体調の変化「あり」は、メニューを1つ軽くしたうえで「体調の確認」としてスタッフ画面に出す。
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const a = await currentMember(request, env);
  if (a instanceof Response) return a;
  const m = a.m;
  if (m.consent_ver !== POLICY_VERSION) return json({ error: "先にプライバシーポリシーへの同意が必要です" }, 403);
  if (m.status === "check") return json({ error: "スタッフが体調を確認中です。確認後に次回のメニューをお届けします" }, 409);
  const b = await readJson(request);

  const today = todayJst();
  // 二重送信と、1日の上限（プレミアムは1日2回、ほかのプランは1回）
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n, MAX(created_at) AS last FROM reports WHERE member_id=? AND kind='walk' AND date=?")
    .bind(m.id, today).first<{ n: number; last: string | null }>();
  if (recent?.last && Date.now() - Date.parse(recent.last) < 10 * 60 * 1000) return json({ error: "さきほど報告を受け付けました。次回のメニューは下に出ています" }, 409);
  const perDay = m.plan === "プレミアム" ? 2 : 1;
  if ((recent?.n || 0) >= perDay) return json({ error: perDay === 2 ? "今日の報告は2回まで受け付けました" : "今日の報告は受け付けました。次回のメニューは上に出ています" }, 409);

  const l = ladderOf(m);
  const feel = ["easy", "ok", "hard"].includes(String(b?.feel)) ? String(b!.feel) : null;
  const pain = b?.pain === true;
  const machine = /^[A-G]$/.test(String(b?.machine)) ? String(b!.machine) : l.machine;
  const km = numOrNull(b?.km, 0.1, 15);
  if (!feel) return json({ error: "今日のトレーニングはどうだったか選んでください" }, 400);

  const t = nowIso();
  const notes: string[] = [];
  l.machine = machine; // 今日のマシンで軽くする（抵抗のないマシンでは抵抗を戻さない）
  const g = gapAdjust(l, m.last_date || null, today); // 前回から間があいたら先に軽くする
  if (g) notes.push(g);
  // 来店日数は1日1回だけ数える（プレミアムの同じ日の2回目は、報告は残すが日数は進めない）
  notes.push("トレッドミル：" + applyWalk(l, feel, pain, (recent?.n || 0) >= 1));

  const n = ntcOf(m);
  const stmts: D1PreparedStatement[] = [];
  // NTCは週ごとのプログラムなので、聞くのは週の最初の報告だけ（週2回以上来る方が、1週間で何週分も進んだり、2回の0回で切り替わったりしないように）
  const ntcDone = await env.DB.prepare("SELECT COUNT(*) AS n FROM reports WHERE member_id=? AND kind='ntc' AND date>=?")
    .bind(m.id, weekStart(today)).first<{ n: number }>();
  if (!ntcDone?.n && b?.ntcCount !== undefined && b?.ntcCount !== null) {
    const cnt = Number(b.ntcCount);
    const p = ntcProg(n);
    if (!Number.isInteger(cnt) || cnt < 0 || cnt > p.per) return json({ error: "NTCの回数を選んでください" }, 400);
    const nf = ["easy", "ok", "hard"].includes(String(b.ntcFeel)) ? String(b.ntcFeel) : null;
    if (cnt > 0 && !nf) return json({ error: "NTCのきつさを選んでください" }, 400);
    const ntcNote = ntcAdvance(n, cnt, nf, pain);
    notes.push("NTC：" + (ntcNote || `${ntcProg(n).name} ${n.week}週目へ`));
    stmts.push(env.DB.prepare("INSERT INTO reports (member_id, kind, date, feel, pain, ntc_count, note, created_at) VALUES (?, 'ntc', ?, ?, ?, ?, ?, ?)")
      .bind(m.id, today, nf, pain ? 1 : 0, cnt, ntcNote || "", t));
  }
  const note = notes.join("／");
  stmts.push(
    env.DB.prepare("INSERT INTO reports (member_id, kind, date, feel, pain, machine, km, note, created_at) VALUES (?, 'walk', ?, ?, ?, ?, ?, ?, ?)")
      .bind(m.id, today, feel, pain ? 1 : 0, machine, km, note, t),
    env.DB.prepare("UPDATE members SET lad_json=?, ntc_json=?, status=?, last_date=?, updated_at=? WHERE id=?")
      .bind(JSON.stringify(l), JSON.stringify(n), pain ? "check" : "active", today, t, m.id),
  );
  await env.DB.batch(stmts);
  return json({ ok: true, note, stopped: pain });
};
