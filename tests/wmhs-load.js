#!/usr/bin/env node
/**
 * WMHS portal — traffic / load test.  Zero dependencies, Node 18+.
 *
 *   BASE_URL=http://localhost:5000 ADMIN_PASSWORD='...' node wmhs-load.js
 *
 * Env (all optional except ADMIN_PASSWORD):
 *   ADMIN_EMAIL   default admin@wmhs.ac.rw
 *   LEVELS        concurrent users per step            default "10,25,50,100,200"
 *   DURATION      seconds each browse step runs        default 20
 *   USERS         student accounts to create           default 60  (each costs one bcrypt hash)
 *   THINK_MS      pause between a user's clicks        default 300
 *
 * What it does
 *   Phase 1  LOGIN STORM     N people log in at the same instant (start of a lesson)
 *   Phase 2  BROWSING        N people use the student portal continuously (dashboard, work, results...)
 *   Phase 3  SUBMIT WAVE     every student submits an assignment + a quiz at the same instant (deadline rush)
 *   Throughout: a /api/health probe 5x/second shows whether the server stays responsive for everybody.
 *
 * !! RUN AGAINST A TEST COPY. It creates USERS students, 1 teacher, 1 module and 2 work items, and removes what the API allows.
 * !! Run it from a DIFFERENT machine than the server for honest numbers (the generator uses CPU too).
 * !! If you have switched the rate limiters back on (you should), one machine = one IP, so you will see 429s.
 *    On the test copy start the server with RATE_LIMIT_MAX_REQUESTS=1000000 REGISTER_RATE_LIMIT_MAX=1000000
 *    (otherwise read the 429 count as "limiter works").
 */
'use strict';
const fs = require('node:fs');

const BASE = (process.env.BASE_URL || 'http://localhost:5000').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@wmhs.ac.rw';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const LEVELS = (process.env.LEVELS || '10,25,50,100,200').split(',').map(Number).filter(Boolean);
const DURATION = Number(process.env.DURATION || 20);
const USERS = Number(process.env.USERS || 60);
const THINK = Number(process.env.THINK_MS || 300);
const RUN = Date.now().toString(36);
if (!ADMIN_PASSWORD) { console.error('Set ADMIN_PASSWORD (and optionally ADMIN_EMAIL, BASE_URL).'); process.exit(2); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
const pct = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p / 100 * sorted.length))] : 0;
const fmt = n => (n >= 1000 ? (n / 1000).toFixed(2) + ' s' : Math.round(n) + ' ms').padStart(9);

// ── recorder ────────────────────────────────────────────────────────────────
function newRecorder() { return { by: new Map(), total: 0, bad: 0, codes: {} }; }
let REC = newRecorder();
async function timed(name, method, path, { token, json } = {}) {
  const h = {}; if (token) h.Authorization = `Bearer ${token}`; if (json !== undefined) h['Content-Type'] = 'application/json';
  const t0 = performance.now(); let status = 0, data = null;
  try {
    const res = await fetch(BASE + path, { method, headers: h, body: json !== undefined ? JSON.stringify(json) : undefined, signal: AbortSignal.timeout(30000) });
    status = res.status; const txt = await res.text(); try { data = JSON.parse(txt); } catch { /* non-json */ }
  } catch { status = 0; }            // timeout / refused / reset
  const ms = performance.now() - t0;
  const e = REC.by.get(name) || { lat: [] }; e.lat.push(ms); REC.by.set(name, e);
  REC.total++; REC.codes[status] = (REC.codes[status] || 0) + 1; if (status < 200 || status >= 400) REC.bad++;
  return { status, data, ms };
}
function health() {                  // background responsiveness probe
  let stop = false; const lat = [];
  const p = (async () => { while (!stop) { const t = performance.now(); let ok = true; try { const r = await fetch(BASE + '/api/health', { signal: AbortSignal.timeout(30000) }); ok = r.ok; await r.text(); } catch { ok = false; } lat.push(ok ? performance.now() - t : 30000); await sleep(200); } })();
  return async () => { stop = true; await p; return lat.sort((a, b) => a - b); };
}

