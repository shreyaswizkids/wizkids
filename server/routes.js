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
const { Q, LPQ, buildInitSnapshot } = require('./db');
const { sseHandler, broadcast } = require('./events');
const { syncConfig, readConfig, getConfigPath } = require('./config-loader');

const router = express.Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

function ok(res)        { res.json({ ok: true }); }
function err(res, e, status) {
  console.error('[GKRoutes]', e);
  res.status(status || 500).json({ ok: false, error: e.message || String(e) });
}

// ── GET /api/init ─────────────────────────────────────────────────────────────
// Returns a complete data snapshot. Called once at client startup.

router.get('/init', (req, res) => {
  try { res.json(buildInitSnapshot()); } catch (e) { err(res, e); }
});

//Added by keerthini
// ── GET /api/content/:subject/:topic ─────────────────────────────────────────
// This API endpoint fetches all 6 content JSON files for a given subject and topic
// from the published/ folder (locally or from GitHub/GCS depending on CONTENT_BASE_URL in .env).
//
// URL format  : GET /api/content/:subject/:topic
// Example     : GET /api/content/Science/The_Wonderful_World_of_Science
//
// :subject    → Subject folder name  e.g. "Science", "Mathematics"
// :topic      → Topic folder name    e.g. "The_Wonderful_World_of_Science", "Symmetry"
//               (comes from githubFolder field in data/topics.js)
// Returns:
// {
//   ok: true,
//   content: {
//     hooks       → 01_curiosity_hooks_v2.json      (array of curiosity hook cards)
//     triggers    → 02_trigger_questions_v2.json    (array of trigger questions)
//     concepts    → 03_concept_cards_v2.json        (array of concept cards)
//     assessments → 04_assessments_v2.json          (light assessments + final assessment)
//     deepDive    → 05_deep_dive_zone_v2.json       (deep dive scenario)
//     project     → 06_project_zone_v2.json         (project options)
//   }
// }
//
// To switch from local to GitHub or GCS, update only CONTENT_BASE_URL in .env.
// No code changes needed here.

router.get('/content/:subject/:topic', async (req, res) => {
  try {
    const { subject, topic } = req.params;

    // Read the base URL from .env
    // Local  : http://localhost:3000/published/Grade_6
    // GitHub : https://raw.githubusercontent.com/USER/REPO/BRANCH/published/Grade_6
    // GCS    : https://storage.googleapis.com/BUCKET/published/Grade_6
    const baseUrl = process.env.CONTENT_BASE_URL;

    if (!baseUrl) {
      return res.status(500).json({ ok: false, error: 'CONTENT_BASE_URL not set in .env' });
    }

    // Build the base path to the topic folder
    // e.g. http://localhost:3000/published/Grade_6/Science/The_Wonderful_World_of_Science
    const base = `${baseUrl}/${subject}/${topic}`;

    // Fetch all 6 files in parallel for speed
    const [r1, r2, r3, r4, r5, r6] = await Promise.all([
      fetch(`${base}/01_curiosity_hooks_v2.json`),
      fetch(`${base}/02_trigger_questions_v2.json`),
      fetch(`${base}/03_concept_cards_v2.json`),
      fetch(`${base}/04_assessments_v2.json`),
      fetch(`${base}/05_deep_dive_zone_v2.json`),
      fetch(`${base}/06_project_zone_v2.json`)
    ]);

    // File names kept separately for error reporting
    const files = [
      '01_curiosity_hooks_v2.json',
      '02_trigger_questions_v2.json',
      '03_concept_cards_v2.json',
      '04_assessments_v2.json',
      '05_deep_dive_zone_v2.json',
      '06_project_zone_v2.json'
    ];
    const responses = [r1, r2, r3, r4, r5, r6];

    // If any file is missing, return a 404 with the exact filename that failed
    for (let i = 0; i < responses.length; i++) {
      if (!responses[i].ok) {
        return res.status(404).json({
          ok: false,
          error: `File not found: ${subject}/${topic}/${files[i]}`
        });
      }
    }

    // Parse all 6 responses as JSON
    const [hooks, triggers, concepts, assessments, deepDive, project] =
      await Promise.all(responses.map(r => r.json()));

     // Return all 6 files merged into one content object
    res.json({
      ok: true,
      content: { hooks, triggers, concepts, assessments, deepDive, project }
    });

  } catch (e) { err(res, e); }
});


// ── GET /api/events ───────────────────────────────────────────────────────────
// SSE endpoint — mentor-app.js connects here for real-time updates.

router.get('/events', sseHandler);

// ── Auth ─────────────────────────────────────────────────────────────────────

