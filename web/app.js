import { detect, evaluate, overallLevel, search } from "./check.js";

const $ = (sel) => document.querySelector(sel);

const VERDICT = {
  ok: { icon: "✓", title: "可以使用" },
  check: { icon: "!", title: "需要確認" },
  no: { icon: "✕", title: "不在官方清單上" },
  unknown: { icon: "?", title: "無法自動判斷" },
};

const guides = Object.fromEntries(
  [...$("#guides").content.querySelectorAll("[data-guide]")].map((el) => [el.dataset.guide, el.textContent])
);

// ---------- data ----------

let compat;
let modelsPromise;
const loadModels = () =>
  (modelsPromise ??= fetch("data/android-models.json").then((r) => r.json()).then((d) => d.models));

// ---------- environment ----------

async function readEnv() {
  // ?ua=...&model=...&pv=... lets us demo or test other phones from any browser.
  const params = new URLSearchParams(location.search);
  if (params.has("ua")) {
    const model = params.get("model");
    return {
      userAgent: params.get("ua"),
      maxTouchPoints: 5,
      uaData: model ? { platform: "Android", model, platformVersion: params.get("pv") || "" } : null,
      simulated: true,
    };
  }
  let uaData = null;
  if (navigator.userAgentData?.getHighEntropyValues) {
    try {
      uaData = await navigator.userAgentData.getHighEntropyValues(["model", "platformVersion"]);
    } catch {
      uaData = null;
    }
  }
  return { userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints || 0, uaData };
}

// ---------- check tab ----------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  node.append(...children.filter((c) => c != null));
  return node;
}

function renderResult(result) {
  const box = $("#result");
  result.level = overallLevel(result.items);
  const v = VERDICT[result.level];
  box.dataset.level = result.level;
  box.replaceChildren(
    el("p", { class: "verdict" },
      el("span", { class: "icon", "aria-hidden": "true" }, v.icon),
      el("span", { class: "title" }, v.title)),
    result.device
      ? el("p", { class: "phone" }, result.device, result.os ? el("small", {}, result.os) : null)
      : null,
    el("ul", { class: "items" }, ...result.items.map((item) => renderItem(item, result)))
  );
}

function renderItem(item, result) {
  const icon = VERDICT[item.level].icon;
  return el("li", { dataset: { level: item.level } },
    el("span", { class: "dot", "aria-hidden": "true" }, icon),
    el("span", {}, item.text),
    item.help ? el("span", { class: "guide" }, guides[item.help]) : null,
    item.ask === "samsung-patch" ? renderSamsungAsk(item, result) : null
  );
}

function renderSamsungAsk(item, result) {
  const answer = (isRecent) => {
    item.ask = null;
    item.help = isRecent ? null : "android-update";
    item.level = isRecent ? "ok" : "check";
    item.text = isRecent
      ? "安全性修補程式是 2025 年 12 月以後，符合條件。"
      : "安全性修補程式早於 2025 年 12 月，請先更新系統再檢查一次。";
    renderResult(result);
  };
  return el("div", { class: "ask" },
    el("strong", {}, "修補程式日期是 2025 年 12 月或之後嗎？"),
    el("div", { class: "ask-buttons" },
      el("button", { class: "btn", onclick: () => answer(true) }, "是"),
      el("button", { class: "btn secondary", onclick: () => answer(false) }, "不是，比較早")));
}

function renderTech(env, facts) {
  const rows = [
    ["User agent", env.userAgent],
    ["Client hints 型號", env.uaData?.model || "（無）"],
    ["Client hints 版本", env.uaData?.platformVersion || "（無）"],
    ["判讀結果", JSON.stringify(facts)],
  ];
  if (env.simulated) rows.unshift(["模式", "模擬（網址參數）"]);
  $("#tech").replaceChildren(...rows.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)]));
}

function setupNfc(facts) {
  if (facts.platform !== "android" || !("NDEFReader" in window)) return;
  $("#nfc").hidden = false;
  const out = $("#nfc-result");
  $("#nfc-btn").addEventListener("click", async () => {
    out.textContent = "檢查中…";
    const ctrl = new AbortController();
    try {
      // eslint-disable-next-line no-undef
      await new NDEFReader().scan({ signal: ctrl.signal });
      out.textContent = "✓ NFC 已開啟，可以掃描感測器。";
      ctrl.abort();
    } catch (err) {
      out.textContent =
        err.name === "NotAllowedError"
          ? "請按「允許」讓網頁檢查 NFC，再試一次。"
          : `NFC 可能沒有開啟。${guides["nfc-on"]}`;
    }
  });
}

