'use strict';
// ============================================================
// SERVER: routes.js
// All REST API endpoints for Gurukul.
//
// Every write endpoint:
//   1. Performs the DB operation via server/db.js Q helpers
//   2. Broadcasts an SSE 'update' event to all mentor clients
//   3. Returns { ok: true }
// ============================================================

const express   = require('express');
const fs        = require('fs');
const path      = require('path');
const multer    = require('multer');
const { Q, LPQ, buildInitSnapshot } = require('./db');
const { sseHandler, broadcast } = require('./events');
const { syncConfig, readConfig, getConfigPath } = require('./config-loader');
const {
  readBranding, writeBranding, saveLogoFromBase64, saveLogoFile, getBrandingPath,
  checkSetupPin
} = require('./branding-loader');

const router = express.Router();

const LOGO_DIR = path.resolve(__dirname, '../img');
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|jpg|png|webp|svg\+xml|gif)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error('Logo must be PNG, JPG, WebP, or SVG'));
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function ok(res)        { res.json({ ok: true }); }
function err(res, e, status) {
  console.error('[GKRoutes]', e);
  res.status(status || 500).json({ ok: false, error: e.message || String(e) });
}

// ── GET /api/init ─────────────────────────────────────────────────────────────
// Returns a complete data snapshot. Called once at client startup.

/**
 * @swagger
 * /api/init:
 *   get:
 *     summary: Get complete application initialization data
 *     description: Returns a full snapshot of Gurukul application data including users, learning paths, progress, XP, mentor data, and system configuration required during client startup.
 *     tags:
 *       - Initialization
 *     responses:
 *       200:
 *         description: Initialization snapshot retrieved successfully
 *       500:
 *         description: Internal server error
 */
router.get('/init', (req, res) => {
  try {
    const snapshot = buildInitSnapshot();
    snapshot.branding = readBranding();
    res.json(snapshot);
  } catch (e) { err(res, e); }
});

const PUBLISHED_GRADE6 = path.resolve(__dirname, '../published/Grade_6');
const CONTENT_JSON_FILES = [
  '01_curiosity_hooks_v2.json',
  '02_trigger_questions_v2.json',
  '03_concept_cards_v2.json',
  '04_assessments_v2.json',
  '05_deep_dive_zone_v2.json',
  '06_project_zone_v2.json'
];

function _safeContentSegment(seg) {
  if (!seg || !/^[A-Za-z0-9_-]+$/.test(seg)) return null;
  return seg;
}

function _readPublishedContentFromDisk(subject, topic) {
  const subj = _safeContentSegment(subject);
  const top = _safeContentSegment(topic);
  if (!subj || !top) return null;

  const dir = path.join(PUBLISHED_GRADE6, subj, top);
  if (!fs.existsSync(dir)) return null;

  const readJson = (filename) => {
    const filePath = path.join(dir, filename);
    if (!fs.existsSync(filePath)) {
      const err = new Error(`File not found: ${subject}/${topic}/${filename}`);
      err.status = 404;
      throw err;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  };

  const [hooks, triggers, concepts, assessments, deepDive, project] =
    CONTENT_JSON_FILES.map(readJson);

  return { hooks, triggers, concepts, assessments, deepDive, project };
}

async function _fetchPublishedContentRemote(subject, topic) {
  const baseUrl = process.env.CONTENT_BASE_URL;
  if (!baseUrl) return null;

  const base = `${baseUrl.replace(/\/$/, '')}/${subject}/${topic}`;
  const responses = await Promise.all(
    CONTENT_JSON_FILES.map(f => fetch(`${base}/${f}`))
  );

  for (let i = 0; i < responses.length; i++) {
    if (!responses[i].ok) {
      const err = new Error(`File not found: ${subject}/${topic}/${CONTENT_JSON_FILES[i]}`);
      err.status = 404;
      throw err;
    }
    const ct = responses[i].headers.get('content-type') || '';
    if (!ct.includes('json')) {
      const err = new Error(
        `Invalid content response for ${CONTENT_JSON_FILES[i]} (expected JSON). Check CONTENT_BASE_URL.`
      );
      err.status = 502;
      throw err;
    }
  }

  const [hooks, triggers, concepts, assessments, deepDive, project] =
    await Promise.all(responses.map(r => r.json()));

  return { hooks, triggers, concepts, assessments, deepDive, project };
}

// ── GET /api/content/:subject/:topic ─────────────────────────────────────────
// Reads published JSON from published/Grade_6 first; optional remote via CONTENT_BASE_URL.

router.get('/content/:subject/:topic', async (req, res) => {
  try {
    const { subject, topic } = req.params;

    let content = _readPublishedContentFromDisk(subject, topic);
    if (!content) {
      content = await _fetchPublishedContentRemote(subject, topic);
    }
    if (!content) {
      return res.status(404).json({
        ok: false,
        error: `No published content for ${subject}/${topic}. Add files under published/Grade_6/ or set CONTENT_BASE_URL.`
      });
    }

    res.json({ ok: true, content });
  } catch (e) {
    err(res, e, e.status || 500);
  }
});

// ── Branding (white-label: logo + school name, no code edits) ─────────────────

router.get('/branding', (req, res) => {
  try { res.json(readBranding()); } catch (e) { err(res, e); }
});

router.post('/branding', (req, res) => {
  try {
    const { setupPin, ...fields } = req.body || {};
    const branding = writeBranding(fields, setupPin);
    broadcast({ type: 'branding_updated', branding });
    res.json({ ok: true, branding });
  } catch (e) {
    err(res, e, e.message === 'Invalid setup PIN' ? 403 : 400);
  }
});

router.post('/branding/logo', (req, res) => {
  try {
    const { setupPin, imageBase64 } = req.body || {};
    const logoPath = saveLogoFromBase64(imageBase64, setupPin);
    const branding = readBranding();
    broadcast({ type: 'branding_updated', branding });
    res.json({ ok: true, logoPath, branding });
  } catch (e) {
    err(res, e, e.message === 'Invalid setup PIN' ? 403 : 400);
  }
});

router.post('/branding/reload', (req, res) => {
  try {
    const branding = readBranding();
    broadcast({ type: 'branding_updated', branding });
    res.json({ ok: true, brandingFile: getBrandingPath(), branding });
  } catch (e) { err(res, e); }
});

const AI_ASSISTANTS_PATH = path.resolve(__dirname, '../config/ai-assistants.json');

router.get('/ai-assistants', (req, res) => {
  try {
    const raw = fs.readFileSync(AI_ASSISTANTS_PATH, 'utf8');
    res.json(JSON.parse(raw));
  } catch (e) { err(res, e); }
});

router.post('/admin/ai-assistants', (req, res) => {
  try {
    const pin = (req.body && req.body.setupPin) || '';
    if (!checkSetupPin(pin)) {
      return res.status(403).json({ ok: false, error: 'Invalid setup PIN' });
    }
    const defaultAssistantId = (req.body && req.body.defaultAssistantId) || '';
    const raw = fs.readFileSync(AI_ASSISTANTS_PATH, 'utf8');
    const config = JSON.parse(raw);
    if (!config.assistants || !config.assistants.some(a => a.id === defaultAssistantId)) {
      return res.status(400).json({ ok: false, error: 'Unknown AI guide' });
    }
    config.defaultAssistantId = defaultAssistantId;
    fs.writeFileSync(AI_ASSISTANTS_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');
    res.json({ ok: true, defaultAssistantId });
  } catch (e) { err(res, e); }
});

// Admin save: text fields + optional logo file (multipart — reliable in all browsers)
router.post('/admin/school-branding', logoUpload.single('logo'), (req, res) => {
  try {
    const pin = (req.body && req.body.setupPin) || '';
    const fields = {
      schoolName: req.body.schoolName,
      tagline: req.body.tagline,
      loginSubtitle: req.body.loginSubtitle,
      portalHero: req.body.portalHero
    };
    let branding = writeBranding(fields, pin);
    if (req.file && req.file.buffer) {
      const ext = path.extname(req.file.originalname || '').replace('.', '') || 'png';
      saveLogoFile(req.file.buffer, ext, pin);
      branding = readBranding();
    }
    broadcast({ type: 'branding_updated', branding });
    res.json({ ok: true, branding });
  } catch (e) {
    err(res, e, e.message === 'Invalid setup PIN' ? 403 : 400);
  }
});

// ── GET /api/events ───────────────────────────────────────────────────────────
// SSE endpoint — mentor-app.js connects here for real-time updates.

/**
 * @swagger
 * /api/events:
 *   get:
 *     summary: Subscribe to real-time mentor updates
 *     description: Establishes a Server-Sent Events (SSE) connection for receiving live updates related to student activity, progress tracking, and mentor notifications.
 *     tags:
 *       - Events
 *     responses:
 *       200:
 *         description: SSE connection established successfully
 */
router.get('/events', sseHandler);

// ── Auth ─────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login a user into the Gurukul platform
 *     description: Authenticates a student, mentor, or SME user and stores the current active session information.
 *     tags:
 *       - Authentication
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *             properties:
 *               userId:
 *                 type: string
 *                 example: gargi
 *     responses:
 *       200:
 *         description: User logged in successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *       500:
 *         description: Internal server error
 */
router.post('/auth/login', (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ ok: false, error: 'userId required' });
    }
    Q.saveCurrentUser(userId);
    ok(res);
  } catch (e) { err(res, e); }
});

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Logout a user from the Gurukul platform
 *     description: Clears the current user session and broadcasts a real-time logout event to connected mentor clients.
 *     tags:
 *       - Authentication
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *             properties:
 *               userId:
 *                 type: string
 *                 example: gargi
 *     responses:
 *       200:
 *         description: User logged out successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *       500:
 *         description: Internal server error
 */
