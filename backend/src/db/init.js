// Run with: npm run db:init
// Creates all tables from scratch. Safe to re-run (uses IF NOT EXISTS).
require('dotenv').config();
const pool = require('./pool');

async function init() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

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
        level        INT           NOT NULL CHECK (level IN (3,4,5)),
        stream       VARCHAR(10)   NOT NULL CHECK (stream IN ('SOD','NIT','MMP')),
        join_code    VARCHAR(10)   UNIQUE NOT NULL,
        code_active  BOOLEAN       DEFAULT TRUE,
        created_at   TIMESTAMPTZ   DEFAULT NOW()
      );
    `);

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

    // Indexes for performance
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_email      ON users(email);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_class      ON users(class_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_modules_class    ON modules(class_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_modules_teacher  ON modules(teacher_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_workitems_module ON work_items(module_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_subs_workitem    ON submissions(work_item_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_subs_student     ON submissions(student_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_anns_scope       ON announcements(scope);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_anns_module      ON announcements(module_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_replies_ann      ON replies(announcement_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_calendar_date    ON calendar_events(event_date);`);

    await client.query('COMMIT');
    console.log('✅  All tables created successfully.');
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
