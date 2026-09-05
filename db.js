require('dotenv').config();
const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

let pool;
let sqliteDb;
const isPostgres = !!process.env.DATABASE_URL;

function convertSqliteQuery(text, params = []) {
  const usedIndices = [];
  const sql = text.replace(/\$(\d+)/g, (match, idx) => {
    usedIndices.push(parseInt(idx, 10) - 1);
    return '?';
  });
  const args = usedIndices.map(i => params[i]);
  return { sql, args };
}

function attachLastId(res) {
  if (res && !Object.prototype.hasOwnProperty.call(res, 'lastID')) {
    res.lastID = res.rows && res.rows[0] ? res.rows[0].id : null;
  }
  return res;
}

function createPostgresRunner(client) {
  return {
    query(text, params = [], callback) {
      if (typeof params === 'function') {
        callback = params;
        params = [];
      }
      if (callback) {
        client.query(text, params, (err, res) => callback(err, attachLastId(res)));
        return;
      }
      return client.query(text, params).then(attachLastId);
    },
    all(text, params = [], callback) {
      if (typeof params === 'function') {
        callback = params;
        params = [];
      }
      if (callback) {
        client.query(text, params, (err, res) => callback(err, res ? res.rows : []));
        return;
      }
      return client.query(text, params).then(res => res.rows);
    },
    get(text, params = [], callback) {
      if (typeof params === 'function') {
        callback = params;
        params = [];
      }
      if (callback) {
        client.query(text, params, (err, res) => callback(err, res && res.rows ? res.rows[0] : null));
        return;
      }
      return client.query(text, params).then(res => res.rows[0]);
    },
    run(text, params = [], callback) {
      if (typeof params === 'function') {
        callback = params;
        params = [];
      }
      if (callback) {
        client.query(text, params, callback);
        return;
      }
      return client.query(text, params);
    }
  };
}

function createSqliteRunner(connection) {
  return {
    query(text, params = [], callback) {
      if (typeof params === 'function') {
        callback = params;
        params = [];
      }

      return new Promise((resolve, reject) => {
        try {
          const isSelect = text.trim().toUpperCase().startsWith('SELECT') ||
            text.trim().toUpperCase().startsWith('WITH');
          const { sql, args } = convertSqliteQuery(text, params);
          if (isSelect) {
            connection.all(sql, args, (err, rows) => {
              const result = { rows: rows || [], rowCount: rows ? rows.length : 0 };
              if (callback) callback(err, result);
              if (err) reject(err); else resolve(result);
            });
          } else {
            connection.run(sql, args, function (err) {
              const result = { rows: [], rowCount: this.changes, lastID: this.lastID, insertId: this.lastID };
              if (callback) callback(err, result);
              if (err) reject(err); else resolve(result);
            });
          }
        } catch (syncErr) {
          if (callback) callback(syncErr);
          reject(syncErr);
        }
      });
    },
    all(text, params = [], callback) {
      if (typeof params === 'function') {
        callback = params;
        params = [];
      }
      const { sql, args } = convertSqliteQuery(text, params);
      if (callback) return connection.all(sql, args, callback);
      return new Promise((resolve, reject) => {
        connection.all(sql, args, (err, rows) => err ? reject(err) : resolve(rows || []));
      });
    },
    get(text, params = [], callback) {
      if (typeof params === 'function') {
        callback = params;
        params = [];
      }
      const { sql, args } = convertSqliteQuery(text, params);
      if (callback) return connection.get(sql, args, callback);
      return new Promise((resolve, reject) => {
        connection.get(sql, args, (err, row) => err ? reject(err) : resolve(row));
      });
    },
    run(text, params = [], callback) {
      if (typeof params === 'function') {
        callback = params;
        params = [];
      }
      const { sql, args } = convertSqliteQuery(text, params);
      if (callback) {
        return connection.run(sql, args, function (err) {
          callback.call(this, err);
        });
      }
      return new Promise((resolve, reject) => {
        connection.run(sql, args, function (err) {
          if (err) reject(err); else resolve(this);
        });
      });
    }
  };
}

if (isPostgres) {
  console.log('Using PostgreSQL (Railway)');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' || process.env.DATABASE_URL.includes('railway')
      ? { rejectUnauthorized: false }
      : { rejectUnauthorized: false }
  });
} else {
  console.log('Using SQLite (local)');
  const dbPath = path.resolve(__dirname, 'academia.db');
  sqliteDb = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error('Error opening SQLite', err);
  });
}

