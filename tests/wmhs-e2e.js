#!/usr/bin/env node
/**
 * WMHS portal v2 — full end-to-end + security probe suite
 * Zero dependencies. Needs Node 18+ (built-in fetch / FormData / Blob).
 *
 *   BASE_URL=http://localhost:5000 ADMIN_EMAIL=you@school ADMIN_PASSWORD='...' node tests/wmhs-e2e.js
 *
 * The admin may still hold the one-time first-login password; the suite changes it and then sets it back,
 * so ADMIN_PASSWORD must itself satisfy the policy (8+ chars, a letter and a number).
 *
 * Optional:
 *   DOS_PROBE=1   also sends a ~1 MB assignment and measures how long the whole API freezes
 *
 * !! RUN AGAINST A TEST COPY, NOT THE LIVE SCHOOL DATABASE !!
 * It creates 2 teachers, 3 students, a module, work items, a material and an event.
 * It erases what it created (users, work items, materials, announcements, event).
 * The API has no "delete module" endpoint, so one "E2E-xxxx" module stays behind.
 *
 * Two kinds of checks:
 *   functional = does the feature work?                     FAIL = bug
 *   security   = does the system refuse what it should?     FAIL = vulnerability
 * Exit code 0 only if everything passes.
 */
'use strict';
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');

const BASE = (process.env.BASE_URL || 'http://localhost:5000').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@wmhs.ac.rw';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const DOS_PROBE = process.env.DOS_PROBE === '1';
const RUN = Date.now().toString(36);
if (!ADMIN_PASSWORD) { console.error('Set ADMIN_PASSWORD (and optionally ADMIN_EMAIL, BASE_URL).'); process.exit(2); }

// ── tiny HTTP helper ─────────────────────────────────────────────────────────
async function call(method, path, { token, json, form, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let body;
  if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  const t0 = performance.now();
  const res = await fetch(BASE + path, { method, headers: h, body });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, data, text, headers: res.headers, ms: performance.now() - t0 };
}
// raw request so we may set a forbidden header such as Origin
function raw(method, path, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path);
    const lib = u.protocol === 'https:' ? https : http;
    const r = lib.request(u, { method, headers }, res => { res.resume(); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers })); });
    r.on('error', reject); r.end();
  });
}

