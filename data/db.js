// ============================================================
// DATA LAYER: db.js  (client-side)
// In-memory cache populated once from GET /api/init.
//
// GKDatabase singleton:
//   init()     – async; fetch full snapshot from server, populate _c.
//   refresh()  – async; re-fetch and merge (called by mentor SSE handler).
//   _post()    – fire-and-forget write to a server API endpoint.
//   getCache() – returns the raw _c cache object (used by session-store.js).
//
// session-store.js reads all data from _c (synchronous).
// session-store.js writes update _c immediately, then fire _post() async.
// ============================================================

const GKDatabase = (() => {
  // ── Internal cache ────────────────────────────────────────────────────────
  // Populated by init() / refresh(). Structure mirrors the /api/init response.
  const _c = {
    authSession:          { userId: null },
    users:                {},
    xp:                   {},
    activeSessions:       {},
    subtopicCompletions:  {},   // { [userId]: [{key, completedAt}] }
    topicCompletions:     {},   // { [userId]: [topicId] }
    subtopicScores:       {},   // { [userId]: { [subtopicKey]: {score,total,pct,completedAt} } }
    assessmentAttempts:   {},   // { [userId]: { [topicKey]: [attempt] } }
    mentorNotes:          {},   // { [userId]: [note] }
    mentorRewards:        {},   // { [userId]: [reward] }
    topicLocks:           {},   // { [userId]: { [topicKey]: 0|1 } }
    quickCheckResults:    {},   // { [userId]: [result] }
    holisticScores:       {},   // { [userId]: scoresObj | null }
    subtopicFeedback:     {},   // { [userId]: { [subtopicKey]: [fb] } }
    moduleFeedback:       {},   // { [userId]: { [topicKey]: [fb] } }
    demoOverrides:        {},   // { [userId]: { [topicKey]: override } }
    userExtras:           {},   // { [userId]: extraObj }
    sessionHistory:       {},   // { [userId]: [sessionObj] }
    reviewRequests:       {},   // { [userId]: [request] }
    mentorMoodLog:        {},   // { [mentorId]: [moodObj] }
    learningPaths:        {},   // { [pathId]: { id, name, grade, topics[], ... } }
    studentLearningPaths: {},   // { [userId]: [{ pathId, pathName, isActive, ... }] }
    branding:             null   // white-label from config/branding.json

  };

  let _ready = false;

  // ── Merge snapshot from server into _c ───────────────────────────────────

  function _merge(snapshot) {
    Object.assign(_c.authSession,        snapshot.authSession        || {});
    Object.assign(_c.users,              snapshot.users              || {});
    Object.assign(_c.xp,                 snapshot.xp                 || {});
    Object.assign(_c.activeSessions,     snapshot.activeSessions     || {});

    // Per-user keyed data: replace entirely so deleted entries are removed
    // (Object.assign won't remove keys that the server no longer returns)
    _replaceKeys(_c.subtopicCompletions, snapshot.subtopicCompletions || {});
    _replaceKeys(_c.topicCompletions,    snapshot.topicCompletions    || {});
    _replaceKeys(_c.subtopicScores,      snapshot.subtopicScores      || {});
    _replaceKeys(_c.assessmentAttempts,  snapshot.assessmentAttempts  || {});
    _replaceKeys(_c.mentorNotes,         snapshot.mentorNotes         || {});
    _replaceKeys(_c.mentorRewards,       snapshot.mentorRewards       || {});
    _replaceKeys(_c.topicLocks,          snapshot.topicLocks          || {});
    _replaceKeys(_c.quickCheckResults,   snapshot.quickCheckResults   || {});
    _replaceKeys(_c.holisticScores,      snapshot.holisticScores      || {});
    _replaceKeys(_c.subtopicFeedback,    snapshot.subtopicFeedback    || {});
    _replaceKeys(_c.moduleFeedback,      snapshot.moduleFeedback      || {});
    _replaceKeys(_c.demoOverrides,       snapshot.demoOverrides       || {});
    _replaceKeys(_c.userExtras,          snapshot.userExtras          || {});
    _replaceKeys(_c.sessionHistory,      snapshot.sessionHistory      || {});
    _replaceKeys(_c.reviewRequests,      snapshot.reviewRequests      || {});
    _replaceKeys(_c.mentorMoodLog,       snapshot.mentorMoodLog       || {});
    Object.assign(_c.learningPaths,        snapshot.learningPaths        || {});
    Object.assign(_c.studentLearningPaths, snapshot.studentLearningPaths || {});
    if (snapshot.branding) {
      _c.branding = snapshot.branding;
      if (typeof GKBranding !== 'undefined') GKBranding.initFromSnapshot(snapshot);
    }

  }

  /** Replace all keys in target with source, removing stale entries. */
  function _replaceKeys(target, source) {
    // Remove keys no longer present in the server snapshot
    for (const k of Object.keys(target)) {
      if (!(k in source)) delete target[k];
    }
    // Copy in all current values
    Object.assign(target, source);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Call once before app code runs. Fetches full state from server. */
  function _showServerUnavailable(reason) {
    const el = document.getElementById('app');
    if (!el) return;
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:2rem;font-family:'Plus Jakarta Sans',system-ui,sans-serif;text-align:center;color:#1A2329;max-width:32rem;margin:0 auto;">
        <p style="font-size:2rem;margin:0 0 0.5rem;">🕉️</p>
        <h1 style="font-size:1.25rem;margin:0 0 0.75rem;">Cannot reach the Gurukul server</h1>
        <p style="color:#5A6772;line-height:1.5;margin:0 0 1.25rem;">${reason}</p>
        <p style="font-size:0.9rem;color:#5A6772;line-height:1.5;margin:0;">Start the server:<br><code style="display:inline-block;margin-top:0.5rem;padding:0.35rem 0.6rem;background:#EDF3F6;border-radius:6px;">cd wizkids && npm start</code><br>Or use Docker on port 3000. If port 3000 is busy, run <code style="padding:0.2rem 0.4rem;background:#EDF3F6;border-radius:4px;">PORT=3001 npm start</code>.<br>Open <a href="/student.html">http://localhost:3000/student.html</a> (not file://).</p>
      </div>`;
  }

  async function init() {
    if (_ready) return;
    try {
      const res = await fetch('/api/init');
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}. Start the app with npm start in the wizkids folder.`);
      }
      const snapshot = await res.json();
      if (snapshot && snapshot.ok === false) {
        throw new Error(snapshot.error || 'Server error');
      }

      _merge(snapshot);
      _ready = true;
      console.log('[GKDatabase] cache loaded from server');
    } catch (e) {
      console.error('[GKDatabase] init failed — app may not work correctly:', e);
      _showServerUnavailable(e.message || 'Network error');

    }
  }

  /**
   * Re-fetch full snapshot from server and merge into cache.
   * Called by mentor-app.js EventSource 'update' handler so the mentor
   * sees fresh student data after any write by a student client.
   */
  async function refresh() {
    try {
      const res      = await fetch('/api/init');
      const snapshot = await res.json();
      _merge(snapshot);
    } catch (e) {
      console.warn('[GKDatabase] refresh failed:', e);
    }
  }

  /**
   * Fire-and-forget POST to a server API endpoint.
   * session-store.js calls this after updating the local cache.
   * Returns the fetch Promise so callers can await if needed (they usually don't).
   */
  function _post(url, data) {
    return fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(data)
    }).catch(e => console.warn('[GKDatabase] write error:', url, e));
  }

  /** Returns the raw cache object. Used exclusively by session-store.js. */
  function getCache() { return _c; }

  return { init, refresh, _post, getCache };
})();
