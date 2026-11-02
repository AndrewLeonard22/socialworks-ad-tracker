// Proves the Meta numbers without Meta: runs src/lib/meta.ts on these fixtures
// (rollup, the leads rule, paging, one bad account, statuses, thumbnails,
// previews, the rejected-token and no-token cases), then the live request path
// against a stubbed fetch (appsecret_proof, the insights query, no retry and a
// cool-down on a rate limit, one retry on a temporary error, no retry on a dead
// token, the status-filter fallback).
//   node src/lib/__fixtures__/check.mjs        (from the repo root, Node 22.18+)
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const read = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));
const meta = await import("../meta.ts");
const FROM = "2026-10-03";
const TO = "2026-11-01";
const usd = (n) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const env = (vars) => {
  for (const k of ["META_FIXTURE", "META_ACCESS_TOKEN", "META_APP_SECRET", "NODE_ENV"]) delete process.env[k];
  Object.assign(process.env, vars);
};
let checks = 0;
const ok = (label) => console.log(`  ok ${++checks}  ${label}`);

/* ---------- expected numbers straight from the raw fixture rows (not via meta.ts) ---------- */
const insights = read("insights.json");
const rowsOf = (act) =>
  Object.entries(insights)
    .filter(([k]) => k === act || k.startsWith(`${act}|`))
    .flatMap(([, v]) => v.data ?? []);
const cents = (rows) => rows.reduce((s, r) => s + Math.round(Number(r.spend) * 100), 0);
const leadAction = (rows) =>
  rows.reduce((s, r) => s + Number(r.actions?.find((a) => a.action_type === "lead")?.value ?? 0), 0);
const LEADISH = ["lead", "onsite_conversion.lead_grouped", "leadgen_grouped", "leadgen.other", "offsite_conversion.fb_pixel_lead"];
const allLeadTypes = (rows) =>
  rows.reduce((s, r) => s + (r.actions ?? []).filter((a) => LEADISH.includes(a.action_type)).reduce((t, a) => t + Number(a.value), 0), 0);

console.log("\n1. Fixture mode (META_FIXTURE=1)");
env({ META_FIXTURE: "1" });
const o = await meta.getOverview(FROM, TO);
assert.equal(o.live, true);
assert.equal(o.accounts.length, 7);
ok("ad account list follows paging.next: 4 + 3 = 7 accounts");

const byId = Object.fromEntries(o.accounts.map((a) => [a.id, a]));
for (const a of o.accounts.filter((x) => !x.error)) {
  const rows = rowsOf(a.id);
  assert.equal(Math.round(a.spend * 100), cents(rows), a.name);
  assert.equal(a.leads, leadAction(rows), a.name);
  const sum = (list) => [Math.round(list.reduce((s, x) => s + x.spend * 100, 0)), list.reduce((s, x) => s + x.leads, 0)];
  assert.deepEqual(sum(a.campaigns), [Math.round(a.spend * 100), a.leads]);
  for (const c of a.campaigns) {
    const cr = rows.filter((r) => r.campaign_id === c.id);
    assert.deepEqual([Math.round(c.spend * 100), c.leads], [cents(cr), leadAction(cr)], c.name);
    assert.deepEqual(sum(c.adsets), [Math.round(c.spend * 100), c.leads]);
    for (const s of c.adsets) {
      const sr = cr.filter((r) => r.adset_id === s.id);
      assert.deepEqual([Math.round(s.spend * 100), s.leads], [cents(sr), leadAction(sr)], s.name);
      assert.deepEqual(sum(s.ads), [Math.round(s.spend * 100), s.leads]);
      for (const ad of s.ads) {
        const ar = sr.filter((r) => r.ad_id === ad.id);
        assert.deepEqual([Math.round(ad.spend * 100), ad.leads, ad.name], [cents(ar), leadAction(ar), ar[0].ad_name]);
      }
      for (let i = 1; i < s.ads.length; i++) assert.ok(s.ads[i - 1].spend >= s.ads[i].spend);
    }
    for (let i = 1; i < c.adsets.length; i++) assert.ok(c.adsets[i - 1].spend >= c.adsets[i].spend);
  }
  for (let i = 1; i < a.campaigns.length; i++) assert.ok(a.campaigns[i - 1].spend >= a.campaigns[i].spend);
}
ok("every ad, ad set, campaign and account equals its fixture rows; children add up to parents; biggest spend first");

const washbroz = byId.act_322974296642516;
assert.equal(washbroz.campaigns.flatMap((c) => c.adsets.flatMap((s) => s.ads)).length, 13);
ok("Washbroz insights span two pages (8 + 5 rows): 13 ads");