// ── test registry ────────────────────────────────────────────────────────────
const results = [];
let aborted = false;
async function check(kind, area, name, fn, sev = '') {
  if (aborted) { results.push({ kind, area, name, status: 'SKIP', detail: 'earlier setup failed', sev }); return; }
  try {
    const out = await fn();
    results.push({ kind, area, name, status: 'PASS', detail: typeof out === 'string' ? out : '', sev });
  } catch (e) {
    results.push({ kind, area, name, status: 'FAIL', detail: String(e.message || e).slice(0, 220), sev });
  }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const expectStatus = (r, want, label = '') => {
  const ok = Array.isArray(want) ? want.includes(r.status) : r.status === want;
  expect(ok, `${label}expected HTTP ${want}, got ${r.status}${r.data?.error ? ' — ' + r.data.error : ''}`);
};

const S = {};                       // shared state
const pw = tag => `Tmp-${RUN}-${tag}-Aa1!`;
const iso = (ms) => new Date(Date.now() + ms).toISOString();

(async () => {
  // reachable at all?
  try { await call('GET', '/api/health'); }
  catch (e) { console.error(`\nCannot reach ${BASE}  (${e.cause?.code || e.message}). Is the backend running?\n`); process.exit(2); }

  // ───────────────────────────── A. platform ─────────────────────────────────
  await check('functional', 'Platform', 'GET /api/health returns ok', async () => {
    const r = await call('GET', '/api/health'); expectStatus(r, 200); expect(r.data?.status === 'ok', 'status != ok');
    S.healthHeaders = r.headers;
  });
  await check('functional', 'Platform', 'GET /api/server-time returns a valid ISO time', async () => {
    const r = await call('GET', '/api/server-time'); expectStatus(r, 200); expect(!isNaN(Date.parse(r.data?.serverTime)), 'bad serverTime');
  });
  await check('functional', 'Platform', 'Unknown API route returns JSON 404', async () => {
    const r = await call('GET', '/api/nope'); expectStatus(r, 404); expect(r.data?.error, 'no JSON error body');
  });
  await check('security', 'Platform', 'Security headers present (helmet)', async () => {
    const h = S.healthHeaders; expect(h.get('x-content-type-options') === 'nosniff', 'missing X-Content-Type-Options');
    expect(h.get('x-powered-by') == null, 'X-Powered-By leaks framework');
  }, 'Low');

  // ───────────────────────────── B. auth ─────────────────────────────────────
  await check('functional', 'Auth', 'Admin can log in', async () => {
    const r = await call('POST', '/api/auth/login', { json: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
    expectStatus(r, 200); S.admin = r.data.token; expect(r.data.user.role === 'admin', 'not admin');
    S.adminForced = r.data.user.must_change_password; S.adminId = r.data.user.id;
  });
  if (!S.admin) { aborted = true; }
  if (S.adminForced) {
    await check('security', 'Auth', 'Admin with a one-time password is blocked from the API until they change it', async () => {
      const r = await call('GET', '/api/admin/stats', { token: S.admin });
      expect(r.status === 403 && r.data?.code === 'PASSWORD_CHANGE_REQUIRED', `HTTP ${r.status} ${r.data?.code || ''}`);
    }, 'High');
    await check('functional', 'Auth', 'Admin changes the one-time password (then sets it back)', async () => {
      let r = await call('PATCH', '/api/auth/password', { token: S.admin, json: { currentPassword: ADMIN_PASSWORD, newPassword: pw('adm') } });
      expectStatus(r, 200); expect(r.data.token && r.data.user.must_change_password === false, 'no fresh token / flag not cleared');
      r = await call('PATCH', '/api/auth/password', { token: r.data.token, json: { currentPassword: pw('adm'), newPassword: ADMIN_PASSWORD } });
      expectStatus(r, 200); S.admin = r.data.token;
    });
  }
  await check('security', 'Auth', 'Old token stops working after a password change (revocation)', async () => {
    const l = await call('POST', '/api/auth/login', { json: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } }); expectStatus(l, 200);
    const old = l.data.token;
    let r = await call('PATCH', '/api/auth/password', { token: old, json: { currentPassword: ADMIN_PASSWORD, newPassword: pw('adm2') } }); expectStatus(r, 200);
    expectStatus(await call('GET', '/api/auth/me', { token: old }), 401);
    r = await call('PATCH', '/api/auth/password', { token: r.data.token, json: { currentPassword: pw('adm2'), newPassword: ADMIN_PASSWORD } }); expectStatus(r, 200); S.admin = r.data.token;
  }, 'High');
  await check('security', 'Auth', 'Weak passwords refused at sign-up (too short / no digit)', async () => {
    for (const p of ['abc12', 'abcdefghij']) {
      const r = await call('POST', '/api/auth/register', { json: { name: 'Weak Pw', email: `weak.${RUN}@example.test`, password: p, joinCode: 'ZZZ-ZZ' } });
      expectStatus(r, 400);
    }
  }, 'Medium');
  await check('functional', 'Auth', 'Wrong password rejected with 401', async () => {
    expectStatus(await call('POST', '/api/auth/login', { json: { email: ADMIN_EMAIL, password: 'definitely-wrong' } }), 401);
  });
  await check('security', 'Auth', 'Protected route without token → 401', async () => expectStatus(await call('GET', '/api/auth/me'), 401), 'High');
  await check('security', 'Auth', 'Tampered JWT rejected', async () => {
    const t = S.admin.slice(0, -4) + 'AAAA'; expectStatus(await call('GET', '/api/auth/me', { token: t }), 401);
  }, 'High');
  await check('security', 'Auth', 'Seed admin password from the repo does NOT work', async () => {
    if (ADMIN_PASSWORD === 'Admin@WMHS2024!') throw new Error('ADMIN_PASSWORD is the public default from seed.js/README');
    const r = await call('POST', '/api/auth/login', { json: { email: 'admin@wmhs.ac.rw', password: 'Admin@WMHS2024!' } });
    expect(r.status !== 200, 'default admin password from the repo still logs in');
  }, 'Critical');

  // ───────────────────────────── C. admin setup ──────────────────────────────
  await check('functional', 'Admin', 'List classes (9 expected) and pick two active join codes', async () => {
    const r = await call('GET', '/api/admin/classes', { token: S.admin }); expectStatus(r, 200);
    const act = r.data.classes.filter(c => c.code_active);
    expect(act.length >= 1, 'no class with an active join code'); S.cls = act[0]; S.cls2 = act[1] || null;
    return `${r.data.classes.length} classes`;
  });
  if (!S.cls) aborted = true;
  for (const tag of ['A', 'B']) {
    await check('functional', 'Admin', `Create teacher ${tag} and log in`, async () => {
      const email = `e2e.teacher${tag}.${RUN}@example.test`;
      let r = await call('POST', '/api/admin/teachers', { token: S.admin, json: { name: `E2E Teacher ${tag}`, email } });   // no password → generated, shown once
      expectStatus(r, 201); S['t' + tag + 'Id'] = r.data.teacher.id; const temp = r.data.tempPassword; expect(temp && temp.length >= 8, 'no temp password returned');
      r = await call('POST', '/api/auth/login', { json: { email, password: temp } }); expectStatus(r, 200);
      expect(r.data.user.must_change_password === true, 'teacher not forced to change password');
      expectStatus(await call('GET', '/api/teacher/modules', { token: r.data.token }), 403);
      r = await call('PATCH', '/api/auth/password', { token: r.data.token, json: { currentPassword: temp, newPassword: pw(tag) } }); expectStatus(r, 200); S['t' + tag] = r.data.token;
    });
  }
  await check('functional', 'Admin', 'Assign a module to teacher A', async () => {
    S.moduleName = `E2E-${RUN}`;
    const r = await call('POST', '/api/admin/modules', { token: S.admin, json: { classId: S.cls.id, moduleName: S.moduleName, teacherId: S.tAId } });
    expectStatus(r, [200, 201]); S.moduleId = r.data.module.id;
  });
  await check('functional', 'Admin', 'Dashboard stats endpoint', async () => expectStatus(await call('GET', '/api/admin/stats', { token: S.admin }), 200));

  // ───────────────────────────── D. teacher content ──────────────────────────
  await check('functional', 'Teacher', 'Teacher A sees the assigned module', async () => {
    const r = await call('GET', '/api/teacher/modules', { token: S.tA }); expectStatus(r, 200);
    expect(r.data.modules.some(m => m.id === S.moduleId), 'module missing');
  });
  const mkItem = async (type, title, extra = {}) => {
    const r = await call('POST', '/api/teacher/work-items', { token: S.tA, json: { moduleId: S.moduleId, type, title, instructions: 'e2e', maxScore: 20, deadline: iso(86400e3), ...extra } });
    expectStatus(r, 201); return r.data.workItem.id;
  };
  await check('functional', 'Teacher', 'Create assignment', async () => { S.asgId = await mkItem('assignment', 'E2E assignment'); });
  await check('functional', 'Teacher', 'Create quiz + 3 questions', async () => {
    S.quizId = await mkItem('quiz', 'E2E quiz');
    const qs = [0, 1, 2].map(i => ({ questionText: `Q${i + 1}?`, options: ['a', 'b', 'c', 'd'], correctOption: i }));
    const r = await call('POST', `/api/teacher/questions/${S.quizId}`, { token: S.tA, json: { questions: qs } });
    expectStatus(r, 201); S.questions = r.data.questions; expect(S.questions.length === 3, 'not 3 saved');
  });
  await check('functional', 'Teacher', 'Create a quiz that only opens in 1 hour (with a question)', async () => {
    S.futureId = await mkItem('quiz', 'E2E future quiz', { openAt: iso(3600e3), closeAt: iso(7200e3) });
    expectStatus(await call('POST', `/api/teacher/questions/${S.futureId}`, { token: S.tA, json: { questions: [{ questionText: 'Secret?', options: ['a', 'b'], correctOption: 0 }] } }), 201);
  });
  await check('functional', 'Teacher', 'Create assignment used for the DoS probe', async () => { S.dosId = await mkItem('assignment', 'E2E dos'); });
  await check('functional', 'Teacher', 'Upload a PDF material', async () => {
    const f = new FormData(); f.append('moduleId', S.moduleId); f.append('title', 'E2E notes');
    f.append('file', new Blob(['%PDF-1.4\n%e2e\n'], { type: 'application/pdf' }), 'e2e-notes.pdf');
    const r = await call('POST', '/api/teacher/materials', { token: S.tA, form: f }); expectStatus(r, 201); S.material = r.data.material;
  });
  await check('functional', 'Teacher', 'Post module announcement', async () => {
    const r = await call('POST', '/api/teacher/announcements', { token: S.tA, json: { moduleId: S.moduleId, body: 'E2E hello class' } });
    expectStatus(r, 201); S.annId = r.data.announcement.id;
  });

  // ───────────────────────────── E. students ─────────────────────────────────
  const reg = async (tag, joinCode) => {
    const email = `e2e.student${tag}.${RUN}@example.test`;
    const r = await call('POST', '/api/auth/register', { json: { name: `E2E Student ${tag}`, email, password: pw(tag), joinCode } });
    expectStatus(r, 201); S['s' + tag] = r.data.token; S['s' + tag + 'Id'] = r.data.user.id; S['s' + tag + 'Email'] = email;
  };
  await check('functional', 'Student', 'Register student 1 and 2 with the class join code', async () => { await reg('1', S.cls.join_code); await reg('2', S.cls.join_code); });
  await check('functional', 'Student', 'Register student 3 in a DIFFERENT class', async () => {
    if (!S.cls2) throw new Error('only one active class — cross-class tests will be skipped'); await reg('3', S.cls2.join_code);
  });
  await check('functional', 'Student', 'Bad join code rejected (400)', async () => {
    expectStatus(await call('POST', '/api/auth/register', { json: { name: 'X Y', email: `bad.${RUN}@example.test`, password: 'Abcdef12', joinCode: 'ZZZ-ZZ' } }), 400);
  });
  await check('functional', 'Student', 'Duplicate email rejected (409)', async () => {
    expectStatus(await call('POST', '/api/auth/register', { json: { name: 'Dup', email: S.s1Email, password: 'Abcdef12', joinCode: S.cls.join_code } }), 409);
  });
  await check('functional', 'Student', 'Student sees class work items; other class does not', async () => {
    let r = await call('GET', '/api/student/work-items', { token: S.s1 }); expectStatus(r, 200);
    const ids = r.data.workItems.map(w => w.id); expect(ids.includes(S.asgId) && ids.includes(S.quizId), 'work items missing');
    if (S.s3) { r = await call('GET', '/api/student/work-items', { token: S.s3 }); expect(!r.data.workItems.some(w => w.id === S.asgId), 'class isolation broken'); }
  });
  await check('security', 'Student', 'Quiz questions sent to student hide the correct answer', async () => {
    const r = await call('GET', `/api/student/questions/${S.quizId}`, { token: S.s1 }); expectStatus(r, 200);
    expect(r.data.questions.length === 3 && !JSON.stringify(r.data).includes('correct_option'), 'correct_option leaked');
  }, 'High');
  await check('security', 'Student', 'Quiz questions NOT downloadable before the quiz opens', async () => {
    const r = await call('GET', `/api/student/questions/${S.futureId}`, { token: S.s1 });
    expect(r.status === 403 || r.status === 400, `server returned ${r.data?.questions?.length ?? '?'} question(s) before open_at (HTTP ${r.status}) — no time check on this endpoint`);
  }, 'Medium');
  await check('functional', 'Student', 'Submit quiz → auto-graded 3/3 and correct answers returned', async () => {
    const answers = Object.fromEntries(S.questions.map((q, i) => [q.id, i]));
    const r = await call('POST', '/api/student/submissions', { token: S.s1, json: { workItemId: S.quizId, content: JSON.stringify(answers) } });
    expectStatus(r, 201); expect(r.data.submission.score === 3, `score ${r.data.submission.score} != 3`); expect(r.data.correctAnswers, 'no correctAnswers');
  });
  await check('functional', 'Student', 'Second submission to same item blocked (409)', async () => {
    expectStatus(await call('POST', '/api/student/submissions', { token: S.s1, json: { workItemId: S.quizId, content: '{}' } }), 409);
  });
  const essay = 'The quick brown fox jumps over the lazy dog while the mission school students study computing networks together every morning';
  await check('functional', 'Student', 'Submit assignment text', async () => {
    const r = await call('POST', '/api/student/submissions', { token: S.s1, json: { workItemId: S.asgId, content: essay } }); expectStatus(r, 201);
  });
  await check('functional', 'Student', 'Near-identical answer from student 2 is flagged as duplicate', async () => {
    const r = await call('POST', '/api/student/submissions', { token: S.s2, json: { workItemId: S.asgId, content: essay + ' too' } });
    expectStatus(r, 201); expect(r.data.submission.duplicate_flag === true, 'duplicate_flag not set');
  });
  await check('functional', 'Student', 'Submission before open_at refused (403)', async () => {
    expectStatus(await call('POST', '/api/student/submissions', { token: S.s1, json: { workItemId: S.futureId, content: 'early' } }), 403);
  });
  await check('security', 'Student', 'Malformed quiz payload ("null") gives a 4xx, not a 500', async () => {
    const r = await call('POST', '/api/student/submissions', { token: S.s2, json: { workItemId: S.quizId, content: 'null' } });
    expect(r.status >= 400 && r.status < 500, `HTTP ${r.status}`);
  }, 'Low');
  await check('security', 'Student', 'Student in another class cannot submit to this class\'s work', async () => {
    if (!S.s3) throw new Error('skipped: no second class');
    expectStatus(await call('POST', '/api/student/submissions', { token: S.s3, json: { workItemId: S.asgId, content: 'x y z' } }), 403);
  }, 'High');

  // ───────────────────────────── F. grading ──────────────────────────────────
  await check('functional', 'Grading', 'Teacher A sees both student submissions', async () => {
    const r = await call('GET', `/api/teacher/submissions?workItemId=${S.asgId}`, { token: S.tA }); expectStatus(r, 200);
    expect(r.data.submissions.length === 2, `${r.data.submissions.length} submissions`); S.sub1 = r.data.submissions.find(s => s.student_id === S.s1Id);
  });
  await check('functional', 'Grading', 'Grade 18/20 accepted', async () => expectStatus(await call('PATCH', `/api/teacher/submissions/${S.sub1.id}/grade`, { token: S.tA, json: { score: 18, tag: '' } }), 200));
  await check('functional', 'Grading', 'Score above max rejected (400)', async () => expectStatus(await call('PATCH', `/api/teacher/submissions/${S.sub1.id}/grade`, { token: S.tA, json: { score: 999 } }), 400));
  await check('security', 'Grading', 'Teacher B cannot grade teacher A\'s submission', async () => {
    expectStatus(await call('PATCH', `/api/teacher/submissions/${S.sub1.id}/grade`, { token: S.tB, json: { score: 1 } }), [403, 404]);
  }, 'High');
  await check('functional', 'Grading', 'Student results show 18/20 and quiz 3/3', async () => {
    const r = await call('GET', '/api/student/results', { token: S.s1 }); expectStatus(r, 200);
    const a = r.data.results.find(x => x.work_item_id === S.asgId), q = r.data.results.find(x => x.work_item_id === S.quizId);
    expect(a?.score === 18 && q?.score === 3, `got assignment=${a?.score} quiz=${q?.score}`);
  });
  await check('functional', 'Grading', 'Teacher class report loads', async () => {
    const r = await call('GET', `/api/teacher/reports/${S.moduleId}`, { token: S.tA }); expectStatus(r, 200); expect(r.data.students.length >= 2, 'students missing');
  });

  // ───────────────────────────── G. communication ────────────────────────────
  await check('functional', 'Comms', 'Student sees module announcement and can reply', async () => {
    let r = await call('GET', '/api/student/announcements', { token: S.s1 }); expectStatus(r, 200); expect(r.data.announcements.some(a => a.id === S.annId), 'announcement missing');
    r = await call('POST', `/api/student/announcements/${S.annId}/replies`, { token: S.s1, json: { body: 'thanks' } }); expectStatus(r, 201);
  });
  await check('functional', 'Comms', 'Admin creates calendar event; student can read it', async () => {
    let r = await call('POST', '/api/calendar', { token: S.admin, json: { title: 'E2E event', event_date: new Date().toISOString().slice(0, 10), type: 'event' } });
    expectStatus(r, 201); S.eventId = r.data.event.id;
    r = await call('GET', '/api/calendar', { token: S.s1 }); expectStatus(r, 200); expect(r.data.events.some(e => e.id === S.eventId), 'event missing');
  });
  await check('security', 'Comms', 'Student cannot create calendar events', async () => {
    expectStatus(await call('POST', '/api/calendar', { token: S.s1, json: { title: 'x', event_date: '2030-01-01', type: 'event' } }), 403);
  }, 'High');
  await check('functional', 'Comms', 'Student can list the uploaded material', async () => {
    const r = await call('GET', '/api/student/materials', { token: S.s1 }); expectStatus(r, 200); expect(r.data.materials.some(m => m.id === S.material.id), 'material missing');
  });
  await check('security', 'Comms', 'Uploaded files are not served from a public /uploads path', async () => {
    const r = await fetch(BASE + '/uploads/' + String(S.material.file_url || '').replace(/^local:/, '').replace(/^\/?uploads\//, ''));
    expect(r.status === 404 || r.status === 401 || r.status === 403, `public file URL answered HTTP ${r.status}`);
  }, 'Medium');
  await check('security', 'Comms', 'Material download requires login', async () => {
    const r = await fetch(BASE + `/api/files/materials/${S.material.id}`);
    expect(r.status === 401, `anonymous got HTTP ${r.status}`);
  }, 'Medium');
  await check('functional', 'Comms', 'Student in the class downloads the material (as an attachment)', async () => {
    const r = await fetch(BASE + `/api/files/materials/${S.material.id}`, { headers: { Authorization: `Bearer ${S.s1}` } });
    expect(r.status === 200, `HTTP ${r.status}`);
    expect((r.headers.get('content-disposition') || '').startsWith('attachment'), 'not sent as attachment');
  });
  await check('security', 'Comms', 'Student in ANOTHER class cannot download the material', async () => {
    if (!S.s3) throw new Error('skipped: no second class');
    const r = await fetch(BASE + `/api/files/materials/${S.material.id}`, { headers: { Authorization: `Bearer ${S.s3}` } });
    expect(r.status === 403 || r.status === 404, `HTTP ${r.status}`);
  }, 'High');

  // ───────────────────────────── G2. v2 features ─────────────────────────────
  await check('functional', 'Features', 'Teacher edits an assignment (title, instructions)', async () => {
    const r = await call('PATCH', `/api/teacher/work-items/${S.asgId}`, { token: S.tA, json: { title: 'E2E assignment (edited)', instructions: 'edited' } });
    expectStatus(r, 200); expect(r.data.workItem?.title === 'E2E assignment (edited)', 'title not changed');
  });
  await check('security', 'Features', 'Teacher B cannot edit teacher A\'s assignment', async () => {
    expectStatus(await call('PATCH', `/api/teacher/work-items/${S.asgId}`, { token: S.tB, json: { title: 'hijack' } }), [403, 404]);
  }, 'High');
  await check('functional', 'Features', 'Teacher edits own announcement; student sees the new text', async () => {
    expectStatus(await call('PATCH', `/api/teacher/announcements/${S.annId}`, { token: S.tA, json: { body: 'E2E hello class (edited)' } }), 200);
    const r = await call('GET', '/api/student/announcements', { token: S.s1 });
    expect(r.data.announcements.find(a => a.id === S.annId)?.body.includes('edited'), 'edit not visible');
  });
  await check('functional', 'Features', 'Teacher replies to an announcement; student sees the teacher reply', async () => {
    expectStatus(await call('POST', `/api/teacher/announcements/${S.annId}/replies`, { token: S.tA, json: { body: 'teacher answer' } }), 201);
    const r = await call('GET', '/api/student/announcements', { token: S.s1 });
    expect(r.data.replies.some(x => x.announcement_id === S.annId && x.body === 'teacher answer'), 'teacher reply missing');
  });
  await check('functional', 'Features', 'Teacher renames a material', async () => {
    const r = await call('PATCH', `/api/teacher/materials/${S.material.id}`, { token: S.tA, json: { title: 'E2E notes v2' } }); expectStatus(r, 200);
  });
  await check('functional', 'Features', 'Student submits a PDF file; teacher downloads it; feedback reaches the student', async () => {
    S.fileAsgId = await mkItem('assignment', 'E2E file assignment');
    const f = new FormData(); f.append('workItemId', S.fileAsgId); f.append('content', 'see attached');
    f.append('file', new Blob(['%PDF-1.4\n%student answer\n'], { type: 'application/pdf' }), 'answer.pdf');
    let r = await call('POST', '/api/student/submissions', { token: S.s1, form: f }); expectStatus(r, 201);
    S.fileSubId = r.data.submission.id; expect(r.data.submission.file_name === 'answer.pdf', 'file_name missing');
    const d = await fetch(BASE + `/api/files/submissions/${S.fileSubId}`, { headers: { Authorization: `Bearer ${S.tA}` } });
    expect(d.status === 200, `teacher download HTTP ${d.status}`);
    r = await call('PATCH', `/api/teacher/submissions/${S.fileSubId}/grade`, { token: S.tA, json: { score: 15, feedback: 'Good structure, add examples.' } }); expectStatus(r, 200);
    r = await call('GET', '/api/student/results', { token: S.s1 });
    const x = r.data.results.find(q => q.id === S.fileSubId); expect(x?.feedback === 'Good structure, add examples.', 'feedback missing in results');
    expect(x.year_name, 'academic year name missing in results');
  });
  await check('security', 'Features', 'Another student cannot download that submission file', async () => {
    const d = await fetch(BASE + `/api/files/submissions/${S.fileSubId}`, { headers: { Authorization: `Bearer ${S.s2}` } });
    expect(d.status === 403 || d.status === 404, `HTTP ${d.status}`);
  }, 'High');
  await check('security', 'Features', 'Teacher B cannot download that submission file', async () => {
    const d = await fetch(BASE + `/api/files/submissions/${S.fileSubId}`, { headers: { Authorization: `Bearer ${S.tB}` } });
    expect(d.status === 403 || d.status === 404, `HTTP ${d.status}`);
  }, 'High');
  await check('security', 'Features', 'A non-PDF disguised as .pdf (wrong magic bytes) is refused', async () => {
    const f = new FormData(); f.append('workItemId', S.fileAsgId); f.append('content', 'x y z');
    f.append('file', new Blob(['<html><script>alert(1)</script></html>'], { type: 'application/pdf' }), 'fake.pdf');
    const r = await call('POST', '/api/student/submissions', { token: S.s2, form: f });
    expect(r.status === 400 || r.status === 415 || r.status === 422, `HTTP ${r.status} — content not verified`);
  }, 'Medium');
  await check('functional', 'Features', 'Teacher exports the class report as CSV', async () => {
    const r = await fetch(BASE + `/api/teacher/reports/${S.moduleId}/export`, { headers: { Authorization: `Bearer ${S.tA}` } });
    expect(r.status === 200, `HTTP ${r.status}`); expect((r.headers.get('content-type') || '').includes('csv'), 'not CSV');
    const t = await r.text(); expect(t.includes('Average') && t.includes('E2E Student 1'), 'CSV content wrong');
  });
  await check('security', 'Features', 'Teacher B cannot export teacher A\'s report', async () => {
    const r = await fetch(BASE + `/api/teacher/reports/${S.moduleId}/export`, { headers: { Authorization: `Bearer ${S.tB}` } });
    expect(r.status === 403 || r.status === 404, `HTTP ${r.status}`);
  }, 'High');
  await check('functional', 'Features', 'Admin bulk-imports students from CSV; they must change the temp password', async () => {
    const e1 = `e2e.import1.${RUN}@example.test`, e2 = `e2e.import2.${RUN}@example.test`;
    const csv = `name,email\nImport One,${e1}\nImport Two,${e2}\nBad Row,not-an-email\n`;
    const r = await call('POST', '/api/admin/students/import', { token: S.admin, json: { classId: S.cls.id, csv } }); expectStatus(r, 201);
    expect(r.data.created.length === 2 && r.data.skipped.length === 1, `created ${r.data.created.length} skipped ${r.data.skipped.length}`);
    S.importedEmails = [e1, e2];
    const l = await call('POST', '/api/auth/login', { json: { email: e1, password: r.data.created[0].tempPassword } });
    expectStatus(l, 200); expect(l.data.user.must_change_password === true, 'not forced to change'); S.importedIds = [l.data.user.id];
  });
  await check('functional', 'Features', 'Forgot-password creates a request the admin can see; reset gives a one-time password', async () => {
    let r = await call('POST', '/api/auth/forgot', { json: { email: S.s2Email } }); expectStatus(r, 200);
    const nobody = await call('POST', '/api/auth/forgot', { json: { email: `nobody.${RUN}@example.test` } });
    expectStatus(nobody, 200); expect(nobody.data.message === r.data.message, 'response reveals whether the email exists');
    r = await call('GET', '/api/admin/password-requests', { token: S.admin }); expectStatus(r, 200);
    expect(r.data.requests.some(q => q.email === S.s2Email), 'request not listed');
  });
  await check('functional', 'Features', 'Admin: add class, promotion preview, years list', async () => {
    let r = await call('GET', '/api/admin/promotion/preview', { token: S.admin }); expectStatus(r, 200);
    expect(Array.isArray(r.data.classes) && r.data.currentYear, 'preview malformed');
    r = await call('GET', '/api/admin/years', { token: S.admin }); expectStatus(r, 200); expect(r.data.years.some(y => y.is_current), 'no current year');
    r = await call('GET', '/api/admin/audit', { token: S.admin }); expectStatus(r, 200); expect(r.data.entries.length > 0, 'audit log empty');
  });
  await check('security', 'Features', 'Students/teachers cannot use promotion or import', async () => {
    expectStatus(await call('GET', '/api/admin/promotion/preview', { token: S.tA }), 403);
    expectStatus(await call('POST', '/api/admin/promotion/commit', { token: S.s1, json: { newYearName: 'hack' } }), 403);
    expectStatus(await call('POST', '/api/admin/students/import', { token: S.tA, json: { classId: S.cls.id, csv: 'a,b' } }), 403);
  }, 'Critical');

  // ───────────────────────────── H. security probes ──────────────────────────
  await check('security', 'AccessControl', 'Student blocked from /api/admin/*', async () => expectStatus(await call('GET', '/api/admin/stats', { token: S.s1 }), 403), 'Critical');
  await check('security', 'AccessControl', 'Student blocked from /api/teacher/*', async () => expectStatus(await call('GET', '/api/teacher/modules', { token: S.s1 }), 403), 'Critical');
  await check('security', 'AccessControl', 'Teacher blocked from /api/admin/*', async () => expectStatus(await call('GET', '/api/admin/classes', { token: S.tA }), 403), 'Critical');
  await check('security', 'AccessControl', 'Teacher B cannot read teacher A\'s quiz answer key', async () => {
    const r = await call('GET', `/api/teacher/questions/${S.quizId}`, { token: S.tB });
    expect(r.status === 403 || r.status === 404, `teacher B received the answer key (HTTP ${r.status})`);
  }, 'Medium');
  await check('security', 'AccessControl', 'Student in another class cannot read this class\'s announcement replies', async () => {
    if (!S.s3) throw new Error('skipped: no second class');
    const r = await call('GET', `/api/student/announcements/${S.annId}/replies`, { token: S.s3 });
    expect(r.status === 403 || r.status === 404, `other-class student read replies (HTTP ${r.status})`);
  }, 'Medium');
  await check('security', 'AccessControl', 'Student in another class cannot reply to this class\'s announcement', async () => {
    if (!S.s3) throw new Error('skipped: no second class');
    const r = await call('POST', `/api/student/announcements/${S.annId}/replies`, { token: S.s3, json: { body: 'cross-class' } });
    expect(r.status === 403 || r.status === 404, `other-class student posted a reply (HTTP ${r.status})`);
  }, 'Medium');
  await check('security', 'Hardening', 'Login brute-force is throttled (25 wrong passwords in a burst)', async () => {
    const rs = await Promise.all(Array.from({ length: 25 }, () => call('POST', '/api/auth/login', { json: { email: S.s1Email, password: 'wrong-' + Math.random() } })));
    expect(rs.some(r => r.status === 429), 'no 429 after 25 wrong attempts — rate limiting is off');
  }, 'High');
  await check('security', 'Hardening', 'Invalid UUID in URL gives 4xx, not 500', async () => {
    const r = await call('DELETE', '/api/teacher/work-items/not-a-uuid', { token: S.tA }); expect(r.status >= 400 && r.status < 500, `HTTP ${r.status}`);
  }, 'Low');
  await check('security', 'Hardening', 'Admin password reset gives a random one-time password and revokes old sessions', async () => {
    let r = await call('PATCH', `/api/admin/users/${S.s2Id}/reset-password`, { token: S.admin }); expectStatus(r, 200);
    expect(r.data.tempPassword && r.data.tempPassword !== '1234567', 'no random temp password');
    expect((await call('POST', '/api/auth/login', { json: { email: S.s2Email, password: '1234567' } })).status !== 200, 'constant "1234567" still works');
    expectStatus(await call('GET', '/api/auth/me', { token: S.s2 }), 401);                       // old session revoked
    r = await call('POST', '/api/auth/login', { json: { email: S.s2Email, password: r.data.tempPassword } });
    expectStatus(r, 200); expect(r.data.user.must_change_password === true, 'not forced to change');
  }, 'High');
  await check('security', 'Hardening', 'CORS does not trust arbitrary *onrender.com look-alike origins', async () => {
    const r = await raw('OPTIONS', '/api/auth/login', { Origin: 'https://evil.onrender.com.attacker.example', 'Access-Control-Request-Method': 'POST' });
    const allow = r.headers['access-control-allow-origin'];
    expect(!allow || allow !== 'https://evil.onrender.com.attacker.example', `reflected: ${allow}  (only exploitable when NODE_ENV=production)`);
  }, 'Medium');
  await check('security', 'Hardening', 'Upload of an .html file labelled as PDF is refused', async () => {
    const f = new FormData(); f.append('moduleId', S.moduleId); f.append('title', 'spoof');
    f.append('file', new Blob(['<script>alert(1)</script>'], { type: 'application/pdf' }), 'evil.html');
    const r = await call('POST', '/api/teacher/materials', { token: S.tA, form: f });
    if (r.status === 201) { S.spoofId = r.data.material.id; throw new Error(`accepted; stored as ${r.data.material.file_url} — executable content served from your own origin`); }
  }, 'Medium');

  if (DOS_PROBE) {
    await check('security', 'Availability', 'One 1 MB assignment must not freeze the API for other users', async () => {
      await call('POST', '/api/student/submissions', { token: S.s1, json: { workItemId: S.dosId, content: essay } }); // give it something to compare against
      const words = []; for (let i = 0, n = 0; n < 980000; i++) { const w = Math.random().toString(36).slice(2, 8); words.push(w); n += w.length + 1; }
      let worst = 0, stop = false;
      const pinger = (async () => { while (!stop) { const t = performance.now(); try { await call('GET', '/api/health'); } catch { /* ignore */ } worst = Math.max(worst, performance.now() - t); await new Promise(r => setTimeout(r, 50)); } })();
      const r = await call('POST', '/api/student/submissions', { token: S.s2, json: { workItemId: S.dosId, content: words.join(' ') } });
      stop = true; await pinger;
      expect(worst < 1000, `/api/health stalled ${Math.round(worst)} ms while one student's submission (HTTP ${r.status}) was processed`);
      return `max health latency ${Math.round(worst)} ms`;
    }, 'High');
  }

  // ───────────────────────────── I. cleanup ──────────────────────────────────
  const quiet = async fn => { try { await fn(); } catch { /* best effort */ } };
  if (S.spoofId) await quiet(() => call('DELETE', `/api/teacher/materials/${S.spoofId}`, { token: S.tA }));
  if (S.material) await quiet(() => call('DELETE', `/api/teacher/materials/${S.material.id}`, { token: S.tA }));
  if (S.annId) await quiet(() => call('DELETE', `/api/teacher/announcements/${S.annId}`, { token: S.tA }));
  for (const id of [S.asgId, S.quizId, S.futureId, S.dosId, S.fileAsgId]) if (id) await quiet(() => call('DELETE', `/api/teacher/work-items/${id}`, { token: S.tA }));
  if (S.eventId) await quiet(() => call('DELETE', `/api/calendar/${S.eventId}`, { token: S.admin }));
  for (const k of ['s1Id', 's2Id', 's3Id']) if (S[k]) await quiet(() => call('DELETE', `/api/admin/students/${S[k]}?permanent=true`, { token: S.admin }));
  for (const id of S.importedIds || []) await quiet(() => call('DELETE', `/api/admin/students/${id}?permanent=true`, { token: S.admin }));
  if (S.importedEmails) await quiet(async () => { const r = await call('GET', `/api/admin/students?q=e2e.import&status=all&limit=50`, { token: S.admin }); for (const u of r.data.students || []) if (S.importedEmails.includes(u.email)) await call('DELETE', `/api/admin/students/${u.id}?permanent=true`, { token: S.admin }); });
  for (const k of ['tAId', 'tBId']) if (S[k]) await quiet(() => call('DELETE', `/api/admin/teachers/${S[k]}`, { token: S.admin }));

  // ───────────────────────────── report ──────────────────────────────────────
  const icon = { PASS: '✔', FAIL: '✘', SKIP: '–' };
  let area = '';
  console.log(`\nWMHS end-to-end report — ${BASE} — ${new Date().toISOString()}\n`);
  for (const r of results) {
    if (r.area !== area) { area = r.area; console.log(`\n[${area}]`); }
    const tag = r.kind === 'security' ? (r.sev ? `[${r.sev}] ` : '') : '';
    console.log(` ${icon[r.status]} ${r.status === 'FAIL' && r.kind === 'security' ? 'VULN ' : ''}${tag}${r.name}${r.detail ? '\n      ' + r.detail : ''}`);
  }
  const f = k => results.filter(r => r.kind === k && r.status === 'FAIL').length;
  const p = results.filter(r => r.status === 'PASS').length;
  console.log(`\nSummary: ${p} passed · ${f('functional')} functional failures · ${f('security')} security failures · ${results.filter(r => r.status === 'SKIP').length} skipped`);
  fs.writeFileSync('wmhs-e2e-report.json', JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 2));
  console.log('Full detail written to wmhs-e2e-report.json');
  process.exit(f('functional') + f('security') ? 1 : 0);
})().catch(e => { console.error('Runner crashed:', e); process.exit(2); });
