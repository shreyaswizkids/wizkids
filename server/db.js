'use strict';
// ============================================================
// SERVER: db.js
// SQLite database manager using better-sqlite3 (synchronous).
//
// Responsibilities:
//   - Create / migrate schema on startup
//   - Seed reference data from existing data/*.js files
//   - Expose query helpers used by routes.js
//   - Build the full /api/init snapshot
// ============================================================

const path     = require('path');
const fs       = require('fs');
const vm       = require('vm');
const { DatabaseSync: Database } = require('node:sqlite');

// DB_PATH can be overridden by env var so Docker can volume-mount a dedicated dir.
// Default (local dev): <project>/db/gurukul.sqlite
// Docker default:      /app/db/gurukul.sqlite  (matches volume mount in docker-compose.yml)
const DB_DIR   = process.env.DB_DIR  || path.resolve(__dirname, '../db');
const DB_PATH  = process.env.DB_PATH || path.join(DB_DIR, 'gurukul.sqlite');
const DATA_DIR = path.resolve(__dirname, '../data');

// Ensure the DB directory exists (important for first Docker run)
require('fs').mkdirSync(DB_DIR, { recursive: true });

let _db = null;

// ── Helpers ──────────────────────────────────────────────────────────────────

function db() {
  if (!_db) throw new Error('[GKServer/db] not initialised — call init() first');
  return _db;
}

/**
 * Load a browser-format data file (uses const/let/var at top level).
 * Wraps the file in an IIFE so const/let are capturable.
 */
function _loadDataFile(filename, varNames) {
  const code    = fs.readFileSync(path.join(DATA_DIR, filename), 'utf8');
  const wrapped = `(function(){\n${code}\n;return {${varNames.join(',')}};\n})()`;
  return vm.runInNewContext(wrapped, {});
}

