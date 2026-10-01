import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { detect, evaluate, search } from "../web/check.js";

const compat = JSON.parse(readFileSync(new URL("../web/data/compatibility.json", import.meta.url)));
const models = JSON.parse(readFileSync(new URL("../web/data/android-models.json", import.meta.url))).models;

const iphone = (os, tail = "Version/18.0 Mobile/15E148 Safari/604.1") =>
  `Mozilla/5.0 (iPhone; CPU iPhone OS ${os} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ${tail}`;
const CHROME_REDUCED = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const android = (model, platformVersion) => ({
  userAgent: CHROME_REDUCED,
  uaData: { platform: "Android", model, platformVersion },
});

const run = (env) => {
  const facts = detect({ maxTouchPoints: 5, uaData: null, ...env });
  return { facts, result: evaluate(facts, compat, models) };
};

test("iOS 17.5.1 Safari is ok", () => {
  const { result } = run({ userAgent: iphone("17_5_1", "Version/17.5 Mobile/15E148 Safari/604.1") });
  assert.equal(result.level, "ok");
  assert.equal(result.os, "iOS 17.5.1");
});

test("iOS 26 Safari: frozen 18_6 token, real version from Version/", () => {
  const { facts, result } = run({ userAgent: iphone("18_6", "Version/26.0 Mobile/15E148 Safari/604.1") });
  assert.deepEqual(facts.version, [26]);
  assert.equal(result.level, "ok");
});

test("iOS 26.5 Safari with 18_7 frozen token is ok", () => {
  const { result } = run({ userAgent: iphone("18_7", "Version/26.5 Mobile/15E148 Safari/604.1") });
  assert.equal(result.level, "ok");
  assert.equal(result.os, "iOS 26.5");
});

test("iOS newer than the list needs checking", () => {
  const { result } = run({ userAgent: iphone("18_7", "Version/26.6 Mobile/15E148 Safari/604.1") });
  assert.equal(result.level, "check");
  assert.match(result.items.at(-1).text, /還新/);
});

test("iOS 16.5 (gap in the list) suggests updating", () => {
  const { result } = run({ userAgent: iphone("16_5", "Version/16.5 Mobile/15E148 Safari/604.1") });
  assert.equal(result.level, "check");
  assert.equal(result.items.at(-1).help, "ios-update");
});

test("iOS 15.7 asks to confirm the iPhone model", () => {
  const { result } = run({ userAgent: iphone("15_7", "Version/15.6 Mobile/15E148 Safari/604.1") });
  assert.equal(result.level, "check");
  assert.equal(result.items[0].help, "ios-about");
});

test("real iOS 18.6 in Safari is exact, not frozen", () => {
  const { facts, result } = run({ userAgent: iphone("18_6", "Version/18.6 Mobile/15E148 Safari/604.1") });
  assert.equal(facts.precision, "exact");
  assert.equal(result.level, "ok");
});

test("LINE in-app browser on iOS 26 cannot see the version", () => {
  const { facts, result } = run({ userAgent: iphone("18_7", "Mobile/15E148 Safari Line/14.10.0") });
  assert.equal(facts.precision, "atLeast");
  assert.equal(result.level, "check");
  assert.equal(result.items.at(-1).help, "ios-open-safari");
});

test("Galaxy S23 Ultra on Android 14 is ok", () => {
  const { result } = run(android("SM-S918B", "14.0.0"));
  assert.equal(result.level, "ok");
  assert.equal(result.device, "Samsung Galaxy S23 Ultra");
});

test("Samsung on Android 16 asks about the security patch", () => {
  const { result } = run(android("SM-S931B", "16.0.0"));
  assert.equal(result.level, "check");
  assert.equal(result.items.at(-1).ask, "samsung-patch");
});

test("Pixel on Android 16 has no Samsung patch question", () => {
  const { result } = run(android("Pixel 9", "16.0.0"));
  assert.equal(result.level, "ok");
});

test("OPPO A79 5G is not listed", () => {
  const { result } = run(android("CPH2553", "14.0.0"));
  assert.equal(result.level, "no");
  assert.equal(result.device, "OPPO A79 5G");
});

test("unknown model code", () => {
  const { result } = run(android("XYZ-123", "14.0.0"));
  assert.equal(result.level, "unknown");
});

test("Chrome reduced UA without client hints cannot see the model", () => {
  const { result } = run({ userAgent: CHROME_REDUCED });
  assert.equal(result.level, "unknown");
});

test("Android WebView UA still exposes the model", () => {
  const ua = "Mozilla/5.0 (Linux; Android 13; SM-A156E Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36 Line/14.10.0";
  const { facts, result } = run({ userAgent: ua });
  assert.equal(facts.model, "SM-A156E");
  assert.equal(facts.modelSource, "ua");
  assert.equal(result.level, "ok");
});

test("Android newer than the list needs checking", () => {
  const { result } = run(android("Pixel 10", "17.0.0"));
  assert.equal(result.level, "check");
});

test("Android 7 is too old", () => {
  const { result } = run(android("SM-G930F", "7.0.0"));
  assert.equal(result.level, "no");
});

test("Android 8.1 and 10 carry the manufacturer-support caveat", () => {
  for (const pv of ["8.1.0", "10"]) {
    const { result } = run(android("SM-G960F", pv));
    assert.equal(result.level, "check", pv);
  }
});

test("iPad (desktop-mode Safari) is not supported", () => {
  const { result } = run({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  });
  assert.equal(result.level, "no");
});

test("desktop is 'other'", () => {
  const { result } = run({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
    maxTouchPoints: 0,
  });
  assert.equal(result.level, "unknown");
});

test("search by name and by model code", () => {
  const byName = search("s23 ultra", compat, models);
  assert.ok(byName.some((r) => r.label === "Samsung Galaxy S23 Ultra" && r.listed));
  const byCode = search("CPH2553", compat, models);
  assert.equal(byCode[0].label, "OPPO A79 5G");
  assert.equal(byCode[0].listed, false);
  assert.ok(search("iphone 15 pro", compat, models).every((r) => r.listed));
  assert.equal(search("iphone 7", compat, models).length, 0);
});

test("name matching respects word boundaries", async () => {
  const { nameMatches } = await import("../web/check.js");
  assert.ok(nameMatches("s23ultra", "Samsung Galaxy S23 Ultra"));
  assert.ok(nameMatches("S23 Ult", "Samsung Galaxy S23 Ultra"));
  assert.ok(nameMatches("a15", "Samsung Galaxy A15 5G"));
  assert.ok(nameMatches("note10+", "Samsung Galaxy Note10+"));
  assert.ok(!nameMatches("a15", "OPPO A1 5G"));
  const r = search("A15", compat, models).map((x) => x.label);
  assert.ok(!r.includes("OPPO A1 5G"), r.join(", "));
});