/* the real last_30d account figures from the research (Ads Manager's Leads column) */
const REAL = {
  act_889944390092906: [3015.15, 184, "16.39"],
  act_10170221: [1184.46, 11, "107.68"],
  act_322974296642516: [4047.49, 114, "35.50"],
  act_1463834608824526: [880.37, 13, "67.72"],
};
console.log("\n     account                                          spend   leads   cost/lead   all lead types summed");
let totalCents = 0;
let totalLeads = 0;
for (const a of o.accounts) {
  const cpl = a.error ? "" : a.leads ? usd(a.spend / a.leads) : "–";
  const naive = a.error ? 0 : allLeadTypes(rowsOf(a.id));
  const line = a.error
    ? `     ${a.name.padEnd(44)} ${a.error}`
    : `     ${a.name.padEnd(44)} ${usd(a.spend).padStart(10)} ${String(a.leads).padStart(7)} ${cpl.padStart(11)}   ${naive !== a.leads ? `${naive} (would double count)` : ""}`;
  console.log(line);
  if (!a.error) {
    totalCents += Math.round(a.spend * 100);
    totalLeads += a.leads;
  }
  if (REAL[a.id]) {
    assert.equal(a.spend, REAL[a.id][0]);
    assert.equal(a.leads, REAL[a.id][1]);
    assert.equal((a.spend / a.leads).toFixed(2), REAL[a.id][2]);
  }
}
console.log(`     ${"TOTAL".padEnd(44)} ${usd(totalCents / 100).padStart(10)} ${String(totalLeads).padStart(7)} ${usd(totalCents / 100 / totalLeads).padStart(11)}\n`);
assert.equal(totalCents, 912747);
assert.equal(totalLeads, 322);
ok("account totals match the real Ads Manager figures: $9,127.47, 322 leads, $28.35 per lead overall");

const fence = byId.act_10170221.campaigns.find((c) => c.id === "6620957911515");
assert.equal(fence.leads, 3);
assert.equal((fence.spend / fence.leads).toFixed(2), "114.10");
ok("Columbia 'Fence': 3 leads (2 form + 1 Messenger), $114.10 per lead, as Ads Manager shows (Results would say 2)");
const deck = byId.act_1463834608824526.campaigns[0].adsets[0].ads.find((x) => x.id === "120214876520030351");
assert.equal(deck.leads, 8);
ok("Archadeck video ad: lead = 8 (6 form + 2 Pixel); summing every lead type would say 28");
const site = byId.act_889944390092906.campaigns.find((c) => c.id === "52540577081745");
assert.deepEqual([site.spend, site.leads], [36.6, 0]);
ok("Summerhouse website Schedule campaign: $36.60 spend counted, 0 leads (no `lead` action)");
assert.equal(meta.leadsOf([{ action_type: "onsite_conversion.lead_grouped", value: "9" }, { action_type: "leadgen.other", value: "9" }]), 0);
assert.equal(meta.leadsOf(undefined), 0);
assert.equal(meta.leadsOf([{ action_type: "lead", value: "abc" }]), 0);
ok("leadsOf reads only `lead`; missing or unreadable values count 0");

assert.deepEqual(o.errors, [{ id: "act_602118833471205", message: "No access to this ad account in Meta" }]);
assert.deepEqual([byId.act_841724902001604.spend, byId.act_841724902001604.leads, byId.act_841724902001604.campaigns], [0, 0, []]);
ok("one account without access fails on its own (errors[]); the other six load; no-delivery accounts are $0 / 0");

const det = await meta.getAccountDetails("322974296642516");
const ads = read("ads.json").act_322974296642516.data;
const creatives = read("creatives.json");
assert.equal(det.status["120203557760280351"], "ACTIVE");
assert.equal(det.status["120203557760280353"], "PAUSED");
assert.equal(det.status["120212450961260363"], "WITH_ISSUES");
const image = ads.find((x) => x.id === "120208114785550351");
const dynamic = ads.find((x) => x.id === "120203557760280356");
assert.equal(det.thumbs[image.id], image.creative.image_url);
assert.equal(det.thumbs[dynamic.id], creatives[dynamic.creative.id].thumbnail_url);
assert.notEqual(det.thumbs[dynamic.id], dynamic.creative.thumbnail_url);
ok("details: campaign / ad set / ad statuses; image ads use image_url, video and dynamic ads the 152px batch read (not the 64px default)");

const fb = await meta.getPreview("120214876520030352");
assert.equal(fb.src, "https://www.facebook.com/ads/api/preview_iframe.php?d=AQLx3f0pV9xYcHgmQ7wWJc2Ubt8n1Kz5&t=AQJm4oPqRs2Tu6Vw");
assert.deepEqual([fb.width, fb.height], [335, 450]);
await assert.rejects(meta.getPreview("52540577081747"), /no preview/);
assert.equal(meta.previewFrame('<iframe src="javascript:alert(1)" width="1"></iframe>'), null);
ok("preview: signed src taken exactly (&amp; decoded), size kept; empty answer and non-https src refused");

