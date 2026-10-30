// お客様の画面：ログイン（マイコード）→ 同意 → 今日のメニュー・報告・食事・目標
let D = null, f = {};
const FEEL = [["easy", "楽だった"], ["ok", "ちょうど"], ["hard", "きつかった"]];
const VIEWS = ["vLoading", "vLogin", "vConsent", "vMain"];
const show = (v) => VIEWS.forEach((x) => ($(x).hidden = x !== v));

async function start() {
  // スタッフが案内したリンク（?c=コード）から開いたとき：自動でログインし、アドレスからコードを消す
  const u = new URL(location.href);
  const c = u.searchParams.get("c");
  if (c) {
    history.replaceState(null, "", u.pathname);
    try { await api("/api/login", { code: c }); } catch (e) { showLogin(e.message); return; }
  }
  try { await load(); }
  catch (e) {
    if (e.login) showLogin(e.message === "ログインしてください" ? "" : e.message);
    else { $("loadMsg").textContent = e.message; $("retry").hidden = false; show("vLoading"); }
  }
}
$("retry").onclick = () => { $("retry").hidden = true; $("loadMsg").textContent = "読み込み中…"; start(); };

function showLogin(msg) {
  $("loginErr").hidden = !msg; $("loginErr").textContent = msg || "";
  show("vLogin");
  if (!msg) $("code").focus({ preventScroll: true });
}
$("code").oninput = (e) => {
  const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  e.target.value = v.length > 4 ? v.slice(0, 4) + "-" + v.slice(4) : v;
};
$("loginForm").onsubmit = (e) => {
  e.preventDefault();
  $("loginErr").hidden = true;
  if ($("code").value.replace(/-/g, "").length !== 8) { showLogin("マイコード（8文字）を入れてください"); return; }
  busy($("loginBtn"), async () => {
    try { await api("/api/login", { code: $("code").value }); $("code").value = ""; await load(); }
    catch (err) { showLogin(err.message); }
  });
};
$("consentForm").onsubmit = (e) => {
  e.preventDefault();
  $("consentErr").hidden = true;
  if (!$("agree").checked) { $("consentErr").textContent = "内容をご確認のうえ、同意にチェックしてください"; $("consentErr").hidden = false; return; }
  busy($("consentBtn"), async () => {
    try { await api("/api/consent", { agree: true }); await load(); }
    catch (err) { if (err.login) return showLogin(err.message); $("consentErr").textContent = err.message; $("consentErr").hidden = false; }
  });
};
$("logout").onclick = async () => {
  if (!(await ask("ログアウトしますか？\nもう一度開くときはマイコードが必要です。", "ログアウトする"))) return;
  await api("/api/logout", {}).catch(() => {});
  D = null;
  showLogin("");
};