router.post('/auth/logout', (req, res) => {
  try {
    const { userId } = req.body;
    Q.clearCurrentUser(userId);
    broadcast({ type: 'logout', userId });
    ok(res);
  } catch (e) { err(res, e); }
});

// ── XP ───────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/xp/add:
 *   post:
 *     summary: Add XP points to a student
 *     description: Adds experience points (XP) to a user's profile and broadcasts the updated XP total to connected mentor clients in real time.
 *     tags:
 *       - XP Management
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - amount
 *             properties:
 *               userId:
 *                 type: string
 *                 example: gargi
 *               amount:
 *                 type: integer
 *                 example: 50
 *     responses:
 *       200:
 *         description: XP added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 newTotal:
 *                   type: integer
 *                   example: 150
 *       500:
 *         description: Internal server error
 */
router.post('/xp/add', (req, res) => {
  try {
    const { userId, amount } = req.body;
    const newTotal = Q.addXP(userId, amount);
    broadcast({ type: 'xp', userId, newTotal });
    res.json({ ok: true, newTotal });
  } catch (e) { err(res, e); }
});

// ── Sessions ─────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/session/start:
 *   post:
 *     summary: Start a personalized learning session
 *     description: Creates a new learning session for a student and stores initial mood or engagement data for adaptive learning analysis.
 *     tags:
 *       - Learning Sessions
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *             properties:
 *               userId:
 *                 type: string
 *                 example: arjuna
 *               moodData:
 *                 type: object
 *                 description: Initial emotional or engagement data captured at session start
 *     responses:
 *       200:
 *         description: Session started successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *       500:
 *         description: Internal server error
 */
router.post('/session/start', (req, res) => {
  try {
    const { userId, moodData } = req.body;
    Q.startSession(userId, moodData);
    broadcast({ type: 'session_start', userId });
    ok(res);
  } catch (e) { err(res, e); }
});

/**
 * @swagger
 * /api/session/update:
 *   post:
 *     summary: Update an active learning session
 *     description: Updates session progress, mood tracking, earned XP, and learner feedback during an ongoing personalized learning session.
 *     tags:
 *       - Learning Sessions
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *             properties:
 *               userId:
 *                 type: string
 *                 example: nachiketa
 *               mood:
 *                 type: string
 *                 example: focused
 *               xpEarned:
 *                 type: integer
 *                 example: 20
 *               feedback:
 *                 type: string
 *                 example: Enjoyed the interactive experiment section
 *     responses:
 *       200:
 *         description: Session updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *       500:
 *         description: Internal server error
 */
router.post('/session/update', (req, res) => {
  try {
    const { userId, mood, xpEarned, feedback } = req.body;
    Q.updateSession(userId, mood, xpEarned, feedback);
    ok(res);
  } catch (e) { err(res, e); }
});