console.log("\n2. Rejected token (META_FIXTURE=error)");
env({ META_FIXTURE: "error" });
const rejected = await meta.getOverview(FROM, TO);
assert.equal(rejected.live, false);
assert.equal(rejected.reason, "meta-error");
assert.match(rejected.message, /rejected the access token/);
ok(`meta-error: "${rejected.message}"`);

console.log("\n3. No token, and the fixture switch in production");
env({});
assert.deepEqual(await meta.getOverview(FROM, TO), { live: false, reason: "no-token" });
ok("no META_ACCESS_TOKEN: { live: false, reason: 'no-token' } (the app keeps its dummy data)");
env({ NODE_ENV: "production", META_FIXTURE: "1" });
assert.deepEqual(await meta.getOverview(FROM, TO), { live: false, reason: "no-token" });
ok("META_FIXTURE=1 is ignored when NODE_ENV=production");
env({ META_FIXTURE: "true" });
assert.deepEqual(await meta.getOverview(FROM, TO), { live: false, reason: "no-token" });
ok("only META_FIXTURE=1 or =error switch fixtures on");

console.log("\n4. Live request path, fetch stubbed (no network)");
const realFetch = globalThis.fetch;
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const row = (spend, actions) => ({
  campaign_id: "1", campaign_name: "C", adset_id: "2", adset_name: "S", ad_id: "3", ad_name: "A", spend, actions,
});
const leadActions = [
  { action_type: "leadgen_grouped", value: "4" },
  { action_type: "lead", value: "4" },
  { action_type: "onsite_conversion.lead_grouped", value: "4" },
];
let calls = [];
const stub = (handler) => {
  calls = [];
  globalThis.fetch = async (url, init) => {
    const u = new URL(url);
    calls.push(u);
    return handler(u, init);
  };
};

env({ META_ACCESS_TOKEN: "TOKEN_A", META_APP_SECRET: "SECRET" });
stub((u) => {
  if (u.pathname === "/v26.0/me/adaccounts") return reply(200, { data: [{ id: "act_1", name: "Test", account_status: 1, currency: "USD" }] });
  if (u.pathname === "/v26.0/act_1/insights") {
    return reply(400, { error: { message: "(#80000) There have been too many calls from this ad-account.", type: "OAuthException", code: 80000, error_subcode: 2446079 } });
  }
  return reply(400, { error: { message: "unexpected call", code: 100 } });
});
const insightCalls = () => calls.filter((u) => u.pathname.endsWith("/insights")).length;
const limited = await meta.getOverview("2026-10-01", "2026-10-31");
assert.equal(limited.reason, "meta-error");
assert.match(limited.message, /rate limit/);
assert.equal(insightCalls(), 1);
await meta.getOverview("2026-10-01", "2026-10-31");
assert.equal(insightCalls(), 1);
ok("rate limit (code 80000): no instant retry, and the throttled account is not called again during the cool-down");

env({ META_ACCESS_TOKEN: "TOKEN_A2", META_APP_SECRET: "SECRET" });
let hiccup = false;
stub((u) => {
  if (u.pathname === "/v26.0/me/adaccounts") return reply(200, { data: [{ id: "act_1", name: "Test", account_status: 1, currency: "USD" }] });
  if (u.pathname === "/v26.0/act_1/insights") {
    if (!hiccup) {
      hiccup = true;
      return reply(500, { error: { message: "An unexpected error has occurred. Please retry your request later.", type: "OAuthException", code: 2 } });
    }
    return reply(200, { data: [row("10.10", leadActions)] });
  }
  return reply(400, { error: { message: "unexpected call", code: 100 } });
});
const live = await meta.getOverview("2026-10-01", "2026-10-31");
assert.equal(live.live, true);
assert.deepEqual([live.accounts[0].spend, live.accounts[0].leads], [10.1, 4]);
const ins = calls.filter((u) => u.pathname.endsWith("/insights"));
assert.equal(ins.length, 2);
ok("temporary Meta error (code 2): one retry, then the numbers");
const q = ins[1].searchParams;
assert.equal(q.get("access_token"), "TOKEN_A2");
assert.equal(q.get("appsecret_proof"), createHmac("sha256", "SECRET").update("TOKEN_A2").digest("hex"));
assert.equal(`${ins[1].host}${ins[1].pathname}`, "graph.facebook.com/v26.0/act_1/insights");
assert.equal(q.get("level"), "ad");
assert.equal(q.get("fields"), "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,actions");
assert.deepEqual(JSON.parse(q.get("time_range")), { since: "2026-10-01", until: "2026-10-31" });
assert.ok(JSON.parse(q.get("filtering"))[0].value.includes("ARCHIVED"));
assert.equal(q.get("action_attribution_windows"), null);
assert.ok(calls.every((u) => u.searchParams.get("appsecret_proof")));
ok("every call carries appsecret_proof = HMAC-SHA256(app secret, token); one level=ad call per account for the exact range");

