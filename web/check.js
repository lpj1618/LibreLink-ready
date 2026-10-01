// Pure detection + evaluation logic. No DOM access, so it can be unit-tested in Node.

// iOS 26 Safari freezes the OS token in the user agent at an iOS 18 value
// ("18_6", later "18_7") and reports the real version only as "Version/26.x".
const FROZEN_IOS_TOKENS = new Set(["18.6", "18.7"]);

// ---------- version helpers ----------

// "17.0" -> [17], "16.0.2" -> [16, 0, 2]; trailing zeros dropped so "17" == "17.0".
export function parseVersion(s) {
  const parts = String(s).split(".").map((n) => parseInt(n, 10));
  while (parts.length > 1 && parts[parts.length - 1] === 0) parts.pop();
  return parts;
}

export function formatVersion(parts) {
  return parts.join(".");
}

export function compareVersions(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d;
  }
  return 0;
}

// ---------- detection ----------

/**
 * Turn browser signals into facts.
 * @param {object} env  { userAgent, maxTouchPoints, uaData } where uaData is the
 *                      resolved result of navigator.userAgentData.getHighEntropyValues()
 *                      (or null when unavailable).
 */
export function detect(env) {
  const ua = env.userAgent || "";
  const inApp = /\bLine\/|FBAN|FBAV|Instagram|MicroMessenger/i.test(ua);

  // iPadOS Safari pretends to be a Mac.
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && env.maxTouchPoints > 1)) {
    return { platform: "ipad", inApp };
  }

  if (/iPhone|iPod/.test(ua)) {
    const os = ua.match(/OS (\d+)_(\d+)(?:_(\d+))? like Mac OS X/);
    const safariVer = ua.match(/Version\/(\d+)\.(\d+)(?:\.(\d+))?/);
    const isSafari = !!safariVer && /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua) && !inApp;
    let version = null;
    let precision = "exact"; // exact | minor (x.y or x.y.z) | atLeast (frozen token, no real version)
    if (os) {
      version = [os[1], os[2], os[3]].filter((x) => x !== undefined).map(Number);
      const frozenCandidate = os[3] === undefined && FROZEN_IOS_TOKENS.has(`${os[1]}.${os[2]}`);
      if (frozenCandidate) {
        if (isSafari && Number(safariVer[1]) >= 26) {
          version = [Number(safariVer[1]), Number(safariVer[2])];
          if (safariVer[3] !== undefined) version.push(Number(safariVer[3]));
          precision = "minor";
        } else if (!(isSafari && Number(safariVer[1]) === 18)) {
          precision = "atLeast";
        }
      }
      version = parseVersion(version.join("."));
    }
    return { platform: "ios", version, precision, inApp, isSafari };
  }

  if (/Android/.test(ua) || env.uaData?.platform === "Android") {
    let model = null;
    let version = null;
    let source = null;
    if (env.uaData && env.uaData.model) {
      model = env.uaData.model.trim();
      source = "uach";
    }
    if (env.uaData && env.uaData.platformVersion) {
      version = parseVersion(env.uaData.platformVersion);
    }
    // Fallback: WebViews and older browsers still put the model in the UA.
    // Chrome's reduced UA always says "Android 10; K", which is useless.
    const m = ua.match(/Android (\d+(?:\.\d+)*);\s*([^;)]+?)(?:\s+Build\/[^;)]*)?[;)]/);
    if (m && m[2] !== "K" && m[2] !== "wv") {
      if (!model) {
        model = m[2].trim();
        source = "ua";
      }
      if (!version) version = parseVersion(m[1]);
    }
    return { platform: "android", model, version, modelSource: source, inApp };
  }

  return { platform: "other", inApp };
}

// ---------- evaluation ----------

const LEVEL_ORDER = { ok: 0, check: 1, unknown: 2, no: 3 };
const worst = (levels) => levels.reduce((a, b) => (LEVEL_ORDER[b] > LEVEL_ORDER[a] ? b : a), "ok");

export const overallLevel = (items) => worst(items.map((i) => i.level));

export function displayName(brand, name) {
  return name.toLowerCase().startsWith(brand.toLowerCase()) ? name : `${brand} ${name}`;
}

