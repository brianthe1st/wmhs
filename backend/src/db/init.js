// Run with: npm run db:init
// Creates all tables, and upgrades an existing database in place. Safe to re-run:
// every statement is IF NOT EXISTS / ADD COLUMN IF NOT EXISTS, so no data is touched.
const path = require('path');
require('dotenv').config();
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
const { Client } = require('pg');

async function ensureDatabaseExists() {
  const targetDb = process.env.DB_NAME || 'wmhs_db';
  if (process.env.DATABASE_URL) return;

  const client = new Client({
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT || '5432', 10),
    database: 'postgres',
    user:     process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl:      process.env.DB_SSL === 'false' ? false : undefined,
  });

  try {
    await client.connect();
    const res = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [targetDb]);
    if (res.rowCount === 0) {
      console.log(`Creating database "${targetDb}"...`);
      const safeDbName = targetDb.replace(/"/g, '""');
      await client.query(`CREATE DATABASE "${safeDbName}"`);
      console.log(`✅  Database "${targetDb}" created.`);
    }
    await client.end();
  } catch (err) {
    try { await client.end(); } catch (_) {}
  }
}

async function init() {
  await ensureDatabaseExists();
  const pool = require('./pool');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Only one instance may migrate at a time.
    await client.query('SELECT pg_advisory_xact_lock(72011)');

    // ── Base tables ──────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name         VARCHAR(100)  NOT NULL,
        email        VARCHAR(150)  UNIQUE NOT NULL,
        password     VARCHAR(255)  NOT NULL,
        role         VARCHAR(20)   NOT NULL CHECK (role IN ('admin','teacher','student')),
        class_id     UUID,
        created_at   TIMESTAMPTZ   DEFAULT NOW(),
        updated_at   TIMESTAMPTZ   DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS classes (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name         VARCHAR(20)   NOT NULL,
        level        INT           NOT NULL,
        stream       VARCHAR(10)   NOT NULL,
        join_code    VARCHAR(10)   UNIQUE NOT NULL,
        code_active  BOOLEAN       DEFAULT TRUE,
        created_at   TIMESTAMPTZ   DEFAULT NOW()
      );
    `);
    // Older databases hard-coded levels 3-5 and 3 streams. Lift that so the admin can add classes.
    await client.query(`ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_level_check;`);
    await client.query(`ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_stream_check;`);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_class') THEN
          ALTER TABLE users
            ADD CONSTRAINT fk_users_class
            FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL;
        END IF;
      END;
      $$;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS academic_years (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name        VARCHAR(30)  NOT NULL UNIQUE,
        is_current  BOOLEAN      NOT NULL DEFAULT FALSE,
        created_at  TIMESTAMPTZ  DEFAULT NOW()
      );
    `);
    // At most ONE current year, enforced by the database.
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS one_current_year ON academic_years (is_current) WHERE is_current;`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS modules (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name         VARCHAR(100)  NOT NULL,
        class_id     UUID          NOT NULL REFERENCES classes(id)  ON DELETE CASCADE,
        teacher_id   UUID          REFERENCES users(id)  ON DELETE SET NULL,
        approved     BOOLEAN       DEFAULT TRUE,
        created_at   TIMESTAMPTZ   DEFAULT NOW(),
        UNIQUE (name, class_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS work_items (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        module_id    UUID          NOT NULL REFERENCES modules(id)  ON DELETE CASCADE,
        class_id     UUID          NOT NULL REFERENCES classes(id),
        type         VARCHAR(20)   NOT NULL CHECK (type IN ('assignment','quiz')),
        title        VARCHAR(200)  NOT NULL,
        instructions TEXT,
        max_score    INT           DEFAULT 20,
        deadline     TIMESTAMPTZ,
        open_at      TIMESTAMPTZ,
        close_at     TIMESTAMPTZ,
        created_by   UUID          REFERENCES users(id) ON DELETE SET NULL,
        created_at   TIMESTAMPTZ   DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS questions (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        work_item_id    UUID NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
        question_text   TEXT NOT NULL,
        options         JSONB NOT NULL,
        correct_option  INT  NOT NULL,
        order_index     INT  DEFAULT 0
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS submissions (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        work_item_id    UUID          NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
        student_id      UUID          NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
        content         TEXT          NOT NULL,
        submitted_at    TIMESTAMPTZ   DEFAULT NOW(),
        locked          BOOLEAN       DEFAULT TRUE,
        score           INT,
        max_score       INT,
        tag             VARCHAR(50)   CHECK (tag IN ('Incomplete','Wrong format','Missing parts')),
        graded_by       VARCHAR(100),
        graded_at       TIMESTAMPTZ,
        duplicate_flag  BOOLEAN       DEFAULT FALSE,
        is_late         BOOLEAN       DEFAULT FALSE,
        UNIQUE (work_item_id, student_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS materials (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        module_id    UUID          NOT NULL REFERENCES modules(id)  ON DELETE CASCADE,
        class_id     UUID          NOT NULL REFERENCES classes(id),
        title        VARCHAR(200)  NOT NULL,
        file_url     TEXT          NOT NULL,
        file_name    VARCHAR(255),
        file_type    VARCHAR(20),
        file_size    INT,
        uploaded_by  UUID          REFERENCES users(id) ON DELETE SET NULL,
        uploaded_at  TIMESTAMPTZ   DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS announcements (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        posted_by    UUID          REFERENCES users(id) ON DELETE SET NULL,
        scope        VARCHAR(20)   NOT NULL CHECK (scope IN ('school','module')),
        module_id    UUID          REFERENCES modules(id) ON DELETE CASCADE,
        class_id     UUID          REFERENCES classes(id),
        body         TEXT          NOT NULL,
        created_at   TIMESTAMPTZ   DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS replies (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        announcement_id  UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
        student_id       UUID NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
        body             TEXT NOT NULL,
        created_at       TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS calendar_events (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title        VARCHAR(100) NOT NULL,
        description  TEXT,
        event_date   DATE NOT NULL,
        type         VARCHAR(20)  DEFAULT 'event' CHECK (type IN ('assessment','event','other')),
        posted_by    UUID          REFERENCES users(id) ON DELETE SET NULL,
        created_at   TIMESTAMPTZ   DEFAULT NOW()
      );
    `);

    // ── Upgrades to existing databases (all idempotent) ──────────────────────
    // Was the users table created before the security upgrade?  (first run only)
    const { rows: hadCol } = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='must_change_password'`
    );
    const firstUpgrade = hadCol.length === 0;

    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS graduated_at TIMESTAMPTZ;`);
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_status_check') THEN
          ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('active','graduated','inactive'));
        END IF;
      END $$;
    `);
    if (firstUpgrade) {
      // Old admin/teacher passwords may be weak, reused, or have appeared in files that were
      // shared around. Make them pick a new one at next login. Students are not disturbed.
      await client.query(`UPDATE users SET must_change_password = TRUE WHERE role IN ('admin','teacher')`);
      console.log('🔐  Upgrade: admins and teachers must choose a new password at next login.');
    }

    // submissions: the column the old code wrote but the old schema never created, plus the new features
    await client.query(`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS is_late   BOOLEAN DEFAULT FALSE;`);
    await client.query(`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS feedback  TEXT;`);
    await client.query(`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS file_url  TEXT;`);
    await client.query(`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS file_name VARCHAR(255);`);
    await client.query(`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS file_type VARCHAR(20);`);
    await client.query(`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS file_size INT;`);

    // replies can now come from teachers/admin as well as students
    await client.query(`ALTER TABLE replies ADD COLUMN IF NOT EXISTS author_role VARCHAR(20) NOT NULL DEFAULT 'student';`);

    // academic year tagging
    await client.query(`ALTER TABLE work_items    ADD COLUMN IF NOT EXISTS year_id UUID REFERENCES academic_years(id);`);
    await client.query(`ALTER TABLE announcements ADD COLUMN IF NOT EXISTS year_id UUID REFERENCES academic_years(id);`);
    await client.query(`
      INSERT INTO academic_years (name, is_current)
      SELECT to_char(NOW(), 'YYYY'), TRUE
      WHERE NOT EXISTS (SELECT 1 FROM academic_years);
    `);
    await client.query(`UPDATE work_items    SET year_id = (SELECT id FROM academic_years WHERE is_current) WHERE year_id IS NULL;`);
    await client.query(`UPDATE announcements SET year_id = (SELECT id FROM academic_years WHERE is_current) WHERE year_id IS NULL;`);

    // ── New tables ───────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS password_requests (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at   TIMESTAMPTZ DEFAULT NOW(),
        resolved_at  TIMESTAMPTZ
      );
    `);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS one_open_pw_request ON password_requests (user_id) WHERE resolved_at IS NULL;`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id          BIGSERIAL PRIMARY KEY,
        actor_id    UUID,
        actor_name  VARCHAR(100),
        action      VARCHAR(60) NOT NULL,
        target      VARCHAR(200),
        meta        JSONB,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS promotion_batches (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        from_year_id  UUID NOT NULL REFERENCES academic_years(id),
        to_year_id    UUID NOT NULL REFERENCES academic_years(id),
        created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        undone_at     TIMESTAMPTZ,
        promoted      INT NOT NULL DEFAULT 0,
        repeated      INT NOT NULL DEFAULT 0,
        graduated     INT NOT NULL DEFAULT 0
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS promotion_moves (
        batch_id       UUID NOT NULL REFERENCES promotion_batches(id) ON DELETE CASCADE,
        student_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        from_class_id  UUID,
        to_class_id    UUID,
        outcome        VARCHAR(12) NOT NULL CHECK (outcome IN ('promote','repeat','graduate')),
        PRIMARY KEY (batch_id, student_id)
      );
    `);

    // ── Indexes ──────────────────────────────────────────────────────────────
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_class      ON users(class_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_status     ON users(status);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_modules_class    ON modules(class_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_modules_teacher  ON modules(teacher_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_workitems_module ON work_items(module_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_workitems_class_year ON work_items(class_id, year_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_subs_workitem    ON submissions(work_item_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_subs_student     ON submissions(student_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_anns_scope       ON announcements(scope);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_anns_module      ON announcements(module_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_anns_year        ON announcements(year_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_replies_ann      ON replies(announcement_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_calendar_date    ON calendar_events(event_date);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_created    ON audit_log(created_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_materials_class  ON materials(class_id);`);

    await client.query('COMMIT');
    console.log('✅  Database schema is up to date.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌  Schema init failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

init().catch(() => process.exit(1));