/**
 * @swagger
 * /api/session/xp:
 *   post:
 *     summary: Add XP during an active session
 *     description: Adds session-specific XP rewards earned during learning activities or assessments.
 *     tags:
 *       - Learning Sessions
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - amount
 *             properties:
 *               userId:
 *                 type: string
 *                 example: ahilya
 *               amount:
 *                 type: integer
 *                 example: 15
 *     responses:
 *       200:
 *         description: Session XP added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *       500:
 *         description: Internal server error
 */
router.post('/session/xp', (req, res) => {
  try {
    const { userId, amount } = req.body;
    Q.addSessionXP(userId, amount);
    ok(res);
  } catch (e) { err(res, e); }
});

/**
 * @swagger
 * /api/session/log:
 *   post:
 *     summary: Log and complete a learning session
 *     description: Stores final session analytics including mood, XP earned, feedback, and session duration, then broadcasts a session completion event to mentors.
 *     tags:
 *       - Learning Sessions
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - startTime
 *             properties:
 *               userId:
 *                 type: string
 *                 example: gargi
 *               startTime:
 *                 type: string
 *                 format: date-time
 *                 example: 2026-05-27T10:00:00Z
 *               mood:
 *                 type: string
 *                 example: motivated
 *               xpEarned:
 *                 type: integer
 *                 example: 40
 *               feedback:
 *                 type: string
 *                 example: AI-generated examples were easy to understand
 *     responses:
 *       200:
 *         description: Session logged successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *       500:
 *         description: Internal server error
 */
router.post('/session/log', (req, res) => {
  try {
    const { userId, startTime, mood, xpEarned, feedback } = req.body;
    Q.logSession(userId, startTime, mood, xpEarned, feedback);
    broadcast({ type: 'session_end', userId });
    ok(res);
  } catch (e) { err(res, e); }
});

// ── Progress ─────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/progress/subtopic-complete:
 *   post:
 *     summary: Mark a subtopic as completed
 *     description: Updates learner progress by marking a specific subtopic as completed and broadcasts the completion event to mentor dashboards.
 *     tags:
 *       - Progress Tracking
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - subtopicKey
 *             properties:
 *               userId:
 *                 type: string
 *                 example: gargi
 *               subtopicKey:
 *                 type: string
 *                 example: fractions_intro
 *     responses:
 *       200:
 *         description: Subtopic marked as completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *       500:
 *         description: Internal server error
 */
router.post('/progress/subtopic-complete', (req, res) => {
  try {
    const { userId, subtopicKey } = req.body;
    Q.subtopicComplete(userId, subtopicKey);
    broadcast({ type: 'subtopic_complete', userId, subtopicKey });
    ok(res);
  } catch (e) { err(res, e); }
});

/**
 * @swagger
 * /api/progress/topic-complete:
 *   post:
 *     summary: Mark a topic as completed
 *     description: Records the completion of a full learning topic for a student and broadcasts the update to connected mentor clients.
 *     tags:
 *       - Progress Tracking
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - topicId
 *             properties:
 *               userId:
 *                 type: string
 *                 example: arjuna
 *               topicId:
 *                 type: string
 *                 example: algebra_basics
 *     responses:
 *       200:
 *         description: Topic marked as completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *       500:
 *         description: Internal server error
 */
router.post('/progress/topic-complete', (req, res) => {
  try {
    const { userId, topicId } = req.body;
    Q.topicComplete(userId, topicId);
    broadcast({ type: 'topic_complete', userId, topicId });
    ok(res);
  } catch (e) { err(res, e); }
});

/**
 * @swagger
 * /api/progress/subtopic-score:
 *   post:
 *     summary: Save a learner's subtopic assessment score
 *     description: Stores score and total marks achieved by a student for a specific subtopic assessment and broadcasts the update in real time.
 *     tags:
 *       - Progress Tracking
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - subtopicKey
 *               - score
 *               - total
 *             properties:
 *               userId:
 *                 type: string
 *                 example: nachiketa
 *               subtopicKey:
 *                 type: string
 *                 example: force_and_motion
 *               score:
 *                 type: integer
 *                 example: 8
 *               total:
 *                 type: integer
 *                 example: 10
 *     responses:
 *       200:
 *         description: Subtopic score saved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *       500:
 *         description: Internal server error
 */
router.post('/progress/subtopic-score', (req, res) => {
  try {
    const { userId, subtopicKey, score, total } = req.body;
    Q.saveSubtopicScore(userId, subtopicKey, score, total);
    broadcast({ type: 'subtopic_score', userId, subtopicKey });
    ok(res);
  } catch (e) { err(res, e); }
});

/**
 * @swagger
 * /api/progress/assessment:
 *   post:
 *     summary: Record a topic-level assessment result
 *     description: Stores learner assessment results including score, total marks, and submitted answers for AI-driven learning analysis and progress tracking.
 *     tags:
 *       - Progress Tracking
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - topicKey
 *               - score
 *               - total
 *             properties:
 *               userId:
 *                 type: string
 *                 example: ahilya
 *               topicKey:
 *                 type: string
 *                 example: photosynthesis
 *               score:
 *                 type: integer
 *                 example: 18
 *               total:
 *                 type: integer
 *                 example: 20
 *               answers:
 *                 type: array
 *                 items:
 *                   type: object
 *                 description: Submitted assessment answers
 *     responses:
 *       200:
 *         description: Assessment recorded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *       500:
 *         description: Internal server error
 */
router.post('/progress/assessment', (req, res) => {
  try {
    const { userId, topicKey, score, total, answers } = req.body;
    Q.recordAssessment(userId, topicKey, score, total, answers);
    broadcast({ type: 'assessment', userId, topicKey });
    ok(res);
  } catch (e) { err(res, e); }
});

/**
 * @swagger
 * /api/progress/reset-topics:
 *   post:
 *     summary: Reset selected learning topics
 *     description: Clears completion status, scores, and progress data for selected topics of a student.
 *     tags:
 *       - Progress Tracking
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - topicKeys
 *             properties:
 *               userId:
 *                 type: string
 *                 example: gargi
 *               topicKeys:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example:
 *                   - algebra_basics
 *                   - fractions_intro
 *     responses:
 *       200:
 *         description: Selected topics reset successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *       500:
 *         description: Internal server error
 */
