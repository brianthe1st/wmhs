# World Mission High School — School Portal (v2)

*"Visionary Minds, Creative Innovations"*

A classroom portal for admins, teachers and students: assignments, auto-graded quizzes, grading with feedback, materials, announcements with replies, calendar, reports, academic years and student promotion.

**Stack:** React 18 (CRA) · Node/Express 4 · PostgreSQL · JWT · bcrypt. One server serves both API and built frontend.

## What's new in v2
* **Login / sign-up**: split screen, left half solid blue, right half white (phones: blue top, white bottom).
* **Mobile redesign**: bottom tab bar + "More" sheet, bottom-sheet dialogs, safe-area aware, no more squeezed icon sidebar.
* **Teachers**: edit assignments/quizzes/announcements/materials, written feedback, view student file uploads, reply to announcements, export reports to CSV (Excel), year filter.
* **Students**: attach a file to an assignment, see teacher feedback, results grouped by academic year, print/save as PDF.
* **Admin**: add classes, deactivate/restore/erase students, move class, CSV bulk import, "forgot password" requests, one-time random passwords, activity log, **new academic year / promotion** (with undo).
* **Security & reliability fixes**: see `docs/` and the list below.

## Security changes from v1
Leaked credentials file removed (rotate them!) · no default admin password · random one-time passwords + forced change · password policy (8+, letter+digit) · token revocation on password change · rate limiting enabled (per account and per IP) · authenticated, authorised file downloads (no public `/uploads`) · uploaded files verified by content, random names · IDOR fixes on announcements/replies/materials/questions · quiz questions not released before opening · exact CORS origin matching · CSP headers · UUID validation · bounded duplicate-detection (no more API freeze) · double-submit race closed · DB pool error handler · API responses never cached by the service worker · CSV formula-injection guard · audit log.

## Run locally
```bash
# 1. database
createdb wmhs_db
# 2. backend
cd backend && cp .env.example .env     # set DB_*, JWT_SECRET (32+ chars), ADMIN_PASSWORD
npm install && npm run dev             # or: node src/db/init.js && node src/db/seed.js && node src/server.js
# 3. frontend (new terminal)
cd frontend && npm install && npm start   # http://localhost:3000 (proxy → :5000)
```
First admin = `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env` (you must change it at first sign-in). Join codes are random; read them in **Admin → Classes**.

## Production
`npm run build` then `npm start` from the repo root (Render blueprint included: `render.yaml`). Read **docs/DEPLOYMENT.md** first: persistent file storage, paid database + backups, secrets.

## Documents
* `docs/DEPLOYMENT.md` — deploy checklist, settings, backups, capacity
* `docs/NEW_ACADEMIC_YEAR.md` — how promotion works (admin guide)
* `tests/wmhs-e2e.js` — end-to-end + security probe suite (run on a test copy)
* `tests/wmhs-load.js` — traffic test (login storm, browsing, deadline rush)

## Roles
* **Admin** — classes, join codes, teachers, students, promotion, announcements, calendar, password help.
* **Teacher** — own modules: assignments, quizzes, grading, materials, announcements, reports.
* **Student** — joins with a class code; submits work once (locked), sees results.

## Known limits (be honest with the school)
* No email: password recovery is "ask the office" (a request list for the admin).
* Single Node process; fine for a few hundred students, measure with `tests/wmhs-load.js`.
* No parent accounts, attendance, or timetable.
* Auto-grading covers multiple-choice only.