router.post('/auth/login', (req, res) => {
  try {
    const { userId } = req.body;
    Q.saveCurrentUser(userId);
    ok(res);
  } catch (e) { err(res, e); }
});

router.post('/auth/logout', (req, res) => {
  try {
    const { userId } = req.body;
    Q.clearCurrentUser(userId);
    broadcast({ type: 'logout', userId });
    ok(res);
  } catch (e) { err(res, e); }
});

// ── XP ───────────────────────────────────────────────────────────────────────

router.post('/xp/add', (req, res) => {
  try {
    const { userId, amount } = req.body;
    const newTotal = Q.addXP(userId, amount);
    broadcast({ type: 'xp', userId, newTotal });
    res.json({ ok: true, newTotal });
  } catch (e) { err(res, e); }
});

// ── Sessions ─────────────────────────────────────────────────────────────────

router.post('/session/start', (req, res) => {
  try {
    const { userId, moodData } = req.body;
    Q.startSession(userId, moodData);
    broadcast({ type: 'session_start', userId });
    ok(res);
  } catch (e) { err(res, e); }
});

router.post('/session/update', (req, res) => {
  try {
    const { userId, mood, xpEarned, feedback } = req.body;
    Q.updateSession(userId, mood, xpEarned, feedback);
    ok(res);
  } catch (e) { err(res, e); }
});

router.post('/session/xp', (req, res) => {
  try {
    const { userId, amount } = req.body;
    Q.addSessionXP(userId, amount);
    ok(res);
  } catch (e) { err(res, e); }
});

router.post('/session/log', (req, res) => {
  try {
    const { userId, startTime, mood, xpEarned, feedback } = req.body;
    Q.logSession(userId, startTime, mood, xpEarned, feedback);
    broadcast({ type: 'session_end', userId });
    ok(res);
  } catch (e) { err(res, e); }
});

// ── Progress ─────────────────────────────────────────────────────────────────

router.post('/progress/subtopic-complete', (req, res) => {
  try {
    const { userId, subtopicKey } = req.body;
    Q.subtopicComplete(userId, subtopicKey);
    broadcast({ type: 'subtopic_complete', userId, subtopicKey });
    ok(res);
  } catch (e) { err(res, e); }
});

router.post('/progress/topic-complete', (req, res) => {
  try {
    const { userId, topicId } = req.body;
    Q.topicComplete(userId, topicId);
    broadcast({ type: 'topic_complete', userId, topicId });
    ok(res);
  } catch (e) { err(res, e); }
});

router.post('/progress/subtopic-score', (req, res) => {
  try {
    const { userId, subtopicKey, score, total } = req.body;
    Q.saveSubtopicScore(userId, subtopicKey, score, total);
    broadcast({ type: 'subtopic_score', userId, subtopicKey });
    ok(res);
  } catch (e) { err(res, e); }
});

router.post('/progress/assessment', (req, res) => {
  try {
    const { userId, topicKey, score, total, answers } = req.body;
    Q.recordAssessment(userId, topicKey, score, total, answers);
    broadcast({ type: 'assessment', userId, topicKey });
    ok(res);
  } catch (e) { err(res, e); }
});

router.post('/progress/reset-topics', (req, res) => {
  try {
    const { userId, topicKeys } = req.body;
    Q.resetTopics(userId, topicKeys);
    broadcast({ type: 'reset_topics', userId });
    ok(res);
  } catch (e) { err(res, e); }
});

router.post('/progress/reset-all', (req, res) => {
  try {
    const { userId } = req.body;
    Q.resetAllScores(userId);
    broadcast({ type: 'reset_all', userId });
    ok(res);
  } catch (e) { err(res, e); }
});

// ── Feedback ─────────────────────────────────────────────────────────────────

router.post('/feedback/subtopic', (req, res) => {
  try {
    const { userId, subtopicKey, feedbackData } = req.body;
    Q.saveSubtopicFeedback(userId, subtopicKey, feedbackData);
    ok(res);
  } catch (e) { err(res, e); }
});

router.post('/feedback/module', (req, res) => {
  try {
    const { userId, topicKey, feedbackData } = req.body;
    Q.saveModuleFeedback(userId, topicKey, feedbackData);
    ok(res);
  } catch (e) { err(res, e); }
});

router.post('/feedback/session', (req, res) => {
  try {
    const { userId, feedbackData } = req.body;
    Q.saveSessionFeedback(userId, feedbackData);
    ok(res);
  } catch (e) { err(res, e); }
});

// ── Quick-check ───────────────────────────────────────────────────────────────

router.post('/quickcheck', (req, res) => {
  try {
    const { userId, result } = req.body;
    Q.saveQuickCheck(userId, result);
    broadcast({ type: 'quickcheck', userId });
    ok(res);
  } catch (e) { err(res, e); }
});