router.post('/progress/reset-topics', (req, res) => {
  try {
    const { userId, topicKeys } = req.body;
    Q.resetTopics(userId, topicKeys);
    broadcast({ type: 'reset_topics', userId });
    ok(res);
  } catch (e) { err(res, e); }
});

/**
 * @swagger
 * /api/progress/reset-all:
 *   post:
 *     summary: Reset all learner progress data
 *     description: Clears all scores, assessments, topic completions, and learning progress data for a specific student account.
 *     tags:
 *       - Progress Tracking
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *             properties:
 *               userId:
 *                 type: string
 *                 example: arjuna
 *     responses:
 *       200:
 *         description: All learner progress data reset successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *       500:
 *         description: Internal server error
 */
router.post('/progress/reset-all', (req, res) => {
  try {
    const { userId } = req.body;
    Q.resetAllScores(userId);
    broadcast({ type: 'reset_all', userId });
    ok(res);
  } catch (e) { err(res, e); }
});

// ── Feedback ─────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/feedback/subtopic:
 *   post:
 *     summary: Submit feedback for a learning subtopic
 *     description: Stores personalized learner feedback for a specific subtopic to improve adaptive learning recommendations and content quality.
 *     tags:
 *       - Feedback
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - subtopicKey
 *               - feedbackData
 *             properties:
 *               userId:
 *                 type: string
 *                 example: gargi
 *               subtopicKey:
 *                 type: string
 *                 example: fractions_intro
 *               feedbackData:
 *                 type: object
 *                 description: Feedback details submitted by the learner
 *     responses:
 *       200:
 *         description: Subtopic feedback saved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *       500:
 *         description: Internal server error
 */
router.post('/feedback/subtopic', (req, res) => {
  try {
    const { userId, topicKey, subtopicKey, feedbackData } = req.body;
    Q.saveSubtopicFeedback(userId, topicKey, subtopicKey, feedbackData);
    ok(res);
  } catch (e) { err(res, e); }
});

/**
 * @swagger
 * /api/feedback/module:
 *   post:
 *     summary: Submit feedback for a learning module
 *     description: Saves learner feedback for a complete topic or module to help mentors and AI systems evaluate content effectiveness and engagement.
 *     tags:
 *       - Feedback
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - topicKey
 *               - feedbackData
 *             properties:
 *               userId:
 *                 type: string
 *                 example: arjuna
 *               topicKey:
 *                 type: string
 *                 example: algebra_basics
 *               feedbackData:
 *                 type: object
 *                 description: Detailed module-level learner feedback
 *     responses:
 *       200:
 *         description: Module feedback saved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *       500:
 *         description: Internal server error
 */
router.post('/feedback/module', (req, res) => {
  try {
    const { userId, topicKey, feedbackData } = req.body;
    Q.saveModuleFeedback(userId, topicKey, feedbackData);
    ok(res);
  } catch (e) { err(res, e); }
});

/**
 * @swagger
 * /api/feedback/session:
 *   post:
 *     summary: Submit overall session feedback
 *     description: Stores learner feedback related to an entire personalized learning session including engagement, satisfaction, and learning experience insights.
 *     tags:
 *       - Feedback
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - feedbackData
 *             properties:
 *               userId:
 *                 type: string
 *                 example: nachiketa
 *               feedbackData:
 *                 type: object
 *                 description: Session-level learner feedback and experience data
 *     responses:
 *       200:
 *         description: Session feedback saved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *       500:
 *         description: Internal server error
 */

router.post('/feedback/session', (req, res) => {
  try {
    const { userId, feedbackData } = req.body;
    Q.saveSessionFeedback(userId, feedbackData);
    ok(res);
  } catch (e) { err(res, e); }
});

// ── Quick-check ───────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/feedback/all:
 *   get:
 *     summary: Get all feedback consolidated by student
 *     description: Returns feedback for all students (or a single student) nested as student → sessions[] + modules[] → subtopics[].
 *     tags:
 *       - Feedback
 *     parameters:
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *         required: false
 *         description: Filter to a specific student (optional)
 *     responses:
 *       200:
 *         description: Consolidated feedback array
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   userId:
 *                     type: string
 *                   sessions:
 *                     type: array
 *                     items:
 *                       type: object
 *                       properties:
 *                         id:               { type: integer }
 *                         savedAt:          { type: string }
 *                         enjoyedMost:      { type: string }
 *                         improvementPoint: { type: string }
 *                   modules:
 *                     type: array
 *                     items:
 *                       type: object
 *                       properties:
 *                         topicKey:  { type: string }
 *                         topicName: { type: string }
 *                         savedAt:   { type: string }
 *                         feedback:
 *                           type: object
 *                           properties:
 *                             enjoyedMost:      { type: string }
 *                             improvementPoint: { type: string }
 *                         subtopics:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               subtopicKey:  { type: string }
 *                               subtopicName: { type: string }
 *                               savedAt:      { type: string }
 *                               feedback:
 *                                 type: object
 *                                 properties:
 *                                   enjoyedMost:      { type: string }
 *                                   improvementPoint: { type: string }
 *       500:
 *         description: Internal server error
 */
router.get('/feedback/all', (req, res) => {
  try {
    const { userId } = req.query;
    const data = Q.getAllFeedback(userId || null);
    res.json(data);
  } catch (e) { err(res, e); }
});

// ── Quick-check ───────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/quickcheck:
 *   post:
 *     summary: Submit a quick learning assessment result
 *     description: Saves quick-check assessment results used for rapid learner evaluation, adaptive difficulty adjustment, and mentor monitoring.
 *     tags:
 *       - Assessments
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - result
 *             properties:
 *               userId:
 *                 type: string
 *                 example: ahilya
 *               result:
 *                 type: object
 *                 description: Quick-check assessment result data
 *     responses:
 *       200:
 *         description: Quick-check result saved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *       500:
 *         description: Internal server error
 */

router.post('/quickcheck', (req, res) => {
  try {
    const { userId, result } = req.body;
    Q.saveQuickCheck(userId, result);
    broadcast({ type: 'quickcheck', userId });
    ok(res);
  } catch (e) { err(res, e); }
});

