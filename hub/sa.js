/* ZUVAND Servis — satış, anbar, mühasibat (hub tərəfi).
   Qaydalar köhnə "Satış və Anbar" proqramının eyni nüvəsidir (sa-core.js); məlumat data/sa/*.json fayllarındadır. */
"use strict";
const fs = require("fs"), path = require("path");
const SA = require("./sa-core.js");
const COLS = ["items", "moves", "quotes", "invoices", "contracts", "expenses"];
let db = null, DIR = "", log = () => { };
const SYS = { name: "Servis (təsdiq)", role: "admin" };

function readJSON(f, d) { try { return JSON.parse(fs.readFileSync(f, "utf8")) } catch (e) { return d } }
function writeJSON(f, v) { fs.mkdirSync(path.dirname(f), { recursive: true }); const t = f + ".tmp" + process.pid; fs.writeFileSync(t, JSON.stringify(v)); fs.renameSync(t, f) }

function load(dataDir, seedDir, logger) {
  DIR = path.join(dataDir, "sa"); if (logger) log = logger;
  const fresh = !fs.existsSync(path.join(DIR, "items.json"));
  db = { settings: readJSON(path.join(DIR, "settings.json"), {}) };
  COLS.forEach(k => db[k] = readJSON(path.join(DIR, k + ".json"), []));
  if (fresh) {
    /* first start: the catalog brought over from the old Satış program */
    const seed = readJSON(path.join(seedDir, "catalog.json"), []), used = {};
    for (const x of seed) {
      let code = String(x.code || "").trim() || "KOD"; while (used[code.toLowerCase()]) code += "."; used[code.toLowerCase()] = 1;
      try { run(SYS, "saveItem", { item: Object.assign({}, x, { code }) }) } catch (e) { log(null, "seed-error", code + " " + (e.code || e.message)) }
    }
    COLS.forEach(k => writeJSON(path.join(DIR, k + ".json"), db[k])); writeJSON(path.join(DIR, "settings.json"), db.settings);
  }
}
function save(ch) {
  COLS.forEach(k => { if (ch[k] && ch[k].length || k === "items" && ch.itemsGone) writeJSON(path.join(DIR, k + ".json"), db[k]) });
  if (ch.settings) writeJSON(path.join(DIR, "settings.json"), db.settings);
}
function run(u, action, body) { const o = SA.saHandle(db, u, action, body || {}); SA.saApply(db, o.ch); save(o.ch); return o.res }

/* an approved service report becomes (or updates) a sale at once */
function importReports(list) {
  if (!list.length) return { created: [], updated: [], nocontract: 0, skipped: 0 };
  const r = run(SYS, "serviceImport", { reports: list, from: "" });
  if (r.created.length || r.updated.length) log(SYS, "svc-sale", r.created.concat(r.updated).join(", "));
  return r;
}
const safeName = s => String(s || "").replace(/[\\/:*?"<>|\x00-\x1f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "_";

/* u: {name, role:"admin"|"p:satis,anbar,…", perms:[…]} */
function api(u, body, ctx) {
  const action = String(body.action || "");
  if (action === "pdf") {
    if (!SA.SA_CAN.quote(u.role) && !SA.SA_CAN.seeMoves(u.role)) { const e = new Error("forbidden"); e.code = "forbidden"; throw e }
    if (!body.data) { const e = new Error("bad_pdf"); e.code = "bad_pdf"; throw e }
    const rel = ["pdf", body.invId ? "Qaimələr" : "Qiymət təklifləri", safeName(body.client || "Müştərisiz"), safeName(body.name || "sened.pdf")];
    if (!/\.pdf$/i.test(rel[3])) rel[3] += ".pdf";
    const f = path.join(ctx.dataDir, ...rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.from(String(body.data), "base64"));
    const url = "http://" + ctx.host + "/files/" + rel.map(encodeURIComponent).join("/");
    if (body.invId && SA.SA_CAN.invoice(u.role)) { try { run(u, "setInvoicePdf", { id: body.invId, url }) } catch (e) { } }
    return { url };
  }
  /* the shared client base of the service journal, for filling in quotes */
  if (action === "customers") return { customers: ctx.customers ? ctx.customers() : [] };
  /* restore a Satış və Anbar backup (from the Google version or another computer): all data is replaced; the current data is copied aside first */
  if (action === "look_get") return { look: readJSON(path.join(DIR, "..", "look.json"), null) };
  if (action === "look_set") {
    if (!SA.SA_CAN.admin(u.role)) { const e = new Error("forbidden"); e.code = "forbidden"; throw e }
    writeJSON(path.join(DIR, "..", "look.json"), body.look === undefined ? null : body.look); return { ok: true };
  }
  if (action === "restoreAll") {
    if (!SA.SA_CAN.admin(u.role)) { const e = new Error("forbidden"); e.code = "forbidden"; throw e }
    const d = body.db || {}; if (!Array.isArray(d.items) || !Array.isArray(d.quotes)) { const e = new Error("bad_backup"); e.code = "bad_backup"; throw e }
    const snap = DIR + "-berpadan-evvel-" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    try { fs.mkdirSync(snap, { recursive: true }); for (const f of fs.readdirSync(DIR)) if (f.endsWith(".json")) fs.copyFileSync(path.join(DIR, f), path.join(snap, f)) } catch (e) { }
    COLS.forEach(k => db[k] = Array.isArray(d[k]) ? d[k] : []);
    db.settings = Object.assign({}, d.settings && typeof d.settings === "object" ? d.settings : {});
    COLS.forEach(k => writeJSON(path.join(DIR, k + ".json"), db[k])); writeJSON(path.join(DIR, "settings.json"), db.settings);
    const n = {}; COLS.forEach(k => n[k] = db[k].length); log(u, "sa-restore", JSON.stringify(n));
    return { restored: n, snapshot: snap };
  }
  if (action === "svcPull") {
    if (!SA.SA_CAN.contract(u.role)) { const e = new Error("forbidden"); e.code = "forbidden"; throw e }
    const list = ctx.approvedReports(); const r = importReports(list); return Object.assign({ found: list.length }, r);
  }
  const res = run(u, action, body);
  if (action === "delItems" && res.deleted) log(u, "sa-delItems", String(res.deleted));
  if (action === "boot" || action === "ping") { res.perms = u.perms; res.role = u.role; res.name = u.name; res.settings = Object.assign({}, res.settings || {}, { svcSheet: "hub" }) }
  return res;
}
function payInfo() { return SA.saPayInfo(db) }
const fnKeys = () => (SA.SA_FN || []).map(f => f[0]);
module.exports = { load, api, importReports, run, payInfo, fnKeys, db: () => db };
