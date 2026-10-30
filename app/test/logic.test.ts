// 決まり（トレッドミル・NTC・来店の集計）のテスト：npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyWalk, gapAdjust, ladderMenu, ntcAdvance, ntcNew, ntcProg, streak, hitWeeks, weekStart, lastOf, measDiff, FP_MAX, HARD_MAX, type Ladder, type NtcState } from "../src/logic.ts";

const lad = (o: Partial<Ladder> = {}): Ladder => ({ machine: "A", wl: 1, wp: 4.5, fp: 5.5, fp0: 5.5, hr: 3, hr0: 3, count: 0, ...o });

test("週の始まりは月曜日", () => {
  assert.equal(weekStart("2026-10-18"), "2026-10-12"); // 日曜
  assert.equal(weekStart("2026-10-19"), "2026-10-19"); // 月曜
});

test("楽だった → 段階が上がる。ただし最初の4回は②で止まる", () => {
  const l = lad();
  applyWalk(l, "easy", false);
  assert.equal(l.wl, 2);
  assert.equal(applyWalk(l, "easy", false), "そのまま（最初の4日は、きつめの区間を入れないため）");
  assert.equal(l.wl, 2);
  l.count = 4;
  applyWalk(l, "easy", false);
  assert.equal(l.wl, 3);
});

test("④の先は抵抗→速さの順に上がる。抵抗のないマシンは速さだけ", () => {
  const a = lad({ wl: 4, count: 10 });
  applyWalk(a, "easy", false);
  assert.equal(a.hr, 4);
  const d = lad({ machine: "E", wl: 4, count: 10 });
  applyWalk(d, "easy", false);
  assert.equal(d.hr, 3);
  assert.equal(d.fp, 5.7);
});

test("きつい・痛みあり → 1つ戻す（最初の基準より下げない）", () => {
  const l = lad({ wl: 3, count: 6 });
  applyWalk(l, "hard", false);
  assert.equal(l.wl, 2);
  const b = lad();
  assert.equal(applyWalk(b, "ok", true), "そのまま");
  assert.equal(b.wl, 1);
  assert.equal(b.fp, 5.5);
});

test("間があいたとき：14日で1つ軽く、28日で①から", () => {
  const l = lad({ wl: 3, count: 8 });
  assert.match(gapAdjust(l, "2026-10-01", "2026-10-15")!, /14日/);
  assert.equal(l.wl, 2);
  const m = lad({ wl: 4, fp: 6.1, hr: 5, count: 20 });
  gapAdjust(m, "2026-09-01", "2026-10-01");
  assert.deepEqual([m.wl, m.fp, m.hr], [1, 5.5, 3]);
  assert.equal(gapAdjust(lad(), "2026-10-10", "2026-10-15"), null);
});

test("メニューは30分（5分＋20分＋5分）", () => {
  for (const wl of [1, 2, 3, 4]) {
    const m = ladderMenu(lad({ wl }));
    const body = m.body.reps * m.body.units.reduce((a, u) => a + u.min, 0);
    assert.equal(m.warm.min + body + m.cool.min, 30, "段階" + wl);
  }
});

test("NTC：実施率70%以上で次のプログラムへ、未満ならもう1回", () => {
  const s = ntcNew("base");
  const p = ntcProg(s); // 基礎から 4週・週3回
  for (let i = 0; i < p.weeks - 1; i++) assert.equal(ntcAdvance(s, 3, "ok", false), null);
  assert.match(ntcAdvance(s, 3, "ok", false)!, /次は/);
  assert.equal(s.idx, 1);

  const t = ntcNew("base");
  for (let i = 0; i < 3; i++) ntcAdvance(t, 1, "ok", false);
  assert.match(ntcAdvance(t, 1, "ok", false)!, /もう1回/);
  assert.equal(t.idx, 0);
});

test("NTC：2週続けて0回なら短いプログラムへ。痛みありは同じ週をもう一度", () => {
  const s = ntcNew("base");
  ntcAdvance(s, 0, null, false);
  assert.match(ntcAdvance(s, 0, null, false)!, /短いプログラム/);
  assert.equal(s.track, "busy");
  const t = ntcNew("base");
  ntcAdvance(t, 2, "ok", true);
  assert.equal(t.week, 1);
});