// ── Mentor ───────────────────────────────────────────────────────────────────

router.post('/mentor/note', (req, res) => {
  try {
    const { userId, noteData } = req.body;
    const id = Q.addMentorNote(userId, noteData);
    broadcast({ type: 'mentor_note', userId });
    res.json({ ok: true, id });
  } catch (e) { err(res, e); }
});

router.post('/mentor/notes-read', (req, res) => {
  try {
    const { userId } = req.body;
    Q.markAllNotesRead(userId);
    ok(res);
  } catch (e) { err(res, e); }
});

router.post('/mentor/note-read', (req, res) => {
  try {
    const { userId, noteId } = req.body;
    Q.markNoteRead(userId, noteId);
    ok(res);
  } catch (e) { err(res, e); }
});

router.post('/mentor/reward', (req, res) => {
  try {
    const { userId, amount, reason } = req.body;
    Q.awardReward(userId, amount, reason);
    const newTotal = Q.addXP(userId, amount);
    broadcast({ type: 'reward', userId, amount, newTotal });
    res.json({ ok: true, newTotal });
  } catch (e) { err(res, e); }
});

router.post('/mentor/promote', (req, res) => {
  try {
    const { userId } = req.body;
    Q.promoteStudent(userId);
    broadcast({ type: 'promote', userId });
    ok(res);
  } catch (e) { err(res, e); }
});

router.post('/mentor/lock', (req, res) => {
  try {
    const { userId, topicKey, isLocked } = req.body;
    Q.setTopicLock(userId, topicKey, isLocked);
    broadcast({ type: 'lock', userId, topicKey, isLocked });
    ok(res);
  } catch (e) { err(res, e); }
});

router.post('/mentor/review-request', (req, res) => {
  try {
    const { userId, data } = req.body;
    Q.saveReviewRequest(userId, data);
    broadcast({ type: 'review_request', userId });
    ok(res);
  } catch (e) { err(res, e); }
});

router.post('/mentor/review-read', (req, res) => {
  try {
    const { userId, requestId } = req.body;
    Q.markReviewRead(userId, requestId);
    ok(res);
  } catch (e) { err(res, e); }
});

router.post('/mentor/review-clear', (req, res) => {
  try {
    const { userId } = req.body;
    Q.clearReviews(userId);
    ok(res);
  } catch (e) { err(res, e); }
});

router.post('/mentor/holistic', (req, res) => {
  try {
    const { userId, data } = req.body;
    Q.saveHolistic(userId, data);
    broadcast({ type: 'holistic', userId });
    ok(res);
  } catch (e) { err(res, e); }
});

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

router.post('/mentor/mood', (req, res) => {
  try {
    const { mentorId, moodData } = req.body;
    Q.saveMentorMood(mentorId, moodData);
    ok(res);
  } catch (e) { err(res, e); }
});

// ── Profile (compatibility shim) ─────────────────────────────────────────────
// mentor-app.js calls GKStore.saveUserProfile() to write multiple fields at once.

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
 * GET /api/config/topics
 * List every topic in the curriculum with its subject — use these IDs in
 * config/learning-paths.json or when calling POST /api/config/learning-path.
 */
router.get('/config/topics', (req, res) => {
  try { res.json({ ok: true, data: LPQ.getAllTopicsFlat() }); }
  catch (e) { err(res, e); }
});

/**
 * GET /api/config/learning-paths
 * List all learning paths with their ordered topic lists.
 */
router.get('/config/learning-paths', (req, res) => {
  try { res.json({ ok: true, data: LPQ.getAllPaths() }); }
  catch (e) { err(res, e); }
});

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

router.post('/live-state', (req, res) => {
  try {
    const { userId, liveState } = req.body;
    if (!userId) return res.status(400).json({ ok: false, error: 'userId required' });
    _liveStates[userId] = liveState;
    broadcast({ type: 'live_state', userId, liveState });
    ok(res);
  } catch (e) { err(res, e); }
});

router.get('/live-state/:userId', (req, res) => {
  try {
    res.json({ ok: true, data: _liveStates[req.params.userId] || null });
  } catch (e) { err(res, e); }
});

// ── Client Config ────────────────────────────────────────────────────────────

router.get('/config', (req, res) => {
  const key = process.env.GEMINI_API_KEY || '';
  if (!key) console.warn('[GKRoutes] GEMINI_API_KEY not set in .env');
  res.json({ geminiApiKey: key });
});

// ── AI Proxy ─────────────────────────────────────────────────────────────────

router.get('/ai/proxy', (req, res) => res.json({ ok: true, message: 'AI Proxy is active' }));

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