// ── Mentor ───────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/mentor/note:
 *   post:
 *     summary: Add a mentor note for a student
 *     description: Creates a mentor observation or guidance note associated with a student profile and broadcasts the update to mentor dashboards.
 *     tags:
 *       - Mentor Management
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - noteData
 *             properties:
 *               userId:
 *                 type: string
 *                 example: gargi
 *               noteData:
 *                 type: object
 *                 description: Mentor note details and observations
 *     responses:
 *       200:
 *         description: Mentor note added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 id:
 *                   type: integer
 *                   example: 101
 *       500:
 *         description: Internal server error
 */
router.post('/mentor/note', (req, res) => {
  try {
    const { userId, noteData } = req.body;
    const id = Q.addMentorNote(userId, noteData);
    broadcast({ type: 'mentor_note', userId });
    res.json({ ok: true, id });
  } catch (e) { err(res, e); }
});

/**
 * @swagger
 * /api/mentor/notes-read:
 *   post:
 *     summary: Mark all mentor notes as read
 *     description: Marks all mentor notes associated with a student as read.
 *     tags:
 *       - Mentor Management
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *             properties:
 *               userId:
 *                 type: string
 *                 example: ahilya
 *     responses:
 *       200:
 *         description: All mentor notes marked as read
 *       500:
 *         description: Internal server error
 */
router.post('/mentor/notes-read', (req, res) => {
  try {
    const { userId } = req.body;
    Q.markAllNotesRead(userId);
    ok(res);
  } catch (e) { err(res, e); }
});

/**
 * @swagger
 * /api/mentor/note-read:
 *   post:
 *     summary: Mark a specific mentor note as read
 *     description: Updates the read status of an individual mentor note for a learner.
 *     tags:
 *       - Mentor Management
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - noteId
 *             properties:
 *               userId:
 *                 type: string
 *                 example: arjuna
 *               noteId:
 *                 type: integer
 *                 example: 12
 *     responses:
 *       200:
 *         description: Mentor note marked as read successfully
 *       500:
 *         description: Internal server error
 */
router.post('/mentor/note-read', (req, res) => {
  try {
    const { userId, noteId } = req.body;
    Q.markNoteRead(userId, noteId);
    ok(res);
  } catch (e) { err(res, e); }
});

/**
 * @swagger
 * /api/mentor/reward:
 *   post:
 *     summary: Award XP reward to a student
 *     description: Allows a mentor to grant XP rewards to a learner along with a motivational reason or achievement note.
 *     tags:
 *       - Mentor Management
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - amount
 *             properties:
 *               userId:
 *                 type: string
 *                 example: nachiketa
 *               amount:
 *                 type: integer
 *                 example: 100
 *               reason:
 *                 type: string
 *                 example: Excellent performance in science assessment
 *     responses:
 *       200:
 *         description: Reward granted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 newTotal:
 *                   type: integer
 *                   example: 450
 *       500:
 *         description: Internal server error
 */
router.post('/mentor/reward', (req, res) => {
  try {
    const { userId, amount, reason } = req.body;
    Q.awardReward(userId, amount, reason);
    const newTotal = Q.addXP(userId, amount);
    broadcast({ type: 'reward', userId, amount, newTotal });
    res.json({ ok: true, newTotal });
  } catch (e) { err(res, e); }
});

/**
 * @swagger
 * /api/mentor/promote:
 *   post:
 *     summary: Promote a learner to the next level
 *     description: Updates learner progression or advancement status based on mentor evaluation or achievement milestones.
 *     tags:
 *       - Mentor Management
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *             properties:
 *               userId:
 *                 type: string
 *                 example: gargi
 *     responses:
 *       200:
 *         description: Student promoted successfully
 *       500:
 *         description: Internal server error
 */
router.post('/mentor/promote', (req, res) => {
  try {
    const { userId } = req.body;
    Q.promoteStudent(userId);
    broadcast({ type: 'promote', userId });
    ok(res);
  } catch (e) { err(res, e); }
});

/**
 * @swagger
 * /api/mentor/lock:
 *   post:
 *     summary: Lock or unlock a learning topic
 *     description: Enables mentors to restrict or allow student access to specific learning topics.
 *     tags:
 *       - Mentor Management
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - topicKey
 *               - isLocked
 *             properties:
 *               userId:
 *                 type: string
 *                 example: arjuna
 *               topicKey:
 *                 type: string
 *                 example: algebra_basics
 *               isLocked:
 *                 type: boolean
 *                 example: true
 *     responses:
 *       200:
 *         description: Topic lock status updated successfully
 *       500:
 *         description: Internal server error
 */
router.post('/mentor/lock', (req, res) => {
  try {
    const { userId, topicKey, isLocked } = req.body;
    Q.setTopicLock(userId, topicKey, isLocked);
    broadcast({ type: 'lock', userId, topicKey, isLocked });
    ok(res);
  } catch (e) { err(res, e); }
});

/**
 * @swagger
 * /api/mentor/review-request:
 *   post:
 *     summary: Submit a mentor review request
 *     description: Creates a mentor review request for learner progress, assessments, or intervention needs.
 *     tags:
 *       - Mentor Management
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - data
 *             properties:
 *               userId:
 *                 type: string
 *                 example: ahilya
 *               data:
 *                 type: object
 *                 description: Review request details
 *     responses:
 *       200:
 *         description: Review request submitted successfully
 *       500:
 *         description: Internal server error
 */
router.post('/mentor/review-request', (req, res) => {
  try {
    const { userId, data } = req.body;
    Q.saveReviewRequest(userId, data);
    broadcast({ type: 'review_request', userId });
    ok(res);
  } catch (e) { err(res, e); }
});

/**
 * @swagger
 * /api/mentor/review-read:
 *   post:
 *     summary: Mark a mentor review request as read
 *     description: Updates the status of a mentor review request after it has been reviewed.
 *     tags:
 *       - Mentor Management
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - requestId
 *             properties:
 *               userId:
 *                 type: string
 *                 example: gargi
 *               requestId:
 *                 type: integer
 *                 example: 8
 *     responses:
 *       200:
 *         description: Review request marked as read successfully
 *       500:
 *         description: Internal server error
 */
