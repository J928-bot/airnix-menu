import { type Env, json, verifyLine, todayJst, nowIso, getMember, ladderOf, ntcOf, numOrNull } from "../../src/lib";
import { applyWalk, gapAdjust, ntcAdvance, ntcProg } from "../../src/logic";

// 来店時の報告：トレッドミル（楽／ちょうど／きつい）＋前回からのNTC（今週の回数・きつさ）＋痛み・体調の変化。
// 痛み・体調の変化「あり」は、メニューを1つ軽くしたうえで「体調の確認」としてスタッフ画面に出す。
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const me = await verifyLine(request, env);
  if (!me) return json({ error: "LINEのログインを確認できませんでした" }, 401);
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const m = await getMember(env, me.userId);
  if (!m || m.status === "pending") return json({ error: "まだ登録されていません。スタッフにお声がけください" }, 403);
  if (m.status === "check") return json({ error: "スタッフが体調を確認中です。確認後に次回のメニューをお届けします" }, 409);
  const l = ladderOf(m);
  if (!l) return json({ error: "メニューがまだ登録されていません。スタッフにお声がけください" }, 409);

  const feel = ["easy", "ok", "hard"].includes(String(b?.feel)) ? String(b!.feel) : null;
  const pain = b?.pain === true;
  const machine = /^[A-G]$/.test(String(b?.machine)) ? String(b!.machine) : l.machine;
  const km = numOrNull(b?.km, 0.1, 15);
  if (!feel) return json({ error: "今日のトレーニングはどうだったか選んでください" }, 400);

  const today = todayJst();
  const t = nowIso();
  const notes: string[] = [];
  // 前回から間があいたら先に軽くする
  const g = gapAdjust(l, (m.last_date as string) || null, today);
  if (g) notes.push(g);
  if (machine !== l.machine) { l.machine = machine; }
  notes.push("トレッドミル：" + applyWalk(l, feel, pain));

  // NTC（2回目の来店から）
  const n = ntcOf(m);
  let ntcNote: string | null = null;
  const stmts: D1PreparedStatement[] = [];
  const hasNtc = b?.ntcCount !== undefined && b?.ntcCount !== null;
  if (hasNtc) {
    const cnt = Number(b!.ntcCount);
    const p = ntcProg(n);
    if (!Number.isInteger(cnt) || cnt < 0 || cnt > p.per) return json({ error: "NTCの回数を選んでください" }, 400);
    const nf = ["easy", "ok", "hard"].includes(String(b!.ntcFeel)) ? String(b!.ntcFeel) : null;
    if (cnt > 0 && !nf) return json({ error: "NTCのきつさを選んでください" }, 400);
    ntcNote = ntcAdvance(n, cnt, nf, pain);
    notes.push("NTC：" + (ntcNote || `${ntcProg(n).name} ${n.week}週目へ`));
    stmts.push(env.DB.prepare("INSERT INTO reports (line_user_id, kind, date, feel, pain, ntc_count, note, created_at) VALUES (?, 'ntc', ?, ?, ?, ?, ?, ?)")
      .bind(me.userId, today, nf, pain ? 1 : 0, cnt, ntcNote || "", t));
  }
  const note = notes.join("／");
  stmts.push(
    env.DB.prepare("INSERT INTO reports (line_user_id, kind, date, feel, pain, machine, km, note, created_at) VALUES (?, 'walk', ?, ?, ?, ?, ?, ?, ?)")
      .bind(me.userId, today, feel, pain ? 1 : 0, machine, km, note, t),
    env.DB.prepare("UPDATE members SET lad_json=?, ntc_json=?, status=?, last_date=?, updated_at=? WHERE line_user_id=?")
      .bind(JSON.stringify(l), JSON.stringify(n), pain ? "check" : "active", today, t, me.userId),
  );
  await env.DB.batch(stmts);
  return json({ ok: true, note, stopped: pain });
};
