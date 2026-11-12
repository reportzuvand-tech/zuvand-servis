/* ZUVAND Servis — ofis hub-ı
   Bütün məlumat bu kompüterdə, data qovluğunda JSON fayllarda saxlanılır.
   Telefonlar və kompüterlər işini öz yaddaşında görür, şəbəkəyə qoşulanda bu hub ilə sinxronlaşır.
   Asılılıq yoxdur: yalnız Node.js (18+). Başlatmaq: node server.js */
"use strict";
const http = require("http"), https = require("https"), fs = require("fs"), path = require("path"), os = require("os"), crypto = require("crypto");

const ROOT = __dirname;
const SAM = require("./sa.js");
/* modules the manager can give a person (Ayarlar → İşçilər) */
/* sv_*: sections of the service journal a person without "servis" can still use (accountant, storekeeper …) */
const MODS = ["servis", "tesdiq", "satis", "anbar", "muhasibat", "xerc", "sv_view", "sv_plan", "sv_parts", "sv_staff", "sv_cust", "sv_pay", "sv_stats"];
/* positions (vəzifələr): a named set of modules the manager gives a worker in one step */
const DEF_POSITIONS = [["Servis mühəndisi", ["servis", "sv_plan", "sv_parts"]], ["Servis müdiri", ["servis", "tesdiq"]], ["Satış meneceri", ["satis"]], ["Anbardar", ["anbar", "sv_parts", "sv_view"]], ["Mühasib", ["muhasibat", "xerc", "sv_view", "sv_staff", "sv_pay", "sv_stats", "sv_parts"]]];
const positions = () => { if (!Array.isArray(meta.positions)) meta.positions = DEF_POSITIONS.map(([name, perms], i) => ({ id: "p" + (i + 1), name, perms })); return meta.positions };
const wOut = (u) => ({ workers: u && !u.boss ? users.map(w => Object.assign({}, w, { key: "" })) : users, sharedOff: !!meta.sharedOff, mods: MODS, positions: positions() });
const CONF = Object.assign({ port: 8787, dataDir: "data", backupDir: "backup", keepBackups: 14, keepVersions: 30 },
  readJSON(path.join(ROOT, "hub-config.json"), {}));
const PORT = +process.env.ZS_PORT || CONF.port;
const DATA = path.resolve(ROOT, process.env.ZS_DATA || CONF.dataDir);
const BACKUP = path.resolve(ROOT, process.env.ZS_BACKUP || CONF.backupDir);
const APP = path.resolve(ROOT, process.env.ZS_APP || "app");
const MAX_BODY = 40 * 1024 * 1024;

