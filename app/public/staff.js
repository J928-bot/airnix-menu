// スタッフの画面：ログイン → 一覧（注意・案内）→ 新規登録・測定・体調確認・NTCの目的・案内の記録・修正・マイコード再発行・利用終了・削除
let S = null, archived = false;
const LV = { d: "d", w: "w", a: "a", b: "b" };
const show = (v) => ["vLogin", "vMain"].forEach((x) => ($(x).hidden = x !== v));

async function load() {
  $("list").setAttribute("aria-busy", "true");
  try { S = await api("/api/staff/members" + (archived ? "?archived=1" : "")); }
  catch (e) { if (e.login) { show("vLogin"); return; } throw e; }
  finally { $("list").removeAttribute("aria-busy"); }
  show("vMain");
  $("who").textContent = S.staff + "さん";
  const cnt = (lv) => S.members.filter((m) => m.flags.some((f) => f.level === lv)).length;
  $("sum").innerHTML = `<div><span class="tiny">すぐ対応</span><b>${cnt("d")}</b></div><div><span class="tiny">気にかける</span><b>${cnt("w")}</b></div><div><span class="tiny">案内のタイミング</span><b>${cnt("a")}</b></div><div><span class="tiny">${archived ? "利用終了" : "利用中"}</span><b>${S.members.length}</b></div>`;
  chips($("tab"), [["0", "利用中"], ["1", "利用終了"]], archived ? "1" : "0", (v) => {
    archived = v === "1";
    load().catch((e) => { $("err").textContent = e.message; $("err").hidden = false; });
  });
  $("list").innerHTML = S.members.length ? S.members.map(card).join("") : `<p class="sub">${archived ? "利用終了の方はいません" : "まだ登録がありません。「＋ 新しく登録」から始めてください"}</p>`;
  bind();
}

function card(m) {
  const id = esc(m.id);
  const tags = m.flags.length ? m.flags.map((f) => `<span class="flag ${LV[f.level]}">${esc(f.label)}</span>`).join("") : `<span class="flag">順調</span>`;
  const up = m.flags.find((f) => f.level === "a");
  const r = m.report;
  return `<article class="card ${m.flags.some((f) => f.level === "d") ? "alert" : ""}">
  <div class="head"><b style="font-size:19px">${esc(m.name)}</b><span class="tiny">${esc(m.plan)}・週${m.weekly}回目標</span></div>
  <p class="tiny">${m.streak}週連続・最終来店 ${md(m.lastVisit)}${m.consent ? "" : "・<b style='color:var(--warn)'>まだ開いていません</b>"}</p>
  <p class="tiny">トレッドミル：段階${"①②③④"[m.ladder.wl - 1]}・マシン${esc(m.ladder.machine)}・早歩き${f1(m.ladder.fp)}km/h／NTC：${esc(m.ntc.name)} ${m.ntc.week}週目／全${m.ntc.weeks}週</p>
  ${archived ? "" : `<div class="tags">${tags}</div>
  ${m.flags.length ? `<p class="box ${m.flags[0].level === "d" ? "d" : m.flags[0].level === "w" ? "w" : ""}">${esc(m.flags[0].say)}</p>` : ""}
  ${m.status === "check" ? `<button class="btn" type="button" data-resolve="${id}">体調を確認した（メニューを再開）</button>` : ""}
  ${up && m.upsell ? `<div class="box"><p class="tiny" style="font-weight:700">直近30日の効果レポート</p><p>来店${r.visits}回・NTC${r.ntc}回${r.km ? `・歩いた距離${r.km}km` : ""}${r.dw != null ? `・体重${sg(r.dw)}kg` : ""}${r.dwa != null ? `・ウエスト${sg(r.dwa)}cm` : ""}</p>
    <p class="tiny" style="margin-top:6px">案内：${esc(m.upsell.to)}（料金はhacomono・料金表で確認）</p><p>「${esc(m.upsell.say)}」</p></div>
    <div class="two"><button class="btn line" type="button" data-up="${id}" data-r="yes">案内した → 変更する</button><button class="btn line" type="button" data-up="${id}" data-r="no">案内した → 今は見送り</button></div>
    <p class="tiny">「変更する」のときは、hacomonoでもプランを変更してください。</p>` : ""}
  ${m.lastReport ? `<p class="tiny">直近の報告 ${md(m.lastReport.date)}：${esc(m.lastReport.note || "")}</p>` : ""}
  <div class="two"><input type="number" step="0.1" inputmode="decimal" placeholder="体重 kg" data-w="${id}"><input type="number" step="0.1" inputmode="decimal" placeholder="ウエスト cm" data-c="${id}"></div>
  <div class="two"><button class="btn line" type="button" data-measure="${id}">測定を記録</button><button class="btn line" type="button" data-rep="${id}">効果レポート</button></div>`}
  <details><summary>そのほかの操作</summary><div style="display:flex;flex-direction:column;gap:10px;padding-top:12px">
    ${archived ? `<button class="btn line" type="button" data-restore="${id}">利用を再開する</button>` : `
    <p class="tiny" style="font-weight:700">NTCの目的</p>
    <div class="chips">${Object.entries(S.tracks).map(([k, l]) => `<button type="button" data-track="${id}" data-k="${k}" aria-pressed="${m.ntc.track === k}">${esc(l)}</button>`).join("")}</div>
    <button class="btn line" type="button" data-edit="${id}">名前・プラン・目標を直す</button>
    <button class="btn line" type="button" data-reissue="${id}">マイコードを作り直す</button>
    <button class="btn line" type="button" data-archive="${id}">利用終了にする（退会など）</button>`}
    <button class="btn danger" type="button" data-del="${id}">記録をすべて削除する（ご本人の申し出のとき）</button>
  </div></details>
</article>`;
}