// ── setup ───────────────────────────────────────────────────────────────────
const S = { users: [] };
async function setup() {
  console.log(`Target ${BASE}\nSetting up: 1 teacher, 1 module, 2 work items, ${USERS} students ...`);
  let r = await timed('setup', 'POST', '/api/auth/login', { json: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  if (r.status !== 200) throw new Error(`admin login failed (HTTP ${r.status})`); S.admin = r.data.token;
  if (r.data.user.must_change_password) {   // first-login password: change it and set it straight back
    let c = await timed('setup', 'PATCH', '/api/auth/password', { token: S.admin, json: { currentPassword: ADMIN_PASSWORD, newPassword: `Tmp-${RUN}-A-Aa1!` } });
    if (c.status !== 200) throw new Error(`admin password change failed (HTTP ${c.status})`);
    c = await timed('setup', 'PATCH', '/api/auth/password', { token: c.data.token, json: { currentPassword: `Tmp-${RUN}-A-Aa1!`, newPassword: ADMIN_PASSWORD } });
    S.admin = c.data.token;
  }
  r = await timed('setup', 'GET', '/api/admin/classes', { token: S.admin }); const cls = r.data.classes.find(c => c.code_active); if (!cls) throw new Error('no active class join code'); S.cls = cls;
  const tEmail = `load.teacher.${RUN}@example.test`, tPw = `Tmp-${RUN}-T-Aa1!`;
  r = await timed('setup', 'POST', '/api/admin/teachers', { token: S.admin, json: { name: 'Load Teacher', email: tEmail, password: tPw } }); S.tId = r.data.teacher.id;
  r = await timed('setup', 'POST', '/api/auth/login', { json: { email: tEmail, password: tPw } });
  r = await timed('setup', 'PATCH', '/api/auth/password', { token: r.data.token, json: { currentPassword: tPw, newPassword: tPw + 'x' } }); S.t = r.data.token;
  r = await timed('setup', 'POST', '/api/admin/modules', { token: S.admin, json: { classId: cls.id, moduleName: `LOAD-${RUN}`, teacherId: S.tId } }); S.moduleId = r.data.module.id;
  const mk = async (type, title) => (await timed('setup', 'POST', '/api/teacher/work-items', { token: S.t, json: { moduleId: S.moduleId, type, title, maxScore: 20 } })).data.workItem.id;
  S.asg = await mk('assignment', 'load assignment'); S.quiz = await mk('quiz', 'load quiz');
  r = await timed('setup', 'POST', `/api/teacher/questions/${S.quiz}`, { token: S.t, json: { questions: [0, 1, 2, 3, 4].map(i => ({ questionText: `Q${i}`, options: ['a', 'b', 'c', 'd'], correctOption: i % 4 })) } }); S.qs = r.data.questions;
  // register students, 5 at a time (each registration = one bcrypt hash on the server)
  let next = 0, fail = 0;
  await Promise.all(Array.from({ length: 5 }, async () => { while (next < USERS) { const i = next++; const email = `load.s${i}.${RUN}@example.test`;
    const x = await timed('setup', 'POST', '/api/auth/register', { json: { name: `Load Student ${i}`, email, password: `Tmp-${RUN}-S-Aa1!`, joinCode: cls.join_code } });
    if (x.status === 201) S.users.push({ email, id: x.data.user.id, token: x.data.token }); else fail++; } }));
  if (S.users.length < 5) throw new Error(`only ${S.users.length} students registered (${fail} failed) — rate limiter on? raise limits on the test copy`);
  console.log(`Ready: ${S.users.length} students (${fail} failed to register).\n`);
}

// ── phases ──────────────────────────────────────────────────────────────────
function summarise(label, level, extra = {}) {
  const all = [].concat(...[...REC.by.values()].map(e => e.lat)).sort((a, b) => a - b);
  return { label, level, requests: REC.total, errors: REC.bad, errorPct: REC.total ? +(100 * REC.bad / REC.total).toFixed(1) : 0, p50: pct(all, 50), p95: pct(all, 95), p99: pct(all, 99), max: all[all.length - 1] || 0, codes: REC.codes, ...extra };
}
async function loginStorm(level) {
  REC = newRecorder(); const stop = health(); const t0 = performance.now();
  await Promise.all(Array.from({ length: level }, (_, i) => { const u = S.users[i % S.users.length]; return timed('login', 'POST', '/api/auth/login', { json: { email: u.email, password: `Tmp-${RUN}-S-Aa1!` } }); }));
  const secs = (performance.now() - t0) / 1000; const h = await stop();
  return summarise('login-storm', level, { seconds: +secs.toFixed(1), perSec: +(level / secs).toFixed(1), healthP95: pct(h, 95), healthMax: h[h.length - 1] || 0 });
}
async function browse(level) {
  REC = newRecorder(); const stop = health(); const end = Date.now() + DURATION * 1000; const t0 = performance.now();
  const pages = [['me', '/api/auth/me'], ['work-items', '/api/student/work-items'], ['submissions', '/api/student/submissions'], ['results', '/api/student/results'], ['announcements', '/api/student/announcements'], ['materials', '/api/student/materials'], ['calendar', '/api/calendar'], ['server-time', '/api/server-time']];
  await Promise.all(Array.from({ length: level }, async (_, i) => { const u = S.users[i % S.users.length]; await sleep(Math.random() * 500);
    while (Date.now() < end) for (const [n, p] of pages) { if (Date.now() >= end) break; await timed(n, 'GET', p, { token: u.token }); await sleep(THINK * (0.5 + Math.random())); } }));
  const secs = (performance.now() - t0) / 1000; const h = await stop();
  return summarise('browse', level, { seconds: +secs.toFixed(1), perSec: +(REC.total / secs).toFixed(1), healthP95: pct(h, 95), healthMax: h[h.length - 1] || 0, perEndpoint: Object.fromEntries([...REC.by].map(([k, v]) => { const s = v.lat.sort((a, b) => a - b); return [k, { n: s.length, p50: pct(s, 50), p95: pct(s, 95) }]; })) });
}
async function submitWave() {
  const words = i => Array.from({ length: 250 }, (_, k) => `w${(i * 7 + k * 13) % 400}`).join(' ');
  const out = [];
  for (const [name, fn] of [['assignment', (u, i) => ({ workItemId: S.asg, content: words(i) })], ['quiz', u => ({ workItemId: S.quiz, content: JSON.stringify(Object.fromEntries(S.qs.map((q, i) => [q.id, i % 4]))) })]]) {
    REC = newRecorder(); const stop = health(); const t0 = performance.now();
    await Promise.all(S.users.map((u, i) => timed('submit-' + name, 'POST', '/api/student/submissions', { token: u.token, json: fn(u, i) })));
    const secs = (performance.now() - t0) / 1000; const h = await stop();
    out.push(summarise('submit-wave-' + name, S.users.length, { seconds: +secs.toFixed(1), healthP95: pct(h, 95), healthMax: h[h.length - 1] || 0 }));
  }
  return out;
}
async function cleanup() {
  const q = async f => { try { await f(); } catch { /* best effort */ } }; REC = newRecorder();
  for (let i = 0; i < S.users.length; i += 5) await Promise.all(S.users.slice(i, i + 5).map(u => q(() => timed('cleanup', 'DELETE', `/api/admin/students/${u.id}?permanent=true`, { token: S.admin }))));
  for (const id of [S.asg, S.quiz]) if (id) await q(() => timed('cleanup', 'DELETE', `/api/teacher/work-items/${id}`, { token: S.t }));
  if (S.tId) await q(() => timed('cleanup', 'DELETE', `/api/admin/teachers/${S.tId}`, { token: S.admin }));
}

function table(title, rows, cols) {
  console.log(`\n${title}`); console.log(cols.map(c => c[0].padStart(c[2] || 10)).join(' ')); console.log('-'.repeat(cols.reduce((a, c) => a + (c[2] || 10) + 1, 0)));
  for (const r of rows) console.log(cols.map(c => String(c[1](r)).padStart(c[2] || 10)).join(' '));
}

(async () => {
  try { await fetch(BASE + '/api/health', { signal: AbortSignal.timeout(8000) }); } catch (e) { console.error(`\nCannot reach ${BASE} (${e.cause?.code || e.message}). Is the backend running?\n`); process.exit(2); }
  const report = { base: BASE, at: new Date().toISOString(), durationPerStep: DURATION, think: THINK, storm: [], browse: [], wave: [] };
  try {
    await setup();
    console.log('PHASE 1 — login storm'); for (const L of LEVELS) { const r = await loginStorm(L); report.storm.push(r); console.log(`  ${String(L).padStart(4)} at once → ${r.perSec}/s, p95 ${fmt(r.p95)}, max ${fmt(r.max)}, errors ${r.errorPct}%`); if (r.errorPct > 50) { console.log('  >50% failing — stopping this phase'); break; } await sleep(1500); }
    console.log('PHASE 2 — sustained browsing'); for (const L of LEVELS) { const r = await browse(L); report.browse.push(r); console.log(`  ${String(L).padStart(4)} users → ${r.perSec} req/s, p95 ${fmt(r.p95)}, errors ${r.errorPct}%, health max ${fmt(r.healthMax)}`); if (r.errorPct > 50) { console.log('  >50% failing — stopping this phase'); break; } await sleep(2000); }
    console.log('PHASE 3 — everyone submits at once'); report.wave = await submitWave();
  } catch (e) { console.error('\nSetup/run problem:', e.message); report.error = e.message; }
  finally { console.log('\nCleaning up ...'); await cleanup(); }

  const cols = [['level', r => r.level, 7], ['req', r => r.requests, 7], ['req/s', r => r.perSec ?? '-', 8], ['p50', r => fmt(r.p50), 10], ['p95', r => fmt(r.p95), 10], ['p99', r => fmt(r.p99), 10], ['max', r => fmt(r.max), 10], ['err %', r => r.errorPct, 7], ['health p95', r => r.healthP95 !== undefined ? fmt(r.healthP95) : '-', 12], ['health max', r => r.healthMax !== undefined ? fmt(r.healthMax) : '-', 12]];
  table('LOGIN STORM (level = simultaneous logins)', report.storm, cols);
  table('SUSTAINED BROWSING (level = concurrent users)', report.browse, cols);
  table('SUBMIT WAVE (level = students submitting simultaneously)', report.wave, [['test', r => r.label.replace('submit-wave-', ''), 12], ...cols]);
  const last = report.browse[report.browse.length - 1];
  if (last?.perEndpoint) table(`PER-ENDPOINT at ${last.level} users`, Object.entries(last.perEndpoint).map(([k, v]) => ({ k, ...v })), [['endpoint', r => r.k, 14], ['calls', r => r.n, 8], ['p50', r => fmt(r.p50), 10], ['p95', r => fmt(r.p95), 10]]);
  console.log('\nHow to read this: p95 under ~1 s and ~0% errors = comfortable. "health max" rising far above p95 means ONE slow request froze the whole server for everyone.');
  console.log('Status-code mix per step is in wmhs-load-report.json (0 = timeout/refused, 429 = rate limited, 5xx = server error).');
  fs.writeFileSync('wmhs-load-report.json', JSON.stringify(report, null, 2));
})();
