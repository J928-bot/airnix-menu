// API呼び出し・表示部品（お客様画面・スタッフ画面で共通）
const OFFLINE_MSG = "インターネットにつながっていません。電波の良いところでもう一度お試しください";
window.api = async function (path, body, method) {
  if (navigator.onLine === false) throw new Error(OFFLINE_MSG);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000); // 20秒で打ち切る（固まったままにしない）
  let res;
  try {
    res = await fetch(path, {
      method: method || (body ? "POST" : "GET"),
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
      signal: ctl.signal,
    });
  } catch {
    throw new Error(ctl.signal.aborted ? "時間がかかっています。電波の良いところでもう一度お試しください" : "通信できませんでした。電波の良いところでもう一度お試しください");
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || "うまく処理できませんでした。時間をおいてもう一度お試しください");
    e.login = !!data.login;
    e.status = res.status;
    throw e;
  }
  return data;
};

// ボタンを押している間は押せなくし、「…」を出す（二重送信の防止）
window.busy = async function (btn, fn) {
  if (!btn || btn.dataset.busy) return;
  const label = btn.textContent;
  btn.dataset.busy = "1"; btn.disabled = true; btn.setAttribute("aria-busy", "true");
  btn.textContent = "送信中…";
  try { return await fn(); }
  finally { delete btn.dataset.busy; btn.disabled = false; btn.removeAttribute("aria-busy"); if (btn.isConnected) btn.textContent = label; }
};

// 圏外のお知らせ（画面の上に出す）
(function () {
  const bar = document.createElement("div");
  bar.className = "offline"; bar.setAttribute("role", "status"); bar.textContent = "インターネットにつながっていません"; bar.hidden = navigator.onLine !== false;
  const add = () => document.body.prepend(bar);
  if (document.body) add(); else document.addEventListener("DOMContentLoaded", add);
  addEventListener("offline", () => (bar.hidden = false));
  addEventListener("online", () => (bar.hidden = true));
})();

window.$ = (id) => document.getElementById(id);
window.esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
window.f1 = (n) => Number(n).toFixed(1);
window.md = (s) => (s ? Number(s.slice(5, 7)) + "/" + Number(s.slice(8, 10)) : "-");
window.sg = (v) => (v == null ? "-" : (v > 0 ? "+" : "") + v);

// ボタンの選択（chips）。onPick(value) を呼ぶ
window.chips = function (el, items, current, onPick) {
  if (!el.getAttribute("role")) el.setAttribute("role", "group");
  el.innerHTML = items.map(([v, l]) => `<button type="button" data-v="${esc(v)}" aria-pressed="${String(v) === String(current)}">${esc(l)}</button>`).join("");
  [...el.children].forEach((b) => b.onclick = () => {
    if (el.dataset.locked) return;
    [...el.children].forEach((x) => x.setAttribute("aria-pressed", x === b));
    onPick(b.dataset.v);
  });
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
<h3>${esc(p.name)}</h3>
<p class="sub">${n.week}週目／全${p.weeks}週・週${p.per}回・${esc(p.lv)}・1回${esc(p.min)}・自宅かスタジオで</p>
<a class="btn white" href="${esc(n.url)}" target="_blank" rel="noopener">NTCで開く</a>
<p class="tiny">NTC（ナイキ トレーニング クラブ・無料）が入っていないときはアプリのストア（iPhoneはApp Store、AndroidはGoogle Play）が開きます。入れたあと「開く」を押すと、このプログラムに進みます。</p>`;
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
  const tg = target != null ? `<line x1="${P}" x2="${W - P}" y1="${y(target)}" y2="${y(target)}" stroke="#a3abc8" stroke-dasharray="4 4"/><text x="${W - P}" y="${y(target) - 4}" text-anchor="end" font-size="11" fill="#a3abc8">目標 ${target}${unit}</text>` : "";
  const last = pts[pts.length - 1];
  return `<svg viewBox="0 0 ${W} ${H}" width="100%">${tg}<path d="${pts.map((p, i) => (i ? "L" : "M") + x(i).toFixed(1) + "," + y(Number(p[key])).toFixed(1)).join(" ")}" fill="none" stroke="#5fe3b8" stroke-width="2.5"/>${pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(Number(p[key]))}" r="3.5" fill="#5fe3b8"/>`).join("")}<text x="${P}" y="${H - 4}" font-size="11" fill="#a3abc8">${md(pts[0].date)}</text><text x="${W - P}" y="${H - 4}" text-anchor="end" font-size="11" fill="#a3abc8">${md(last.date)}</text></svg>`;
};