router.post('/mentor/review-read', (req, res) => {
  try {
    const { userId, requestId } = req.body;
    Q.markReviewRead(userId, requestId);
    ok(res);
  } catch (e) { err(res, e); }
});

/**
 * @swagger
 * /api/mentor/review-clear:
 *   post:
 *     summary: Clear all mentor review requests
 *     description: Removes or clears all pending mentor review requests for a learner.
 *     tags:
 *       - Mentor Management
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *             properties:
 *               userId:
 *                 type: string
 *                 example: nachiketa
 *     responses:
 *       200:
 *         description: Review requests cleared successfully
 *       500:
 *         description: Internal server error
 */
router.post('/mentor/review-clear', (req, res) => {
  try {
    const { userId } = req.body;
    Q.clearReviews(userId);
    ok(res);
  } catch (e) { err(res, e); }
});

/**
 * @swagger
 * /api/mentor/holistic:
 *   post:
 *     summary: Save holistic learner evaluation data
 *     description: Stores comprehensive mentor evaluations covering emotional, academic, behavioral, and engagement-related learner attributes.
 *     tags:
 *       - Holistic Evaluation
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - data
 *             properties:
 *               userId:
 *                 type: string
 *                 example: gargi
 *               data:
 *                 type: object
 *                 description: Holistic evaluation details
 *     responses:
 *       200:
 *         description: Holistic evaluation saved successfully
 *       500:
 *         description: Internal server error
 */
router.post('/mentor/holistic', (req, res) => {
  try {
    const { userId, data } = req.body;
    Q.saveHolistic(userId, data);
    broadcast({ type: 'holistic', userId });
    ok(res);
  } catch (e) { err(res, e); }
});


/**
 * @swagger
 * /api/mentor/holistic-eval:
 *   post:
 *     summary: Save normalized holistic evaluation metrics
 *     description: Records quotient-wise holistic evaluation scores and observations for a learner during a mentor evaluation event.
 *     tags:
 *       - Holistic Evaluation
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - quotient
 *               - score
 *             properties:
 *               userId:
 *                 type: string
 *                 example: arjuna
 *               quotient:
 *                 type: string
 *                 example: EQ
 *               q1:
 *                 type: string
 *                 example: Emotional awareness
 *               q2:
 *                 type: string
 *                 example: Social interaction
 *               q3:
 *                 type: string
 *                 example: Empathy
 *               score:
 *                 type: integer
 *                 example: 8
 *               observations:
 *                 type: string
 *                 example: Shows strong collaborative behavior
 *     responses:
 *       200:
 *         description: Holistic evaluation metrics saved successfully
 *       400:
 *         description: Missing required fields
 *       500:
 *         description: Internal server error
 */

// Normalized evaluation row (one per evaluation event, per quotient)
router.post('/mentor/holistic-eval', (req, res) => {
  try {
    const { userId, quotient, q1, q2, q3, score, observations } = req.body;
    if (!userId || !quotient || score == null) {
      return res.status(400).json({ ok: false, error: 'userId, quotient and score are required' });
    }
    Q.saveHolisticEval(userId, quotient, { q1, q2, q3, score, observations });
    broadcast({ type: 'holistic_eval', userId, quotient, score });
    ok(res);
  } catch (e) { err(res, e); }
});


/**
 * @swagger
 * /api/mentor/mood:
 *   post:
 *     summary: Save mentor mood and engagement data
 *     description: Records mentor emotional or engagement state data for session analytics and well-being insights.
 *     tags:
 *       - Mentor Management
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - mentorId
 *               - moodData
 *             properties:
 *               mentorId:
 *                 type: string
 *                 example: mentor01
 *               moodData:
 *                 type: object
 *                 description: Mentor mood tracking data
 *     responses:
 *       200:
 *         description: Mentor mood data saved successfully
 *       500:
 *         description: Internal server error
 */
router.post('/mentor/mood', (req, res) => {
  try {
    const { mentorId, moodData } = req.body;
    Q.saveMentorMood(mentorId, moodData);
    ok(res);
  } catch (e) { err(res, e); }
});

// ── Profile (compatibility shim) ─────────────────────────────────────────────
// mentor-app.js calls GKStore.saveUserProfile() to write multiple fields at once.

/**
 * @swagger
 * /api/profile/save:
 *   post:
 *     summary: Save or update learner profile data
 *     description: Updates multiple learner profile attributes such as preferences, avatars, learning styles, and personalized profile information.
 *     tags:
 *       - User Profile
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - profileData
 *             properties:
 *               userId:
 *                 type: string
 *                 example: gargi
 *               profileData:
 *                 type: object
 *                 description: User profile details to update
 *     responses:
 *       200:
 *         description: User profile updated successfully
 *       500:
 *         description: Internal server error
 */
router.post('/profile/save', (req, res) => {
  try {
    const { userId, profileData } = req.body;
    Q.saveUserProfile(userId, profileData);
    broadcast({ type: 'profile', userId });
    ok(res);
  } catch (e) { err(res, e); }
});

// ── Learning path config (CRUD) ───────────────────────────────────────────────

/**
 * @swagger
 * /api/config/topics:
 *   get:
 *     summary: Get all curriculum topics
 *     description: Returns a flattened list of all curriculum topics along with their associated subjects. These topic IDs are used while configuring personalized learning paths.
 *     tags:
 *       - Learning Path Configuration
 *     responses:
 *       200:
 *         description: Curriculum topics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       500:
 *         description: Internal server error
 */
/**
 * GET /api/config/topics
 * List every topic in the curriculum with its subject — use these IDs in
 * config/learning-paths.json or when calling POST /api/config/learning-path.
 */
router.get('/config/topics', (req, res) => {
  try { res.json({ ok: true, data: LPQ.getAllTopicsFlat() }); }
  catch (e) { err(res, e); }
});

/**
 * @swagger
 * /api/config/learning-paths:
 *   get:
 *     summary: Get all learning paths
 *     description: Returns all configured personalized learning paths along with their ordered topic structures.
 *     tags:
 *       - Learning Path Configuration
 *     responses:
 *       200:
 *         description: Learning paths retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       500:
 *         description: Internal server error
 */
/**
 * GET /api/config/learning-paths
 * List all learning paths with their ordered topic lists.
 */
router.get('/config/learning-paths', (req, res) => {
  try { res.json({ ok: true, data: LPQ.getAllPaths() }); }
  catch (e) { err(res, e); }
});