async function runCheck() {
  const env = await readEnv();
  const facts = detect(env);
  const models = facts.platform === "android" ? await loadModels() : null;
  renderResult(evaluate(facts, compat, models));
  renderTech(env, facts);
  setupNfc(facts);
}

// ---------- search tab ----------

let searchTimer;
async function runSearch() {
  const q = $("#q").value.trim();
  const list = $("#search-results");
  if (q.length < 2) {
    list.replaceChildren();
    return;
  }
  const models = await loadModels();
  const results = search(q, compat, models);
  if (!results.length) {
    const msg = /iphone/i.test(q)
      ? "查不到。iPhone 8 以前的機型（例如 iPhone 7、6s、SE 第一代）不在清單上。"
      : "查不到這支手機，可能不在官方清單上。可以換個寫法再試，例如只輸入「A79」或「S23」。";
    list.replaceChildren(el("li", { class: "empty" }, msg));
    return;
  }
  list.replaceChildren(
    ...results.map((r) =>
      el("li", { dataset: { listed: String(r.listed) } },
        el("div", { class: "name" }, r.label),
        el("div", { class: "tag" }, r.listed ? "✓ 在官方清單上" : "✕ 不在官方清單上"),
        r.codes.length
          ? el("div", { class: "codes" }, `型號：${r.codes.slice(0, 8).join("、")}${r.codes.length > 8 ? "…" : ""}`)
          : null))
  );
}

function renderOsLists() {
  const android = compat.android.os_versions
    .map((o) => o.version + (o.flags.includes("*") ? "*" : "") + (o.flags.includes("†") ? "†" : ""))
    .join("、");
  $("#os-lists").replaceChildren(
    el("h3", {}, "iOS"),
    el("p", {}, compat.ios.os_versions.join("、")),
    el("h3", {}, "Android"),
    el("p", {}, android),
    el("p", {}, "* 請確認手機廠商仍有提供支援。"),
    el("p", {}, "† Samsung：安全性修補程式需為 2025 年 12 月以後。")
  );
}

// ---------- QR tab ----------

let qrDone = false;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.append(s);
  });
}

async function renderQr() {
  if (qrDone) return;
  const url = location.origin + location.pathname;
  $("#qr-url").textContent = url;
  try {
    await loadScript("vendor/qrcode.min.js");
    const qr = window.qrcode(0, "M");
    qr.addData(url);
    qr.make();
    $("#qr").innerHTML = qr.createSvgTag({ cellSize: 8, margin: 0, scalable: true });
    qrDone = true;
  } catch {
    $("#qr").textContent = "QR Code 載入失敗";
  }
}

// ---------- tabs ----------

function showTab(name) {
  for (const btn of document.querySelectorAll("[data-tab]")) {
    const on = btn.dataset.tab === name;
    btn.setAttribute("aria-selected", String(on));
    $(`#tab-${btn.dataset.tab}`).hidden = !on;
  }
  if (name === "qr") renderQr();
  if (name === "search") loadModels();
}

for (const btn of document.querySelectorAll("[data-tab]")) {
  btn.addEventListener("click", () => {
    history.replaceState(null, "", btn.dataset.tab === "check" ? location.pathname + location.search : `#${btn.dataset.tab}`);
    showTab(btn.dataset.tab);
  });
}

window.addEventListener("hashchange", () => {
  const tab = location.hash.slice(1);
  showTab(["search", "qr"].includes(tab) ? tab : "check");
});

$("#q").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 150);
});

// ---------- start ----------

(async () => {
  try {
    compat = await fetch("data/compatibility.json").then((r) => r.json());
  } catch {
    $("#result").textContent = "資料載入失敗，請檢查網路後重新整理。";
    return;
  }
  const s = compat.source;
  $("#source").textContent = `資料版本：${s.document} Rev. ${s.revision}（${s.date}）`;
  renderOsLists();
  showTab(["search", "qr"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "check");
  runCheck();
})();