test("連続週・目標達成週の数え方", () => {
  const v = ["2026-09-29", "2026-10-01", "2026-10-06", "2026-10-08", "2026-10-13"];
  assert.equal(streak(v, "2026-10-18"), 3);
  // 10/18（日）の「先週」は10/5の週。10/5週・9/28週とも2回 → 2週続けて達成（今週＝10/12週はまだ数えない）
  assert.equal(hitWeeks(v, 2, "2026-10-18"), 2);
  assert.equal(hitWeeks(v, 2, "2026-10-14"), 2);
  assert.equal(hitWeeks(v, 2, "2026-10-21"), 0); // 先週（10/12週）は1回
  assert.equal(hitWeeks(v, 3, "2026-10-18"), 0);
});

test("早歩きは一律8.0で止めない。安全上限（12.0km/h・D〜Gのきつめ14.0km/h・抵抗6）だけ", () => {
  for (const machine of ["A", "E"]) {
    const l = lad({ machine, wl: 4, fp: 5.5, fp0: 5.5, hr: 3, count: 10 });
    for (let i = 0; i < 200; i++) applyWalk(l, "easy", false);
    assert.equal(l.fp, FP_MAX, machine);
    assert.ok(l.hr <= 6, machine);
    const m = ladderMenu(l);
    for (const u of [m.warm, m.cool, ...m.body.units]) assert.ok(u.pace[1] <= HARD_MAX && u.pace[0] <= u.pace[1], machine + u.name);
  }
  const m = lad({ machine: "D", wl: 4, fp: 7.9, fp0: 7.9, count: 10 });
  assert.equal(applyWalk(m, "easy", false), "早歩き 7.9 → 8.1km/h");
  const top = lad({ machine: "D", wl: 4, fp: 11.9, fp0: 5.5, count: 10 });
  assert.equal(applyWalk(top, "easy", false), "早歩き 11.9 → 12.0km/h");
  assert.equal(applyWalk(top, "easy", false), "そのまま");
  assert.equal(top.fp, 12);
  // 上げすぎたら「きつい」で戻る
  applyWalk(top, "hard", false);
  assert.equal(top.fp, 11.8);
});

test("抵抗のないマシン（D〜G）で「きつい」：抵抗ではなく、メニューが変わるところを戻す", () => {
  const l = lad({ machine: "D", wl: 4, fp: 6.1, fp0: 6.1, hr: 6, hr0: 3, count: 40 });
  const before = JSON.stringify(ladderMenu(l));
  assert.match(applyWalk(l, "hard", false), /^3分早歩き＋1分きつめ ×5 → 2分/);
  assert.equal(l.wl, 3);
  assert.equal(l.hr, 6);
  assert.notEqual(JSON.stringify(ladderMenu(l)), before);
  // 抵抗のあるマシンに戻れば、抵抗から戻す
  l.machine = "A";
  applyWalk(l, "hard", false);
  assert.equal(l.hr, 5);
});

test("効果レポートの変化：体重だけ・ウエストだけの測定があっても、項目ごとに比べる", () => {
  const ms = [
    { date: "2027-12-01", weight: 70, waist: 85 },
    { date: "2027-12-20", weight: null, waist: 83.4 },
    { date: "2027-12-31", weight: 68.7, waist: null },
  ];
  const from = "2027-12-03"; // 2028-01-01 の30日前
  assert.equal(measDiff(ms, "weight", from), -1.3);
  assert.equal(measDiff(ms, "waist", from), -1.6);
  assert.equal(lastOf(ms, "waist"), 83.4);
  assert.equal(measDiff([{ date: "2028-01-01", weight: 70, waist: null }, { date: "2028-01-01", weight: 69, waist: null }], "weight", from), null); // 同じ日だけ
  assert.equal(measDiff([], "weight", from), null);
});

test("年末年始・うるう日をまたぐ日付", () => {
  assert.equal(weekStart("2028-01-01"), "2027-12-27");
  assert.equal(weekStart("2028-02-29"), "2028-02-28");
  const l = lad({ wl: 3, count: 8 });
  assert.match(gapAdjust(l, "2027-12-18", "2028-01-01")!, /14日/);
  const m = lad({ wl: 4, count: 20 });
  assert.match(gapAdjust(m, "2028-02-01", "2028-02-29")!, /28日.*①/);
  assert.equal(streak(["2027-12-30", "2028-01-03"], "2028-01-04"), 2);
});

