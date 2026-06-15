# World Mission High School — Full Stack Portal

> **"Visionary Minds, Creative Innovations"**
> Production-ready school management system — React frontend + Node.js/Express backend + PostgreSQL database.

---

## Table of Contents

1. [What Was Built](#1-what-was-built)
2. [Tech Stack](#2-tech-stack)
3. [Project Structure](#3-project-structure)
4. [Prerequisites](#4-prerequisites)
5. [First Time Setup](#5-first-time-setup)
6. [Running in Development](#6-running-in-development)
7. [Running in Production](#7-running-in-production)
8. [Environment Variables Reference](#8-environment-variables-reference)
9. [Database Schema](#9-database-schema)
10. [API Endpoints Reference](#10-api-endpoints-reference)
11. [Security Features](#11-security-features)
12. [User Roles & Workflows](#12-user-roles--workflows)
13. [School Structure](#13-school-structure)
14. [File Uploads](#14-file-uploads)
15. [Deployment Guide](#15-deployment-guide)
16. [Troubleshooting](#16-troubleshooting)

---

## 1. What Was Built

| Layer        | Status | Details |
|--------------|--------|---------|
| Frontend     | ✅ Complete | React 18, all 3 role dashboards, all features |
| Backend API  | ✅ Complete | Node.js + Express, 30+ secured endpoints |
| Database     | ✅ Complete | PostgreSQL with full schema + indexes |
| Auth         | ✅ Complete | JWT tokens + bcrypt password hashing |
| File uploads | ✅ Complete | Multer — local storage (swap to S3 easily) |
| Rate limiting| ✅ Complete | Global + per-login limits |
| Security headers | ✅ Complete | Helmet.js (XSS, CSRF, clickjacking protection) |
| CORS         | ✅ Complete | Locked to frontend URL only |
| Input validation | ✅ Complete | express-validator on every endpoint |
| Auto-grading | ✅ Complete | MCQ quizzes graded server-side on submission |
| Duplicate detection | ✅ Complete | Jaccard similarity, server-side |
| Submission lock | ✅ Complete | One submission per student, locked on DB level |

---

## 2. Tech Stack

```
Frontend:   React 18  |  AuthContext (JWT)  |  Fetch API
Backend:    Node.js + Express 4
Database:   PostgreSQL 14+
Auth:       JWT (jsonwebtoken) + bcrypt (bcryptjs)
Security:   Helmet.js, express-rate-limit, express-validator, CORS
Files:      Multer (local) — ready to swap to Cloudinary/S3
```

---

## 3. Project Structure

```
wmhs-fullstack/
├── backend/
│   ├── src/
│   │   ├── server.js          ← Express app entry point
│   │   ├── db/
│   │   │   ├── pool.js        ← PostgreSQL connection pool
│   │   │   ├── init.js        ← Creates all tables (npm run db:init)
│   │   │   └── seed.js        ← Seeds 9 classes + admin (npm run db:seed)
│   │   ├── middleware/
│   │   │   ├── auth.js        ← JWT verify + role guards
│   │   │   ├── upload.js      ← Multer file upload handler
│   │   │   └── validate.js    ← express-validator error handler
│   │   └── routes/
│   │       ├── auth.js        ← /api/auth/*
│   │       ├── admin.js       ← /api/admin/*
│   │       ├── teacher.js     ← /api/teacher/*
│   │       ├── student.js     ← /api/student/*
│   │       └── announcements.js ← /api/announcements/*
│   ├── uploads/               ← Uploaded files (auto-created)
│   ├── .env.example           ← Copy to .env and fill in
│   └── package.json
│
└── frontend/
    ├── src/
    │   ├── App.js             ← Root, role-based routing
    │   ├── index.js           ← React entry point
    │   ├── context/
    │   │   └── AuthContext.js ← JWT session management
    │   ├── utils/
    │   │   └── api.js         ← All API calls in one place
    │   └── components/
    │       ├── AuthPage.js    ← Login + student register
    │       ├── shared/
    │       │   ├── UI.js      ← All reusable components
    │       │   └── Layout.js  ← Sidebar + top bar
    │       ├── admin/
    │       │   └── AdminPages.js
    │       ├── teacher/
    │       │   └── TeacherPages.js
    │       └── student/
    │           └── StudentPages.js
    ├── public/index.html
    ├── .env.example
    └── package.json
```

---

## 4. Prerequisites

- **Node.js** v18 or higher — https://nodejs.org
- **PostgreSQL** v14 or higher — https://www.postgresql.org/download/
- **npm** v9 or higher (comes with Node.js)

Verify:
```bash
node --version    # should be v18+
psql --version    # should be v14+
npm --version     # should be v9+
```

---

## 5. First Time Setup

### Step 1 — Create the database

```bash
# Open PostgreSQL shell
psql -U postgres

# Run these commands inside psql:
CREATE DATABASE wmhs_db;
CREATE USER wmhs_user WITH ENCRYPTED PASSWORD 'choose_a_strong_password';
GRANT ALL PRIVILEGES ON DATABASE wmhs_db TO wmhs_user;
\q
```

### Step 2 — Configure backend environment

```bash
cd backend
cp .env.example .env
```

Open `.env` and fill in:
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=wmhs_db
DB_USER=wmhs_user
DB_PASSWORD=choose_a_strong_password    # same as above

# Generate a JWT secret (run this in terminal, paste the output):
# node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET=paste_your_64_byte_hex_here
JWT_EXPIRES_IN=7d

PORT=5000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000

STORAGE_MODE=local
MAX_FILE_SIZE_MB=10
```

### Step 3 — Install backend dependencies

```bash
cd backend
npm install
```

### Step 4 — Create tables and seed data

```bash
npm run db:init    # Creates all 9 tables + indexes
npm run db:seed    # Seeds 9 classes + 1 admin account
```

You will see:
```
✅  Database connected successfully.
✅  All tables created successfully.
✅  9 classes seeded.
✅  Admin account seeded.
    Email:    admin@wmhs.ac.rw
    Password: Admin@WMHS2024!
    ⚠️  Change this password immediately after first login.
```

### Step 5 — Configure frontend environment

```bash
cd ../frontend
cp .env.example .env
```

Content of `.env`:
```env
REACT_APP_API_URL=http://localhost:5000
```

### Step 6 — Install frontend dependencies

```bash
npm install
```

---

## 6. Running in Development

Open **two terminals**:

**Terminal 1 — Backend:**
```bash
cd backend
npm run dev       # starts with nodemon, auto-restarts on changes
# API running at http://localhost:5000
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm start         # starts React dev server
# App running at http://localhost:3000
```

Open http://localhost:3000 in your browser.

**First login:**
- Email: `admin@wmhs.ac.rw`
- Password: `Admin@WMHS2024!`
- **Change the password immediately** via the Admin panel.

---

## 7. Running in Production

### Build the frontend

```bash
cd frontend
npm run build
# Output: frontend/build/
```

### Start the backend (serves frontend too)

```bash
cd backend
# Set NODE_ENV=production in your .env
npm start
# Backend serves React from frontend/build/ on the same port
```

Or run them separately (recommended for scaling):
- Deploy `frontend/build/` to Netlify, Vercel, or Nginx
- Deploy `backend/` to a VPS, Heroku, Railway, or Render

---

## 8. Environment Variables Reference

### Backend `.env`

| Variable | Required | Description |
|----------|----------|-------------|
| `DB_HOST` | ✅ | PostgreSQL host (e.g. `localhost`) |
| `DB_PORT` | ✅ | PostgreSQL port (default: `5432`) |
| `DB_NAME` | ✅ | Database name (`wmhs_db`) |
| `DB_USER` | ✅ | Database user |
| `DB_PASSWORD` | ✅ | Database password |
| `JWT_SECRET` | ✅ | 64-byte random hex string — NEVER share this |
| `JWT_EXPIRES_IN` | ✅ | Token expiry (e.g. `7d`, `24h`) |
| `PORT` | ✅ | Backend port (default: `5000`) |
| `NODE_ENV` | ✅ | `development` or `production` |
| `FRONTEND_URL` | ✅ | Exact frontend URL for CORS |
| `STORAGE_MODE` | ✅ | `local` or `cloudinary` |
| `MAX_FILE_SIZE_MB` | ✅ | Max upload size in MB (default: `10`) |
| `CLOUDINARY_CLOUD_NAME` | Only if cloudinary | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | Only if cloudinary | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Only if cloudinary | Cloudinary API secret |
| `RATE_LIMIT_WINDOW_MINUTES` | optional | Rate limit window (default: `15`) |
| `RATE_LIMIT_MAX_REQUESTS` | optional | Max requests per window (default: `200`) |
| `LOGIN_RATE_LIMIT_MAX` | optional | Max login attempts per window (default: `10`) |

### Frontend `.env`

| Variable | Description |
|----------|-------------|
| `REACT_APP_API_URL` | Backend URL (e.g. `https://api.yourschool.ac.rw`) |

---

## 9. Database Schema

9 tables, all created by `npm run db:init`:

| Table | Purpose |
|-------|---------|
| `users` | Admin, teachers, students — role + class assignment |
| `classes` | 9 hardcoded classes (L3-SOD through L5-MMP) with join codes |
| `modules` | Subject modules — links a teacher to a class |
| `work_items` | Assignments and quizzes |
| `questions` | MCQ questions for quizzes |
| `submissions` | Student submissions — locked on insert, auto-graded for quizzes |
| `materials` | Uploaded files per module |
| `announcements` | School-wide (admin) or module-level (teacher) |
| `replies` | Student replies to announcements |

Key constraints:
- `submissions(work_item_id, student_id)` — UNIQUE — one submission per student per work item, enforced at DB level
- `classes(join_code)` — UNIQUE — no duplicate codes
- `users(email)` — UNIQUE — no duplicate accounts
- `submissions.locked = TRUE` always — set on insert, never updated

---

## 10. API Endpoints Reference

### Auth — `/api/auth`
| Method | Path | Access | Description |
|--------|------|--------|-------------|
| POST | `/login` | Public | Login → returns JWT |
| POST | `/register` | Public | Student self-register via join code |
| GET | `/me` | Any role | Get current user |
| PATCH | `/password` | Any role | Change own password |

### Admin — `/api/admin` (admin only)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/stats` | Dashboard counts |
| GET | `/classes` | All 9 classes with counts |
| PATCH | `/classes/:id/reset-code` | Generate new join code |
| PATCH | `/classes/:id/toggle-code` | Enable/disable code |
| GET | `/classes/:classId/modules` | Modules for a class |
| POST | `/modules` | Assign teacher to module |
| GET | `/teachers` | All teacher accounts |
| POST | `/teachers` | Create teacher account |
| DELETE | `/teachers/:id` | Delete teacher |
| GET | `/students` | All students (optional ?classId) |
| DELETE | `/students/:id` | Remove student |

### Teacher — `/api/teacher` (admin + teacher)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/modules` | Teacher's assigned modules |
| GET | `/work-items` | Teacher's work items |
| POST | `/work-items` | Create assignment or quiz |
| DELETE | `/work-items/:id` | Delete work item |
| GET | `/questions/:workItemId` | Get questions (with correct answers) |
| POST | `/questions/:workItemId` | Save/replace questions |
| GET | `/submissions` | All submissions (optional ?workItemId) |
| PATCH | `/submissions/:id/grade` | Grade a submission |
| GET | `/materials` | Teacher's uploaded materials |
| POST | `/materials` | Upload file (multipart/form-data) |
| DELETE | `/materials/:id` | Delete material |
| GET | `/announcements` | Module + school announcements |
| POST | `/announcements` | Post module announcement |
| DELETE | `/announcements/:id` | Delete own announcement |
| GET | `/reports/:moduleId` | Performance report data |

### Student — `/api/student` (student only)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/work-items` | Work items for student's class |
| GET | `/questions/:workItemId` | Quiz questions (NO correct answers) |
| POST | `/submissions` | Submit work (locked permanently) |
| GET | `/submissions` | Own submissions |
| GET | `/materials` | Materials for student's class |
| GET | `/announcements` | Relevant announcements + replies |
| POST | `/announcements/:id/replies` | Reply to announcement |
| GET | `/results` | Own results per subject |

### Announcements — `/api/announcements` (admin only)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | All school-wide announcements |
| POST | `/` | Post school-wide announcement |
| DELETE | `/:id` | Delete announcement |
| GET | `/:id/replies` | Get replies |

---

## 11. Security Features

| Feature | Implementation |
|---------|---------------|
| Password hashing | bcrypt with 12 salt rounds |
| Session management | JWT — signed, expiring tokens stored in localStorage |
| Route protection | JWT middleware on every non-public route |
| Role enforcement | `requireAdmin`, `requireTeacher`, `requireStudent` guards |
| Ownership checks | Teachers can only grade/edit their own modules' work |
| CORS | Locked to `FRONTEND_URL` only |
| Security headers | Helmet.js (XSS, clickjacking, MIME sniffing protection) |
| Rate limiting | 200 req/15min global; 10 login attempts/15min |
| Input validation | express-validator on every POST/PATCH endpoint |
| SQL injection | Parameterized queries only — no string concatenation |
| File upload safety | MIME type whitelist, max size enforced, safe filenames |
| Duplicate submission | DB UNIQUE constraint prevents race conditions |
| Cheating prevention | Questions served to students WITHOUT correct_option field |

---

## 12. User Roles & Workflows

### Admin
1. Log in with seeded credentials
2. **Change password immediately** (Settings → Change Password)
3. Go to Teachers → create teacher accounts → share credentials
4. Go to Classes → assign teachers to modules
5. Share join codes with students per class
6. Post announcements as needed

### Teacher
1. Log in with credentials from admin
2. **Change password** (Change Password in sidebar)
3. Go to My Modules to see assigned classes
4. Create assignments/quizzes in Assignments & Quizzes
5. Upload notes in Materials
6. Grade submissions in Grading
7. View performance in Reports

### Student
1. Get join code from school admin
2. Go to the portal → Join as Student tab
3. Register with name, email, password, join code
4. View and submit work in My Work
5. Download materials in Materials
6. Reply to announcements in Announcements
7. Check scores in My Results

---

## 13. School Structure

9 classes — hardcoded, never changes:

| Level 3 | Level 4 | Level 5 |
|---------|---------|---------|
| L3-SOD  | L4-SOD  | L5-SOD  |
| L3-NIT  | L4-NIT  | L5-NIT  |
| L3-MMP  | L4-MMP  | L5-MMP  |

**SOD** = Software Development | **NIT** = Networking & IT | **MMP** = Multimedia Production

One teacher can be assigned to modules in multiple classes across different levels.
Example: Mr. Habimana → L3-SOD (Networking) + L5-NIT (Networking) + L4-MMP (Web Dev)

---

## 14. File Uploads

**Development (default):** Files saved to `backend/uploads/` folder. Served at `/uploads/filename`.

**Production (recommended):** Switch to Cloudinary:
1. Create free account at cloudinary.com
2. Set in `.env`:
   ```
   STORAGE_MODE=cloudinary
   CLOUDINARY_CLOUD_NAME=your_cloud_name
   CLOUDINARY_API_KEY=your_api_key
   CLOUDINARY_API_SECRET=your_api_secret
   ```
3. Install: `npm install cloudinary` in backend
4. Update `middleware/upload.js` to use Cloudinary storage

Allowed file types: PDF, PPTX, DOCX, XLSX, JPG, PNG
Max file size: configured by `MAX_FILE_SIZE_MB` (default: 10MB)

---

## 15. Deployment Guide

The most stable and persistent way to host this application is to split the frontend and backend. This ensures the React frontend is served fast via CDN (Netlify) and the Express backend handles state and files reliably (Render).

### Step 1: Database (PostgreSQL)
You need an external PostgreSQL database. 
- **Recommended:** [Supabase](https://supabase.com) (Free tier available).
- Create a project, go to **Project Settings -> Database**, and copy the **Connection string** (URI). It looks like `postgres://user:pass@host:port/db`.

### Step 2: Backend (Render.com)
1. Create a free account on [Render](https://render.com).
2. Click **New +** and select **Web Service**.
3. Connect your GitHub repository.
4. Set the following:
   - **Name:** `wmhs-backend`
   - **Root Directory:** `backend`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. Click **Advanced** and add **Environment Variables**:
   - `DATABASE_URL`: (The connection string from Supabase)
   - `JWT_SECRET`: (A long random string)
   - `NODE_ENV`: `production`
   - `FRONTEND_URL`: (Your Netlify URL - come back here after Step 3)
   - `ADMIN_JOIN_CODE`, `TEACHER_JOIN_CODE`, `STUDENT_JOIN_CODE`: (Set these for security)
6. Deploy. Copy the **Service URL** (e.g., `https://wmhs-backend.onrender.com`).

### Step 3: Frontend (Netlify.com)
1. Create a free account on [Netlify](https://netlify.com).
2. Click **Add new site** -> **Import from existing project**.
3. Connect your GitHub repository.
4. Netlify will automatically detect the `netlify.toml` file I've added. It should set:
   - **Base directory:** `frontend`
   - **Build command:** `npm run build`
   - **Publish directory:** `build`
5. Go to **Site Configuration -> Environment variables** and add:
   - `REACT_APP_API_URL`: (The Render Service URL from Step 2)
6. Deploy. Your site will be live at `https://random-name.netlify.app`.

### Step 4: Final Link
- Copy your Netlify URL and go back to Render. 
- Update the `FRONTEND_URL` environment variable in Render to match your Netlify URL. This is required for CORS to work.

---

## 16. Troubleshooting

**Persistence on Render:**
Render's free tier filesystem is **ephemeral**. If you restart the server, files in `uploads/` will be deleted. For permanent file storage:
1. **Paid:** Upgrade to a "Starter" plan on Render and add a **Persistent Disk** mounted at `/opt/render/project/src/backend/uploads`.
2. **Cloud (Best):** Switch to Cloudinary as described in [Section 14](#14-file-uploads). This is the "industry standard" for persistent files.


**`Database connection failed`**
- Check PostgreSQL is running: `sudo systemctl status postgresql`
- Check `.env` DB_* variables match what you created in psql
- On Mac: `brew services start postgresql`

**`Invalid token` after login**
- Make sure `JWT_SECRET` in `.env` is set and not empty
- Clear browser localStorage and log in again

**CORS error in browser**
- Make sure `FRONTEND_URL` in backend `.env` exactly matches your React app URL (including port)
- No trailing slash: `http://localhost:3000` not `http://localhost:3000/`

**File upload fails**
- Check `uploads/` folder exists in backend (auto-created, but check permissions)
- Check `MAX_FILE_SIZE_MB` is large enough
- Check file type is in the allowed list

**`relation "users" does not exist`**
- You forgot to run `npm run db:init`
- Check you're connected to the correct database

**Student can't join with code**
- Code is case-sensitive — must be uppercase (e.g. `XK7-R2`)
- Code may be disabled — admin needs to re-enable it in Classes panel

---

## Security Checklist Before Going Live

- [ ] Change admin password from `Admin@WMHS2024!`
- [ ] Set a strong `JWT_SECRET` (64-byte random hex)
- [ ] Set `NODE_ENV=production`
- [ ] Set `FRONTEND_URL` to actual domain (not localhost)
- [ ] Enable HTTPS (SSL certificate)
- [ ] Set strong `DB_PASSWORD`
- [ ] Never commit `.env` to Git (already in `.gitignore`)
- [ ] Back up the database regularly

---

*World Mission High School Portal — Built with security and simplicity in mind.*
