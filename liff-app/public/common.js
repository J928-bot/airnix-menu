// LIFFの初期化・API呼び出し・表示部品（お客様画面・スタッフ画面で共通）
// LIFF_ID は LINE Developers で作ったLINEミニアプリのID
window.LIFF_ID = "ここにLIFF ID";

window.boot = async function () {
  await liff.init({ liffId: window.LIFF_ID });
  if (!liff.isLoggedIn()) { liff.login(); return false; }
  return true;
};

window.api = async function (path, body) {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", authorization: "Bearer " + liff.getIDToken() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "通信に失敗しました。時間をおいてもう一度お試しください");
  return data;
};

window.$ = (id) => document.getElementById(id);
window.esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
window.f1 = (n) => Number(n).toFixed(1);
window.md = (s) => (s ? Number(s.slice(5, 7)) + "/" + Number(s.slice(8, 10)) : "-");
window.sg = (v) => (v == null ? "-" : (v > 0 ? "+" : "") + v);

// ボタンの選択（chips）。onPick(value) を呼ぶ
window.chips = function (el, items, current, onPick) {
  el.innerHTML = items.map(([v, l]) => `<button type="button" data-v="${esc(v)}" aria-pressed="${String(v) === String(current)}">${esc(l)}</button>`).join("");
  [...el.children].forEach((b) => b.onclick = () => { [...el.children].forEach((x) => x.setAttribute("aria-pressed", x === b)); onPick(b.dataset.v); });
};

const COLOR = { w: "var(--walk)", f: "#fff", h: "var(--orange)" };
window.menuHTML = function (m) {
  const all = [m.warm, ...Array.from({ length: m.body.reps }).flatMap(() => m.body.units), m.cool];
  const bar = `<div class="bar">${all.map((s) => `<span style="flex:${s.min};background:${COLOR[s.kind]}"></span>`).join("")}</div>`;
  const leg = `<div class="legend"><span><i style="background:var(--walk)"></i>ゆっくり</span><span><i style="background:#fff"></i>早歩き</span><span><i style="background:var(--orange)"></i>きつめ</span></div>`;
  const p = (s) => `${f1(s.pace[0])}〜${f1(s.pace[1])}km/h${s.res != null ? `・抵抗${s.res}` : ""}`;
  const row = (t, s) => `<div class="row"><div class="t">${t}</div><div><div>${esc(s.name)} ${s.min}分</div><div class="p">${p(s)}</div></div></div>`;
  return bar + leg + `<div class="rows">${row("5分", m.warm)}${m.body.units.map((s, i) => row(i === 0 ? "×" + m.body.reps : "", s)).join("")}${row("5分", m.cool)}</div>`;
};

window.ntcHTML = function (n, title) {
  const p = n.program;
  return `<div class="ntch"><span class="ntclogo">NTC</span>${esc(title)}</div>
<h3 style="font-size:22px">${esc(p.name)}</h3>
<p class="sub">${n.week}週目／全${p.weeks}週・週${p.per}回・${esc(p.lv)}・1回${esc(p.min)}・自宅かスタジオで</p>
<a class="btn line" href="${esc(n.url)}" target="_blank" rel="noopener">NTCで開く</a>
<p class="tiny">NTC（ナイキ トレーニング クラブ・無料）が入っていないときはApp Storeが開きます。入れたあと「開く」を押すと、このプログラムに進みます。</p>`;
};