const db = {
  // Run an INSERT and return the new row id on both engines.
  // Pass the INSERT without a RETURNING clause; it's appended for Postgres only.
  // SQLite exposes lastID natively; the pg runner mirrors rows[0].id onto lastID.
  insertReturning: async (text, params = []) => {
    const sql = isPostgres ? `${text} RETURNING id` : text;
    const res = await db.query(sql, params);
    return res.rows?.[0]?.id ?? res.lastID ?? null;
  },
  // Universal query method
  query: (text, params = [], callback) => {
    try {
      if (typeof params === 'function') {
        callback = params;
        params = [];
      }

      if (isPostgres) {
        const runner = createPostgresRunner(pool);
        return runner.query(text, params, callback);
      } else {
        const runner = createSqliteRunner(sqliteDb);
        return runner.query(text, params, callback);
      }
    } catch (outerErr) {
      console.error('DB OUTER ERROR:', outerErr.message);
      if (callback) callback(outerErr);
      else return Promise.reject(outerErr);
    }
  },
  all: (text, params = [], callback) => {
    try {
      if (typeof params === 'function') {
        callback = params;
        params = [];
      }
      if (isPostgres) {
        const runner = createPostgresRunner(pool);
        return runner.all(text, params, callback);
      } else {
        const runner = createSqliteRunner(sqliteDb);
        return runner.all(text, params, callback);
      }
    } catch (err) {
      console.error('DB OUTER ERROR:', err.message);
      if (callback) callback(err);
      else return Promise.reject(err);
    }
  },
  get: (text, params = [], callback) => {
    try {
      if (typeof params === 'function') {
        callback = params;
        params = [];
      }
      if (isPostgres) {
        const runner = createPostgresRunner(pool);
        return runner.get(text, params, callback);
      } else {
        const runner = createSqliteRunner(sqliteDb);
        return runner.get(text, params, callback);
      }
    } catch (err) {
      console.error('DB OUTER ERROR:', err.message);
      if (callback) callback(err);
      else return Promise.reject(err);
    }
  },
  run: function (text, params = [], callback) {
    try {
      if (typeof params === 'function') {
        callback = params;
        params = [];
      }
      if (isPostgres) {
        const runner = createPostgresRunner(pool);
        return runner.run(text, params, callback);
      } else {
        const runner = createSqliteRunner(sqliteDb);
        return runner.run(text, params, callback);
      }
    } catch (err) {
      console.error('DB OUTER ERROR:', err.message);
      if (callback) callback(err);
      else return Promise.reject(err);
    }
  },
  withTransaction: async (work) => {
    if (isPostgres) {
      const client = await pool.connect();
      const tx = createPostgresRunner(client);
      try {
        await client.query('BEGIN');
        const result = await work(tx);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackErr) {
          console.error('DB rollback error:', rollbackErr.message);
        }
        throw err;
      } finally {
        client.release();
      }
    }

    const tx = createSqliteRunner(sqliteDb);
    try {
      await tx.run('BEGIN');
      const result = await work(tx);
      await tx.run('COMMIT');
      return result;
    } catch (err) {
      try {
        await tx.run('ROLLBACK');
      } catch (rollbackErr) {
        console.error('DB rollback error:', rollbackErr.message);
      }
      throw err;
    }
  }
};