/**
 * @returns {{level, title, device, os, items: {level, text, help?, ask?}[]}}
 *   level: ok (可以使用) | check (需要確認) | no (不在清單) | unknown (無法判斷)
 *   help:  key of a step-by-step guide shown under the item
 *   ask:   key of an interactive yes/no question (e.g. Samsung patch level)
 */
export function evaluate(facts, compat, models) {
  switch (facts.platform) {
    case "ios":
      return evaluateIOS(facts, compat);
    case "android":
      return evaluateAndroid(facts, compat, models);
    case "ipad":
      return {
        level: "no",
        device: "iPad",
        os: null,
        items: [{ level: "no", text: "iPad 不在官方相容清單上，請改用手機安裝。" }],
      };
    default:
      return {
        level: "unknown",
        device: null,
        os: null,
        items: [{ level: "unknown", text: "這看起來不是手機。請用「要安裝 App 的那支手機」打開這個網頁。" }],
      };
  }
}

function evaluateIOS(facts, compat) {
  const items = [];
  const listed = compat.ios.os_versions.map(parseVersion);
  const max = listed.reduce((a, b) => (compareVersions(a, b) > 0 ? a : b));
  const v = facts.version;

  if (!v) {
    return {
      level: "unknown",
      device: "iPhone",
      os: null,
      items: [{ level: "unknown", text: "讀不到 iOS 版本，請用 Safari 打開這個網頁再試一次。", help: "ios-open-safari" }],
    };
  }

  const vText = facts.precision === "atLeast" ? `iOS ${formatVersion(v)} 或更新` : `iOS ${formatVersion(v)}`;

  // Device: iOS 16+ only runs on iPhone 8 and later, all of which are listed.
  if (v[0] >= 16) {
    items.push({ level: "ok", text: "這支 iPhone 的機型在清單上（iPhone 8 以後都可以）。" });
  } else {
    items.push({
      level: "check",
      text: "請確認機型：iPhone 8 以後才可以使用（iPhone 7、6s、SE 第一代不行）。",
      help: "ios-about",
    });
  }

  // OS version.
  if (facts.precision === "atLeast") {
    items.push({
      level: "check",
      text: "這個瀏覽器看不到完整的 iOS 版本。請到設定查看版本，或改用 Safari 打開這個網頁。",
      help: facts.inApp ? "ios-open-safari" : "ios-about",
    });
  } else {
    const isListed =
      facts.precision === "minor"
        ? listed.some((l) => (l[0] === v[0]) && (l[1] || 0) === (v[1] || 0))
        : listed.some((l) => compareVersions(l, v) === 0);
    if (isListed) {
      items.push({ level: "ok", text: `${vText} 在官方清單上。` });
    } else if (compareVersions(v, max) > 0) {
      items.push({
        level: "check",
        text: `${vText} 比官方清單上的版本還新，官方尚未列入。請以官方最新清單為準。`,
      });
    } else {
      items.push({
        level: "check",
        text: `${vText} 不在官方清單上，建議更新到最新版 iOS 後再檢查一次。`,
        help: "ios-update",
      });
    }
  }

  return { level: overallLevel(items), device: "iPhone", os: vText, items };
}

function androidVersionKey(v) {
  // Listed values are "8", "8.1", "9", ... "16".
  if (v[0] === 8 && v[1] === 1) return "8.1";
  return String(v[0]);
}