// 推移（目標線つき）
window.trendSVG = function (points, key, target, unit) {
  const pts = points.filter((p) => p[key] != null);
  if (!pts.length) return `<p class="tiny">まだ測定がありません</p>`;
  const vals = pts.map((p) => Number(p[key])).concat(target != null ? [Number(target)] : []);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1) { lo -= 0.5; hi += 0.5; }
  const W = 320, H = 100, P = 28, n = Math.max(pts.length - 1, 1);
  const x = (i) => P + (W - P * 2) * (pts.length === 1 ? 0.5 : i / n);
  const y = (v) => 12 + (H - 32) * (1 - (v - lo) / (hi - lo));
  const tg = target != null ? `<line x1="${P}" x2="${W - P}" y1="${y(target)}" y2="${y(target)}" stroke="#8e8e93" stroke-dasharray="4 4"/><text x="${W - P}" y="${y(target) - 4}" text-anchor="end" font-size="11" fill="#8e8e93">目標 ${target}${unit}</text>` : "";
  const last = pts[pts.length - 1];
  return `<svg viewBox="0 0 ${W} ${H}" width="100%">${tg}<path d="${pts.map((p, i) => (i ? "L" : "M") + x(i).toFixed(1) + "," + y(Number(p[key])).toFixed(1)).join(" ")}" fill="none" stroke="#fff" stroke-width="2"/>${pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(Number(p[key]))}" r="3" fill="#fff"/>`).join("")}<text x="${P}" y="${H - 4}" font-size="11" fill="#8e8e93">${md(pts[0].date)}</text><text x="${W - P}" y="${H - 4}" text-anchor="end" font-size="11" fill="#8e8e93">${md(last.date)}</text></svg>`;
};

// 直近30日の効果レポート
window.reportHTML = function (name, r, target, measurements) {
  const tile = (v, u, l) => `<div><b>${v}</b><span class="tiny"> ${u}</span><p class="tiny">${l}</p></div>`;
  return `<div style="height:200px;background:#000 url(/hero_run.jpg) center 30%/cover"></div>
<div class="pad" style="display:flex;justify-content:space-between;align-items:center"><span class="brand">AIRNIX</span><button class="btn line" style="width:auto;padding:6px 14px" type="button" data-close>閉じる</button></div>
<div class="pad"><p class="tiny">${md(r.from)}〜${md(r.to)}の記録</p><h2>${esc(name)}様の効果レポート</h2></div>
<div class="pad tiles">${tile(r.visits, "回", "来店")}${tile(r.km || "-", "km", "トレッドミルで歩いた距離")}${tile(r.ntc, "回", "NTC（自宅・スタジオ）")}${tile(r.asken, "日", "あすけんで食事を記録")}</div>
<div class="pad"><div class="tiles"><div><p class="tiny">体重（30日の変化）</p><b>${sg(r.dw)}</b><span> kg</span><p class="tiny">今 ${r.last?.weight ?? "-"}kg${target.weight != null ? `／目標 ${target.weight}kg` : ""}</p></div>
<div><p class="tiny">ウエスト（30日の変化）</p><b>${sg(r.dwa)}</b><span> cm</span><p class="tiny">今 ${r.last?.waist ?? "-"}cm${target.waist != null ? `／目標 ${target.waist}cm` : ""}</p></div></div></div>
<div class="pad"><p class="tiny" style="font-weight:700">ウエストの推移（入会から）</p>${trendSVG(measurements, "waist", target.waist, "cm")}</div>
${r.good.length ? `<div class="pad"><p style="font-weight:700">今月できたこと</p><p style="font-size:14px">${r.good.map(esc).join("。")}。</p></div>` : ""}
<div class="pad"><p style="font-weight:700">来月にむけて</p><p style="font-size:14px">${esc(r.next)}</p></div>
<p class="pad tiny">${r.streak}週連続で来店中。NTCは「${esc(r.ntcName)}」${r.ntcWeek}週目です。</p>
<p class="pad tiny">表示しているのはご本人の記録の数字で、効果をお約束するものではありません。</p>`;
};
window.openReport = function (html) {
  const o = $("overlay");
  o.firstElementChild.innerHTML = html;
  o.hidden = false;
  o.querySelector("[data-close]").onclick = () => (o.hidden = true);
  o.onclick = (e) => { if (e.target === o) o.hidden = true; };
};