// Initialize Schema
async function initDb() {
  const idType = isPostgres ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  const schema = [
    `CREATE TABLE IF NOT EXISTS users (
            id ${idType},
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT,
            google_id TEXT,
            role TEXT,
            academy_id INTEGER,
            user_code TEXT UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
    `CREATE TABLE IF NOT EXISTS academies (
            id ${idType},
            name TEXT NOT NULL,
            owner_id INTEGER,
            teacher_code TEXT,
            student_code TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
    `CREATE TABLE IF NOT EXISTS messages (
            id ${idType},
            academy_id INTEGER,
            room_id INTEGER,
            sender_id INTEGER,
            content TEXT,
            file_url TEXT,
            file_name TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            read BOOLEAN DEFAULT FALSE,
            type TEXT DEFAULT 'text'
        )`,
    `CREATE TABLE IF NOT EXISTS rooms (
            id ${idType},
            academy_id INTEGER,
            type TEXT,
            name TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
    `CREATE TABLE IF NOT EXISTS room_members (
            id ${idType},
            room_id INTEGER,
            user_id INTEGER
        )`,
    `CREATE TABLE IF NOT EXISTS students (
            id ${idType},
            academy_id INTEGER,
            assigned_teacher_id INTEGER,
            user_id INTEGER,
            name TEXT NOT NULL,
            course TEXT,
            subject TEXT,
            status TEXT DEFAULT 'active',
            join_date TEXT,
            parent_email TEXT,
            parent_phone TEXT
        )`,
    `CREATE TABLE IF NOT EXISTS sessions (
            id ${idType},
            student_id INTEGER,
            date TEXT,
            duration_minutes INTEGER,
            homework_done BOOLEAN,
            teacher_notes TEXT
        )`,
    `CREATE TABLE IF NOT EXISTS exams (
            id ${idType},
            student_id INTEGER,
            date TEXT,
            subject TEXT,
            score REAL
        )`,
    `CREATE TABLE IF NOT EXISTS payments (
            id ${idType},
            student_id INTEGER,
            amount REAL,
            due_date TEXT,
            paid_date TEXT,
            status TEXT DEFAULT 'pending'
        )`,
    `CREATE TABLE IF NOT EXISTS reports (
            id ${idType},
            student_id INTEGER,
            academy_id INTEGER,
            month INTEGER,
            year INTEGER,
            file_url TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
    `CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT,
            academy_id INTEGER
        )`,
    `CREATE TABLE IF NOT EXISTS teacher_payments (
            id ${idType},
            teacher_id INTEGER,
            academy_id INTEGER,
            month INTEGER,
            year INTEGER,
            hours REAL,
            hourly_rate REAL,
            total_amount REAL,
            paid INTEGER DEFAULT 0,
            paid_at TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
    `CREATE TABLE IF NOT EXISTS available_slots (
            id ${idType},
            teacher_id INTEGER,
            academy_id INTEGER,
            start_datetime TEXT,
            end_datetime TEXT,
            is_booked BOOLEAN DEFAULT FALSE,
            student_id INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
    `CREATE TABLE IF NOT EXISTS homework_reminders (
            id ${idType},
            academy_id INTEGER NOT NULL,
            student_id INTEGER NOT NULL,
            teacher_id INTEGER NOT NULL,
            transcript_id INTEGER,
            source TEXT DEFAULT 'transcript',
            homework_json TEXT NOT NULL,
            scheduled_day_of_week TEXT,
            scheduled_time TEXT,
            scheduled_for TIMESTAMP,
            status TEXT DEFAULT 'pending_schedule',
            reminder_sent BOOLEAN DEFAULT FALSE,
            student_response_at TIMESTAMP,
            teacher_notified_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`
  ];

  for (const sql of schema) {
    try {
      await db.query(sql);
    } catch (err) {
      console.error('Init Table Error:', err.message);
    }
  }

  // Safe column additions via try/catch wrapper
  const runMigration = async (sql) => {
    try {
      await db.run(sql);
    } catch (err) {
      // Ignore errors for existing columns or other safe migration errors
    }
  };

  const migrations = [
    "ALTER TABLE students ADD COLUMN academy_id INTEGER",
    "ALTER TABLE students ADD COLUMN assigned_teacher_id INTEGER",
    "ALTER TABLE students ADD COLUMN user_id INTEGER",
    "ALTER TABLE sessions ADD COLUMN slot_id INTEGER",
    "ALTER TABLE users ADD COLUMN user_code TEXT",
    "ALTER TABLE students ADD COLUMN monthly_fee REAL DEFAULT 0",
    "ALTER TABLE students ADD COLUMN payment_day INTEGER DEFAULT 1",
    "ALTER TABLE students ADD COLUMN payment_method TEXT DEFAULT 'Transferencia'",
    "ALTER TABLE students ADD COLUMN payment_notes TEXT",
    "ALTER TABLE students ADD COLUMN payment_start_date TEXT",
    "ALTER TABLE users ADD COLUMN hourly_rate REAL DEFAULT 0",

    `CREATE TABLE IF NOT EXISTS rooms (
      id ${idType},
      academy_id INTEGER,
      type TEXT,
      name TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS room_members (
      id ${idType},
      room_id INTEGER,
      user_id INTEGER
    )`,

    "ALTER TABLE messages ADD COLUMN room_id INTEGER",
    "ALTER TABLE messages ADD COLUMN file_url TEXT",
    "ALTER TABLE messages ADD COLUMN file_name TEXT",
    "ALTER TABLE messages ADD COLUMN file_type TEXT",
    "ALTER TABLE messages ADD COLUMN read INTEGER DEFAULT 0",
    "ALTER TABLE messages ADD COLUMN type TEXT DEFAULT 'text'",

    `CREATE TABLE IF NOT EXISTS available_slots (
      id ${idType},
      teacher_id INTEGER,
      academy_id INTEGER,
      start_datetime TEXT,
      end_datetime TEXT,
      is_booked INTEGER DEFAULT 0,
      student_id INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS homework_reminders (
      id ${idType},
      academy_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      teacher_id INTEGER NOT NULL,
      transcript_id INTEGER,
      source TEXT DEFAULT 'transcript',
      homework_json TEXT NOT NULL,
      scheduled_day_of_week TEXT,
      scheduled_time TEXT,
      scheduled_for TIMESTAMP,
      status TEXT DEFAULT 'pending_schedule',
      reminder_sent BOOLEAN DEFAULT FALSE,
      student_response_at TIMESTAMP,
      teacher_notified_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS settings (
      id ${idType},
      academy_id INTEGER UNIQUE,
      academy_name TEXT,
      contact_email TEXT,
      phone TEXT,
      address TEXT,
      report_name TEXT,
      report_footer TEXT,
      director_name TEXT,
      notify_risk INTEGER DEFAULT 0,
      notify_payment INTEGER DEFAULT 0,
      notify_monthly INTEGER DEFAULT 0
    )`,

    // New columns for calendar slots
    "ALTER TABLE available_slots ADD COLUMN notes TEXT",

    // --- NEW TABLES FOR RECENT REQUESTS ---

    // 1. AI Conversations
    `CREATE TABLE IF NOT EXISTS ai_conversations (
      id ${idType},
      user_id INTEGER NOT NULL,
      academy_id INTEGER,
      title TEXT,
      is_pinned BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // 2. AI Messages
    `CREATE TABLE IF NOT EXISTS ai_messages (
      id ${idType},
      conversation_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // 3. Simulator Results
    `CREATE TABLE IF NOT EXISTS simulator_results (
      id ${idType},
      student_id INTEGER NOT NULL,
      topic TEXT,
      difficulty TEXT,
      num_questions INTEGER,
      score REAL,
      max_score REAL,
      percentage REAL,
      questions_json TEXT,
      answers_json TEXT,
      teacher_grade REAL,
      teacher_feedback TEXT,
      graded_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // 4. Update Exams table
    "ALTER TABLE exams ADD COLUMN notes TEXT",

    // 5. Sent Reports
    `CREATE TABLE IF NOT EXISTS sent_reports (
      id ${idType},
      academy_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // 6. Transcripts
    `CREATE TABLE IF NOT EXISTS transcripts (
      id ${idType},
      academy_id INTEGER,
      teacher_id INTEGER,
      student_id INTEGER,
      raw_text TEXT,
      processed_json TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // Ensure academy_id exists on ai_conversations (for older deploys)
    "ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS academy_id INTEGER",

    // Ensure academy_id exists on settings (for older deploys)
    "ALTER TABLE settings ADD COLUMN IF NOT EXISTS academy_id INTEGER",

    // Gmail OAuth + transcript email columns on users
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS transcript_email VARCHAR(255)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS gmail_access_token TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS gmail_refresh_token TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS gmail_token_expiry BIGINT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS gmail_last_check TIMESTAMP",

    // Onboarding wizard
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE",

    // In-app notifications
    `CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      academy_id INTEGER,
      type TEXT,
      title TEXT NOT NULL,
      message TEXT,
      read BOOLEAN DEFAULT FALSE,
      link TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // Google Calendar integration
    "ALTER TABLE available_slots ADD COLUMN IF NOT EXISTS google_event_id TEXT",
    "ALTER TABLE available_slots ADD COLUMN IF NOT EXISTS meet_link TEXT",
    "ALTER TABLE available_slots ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN DEFAULT FALSE",
    "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS meet_link TEXT",

    // Independent Google Calendar OAuth token columns (separate from Gmail)
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS calendar_access_token TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS calendar_refresh_token TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS calendar_token_expiry BIGINT",

    // Group sessions support
    "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS session_type VARCHAR(20) DEFAULT 'individual'",

    // Group hourly rate per teacher
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS group_hourly_rate NUMERIC DEFAULT 0",

    // Invitation links
    `CREATE TABLE IF NOT EXISTS invitation_links (
      id SERIAL PRIMARY KEY,
      academy_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      created_by INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // Deduplication column for Gmail transcript emails
    "ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS gmail_msg_id TEXT",

    // Transcripts: pending_match column
    "ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS pending_match BOOLEAN DEFAULT FALSE",

    // Transcripts: unique index on gmail_msg_id per academy
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_transcripts_gmail_msg ON transcripts(academy_id, gmail_msg_id) WHERE gmail_msg_id IS NOT NULL",

    // Student links — persistent URLs per student, visible to student
    `CREATE TABLE IF NOT EXISTS student_links (
      id ${idType},
      student_id INTEGER NOT NULL,
      academy_id INTEGER NOT NULL,
      label TEXT NOT NULL,
      url TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // Recurring session rules — each row represents a weekly pattern
    `CREATE TABLE IF NOT EXISTS recurring_sessions (
      id ${idType},
      academy_id INTEGER NOT NULL,
      teacher_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      day_of_week INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL DEFAULT 60,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // Link generated slots back to their recurrence rule
    "ALTER TABLE available_slots ADD COLUMN IF NOT EXISTS recurrence_rule_id INTEGER"
  ];

  for (const sql of migrations) {
    await runMigration(sql);
  }

  // ─── Índices de rendimiento ───────────────────────────────────────────────────
  const indexMigrations = [
    // sessions — filtros más frecuentes
    'CREATE INDEX IF NOT EXISTS idx_sessions_academy_id ON sessions(academy_id)',
    'CREATE INDEX IF NOT EXISTS idx_sessions_student_id ON sessions(student_id)',
    'CREATE INDEX IF NOT EXISTS idx_sessions_teacher_id ON sessions(teacher_id)',
    'CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date)',
    'CREATE INDEX IF NOT EXISTS idx_sessions_academy_student ON sessions(academy_id, student_id)',

    // students
    'CREATE INDEX IF NOT EXISTS idx_students_academy_id ON students(academy_id)',
    'CREATE INDEX IF NOT EXISTS idx_students_user_id ON students(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_students_assigned_teacher_id ON students(assigned_teacher_id)',

    // exams
    'CREATE INDEX IF NOT EXISTS idx_exams_student_id ON exams(student_id)',
    'CREATE INDEX IF NOT EXISTS idx_exams_academy_id ON exams(academy_id)',
    'CREATE INDEX IF NOT EXISTS idx_exams_date ON exams(date)',

    // payments
    'CREATE INDEX IF NOT EXISTS idx_payments_student_id ON payments(student_id)',
    'CREATE INDEX IF NOT EXISTS idx_payments_academy_id ON payments(academy_id)',
    'CREATE INDEX IF NOT EXISTS idx_payments_due_date ON payments(due_date)',

    // messages — filtro principal por room + orden por created_at
    'CREATE INDEX IF NOT EXISTS idx_messages_room_id ON messages(room_id)',
    'CREATE INDEX IF NOT EXISTS idx_messages_room_created ON messages(room_id, created_at)',

    // notifications
    'CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_notifications_academy_id ON notifications(academy_id)',
    'CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(read)',
    'CREATE INDEX IF NOT EXISTS idx_notifications_user_academy ON notifications(user_id, academy_id)',

    // ai_conversations
    'CREATE INDEX IF NOT EXISTS idx_ai_conversations_user_id ON ai_conversations(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_ai_conversations_academy_id ON ai_conversations(academy_id)',
    'CREATE INDEX IF NOT EXISTS idx_ai_conversations_updated_at ON ai_conversations(updated_at)',

    // available_slots
    'CREATE INDEX IF NOT EXISTS idx_available_slots_student_id ON available_slots(student_id)',
    'CREATE INDEX IF NOT EXISTS idx_available_slots_teacher_id ON available_slots(teacher_id)',
    'CREATE INDEX IF NOT EXISTS idx_available_slots_is_booked ON available_slots(is_booked)',
    'CREATE INDEX IF NOT EXISTS idx_available_slots_start_datetime ON available_slots(start_datetime)',

    // users
    'CREATE INDEX IF NOT EXISTS idx_users_academy_id ON users(academy_id)',
    'CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)',
    'CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)',

    // rooms
    'CREATE INDEX IF NOT EXISTS idx_rooms_academy_id ON rooms(academy_id)',
    'CREATE INDEX IF NOT EXISTS idx_rooms_type ON rooms(type)',

    // room_members
    'CREATE INDEX IF NOT EXISTS idx_room_members_room_id ON room_members(room_id)',
    'CREATE INDEX IF NOT EXISTS idx_room_members_user_id ON room_members(user_id)',

    // student_links
    'CREATE INDEX IF NOT EXISTS idx_student_links_student_id ON student_links(student_id)',
    'CREATE INDEX IF NOT EXISTS idx_student_links_academy_id ON student_links(academy_id)',

    // recurring_sessions
    'CREATE INDEX IF NOT EXISTS idx_recurring_sessions_academy_id ON recurring_sessions(academy_id)',
    'CREATE INDEX IF NOT EXISTS idx_recurring_sessions_teacher_id ON recurring_sessions(teacher_id)',
    'CREATE INDEX IF NOT EXISTS idx_recurring_sessions_active ON recurring_sessions(active)',

    // simulator_results — listado por alumno (exams.js, reports.js)
    'CREATE INDEX IF NOT EXISTS idx_simulator_results_student_id ON simulator_results(student_id)',

    // teacher_payments — consulta habitual por profesor+academia
    'CREATE INDEX IF NOT EXISTS idx_teacher_payments_teacher_academy ON teacher_payments(teacher_id, academy_id)',

    // homework_reminders — join por alumno + escaneo del cron de recordatorios pendientes
    'CREATE INDEX IF NOT EXISTS idx_homework_reminders_student_id ON homework_reminders(student_id)',
    'CREATE INDEX IF NOT EXISTS idx_homework_reminders_due ON homework_reminders(status, scheduled_for)'
  ];
  for (const sql of indexMigrations) {
    try { await db.query(sql); } catch (e) { /* index may already exist */ }
  }

  // If Postgres, ensure unique on user_code if possible (SQLite doesn't support adding UNIQUE constraints easily via ALTER)
  if (isPostgres) {
    await db.query("ALTER TABLE users ADD CONSTRAINT users_user_code_key UNIQUE (user_code)").catch(() => { });
  }

  // Default settings seeding removed — settings are now scoped per academy_id via key prefixing.

  // Clean up duplicate group rooms and orphan members
  try {
    // Remove duplicate group rooms, keep lowest id per academy
    await db.query(`
      DELETE FROM rooms 
      WHERE type = 'group' 
      AND id NOT IN (
        SELECT MIN(id) FROM rooms 
        WHERE type = 'group' 
        GROUP BY academy_id
      )
    `);

    // Clean orphan members
    await db.query(`
      DELETE FROM room_members 
      WHERE room_id NOT IN (SELECT id FROM rooms)
    `);
    console.log("Cleanup: Duplicate rooms and orphan members removed.");

    // Delete all rooms that have NO members
    await db.query(`DELETE FROM rooms WHERE id NOT IN (SELECT DISTINCT room_id FROM room_members)`);

    // Delete duplicate members in room 5 (keep only one of each user)
    await db.query(`DELETE FROM room_members WHERE id NOT IN (SELECT MIN(id) FROM room_members GROUP BY room_id, user_id)`);

    // Delete rooms 6-32 if still empty after cleanup
    await db.query(`DELETE FROM rooms WHERE id NOT IN (SELECT DISTINCT room_id FROM room_members)`);

    // Find and delete duplicate direct rooms (same two members)
    const allDirectRooms = await db.query(
      "SELECT id FROM rooms WHERE type = 'direct' ORDER BY id ASC"
    );
    const directRows = allDirectRooms.rows || allDirectRooms;

    const seen = new Set();
    for (const room of directRows) {
      const members = await db.query(
        "SELECT user_id FROM room_members WHERE room_id = $1 ORDER BY user_id ASC",
        [room.id]
      );
      const mRows = members.rows || members;
      if (mRows.length === 0) continue;

      const key = mRows.map(m => m.user_id).join('-');
      if (seen.has(key)) {
        // Duplicate - delete it
        await db.query("DELETE FROM rooms WHERE id = $1", [room.id]);
        await db.query("DELETE FROM room_members WHERE room_id = $1", [room.id]);
      } else {
        seen.add(key);
      }
    }

  } catch (e) {
    console.error("Cleanup Error", e);
  }
}

db.initDb    = initDb;
db.isPostgres = isPostgres;

module.exports = db;
