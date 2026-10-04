// LIFFの初期化とAPI呼び出し（お客様画面・スタッフ画面で共通）
// LIFF_ID は LINE Developers で作ったLIFFアプリのID
window.LIFF_ID = "ここにLIFF ID";

window.boot = async function () {
  await liff.init({ liffId: window.LIFF_ID });
  if (!liff.isLoggedIn()) { liff.login(); return false; }
  return true;
};

window.api = async function (path, opts = {}) {
  const token = liff.getIDToken();
  const res = await fetch(path, {
    ...opts,
    headers: { "content-type": "application/json", authorization: "Bearer " + token, ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "通信に失敗しました。時間をおいてもう一度お試しください");
  return data;
};

window.esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
window.f1 = (n) => Number(n).toFixed(1);

window.strengthHTML = function (s) {
  return `<div class="menu"><header><span>筋トレメニュー（段階${s.level}）</span><span>休憩${s.restSec}秒</span></header><table><tbody>${s.items
    .map((x) => `<tr><td>${x.sets}セット</td><td>${esc(x.name)}${x.note ? `<div class="meta">${esc(x.note)}</div>` : ""}</td><td>${x.reps ? x.reps + "回" : x.seconds + "秒"}</td></tr>`)
    .join("")}</tbody></table></div>`;
};

// 体重・ウエストの推移（目標線つき）を小さなSVGで描く
window.trendSVG = function (points, key, target, unit) {
  const pts = points.filter((p) => p[key] != null);
  if (pts.length < 1) return `<p class="sub">まだ測定がありません</p>`;
  const vals = pts.map((p) => Number(p[key])).concat(target != null ? [Number(target)] : []);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1) { lo -= 0.5; hi += 0.5; }
  const W = 320, H = 110, P = 28, n = Math.max(pts.length - 1, 1);
  const x = (i) => P + ((W - P * 2) * (pts.length === 1 ? 0.5 : i / n));
  const y = (v) => 10 + (H - 30) * (1 - (v - lo) / (hi - lo));
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(Number(p[key])).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  const tgt = target != null ? `<line x1="${P}" x2="${W - P}" y1="${y(Number(target))}" y2="${y(Number(target))}" stroke="var(--ok)" stroke-dasharray="4 4"/><text x="${W - P}" y="${y(Number(target)) - 4}" text-anchor="end" font-size="11" fill="var(--ok)">目標 ${target}${unit}</text>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${key}の推移">${tgt}<path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2"/>${pts
    .map((p, i) => `<circle cx="${x(i)}" cy="${y(Number(p[key]))}" r="3" fill="var(--accent)"/>`).join("")}<text x="${x(pts.length - 1)}" y="${y(Number(last[key])) - 8}" text-anchor="middle" font-size="12" font-weight="700" fill="var(--ink)">${last[key]}${unit}</text><text x="${P}" y="${H - 4}" font-size="11" fill="var(--sub)">${pts[0].date.slice(5).replace("-", "/")}</text><text x="${W - P}" y="${H - 4}" text-anchor="end" font-size="11" fill="var(--sub)">${last.date.slice(5).replace("-", "/")}</text></svg>`;
};

window.menuHTML = function (no, m, final) {
  const r = /^[ABC]$/.test(m.machine);
  const total = m.segments.reduce((a, x) => a + x.min, 0);
  return `<div class="menu"><header><span>${final ? "最終回メニュー" : no + "回目メニュー"}</span><span>マシン${esc(m.machine)}</span></header><table><tbody>${m.segments
    .map((x) => `<tr><td>${x.min}分</td><td>${esc(x.action)}</td><td>${f1(x.pace[0])}〜${f1(x.pace[1])}km/h</td>${r ? `<td>抵抗${x.resistance}</td>` : ""}</tr>`)
    .join("")}</tbody><tfoot><tr><td colspan="${r ? 4 : 3}">合計${total}分</td></tr></tfoot></table></div>`;
};