env({ META_ACCESS_TOKEN: "TOKEN_B" });
stub(() => reply(400, { error: { message: "Error validating access token: Session has expired.", type: "OAuthException", code: 190, error_subcode: 463 } }));
const dead = await meta.getOverview("2026-10-01", "2026-10-31");
assert.equal(dead.reason, "meta-error");
assert.equal(calls.length, 1);
assert.equal(calls[0].searchParams.get("appsecret_proof"), null);
ok("dead token (code 190): meta-error after one call, no retry; no app secret, no proof");

env({ META_ACCESS_TOKEN: "TOKEN_C" });
stub((u) => {
  if (u.pathname === "/v26.0/me/adaccounts") return reply(200, { data: [{ id: "act_2", name: "Test 2", account_status: 1, currency: "USD" }] });
  if (u.searchParams.get("filtering")) return reply(400, { error: { message: "(#100) Filtering field 'ad.effective_status' is invalid.", code: 100 } });
  return reply(200, { data: [row("5.00", leadActions)] });
});
const fallback = await meta.getOverview("2026-10-01", "2026-10-31");
assert.deepEqual([fallback.live, fallback.accounts[0].spend, fallback.accounts[0].leads], [true, 5, 4]);
ok("if Meta refuses the archived/deleted status filter, the same call runs without it");

env({ META_ACCESS_TOKEN: "TOKEN_D", META_APP_SECRET: "SECRET" });
let batchCall = null;
stub((u, init) => {
  if (u.pathname === "/v26.0/act_9/campaigns") return reply(200, { data: [{ id: "c1", effective_status: "ACTIVE" }] });
  if (u.pathname === "/v26.0/act_9/adsets") return reply(200, { data: [{ id: "s1", effective_status: "PAUSED" }] });
  if (u.pathname === "/v26.0/act_9/ads") {
    return reply(200, {
      data: [
        { id: "a1", effective_status: "ACTIVE", creative: { id: "cr1", image_url: "https://cdn/full.jpg", thumbnail_url: "https://cdn/p64x64-a.jpg" } },
        { id: "a2", effective_status: "ADSET_PAUSED", creative: { id: "cr2", thumbnail_url: "https://cdn/p64x64-b.jpg" } },
      ],
    });
  }
  if (u.pathname === "/v26.0" && init?.method === "POST") {
    batchCall = { u, form: new URLSearchParams(init.body) };
    return reply(200, [{ code: 200, body: JSON.stringify({ thumbnail_url: "https://cdn/p152x152-b.jpg", id: "cr2" }) }]);
  }
  if (u.pathname === "/v26.0/77/previews") {
    return reply(200, { data: [{ body: '<iframe src="https://www.facebook.com/ads/api/preview_iframe.php?d=AQ1&amp;t=AQ2" width="335" height="450" scrolling="yes" style="border: none;"></iframe>' }] });
  }
  return reply(400, { error: { message: "unexpected call", code: 100 } });
});
const d2 = await meta.getAccountDetails("9");
assert.deepEqual(d2.status, { c1: "ACTIVE", s1: "PAUSED", a1: "ACTIVE", a2: "ADSET_PAUSED" });
assert.deepEqual(d2.thumbs, { a1: "https://cdn/full.jpg", a2: "https://cdn/p152x152-b.jpg" });
assert.deepEqual(JSON.parse(batchCall.form.get("batch")), [
  { method: "GET", relative_url: "cr2?fields=thumbnail_url&thumbnail_width=152&thumbnail_height=152" },
]);
assert.equal(batchCall.form.get("access_token"), "TOKEN_D");
assert.equal(batchCall.form.get("appsecret_proof"), createHmac("sha256", "SECRET").update("TOKEN_D").digest("hex"));
assert.equal(`${batchCall.u.href}`, "https://graph.facebook.com/v26.0");
ok("details: 3 edge reads for statuses; one batch POST (token + proof as form fields) re-reads only the non-image creative at 152px");
const pv = await meta.getPreview("77");
assert.deepEqual(pv, { src: "https://www.facebook.com/ads/api/preview_iframe.php?d=AQ1&t=AQ2", width: 335, height: 450 });
assert.equal(calls.at(-1).searchParams.get("ad_format"), "MOBILE_FEED_STANDARD");
ok("preview: /<ad id>/previews?ad_format=MOBILE_FEED_STANDARD, signed iframe src returned as is");
globalThis.fetch = realFetch;

console.log(`\nAll ${checks} checks passed.\n`);
