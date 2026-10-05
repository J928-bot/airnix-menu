// NTC（ナイキ トレーニング クラブ）のプログラム。2026-10-05 ジェイさんのiPhoneで確認した内容
const NTC_URL = "https://niketrainingclub.sng.link/Ara19/x5kn/";
const NTC_PROGRAMS = {
  kiso:    { name: "基礎からはじめるフィットネス", weeks: 4, per: 3, lv: "初級", min: "5〜30分", url: "r_a919bb118a" },
  total:   { name: "トータル ストレングス ビルダー入門", weeks: 5, per: 2, lv: "初級", min: "5〜30分", url: "r_b380396fdf" },
  tara:    { name: "タラと一緒にHIIT＆筋力トレーニング", weeks: 4, per: 3, lv: "初級", min: "5〜30分", url: "r_9ef3601455" },
  runner:  { name: "ランナーのための筋力強化とコンディショニング", weeks: 4, per: 3, lv: "すべてのレベル", min: "5〜23分", url: "r_e7caf41f08" },
  core:    { name: "コアを鍛える2週間", weeks: 2, per: 3, lv: "初級", min: "5〜25分", url: "r_bf7fc956e3" },
  daily:   { name: "毎日の運動チャレンジ", weeks: 1, per: 7, lv: "初級", min: "5〜10分", url: "r_04aaa21a13" },
  kimochi: { name: "気持ちよく続けるフィットネス", weeks: 2, per: 3, lv: "すべてのレベル", min: "5〜20分", url: "r_37d452cd76" },
  yoga:    { name: "毎日ヨガ", weeks: 1, per: 5, lv: "初級", min: "10〜30分", url: "r_68846ad39c" },
  vinyasa: { name: "ヴィンヤサ入門", weeks: 2, per: 3, lv: "初級", min: "10〜20分", url: "r_c795d342ae" },
  sochiru: { name: "ソーチールと一緒にヨガ", weeks: 2, per: 3, lv: "初級から中級", min: "5〜30分", url: "r_198f0211ba" }
};
// 目的ごとの順番。最後まで終えたら最後のプログラムを続ける
const NTC_TRACKS = {
  base: { label: "基本", list: ["kiso", "total", "tara"] },
  run:  { label: "走る・競技", list: ["runner", "core", "total"] },
  busy: { label: "忙しい", list: ["daily", "kimochi", "kiso"] },
  care: { label: "体のケア", list: ["yoga", "vinyasa", "sochiru"] }
};
const ntcNew = track => ({ track, idx: 0, week: 1, done: [], hard: 0, zero: 0 });
const ntcProg = s => NTC_PROGRAMS[NTC_TRACKS[s.track].list[s.idx]];

// 来店時の報告（今週の回数・きつさ）で、次の週を決める。戻り値は変更内容の説明（変更なしは null）
function ntcAdvance(s, count, feel, pain) {
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

function ntcCardHTML(s, title) {
  const p = ntcProg(s);
  return `<div class="ntcbox"><p class="ntch"><span class="ntclogo">NTC</span>${title}</p>
<p class="ntcn">${p.name}</p>
<p class="ntcp">${s.week}週目／全${p.weeks}週・週${p.per}回・${p.lv}・1回${p.min}</p>
<a class="ntcopen" href="${NTC_URL + p.url}" target="_blank" rel="noopener">NTCで開く</a>
<p class="ntcp">NTCが入っていないときはApp Storeが開きます。入れたあと「開く」を押すと、このプログラムに進みます。</p></div>`;
}