// ── Schema DDL ───────────────────────────────────────────────────────────────

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    username        TEXT UNIQUE NOT NULL,
    password        TEXT NOT NULL,
    display_name    TEXT,
    grade           TEXT,
    avatar          TEXT,
    photo           TEXT,
    join_date       TEXT,
    preferred_style TEXT,
    persona         TEXT,
    role            TEXT NOT NULL DEFAULT 'student'
  );

  CREATE TABLE IF NOT EXISTS auth_session (
    id      INTEGER PRIMARY KEY CHECK (id = 1),
    user_id TEXT REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS subjects (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    icon       TEXT,
    color      TEXT,
    type       TEXT,
    quotient   TEXT,
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS topics (
    id          TEXT PRIMARY KEY,
    subject_id  TEXT NOT NULL REFERENCES subjects(id),
    name        TEXT NOT NULL,
    page_title  TEXT,
    description TEXT,
    icon        TEXT,
    xp          INTEGER DEFAULT 0,
    mandatory   INTEGER DEFAULT 1,
    module_type TEXT    DEFAULT 'standard',
    sort_order  INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS subtopics (
    id              TEXT NOT NULL,
    topic_id        TEXT NOT NULL REFERENCES topics(id),
    name            TEXT NOT NULL,
    lesson_prefix   TEXT,
    subtopic_type   TEXT    DEFAULT 'core',
    mandatory       INTEGER DEFAULT 1,
    xp              INTEGER DEFAULT 0,
    description     TEXT,
    sort_order      INTEGER DEFAULT 0,
    resources_json  TEXT    DEFAULT '[]',
    concepts_json   TEXT    DEFAULT '[]',
    game_json       TEXT,
    assessment_json TEXT    DEFAULT '[]',
    ai_hints_json   TEXT    DEFAULT '[]',
    PRIMARY KEY (id, topic_id)
  );

  CREATE TABLE IF NOT EXISTS feedback_question_sets (
    set_id         TEXT PRIMARY KEY,
    questions_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_xp (
    user_id     TEXT PRIMARY KEY REFERENCES users(id),
    total_xp    INTEGER DEFAULT 0,
    level       INTEGER DEFAULT 1,
    is_promoted INTEGER DEFAULT 0,
    promoted_at TEXT,
    updated_at  TEXT
  );

  CREATE TABLE IF NOT EXISTS user_extra (
    user_id    TEXT PRIMARY KEY REFERENCES users(id),
    extra_json TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS active_sessions (
    user_id       TEXT PRIMARY KEY REFERENCES users(id),
    start_time    TEXT NOT NULL,
    mood_json     TEXT DEFAULT '{}',
    xp_earned     INTEGER DEFAULT 0,
    feedback_json TEXT
  );

  CREATE TABLE IF NOT EXISTS session_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       TEXT NOT NULL REFERENCES users(id),
    start_time    TEXT NOT NULL,
    end_time      TEXT,
    mood_json     TEXT DEFAULT '{}',
    xp_earned     INTEGER DEFAULT 0,
    feedback_json TEXT
  );

  CREATE TABLE IF NOT EXISTS subtopic_completions (
    user_id      TEXT NOT NULL REFERENCES users(id),
    subtopic_key TEXT NOT NULL,
    completed_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, subtopic_key)
  );

  CREATE TABLE IF NOT EXISTS subtopic_scores (
    user_id      TEXT NOT NULL REFERENCES users(id),
    subtopic_key TEXT NOT NULL,
    score        INTEGER NOT NULL,
    total        INTEGER NOT NULL,
    percentage   INTEGER NOT NULL,
    completed_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, subtopic_key)
  );

  CREATE TABLE IF NOT EXISTS topic_completions (
    user_id      TEXT NOT NULL REFERENCES users(id),
    topic_id     TEXT NOT NULL,
    completed_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, topic_id)
  );

  CREATE TABLE IF NOT EXISTS assessment_attempts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      TEXT NOT NULL REFERENCES users(id),
    topic_key    TEXT NOT NULL,
    score        INTEGER NOT NULL,
    total        INTEGER NOT NULL,
    percentage   INTEGER NOT NULL,
    answers_json TEXT DEFAULT '[]',
    attempted_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS subtopic_feedback (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       TEXT NOT NULL REFERENCES users(id),
    topic_key     TEXT,
    subtopic_key  TEXT NOT NULL,
    feedback_json TEXT NOT NULL,
    saved_at      TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS module_feedback (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       TEXT NOT NULL REFERENCES users(id),
    topic_key     TEXT NOT NULL,
    feedback_json TEXT NOT NULL,
    saved_at      TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS session_feedback (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        TEXT NOT NULL REFERENCES users(id),
    session_log_id INTEGER REFERENCES session_log(id),
    feedback_json  TEXT NOT NULL,
    saved_at       TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS quick_check_results (
    id           INTEGER PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id),
    result_json  TEXT NOT NULL,
    submitted_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS mentor_notes (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id),
    note_json  TEXT NOT NULL,
    is_read    INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS mentor_rewards (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL REFERENCES users(id),
    amount     INTEGER NOT NULL,
    reason     TEXT,
    awarded_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS topic_locks (
    user_id   TEXT NOT NULL REFERENCES users(id),
    topic_key TEXT NOT NULL,
    is_locked INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, topic_key)
  );

  CREATE TABLE IF NOT EXISTS review_requests (
    id           INTEGER PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id),
    request_json TEXT NOT NULL,
    is_read      INTEGER DEFAULT 0,
    submitted_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS mentor_mood_log (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    mentor_id TEXT NOT NULL,
    mood_json TEXT NOT NULL,
    logged_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS holistic_scores (
    user_id  TEXT PRIMARY KEY REFERENCES users(id),
    aq       INTEGER,
    sq       INTEGER,
    pq       INTEGER,
    eq       INTEGER,
    hq       INTEGER,
    raw_json TEXT,
    saved_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS demo_overrides (
    user_id       TEXT NOT NULL REFERENCES users(id),
    topic_key     TEXT NOT NULL,
    override_json TEXT NOT NULL,
    PRIMARY KEY (user_id, topic_key)
  );

  CREATE TABLE IF NOT EXISTS app_kv (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- ── Personalized Learning Paths ────────────────────────────────────────────
  -- A named curriculum path (e.g. "Grade 6 Core", "Advanced Track").
  -- Managed via config/learning-paths.json and /api/config/* endpoints.

  CREATE TABLE IF NOT EXISTS learning_paths (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    grade       TEXT,
    is_active   INTEGER DEFAULT 1,
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
  );

  -- Ordered, required/optional topic list per path.
  CREATE TABLE IF NOT EXISTS learning_path_topics (
    path_id      TEXT NOT NULL REFERENCES learning_paths(id) ON DELETE CASCADE,
    topic_id     TEXT NOT NULL,
    sort_order   INTEGER DEFAULT 0,
    is_required  INTEGER DEFAULT 1,
    is_published INTEGER DEFAULT 0,
    PRIMARY KEY (path_id, topic_id)
  );

  -- One-to-many: each student can be on one active path (or switched over time).
  CREATE TABLE IF NOT EXISTS student_learning_paths (
    student_id  TEXT NOT NULL REFERENCES users(id),
    path_id     TEXT NOT NULL REFERENCES learning_paths(id) ON DELETE CASCADE,
    assigned_at TEXT DEFAULT (datetime('now')),
    assigned_by TEXT REFERENCES users(id),
    is_active   INTEGER DEFAULT 1,
    PRIMARY KEY (student_id, path_id)
  );

  -- ── Holistic Evaluations (normalized, one row per evaluation event) ──────────
  -- Stores each mentor question-based evaluation for AQ / EQ.
  -- The composite score (0-100) and individual question ratings (1-5) are stored
  -- alongside optional free-text observations.
  CREATE TABLE IF NOT EXISTS holistic_evaluations (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       TEXT    NOT NULL REFERENCES users(id),
    quotient      TEXT    NOT NULL,        -- 'aq' | 'eq' | 'sq' | 'pq'
    q1            INTEGER,                 -- rating 1-5 (NULL for direct-entry types)
    q2            INTEGER,
    q3            INTEGER,
    score         INTEGER NOT NULL,        -- computed 0-100
    observations  TEXT,
    eval_type     TEXT    NOT NULL DEFAULT 'mentor_eval',  -- 'mentor_eval' | 'mentor_direct' | 'ai'
    evaluated_at  TEXT    DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_holistic_eval_user
    ON holistic_evaluations(user_id, quotient, evaluated_at);
`;

// ── Seed ─────────────────────────────────────────────────────────────────────

function _seed() {
  console.log('[GKServer/db] checking reference data...');

  // --- Users ---
  console.log('[GKServer/db] syncing users...');
  const { GK_USERS, GK_MENTOR, GK_SME } = _loadDataFile('users.js', [
    'GK_USERS', 'GK_MENTOR', 'GK_SME'
  ]);

  const insUser = _db.prepare(`
    INSERT OR IGNORE INTO users
      (id, username, password, display_name, grade, avatar, photo,
       join_date, preferred_style, persona, role)
    VALUES (@id,@username,@password,@displayName,@grade,@avatar,@photo,
            @joinDate,@preferredStyle,@persona,@role)
  `);
  const insXP = _db.prepare(
    `INSERT OR IGNORE INTO user_xp (user_id, total_xp, level) VALUES (@id,@xp,1)`
  );

  const allUsers = [
    { ...GK_MENTOR, role: 'mentor' },
    { ...GK_SME,    role: 'sme'    },
    ...GK_USERS.map(u => ({ ...u, role: 'student' }))
  ];

  const seedUsers = _db.transaction(() => {
    allUsers.forEach(u => {
      insUser.run({
        id: u.id, username: u.username, password: u.password,
        displayName: u.displayName || null, grade: u.grade || null,
        avatar: u.avatar || null, photo: u.photo || null,
        joinDate: u.joinDate || null, preferredStyle: u.preferredStyle || null,
        persona: u.persona || null, role: u.role
      });
      if (u.role === 'student') {
        insXP.run({ id: u.id, xp: u.totalXP || 0 });
      }
    });
  });
  seedUsers();

  // --- Curriculum ---
  const { GK_TOPICS } = _loadDataFile('topics.js', ['GK_TOPICS']);

  const insSubj = _db.prepare(`
    INSERT OR REPLACE INTO subjects (id, name, icon, color, type, quotient, sort_order)
    VALUES (@id,@name,@icon,@color,@type,@quotient,@sort_order)
  `);
  const insTopic = _db.prepare(`
    INSERT OR REPLACE INTO topics
      (id, subject_id, name, page_title, description, icon,
       xp, mandatory, module_type, sort_order)
    VALUES (@id,@subject_id,@name,@page_title,@description,@icon,
            @xp,@mandatory,@module_type,@sort_order)
  `);
  const insST = _db.prepare(`
    INSERT OR REPLACE INTO subtopics
      (id, topic_id, name, lesson_prefix, subtopic_type, mandatory, xp,
       description, sort_order,
       resources_json, concepts_json, game_json, assessment_json, ai_hints_json)
    VALUES (@id,@topic_id,@name,@lesson_prefix,@subtopic_type,@mandatory,@xp,
            @description,@sort_order,
            @resources_json,@concepts_json,@game_json,@assessment_json,@ai_hints_json)
  `);

  const seedCurriculum = _db.transaction(() => {
    (GK_TOPICS.subjects || []).forEach((subj, si) => {
      console.log(`[GKServer/db] syncing subject: ${subj.id}`);
      insSubj.run({
        id: subj.id, name: subj.name, icon: subj.icon || null,
        color: subj.color || null, type: subj.type || null,
        quotient: subj.quotient || null, sort_order: si
      });

      (subj.topics || []).forEach((topic, ti) => {
        insTopic.run({
          id: topic.id, subject_id: subj.id, name: topic.name,
          page_title: topic.pageTitle || null, description: topic.description || null,
          icon: topic.icon || null, xp: topic.xp || 0,
          mandatory: topic.mandatory !== false ? 1 : 0,
          module_type: topic.moduleType || 'standard', sort_order: ti
        });

        (topic.subtopics || []).forEach((st, sti) => {
          let concepts = [];
          if (Array.isArray(st.concepts)) {
            concepts = st.concepts;
          } else if (typeof st.concept === 'string') {
            concepts = [{
              title: st.name, body: st.concept,
              examples: (st.examples || []).map(e =>
                typeof e === 'string' ? e : `${e.label}: ${e.value}`
              )
            }];
          }

          insST.run({
            id: st.id, topic_id: topic.id, name: st.name,
            lesson_prefix: st.lessonPrefix || null,
            subtopic_type: st.subtopicType || 'core',
            mandatory: st.mandatory !== false ? 1 : 0,
            xp: st.xp || 0, description: st.description || null, sort_order: sti,
            resources_json:  JSON.stringify(st.resources   || []),
            concepts_json:   JSON.stringify(concepts),
            game_json:       st.game ? JSON.stringify(st.game) : null,
            assessment_json: JSON.stringify(st.assessment  || []),
            ai_hints_json:   JSON.stringify(st.aiHints     || [])
          });
        });
      });
    });
    console.log('[GKServer/db] Curriculum sync complete.');
  });
  seedCurriculum();

  // --- Feedback question sets ---
  const { GK_FEEDBACK_QUESTIONS, GK_SUBTOPIC_FEEDBACK_QUESTIONS, GK_MODULE_FEEDBACK_QUESTIONS }
    = _loadDataFile('feedback-data.js', [
        'GK_FEEDBACK_QUESTIONS',
        'GK_SUBTOPIC_FEEDBACK_QUESTIONS',
        'GK_MODULE_FEEDBACK_QUESTIONS'
      ]);

  const insFB = _db.prepare(
    `INSERT OR IGNORE INTO feedback_question_sets (set_id, questions_json) VALUES (?,?)`
  );
  _db.transaction(() => {
    insFB.run('subtopic', JSON.stringify(GK_SUBTOPIC_FEEDBACK_QUESTIONS));
    insFB.run('module',   JSON.stringify(GK_MODULE_FEEDBACK_QUESTIONS));
    insFB.run('session',  JSON.stringify(GK_FEEDBACK_QUESTIONS));
  })();

  console.log('[GKServer/db] seed complete');
}

// ── Init ─────────────────────────────────────────────────────────────────────

function init(customDir) {
  if (_db) return;
  
  const finalDir = customDir || DB_DIR;
  const finalPath = customDir ? path.join(customDir, 'gurukul.sqlite') : DB_PATH;
  
  // Ensure the DB directory exists
  fs.mkdirSync(finalDir, { recursive: true });

  _db = new Database(finalPath);
  
  // better-sqlite3 compatibility polyfill for transactions
  if (!_db.transaction) {
    _db.transaction = function(fn) {
      return (...args) => {
        _db.exec('BEGIN');
        try {
          const result = fn(...args);
          _db.exec('COMMIT');
          return result;
        } catch (e) {
          _db.exec('ROLLBACK');
          throw e;
        }
      };
    };
  }

  // Apply schema (CREATE TABLE IF NOT EXISTS — safe to run every startup)
  _db.exec(SCHEMA);
  _db.exec('PRAGMA busy_timeout = 5000');
  if (process.env.SQLITE_JOURNAL_MODE) {
    _db.exec(`PRAGMA journal_mode = ${process.env.SQLITE_JOURNAL_MODE}`);
  }
  // Migration: add is_published if DB existed before this column was added
  try {
    _db.exec(`ALTER TABLE learning_path_topics ADD COLUMN is_published INTEGER DEFAULT 0`);
  } catch (_) { /* column already exists — safe to ignore */ }
  // Migration: add topic_key to subtopic_feedback if DB existed before this column was added
  try {
    _db.exec(`ALTER TABLE subtopic_feedback ADD COLUMN topic_key TEXT`);
  } catch (_) { /* column already exists — safe to ignore */ }
  _seed();
  console.log('[GKServer/db] ready at', DB_PATH);
}

// ── /api/init snapshot builder ────────────────────────────────────────────────
// Returns the full application state that the client caches in memory.

function buildInitSnapshot() {
  const d = db();

  // Users
  const usersArr = d.prepare(`SELECT * FROM users`).all();
  const users = {};
  usersArr.forEach(u => {
    users[u.id] = {
      id:             u.id,
      username:       u.username,
      password:       u.password,
      displayName:    u.display_name,
      grade:          u.grade,
      avatar:         u.avatar,
      photo:          u.photo,
      joinDate:       u.join_date,
      preferredStyle: u.preferred_style,
      persona:        u.persona,
      role:           u.role
    };
  });

  // XP
  const xpArr = d.prepare(`SELECT * FROM user_xp`).all();
  const xp = {};
  xpArr.forEach(r => {
    xp[r.user_id] = {
      totalXP:    r.total_xp,
      level:      r.level,
      isPromoted: !!r.is_promoted,
      promotedAt: r.promoted_at
    };
  });

  // Auth session
  const authRow = d.prepare(`SELECT user_id FROM auth_session WHERE id=1`).get();
  const authSession = { userId: authRow ? authRow.user_id : null };

  // Active sessions
  const activeSessions = {};
  d.prepare(`SELECT * FROM active_sessions`).all().forEach(r => {
    activeSessions[r.user_id] = {
      userId:       r.user_id,
      startTime:    r.start_time,
      mood:         JSON.parse(r.mood_json   || '{}'),
      xpEarned:     r.xp_earned,
      feedbackJson: r.feedback_json
    };
  });

  // Subtopic completions
  const subtopicCompletions = {};
  d.prepare(`SELECT user_id, subtopic_key, completed_at FROM subtopic_completions`).all()
    .forEach(r => {
      if (!subtopicCompletions[r.user_id]) subtopicCompletions[r.user_id] = [];
      subtopicCompletions[r.user_id].push({ key: r.subtopic_key, completedAt: r.completed_at });
    });

  // Topic completions
  const topicCompletions = {};
  d.prepare(`SELECT user_id, topic_id, completed_at FROM topic_completions`).all()
    .forEach(r => {
      if (!topicCompletions[r.user_id]) topicCompletions[r.user_id] = [];
      topicCompletions[r.user_id].push(r.topic_id);
    });

  // Subtopic scores
  const subtopicScores = {};
  d.prepare(`SELECT * FROM subtopic_scores`).all().forEach(r => {
    if (!subtopicScores[r.user_id]) subtopicScores[r.user_id] = {};
    subtopicScores[r.user_id][r.subtopic_key] = {
      score: r.score, total: r.total,
      percentage: r.percentage, completedAt: r.completed_at
    };
  });

  // Assessment attempts
  const assessmentAttempts = {};
  d.prepare(
    `SELECT user_id, topic_key, score, total, percentage, answers_json, attempted_at
     FROM assessment_attempts ORDER BY attempted_at ASC`
  ).all().forEach(r => {
    if (!assessmentAttempts[r.user_id]) assessmentAttempts[r.user_id] = {};
    if (!assessmentAttempts[r.user_id][r.topic_key]) assessmentAttempts[r.user_id][r.topic_key] = [];
    assessmentAttempts[r.user_id][r.topic_key].push({
      score: r.score, total: r.total, percentage: r.percentage,
      answers: JSON.parse(r.answers_json || '[]'),
      attemptedAt: r.attempted_at
    });
  });

  // Mentor notes
  const mentorNotes = {};
  d.prepare(
    `SELECT id, user_id, note_json, is_read, created_at FROM mentor_notes ORDER BY created_at ASC`
  ).all().forEach(r => {
    if (!mentorNotes[r.user_id]) mentorNotes[r.user_id] = [];
    mentorNotes[r.user_id].push({
      id: r.id,
      ...JSON.parse(r.note_json || '{}'),
      read: !!r.is_read, createdAt: r.created_at
    });
  });

  // Mentor rewards
  const mentorRewards = {};
  d.prepare(
    `SELECT user_id, amount, reason, awarded_at FROM mentor_rewards ORDER BY awarded_at ASC`
  ).all().forEach(r => {
    if (!mentorRewards[r.user_id]) mentorRewards[r.user_id] = [];
    mentorRewards[r.user_id].push({ amount: r.amount, reason: r.reason, awardedAt: r.awarded_at });
  });

  // Topic locks
  const topicLocks = {};
  d.prepare(`SELECT user_id, topic_key, is_locked FROM topic_locks`).all().forEach(r => {
    if (!topicLocks[r.user_id]) topicLocks[r.user_id] = {};
    topicLocks[r.user_id][r.topic_key] = r.is_locked;
  });

  // Quick-check results
  const quickCheckResults = {};
  d.prepare(
    `SELECT id, user_id, result_json, submitted_at FROM quick_check_results ORDER BY submitted_at ASC`
  ).all().forEach(r => {
    if (!quickCheckResults[r.user_id]) quickCheckResults[r.user_id] = [];
    quickCheckResults[r.user_id].push({
      id: r.id,
      ...JSON.parse(r.result_json || '{}'),
      submittedAt: r.submitted_at
    });
  });

  // Holistic scores
  const holisticScores = {};
  d.prepare(`SELECT user_id, raw_json FROM holistic_scores`).all().forEach(r => {
    holisticScores[r.user_id] = JSON.parse(r.raw_json || 'null');
  });

  // Subtopic feedback
  const subtopicFeedback = {};
  d.prepare(
    `SELECT user_id, subtopic_key, feedback_json, saved_at FROM subtopic_feedback ORDER BY saved_at ASC`
  ).all().forEach(r => {
    if (!subtopicFeedback[r.user_id]) subtopicFeedback[r.user_id] = {};
    if (!subtopicFeedback[r.user_id][r.subtopic_key]) subtopicFeedback[r.user_id][r.subtopic_key] = [];
    subtopicFeedback[r.user_id][r.subtopic_key].push({
      ...JSON.parse(r.feedback_json || '{}'), savedAt: r.saved_at
    });
  });

  // Module feedback
  const moduleFeedback = {};
  d.prepare(
    `SELECT user_id, topic_key, feedback_json, saved_at FROM module_feedback ORDER BY saved_at ASC`
  ).all().forEach(r => {
    if (!moduleFeedback[r.user_id]) moduleFeedback[r.user_id] = {};
    if (!moduleFeedback[r.user_id][r.topic_key]) moduleFeedback[r.user_id][r.topic_key] = [];
    moduleFeedback[r.user_id][r.topic_key].push({
      ...JSON.parse(r.feedback_json || '{}'), savedAt: r.saved_at
    });
  });

  // Demo overrides
  const demoOverrides = {};
  d.prepare(`SELECT user_id, topic_key, override_json FROM demo_overrides`).all().forEach(r => {
    if (!demoOverrides[r.user_id]) demoOverrides[r.user_id] = {};
    demoOverrides[r.user_id][r.topic_key] = JSON.parse(r.override_json || '{}');
  });

  // User extras
  const userExtras = {};
  d.prepare(`SELECT user_id, extra_json FROM user_extra`).all().forEach(r => {
    userExtras[r.user_id] = JSON.parse(r.extra_json || '{}');
  });

  // Session history
  const sessionHistory = {};
  d.prepare(
    `SELECT id, user_id, start_time, end_time, mood_json, xp_earned, feedback_json
     FROM session_log ORDER BY start_time ASC`
  ).all().forEach(r => {
    if (!sessionHistory[r.user_id]) sessionHistory[r.user_id] = [];
    sessionHistory[r.user_id].push({
      id: r.id, userId: r.user_id,
      startTime: r.start_time, endTime: r.end_time,
      mood: JSON.parse(r.mood_json || '{}'),
      xpEarned: r.xp_earned,
      feedback: r.feedback_json ? JSON.parse(r.feedback_json) : null
    });
  });

  // Review requests
  const reviewRequests = {};
  d.prepare(
    `SELECT id, user_id, request_json, is_read, submitted_at FROM review_requests ORDER BY submitted_at ASC`
  ).all().forEach(r => {
    if (!reviewRequests[r.user_id]) reviewRequests[r.user_id] = [];
    reviewRequests[r.user_id].push({
      ...JSON.parse(r.request_json || '{}'),
      id: r.id, read: !!r.is_read, submittedAt: r.submitted_at
    });
  });

  // Mentor mood log
  const mentorMoodLog = {};
  d.prepare(
    `SELECT mentor_id, mood_json, logged_at FROM mentor_mood_log ORDER BY logged_at ASC`
  ).all().forEach(r => {
    if (!mentorMoodLog[r.mentor_id]) mentorMoodLog[r.mentor_id] = [];
    mentorMoodLog[r.mentor_id].push({
      ...JSON.parse(r.mood_json || '{}'), loggedAt: r.logged_at
    });
  });

  // ── Learning paths ───────────────────────────────────────────────────────────
  const learningPaths = {};
  d.prepare(`SELECT * FROM learning_paths`).all().forEach(lp => {
    learningPaths[lp.id] = {
      id: lp.id, name: lp.name, description: lp.description,
      grade: lp.grade, isActive: !!lp.is_active,
      createdAt: lp.created_at, updatedAt: lp.updated_at,
      topics: []
    };
  });
  d.prepare(`SELECT * FROM learning_path_topics ORDER BY sort_order ASC`).all().forEach(r => {
    if (learningPaths[r.path_id]) {
      learningPaths[r.path_id].topics.push({
        topicId: r.topic_id, order: r.sort_order, required: !!r.is_required,
        isPublished: !!r.is_published
      });
    }
  });

  // ── Student learning path assignments ────────────────────────────────────────
  const studentLearningPaths = {};
  d.prepare(`
    SELECT slp.student_id, slp.path_id, slp.assigned_at, slp.assigned_by, slp.is_active,
           lp.name AS path_name, lp.grade AS path_grade
    FROM   student_learning_paths slp
    JOIN   learning_paths lp ON lp.id = slp.path_id
  `).all().forEach(r => {
    if (!studentLearningPaths[r.student_id]) studentLearningPaths[r.student_id] = [];
    studentLearningPaths[r.student_id].push({
      pathId: r.path_id, pathName: r.path_name, pathGrade: r.path_grade,
      assignedAt: r.assigned_at, assignedBy: r.assigned_by, isActive: !!r.is_active
    });
  });

  return {
    authSession, users, xp,
    activeSessions, subtopicCompletions, topicCompletions,
    subtopicScores, assessmentAttempts,
    mentorNotes, mentorRewards, topicLocks,
    quickCheckResults, holisticScores,
    subtopicFeedback, moduleFeedback,
    demoOverrides, userExtras,
    sessionHistory, reviewRequests, mentorMoodLog,
    learningPaths, studentLearningPaths
  };
}

// ── Write helpers (used by routes.js) ────────────────────────────────────────

const Q = {
  // Auth
  saveCurrentUser(userId) {
    db().prepare(`INSERT OR REPLACE INTO auth_session (id, user_id) VALUES (1,?)`).run(userId);
  },
  clearCurrentUser(userId) {
    db().prepare(`DELETE FROM auth_session WHERE id=1`).run();
    if (userId) db().prepare(`DELETE FROM active_sessions WHERE user_id=?`).run(userId);
  },

  // XP
  addXP(userId, amount) {
    db().prepare(`
      INSERT INTO user_xp (user_id, total_xp, level, updated_at)
      VALUES (?,?,1,datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        total_xp   = total_xp + ?,
        updated_at = datetime('now')
    `).run(userId, amount, amount);
    return db().prepare(`SELECT total_xp FROM user_xp WHERE user_id=?`).get(userId).total_xp;
  },

  awardReward(userId, amount, reason) {
    db().prepare(
      `INSERT INTO mentor_rewards (user_id, amount, reason) VALUES (?,?,?)`
    ).run(userId, amount, reason);
  },

  // Sessions
  startSession(userId, moodData) {
    db().prepare(`
      INSERT OR REPLACE INTO active_sessions (user_id, start_time, mood_json, xp_earned)
      VALUES (?,?,?,0)
    `).run(userId, new Date().toISOString(), JSON.stringify(moodData || {}));
  },
  updateSession(userId, mood, xpEarned, feedbackJson) {
    db().prepare(`
      UPDATE active_sessions SET mood_json=?, xp_earned=?, feedback_json=? WHERE user_id=?
    `).run(
      mood !== undefined ? JSON.stringify(mood) : null,
      xpEarned, feedbackJson !== undefined ? JSON.stringify(feedbackJson) : null,
      userId
    );
  },
  addSessionXP(userId, amount) {
    db().prepare(
      `UPDATE active_sessions SET xp_earned = xp_earned + ? WHERE user_id=?`
    ).run(amount, userId);
  },
  logSession(userId, startTime, mood, xpEarned, feedback) {
    db().prepare(`
      INSERT INTO session_log
        (user_id, start_time, end_time, mood_json, xp_earned, feedback_json)
      VALUES (?,?,datetime('now'),?,?,?)
    `).run(
      userId, startTime,
      JSON.stringify(mood || {}), xpEarned,
      feedback ? JSON.stringify(feedback) : null
    );
    db().prepare(`DELETE FROM active_sessions WHERE user_id=?`).run(userId);
  },

  // Progress
  subtopicComplete(userId, subtopicKey) {
    db().prepare(
      `INSERT OR IGNORE INTO subtopic_completions (user_id, subtopic_key) VALUES (?,?)`
    ).run(userId, subtopicKey);
  },
  topicComplete(userId, topicId) {
    db().prepare(
      `INSERT OR IGNORE INTO topic_completions (user_id, topic_id) VALUES (?,?)`
    ).run(userId, topicId);
  },
  saveSubtopicScore(userId, subtopicKey, score, total) {
    const pct = Math.round((score / total) * 100);
    const ex  = db().prepare(
      `SELECT score FROM subtopic_scores WHERE user_id=? AND subtopic_key=?`
    ).get(userId, subtopicKey);
    if (!ex || score >= ex.score) {
      db().prepare(`
        INSERT OR REPLACE INTO subtopic_scores
          (user_id, subtopic_key, score, total, percentage)
        VALUES (?,?,?,?,?)
      `).run(userId, subtopicKey, score, total, pct);
    }
    db().prepare(
      `INSERT OR IGNORE INTO subtopic_completions (user_id, subtopic_key) VALUES (?,?)`
    ).run(userId, subtopicKey);
  },
  recordAssessment(userId, topicKey, score, total, answers) {
    const pct = Math.round((score / total) * 100);
    db().prepare(`
      INSERT INTO assessment_attempts
        (user_id, topic_key, score, total, percentage, answers_json)
      VALUES (?,?,?,?,?,?)
    `).run(userId, topicKey, score, total, pct, JSON.stringify(answers || []));
    // Keep last 5 per user+topic
    db().prepare(`
      DELETE FROM assessment_attempts WHERE id IN (
        SELECT id FROM assessment_attempts
        WHERE user_id=? AND topic_key=?
        ORDER BY attempted_at ASC
        LIMIT MAX(0,
          (SELECT COUNT(*) FROM assessment_attempts WHERE user_id=? AND topic_key=?) - 5
        )
      )
    `).run(userId, topicKey, userId, topicKey);
    if (pct >= 60) {
      db().prepare(
        `INSERT OR IGNORE INTO topic_completions (user_id, topic_id) VALUES (?,?)`
      ).run(userId, topicKey);
    }
  },

  // Feedback
  // Aditya: now takes topicKey as well so feedback can be grouped by module in /api/feedback/all
  saveSubtopicFeedback(userId, topicKey, subtopicKey, data) {
    db().prepare(
      `INSERT INTO subtopic_feedback (user_id, topic_key, subtopic_key, feedback_json)
       VALUES (?, ?, ?, ?)`
    ).run(userId, topicKey, subtopicKey, JSON.stringify(data));
  },
  saveModuleFeedback(userId, topicKey, data) {
    db().prepare(
      `INSERT INTO module_feedback (user_id, topic_key, feedback_json) VALUES (?,?,?)`
    ).run(userId, topicKey, JSON.stringify(data));
  },
  // Aditya: persists session feedback to session_feedback table (permanent, not volatile active_sessions)
  saveSessionFeedback(userId, data) {
    db().prepare(
      `INSERT INTO session_feedback (user_id, feedback_json) VALUES (?, ?)`
    ).run(userId, JSON.stringify(data));
  },
  // Aditya: new method — returns all feedback consolidated by student for dashboard
  getAllFeedback(userId = null) {
    const d = db();
    const where  = userId ? `WHERE sf.user_id = ?` : '';
    const params = userId ? [userId] : [];

    const subtopicRows = d.prepare(`
      SELECT sf.id, sf.user_id, sf.topic_key, sf.subtopic_key,
            sf.feedback_json, sf.saved_at,
            t.name  AS topic_name,
            st.name AS subtopic_name
      FROM subtopic_feedback sf
      LEFT JOIN topics    t  ON t.id = sf.topic_key
      LEFT JOIN subtopics st ON st.id = REPLACE(sf.subtopic_key, sf.topic_key || '-', '')
                            AND st.topic_id = sf.topic_key
      ${where}
      ORDER BY sf.saved_at DESC
    `).all(...params);

    const moduleRows = d.prepare(`
      SELECT mf.id, mf.user_id, mf.topic_key,
             mf.feedback_json, mf.saved_at,
             t.name AS topic_name
      FROM module_feedback mf
      LEFT JOIN topics t ON t.id = mf.topic_key
      ${where.replace('sf.user_id', 'mf.user_id')}
      ORDER BY mf.saved_at DESC
    `).all(...params);

    const sessionRows = d.prepare(`
      SELECT id, user_id, feedback_json, saved_at
      FROM session_feedback
      ${userId ? 'WHERE user_id = ?' : ''}
      ORDER BY saved_at DESC
    `).all(...params);

    const allUserIds = new Set([
      ...subtopicRows.map(r => r.user_id),
      ...moduleRows.map(r => r.user_id),
      ...sessionRows.map(r => r.user_id),
    ]);

    return [...allUserIds].map(uid => {
      const sessions = sessionRows
        .filter(r => r.user_id === uid)
        .map(r => {
          const fb = JSON.parse(r.feedback_json);
          return {
            id:               r.id,
            savedAt:          r.saved_at,
            enjoyedMost:      fb.responses?.enjoyedMost      || null,
            improvementPoint: fb.responses?.improvementPoint || null,
          };
        });

      const modulesMap = {};

      moduleRows.filter(r => r.user_id === uid).forEach(r => {
        const fb = JSON.parse(r.feedback_json);
        modulesMap[r.topic_key] = {
          topicKey:  r.topic_key,
          topicName: r.topic_name || r.topic_key,
          savedAt:   r.saved_at,
          feedback: {
            enjoyedMost:      fb.responses?.enjoyedMost      || null,
            improvementPoint: fb.responses?.improvementPoint || null,
          },
          subtopics: [],
        };
      });

      subtopicRows.filter(r => r.user_id === uid).forEach(r => {
        const fb     = JSON.parse(r.feedback_json);
        const parent = r.topic_key || 'unknown';
        if (!modulesMap[parent]) {
          modulesMap[parent] = {
            topicKey:  parent,
            topicName: r.topic_name || parent,
            savedAt:   null,
            feedback:  null,
            subtopics: [],
          };
        }
        modulesMap[parent].subtopics.push({
          subtopicKey:  r.subtopic_key,
          subtopicName: r.subtopic_name || r.subtopic_key,
          savedAt:      r.saved_at,
          feedback: {
            enjoyedMost:      fb.responses?.enjoyedMost      || null,
            improvementPoint: fb.responses?.improvementPoint || null,
          },
        });
      });

      return {
        userId:  uid,
        sessions,
        modules: Object.values(modulesMap),
      };
    });
  },


  // Quick-check
  saveQuickCheck(userId, result) {
    const id  = Date.now();
    const now = new Date().toISOString();
    db().prepare(
      `INSERT INTO quick_check_results (id, user_id, result_json, submitted_at) VALUES (?,?,?,?)`
    ).run(id, userId, JSON.stringify({ ...result, id }), now);
  },

  // Mentor notes
  addMentorNote(userId, noteData) {
    const id  = 'note_' + Date.now();
    const now = new Date().toISOString();
    db().prepare(`
      INSERT INTO mentor_notes (id, user_id, note_json, is_read, created_at)
      VALUES (?,?,?,0,?)
    `).run(id, userId, JSON.stringify(noteData), now);
    return id;
  },
  markAllNotesRead(userId) {
    db().prepare(`UPDATE mentor_notes SET is_read=1 WHERE user_id=?`).run(userId);
  },
  markNoteRead(userId, noteId) {
    db().prepare(`UPDATE mentor_notes SET is_read=1 WHERE id=? AND user_id=?`).run(noteId, userId);
  },

  // Promote
  promoteStudent(userId) {
    db().prepare(`
      INSERT INTO user_xp (user_id, total_xp, level, is_promoted, promoted_at, updated_at)
      VALUES (?,0,1,1,datetime('now'),datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        is_promoted = 1,
        promoted_at = datetime('now'),
        updated_at  = datetime('now')
    `).run(userId);
  },

  // Topic locks
  setTopicLock(userId, topicKey, isLocked) {
    db().prepare(`
      INSERT OR REPLACE INTO topic_locks (user_id, topic_key, is_locked) VALUES (?,?,?)
    `).run(userId, topicKey, isLocked ? 1 : 0);
  },

  // Review requests
  saveReviewRequest(userId, data) {
    const id  = Date.now();
    const now = new Date().toISOString();
    db().prepare(`
      INSERT INTO review_requests (id, user_id, request_json, submitted_at)
      VALUES (?,?,?,?)
    `).run(id, userId, JSON.stringify({ id, userId, ...data }), now);
  },
  markReviewRead(userId, requestId) {
    db().prepare(`UPDATE review_requests SET is_read=1 WHERE id=? AND user_id=?`).run(requestId, userId);
  },
  clearReviews(userId) {
    db().prepare(`DELETE FROM review_requests WHERE user_id=?`).run(userId);
  },

  // Holistic scores (full blob)
  saveHolistic(userId, data) {
    const now = new Date().toISOString();

    // Derive individual quotient averages from the rich data structure so the
    // top-level columns stay meaningful for direct DB queries / reports.
    const ai      = data.ai      || {};
    const mentor  = data.mentor  || {};
    const mentorE = data.mentor_eval || {};

    function _humanScore(q) {
      if (mentorE[q] && mentorE[q].score !== undefined) return mentorE[q].score;
      if (mentor[q]  !== undefined) return mentor[q];
      return null;
    }
    function _avg(aiVal, humanVal) {
      if (humanVal !== null && humanVal !== undefined) return Math.round((aiVal + humanVal) / 2);
      return aiVal ?? null;
    }

    const aq = _avg(ai.aq, _humanScore('aq'));
    const eq = _avg(ai.eq, _humanScore('eq'));
    const sq = _avg(ai.sq, _humanScore('sq'));
    const pq = _avg(ai.pq, _humanScore('pq'));
    const hq = (aq !== null && eq !== null && sq !== null && pq !== null)
               ? Math.round((aq + eq + sq + pq) / 4)
               : (data.hq ?? null);

    db().prepare(`
      INSERT OR REPLACE INTO holistic_scores
        (user_id, aq, sq, pq, eq, hq, raw_json, saved_at)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(userId, aq, sq, pq, eq, hq,
           JSON.stringify({ ...data, savedAt: now }), now);
  },

  // Holistic evaluations (normalized, one row per evaluation event)
  saveHolisticEval(userId, quotient, evalData) {
    const { q1, q2, q3, score, observations, eval_type } = evalData;
    db().prepare(`
      INSERT INTO holistic_evaluations
        (user_id, quotient, q1, q2, q3, score, observations, eval_type, evaluated_at)
      VALUES (?,?,?,?,?,?,?,?,datetime('now'))
    `).run(
      userId, quotient,
      q1 != null ? parseInt(q1, 10) : null,
      q2 != null ? parseInt(q2, 10) : null,
      q3 != null ? parseInt(q3, 10) : null,
      parseInt(score, 10),
      observations || null,
      eval_type || 'mentor_eval'
    );
  },

  // Mood log
  saveMentorMood(mentorId, moodData) {
    db().prepare(
      `INSERT INTO mentor_mood_log (mentor_id, mood_json) VALUES (?,?)`
    ).run(mentorId, JSON.stringify(moodData));
    // Keep last 100 per mentor
    db().prepare(`
      DELETE FROM mentor_mood_log WHERE id IN (
        SELECT id FROM mentor_mood_log WHERE mentor_id=?
        ORDER BY logged_at ASC
        LIMIT MAX(0,
          (SELECT COUNT(*) FROM mentor_mood_log WHERE mentor_id=?) - 100
        )
      )
    `).run(mentorId, mentorId);
  },

  // Topic reset
  resetTopics(userId, topicKeys) {
    const t = db().transaction(() => {
      topicKeys.forEach(tk => {
        db().prepare(`DELETE FROM assessment_attempts WHERE user_id=? AND topic_key=?`).run(userId, tk);
        db().prepare(`DELETE FROM topic_completions WHERE user_id=? AND topic_id=?`).run(userId, tk);
        db().prepare(`DELETE FROM demo_overrides WHERE user_id=? AND topic_key=?`).run(userId, tk);
        const topicId = tk.includes('-') ? tk.split('-').slice(1).join('-') : tk;
        db().prepare(`DELETE FROM subtopic_completions WHERE user_id=? AND subtopic_key LIKE ?`)
          .run(userId, topicId + '-%');
        db().prepare(`DELETE FROM subtopic_scores WHERE user_id=? AND subtopic_key LIKE ?`)
          .run(userId, topicId + '-%');
        db().prepare(`
          DELETE FROM quick_check_results
          WHERE user_id=? AND json_extract(result_json, '$.topicId')=?
        `).run(userId, topicId);
      });
    });
    t();
  },

  resetAllScores(userId) {
    const t = db().transaction(() => {
      db().prepare(`DELETE FROM subtopic_scores      WHERE user_id=?`).run(userId);
      db().prepare(`DELETE FROM subtopic_completions WHERE user_id=?`).run(userId);
      db().prepare(`DELETE FROM assessment_attempts  WHERE user_id=?`).run(userId);
      db().prepare(`DELETE FROM topic_completions    WHERE user_id=?`).run(userId);
      db().prepare(`DELETE FROM quick_check_results  WHERE user_id=?`).run(userId);
      db().prepare(`DELETE FROM demo_overrides       WHERE user_id=?`).run(userId);
      db().prepare(`DELETE FROM mentor_rewards       WHERE user_id=?`).run(userId);
      db().prepare(`DELETE FROM topic_locks          WHERE user_id=?`).run(userId);
      db().prepare(`DELETE FROM holistic_scores      WHERE user_id=?`).run(userId);
      db().prepare(`DELETE FROM holistic_evaluations WHERE user_id=?`).run(userId);
      db().prepare(`DELETE FROM review_requests      WHERE user_id=?`).run(userId);
      db().prepare(`DELETE FROM user_extra           WHERE user_id=?`).run(userId);
      db().prepare(`UPDATE active_sessions SET xp_earned=0 WHERE user_id=?`).run(userId);
      db().prepare(`
        UPDATE user_xp SET total_xp=0, level=1, is_promoted=0, promoted_at=NULL, updated_at=datetime('now')
        WHERE user_id=?
      `).run(userId);
    });
    t();
  },

  // saveUserProfile compatibility shim — routes per-field to correct tables
  saveUserProfile(userId, profileData) {
    const now = new Date().toISOString();
    const t = db().transaction(() => {
      if (
        profileData.totalXP    !== undefined ||
        profileData.level      !== undefined ||
        profileData.isPromoted !== undefined ||
        profileData.promotedAt !== undefined
      ) {
        const ex = db().prepare(`SELECT * FROM user_xp WHERE user_id=?`).get(userId);
        if (ex) {
          db().prepare(`
            UPDATE user_xp SET total_xp=?,level=?,is_promoted=?,promoted_at=?,updated_at=?
            WHERE user_id=?
          `).run(
            profileData.totalXP    ?? ex.total_xp,
            profileData.level      ?? ex.level,
            profileData.isPromoted !== undefined ? (profileData.isPromoted ? 1 : 0) : ex.is_promoted,
            profileData.promotedAt ?? ex.promoted_at,
            now, userId
          );
        } else {
          db().prepare(`
            INSERT INTO user_xp (user_id, total_xp, level, is_promoted, promoted_at, updated_at)
            VALUES (?,?,?,?,?,?)
          `).run(
            userId,
            profileData.totalXP    || 0,
            profileData.level      || 1,
            profileData.isPromoted ? 1 : 0,
            profileData.promotedAt || null,
            now
          );
        }
      }

      if (Array.isArray(profileData.completedTopics)) {
        profileData.completedTopics.forEach(t =>
          db().prepare(`INSERT OR IGNORE INTO topic_completions (user_id, topic_id) VALUES (?,?)`)
            .run(userId, t)
        );
      }

      if (Array.isArray(profileData.completedSubtopics)) {
        profileData.completedSubtopics.forEach(k =>
          db().prepare(`INSERT OR IGNORE INTO subtopic_completions (user_id, subtopic_key) VALUES (?,?)`)
            .run(userId, k)
        );
      }

      if (profileData.subtopicScores && typeof profileData.subtopicScores === 'object') {
        Object.entries(profileData.subtopicScores).forEach(([key, v]) => {
          const ex = db().prepare(
            `SELECT score FROM subtopic_scores WHERE user_id=? AND subtopic_key=?`
          ).get(userId, key);
          if (!ex || v.score >= ex.score) {
            db().prepare(`
              INSERT OR REPLACE INTO subtopic_scores
                (user_id, subtopic_key, score, total, percentage, completed_at)
              VALUES (?,?,?,?,?,?)
            `).run(userId, key, v.score, v.total, v.percentage, v.completedAt || now);
          }
        });
      }

      if (Array.isArray(profileData.mentorNotes)) {
        profileData.mentorNotes.forEach(n => {
          const { id, read, createdAt, ...rest } = n;
          db().prepare(`
            INSERT OR IGNORE INTO mentor_notes (id, user_id, note_json, is_read, created_at)
            VALUES (?,?,?,?,?)
          `).run(id, userId, JSON.stringify(rest), read ? 1 : 0, createdAt || now);
          db().prepare(`UPDATE mentor_notes SET is_read=? WHERE id=? AND user_id=?`)
            .run(read ? 1 : 0, id, userId);
        });
      }

      if (
        Array.isArray(profileData.unlockedTopics) ||
        Array.isArray(profileData.lockedTopics)
      ) {
        db().prepare(`DELETE FROM topic_locks WHERE user_id=?`).run(userId);
        (profileData.unlockedTopics || []).forEach(k =>
          db().prepare(`INSERT INTO topic_locks (user_id, topic_key, is_locked) VALUES (?,?,0)`)
            .run(userId, k)
        );
        (profileData.lockedTopics || []).forEach(k =>
          db().prepare(`INSERT INTO topic_locks (user_id, topic_key, is_locked) VALUES (?,?,1)`)
            .run(userId, k)
        );
      }

      if (profileData.holisticScores) {
        const hs = profileData.holisticScores;
        db().prepare(`
          INSERT OR REPLACE INTO holistic_scores
            (user_id, aq, sq, pq, eq, hq, raw_json, saved_at)
          VALUES (?,?,?,?,?,?,?,?)
        `).run(
          userId,
          hs.aq ?? null, hs.sq ?? null, hs.pq ?? null,
          hs.eq ?? null, hs.hq ?? null,
          JSON.stringify(hs), hs.savedAt || now
        );
      }
      
      if (profileData.overrides && typeof profileData.overrides === 'object') {
        Object.entries(profileData.overrides).forEach(([tk, val]) => {
          if (val === true) {
            db().prepare(`INSERT OR REPLACE INTO demo_overrides (user_id, topic_key, override_json) VALUES (?,?,?)`)
              .run(userId, tk, JSON.stringify({ overriden: true, at: now }));
          } else {
            db().prepare(`DELETE FROM demo_overrides WHERE user_id=? AND topic_key=?`)
              .run(userId, tk);
          }
        });
      }

      // Extra unknown fields → user_extra
      const KNOWN = new Set([
        'id','username','password','displayName','display_name',
        'grade','avatar','photo','joinDate','join_date',
        'preferredStyle','preferred_style','persona','role',
        'totalXP','level','isPromoted','promotedAt',
        'completedTopics','completedSubtopics','subtopicScores',
        'assessmentAttempts','mentorNotes','mentorRewards',
        'unlockedTopics','lockedTopics','quickCheckResults',
        'holisticScores','subtopicFeedback','moduleFeedback',
        'overrides','updatedAt'
      ]);
      const extra = {};
      Object.keys(profileData).forEach(k => { if (!KNOWN.has(k)) extra[k] = profileData[k]; });
      if (Object.keys(extra).length > 0) {
        const ex = db().prepare(`SELECT extra_json FROM user_extra WHERE user_id=?`).get(userId);
        const merged = { ...(ex ? JSON.parse(ex.extra_json || '{}') : {}), ...extra };
        db().prepare(`INSERT OR REPLACE INTO user_extra (user_id, extra_json) VALUES (?,?)`)
          .run(userId, JSON.stringify(merged));
      }
    });
    t();
  }
};

// ── Learning path CRUD helpers (used by routes + config-loader) ──────────────
const LPQ = {

  /** Create or update a learning path record. */
  upsertLearningPath({ id, name, description, grade, isActive = true }) {
    const now = new Date().toISOString();
    db().prepare(`
      INSERT INTO learning_paths (id, name, description, grade, is_active, created_at, updated_at)
      VALUES (@id, @name, @description, @grade, @isActive, @now, @now)
      ON CONFLICT(id) DO UPDATE SET
        name        = excluded.name,
        description = excluded.description,
        grade       = excluded.grade,
        is_active   = excluded.is_active,
        updated_at  = excluded.updated_at
    `).run({ id, name, description: description || null, grade: grade || null,
             isActive: isActive ? 1 : 0, now });
  },

  /** Replace the full topic list for a path (wipe + re-insert). */
  setLearningPathTopics(pathId, topics) {
    db().prepare(`DELETE FROM learning_path_topics WHERE path_id = ?`).run(pathId);
    const ins = db().prepare(`
      INSERT INTO learning_path_topics (path_id, topic_id, sort_order, is_required, is_published)
      VALUES (?, ?, ?, ?, ?)
    `);
    db().transaction(() => {
      (topics || []).forEach((t, i) => {
        ins.run(
          pathId, t.topicId, t.order ?? i,
          t.required !== false ? 1 : 0,
          t.published === true ? 1 : 0
        );
      });
    })();
  },

  /** Soft-delete a learning path (sets is_active=0). */
  deactivateLearningPath(pathId) {
    db().prepare(`UPDATE learning_paths SET is_active=0, updated_at=? WHERE id=?`)
      .run(new Date().toISOString(), pathId);
  },

  /** Hard-delete a learning path and its topics + assignments (CASCADE). */
  deleteLearningPath(pathId) {
    db().prepare(`DELETE FROM student_learning_paths WHERE path_id=?`).run(pathId);
    db().prepare(`DELETE FROM learning_path_topics    WHERE path_id=?`).run(pathId);
    db().prepare(`DELETE FROM learning_paths          WHERE id=?`).run(pathId);
  },

  /** Assign a student to a path. Deactivates any previous path first. */
  assignStudentToPath(studentId, pathId, assignedBy) {
    db().prepare(`
      UPDATE student_learning_paths SET is_active=0 WHERE student_id=?
    `).run(studentId);
    db().prepare(`
      INSERT INTO student_learning_paths (student_id, path_id, assigned_at, assigned_by, is_active)
      VALUES (?, ?, datetime('now'), ?, 1)
      ON CONFLICT(student_id, path_id) DO UPDATE SET
        is_active   = 1,
        assigned_at = datetime('now'),
        assigned_by = excluded.assigned_by
    `).run(studentId, pathId, assignedBy || null);
  },

  /** Remove (deactivate) a student's assignment to a specific path. */
  removeStudentFromPath(studentId, pathId) {
    db().prepare(`
      UPDATE student_learning_paths SET is_active=0
      WHERE student_id=? AND path_id=?
    `).run(studentId, pathId);
  },

  /** Get the active learning path for one student, with all ordered topics. */
  getStudentActivePath(studentId) {
    const row = db().prepare(`
      SELECT lp.id, lp.name, lp.description, lp.grade, slp.assigned_at, slp.assigned_by
      FROM   student_learning_paths slp
      JOIN   learning_paths lp ON lp.id = slp.path_id
      WHERE  slp.student_id = ? AND slp.is_active = 1
      LIMIT 1
    `).get(studentId);
    if (!row) return null;

    const topics = db().prepare(`
      SELECT lpt.topic_id, lpt.sort_order, lpt.is_required, lpt.is_published,
             t.name AS topic_name, t.description, t.icon, t.xp, t.module_type,
             s.id   AS subject_id, s.name AS subject_name
      FROM   learning_path_topics lpt
      JOIN   topics   t ON t.id = lpt.topic_id
      JOIN   subjects s ON s.id = t.subject_id
      WHERE  lpt.path_id = ?
      ORDER  BY lpt.sort_order ASC
    `).all(row.id);

    return {
      pathId:     row.id,
      pathName:   row.name,
      description: row.description,
      grade:      row.grade,
      assignedAt: row.assigned_at,
      assignedBy: row.assigned_by,
      topics:     topics.map(t => ({
        topicId:     t.topic_id,
        topicName:   t.topic_name,
        description: t.description,
        icon:        t.icon,
        xp:          t.xp,
        moduleType:  t.module_type,
        subjectId:   t.subject_id,
        subjectName: t.subject_name,
        order:       t.sort_order,
        required:    !!t.is_required,
        isPublished: !!t.is_published
      }))
    };
  },

  /** List all learning paths with their topic counts. */
  getAllPaths() {
    const paths = db().prepare(`SELECT * FROM learning_paths ORDER BY grade, name`).all();
    return paths.map(lp => {
      const topics = db().prepare(
        `SELECT topic_id, sort_order, is_required, is_published FROM learning_path_topics WHERE path_id=? ORDER BY sort_order ASC`
      ).all(lp.id);
      return {
        id: lp.id, name: lp.name, description: lp.description,
        grade: lp.grade, isActive: !!lp.is_active,
        createdAt: lp.created_at, updatedAt: lp.updated_at,
        topics: topics.map(t => ({
          topicId: t.topic_id, order: t.sort_order, required: !!t.is_required,
          isPublished: !!t.is_published
        }))
      };
    });
  },

  /** List all topics available to add to a learning path. */
  getAllTopicsFlat() {
    return db().prepare(`
      SELECT t.id AS topic_id, t.name AS topic_name, t.description,
             t.xp, t.mandatory, t.module_type,
             s.id AS subject_id, s.name AS subject_name
      FROM   topics t
      JOIN   subjects s ON s.id = t.subject_id
      ORDER  BY s.sort_order, t.sort_order
    `).all();
  }
};

module.exports = { init, buildInitSnapshot, Q, LPQ };
