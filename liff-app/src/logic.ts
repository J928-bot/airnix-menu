// 個別メニューの決まり（試作 第14版と同じ動き）。画面・サーバーの両方から読めるよう、外部に依存しない純粋な関数だけを置く。

// ---------- 日付 ----------
export const addDays = (s: string, n: number) => {
  const d = new Date(s + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);
// その週の月曜日
export const weekStart = (s: string) => {
  const dow = new Date(s + "T00:00:00Z").getUTCDay(); // 0=日
  return addDays(s, dow === 0 ? -6 : 1 - dow);
};
const r1 = (n: number) => Math.round(n * 10) / 10;

// ---------- トレッドミル（段階①〜④） ----------
// ①3分早歩き＋2分ゆっくり×4 → ②4分＋1分×4 → ③2分早歩き＋1分きつめ＋1分ゆっくり×5（4回目以降）→ ④3分早歩き＋1分きつめ×5
// ④の先：きつめの抵抗+1（最大6）→ 早歩き+0.2km/h（最大8.0）。1回に変えるのは1か所だけ。
// 抵抗のないマシン（D〜G）は、きつめを「早歩き+0.8km/h」にする。
export interface Ladder { machine: string; wl: number; wp: number; fp: number; fp0: number; hr: number; hr0: number; count: number }
export interface Seg { min: number; kind: "w" | "f" | "h"; name: string; pace: [number, number]; res: number | null }
export const STAGES = [
  "3分早歩き＋2分ゆっくり ×4",
  "4分早歩き＋1分ゆっくり ×4",
  "2分早歩き＋1分きつめ＋1分ゆっくり ×5",
  "3分早歩き＋1分きつめ ×5",
];
export const hasRes = (machine: string) => /^[ABC]$/.test(machine);

export function ladderMenu(l: Ladder): { warm: Seg; body: { reps: number; units: Seg[] }; cool: Seg } {
  const res = hasRes(l.machine);
  const W = (min: number): Seg => ({ min, kind: "w", name: "ゆっくり", pace: [l.wp, r1(l.wp + 0.5)], res: res ? 1 : null });
  const F = (min: number): Seg => ({ min, kind: "f", name: "早歩き", pace: [l.fp, r1(l.fp + 0.5)], res: res ? 1 : null });
  const H = (min: number): Seg => res
    ? { min, kind: "h", name: "きつめ", pace: [Math.max(3, r1(l.fp - 1.3)), Math.max(3.5, r1(l.fp - 0.7))], res: l.hr }
    : { min, kind: "h", name: "きつめ", pace: [r1(l.fp + 0.8), r1(l.fp + 1.3)], res: null };
  const body = l.wl === 1 ? { reps: 4, units: [F(3), W(2)] }
    : l.wl === 2 ? { reps: 4, units: [F(4), W(1)] }
    : l.wl === 3 ? { reps: 5, units: [F(2), H(1), W(1)] }
    : { reps: 5, units: [F(3), H(1)] };
  return { warm: { ...W(5), name: "ウォーミングアップ" }, body, cool: { ...W(5), name: "クールダウン" } };
}

const fmtStage = (wl: number) => STAGES[wl - 1];
export function stepUp(l: Ladder): string | null {
  if (l.wl === 2 && l.count < 4) return null; // 最初の4回は、きつめの区間を入れない
  if (l.wl < 4) { const a = fmtStage(l.wl); l.wl++; return `${a} → ${fmtStage(l.wl)}`; }
  if (hasRes(l.machine) && l.hr < 6) { l.hr++; return `きつめの抵抗 ${l.hr - 1} → ${l.hr}`; }
  if (l.fp < 8) { const a = l.fp; l.fp = r1(l.fp + 0.2); return `早歩き ${a.toFixed(1)} → ${l.fp.toFixed(1)}km/h`; }
  return null;
}
export function stepDown(l: Ladder): string | null {
  if (l.fp > l.fp0) { const a = l.fp; l.fp = r1(Math.max(l.fp0, l.fp - 0.2)); return `早歩き ${a.toFixed(1)} → ${l.fp.toFixed(1)}km/h`; }
  if (l.hr > l.hr0) { l.hr--; return `きつめの抵抗 ${l.hr + 1} → ${l.hr}`; }
  if (l.wl > 1) { const a = fmtStage(l.wl); l.wl--; return `${a} → ${fmtStage(l.wl)}`; }
  return null;
}
// 間があいたとき：14日以上で1つ軽く、28日以上で①から
export function gapAdjust(l: Ladder, lastDate: string | null, today: string): string | null {
  if (!lastDate) return null;
  const gap = daysBetween(lastDate, today);
  if (gap >= 28) { l.wl = 1; l.fp = l.fp0; l.hr = l.hr0; return `前回から${gap}日あいたため、段階①から再開`; }
  if (gap >= 14) { const c = stepDown(l); return c ? `前回から${gap}日あいたため1つ軽く（${c}）` : null; }
  return null;
}
// 報告：楽→1つ上げる／ちょうど→そのまま／きつい・痛みあり→1つ戻す
export function applyWalk(l: Ladder, feel: string, pain: boolean): string {
  let c: string | null = null;
  if (pain || feel === "hard") c = stepDown(l);
  else if (feel === "easy") c = stepUp(l);
  l.count++;
  if (c) return c;
  if (feel === "easy") return "そのまま（最初の4回は、きつめの区間を入れないため）";
  return "そのまま";
}

// ---------- NTC（ナイキ トレーニング クラブ） ----------
// 2026-10-05 ジェイさんのiPhoneで確認したプログラム。url はシェアのリンク（開くとNTCのそのプログラムに直接飛ぶ）
export const NTC_URL = "https://niketrainingclub.sng.link/Ara19/x5kn/";
export interface Program { name: string; weeks: number; per: number; lv: string; min: string; url: string }
export const NTC_PROGRAMS: Record<string, Program> = {
  kiso:    { name: "基礎からはじめるフィットネス", weeks: 4, per: 3, lv: "初級", min: "5〜30分", url: "r_a919bb118a" },
  total:   { name: "トータル ストレングス ビルダー入門", weeks: 5, per: 2, lv: "初級", min: "5〜30分", url: "r_b380396fdf" },
  tara:    { name: "タラと一緒にHIIT＆筋力トレーニング", weeks: 4, per: 3, lv: "初級", min: "5〜30分", url: "r_9ef3601455" },
  runner:  { name: "ランナーのための筋力強化とコンディショニング", weeks: 4, per: 3, lv: "すべてのレベル", min: "5〜23分", url: "r_e7caf41f08" },
  core:    { name: "コアを鍛える2週間", weeks: 2, per: 3, lv: "初級", min: "5〜25分", url: "r_bf7fc956e3" },
  daily:   { name: "毎日の運動チャレンジ", weeks: 1, per: 7, lv: "初級", min: "5〜10分", url: "r_04aaa21a13" },
  kimochi: { name: "気持ちよく続けるフィットネス", weeks: 2, per: 3, lv: "すべてのレベル", min: "5〜20分", url: "r_37d452cd76" },
  yoga:    { name: "毎日ヨガ", weeks: 1, per: 5, lv: "初級", min: "10〜30分", url: "r_68846ad39c" },
  vinyasa: { name: "ヴィンヤサ入門", weeks: 2, per: 3, lv: "初級", min: "10〜20分", url: "r_c795d342ae" },
  sochiru: { name: "ソーチールと一緒にヨガ", weeks: 2, per: 3, lv: "初級から中級", min: "5〜30分", url: "r_198f0211ba" },
};
export const NTC_TRACKS: Record<string, { label: string; list: string[] }> = {
  base: { label: "基本", list: ["kiso", "total", "tara"] },
  run:  { label: "走る・競技", list: ["runner", "core", "total"] },
  busy: { label: "忙しい", list: ["daily", "kimochi", "kiso"] },
  care: { label: "体のケア", list: ["yoga", "vinyasa", "sochiru"] },
};
export interface NtcState { track: string; idx: number; week: number; done: number[]; hard: number; zero: number }
export const ntcNew = (track: string): NtcState => ({ track: NTC_TRACKS[track] ? track : "base", idx: 0, week: 1, done: [], hard: 0, zero: 0 });
export const ntcProg = (s: NtcState) => NTC_PROGRAMS[NTC_TRACKS[s.track].list[s.idx]];

// 来店時の報告（今週の回数・きつさ）で次の週を決める。変更がなければ null
export function ntcAdvance(s: NtcState, count: number, feel: string | null, pain: boolean): string | null {
  if (pain) return "痛み・体調の変化があったため、今週のNTCはお休みして同じ週をもう一度";
  const p = ntcProg(s);
  s.done.push(count);
  if (feel === "hard") s.hard++;
  s.zero = count === 0 ? s.zero + 1 : 0;
  if (s.zero >= 2 && s.track !== "busy") {
    const from = p.name;
    Object.assign(s, ntcNew("busy"));
    return `2週続けてできなかったため、短いプログラムに切り替え：${from} → ${ntcProg(s).name}`;
  }
  s.week++;
  if (s.week <= p.weeks) return null;
  const rate = s.done.reduce((a, b) => a + b, 0) / (p.per * p.weeks);
  const list = NTC_TRACKS[s.track].list;
  const ok = rate >= 0.7 && s.hard * 2 <= p.weeks;
  const from = p.name;
  if (ok && s.idx < list.length - 1) s.idx++;
  Object.assign(s, { week: 1, done: [], hard: 0 });
  const pct = Math.round(Math.min(rate, 1) * 100);
  if (ok && ntcProg(s).name !== from) return `${from}が終了（実施率${pct}%）→ 次は ${ntcProg(s).name}`;
  return `${from}が終了（実施率${pct}%${ok ? "" : "・70%未満か、きつい週が多め"}）→ もう1回`;
}

// ---------- 来店の集計 ----------
export const weekCount = (visits: string[], ws: string) => {
  const we = addDays(ws, 6);
  return visits.filter((d) => d >= ws && d <= we).length;
};
// 週1回以上の来店が何週続いているか（今週は来ていれば数える）
export function streak(visits: string[], today: string) {
  let ws = weekStart(today), n = 0;
  if (weekCount(visits, ws) > 0) n = 1;
  ws = addDays(ws, -7);
  while (weekCount(visits, ws) > 0) { n++; ws = addDays(ws, -7); }
  return n;
}
// 週の目標回数を何週続けて達成したか（先週から数える）
export function hitWeeks(visits: string[], weekly: number, today: string) {
  let ws = addDays(weekStart(today), -7), n = 0;
  while (weekCount(visits, ws) >= weekly) { n++; ws = addDays(ws, -7); }
  return n;
}

// ---------- 上位プラン・スタジオの案内（料金は正本 airnix_store_rules.md 用賀キャンペーン 2026-04〜） ----------
export const UPSELL: Record<string, { to: string; say: string }> = {
  "ライト": { to: "プレミアム（9,800円・1日2回）", say: "このペースで続けていらっしゃるので、1日2回使えるプレミアムにすると、トレッドミルとスタジオを同じ日に組めます。" },
  "メイン": { to: "プレミアム（9,800円・1日2回）", say: "結果が数字に出てきているので、1日2回使えるプレミアムにすると、トレッドミルのあとにスタジオでNTCまで続けてできます。" },
  "プレミアム": { to: "スタジオのセルフトレーニング（料金は未定）", say: "NTCのメニューを、スタジオで集中してやってみませんか。仕切られたスペースで、画面を見ながらできます。" },
};