function evaluateAndroid(facts, compat, models) {
  const items = [];
  const vText = facts.version ? `Android ${androidVersionKey(facts.version)}` : null;

  if (!facts.model) {
    items.push({
      level: "unknown",
      text: "這個瀏覽器讀不到手機型號。請用 Chrome 打開這個網頁再試一次，或改用「查詢型號」。",
      help: facts.inApp ? "android-open-chrome" : "android-model",
    });
    return { level: "unknown", device: "Android 手機", os: vText, items };
  }

  const entry = lookupModel(models, facts.model);
  let device = facts.model;
  let brand = null;

  if (!entry) {
    items.push({
      level: "unknown",
      text: `查不到型號「${facts.model}」的資料，請改用「查詢型號」用手機名稱查詢。`,
      help: "android-model",
    });
  } else {
    brand = entry.brand;
    device = displayName(entry.brand, entry.name);
    if (entry.listed) {
      items.push({ level: "ok", text: `${device} 在官方清單上。` });
    } else {
      items.push({
        level: "no",
        text: `${device} 不在官方相容清單上（官方未評估這支手機）。`,
        help: "not-listed",
      });
    }
  }

  // OS version.
  if (!facts.version) {
    items.push({ level: "check", text: "讀不到 Android 版本，請到設定查看。", help: "android-version" });
  } else {
    const key = androidVersionKey(facts.version);
    const os = compat.android.os_versions.find((o) => o.version === key);
    if (!os) {
      const newest = Math.max(...compat.android.os_versions.map((o) => parseFloat(o.version)));
      items.push(
        facts.version[0] > newest
          ? { level: "check", text: `${vText} 比官方清單上的版本還新，官方尚未列入。請以官方最新清單為準。` }
          : { level: "no", text: `${vText} 版本太舊，官方清單最低是 Android 8。`, help: "android-update" }
      );
    } else {
      items.push({ level: "ok", text: `${vText} 在官方清單上。` });
      if (os.flags.includes("*")) {
        items.push({
          level: "check",
          text: "這是比較舊的 Android 版本，請確認手機廠商仍有提供更新與支援。",
          help: "android-update",
        });
      }
      if (os.flags.includes("†") && brand === "Samsung") {
        items.push({
          level: "check",
          text: "Samsung 手機的 Android 16：安全性修補程式要是 2025 年 12 月以後的版本。",
          help: "samsung-patch",
          ask: "samsung-patch",
        });
      }
    }
  }

  return { level: overallLevel(items), device, os: vText, items };
}

export function lookupModel(models, model) {
  if (!models || !model) return null;
  if (models[model]) return models[model];
  const upper = model.toUpperCase();
  const key = Object.keys(models).find((k) => k.toUpperCase() === upper);
  return key ? models[key] : null;
}

// ---------- manual search ----------

const words = (s) =>
  s.normalize("NFKC").toLowerCase().replace(/\+/g, " plus ").split(/[\s\-_()/.]+/).filter(Boolean);
const squash = (s) => words(s).join("");

/**
 * Does `query` match `name`? Either the query appears as typed (partial words
 * allowed: "s23 ult"), or with spaces left out it covers whole words
 * ("s23ultra" matches "Galaxy S23 Ultra", but "a15" does not match "A1 5G").
 */
export function nameMatches(query, name) {
  const q = words(query);
  const n = words(name);
  if (!q.length) return false;
  if (` ${n.join(" ")}`.includes(` ${q.join(" ")}`)) return true;
  const qs = q.join("");
  for (let i = 0; i < n.length; i++) {
    let acc = "";
    for (let j = i; j < n.length && acc.length < qs.length; j++) {
      acc += n[j];
      if (acc === qs) return true;
    }
  }
  return false;
}

/**
 * Search listed iPhones, listed Android devices and known model codes.
 * @returns {{label, listed, codes: string[]}[]}
 */
export function search(query, compat, models, limit = 20) {
  const q = squash(query);
  if (q.length < 2) return [];
  const results = new Map();
  const add = (label, listed, code) => {
    let r = results.get(label);
    if (!r) results.set(label, (r = { label, listed, codes: [] }));
    r.listed = r.listed || listed;
    if (code && !r.codes.includes(code)) r.codes.push(code);
  };

  for (const name of compat.ios.devices) {
    if (nameMatches(query, name)) add(name, true);
  }
  for (const [brand, names] of Object.entries(compat.android.brands)) {
    for (const name of names) {
      if (nameMatches(query, `${brand} ${name}`)) add(displayName(brand, name), true);
    }
  }
  if (models) {
    for (const [code, m] of Object.entries(models)) {
      const label = displayName(m.brand, m.name);
      if (squash(code) === q || nameMatches(query, `${m.brand} ${m.name}`)) add(label, m.listed, code);
    }
  }

  return [...results.values()]
    .sort((a, b) => Number(b.listed) - Number(a.listed) || a.label.localeCompare(b.label))
    .slice(0, limit);
}