test("28日以上あいて①に戻すときは来店日数も0に戻す（最初の4日は、きつめを入れない決まりがもう一度）", () => {
  const l = lad({ wl: 4, fp: 6.1, hr: 5, count: 20 });
  gapAdjust(l, "2026-09-01", "2026-10-01");
  assert.equal(l.count, 0);
  applyWalk(l, "easy", false); // 1日目：①→②
  assert.equal(l.wl, 2);
  for (let i = 0; i < 3; i++) assert.match(applyWalk(l, "easy", false), /最初の4日/); // 2〜4日目
  assert.equal(l.wl, 2);
  applyWalk(l, "easy", false); // 5日目で③
  assert.equal(l.wl, 3);
  // 14日では日数は戻さない
  const m = lad({ wl: 3, count: 8 });
  gapAdjust(m, "2026-10-01", "2026-10-15");
  assert.equal(m.count, 8);
});

test("来店は日ごとに数える：同じ日の2回目の報告では日数が進まず、最初の4日の決まりを飛ばさない", () => {
  const l = lad();
  for (let day = 0; day < 4; day++) {
    applyWalk(l, "easy", false);
    applyWalk(l, "easy", false, true); // プレミアムの2回目
  }
  assert.equal(l.count, 4);
  assert.equal(l.wl, 2); // 4日来ても、まだ③にならない（8回報告していても）
  applyWalk(l, "easy", false);
  assert.equal(l.wl, 3);
  assert.equal(l.count, 5);
  // 2回目でも「きつい」は戻す
  applyWalk(l, "hard", false, true);
  assert.equal(l.wl, 2);
  assert.equal(l.count, 5);
});

const finish = (s: NtcState) => { const p = ntcProg(s); let r: string | null = null; for (let i = 0; i < p.weeks; i++) r = ntcAdvance(s, p.per, "ok", false); return r!; };
test("NTC：目的の最後のプログラムを70%以上で終えたら、次の目的へ自動で（基本→走る→ケア→基本）", () => {
  const s = ntcNew("base");
  finish(s); finish(s); // 基礎から → トータル → タラ
  assert.equal(s.idx, 2);
  assert.match(finish(s), /次は ランナーのための.*「基本」を終えたので「走る・競技」へ/);
  assert.deepEqual([s.track, s.idx, s.week], ["run", 0, 1]);
  finish(s); finish(s);
  assert.match(finish(s), /次は 毎日ヨガ/);
  assert.equal(s.track, "care");
  finish(s); finish(s);
  assert.match(finish(s), /次は 基礎からはじめるフィットネス.*「基本」へ/);
  assert.deepEqual([s.track, s.idx], ["base", 0]);
  // 70%未満なら最後のプログラムをもう1回（目的は変えない）
  const t: NtcState = { ...ntcNew("base"), idx: 2 };
  for (let i = 0; i < 4; i++) ntcAdvance(t, 1, "ok", false);
  assert.deepEqual([t.track, t.idx], ["base", 2]);
});

test("NTC：「忙しい」を終えたら「基本」へ（今終えた「基礎から」は繰り返さず、その次から）", () => {
  const s = ntcNew("busy");
  finish(s); finish(s);
  assert.equal(ntcProg(s).name, "基礎からはじめるフィットネス");
  assert.match(finish(s), /次は トータル ストレングス ビルダー入門.*「忙しい」を終えたので「基本」へ/);
  assert.deepEqual([s.track, s.idx, s.week, s.zero], ["base", 1, 1, 0]);
});

test("ゆっくりと早歩きの速さが重ならない（登録の数字が近くても）", () => {
  for (const [wp, fp] of [[4.5, 5.5], [5.0, 5.3], [5.4, 5.5], [5.5, 5.5], [6, 5.5]]) {
    for (const wl of [1, 2, 3, 4]) for (const machine of ["A", "E"]) {
      const m = ladderMenu(lad({ machine, wl, wp, fp, fp0: fp }));
      const segs = [m.warm, m.cool, ...m.body.units];
      const f = segs.find((u) => u.kind === "f")!;
      for (const u of segs) {
        assert.ok(u.pace[0] <= u.pace[1], `${wp}/${fp} ${u.name}`);
        if (u.kind === "w") assert.ok(u.pace[1] < f.pace[0], `${wp}/${fp} ゆっくり${u.pace} 早歩き${f.pace}`);
      }
    }
  }
  assert.deepEqual(ladderMenu(lad({ wp: 5.2, fp: 5.5 })).warm.pace, [5.2, 5.4]);
  assert.deepEqual(ladderMenu(lad({ wp: 4.5, fp: 5.5 })).warm.pace, [4.5, 5]);
});
