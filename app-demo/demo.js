// デモ用：サーバーの代わりに見本データで動かす（実際の会員データは使っていない）
(function () {
  const r1 = (n) => Math.round(n * 10) / 10;
  const hasRes = (m) => /^[ABC]$/.test(m);
  function ladderMenu(l) {
    const res = hasRes(l.machine);
    const wHi = r1(Math.min(l.wp + 0.5, l.fp - 0.1)), wLo = Math.min(l.wp, wHi);
    const W = (min) => ({ min, kind: "w", name: "ゆっくり", pace: [wLo, wHi], res: res ? 1 : null });
    const F = (min) => ({ min, kind: "f", name: "早歩き", pace: [l.fp, r1(Math.max(l.fp, Math.min(12, l.fp + 0.5)))], res: res ? 1 : null });
    const H = (min) => res
      ? { min, kind: "h", name: "きつめ", pace: [Math.max(3, r1(l.fp - 1.3)), Math.max(3.5, r1(l.fp - 0.7))], res: Math.min(6, l.hr) }
      : { min, kind: "h", name: "きつめ", pace: [r1(Math.min(13.5, l.fp + 0.8)), r1(Math.min(14, l.fp + 1.3))], res: null };
    const body = l.wl === 1 ? { reps: 4, units: [F(3), W(2)] }
      : l.wl === 2 ? { reps: 4, units: [F(4), W(1)] }
      : l.wl === 3 ? { reps: 5, units: [F(2), H(1), W(1)] }
      : { reps: 5, units: [F(3), H(1)] };
    return { warm: { ...W(5), name: "ウォーミングアップ" }, body, cool: { ...W(5), name: "クールダウン" } };
  }
  const iso = (d) => d.toISOString().slice(0, 10);
  const today = iso(new Date(Date.now() + 9 * 3600e3));
  const ago = (n) => iso(new Date(Date.parse(today) - n * 864e5));
  const S = {
    logged: false, consent: false,
    ladder: { wl: 2, machine: "B", wp: 4.0, fp: 5.6, hr: 3, count: 7 },
    visits: [ago(27), ago(25), ago(20), ago(18), ago(13), ago(11), ago(6), ago(4)],
    meas: [{ date: ago(28), weight: 62.4, waist: 78.0 }, { date: ago(14), weight: 61.8, waist: 77.0 }, { date: ago(4), weight: 61.1, waist: 76.2 }],
    asken: null, note: "前回「楽だった」ので、早歩きを0.2km/h上げました", reportedToday: false,
  };
  const prog = { name: "基礎からはじめるフィットネス", weeks: 4, per: 3, lv: "初級", min: "5〜30分", url: "r_a919bb118a" };
  function me() {
    if (!S.consent) return { needConsent: true, name: "見本 花子" };
    return {
      status: "ok", name: "見本 花子", plan: "メイン", weekly: 2, count: S.ladder.count,
      ladder: S.ladder, menu: ladderMenu(S.ladder),
      ntc: { track: "base", idx: 0, week: 2, done: [2], hard: 0, zero: 0, program: prog, url: "https://niketrainingclub.sng.link/Ara19/x5kn/" + prog.url },
      target: { startWeight: 62.4, startWaist: 78.0, weight: 58.0, waist: 72.0, date: ago(-150) },
      measurements: S.meas, visits: S.visits, askenThisWeek: S.asken,
      report: { from: ago(30), to: today, visits: S.visits.length, km: 19.6, ntc: 5, asken: 12, dw: -1.3, dwa: -1.8, last: S.meas[S.meas.length - 1],
        good: ["週2回の来店を4週続けられました", "ウエストが1.8cm細くなりました"], next: "早歩きを少しずつ上げていきます。NTCは週3回を目標に続けましょう",
        streak: 4, ntcName: prog.name, ntcWeek: 2 },
      lastNote: S.note, reportedToday: S.reportedToday, ntcAsk: !S.reportedToday, today,
    };
  }
  const wait = (v) => new Promise((r) => setTimeout(() => r(v), 250));
  window.api = async function (path, body) {
    if (path === "/api/login") { S.logged = true; return wait({ ok: true }); }
    if (path === "/api/logout") { S.logged = false; return wait({ ok: true }); }
    if (path === "/api/consent") { S.consent = true; return wait({ ok: true }); }
    if (path === "/api/asken") { S.asken = body.days; return wait({ ok: true }); }
    if (path === "/api/me") {
      if (!S.logged) { const e = new Error("ログインしてください"); e.login = true; throw e; }
      return wait(me());
    }
    if (path === "/api/report") {
      S.reportedToday = true; S.visits = [...S.visits, today]; S.ladder = { ...S.ladder, count: S.ladder.count + 1, machine: body.machine };
      if (body.feel === "easy") { S.ladder.fp = r1(S.ladder.fp + 0.2); S.note = "前回「楽だった」ので、早歩きを0.2km/h上げました"; }
      else if (body.feel === "hard") { S.ladder.fp = r1(Math.max(3.5, S.ladder.fp - 0.2)); S.note = "前回「きつかった」ので、早歩きを0.2km/h下げました"; }
      else S.note = "前回「ちょうど」だったので、同じ内容で続けます";
      if (body.pain) S.note = "痛み・体調の変化のご報告があったため、スタッフが確認します";
      return wait({ ok: true });
    }
    throw new Error("デモでは使えない機能です");
  };
  // デモの表示
  const tag = document.createElement("div");
  tag.textContent = "デモ（見本データ）マイコードは英数字8文字なら何でも入れられます";
  tag.style.cssText = "position:sticky;top:0;z-index:50;background:#5fe3b8;color:#161c38;font:700 12px/1.6 sans-serif;text-align:center;padding:6px 10px";
  document.body.prepend(tag);
})();