async function load() {
  D = await api("/api/me");
  if (D.needConsent) { $("consentName").textContent = D.name + "様、ようこそ"; show("vConsent"); return; }
  show("vMain");
  $("hName").textContent = D.name + "様";
  $("state").innerHTML = D.status === "check"
    ? `<div class="box d" style="margin:0 0 6px">体調のご報告ありがとうございます。スタッフが確認してから、次のメニューでご案内します。無理をせずお休みしてください。</div>` : "";

  const ws = weekStartOf(D.today), wc = D.visits.filter((d) => d >= ws).length;
  $("weekBand").textContent = wc >= D.weekly ? `今週の目標 達成（${wc}／${D.weekly}回）` : `今週の来店（${wc}／${D.weekly}回）`;
  $("streakMsg").textContent = wc >= D.weekly ? "この調子で続けていきましょう。" + streakText() : `あと${D.weekly - wc}回で今週の目標です。` + streakText();

  $("stage").textContent = "段階 " + "①②③④"[D.ladder.wl - 1];
  $("machineName").textContent = D.ladder.machine;
  $("lastNote").hidden = !D.lastNote; $("lastNote").textContent = "前回から：" + D.lastNote;
  $("menu").innerHTML = menuHTML(D.menu);
  $("ntcCard").innerHTML = ntcHTML(D.ntc, "ナイキ トレーニング クラブ");

  f = { feel: null, machine: D.ladder.machine, pain: false, ntcCount: null, ntcFeel: null };
  chips($("feel"), FEEL, null, (v) => (f.feel = v));
  chips($("machine"), "ABCDEFG".split("").map((x) => [x, x]), D.ladder.machine, (v) => (f.machine = v));
  chips($("pain"), [["0", "なし"], ["1", "あり"]], "0", (v) => (f.pain = v === "1"));
  $("ntcFeelBox").hidden = true;
  const askNtc = !!D.ntcAsk; // 2回目の来店から、週の最初の報告でだけ聞く
  $("ntcAsk").hidden = !askNtc;
  if (askNtc) {
    $("ntcQ").textContent = `前回からのNTC（${D.ntc.program.name}）は何回できましたか？（目標 週${D.ntc.program.per}回）`;
    chips($("ntcCount"), Array.from({ length: D.ntc.program.per + 1 }, (_, i) => [i, i + "回"]), null, (v) => { f.ntcCount = +v; $("ntcFeelBox").hidden = +v === 0; });
    chips($("ntcFeel"), [["easy", "楽"], ["ok", "ちょうど"], ["hard", "きつい"]], null, (v) => (f.ntcFeel = v));
  }
  // 体調確認中・今日の報告済み（プレミアム以外は1日1回）のときは送れない
  const doneForToday = D.reportedToday && D.plan !== "プレミアム";
  $("send").disabled = D.status === "check" || doneForToday;
  $("doneMsg").hidden = !D.reportedToday;
  $("doneMsg").textContent = D.status === "check" ? "今日の報告を受け付けました。" : "今日の報告を受け付けました。上のメニューが次回の内容です。";

  let askenSaved = D.askenThisWeek;
  chips($("asken"), Array.from({ length: 8 }, (_, i) => [i, i + "日"]), D.askenThisWeek, async (v) => {
    const el = $("asken");
    el.dataset.locked = "1"; el.setAttribute("aria-busy", "true");
    $("askenMsg").textContent = "記録しています…";
    try { await api("/api/asken", { days: +v }); askenSaved = +v; $("askenMsg").textContent = "記録しました"; }
    catch (e) {
      if (e.login) return showLogin(e.message);
      $("askenMsg").textContent = e.message;
      [...el.children].forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.v) === String(askenSaved)));
    }
    finally { delete el.dataset.locked; el.removeAttribute("aria-busy"); }
  });
  $("pickTm").innerHTML = `<span class="k">店内・30分</span><b>トレッドミル</b><span class="tiny">段階${"①②③④"[D.ladder.wl - 1]}・マシン${esc(D.ladder.machine)}</span>`;
  $("pickNtc").innerHTML = `<span class="k">自宅・スタジオ</span><b>NTC</b><span class="tiny">${esc(D.ntc.program.name)}</span>`;

  const t = D.target;
  $("goalDate").textContent = t.date ? t.date.replace(/-/g, "/") + "まで" : "";
  $("goal").innerHTML = (t.weight != null ? `<p class="tiny" style="font-weight:700">体重</p>${trendSVG(D.measurements, "weight", t.weight, "kg")}` : "")
    + (t.waist != null ? `<p class="tiny" style="font-weight:700">ウエスト</p>${trendSVG(D.measurements, "waist", t.waist, "cm")}` : "")
    || `<p class="sub">目標は来店時にスタッフと決めます。</p>`;
  $("openRep").onclick = () => openReport(reportHTML(D.name, D.report, D.target, D.measurements));
}
const streakText = () => (D.report.streak >= 2 ? `（${D.report.streak}週連続で来店中）` : "");
function weekStartOf(s) { const d = new Date(s + "T00:00:00Z"), w = d.getUTCDay(); d.setUTCDate(d.getUTCDate() + (w === 0 ? -6 : 1 - w)); return d.toISOString().slice(0, 10); }

$("send").onclick = async () => {
  const e = $("err"); e.hidden = true;
  const miss = [];
  if (!f.feel) miss.push("今日のトレーニング");
  if (!$("ntcAsk").hidden && (f.ntcCount === null || (f.ntcCount > 0 && !f.ntcFeel))) miss.push("NTC");
  const km = $("km").value;
  if (km !== "" && !(Number(km) >= 0.1 && Number(km) <= 15)) miss.push("距離（0.1〜15km）");
  if (miss.length) { e.textContent = "まだ選ばれていないか、確認が必要です：" + miss.join("・"); e.hidden = false; e.focus(); return; }
  if (f.pain && !(await ask("「痛みや体調の変化：あり」で送ります。\nスタッフが確認するまで、次のメニューはお休みになります。よろしいですか？", "この内容で送る"))) return;
  let ok = false;
  await busy($("send"), async () => {
    try {
      const body = { feel: f.feel, machine: f.machine, pain: f.pain, km };
      if (!$("ntcAsk").hidden) { body.ntcCount = f.ntcCount; body.ntcFeel = f.ntcFeel; }
      await api("/api/report", body);
      $("km").value = "";
      ok = true;
    } catch (err) {
      if (err.login) return showLogin(err.message);
      e.textContent = err.message; e.hidden = false; e.focus();
    }
  });
  if (ok) {
    try { await load(); } catch (err) { e.textContent = err.message; e.hidden = false; }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
};
// メニューを選ぶカード → その場所へ移動
document.querySelectorAll("[data-goto]").forEach((b) => (b.onclick = () => {
  const t = $(b.dataset.goto);
  t.scrollIntoView({ behavior: "smooth", block: "start" });
  t.focus({ preventScroll: true });
}));

start();

// あすけん：AndroidはGoogle Play、それ以外（iPhone）はApp Storeへ
if (/Android/i.test(navigator.userAgent)) $("askenLink").href = "https://play.google.com/store/apps/details?id=jp.co.greenhouse.asken";