// 新規登録・修正のフォーム
function formHTML(m) {
  const t = m ? m.target : {};
  const sel = (name, opts, cur) => `<select data-f="${name}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(cur) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  const num = (name, v, ph) => `<input type="number" step="0.1" inputmode="decimal" data-f="${name}" value="${v ?? ""}" placeholder="${ph || ""}">`;
  return `<div class="pad" style="padding-top:20px;display:flex;justify-content:space-between;align-items:center"><h3>${m ? esc(m.name) + "様の情報を直す" : "新しく登録"}</h3><button class="btn line small" type="button" data-close>閉じる</button></div>
<div class="pad" style="display:flex;flex-direction:column;gap:12px">
<label class="field"><span>お名前</span><input data-f="name" value="${esc(m ? m.name : "")}" maxlength="40" autocomplete="off" placeholder="例：山田 花子"></label>
<div class="two"><label class="field"><span>プラン</span>${sel("plan", S.plans.map((p) => [p, p]), m ? m.plan : "メイン")}</label>
<label class="field"><span>週の来店目標</span>${sel("weekly", [1, 2, 3, 4, 5].map((x) => [x, "週" + x + "回"]), m ? m.weekly : 2)}</label></div>
${m ? "" : `<label class="field"><span>NTCの目的</span>${sel("track", Object.entries(S.tracks), "base")}</label>
<p class="tiny">プランはhacomonoと同じものを選んでください。トレッドミルの基準は、お客様と一緒にトレッドミルで測った数字を入れてください。</p>
<div class="two"><label class="field"><span>マシン</span>${sel("machine", "ABCDEFG".split("").map((x) => [x, x]), "A")}</label>
<label class="field"><span>きつめの抵抗（A〜C）</span>${sel("hardRes", [2, 3, 4, 5].map((x) => [x, x]), 3)}</label></div>
<div class="two"><label class="field"><span>ゆっくり km/h</span>${num("walk", "", "4.5")}</label><label class="field"><span>早歩き km/h</span>${num("fast", "", "5.5")}</label></div>
<div class="two"><label class="field"><span>今の体重 kg</span>${num("startWeight")}</label><label class="field"><span>今のウエスト cm</span>${num("startWaist")}</label></div>`}
<div class="two"><label class="field"><span>目標の体重 kg</span>${num("targetWeight", t.weight)}</label><label class="field"><span>目標のウエスト cm</span>${num("targetWaist", t.waist)}</label></div>
<label class="field"><span>目標の期日</span><input type="date" data-f="targetDate" value="${esc(t.date || "")}"></label>
<p class="err" id="formErr" role="alert" tabindex="-1" hidden></p>
<button class="btn" type="button" data-save>${m ? "保存する" : "登録してマイコードを発行"}</button></div>`;
}

function openForm(m) {
  openReport(formHTML(m), { sticky: true }); // 入力中に外側を触っても閉じない
  const box = $("overlay");
  const save = box.querySelector("[data-save]");
  save.onclick = () => busy(save, async () => {
    const body = { action: m ? "edit" : "create" };
    if (m) body.id = m.id;
    box.querySelectorAll("[data-f]").forEach((el) => (body[el.dataset.f] = el.value));
    body.weekly = Number(body.weekly);
    $("formErr").hidden = true;
    let r;
    try { r = await api("/api/staff/members", body); }
    catch (err) {
      if (err.login) { closeOverlay(); show("vLogin"); return; }
      $("formErr").textContent = err.message; $("formErr").hidden = false; $("formErr").focus(); return;
    }
    if (r.code) showCode(r.name, r.code); else closeOverlay();
    await load().catch((e) => { $("err").textContent = e.message; $("err").hidden = false; });
  });
}

// マイコードの表示（この画面を閉じると、もう表示できない）
function showCode(name, code) {
  const msg = `${name}様\nAIRNIXの個別メニューのマイコードは「${code}」です。\nAirNixアプリから個別メニューを開き、このコードを入れてください。`;
  openReport(`<div class="pad" style="padding-top:22px;display:flex;flex-direction:column;gap:12px">
<h3>${esc(name)}様のマイコード</h3>
<p class="codebig">${esc(code)}</p>
<p class="box w">この画面を閉じると、コードはもう表示できません（分からなくなったら作り直します）。お客様のスマホで一緒に入れるか、下の文面を公式LINEで送ってください。</p>
<p class="box" style="white-space:pre-wrap">${esc(msg)}</p>
<button class="btn line" type="button" id="copyMsg">文面をコピー</button>
<button class="btn" type="button" data-close>お客様に伝えたので閉じる</button></div>`, { sticky: true }); // コードは一度しか出せないため、外側を触っても閉じない
  $("copyMsg").onclick = async () => {
    try { await navigator.clipboard.writeText(msg); $("copyMsg").textContent = "コピーしました"; } catch { $("copyMsg").textContent = "コピーできませんでした。長押しで選んでください"; }
  };
}

// 操作を送る。押したボタンは終わるまで押せない（二重送信の防止）
async function act(body, btn) {
  $("err").hidden = true;
  let r = null;
  const run = async () => {
    try { r = await api("/api/staff/members", body); }
    catch (e) {
      if (e.login) { show("vLogin"); return; }
      $("err").textContent = e.message; $("err").hidden = false; window.scrollTo({ top: 0 }); return;
    }
    await load().catch((e) => { $("err").textContent = e.message; $("err").hidden = false; });
  };
  if (btn) await busy(btn, run); else await run();
  return r;
}
const byId = (id) => S.members.find((x) => x.id === id);
function bind() {
  const on = (sel, fn) => document.querySelectorAll(sel).forEach((b) => (b.onclick = () => fn(b)));
  on("[data-measure]", (b) => {
    const id = b.dataset.measure;
    act({ action: "measure", id, weight: document.querySelector(`[data-w="${CSS.escape(id)}"]`).value, waist: document.querySelector(`[data-c="${CSS.escape(id)}"]`).value }, b);
  });
  on("[data-resolve]", (b) => act({ action: "resolve", id: b.dataset.resolve }, b));
  on("[data-track]", async (b) => {
    if (b.getAttribute("aria-pressed") === "true") return;
    if (await ask("NTCの目的を変えると、その目的の1本目のプログラムからやり直しになります。変更しますか？", "変更する")) act({ action: "track", id: b.dataset.track, track: b.dataset.k });
  });
  on("[data-up]", (b) => act({ action: "upsell", id: b.dataset.up, result: b.dataset.r }, b));
  on("[data-rep]", (b) => { const m = byId(b.dataset.rep); openReport(reportHTML(m.name, m.report, m.target, m.measurements)); });
  on("[data-edit]", (b) => openForm(byId(b.dataset.edit)));
  on("[data-reissue]", async (b) => {
    const m = byId(b.dataset.reissue);
    if (!(await ask(`${m.name}様のマイコードを作り直します。\n今のコードと、ログイン中のスマホは使えなくなります。よろしいですか？`, "作り直す"))) return;
    const r = await act({ action: "reissue", id: m.id });
    if (r && r.code) showCode(r.name, r.code);
  });
  on("[data-archive]", async (b) => {
    const m = byId(b.dataset.archive);
    if (await ask(`${m.name}様を利用終了にします。\n記録は残り、あとで再開できます。ログイン中のスマホは使えなくなります。よろしいですか？`, "利用終了にする")) act({ action: "archive", id: m.id });
  });
  on("[data-restore]", (b) => act({ action: "restore", id: b.dataset.restore }, b));
  on("[data-del]", (b) => openDelete(byId(b.dataset.del)));
}

// 削除（ご本人の申し出のとき）：取り消せないため、お名前を入れて確認する
function openDelete(m) {
  openReport(`<div class="pad" style="padding-top:22px;display:flex;flex-direction:column;gap:14px">
<h3>記録をすべて削除する</h3>
<p class="box d">${esc(m.name)}様の記録（報告・測定・あすけん・案内の記録）をすべて削除します。元に戻せません。ご本人からのお申し出のときだけ使ってください。</p>
<label class="field"><span>確認のため、お名前「${esc(m.name)}」をそのまま入れてください</span><input id="delName" autocomplete="off"></label>
<p class="err" id="delErr" role="alert" hidden></p>
<button class="btn danger" type="button" id="delGo">削除する</button>
<button class="btn line" type="button" data-close>やめる</button></div>`, { sticky: true });
  $("delName").focus();
  $("delGo").onclick = () => busy($("delGo"), async () => {
    try { await api("/api/staff/members", { action: "delete", id: m.id, confirmName: $("delName").value }); }
    catch (e) { if (e.login) { closeOverlay(); show("vLogin"); return; } $("delErr").textContent = e.message; $("delErr").hidden = false; return; }
    closeOverlay();
    await load().catch((e) => { $("err").textContent = e.message; $("err").hidden = false; });
  });
}

$("newBtn").onclick = () => openForm(null);
$("loginForm").onsubmit = (e) => {
  e.preventDefault();
  $("loginErr").hidden = true;
  busy($("sLoginBtn"), async () => {
    try { await api("/api/staff/login", { name: $("sName").value, password: $("sPass").value }); $("sPass").value = ""; await load(); }
    catch (err) { $("loginErr").textContent = err.message; $("loginErr").hidden = false; }
  });
};
$("logout").onclick = async () => { await api("/api/staff/login", null, "DELETE").catch(() => {}); show("vLogin"); };

load().catch((e) => { show("vMain"); $("err").textContent = e.message + "（画面を開き直してください）"; $("err").hidden = false; });