// 直近30日の効果レポート
window.reportHTML = function (name, r, target, measurements) {
  const tile = (v, u, l) => `<div><span class="l">${l}</span><b>${v}<small>${u}</small></b></div>`;
  return `<div style="height:180px;background:linear-gradient(180deg,rgba(22,28,56,.45),rgba(22,28,56,.9)),url(/hero_run.jpg) center 30%/cover" aria-hidden="true"></div>
<div class="pad" style="display:flex;justify-content:space-between;align-items:center"><img class="logo" src="/logo.png" alt="AIRNIX"><button class="btn line small" type="button" data-close>閉じる</button></div>
<div class="pad"><p class="tiny">${md(r.from)}〜${md(r.to)}の記録</p><h2>${esc(name)}様の効果レポート</h2></div>
<div class="pad tiles">${tile(r.visits, "回", "来店")}${tile(r.km || "-", "km", "トレッドミルで歩いた距離")}${tile(r.ntc, "回", "NTC（自宅・スタジオ）")}${tile(r.asken, "日", "あすけんで食事を記録")}</div>
<div class="pad"><div class="tiles"><div><span class="l">体重（30日の変化）</span><b>${sg(r.dw)}<small>kg</small></b><p class="tiny">今 ${r.last?.weight ?? "-"}kg${target.weight != null ? `／目標 ${target.weight}kg` : ""}</p></div>
<div><span class="l">ウエスト（30日の変化）</span><b>${sg(r.dwa)}<small>cm</small></b><p class="tiny">今 ${r.last?.waist ?? "-"}cm${target.waist != null ? `／目標 ${target.waist}cm` : ""}</p></div></div></div>
<div class="pad"><p class="tiny" style="font-weight:700">ウエストの推移（入会から）</p>${trendSVG(measurements, "waist", target.waist, "cm")}</div>
${r.good.length ? `<div class="pad"><p class="band" style="font-size:15px;margin-bottom:10px">今月できたこと</p><p style="font-size:14px">${r.good.map(esc).join("。")}。</p></div>` : ""}
<div class="pad"><p class="band soft" style="font-size:15px;margin-bottom:10px">来月にむけて</p><p style="font-size:14px">${esc(r.next)}</p></div>
<p class="pad tiny">${r.streak}週連続で来店中。NTCは「${esc(r.ntcName)}」${r.ntcWeek}週目です。</p>
<p class="pad tiny">表示しているのはご本人の記録の数字で、効果をお約束するものではありません。</p>`;
};
// 重ねて出す画面（効果レポート・登録フォーム・確認）。Escで閉じる・閉じたら元のボタンへ戻る
let lastFocus = null;
window.closeOverlay = function () {
  const o = $("overlay");
  if (o.hidden) return;
  o.hidden = true;
  document.body.classList.remove("noscroll");
  if (o._onClose) { const f = o._onClose; o._onClose = null; f(); }
  if (lastFocus && lastFocus.isConnected) lastFocus.focus();
};
window.openReport = function (html, opt = {}) {
  const o = $("overlay"), box = o.firstElementChild;
  if (o.hidden) lastFocus = document.activeElement;
  box.innerHTML = html;
  box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.tabIndex = -1;
  const h = box.querySelector("h2,h3");
  if (h) { h.id = h.id || "dlgTitle"; box.setAttribute("aria-labelledby", h.id); }
  o.hidden = false;
  document.body.classList.add("noscroll");
  o.scrollTop = 0;
  box.querySelectorAll("[data-close]").forEach((b) => (b.onclick = closeOverlay));
  o.onclick = opt.sticky ? null : (e) => { if (e.target === o) closeOverlay(); };
  o._sticky = !!opt.sticky;
  box.focus();
};
document.addEventListener("keydown", (e) => {
  const o = $("overlay");
  if (e.key === "Escape" && o && !o.hidden && !o._sticky) closeOverlay();
});

// 確認（confirm の代わり。アプリ内のブラウザでは confirm が出ないことがあるため、画面の中に出す）
window.ask = function (msg, okLabel = "はい", danger = false) {
  return new Promise((resolve) => {
    openReport(`<div class="pad" style="padding-top:22px;display:flex;flex-direction:column;gap:16px">
<h3>確認</h3><p style="white-space:pre-wrap">${esc(msg)}</p>
<button class="btn ${danger ? "danger" : ""}" type="button" data-ok>${esc(okLabel)}</button>
<button class="btn line" type="button" data-close>やめる</button></div>`);
    const o = $("overlay");
    let ok = false;
    o._onClose = () => resolve(ok);
    o.querySelector("[data-ok]").onclick = () => { ok = true; closeOverlay(); };
  });
};