/**
 * @swagger
 * /api/config/learning-path:
 *   post:
 *     summary: Create or update a personalized learning path
 *     description: Creates a new learning path or updates an existing one with ordered curriculum topics and configuration settings.
 *     tags:
 *       - Learning Path Configuration
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - id
 *               - name
 *             properties:
 *               id:
 *                 type: string
 *                 example: grade6_science_path
 *               name:
 *                 type: string
 *                 example: Grade 6 Science Path
 *               description:
 *                 type: string
 *                 example: Personalized science learning path for Grade 6 students
 *               grade:
 *                 type: string
 *                 example: 6
 *               isActive:
 *                 type: boolean
 *                 example: true
 *               topics:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     topicId:
 *                       type: string
 *                       example: photosynthesis
 *                     order:
 *                       type: integer
 *                       example: 1
 *                     required:
 *                       type: boolean
 *                       example: true
 *     responses:
 *       200:
 *         description: Learning path saved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 id:
 *                   type: string
 *                   example: grade6_science_path
 *       400:
 *         description: Missing required fields
 *       500:
 *         description: Internal server error
 */
/**
 * POST /api/config/learning-path
 * Create or update a learning path.
 * Body: { id, name, description, grade, isActive, topics: [{topicId, order, required}] }
 */
router.post('/config/learning-path', (req, res) => {
  try {
    const { id, name, description, grade, isActive, topics } = req.body;
    if (!id || !name) return res.status(400).json({ ok: false, error: 'id and name are required' });
    LPQ.upsertLearningPath({ id, name, description, grade, isActive });
    LPQ.setLearningPathTopics(id, topics || []);
    broadcast({ type: 'learning_path_updated', pathId: id });
    res.json({ ok: true, id });
  } catch (e) { err(res, e); }
});

/**
 * @swagger
 * /api/config/learning-path/{id}:
 *   delete:
 *     summary: Delete a learning path
 *     description: Permanently removes a learning path along with all associated topic mappings and student assignments.
 *     tags:
 *       - Learning Path Configuration
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Unique learning path identifier
 *     responses:
 *       200:
 *         description: Learning path deleted successfully
 *       500:
 *         description: Internal server error
 */
/**
 * DELETE /api/config/learning-path/:id
 * Permanently delete a learning path and all its topic/student assignments.
 */
router.delete('/config/learning-path/:id', (req, res) => {
  try {
    LPQ.deleteLearningPath(req.params.id);
    broadcast({ type: 'learning_path_deleted', pathId: req.params.id });
    ok(res);
  } catch (e) { err(res, e); }
});

/**
 * @swagger
 * /api/config/assign-path:
 *   post:
 *     summary: Assign a learning path to a student
 *     description: Assigns a personalized learning path to a student and automatically deactivates the student's currently active path.
 *     tags:
 *       - Learning Path Configuration
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - studentId
 *               - pathId
 *             properties:
 *               studentId:
 *                 type: string
 *                 example: gargi
 *               pathId:
 *                 type: string
 *                 example: grade6_science_path
 *               assignedBy:
 *                 type: string
 *                 example: mentor01
 *     responses:
 *       200:
 *         description: Learning path assigned successfully
 *       400:
 *         description: Missing required fields
 *       500:
 *         description: Internal server error
 */
/**
 * POST /api/config/assign-path
 * Assign a student to a learning path (deactivates their current path).
 * Body: { studentId, pathId, assignedBy }
 */
router.post('/config/assign-path', (req, res) => {
  try {
    const { studentId, pathId, assignedBy } = req.body;
    if (!studentId || !pathId) return res.status(400).json({ ok: false, error: 'studentId and pathId are required' });
    LPQ.assignStudentToPath(studentId, pathId, assignedBy);
    broadcast({ type: 'path_assigned', studentId, pathId });
    ok(res);
  } catch (e) { err(res, e); }
});

/**
 * @swagger
 * /api/config/remove-path:
 *   post:
 *     summary: Remove a student's learning path assignment
 *     description: Deactivates and removes a student's association with a specific personalized learning path.
 *     tags:
 *       - Learning Path Configuration
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - studentId
 *               - pathId
 *             properties:
 *               studentId:
 *                 type: string
 *                 example: arjuna
 *               pathId:
 *                 type: string
 *                 example: grade6_science_path
 *     responses:
 *       200:
 *         description: Learning path assignment removed successfully
 *       500:
 *         description: Internal server error
 */
/**
 * POST /api/config/remove-path
 * Remove (deactivate) a student's assignment to a specific path.
 * Body: { studentId, pathId }
 */
router.post('/config/remove-path', (req, res) => {
  try {
    const { studentId, pathId } = req.body;
    LPQ.removeStudentFromPath(studentId, pathId);
    broadcast({ type: 'path_removed', studentId, pathId });
    ok(res);
  } catch (e) { err(res, e); }
});

/**
 * @swagger
 * /api/student/{studentId}/learning-path:
 *   get:
 *     summary: Get a student's active personalized learning path
 *     description: Returns the currently active personalized learning path assigned to a student including ordered topics and metadata.
 *     tags:
 *       - Student Learning Paths
 *     parameters:
 *       - in: path
 *         name: studentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Unique student identifier
 *     responses:
 *       200:
 *         description: Student learning path retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       500:
 *         description: Internal server error
 */
/**
 * GET /api/student/:studentId/learning-path
 * Get the active personalized learning path for a specific student,
 * including all ordered topics with full metadata.
 */
router.get('/student/:studentId/learning-path', (req, res) => {
  try {
    const data = LPQ.getStudentActivePath(req.params.studentId);
    if (!data) return res.json({ ok: true, data: null, message: 'No active path assigned' });
    res.json({ ok: true, data });
  } catch (e) { err(res, e); }
});

/**
 * @swagger
 * /api/config/reload:
 *   post:
 *     summary: Reload learning path configuration
 *     description: Hot-reloads the learning-path configuration file into the database without restarting the server.
 *     tags:
 *       - System Configuration
 *     responses:
 *       200:
 *         description: Configuration reloaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 configFile:
 *                   type: string
 *                 synced:
 *                   type: boolean
 *       500:
 *         description: Invalid or missing configuration file
 */