/* ---------------- files ---------------- */
function readJSON(f, def) { try { return JSON.parse(fs.readFileSync(f, "utf8")) } catch (e) { return def } }
function writeJSON(f, v) { fs.mkdirSync(path.dirname(f), { recursive: true }); const t = f + ".tmp" + process.pid; fs.writeFileSync(t, JSON.stringify(v)); fs.renameSync(t, f) }
const P = (...a) => path.join(DATA, ...a);
const safeName = s => String(s || "").replace(/[\\/:*?"<>|\x00-\x1f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "_";
const safeId = s => /^[\w.-]{1,80}$/.test(String(s || "")) ? String(s) : null;
const now = () => Date.now();
const newKey = () => crypto.randomBytes(10).toString("hex");
const newId = p => p + now().toString(36) + crypto.randomBytes(3).toString("hex");

/* ---------------- state (kept in memory, written through to disk) ---------------- */
let users, meta, tasks, ratings, customers, catalog, deleted;
const reports = new Map(); /* id -> {report, summary, items, pdf, savedAt, savedBy, creator} */

function load() {
  fs.mkdirSync(P("reports"), { recursive: true });
  /* first start: the client base and the catalog brought over from the old programs */
  for (const f of ["customers.json", "catalog.json"]) { const seed = path.join(ROOT, "seed", f); if (!fs.existsSync(P(f)) && fs.existsSync(seed)) fs.copyFileSync(seed, P(f)) }
  users = readJSON(P("users.json"), []);
  meta = readJSON(P("meta.json"), {});
  tasks = readJSON(P("tasks.json"), []);
  ratings = readJSON(P("ratings.json"), {});
  customers = readJSON(P("customers.json"), []);
  catalog = readJSON(P("catalog.json"), []);
  deleted = readJSON(P("deleted.json"), {});
  if (!meta.sharedKey) meta.sharedKey = newKey();
  if (!meta.settings) meta.settings = {};
  if (!users.length) {
    users.push({ id: newId("w"), name: "Rəhbər", role: "admin", key: newKey(), email: "", active: true, created: now() });
    writeJSON(P("users.json"), users);
  }
  writeJSON(P("meta.json"), meta);
  for (const f of fs.readdirSync(P("reports"))) {
    if (!f.endsWith(".json")) continue;
    const rec = readJSON(P("reports", f), null);
    if (rec && rec.report && rec.report.id) reports.set(rec.report.id, rec);
  }
  writeKeysFile();
}
const saveUsers = () => { writeJSON(P("users.json"), users); writeKeysFile() };
const saveMeta = () => writeJSON(P("meta.json"), meta);
const saveTasks = () => writeJSON(P("tasks.json"), tasks);
const saveRatings = () => writeJSON(P("ratings.json"), ratings);
const saveDeleted = () => writeJSON(P("deleted.json"), deleted);
function saveReport(rec) { reports.set(rec.report.id, rec); writeJSON(P("reports", rec.report.id + ".json"), rec) }

function lanIPs() { const out = []; for (const L of Object.values(os.networkInterfaces())) for (const a of L || []) if (a.family === "IPv4" && !a.internal) out.push(a.address); return out }
function writeKeysFile() {
  const lines = ["ZUVAND Servis — açarlar və ünvanlar", "", "Bu kompüterdə: http://localhost:" + PORT,
    ...lanIPs().map(ip => "Telefonlar üçün (eyni Wi-Fi): http://" + ip + ":" + PORT), "",
    "İşçilərin şəxsi açarları (Ayarlar → İşçilər bölməsindən idarə olunur):",
    ...users.map(u => "  " + u.name + " (" + (u.role === "admin" ? "rəhbər" : "işçi") + (u.active === false ? ", bloklanıb" : "") + "): " + u.key),
    "", "Ortaq işçi açarı" + (meta.sharedOff ? " (söndürülüb)" : "") + ": " + meta.sharedKey, ""];
  try { fs.writeFileSync(P("ACARLAR.txt"), lines.join("\r\n")) } catch (e) { }
}
function log(u, action, info) {
  try { fs.appendFileSync(P("log.txt"), new Date().toISOString() + "\t" + (u ? u.name : "-") + "\t" + action + "\t" + (info || "") + "\n") } catch (e) { }
}

/* ---------------- backup: JSON data once a day (photos and PDFs never change, they are not copied) ---------------- */
function copyDir(src, dst) { fs.mkdirSync(dst, { recursive: true }); for (const e of fs.readdirSync(src, { withFileTypes: true })) { const s = path.join(src, e.name), d = path.join(dst, e.name); if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d) } }
function backup() {
  try {
    const day = new Date().toISOString().slice(0, 10), dst = path.join(BACKUP, day);
    if (fs.existsSync(dst)) return;
    fs.mkdirSync(dst, { recursive: true });
    for (const f of fs.readdirSync(DATA)) { if (f.endsWith(".json")) fs.copyFileSync(P(f), path.join(dst, f)) }
    copyDir(P("reports"), path.join(dst, "reports"));
    if (fs.existsSync(P("sa"))) copyDir(P("sa"), path.join(dst, "sa"));
    const all = fs.readdirSync(BACKUP).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort();
    while (all.length > CONF.keepBackups) fs.rmSync(path.join(BACKUP, all.shift()), { recursive: true, force: true });
    log(null, "backup", day);
  } catch (e) { log(null, "backup-error", e.message) }
}

/* ---------------- API ---------------- */
class ApiErr extends Error { constructor(code, extra) { super(code); this.code = code; this.extra = extra } }
const err = (c, x) => { throw new ApiErr(c, x) };

/* a worker's own on/off choices for single functions of Satış və Anbar ("+seeCost", "-quote"), on top of the modules */
const fnOf = x => { const o = []; (Array.isArray(x) ? x : []).forEach(t => { t = String(t); if (/^[+-][A-Za-z]{2,30}$/.test(t) && SAM.fnKeys().includes(t.slice(1)) && !o.some(y => y.slice(1) === t.slice(1))) o.push(t) }); return o };
const permsOf = x => x.role === "admin" ? MODS.slice() : (Array.isArray(x.perms) ? x.perms.filter(m => MODS.includes(m)) : ["servis"]);
function auth(key) {
  key = String(key || "").trim(); if (!key) err("auth");
  const u = users.find(x => x.key === key);
  if (u) {
    if (u.active === false) err("auth"); const perms = permsOf(u), boss = u.role === "admin";
    /* in the service screen the service head (tesdiq) works like the manager: approves, gives tasks, deletes */
    return { id: u.id, name: u.name, role: boss || perms.includes("tesdiq") ? "admin" : "worker", boss, perms, personal: true, saRole: boss ? "admin" : "p:" + perms.concat(fnOf(u.fn)).join(",") };
  }
  if (key === meta.sharedKey && !meta.sharedOff) return { id: "", name: "", role: "worker", boss: false, perms: ["servis"], personal: false, saRole: "p:servis" };
  err("auth");
}
const who = u => ({ role: u.role, name: u.name, personal: u.personal, boss: u.boss, perms: u.perms });
const needAdmin = u => { if (u.role !== "admin") err("forbidden") };
const needBoss = u => { if (!u.boss) err("forbidden") };
const needServis = u => { if (u.role !== "admin" && !u.perms.includes("servis")) err("forbidden") };
const approvedReports = () => [...reports.values()].map(r => r.report).filter(r => r.appr && r.appr.at);
const SETTING_KEYS = ["co", "coaddr", "cotel", "notify", "interval", "warn", "fail", "vwarn", "vfail", "vhigh", "life", "dwarn", "dfail", "dmin", "repHead"];

function snsOf(r) { const c = x => String(x == null ? "" : x).replace(/[|\r\n]+/g, " ").trim(); return ((r && r.devices) || []).filter(d => d && d.type !== "pq" && d.info && c(d.info.sn)).map(d => [c(d.info.sn), c(d.type), c(d.info.brand), c(d.info.model), c(d.info.kva), c(d.loc)].join(" | ")).join("\n") }
function summaryOf(rec) { return Object.assign({}, rec.summary || {}, { sns: (rec.summary && rec.summary.sns) || snsOf(rec.report), payer: (rec.summary && rec.summary.payer) || String((rec.report.cl && rec.report.cl.payer) || "").trim(), id: rec.report.id, updatedAt: rec.report.updatedAt || 0, pdf: rec.pdf || "", creator: rec.creator || "", appr: rec.report.appr && rec.report.appr.at ? (rec.report.appr.by || "✓") : "", sub: rec.report.sub && rec.report.sub.at ? (rec.report.sub.by || "✓") : "" }) }
function versionsDir(id) { return P("versions", id) }
/* a customer's (or engineer's) signature is never lost by a later save: it goes only when the signature is deleted on purpose (sigDel) */
function keepSig(old, r) {
  const os = (old && old.sig) || {}, del = (r && r.sigDel) || {}; let n = 0;
  Object.keys(os).forEach(k => { const o = os[k]; if (!o || !o.img) return; const x = r.sig && r.sig[k]; if (x && x.img) return;
    if ((+del[k] || 0) >= (Date.parse(o.at) || 0)) return; r.sig = r.sig || {}; r.sig[k] = o; n++ });
  if (n && !r.sigSnap && old.sigSnap) r.sigSnap = old.sigSnap; return n;
}
/* signatures in r that the stored report lacks (or has older) */
function newSigs(old, r) { const os = (old && old.sig) || {}, ns = (r && r.sig) || {}; return Object.keys(ns).filter(k => ns[k] && ns[k].img && (!os[k] || !os[k].img || (Date.parse(ns[k].at) || 0) > (Date.parse(os[k].at) || 0))) }
const stripData = o => JSON.parse(JSON.stringify(o, (k, v) => typeof v === "string" && /^data:/.test(v) ? "[şəkil]" : v));
function keepVersion(rec) {
  const dir = versionsDir(rec.report.id); fs.mkdirSync(dir, { recursive: true });
  writeJSON(path.join(dir, (rec.savedAt || now()) + ".json"), { report: rec.report, by: rec.savedBy || "", at: rec.savedAt || now() });
  const all = fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort();
  while (all.length > CONF.keepVersions) fs.rmSync(path.join(dir, all.shift()), { force: true });
}
const taskOut = () => ({ tasks });

/* ---------- yeniləmə: hub yeni versiyanı GitHub-dan yükləyir və özü yenidən başlayır ---------- */
const UPD_RAW = process.env.ZS_UPD_RAW || "https://raw.githubusercontent.com/reportzuvand-tech/zuvand-servis/main/";
function updGet(u, n) {
  return new Promise((res, rej) => {
    const r = (u.startsWith("http:") ? http : https).get(u + (u.includes("?") ? "&" : "?") + "t=" + now(), { headers: { "User-Agent": "zuvand-servis-hub" }, timeout: 30000 }, x => {
      if ([301, 302, 307, 308].includes(x.statusCode) && x.headers.location && (n || 0) < 3) { x.resume(); return updGet(x.headers.location, (n || 0) + 1).then(res, rej) }
      if (x.statusCode !== 200) { x.resume(); return rej(new ApiErr("upd_http_" + x.statusCode)) }
      const c = []; x.on("data", d => c.push(d)); x.on("end", () => res(Buffer.concat(c).toString("utf8"))); x.on("error", rej)
    });
    r.on("timeout", () => r.destroy(new ApiErr("upd_timeout"))); r.on("error", e => rej(e instanceof ApiErr ? e : new ApiErr("upd_net")))
  })
}
async function updVersion() { const j = JSON.parse(await updGet(UPD_RAW + "version.json")); if (!j || !j.v || !j.hub) err("upd_bad"); return j }
function updCur() { try { const m = /ZS_BUILD=(\d+);/.exec(fs.readFileSync(path.join(APP, "index.html"), "utf8").slice(0, 4000)); return m ? +m[1] : 0 } catch (e) { return 0 } }
let updBusy = false;
async function updApply() {
  if (updBusy) err("upd_busy"); updBusy = true;
  try {
    const j = await updVersion(), v = +j.v, got = [];
    for (const [dst, src] of Object.entries(j.hub)) {
      const f = path.resolve(ROOT, dst); if (!inside(ROOT, f)) err("upd_bad");
      const t = await updGet(UPD_RAW + src);
      if (/\.html$/.test(dst) && t.indexOf("ZS_BUILD=" + v + ";") < 0) err("upd_verify");
      if (/\.js$/.test(dst)) { try { new (require("vm").Script)(t, { filename: dst }) } catch (e) { err("upd_verify") } }
      got.push([f, t]);
    }
    const old = path.join(ROOT, "_kohne", new Date().toISOString().replace(/[:.]/g, "-"));
    for (const [f] of got) if (fs.existsSync(f)) { const b = path.join(old, path.relative(ROOT, f)); fs.mkdirSync(path.dirname(b), { recursive: true }); fs.copyFileSync(f, b) }
    for (const [f, t] of got) { fs.mkdirSync(path.dirname(f), { recursive: true }); const tmp = f + ".yeni"; fs.writeFileSync(tmp, t); fs.renameSync(tmp, f) }
    log(null, "upd", "Hub yeniləndi: " + v);
    setTimeout(updRestart, 800);
    return { v, files: got.length }
  } finally { updBusy = false }
}
function updRestart() {
  try {
    const cp = require("child_process");
    cp.spawn(process.execPath, process.argv.slice(1), { cwd: process.cwd(), detached: true, stdio: "ignore", windowsHide: true, env: Object.assign({}, process.env, { ZS_RESTART: "1" }) }).unref();
  } catch (e) { return }
  try { server.close() } catch (e) { }
  setTimeout(() => process.exit(0), 300);
}
/* ---------- təhlükəsizlik: sıfırlama parolu (yalnız duzlu heş saxlanılır), fəaliyyət jurnalı, zavod sıfırlaması ---------- */
const pwFail = { n: 0, until: 0 };
const pwHash = pwh => { if (!meta.resetSalt) { meta.resetSalt = crypto.randomBytes(12).toString("hex"); saveMeta() } return crypto.createHash("sha256").update(meta.resetSalt + ":" + String(pwh || "")).digest("hex") };
function pwTry(pwh) {
  if (pwFail.until > now()) err("locked"); if (!meta.resetPw) err("nopw");
  if (!/^[0-9a-f]{64}$/.test(String(pwh || "")) || pwHash(pwh) !== meta.resetPw) { if (++pwFail.n >= 5) { pwFail.n = 0; pwFail.until = now() + 1800000 } err("badpw") }
  pwFail.n = 0;
}
const rmrf = d => { try { fs.rmSync(d, { recursive: true, force: true }) } catch (e) { } };
const SEC = {
  client_error: (u, b) => { log(u, "client-error", (String(b.msg || "").slice(0, 250) + " | " + String(b.build || "") + " | " + String(b.ua || "").slice(0, 120)).replace(/[\r\n\t]+/g, " ")); return {} },
  sec_info: (u) => ({ epoch: +meta.epoch || 0, hasPw: !!meta.resetPw, boss: !!u.boss }),
  reset_pw_set: (u, b) => { needBoss(u); if (meta.resetPw) pwTry(b.old); if (!/^[0-9a-f]{64}$/.test(String(b.pwh || ""))) err("bad_pw"); meta.resetPw = pwHash(b.pwh); saveMeta(); log(u, "reset-pw", ""); return {} },
  activity: (u, b) => {
    needBoss(u); let txt = ""; try { const st = fs.statSync(P("log.txt")), fd = fs.openSync(P("log.txt"), "r"), len = Math.min(st.size, 1500000), buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, st.size - len); fs.closeSync(fd); txt = buf.toString("utf8") } catch (e) { }
    const q = String(b.q || "").toLowerCase().trim(), rows = [];
    const L = txt.split("\n"); for (let i = L.length - 1; i >= 0 && rows.length < 1500; i--) { const c = L[i].split("\t"); if (c.length < 3 || !/^\d{4}-/.test(c[0])) continue; const r = [c[0], c[1], c[2], c.slice(3).join(" ")]; if (q && r.join(" ").toLowerCase().indexOf(q) < 0) continue; rows.push(r) }
    return { rows };
  },
  /* mühasib: təsdiqlənmiş servis hesabatlarının PDF-ləri */
  svcPdfs: (u) => {
    if (!u.boss && !u.perms.includes("muhasibat")) err("forbidden");
    const list = []; for (const rec of reports.values()) { const r = rec.report; if (!r || !r.appr || !r.appr.at) continue; const s = summaryOf(rec);
      const at = new Date(+r.appr.at || r.appr.at); list.push({ id: r.id, no: s.repno || "", date: s.date || "", client: s.client || "", obj: s.obj || "", type: s.type || "", eng: s.eng || "", payer: s.payer || "", appr: (isNaN(at) ? "" : at.toISOString().slice(0, 16).replace("T", " ")) + " · " + (r.appr.by || ""), pdf: !!rec.pdf }) }
    list.sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0); return { list };
  },
  svcPdf: (u, b) => {
    if (!u.boss && !u.perms.includes("muhasibat")) err("forbidden");
    const rec = reports.get(String(b.id)); if (!rec || !rec.pdf) err("nopdf"); const i = rec.pdf.indexOf("/files/pdf/"); if (i < 0) err("nopdf");
    let parts; try { parts = rec.pdf.slice(i + 11).split("/").map(decodeURIComponent) } catch (e) { err("nopdf") }
    const f = P("pdf", ...parts); if (!inside(P("pdf"), f) || !fs.existsSync(f)) err("nopdf");
    log(u, "svcPdf", rec.summary && rec.summary.repno || b.id); return { name: path.basename(f), data: fs.readFileSync(f).toString("base64") };
  },
  factory_reset: (u, b) => {
    needBoss(u); if (String(b.confirm || "") !== "SİL") err("confirm");
    try { pwTry(b.pwh) } catch (e) { log(u, "reset-badpw", e.code || ""); throw e }
    let files = 0; const cnt = d => { try { files += fs.readdirSync(d).length } catch (e) { } };
    for (const d of ["reports", "versions", "pdf", "photos"]) { cnt(P(d)); rmrf(P(d)) }
    fs.mkdirSync(P("reports"), { recursive: true });
    writeJSON(P("tasks.json"), []); writeJSON(P("ratings.json"), {}); writeJSON(P("customers.json"), []); writeJSON(P("catalog.json"), []); writeJSON(P("deleted.json"), {});
    const sa = P("sa"); try { for (const f of fs.readdirSync(sa)) if (f !== "settings.json") rmrf(path.join(sa, f)) } catch (e) { }
    for (const k of ["items", "moves", "quotes", "invoices", "contracts", "expenses"]) writeJSON(path.join(sa, k + ".json"), []);
    if (b.backups) { try { for (const f of fs.readdirSync(BACKUP)) rmrf(path.join(BACKUP, f)) } catch (e) { } }
    if (b.staff) { users = users.filter(x => x.id === u.id); meta.sharedKey = newKey() }
    meta.epoch = now(); saveMeta(); saveUsers();
    try { fs.writeFileSync(P("log.txt"), "") } catch (e) { }
    reports.clear(); load(); SAM.load(DATA, path.join(ROOT, "seed"), log);
    log(u, "ZAVOD SIFIRLAMASI", (b.staff ? "işçilər də silindi" : "") + (b.backups ? " ehtiyat nüsxələr də silindi" : ""));
    return { epoch: meta.epoch, files };
  }
};
/*BTCORE — akkumulyatorların vəziyyətinin dinamikası (proqram və server eyni kodu işlədir; ES5) */
/* nöqtə: {id, d:'YYYY-MM-DD', no, n, ar, mr, av, mv, at, w, x} — n ölçülmüş blok, ar/mr orta/maks R (mΩ), av/mv orta/min V, at orta T, w Diqqət, x Dəyişdirilməli */
function btNum(v) { var x = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(x) ? x : null; }
function btPoint(rows) {
  var R = [], V = [], T = [], w = 0, x = 0, n = 0;
  rows.forEach(function (b) { var r = btNum(b.r), v = btNum(b.v), t = btNum(b.t); if (r === null && v === null) return; n++;
    if (r !== null) R.push(r); if (v !== null) V.push(Math.abs(v)); if (t !== null) T.push(t); if (b.st === 'Diqqət') w++; else if (b.st === 'Dəyişdirilməli') x++; });
  var avg = function (L) { return L.length ? L.reduce(function (a, b) { return a + b; }, 0) / L.length : null; };
  return { n: n, ar: avg(R), mr: R.length ? Math.max.apply(null, R) : null, av: avg(V), mv: V.length ? Math.min.apply(null, V) : null, at: avg(T), w: w, x: x };
}
function btDt(d) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; }
function btFd(d) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? m[3] + '.' + m[2] + '.' + m[1] : String(d || ''); }
/* a new battery set starts the comparison again: install date, a sharp drop of R or a different block count */
function btSeg(P, inst) {
  var s = 0;
  for (var i = 1; i < P.length; i++) { var a = P[i - 1], b = P[i];
    if ((inst && b.d >= inst && a.d < inst) || (a.ar && b.ar && b.ar < a.ar * 0.7) || (a.n && b.n && Math.abs(b.n - a.n) > Math.max(2, a.n * 0.3))) s = i; }
  return s;
}
function btEval(P, o) {
  o = o || {}; var wp = btNum(o.warn), fp = btNum(o.fail); if (wp === null) wp = 25; if (fp === null) fp = 50;
  var byD = {}; P.forEach(function (p) { if (!p || !p.d || !p.n) return; var q = byD[p.d]; if (!q || (p.cur && !q.cur) || (!q.cur && p.n > q.n)) byD[p.d] = p; });
  P = Object.keys(byD).sort().map(function (d) { return byD[d]; });
  var s = btSeg(P, o.inst || ''), S = P.slice(s), res = { P: P, s: s, S: S, lv: '', c: [], g: null, rate: null, wp: wp, fp: fp };
  if (s > 0) res.c.push(['rep', S[0].d]);
  if (S.length < 2) { res.c.push(['few']); return res; }
  var A = S[0], B = S[S.length - 1], pv = S[S.length - 2];
  if (A.ar && B.ar) { res.g = B.ar / A.ar - 1; var yrs = (btDt(B.d) - btDt(A.d)) / 315576e5; if (yrs > 0.2) res.rate = res.g / yrs; }
  if (res.g !== null && res.g * 100 >= fp) { res.lv = 'bad'; res.c.push(['gf', A.d, res.g]); }
  else if (res.g !== null && res.g * 100 >= wp) { res.lv = 'warn'; res.c.push(['gw', A.d, res.g]); }
  else if (res.g !== null) { res.lv = 'ok'; res.c.push(['ok', A.d, res.g]); }
  if ((B.w + B.x) > (pv.w + pv.x)) { if (res.lv !== 'bad') res.lv = 'warn'; res.c.push(['blk', pv.w + pv.x, B.w + B.x]); }
  if (res.rate !== null && res.rate > 0.01 && res.g * 100 < fp) { var m = Math.round((fp / 100 - res.g) / res.rate * 12); if (m <= 36) res.c.push(['eta', res.rate, fp, Math.max(1, m)]); }
  return res;
}
var BT_TX = {
  az: { rep: function (c) { return btFd(c[1]) + ' tarixində akkumulyatorlar dəyişdirilib (ehtimal) — müqayisə bu tarixdən aparılır.'; },
    few: function () { return 'Müqayisə üçün bu akkumulyatorlarda ən azı iki servis ölçməsi lazımdır.'; },
    gf: function (c) { return 'Orta daxili müqavimət ilk ölçmədən (' + btFd(c[1]) + ') bəri +' + Math.round(c[2] * 100) + '% artıb — akkumulyatorların dəyişdirilməsi tövsiyə olunur.'; },
    gw: function (c) { return 'Orta daxili müqavimət ilk ölçmədən (' + btFd(c[1]) + ') bəri +' + Math.round(c[2] * 100) + '% artıb — köhnəlmə müşahidə olunur, diqqətlə izlənməlidir.'; },
    ok: function (c) { var p = Math.round(c[2] * 100); return 'Vəziyyət stabildir: orta daxili müqavimət ilk ölçmədən (' + btFd(c[1]) + ') bəri ' + (p > 0 ? '+' : '') + p + '% dəyişib.'; },
    blk: function (c) { return 'Problemli (Diqqət / Dəyişdirilməli) blokların sayı artıb: ' + c[1] + ' → ' + c[2] + '.'; },
    eta: function (c) { return 'Bu templə (ildə ~' + Math.round(c[1] * 100) + '%) dəyişdirmə həddinə (+' + c[2] + '%) təxminən ' + c[3] + ' ay sonra çatacaq.'; },
    L: ['Orta R', 'Maks R', 'Diqqət həddi', 'Dəyişdirmə həddi', 'Tarix', 'Hesabat', 'Blok', 'Orta R, mΩ', 'Maks R, mΩ', 'Orta V', 'Min V', 'Diqqət', 'Dəyiş.', 'əvvəlki dəst'] },
  en: { rep: function (c) { return 'The batteries were replaced on ' + btFd(c[1]) + ' (probably) — the comparison starts from this date.'; },
    few: function () { return 'At least two service measurements of these batteries are needed for a comparison.'; },
    gf: function (c) { return 'Average internal resistance has risen by +' + Math.round(c[2] * 100) + '% since the first measurement (' + btFd(c[1]) + ') — battery replacement is recommended.'; },
    gw: function (c) { return 'Average internal resistance has risen by +' + Math.round(c[2] * 100) + '% since the first measurement (' + btFd(c[1]) + ') — ageing is visible, monitor closely.'; },
    ok: function (c) { var p = Math.round(c[2] * 100); return 'Condition is stable: average internal resistance changed by ' + (p > 0 ? '+' : '') + p + '% since the first measurement (' + btFd(c[1]) + ').'; },
    blk: function (c) { return 'The number of problem blocks (Attention / Replace) has increased: ' + c[1] + ' → ' + c[2] + '.'; },
    eta: function (c) { return 'At this rate (~' + Math.round(c[1] * 100) + '% a year) the replacement limit (+' + c[2] + '%) will be reached in about ' + c[3] + ' months.'; },
    L: ['Average R', 'Max R', 'Attention limit', 'Replacement limit', 'Date', 'Report', 'Blocks', 'Avg R, mΩ', 'Max R, mΩ', 'Avg V', 'Min V', 'Attention', 'Replace', 'previous set'] },
  ru: { rep: function (c) { return 'Аккумуляторы заменены ' + btFd(c[1]) + ' (вероятно) — сравнение ведётся с этой даты.'; },
    few: function () { return 'Для сравнения нужны как минимум два сервисных измерения этих аккумуляторов.'; },
    gf: function (c) { return 'Среднее внутреннее сопротивление выросло на +' + Math.round(c[2] * 100) + '% с первого измерения (' + btFd(c[1]) + ') — рекомендуется замена аккумуляторов.'; },
    gw: function (c) { return 'Среднее внутреннее сопротивление выросло на +' + Math.round(c[2] * 100) + '% с первого измерения (' + btFd(c[1]) + ') — заметно старение, требуется наблюдение.'; },
    ok: function (c) { var p = Math.round(c[2] * 100); return 'Состояние стабильное: среднее внутреннее сопротивление изменилось на ' + (p > 0 ? '+' : '') + p + '% с первого измерения (' + btFd(c[1]) + ').'; },
    blk: function (c) { return 'Число проблемных блоков (Внимание / Замена) выросло: ' + c[1] + ' → ' + c[2] + '.'; },
    eta: function (c) { return 'При таком темпе (~' + Math.round(c[1] * 100) + '% в год) порог замены (+' + c[2] + '%) будет достигнут примерно через ' + c[3] + ' мес.'; },
    L: ['Среднее R', 'Макс R', 'Порог внимания', 'Порог замены', 'Дата', 'Отчёт', 'Блоков', 'Сред. R, mΩ', 'Макс R, mΩ', 'Сред. V', 'Мин V', 'Внимание', 'Замена', 'прежний комплект'] }
};
function btTx(lg) { return BT_TX[lg] || BT_TX.az; }
function btMsgs(res, lg) { var X = btTx(lg); return res.c.map(function (c) { return { k: c[0], t: X[c[0]] ? X[c[0]](c) : '' }; }); }
function btEsc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function btF(v, k) { return v === null || v === undefined || !isFinite(v) ? '—' : (+v).toFixed(k == null ? 2 : k); }
/* line chart: average R (solid) and maximum R (dashed) by date; the limits are counted from the first measurement of the current battery set */
function btSvg(res, lg, W) {
  var P = res.P, X = btTx(lg).L; if (!P.length) return '';
  W = W || 700; var H = Math.round(W * 0.42), L = 34, R = 10, T = 22, B = 34, pw = W - L - R, ph = H - T - B;
  var S0 = res.S[0], lim = (S0 && S0.ar) ? [[S0.ar * (1 + res.wp / 100), X[2] + ' +' + res.wp + '%', '#B7860B'], [S0.ar * (1 + res.fp / 100), X[3] + ' +' + res.fp + '%', '#B42318']] : [];
  var mx = 0; P.forEach(function (p) { mx = Math.max(mx, p.mr || 0, p.ar || 0); }); lim.forEach(function (l) { mx = Math.max(mx, l[0]); });
  if (!mx) return ''; mx *= 1.1; var lo = mx; P.forEach(function (p) { if (p.ar) lo = Math.min(lo, p.ar); }); lo = lo * 0.7;
  var t0 = btDt(P[0].d), t1 = btDt(P[P.length - 1].d), span = t1 - t0;
  var xf = function (p, i) { return L + (span > 0 ? (btDt(p.d) - t0) / span * pw : (P.length > 1 ? i / (P.length - 1) * pw : pw / 2)); };
  var rg = mx - lo, step = rg > 40 ? 10 : rg > 20 ? 5 : rg > 8 ? 2 : rg > 4 ? 1 : rg > 2 ? 0.5 : 0.2; lo = Math.floor(lo / step) * step;
  var yf = function (v) { return T + ph - (v - lo) / (mx - lo) * ph; };
  var g = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" style="max-width:100%;height:auto" font-family="Arial, sans-serif" font-size="' + (W < 520 ? 11 : 10) + '">';
  for (var k = lo; k <= mx + 1e-9; k += step) g += '<line x1="' + L + '" x2="' + (L + pw) + '" y1="' + yf(k).toFixed(1) + '" y2="' + yf(k).toFixed(1) + '" stroke="#E3E8E6"/><text x="' + (L - 5) + '" y="' + (yf(k) + 3).toFixed(1) + '" text-anchor="end" fill="#6B7672">' + (step < 1 ? k.toFixed(1) : Math.round(k)) + '</text>';
  g += '<text x="' + L + '" y="12" fill="#6B7672">mΩ</text>';
  if (res.s > 0) { var xs = (xf(P[res.s - 1], res.s - 1) + xf(P[res.s], res.s)) / 2; g += '<line x1="' + xs.toFixed(1) + '" x2="' + xs.toFixed(1) + '" y1="' + T + '" y2="' + (T + ph) + '" stroke="#9AA5A1" stroke-dasharray="3 3"/><text x="' + (xs - 4).toFixed(1) + '" y="' + (T + 10) + '" text-anchor="end" fill="#9AA5A1">' + btEsc(X[13]) + '</text>'; }
  var x0 = res.S.length ? xf(res.S[0], res.s) : L;
  lim.forEach(function (l) { var yy = yf(l[0]).toFixed(1); g += '<line x1="' + x0.toFixed(1) + '" x2="' + (L + pw) + '" y1="' + yy + '" y2="' + yy + '" stroke="' + l[2] + '" stroke-dasharray="5 3"/><text x="' + (x0 + 4).toFixed(1) + '" y="' + (+yy - 3) + '" fill="' + l[2] + '">' + btEsc(l[1]) + '</text>'; });
  var line = function (key, col, dash) { var d = '', pen = false; P.forEach(function (p, i) { if (p[key] === null || p[key] === undefined) { pen = false; return; } if (i === res.s) pen = false; d += (pen ? 'L' : 'M') + xf(p, i).toFixed(1) + ',' + yf(p[key]).toFixed(1); pen = true; });
    return d ? '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="' + (dash ? 1.5 : 2.2) + '"' + (dash ? ' stroke-dasharray="4 3"' : '') + '/>' : ''; };
  g += line('mr', '#C8372D', 1) + line('ar', '#16362E', 0);
  var every = Math.ceil(P.length / 9);
  P.forEach(function (p, i) { var x = xf(p, i), old = i < res.s, c = old ? '#9AA5A1' : p.x ? '#C8372D' : p.w ? '#E0A82E' : '#2E8B57';
    if (p.ar !== null && p.ar !== undefined) { var y = yf(p.ar); g += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="4.2" fill="' + c + '" stroke="#fff" stroke-width="1.2"><title>' + btFd(p.d) + ': ' + btF(p.ar) + ' mΩ</title></circle>';
      if (i % every === 0 || i === P.length - 1) g += '<text x="' + x.toFixed(1) + '" y="' + (y - 8).toFixed(1) + '" text-anchor="middle" fill="' + (old ? '#9AA5A1' : '#15211E') + '" font-weight="bold">' + btF(p.ar) + '</text>'; }
    if (i % every === 0 || i === P.length - 1) g += '<text x="' + x.toFixed(1) + '" y="' + (H - 18) + '" text-anchor="' + (P.length > 1 && i === 0 ? 'start' : P.length > 1 && i === P.length - 1 ? 'end' : 'middle') + '" fill="#6B7672">' + btFd(p.d).replace(/\.(\d{2})(\d{2})$/, '.$2') + '</text>'; });
  g += '<line x1="' + L + '" x2="' + (L + pw) + '" y1="' + (T + ph) + '" y2="' + (T + ph) + '" stroke="#9AA5A1"/>';
  g += '<g transform="translate(' + L + ',' + (H - 4) + ')"><line x1="0" x2="16" y1="-3" y2="-3" stroke="#16362E" stroke-width="2.2"/><text x="20" y="0" fill="#15211E">' + btEsc(X[0]) + '</text><line x1="90" x2="106" y1="-3" y2="-3" stroke="#C8372D" stroke-width="1.5" stroke-dasharray="4 3"/><text x="110" y="0" fill="#15211E">' + btEsc(X[1]) + '</text></g>';
  return g + '</svg>';
}
function btTable(res, lg, repCell) {
  var X = btTx(lg).L, P = res.P;
  return '<table class="bttbl"><tr style="text-transform:none"><th style="text-transform:none">' + X[4] + '</th><th style="text-transform:none">' + X[5] + '</th><th style="text-transform:none">' + X[6] + '</th><th style="text-transform:none">' + X[7] + '</th><th style="text-transform:none">' + X[8] + '</th><th style="text-transform:none">' + X[9] + '</th><th style="text-transform:none">' + X[10] + '</th><th style="text-transform:none">' + X[11] + '</th><th style="text-transform:none">' + X[12] + '</th></tr>' +
    P.slice().reverse().map(function (p) { var i = P.indexOf(p), old = i < res.s;
      return '<tr' + (old ? ' style="color:#8A9490"' : '') + '><td>' + btFd(p.d) + '</td><td>' + (repCell ? repCell(p) : btEsc(p.no || '')) + '</td><td style="text-align:center">' + (p.n || '') + '</td><td style="text-align:center"><b>' + btF(p.ar) + '</b></td><td style="text-align:center">' + btF(p.mr) + '</td><td style="text-align:center">' + btF(p.av) + '</td><td style="text-align:center">' + btF(p.mv) + '</td><td style="text-align:center' + (p.w ? ';color:#B7860B;font-weight:bold' : '') + '">' + (p.w || 0) + '</td><td style="text-align:center' + (p.x ? ';color:#B42318;font-weight:bold' : '') + '">' + (p.x || 0) + '</td></tr>'; }).join('') + '</table>';
}
/*BTCORE-END*/
/* akkumulyator dinamikası: hər hesabatda bu seriya №-li cihazın blok ölçmələri */
const btSnK = x => String(x || "").toLowerCase().replace(/[\s\-_.\/\\]+/g, "").replace(/^(s\/?n|sn)(?=\w)/, "");
const ACTIONS = {
  ping: (u) => who(u),
  /* the manager corrects a customer's name everywhere: service reports, the customer base and Satış və Anbar (sales, invoices, contracts, moves) */
  client_rename: (u, b) => {
    needBoss(u); const from = String(b.from || "").trim(), to = String(b.to || "").trim(), dry = !!b.dry; if (!from || !to) err("bad_name");
    const core = x => lc(x).replace(/\u0307/g, "").replace(/ı/g, "i").replace(/ə/g, "e").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ç/g, "c").replace(/ğ/g, "g")
      .replace(/[^a-z0-9]+/g, " ").replace(/\b(mmc|asc|qsc|ojsc|llc|ltd|mehdud mesuliyyetli cemiyyeti|aciq sehmdar cemiyyeti|qapali sehmdar cemiyyeti)\b/g, " ").replace(/\s+/g, " ").trim();
    const nf = core(from); if (!nf) err("bad_name");
    const hit = x => !!String(x || "").trim() && core(x) === nf && String(x).trim() !== to;
    const names = {}, seen = x => { const k = String(x).trim(); names[k] = (names[k] || 0) + 1 }; let n = 0, nc = 0;
    for (const rec of reports.values()) {
      const cl = rec.report.cl || {}, mc = hit(cl.name), mp = hit(cl.payer); if (!mc && !mp) continue;
      n++; seen(mc ? cl.name : cl.payer); if (dry) continue;
      keepVersion(rec); if (mc) { cl.name = to; if (rec.summary) rec.summary.client = to } if (mp) { cl.payer = to; if (rec.summary) rec.summary.payer = to }
      rec.report.updatedAt = now(); if (rec.summary) rec.summary.updatedAt = rec.report.updatedAt; saveReport(rec);
    }
    customers.forEach(c => { if (hit(c.name)) { nc++; seen(c.name); if (!dry) c.name = to } }); if (!dry && nc) writeJSON(P("customers.json"), customers);
    let sa = null; try { sa = SAM.run({ name: u.name, role: "admin" }, "renameClient", { from, to, dry }) } catch (e) { sa = { error: e.code || e.message } }
    if (!dry) log(u, "client-rename", from + " → " + to + " (" + n + " hesabat)");
    return { reports: n, customers: nc, names, sa, dry };
  },
  upd_check: async (u) => { needBoss(u); const j = await updVersion(); return { cur: updCur(), latest: +j.v || 0, notes: j.notes || "" } },
  upd_apply: async (u) => { needBoss(u); return await updApply() },

  list: (u) => {
    const items = [...reports.values()].map(summaryOf);
    const cutoff = now() - 120 * 86400000;
    return Object.assign(who(u), { items, deleted: Object.keys(deleted).filter(id => deleted[id].at > cutoff), settings: meta.settings });
  },

  get: (u, b) => { const rec = reports.get(String(b.id)); if (!rec) err(deleted[b.id] ? "deleted" : "notfound"); return { report: rec.report } },

  save: (u, b) => {
    needServis(u); const r = b.report; if (!r || !safeId(r.id) || !r.svc || !r.cl) err("bad_report");
    if (deleted[r.id]) err("deleted");
    const cur = reports.get(r.id), admin = u.role === "admin", force = admin && !!b.force;
    if (cur && !force && (cur.report.updatedAt || 0) > (r.updatedAt || 0)) err("conflict", { report: cur.report });
    /* approval belongs to the manager: a worker can neither change an approved report nor approve one */
    if (!admin) {
      if (cur && cur.report.appr && cur.report.appr.at) {
        /* an approved report stays as approved — only a new signature (e.g. the customer's, taken later) is added to it */
        const ns = newSigs(cur.report, r);
        if (ns.length) { keepVersion(cur); const R = cur.report; R.sig = R.sig || {}; ns.forEach(k => { R.sig[k] = r.sig[k] }); if (r.sigSnap && ns.some(k => /^cl/.test(k))) R.sigSnap = r.sigSnap; R.updatedAt = now();
          const rec2 = Object.assign({}, cur, { report: R, savedAt: now(), savedBy: u.name }); saveReport(rec2); log(u, "sign", R.id + " " + (R.cl && R.cl.name || "")); return { summary: summaryOf(rec2), report: R } }
        err("conflict", { report: cur.report });
      }
      /* one worker's report is not changed by another worker (only the manager); the app saves the changes as the worker's own new report */
      const owner = cur ? String(cur.creator || cur.report.creator || "").trim() : "";
      if (owner && lc(owner).replace(/\s+/g, " ") !== lc(u.name).replace(/\s+/g, " ")) err("not_owner", { report: cur.report, owner });
      if (r.appr) delete r.appr;
    }
    if (cur) { keepSig(cur.report, r); keepVersion(cur) }
    const rec = { report: r, summary: b.summary || {}, items: Array.isArray(b.items) ? b.items.slice(0, 2000) : [], blocks: Array.isArray(b.blocks) ? b.blocks.slice(0, 4000) : (cur && cur.blocks) || [], pdf: cur ? cur.pdf : "", savedAt: now(), savedBy: u.name, creator: cur ? cur.creator : (r.creator || u.name) };
    saveReport(rec); log(u, "save", r.id + " " + (r.cl.name || ""));
    try { learnCustomer(r) } catch (e) { log(u, "learn-error", e.message) }
    if (r.appr && r.appr.at && !(cur && cur.report.appr && cur.report.appr.at === r.appr.at)) log(u, "approve", r.id);
    /* approved work goes to sales at once (a later edit of an approved report updates its sale) */
    /* ... and a withdrawn approval withdraws the sale (an invoiced one stays, with a warning in Satış və Anbar) */
    const wasAppr = !!(cur && cur.report.appr && cur.report.appr.at);
    if (!b.restore && ((r.appr && r.appr.at) || wasAppr)) { try { const o = SAM.importReports([r]); if ((o.revoked || []).length || (o.warned || []).length) log(u, "svc-sale-revoke", (o.revoked || []).concat(o.warned || []).join(", ")) } catch (e) { log(u, "svc-sale-error", e.code || e.message) } }
    return { summary: summaryOf(rec) };
  },

  bat_trend: (u, b) => {
    const k = btSnK(b.sn); if (!k) return { pts: [] }; const pts = [];
    for (const rec of reports.values()) {
      const r = rec.report; if (!r || !Array.isArray(r.devices) || r.sample) continue;
      const j = r.devices.findIndex(d => d && d.info && btSnK(d.info.sn) === k && d.bat); if (j < 0) continue;
      const B = r.devices[j].bat, tot = Math.max(0, Math.floor(+B.per || 0) * Math.floor(+B.str || 0));
      let rows = (rec.blocks || []).filter(x => Array.isArray(x) && x.length > 7 && btSnK(x[7]) === k).map(x => ({ v: x[3], r: x[4], t: x[5], st: x[6] }));
      if (!rows.length && tot) rows = (B.blocks || []).slice(0, tot).map(x => ({ v: x && x.v, r: x && x.r, t: x && x.t, st: "" }));
      const p = btPoint(rows); if (!p.n) continue;
      p.id = r.id; p.d = String(r.svc && r.svc.date || "").slice(0, 10); p.no = r.svc && r.svc.repno || ""; pts.push(p);
    }
    pts.sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : 0); return { pts };
  },
  delete: (u, b) => {
    needAdmin(u); const rec = reports.get(String(b.id)); if (!rec) err("notfound");
    keepVersion(rec); reports.delete(rec.report.id); fs.rmSync(P("reports", rec.report.id + ".json"), { force: true });
    deleted[rec.report.id] = { at: now(), by: u.name }; saveDeleted(); log(u, "delete", rec.report.id); return {};
  },

  history: (u, b) => {
    needAdmin(u); const id = safeId(b.id); if (!id) err("bad_id"); const dir = versionsDir(id); let items = [];
    try { items = fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort().reverse().map(f => { const v = readJSON(path.join(dir, f), {}); return { rev: f.replace(/\.json$/, ""), at: v.at, by: v.by } }) } catch (e) { }
    const rec = reports.get(id);
    return { items, cur: rec ? { at: rec.savedAt || rec.report.updatedAt || 0, by: rec.savedBy || rec.report.by || "" } : null, del: deleted[id] || null };
  },
  rev_get: (u, b) => {
    needAdmin(u); const id = safeId(b.id), rev = safeId(b.rev); if (!id || !rev) err("bad_id");
    const v = readJSON(path.join(versionsDir(id), rev + ".json"), null); if (!v || !v.report) err("notfound");
    return { report: stripData(v.report), by: v.by || "", at: v.at || 0 };
  },
  deleted_list: (u) => {
    needAdmin(u); const items = [];
    Object.keys(deleted).forEach(id => { const d = deleted[id] || {}; let last = null;
      try { const fs1 = fs.readdirSync(versionsDir(id)).filter(f => f.endsWith(".json")).sort(); if (fs1.length) last = readJSON(path.join(versionsDir(id), fs1[fs1.length - 1]), null) } catch (e) { }
      const r = last && last.report; items.push({ id, at: d.at || 0, by: d.by || "", repno: r && r.svc ? r.svc.repno || "" : "", date: r && r.svc ? r.svc.date || "" : "", client: r && r.cl ? r.cl.name || "" : "", obj: r && r.cl ? r.cl.obj || "" : "", hasVer: !!last }) });
    items.sort((a, b) => b.at - a.at); return { items: items.slice(0, 300) };
  },
  restore: (u, b) => {
    needAdmin(u); const id = safeId(b.id), rev = safeId(b.rev); if (!id || !rev) err("bad_id");
    const v = readJSON(path.join(versionsDir(id), rev + ".json"), null); if (!v) err("notfound");
    if (deleted[id]) { delete deleted[id]; saveDeleted() }
    const rep = v.report; rep.updatedAt = now(); return { report: rep };
  },

  photo: (u, b) => {
    const rid = safeId(b.rid), pid = safeId(b.pid); if (!rid || !pid || !b.data) err("bad_photo");
    const f = P("photos", rid, pid + ".jpg"); fs.mkdirSync(path.dirname(f), { recursive: true });
    if (!fs.existsSync(f)) fs.writeFileSync(f, Buffer.from(String(b.data), "base64"));
    return { fid: rid + "/" + pid };
  },
  photo_get: (u, b) => {
    const m = /^([\w.-]{1,80})\/([\w.-]{1,80})$/.exec(String(b.fid || "")); if (!m) err("bad_photo");
    const f = P("photos", m[1], m[2] + ".jpg"); if (!fs.existsSync(f)) err("notfound");
    return { data: fs.readFileSync(f).toString("base64") };
  },

  pdf: (u, b, req) => {
    if (!b.data) err("bad_pdf"); const rel = ["pdf", safeName(b.client || "Müştərisiz"), safeName(b.name || (b.id + ".pdf"))];
    if (!/\.pdf$/i.test(rel[2])) rel[2] += ".pdf";
    const f = P(...rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.from(String(b.data), "base64"));
    const url = "/files/" + rel.map(encodeURIComponent).join("/"), abs = "http://" + (req.headers.host || ("localhost:" + PORT)) + url;
    const rec = reports.get(String(b.id)); if (rec) { rec.pdf = abs; saveReport(rec) }
    log(u, "pdf", rel.join("/")); return { url: abs };
  },

  settings: (u, b) => { needAdmin(u); const s = b.settings || {}; SETTING_KEYS.forEach(k => { if (s[k] !== undefined && !(k === "repHead" && !/^#[0-9a-fA-F]{6}$/.test(String(s[k])))) meta.settings[k] = s[k] }); saveMeta(); return { settings: meta.settings } },

  translate: async (u, b) => {
    const texts = (Array.isArray(b.texts) ? b.texts : []).slice(0, 80).map(String), to = /^[a-z]{2}$/.test(b.to) ? b.to : "en";
    const out = []; for (const t of texts) out.push(await gtranslate(t, to)); return { out };
  },

  /* payments of the service work (from Satış və Anbar in the same hub) — the manager sees them; workers only if the manager allows */
  pay: (u) => {
    const workers = !!meta.payWorkers;
    if (u.role !== "admin" && !workers && !u.perms.includes("sv_pay")) return { hidden: true, workers: false };
    const sdb = SAM.db(); if (!sdb || !SAM.payInfo) return { workers, reps: {}, items: [], at: "" };
    const P = SAM.payInfo(), reps = {};
    Object.keys(P.reps).forEach(id => { const r = P.reps[id]; reps[id] = Object.assign({}, r, { at: r.at ? new Date(r.at).toISOString().slice(0, 10) : "" }) });
    return { workers, reps, items: P.items, at: new Date().toLocaleString("az-AZ") };
  },
  /* a copy of all data before a backup is restored (kept beside the daily backups) */
  /* the look the manager sends to everybody (one file for the service journal and Satış və Anbar) */
  look_get: () => ({ look: readJSON(P("look.json"), null) }),
  tpl_get: () => ({ tpl: readJSON(P("templates.json"), null) }),
  tpl_set: (u, b) => { needAdmin(u); if (!b.tpl || typeof b.tpl !== "object") err("bad_tpl"); if (JSON.stringify(b.tpl).length > 900000) err("too_big"); writeJSON(P("templates.json"), b.tpl); log(u, "templates", ""); return {} },
  look_set: (u, b) => { needAdmin(u); writeJSON(P("look.json"), b.look === undefined ? null : b.look); log(u, "look", b.look ? "set" : "off"); return { ok: true } },
  bk_snapshot: (u) => {
    needAdmin(u); const d = new Date(), p2 = n => String(n).padStart(2, "0");
    const dst = path.join(BACKUP, d.toISOString().slice(0, 10) + "-berpadan-evvel-" + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds()));
    fs.mkdirSync(dst, { recursive: true });
    for (const f of fs.readdirSync(DATA)) { if (f.endsWith(".json")) fs.copyFileSync(P(f), path.join(dst, f)) }
    if (fs.existsSync(P("reports"))) copyDir(P("reports"), path.join(dst, "reports"));
    if (fs.existsSync(P("sa"))) copyDir(P("sa"), path.join(dst, "sa"));
    log(u, "snapshot", dst); return { dir: dst };
  },
  pay_cfg: (u, b) => { needAdmin(u); meta.payWorkers = !!b.on; saveMeta(); return { workers: meta.payWorkers } },

  parts: () => { const rows = []; for (const rec of reports.values()) { const r = rec.report; for (const it of rec.items || []) rows.push([r.id, r.svc.repno || "", r.svc.date || "", r.cl.name || "", r.cl.obj || ""].concat(it)) } return { rows } },

  ratings: (u) => { if (u.role !== "admin" && !u.perms.includes("sv_staff")) err("forbidden"); return { rows: Object.entries(ratings).map(([id, x]) => [id, x.repno, x.date, x.client, x.person, x.score, x.note, x.by]) } },
  rate: (u, b) => {
    needAdmin(u); const id = String(b.id || ""); if (!id) err("bad_id");
    if (+b.score) ratings[id] = { repno: b.repno || "", date: b.date || "", client: b.client || "", person: b.person || "", score: +b.score, note: String(b.note || "").slice(0, 500), by: u.name, at: now() };
    else delete ratings[id]; saveRatings(); return {};
  },

  tasks: (u) => Object.assign(taskOut(), { me: u.id }),
  task_save: (u, b) => {
    needAdmin(u); const t = b.task || {};
    if (b.remove) { tasks = tasks.filter(x => x.id !== t.id); saveTasks(); log(u, "task-del", t.id); return taskOut() }
    const title = String(t.title || "").trim(); if (!title) err("bad_task");
    const wids = (Array.isArray(t.wids) ? t.wids : []).filter(id => users.some(w => w.id === id));
    const old = tasks.find(x => x.id === t.id);
    const o = Object.assign(old || { id: newId("t"), created: now(), by: u.name, status: "Açıq" }, {
      title, client: String(t.client || ""), obj: String(t.obj || ""), addr: String(t.addr || ""), date: String(t.date || ""),
      prio: t.prio === "Təcili" ? "Təcili" : "Normal", note: String(t.note || ""), wids, names: wids.map(id => (users.find(w => w.id === id) || {}).name || ""), updated: now()
    });
    if (!old) tasks.push(o); saveTasks(); log(u, "task", o.id + " " + title); return taskOut();
  },
  task_done: (u, b) => {
    const t = tasks.find(x => x.id === b.id); if (!t) err("notfound");
    if (u.role !== "admin" && !(u.id && t.wids.includes(u.id))) err("forbidden");
    if (b.undo) { t.status = "Açıq"; delete t.doneAt; delete t.doneBy; delete t.doneNote }
    else { t.status = "Görülüb"; t.doneAt = now(); t.doneBy = u.name || "işçi"; t.doneNote = String(b.note || ""); if (b.report) t.report = String(b.report) }
    saveTasks(); return taskOut();
  },

  workers: (u) => { if (u.role !== "admin" && !u.perms.includes("sv_staff")) err("forbidden"); return wOut(u) },
  positions_save: (u, b) => {
    needBoss(u); const list = (Array.isArray(b.positions) ? b.positions : []).slice(0, 50).map(p => ({ id: /^[\w-]{1,40}$/.test(String(p && p.id || "")) ? String(p.id) : newId("p"), name: String(p && p.name || "").trim().slice(0, 80), perms: (Array.isArray(p && p.perms) ? p.perms : []).filter(m => MODS.includes(m)) })).filter(p => p.name);
    meta.positions = list; saveMeta();
    /* workers holding a position follow its modules */
    users.forEach(w => { const p = list.find(x => x.id === w.pos); if (p && w.role !== "admin") w.perms = p.perms.slice() }); saveUsers();
    log(u, "positions", list.map(p => p.name).join(", ")); return wOut(u);
  },
  worker_save: (u, b) => {
    needBoss(u); const w = b.w || {}; let x = users.find(y => y.id === w.id);
    const perms = Array.isArray(w.perms) ? w.perms.filter(m => MODS.includes(m)) : null;
    if (!x) { const name = String(w.name || "").trim(); if (!name) err("bad_name"); const p0 = w.pos ? positions().find(y => y.id === w.pos) : null; x = { id: newId("w"), name, role: w.role === "admin" ? "admin" : "worker", key: newKey(), email: "", active: true, created: now(), perms: perms || (p0 ? p0.perms.slice() : ["servis"]), pos: p0 ? p0.id : "" }; users.push(x) }
    else {
      if (w.name !== undefined && String(w.name).trim()) x.name = String(w.name).trim();
      if (w.email !== undefined) x.email = String(w.email).trim();
      if (w.role !== undefined) x.role = w.role === "admin" ? "admin" : "worker";
      if (w.active !== undefined) x.active = w.active !== false;
      if (perms) x.perms = perms;
      if (w.fn !== undefined) x.fn = fnOf(w.fn);
      if (w.pos !== undefined) { const p = positions().find(y => y.id === w.pos); x.pos = p ? p.id : ""; if (p && w.applyPos) x.perms = p.perms.slice() }
      /* never lock out the last active manager */
      if (!users.some(y => y.role === "admin" && y.active !== false)) { x.active = true; x.role = "admin" }
    }
    saveUsers(); log(u, "worker", x.name); return wOut(u);
  },
  worker_newkey: (u, b) => { needBoss(u); const x = users.find(y => y.id === b.id); if (!x) err("notfound"); x.key = newKey(); saveUsers(); return wOut(u) },
  shared_off: (u, b) => { needBoss(u); meta.sharedOff = !!b.off; saveMeta(); writeKeysFile(); return wOut(u) },

  /* client base (imported from the old list, extended by the manager) */
  customers: () => ({ customers }),
  customer_save: (u, b) => {
    needAdmin(u); const c = b.c || {}; const name = String(c.name || "").trim();
    /* an existing customer is changed only by its id; a new one with a name already in the list is refused */
    let x = c.id ? customers.find(y => y.id === c.id) : null;
    if (b.remove && !x && name) x = customers.find(y => y.name.toLowerCase() === name.toLowerCase());
    if (c.id && !x && !b.remove) err("notfound");
    if (b.remove) { if (!x) err("notfound"); customers = customers.filter(y => y !== x); writeJSON(P("customers.json"), customers); log(u, "customer-del", x.name); return { customers } }
    if (!name) err("bad_name");
    if (customers.some(y => y !== x && String(y.name).toLowerCase() === name.toLowerCase())) err("dup_name");
    if (!x) { x = { id: newId("c"), devices: [] }; customers.push(x) }
    ["name", "voen", "person", "tel", "email", "addr", "note", "period"].forEach(k => { if (c[k] !== undefined) x[k] = String(c[k]).trim().slice(0, 500) });
    if (Array.isArray(c.devices)) x.devices = c.devices.slice(0, 500).map(d => { const o = {}; ["type", "loc", "brand", "model", "kva", "sn", "blocks", "ah", "period", "price"].forEach(k => { if (d && d[k] != null && String(d[k]).trim() !== "") o[k] = String(d[k]).trim().slice(0, 200) }); if (!o.type) o.type = "ups"; return o }).filter(o => o.loc || o.brand || o.model || o.sn || o.kva);
    writeJSON(P("customers.json"), customers); log(u, "customer", x.name); return { customers, id: x.id };
  },
  catalog: () => ({ items: catalog }),
};

/* the client base grows by itself from approved reports: a new client, and devices (by serial №) seen in a report, are added; a moved device gets its new place */
const lc = x => String(x || "").trim().toLocaleLowerCase("az");
function learnCustomer(r) {
  /* only reports checked and approved by the manager feed the base (no typos from drafts) */
  const name = String(r.cl.name || "").trim(); if (!name || r.sample || !(r.appr && r.appr.at)) return;
  let c = customers.find(x => lc(x.name) === lc(name)), changed = false;
  if (!c) { c = { id: newId("c"), name, period: "", voen: "", person: r.cl.person || "", tel: r.cl.tel || "", email: "", addr: r.cl.addr || "", note: "", devices: [] }; customers.push(c); changed = true }
  if (!Array.isArray(c.devices)) c.devices = [];
  for (const k of ["addr", "person", "tel"]) if (!c[k] && r.cl[k]) { c[k] = r.cl[k]; changed = true }
  for (const d of r.devices || []) {
    const i = d.info || {}, sn = String(i.sn || "").trim(); if (!sn) continue;
    const x = c.devices.find(y => lc(y.sn) === lc(sn));
    if (!x) { c.devices.push({ type: d.type || "ups", loc: d.loc || "", brand: i.brand || "", model: i.model || "", kva: i.kva || i.kw || "", sn, blocks: d.bat && d.bat.per && d.bat.str ? String((+d.bat.per || 0) * (+d.bat.str || 1)) : "", ah: d.bat && d.bat.ah || "", period: "" }); changed = true }
    else if (d.loc && d.loc !== x.loc) { x.loc = d.loc; changed = true }
  }
  if (changed) writeJSON(P("customers.json"), customers);
}
function gtranslate(text, to) {
  return new Promise((res, rej) => {
    const url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=az&tl=" + to + "&dt=t&q=" + encodeURIComponent(text.slice(0, 4000));
    https.get(url, { timeout: 15000 }, r => { let s = ""; r.on("data", d => s += d); r.on("end", () => { try { const j = JSON.parse(s); res((j[0] || []).map(x => x[0]).join("")) } catch (e) { rej(new ApiErr("translate")) } }) })
      .on("error", () => rej(new ApiErr("translate"))).on("timeout", function () { this.destroy(); rej(new ApiErr("translate")) });
  });
}

function saApi(body, req) {
  try {
    const u = auth(body.key);
    const res = SAM.api({ name: u.name || "İşçi", role: u.saRole, perms: u.perms }, body, { dataDir: DATA, host: req.headers.host || ("localhost:" + PORT), approvedReports, customers: () => customers });
    if (body.action && !/^(ping|boot|getQuote|getQuotes|moves|look_get|customers|custHist|svcSync_get|catalog)$/.test(body.action)) log(u, "sa:" + body.action, "");
    return Object.assign({ ok: true }, res);
  } catch (e) {
    if (e instanceof ApiErr || e.code) return Object.assign({ ok: false, error: e.code || "server" }, e.extra || {});
    log(null, "sa-error", (body && body.action) + ": " + (e && e.stack || e)); return { ok: false, error: "server" };
  }
}
const LOG_ACTS = { restore: "restore", settings: "settings", worker_newkey: "worker-newkey", shared_off: "shared-off", pay_cfg: "pay-cfg" };
/* açar səhvi: eyni ünvandan 15 dəqiqədə 12 səhv cəhd → 15 dəqiqə blok */
const authFails = new Map();
const ipOf = req => String((req && req.socket && req.socket.remoteAddress) || "").replace(/^::ffff:/, "");
function ipLocked(ip) { const x = authFails.get(ip); return !!(x && x.until > now()) }
function ipFail(ip) { const t = now(); let x = authFails.get(ip); if (!x || t - x.first > 900000) x = { n: 0, first: t, until: 0 }; if (++x.n >= 12) { x.until = t + 900000; x.n = 0; x.first = t; log(null, "auth-lock", ip) } authFails.set(ip, x) }
async function api(body, req) {
  let u = null; const a = String(body.action || "");
  try {
    u = auth(body.key); const fn = SEC[a] || ACTIONS[a];
    if (!fn) err("unknown_action");
    const res = await fn(u, body, req);
    if (LOG_ACTS[a]) log(u, LOG_ACTS[a], String(body.id || (body.w && body.w.name) || "").slice(0, 80));
    return Object.assign({ ok: true }, res);
  } catch (e) {
    if (!(e instanceof ApiErr)) { log(null, "error", (body && body.action) + ": " + (e && e.stack || e)); return { ok: false, error: "server" } }
    if (e.code === "forbidden" && u) log(u, "forbidden", a);
    return Object.assign({ ok: false, error: e.code }, e.extra || {});
  }
}

/* ---------------- HTTP ---------------- */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".pdf": "application/pdf", ".jpg": "image/jpeg", ".txt": "text/plain; charset=utf-8" };
function cors(res) { res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS"); res.setHeader("Access-Control-Allow-Headers", "Content-Type") }
function sendFile(res, f) {
  fs.stat(f, (e, st) => {
    if (e || !st.isFile()) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Tapılmadı") }
    res.writeHead(200, { "Content-Type": MIME[path.extname(f).toLowerCase()] || "application/octet-stream", "Content-Length": st.size, "Cache-Control": "no-cache" });
    fs.createReadStream(f).pipe(res);
  });
}
function inside(base, f) { const r = path.relative(base, f); return r && !r.startsWith("..") && !path.isAbsolute(r) }

const server = http.createServer((req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end() }
  let url; try { url = decodeURIComponent(req.url.split("?")[0]) } catch (e) { res.writeHead(400); return res.end() }
  if (req.method === "POST" && (url === "/api" || url === "/api/" || url === "/api/sa")) {
    const chunks = []; let size = 0, over = false;
    req.on("data", d => { size += d.length; if (size > MAX_BODY) { over = true; req.destroy() } else chunks.push(d) });
    req.on("end", async () => {
      if (over) return;
      let body = {}; try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")) } catch (e) { }
      const ip = ipOf(req);
      if (ipLocked(ip)) { res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); return res.end(JSON.stringify({ ok: false, error: "locked" })) }
      const out = url === "/api/sa" && body.action !== "translate" && !SEC[body.action] ? saApi(body, req) : await api(body, req), s = JSON.stringify(out);
      if (out && out.error === "auth") ipFail(ip);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(s);
    });
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end() }
  if (url === "/satis/config.js") {
    res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store" });
    return res.end('window.SA_CONFIG={serverUrl:location.origin+"/api/sa",apiKey:"",hub:true};');
  }
  if (url === "/config.js") {
    res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store" });
    return res.end('window.UPS_CONFIG={serverUrl:location.origin+"/api",apiKey:"",hub:true};');
  }
  if (url === "/status") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ ok: true, app: "ZUVAND Servis hub", reports: reports.size, ips: lanIPs(), port: PORT })) }
  if (url.startsWith("/files/pdf/")) { const f = path.join(DATA, "pdf", url.slice("/files/pdf/".length)); if (!inside(P("pdf"), f)) { res.writeHead(403); return res.end() } return sendFile(res, f) }
  const f = path.join(APP, url === "/" ? "index.html" : url);
  if (!inside(APP, f) && f !== path.join(APP, "index.html")) { res.writeHead(403); return res.end() }
  sendFile(res, f);
});

if (require.main === module) {
  load(); SAM.load(DATA, path.join(ROOT, "seed"), log); backup(); setInterval(backup, 3600000);
  server.listen(PORT, "0.0.0.0", () => {
    console.log("ZUVAND Servis hub işləyir");
    console.log("  Bu kompüterdə:  http://localhost:" + PORT);
    lanIPs().forEach(ip => console.log("  Telefonlar üçün: http://" + ip + ":" + PORT));
    console.log("  Məlumat qovluğu: " + DATA);
    console.log("  Açarlar: " + P("ACARLAR.txt"));
  });
  let tries = 0;
  server.on("error", e => {
    if (e.code === "EADDRINUSE" && process.env.ZS_RESTART && tries++ < 40) return setTimeout(() => server.listen(PORT, "0.0.0.0"), 750);
    console.error(e.code === "EADDRINUSE" ? "Port " + PORT + " artıq istifadə olunur — hub artıq işləyir?" : e.message); process.exit(1)
  });
}
module.exports = { api, load, ACTIONS, server, _state: () => ({ users, meta, tasks, reports, deleted, customers, catalog }) };
