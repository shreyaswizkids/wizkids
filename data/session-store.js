// ============================================================
// DATA LAYER: session-store.js
// All application state accessed via GKDatabase in-memory cache.
//
// Public API is identical to the previous sql.js version so that
// all callers in app.js, mentor-app.js, and business-logic files
// continue to work without modification.
//
// Design rules:
//   1. Every exported function is synchronous — reads come from _c.
//   2. Writes update _c immediately, then fire GKDatabase._post() async
//      (write-behind / fire-and-forget).
//   3. _triggerSync() is a no-op — the server broadcasts SSE 'update'
//      events to all mentor clients after every write endpoint call.
// ============================================================

const GKStore = (() => {

  // Alias to the shared in-memory cache populated by GKDatabase.init()
  const _c = GKDatabase.getCache();

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** No-op: SSE handles real-time mentor sync server-side. */
  function _triggerSync() {}

  function _post(url, data) { GKDatabase._post(url, data); }

  function _now() { return new Date().toISOString(); }

  function _ensureArr(obj, userId) {
    if (!obj[userId]) obj[userId] = [];
    return obj[userId];
  }

  function _ensureObj(obj, userId) {
    if (!obj[userId]) obj[userId] = {};
    return obj[userId];
  }

  // ── Auth ─────────────────────────────────────────────────────────────────

  function saveCurrentUser(userId) {
    if (!userId) return;
    _c.authSession.userId = userId;
    _post('/api/auth/login', { userId });
  }

  function getCurrentUserId() {
    return _c.authSession.userId || null;
  }

  function clearCurrentUser() {
    const userId = getCurrentUserId();
    _c.authSession.userId = null;
    if (userId && _c.activeSessions[userId]) {
      delete _c.activeSessions[userId];
    }
    _post('/api/auth/logout', { userId });
    _triggerSync();
  }

  // ── User profile ──────────────────────────────────────────────────────────
  // Reconstructs the same shape as the previous sql.js version from cache.

  function getUserProfile(userId) {
    const user = _c.users[userId];
    if (!user) return null;

    const xpData = _c.xp[userId] || { totalXP: 0, level: 1, isPromoted: false, promotedAt: null };

    const completedTopics    = _c.topicCompletions[userId]    || [];
    const stArr              = _c.subtopicCompletions[userId]  || [];
    const completedSubtopics = stArr.map(e => (typeof e === 'string' ? e : e.key));

    const subtopicScores    = _c.subtopicScores[userId]    || {};
    const assessmentAttempts = _c.assessmentAttempts[userId] || {};

    const mentorNotes   = _c.mentorNotes[userId]   || [];
    const mentorRewards = _c.mentorRewards[userId]  || [];

    const locks         = _c.topicLocks[userId]    || {};
    const unlockedTopics = Object.keys(locks).filter(k => !locks[k]);
    const lockedTopics   = Object.keys(locks).filter(k =>  locks[k]);

    const quickCheckResults = _c.quickCheckResults[userId] || [];
    const holisticScores    = _c.holisticScores[userId]    || null;
    const subtopicFeedback  = _c.subtopicFeedback[userId]  || {};
    const moduleFeedback    = _c.moduleFeedback[userId]    || {};
    const overrides         = _c.demoOverrides[userId]     || {};
    const extra             = _c.userExtras[userId]        || {};

    return {
      // Identity
      id:             user.id,
      username:       user.username,
      displayName:    user.displayName,
      grade:          user.grade,
      avatar:         user.avatar,
      photo:          user.photo,
      joinDate:       user.joinDate,
      preferredStyle: user.preferredStyle,
      persona:        user.persona,
      role:           user.role,
      // XP & gamification
      totalXP:    xpData.totalXP,
      level:      xpData.level,
      isPromoted: xpData.isPromoted,
      promotedAt: xpData.promotedAt,
      // Progress
      completedTopics, completedSubtopics,
      subtopicScores, assessmentAttempts,
      // Social & mentor
      mentorNotes, mentorRewards,
      unlockedTopics, lockedTopics,
      quickCheckResults,
      holisticScores,
      subtopicFeedback, moduleFeedback,
      overrides,
      // Extra fields spread last (adminNotes, parentNotes, …)
      ...extra
    };
  }

  // Compatibility shim: routes multi-field blob to server (same as sql.js version did).
  function saveUserProfile(userId, profileData) {
    // --- update local cache ---
    if (profileData.totalXP !== undefined || profileData.level !== undefined ||
        profileData.isPromoted !== undefined || profileData.promotedAt !== undefined) {
      const xp = _c.xp[userId] || { totalXP: 0, level: 1, isPromoted: false, promotedAt: null };
      _c.xp[userId] = {
        totalXP:    profileData.totalXP    ?? xp.totalXP,
        level:      profileData.level      ?? xp.level,
        isPromoted: profileData.isPromoted !== undefined ? !!profileData.isPromoted : xp.isPromoted,
        promotedAt: profileData.promotedAt ?? xp.promotedAt
      };
    }
    if (Array.isArray(profileData.completedTopics)) {
      const arr = _ensureArr(_c.topicCompletions, userId);
      profileData.completedTopics.forEach(t => { if (!arr.includes(t)) arr.push(t); });
    }
    if (Array.isArray(profileData.completedSubtopics)) {
      const arr = _ensureArr(_c.subtopicCompletions, userId);
      const existing = arr.map(e => (typeof e === 'string' ? e : e.key));
      profileData.completedSubtopics.forEach(k => {
        if (!existing.includes(k)) arr.push({ key: k, completedAt: _now() });
      });
    }
    if (profileData.subtopicScores && typeof profileData.subtopicScores === 'object') {
      const sc = _ensureObj(_c.subtopicScores, userId);
      Object.entries(profileData.subtopicScores).forEach(([key, v]) => {
        if (!sc[key] || v.score >= sc[key].score) sc[key] = v;
      });
    }
    if (Array.isArray(profileData.mentorNotes)) {
      _c.mentorNotes[userId] = profileData.mentorNotes;
    }
    if (Array.isArray(profileData.unlockedTopics) || Array.isArray(profileData.lockedTopics)) {
      const locks = {};
      (profileData.unlockedTopics || []).forEach(k => { locks[k] = 0; });
      (profileData.lockedTopics   || []).forEach(k => { locks[k] = 1; });
      _c.topicLocks[userId] = locks;
    }
    if (profileData.holisticScores) {
      _c.holisticScores[userId] = profileData.holisticScores;
    }
    if (profileData.overrides && typeof profileData.overrides === 'object') {
      _c.demoOverrides[userId] = { ...(_c.demoOverrides[userId] || {}), ...profileData.overrides };
    }
    // --- write to server ---
    _post('/api/profile/save', { userId, profileData });
    _triggerSync();
  }

  // ── XP helpers ────────────────────────────────────────────────────────────

  function getTotalXP(userId) {
    return (_c.xp[userId] || {}).totalXP || 0;
  }

  function addXPToUser(userId, xpAmount) {
    const xp = _c.xp[userId] || { totalXP: 0, level: 1, isPromoted: false, promotedAt: null };
    xp.totalXP = (xp.totalXP || 0) + xpAmount;
    _c.xp[userId] = xp;
    _post('/api/xp/add', { userId, amount: xpAmount });
    _triggerSync();
    return xp.totalXP;
  }

  function markTopicComplete(userId, topicId) {
    if (!userId) return;
    const arr = _ensureArr(_c.topicCompletions, userId);
    if (!arr.includes(topicId)) arr.push(topicId);
    _post('/api/progress/topic-complete', { userId, topicId });
    _triggerSync();
  }

  // ── Session ───────────────────────────────────────────────────────────────

  function startSession(userId, moodData) {
    _c.activeSessions[userId] = {
      userId,
      startTime: _now(),
      mood:      moodData || {},
      xpEarned:  0,
      feedbackJson: null
    };
    _post('/api/session/start', { userId, moodData: moodData || {} });
    return getSession();
  }

  function getSession() {
    const userId = getCurrentUserId();
    if (!userId) return null;
    const sess = _c.activeSessions[userId];
    if (!sess) return null;

    const stArr = _c.subtopicCompletions[userId] || [];
    const completedSubtopics = stArr
      .filter(e => {
        const at = typeof e === 'string' ? null : e.completedAt;
        return !at || at >= sess.startTime;
      })
      .map(e => (typeof e === 'string' ? e : e.key));

    // Latest assessment result per topic since session start
    const assessmentResults = {};
    const attempts = _c.assessmentAttempts[userId] || {};
    Object.entries(attempts).forEach(([topicKey, list]) => {
      list.forEach(a => {
        if (a.attemptedAt >= sess.startTime) {
          assessmentResults[topicKey] = {
            score: a.score, total: a.total, percentage: a.percentage
          };
        }
      });
    });

    return {
      userId,
      startTime:          sess.startTime,
      mood:               sess.mood || {},
      xpEarned:           sess.xpEarned || 0,
      completedSubtopics,
      assessmentResults,
      feedback:           sess.feedbackJson ? JSON.parse(sess.feedbackJson) : null
    };
  }

  function updateSession(updates) {
    const userId = getCurrentUserId();
    if (!userId) return {};
    const sess = _c.activeSessions[userId];
    if (!sess) return {};

    if (updates.mood     !== undefined) sess.mood     = updates.mood;
    if (updates.xpEarned !== undefined) sess.xpEarned = updates.xpEarned;
    if (updates.feedback !== undefined) sess.feedbackJson = JSON.stringify(updates.feedback);

    _post('/api/session/update', {
      userId,
      mood:       sess.mood,
      xpEarned:   sess.xpEarned,
      feedback:   updates.feedback
    });
    _triggerSync();
    return getSession();
  }

  function addSessionXP(xpAmount) {
    const userId = getCurrentUserId();
    if (!userId) return 0;
    const sess = _c.activeSessions[userId];
    if (!sess) return 0;
    sess.xpEarned = (sess.xpEarned || 0) + xpAmount;
    _post('/api/session/xp', { userId, amount: xpAmount });
    return sess.xpEarned;
  }

  function recordSubtopicComplete(subtopicId) {
    const sess = getSession();
    if (!sess) return;
    const arr = _ensureArr(_c.subtopicCompletions, sess.userId);
    const existing = arr.map(e => (typeof e === 'string' ? e : e.key));
    if (!existing.includes(subtopicId)) {
      arr.push({ key: subtopicId, completedAt: _now() });
    }
    _post('/api/progress/subtopic-complete', { userId: sess.userId, subtopicKey: subtopicId });
    _triggerSync();
  }

  function recordAssessmentResult(topicId, score, total) {
    const sess = getSession();
    if (!sess) return;
    const userId = sess.userId;
    const pct  = Math.round((score / total) * 100);
    const att  = _ensureObj(_c.assessmentAttempts, userId);
    if (!att[topicId]) att[topicId] = [];
    att[topicId].push({ score, total, percentage: pct, answers: [], attemptedAt: _now() });

    _post('/api/progress/assessment', { userId, topicKey: topicId, score, total, answers: [] });

    if (pct >= 60) {
      markTopicComplete(userId, topicId);
    } else {
      _triggerSync();
    }
  }

  function saveFeedback(feedbackData) {
    const userId = getCurrentUserId();
    if (!userId) return;
    const sess = _c.activeSessions[userId];
    if (sess) sess.feedbackJson = JSON.stringify(feedbackData);
    _post('/api/feedback/session', { userId, feedbackData });
  }

  // ── Session log ───────────────────────────────────────────────────────────

  function logCompletedSession() {
    const sess = getSession();
    if (!sess) return;
    const entry = {
      userId:    sess.userId,
      startTime: sess.startTime,
      endTime:   _now(),
      mood:      sess.mood,
      xpEarned:  sess.xpEarned,
      feedback:  sess.feedback
    };
    _ensureArr(_c.sessionHistory, sess.userId).push(entry);
    delete _c.activeSessions[sess.userId];

    _post('/api/session/log', {
      userId:    sess.userId,
      startTime: sess.startTime,
      mood:      sess.mood,
      xpEarned:  sess.xpEarned,
      feedback:  sess.feedback
    });
  }

  function getSessionHistory(userId) {
    return _c.sessionHistory[userId] || [];
  }

  // ── Mentor helpers ────────────────────────────────────────────────────────

  function getAllStudentProfiles() {
    const all = {};
    (GK_USERS || []).forEach(u => {
      all[u.id] = getUserProfile(u.id) || { ...u, totalXP: 0, completedTopics: [] };
    });
    return all;
  }

  function awardBonusXP(userId, amount, reason) {
    _ensureArr(_c.mentorRewards, userId).push({ amount, reason, awardedAt: _now() });
    _post('/api/mentor/reward', { userId, amount, reason });
    // Also update the XP cache locally
    const xp = _c.xp[userId] || { totalXP: 0, level: 1, isPromoted: false, promotedAt: null };
    xp.totalXP = (xp.totalXP || 0) + amount;
    _c.xp[userId] = xp;
    _triggerSync();
    return xp.totalXP;
  }

  function promoteStudent(userId) {
    const xp = _c.xp[userId] || { totalXP: 0, level: 1, isPromoted: false, promotedAt: null };
    xp.isPromoted = true;
    xp.promotedAt = _now();
    _c.xp[userId] = xp;
    _post('/api/mentor/promote', { userId });
    _triggerSync();
  }

  // ── Topic locks ───────────────────────────────────────────────────────────

  function unlockTopicForStudent(userId, topicKey) {
    _ensureObj(_c.topicLocks, userId)[topicKey] = 0;
    _post('/api/mentor/lock', { userId, topicKey, isLocked: false });
    _triggerSync();
  }

  function lockTopicForStudent(userId, topicKey) {
    _ensureObj(_c.topicLocks, userId)[topicKey] = 1;
    _post('/api/mentor/lock', { userId, topicKey, isLocked: true });
    _triggerSync();
  }

  function getUnlockedTopics(userId) {
    const locks = _c.topicLocks[userId] || {};
    return Object.keys(locks).filter(k => !locks[k]);
  }

  function getLockedTopics(userId) {
    const locks = _c.topicLocks[userId] || {};
    return Object.keys(locks).filter(k =>  locks[k]);
  }

  // ── Mentor notes ──────────────────────────────────────────────────────────

  function addMentorNote(userId, noteData) {
    const id  = 'note_' + Date.now();
    const now = _now();
    const note = { id, ...noteData, read: false, createdAt: now };
    _ensureArr(_c.mentorNotes, userId).push(note);
    _post('/api/mentor/note', { userId, noteData });
    _triggerSync();
    return id;
  }

  function getMentorNotes(userId) {
    return _c.mentorNotes[userId] || [];
  }

  function markMentorNotesRead(userId) {
    (_c.mentorNotes[userId] || []).forEach(n => { n.read = true; });
    _post('/api/mentor/notes-read', { userId });
  }

  function markSpecificMentorNoteRead(userId, noteId) {
    const note = (_c.mentorNotes[userId] || []).find(n => n.id === noteId);
    if (note) note.read = true;
    _post('/api/mentor/note-read', { userId, noteId });
  }

  // ── Detailed assessment attempts ──────────────────────────────────────────

  function saveDetailedAssessmentResult(userId, topicKey, score, total, answers) {
    const pct = Math.round((score / total) * 100);
    const att = _ensureObj(_c.assessmentAttempts, userId);
    if (!att[topicKey]) att[topicKey] = [];
    att[topicKey].push({ score, total, percentage: pct, answers: answers || [], attemptedAt: _now() });
    // Keep last 5
    if (att[topicKey].length > 5) att[topicKey] = att[topicKey].slice(-5);

    _post('/api/progress/assessment', { userId, topicKey, score, total, answers: answers || [] });
    _triggerSync();
  }

  function getAssessmentAttempts(userId, topicKey) {
    const all = _c.assessmentAttempts[userId] || {};
    if (topicKey) return all[topicKey] || [];
    return all;
  }

  // ── Granular feedback ─────────────────────────────────────────────────────

  function saveSubtopicFeedback(userId, topicKey, subtopicKey, feedbackData) {
    const fb = _ensureObj(_c.subtopicFeedback, userId);
    if (!fb[subtopicKey]) fb[subtopicKey] = [];
    fb[subtopicKey].push({ ...feedbackData, savedAt: _now() });
    _post('/api/feedback/subtopic', { userId, topicKey, subtopicKey, feedbackData });
  }

  function saveModuleFeedback(userId, topicKey, feedbackData) {
    const fb = _ensureObj(_c.moduleFeedback, userId);
    if (!fb[topicKey]) fb[topicKey] = [];
    fb[topicKey].push({ ...feedbackData, savedAt: _now() });
    _post('/api/feedback/module', { userId, topicKey, feedbackData });
  }

  // ── Quick-check results ───────────────────────────────────────────────────

  function saveQuickCheckResult(userId, result) {
    const id  = Date.now();
    const now = _now();
    const entry = { ...result, id, submittedAt: now };
    _ensureArr(_c.quickCheckResults, userId).push(entry);
    _post('/api/quickcheck', { userId, result });
    _triggerSync();
  }

  function getQuickCheckResults(userId) {
    return _c.quickCheckResults[userId] || [];
  }

  // ── Mentor review requests ────────────────────────────────────────────────

  function saveMentorReviewRequest(userId, data) {
    const id  = Date.now();
    const now = _now();
    const entry = { ...data, id, userId, read: false, submittedAt: now };
    _ensureArr(_c.reviewRequests, userId).push(entry);
    _post('/api/mentor/review-request', { userId, data });
    _triggerSync();
  }

  function getMentorReviewRequests(userId) {
    return _c.reviewRequests[userId] || [];
  }

  function markReviewRequestRead(userId, requestId) {
    const req = (_c.reviewRequests[userId] || []).find(r => r.id === requestId);
    if (req) req.read = true;
    _post('/api/mentor/review-read', { userId, requestId });
  }

  function clearMentorReviewRequests(userId) {
    _c.reviewRequests[userId] = [];
    _post('/api/mentor/review-clear', { userId });
  }

  function submitMentorEvaluation(userId) {
    clearMentorReviewRequests(userId);
  }

  // ── Topic reset ───────────────────────────────────────────────────────────

  function resetTopics(userId, topicKeys) {
    topicKeys.forEach(tk => {
      const topicId = tk.includes('-') ? tk.split('-').slice(1).join('-') : tk;

      // assessmentAttempts
      const att = _c.assessmentAttempts[userId] || {};
      delete att[tk];

      // topicCompletions
      const tc = _c.topicCompletions[userId] || [];
      _c.topicCompletions[userId] = tc.filter(t => t !== tk);

      // demoOverrides
      const ov = _c.demoOverrides[userId] || {};
      delete ov[tk];

      // subtopicCompletions
      const sc = _c.subtopicCompletions[userId] || [];
      _c.subtopicCompletions[userId] = sc.filter(e => {
        const key = typeof e === 'string' ? e : e.key;
        return !key.startsWith(topicId + '-');
      });

      // subtopicScores
      const ss = _c.subtopicScores[userId] || {};
      Object.keys(ss).forEach(k => { if (k.startsWith(topicId + '-')) delete ss[k]; });

      // quickCheckResults
      const qc = _c.quickCheckResults[userId] || [];
      _c.quickCheckResults[userId] = qc.filter(r => r.topicId !== topicId);
    });
    _post('/api/progress/reset-topics', { userId, topicKeys });
    _triggerSync();
  }

  // ── Full score reset ──────────────────────────────────────────────────────

  function resetAllScores(userId) {
    _c.subtopicScores[userId]      = {};
    _c.subtopicCompletions[userId] = [];
    _c.assessmentAttempts[userId]  = {};
    _c.topicCompletions[userId]    = [];
    _c.quickCheckResults[userId]   = [];
    _c.demoOverrides[userId]       = {};
    _c.mentorRewards[userId]       = [];
    _c.topicLocks[userId]         = {};
    _c.userExtras[userId]         = {};
    _c.reviewRequests[userId]     = [];
    
    // Reset total XP and Level
    _c.xp[userId] = { totalXP: 0, level: 1, isPromoted: false, promotedAt: null };
    
    const sess = _c.activeSessions[userId];
    if (sess) sess.xpEarned = 0;
    
    _post('/api/progress/reset-all', { userId });
    _triggerSync();
  }

  // ── Mentor mood log ───────────────────────────────────────────────────────

  function saveMentorMoodLog(mentorId, moodData) {
    const log = _ensureArr(_c.mentorMoodLog, mentorId);
    log.push({ ...moodData, loggedAt: _now() });
    // Keep last 100
    if (log.length > 100) _c.mentorMoodLog[mentorId] = log.slice(-100);
    _post('/api/mentor/mood', { mentorId, moodData });
  }

  function getMentorMoodLog(mentorId) {
    return _c.mentorMoodLog[mentorId] || [];
  }

  // ── Subtopic scores ───────────────────────────────────────────────────────

  function saveSubtopicScore(userId, subtopicKey, score, total) {
    if (!userId || score === undefined || !total) return;
    const pct = Math.round((score / total) * 100);
    const sc  = _ensureObj(_c.subtopicScores, userId);
    if (!sc[subtopicKey] || score >= sc[subtopicKey].score) {
      sc[subtopicKey] = { score, total, percentage: pct, completedAt: _now() };
    }
    // Also ensure subtopic is in completions
    const arr = _ensureArr(_c.subtopicCompletions, userId);
    const existing = arr.map(e => (typeof e === 'string' ? e : e.key));
    if (!existing.includes(subtopicKey)) {
      arr.push({ key: subtopicKey, completedAt: _now() });
    }
    _post('/api/progress/subtopic-score', { userId, subtopicKey, score, total });
    _triggerSync();
  }

  function getSubtopicScores(userId) {
    return _c.subtopicScores[userId] || {};
  }

  // ── Holistic Quotient ─────────────────────────────────────────────────────

  function saveHolisticScores(userId, data) {
    _c.holisticScores[userId] = { ...data, savedAt: _now() };
    _post('/api/mentor/holistic', { userId, data });
    _triggerSync();
  }

  function getHolisticScores(userId) {
    return _c.holisticScores[userId] || null;
  }

  // ── Extra Persistence (Badges & Streaks) ──────────────────────────────────
  
  function getBadges(userId) {
    const extra = _c.userExtras[userId] || {};
    return extra.badges || [];
  }

  function saveBadges(userId, badges) {
    const extra = _ensureObj(_c.userExtras, userId);
    extra.badges = badges;
    saveUserProfile(userId, { badges });
  }

  function getStreak(userId) {
    const extra = _c.userExtras[userId] || {};
    return extra.streak || { count: 0, lastDate: "" };
  }

  function saveStreak(userId, streakData) {
    const extra = _ensureObj(_c.userExtras, userId);
    extra.streak = streakData;
    saveUserProfile(userId, { streak: streakData });
  }

  // ── Personalized Learning Paths ───────────────────────────────────────────

  /**
   * Returns the active learning path for a student from the local cache.
   * Shape: { pathId, pathName, pathGrade, assignedAt, isActive }
   * or null if no path is assigned.
   */
  function getStudentLearningPath(userId) {
    const assignments = _c.studentLearningPaths[userId] || [];
    return assignments.find(a => a.isActive) || null;
  }

  /**
   * Returns the full path object (with ordered topics[]) for a student
   * by joining their active assignment against the learningPaths cache.
   * Shape: { pathId, pathName, grade, topics: [{topicId, order, required}] }
   */
  function getStudentLearningPathDetails(userId) {
    const assignment = getStudentLearningPath(userId);
    if (!assignment) return null;
    const path = _c.learningPaths[assignment.pathId];
    if (!path) return null;
    return {
      pathId:   path.id,
      pathName: path.name,
      grade:    path.grade,
      topics:   path.topics || []
    };
  }

  /**
   * Returns all learning paths (active + inactive) from cache.
   */
  function getAllLearningPaths() {
    return Object.values(_c.learningPaths);
  }

  /**
   * Returns only the topic IDs in the student's active path, in order.
   * Returns null if no path assigned (meaning show full curriculum).
   */
  function getStudentTopicIds(userId) {
    const details = getStudentLearningPathDetails(userId);
    if (!details) return null;
    return details.topics
      .sort((a, b) => a.order - b.order)
      .map(t => t.topicId);
  }

  /**
   * Topic IDs marked published in the student's active learning path (from SQLite via /api/init).
   * Timetable and schedule only show modules whose topicId is in this set.
   */
  function getPublishedTopicIds(userId) {
    const details = getStudentLearningPathDetails(userId);
    if (!details || !details.topics.length) return null;
    const topics = details.topics;
    const anyExplicit = topics.some(t => t.isPublished === true);
    if (!anyExplicit) {
      return new Set(topics.map(t => t.topicId));
    }
    return new Set(
      topics
        .filter(t => t.isPublished === true)
        .map(t => t.topicId)
    );
  }

  // ── Public API ────────────────────────────────────────────────────────────
  // Identical surface to the previous sql.js version.

  return {
    saveCurrentUser, getCurrentUserId, clearCurrentUser,
    getUserProfile, saveUserProfile,
    getTotalXP, addXPToUser, markTopicComplete,
    startSession, getSession, updateSession, addSessionXP,
    recordSubtopicComplete, recordAssessmentResult, saveFeedback,
    logCompletedSession, getSessionHistory,
    getAllStudentProfiles, awardBonusXP, promoteStudent,
    unlockTopicForStudent, lockTopicForStudent,
    getUnlockedTopics, getLockedTopics,
    addMentorNote, getMentorNotes,
    markMentorNotesRead, markSpecificMentorNoteRead,
    saveDetailedAssessmentResult, getAssessmentAttempts,
    saveSubtopicFeedback, saveModuleFeedback,
    saveQuickCheckResult, getQuickCheckResults,
    saveMentorReviewRequest, getMentorReviewRequests,
    markReviewRequestRead, clearMentorReviewRequests,
    submitMentorEvaluation, resetTopics, resetAllScores,
    saveSubtopicScore, getSubtopicScores,
    saveHolisticScores, getHolisticScores,
    getBadges, saveBadges, getStreak, saveStreak,
    saveMentorMoodLog, getMentorMoodLog,
    getStudentLearningPath, getStudentLearningPathDetails,
    getAllLearningPaths, getStudentTopicIds, getPublishedTopicIds
  };
})();