/**
 * POST /api/config/reload
 * Hot-reload config/learning-paths.json into the database without restarting.
 * Returns the config file path so you know exactly which file to edit.
 */
router.post('/config/reload', (req, res) => {
  try {
    const result = syncConfig();
    if (!result) return res.status(500).json({ ok: false, error: 'Config file missing or invalid' });
    broadcast({ type: 'config_reloaded' });
    res.json({ ok: true, configFile: getConfigPath(), synced: result });
  } catch (e) { err(res, e); }
});

/**
 * @swagger
 * /api/config/file:
 *   get:
 *     summary: Get configuration file details
 *     description: Returns the active learning-path configuration file location and its current contents.
 *     tags:
 *       - System Configuration
 *     responses:
 *       200:
 *         description: Configuration file retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 configFile:
 *                   type: string
 *                 contents:
 *                   type: object
 *       500:
 *         description: Internal server error
 */
/**
 * GET /api/config/file
 * Return the path of the config file and its current contents.
 * Useful for knowing exactly where to edit settings.
 */
router.get('/config/file', (req, res) => {
  try {
    const configFile = getConfigPath();
    const contents   = readConfig();
    res.json({ ok: true, configFile, contents });
  } catch (e) { err(res, e); }
});

// ── Live State (in-memory, not persisted to DB) ───────────────────────────────

const _liveStates = {};

/**
 * @swagger
 * /api/live-state:
 *   post:
 *     summary: Update a student's live learning state
 *     description: Stores temporary real-time learner activity data in memory and broadcasts updates to connected mentor dashboards. This data is not persisted to the database.
 *     tags:
 *       - Live State
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - liveState
 *             properties:
 *               userId:
 *                 type: string
 *                 example: gargi
 *               liveState:
 *                 type: object
 *                 description: Real-time learner activity or engagement data
 *     responses:
 *       200:
 *         description: Live state updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *       400:
 *         description: Missing required userId
 *       500:
 *         description: Internal server error
 */
router.post('/live-state', (req, res) => {
  try {
    const { userId, liveState } = req.body;
    if (!userId) return res.status(400).json({ ok: false, error: 'userId required' });
    _liveStates[userId] = liveState;
    broadcast({ type: 'live_state', userId, liveState });
    ok(res);
  } catch (e) { err(res, e); }
});

/**
 * @swagger
 * /api/live-state/{userId}:
 *   get:
 *     summary: Get a student's current live state
 *     description: Retrieves the latest in-memory real-time activity data for a specific learner.
 *     tags:
 *       - Live State
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: Unique learner identifier
 *     responses:
 *       200:
 *         description: Live state retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   nullable: true
 *       500:
 *         description: Internal server error
 */
router.get('/live-state/:userId', (req, res) => {
  try {
    res.json({ ok: true, data: _liveStates[req.params.userId] || null });
  } catch (e) { err(res, e); }
});

// ── Client Config ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/config:
 *   get:
 *     summary: Get client-side application configuration
 *     description: Returns runtime configuration values required by the client application, including AI service API keys and environment-based settings.
 *     tags:
 *       - System Configuration
 *     responses:
 *       200:
 *         description: Client configuration retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 geminiApiKey:
 *                   type: string
 *                   example: your-api-key
 *       500:
 *         description: Internal server error
 */
router.get('/config', (req, res) => {
  const key = process.env.GEMINI_API_KEY || '';
  if (!key) console.warn('[GKRoutes] GEMINI_API_KEY not set in .env');
  res.json({ geminiApiKey: key });
});

// ── AI Proxy ─────────────────────────────────────────────────────────────────

router.get('/ai/proxy', (req, res) => res.json({ ok: true, message: 'AI Proxy is active' }));

/**
 * @swagger
 * /api/ai/proxy:
 *   get:
 *     summary: Check AI proxy service status
 *     description: Returns the operational status of the AI proxy service used for forwarding AI model requests.
 *     tags:
 *       - AI Services
 *     responses:
 *       200:
 *         description: AI proxy service is active
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: AI Proxy is active
 *       500:
 *         description: Internal server error
 */
router.get('/ai/proxy', (req, res) => res.json({ ok: true, message: 'AI Proxy is active' }));

/**
 * @swagger
 * /api/ai/proxy:
 *   post:
 *     summary: Forward AI model requests through proxy
 *     description: Sends AI generation requests to the configured AI model provider through a secure backend proxy service.
 *     tags:
 *       - AI Services
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - model
 *               - body
 *             properties:
 *               model:
 *                 type: string
 *                 example: gemini-2.5-flash
 *               body:
 *                 type: object
 *                 description: AI model request payload
 *     responses:
 *       200:
 *         description: AI request processed successfully
 *       400:
 *         description: Missing required model or request body
 *       500:
 *         description: Internal server error or AI provider failure
 */
router.post('/ai/proxy', async (req, res) => {
  try {
    const { model, body } = req.body;
    if (!model || !body) {
      console.warn('[GKProxy] Missing model or body in request');
      return res.status(400).json({ ok: false, error: 'model/body required' });
    }
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('[GKProxy] GEMINI_API_KEY is missing from .env');
      return res.status(500).json({ ok: false, error: 'Server AI Key missing' });
    }

    // v1beta is REQUIRED for gemini-1.5-flash and gemini-1.5-pro
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    
    console.log(`[GKProxy] Requesting Gemini (${model})...`);
    
    let resp;
    let attempts = 0;
    while (attempts < 2) {
      try {
        resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        break; // break loop on success
      } catch (err) {
        attempts++;
        if (attempts >= 2) throw err;
        console.warn(`[GKProxy] Network/Timeout error on attempt ${attempts}. Retrying...`);
      }
    }

    console.log(`[GKProxy] Gemini Response Status: ${resp.status}`);
    
    const text = await resp.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch (e) {
      console.error('[GKProxy] Non-JSON response from Gemini:', text);
      return res.status(resp.status || 500).json({ ok: false, error: 'Invalid response from AI', raw: text });
    }

    if (!resp.ok) {
      console.error('[GKProxy] Gemini Error Payload:', JSON.stringify(result, null, 2));
    }

    res.status(resp.status).json(result);
  } catch (e) {
    console.error('[GKProxy] Critical Proxy Error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
