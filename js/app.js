// ============================================================
// UI LAYER: app.js
// Main SPA controller. Handles routing, screen rendering,
// and wiring UI events to business logic modules.
// ============================================================

// ── Krishna Voice Engine moved to js/voice-engine.js ────────

// ── Confetti burst (purely visual, no logic change) ─────────
function gkConfetti(count) {
  const colors = ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8'];
  const shapes = ['🌟', '✨', '⭐', '💫', '🎊', '🎉', '🪷', '🌸'];
  for (let i = 0; i < (count || 18); i++) {
    setTimeout(() => {
      const el = document.createElement('div');
      el.style.cssText = `
        position:fixed; top:${10 + Math.random() * 30}vh; left:${Math.random() * 100}vw;
        font-size:${1 + Math.random() * 1.2}rem; pointer-events:none; z-index:99999;
        animation: gk-lotusFloat ${1800 + Math.random() * 1400}ms ease-out both;
        will-change:transform,opacity;
      `;
      el.textContent = shapes[Math.floor(Math.random() * shapes.length)];
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 3200);
    }, i * 55);
  }
}

const GKApp = (() => {

  // ---- Application State ----
  const state = {
    user: null,
    activeNotification: null,
    mood: null,
    calibration: null,
    _topicStartTime: null,
    _topicWarningSent: false,
    modules: [],
    activeModuleIdx: 0,
    activeSubjectId: null,
    activeTopicId: null,
    activeSubtopicIdx: 0,
    conceptIdx: 0,
    moodPhase: 'inputs', // 'inputs' or 'game'
    isDragging: false,
    _selectedVibe: null,
    phase: 'concepts',     // 'concepts' | 'game' | null
    lessonPhase: null,     // hook | concept | deep-dive | project (API lesson flow)
    _lessonFlowMode: null, // 'light' | 'final' while in assessment step of flow
    gameState: {},
    assessmentTopicId: null,
    sessionXP: 0,
    currentScreen: 'login',
    subtopicFeedbackResponses: {},    // for subtopic feedback form
    moduleFeedbackResponses: {},      // for module feedback form
    feedbackResponses: {},            // for end-of-session feedback
    _pendingSubtopicKey: null,        // which subtopic triggered feedback
    _pendingTopicKey: null,           // which topic triggered module feedback
    _afterSubtopicFeedback: null,     // callback screen after subtopic feedback
    _afterModuleFeedback: null,       // callback screen after module feedback
    expandedDoneModules: new Set(),   // tracks which completed chips are expanded
    expandedLessonSubjectId: null,     // tracks which lesson summary card is expanded
    optionalSubtopicsExpanded: false, // whether optional subtopics panel is open
    expandedSubtopicIdx: 0,           // which subtopic row is expanded in classroom view
    ttFlexOrder: null,                // legacy horizontal timetable (unused)
    ttDragSrc: null,
    verticalSchedule: null,           // [{ type, subjectId?, topicId?, startLabel }]
    verticalDragSrc: null,
    verticalDropTarget: null,
    verticalDragCommitted: false,
    verticalSuppressClick: false,
    vschedDidMove: false,             // pointer drag moved (suppress row click)
    _idleTimer: null,                 // for 5-minute assessment reminder
    _topicTimer: null,                // for 3-minute "2 mins left" message
    _lastAssessmentScore: null,       // track for retry logic
    isMirror: false,                   // track if screen is viewed via mentor mirror
    seenConcepts: new Set(),          // track which concepts earned XP in this session
    sidebarCollapsed: true,           // true = menu hidden, Krishna visible
    sidebarSubjectsExpanded: true,    // subjects list expanded inside open menu
    activeSidebarSubjectId: null,     // highlighted subject in sidebar
    modulesBackScreen: 'ancientGame',  // onboarding back target from Today's Schedule
    aiAssistantId: 'krishna'           // selected AI guide: krishna | radha | rama | hanuman
  };

  // Quick-check modal state (lives outside `state` to avoid triggering render)
  let _quickCheck = null; // { topicName, questions, answers, submitted }

  const _spokenScreens = new Set();

  // ---- Navigation ----
  function navigate(screen) {
    _collapseSidebarState();
    const from = state.currentScreen;
    if (screen === 'modules' && (from === 'ancientGame' || from === 'mood')) {
      state.modulesBackScreen = from;
    }
    state.currentScreen = screen;
    // Reset mood phase when navigating to mood screen
    if (screen === 'mood') {
      state.moodPhase = 'inputs';
    }

    // Clear existing idle timer
    if (state._idleTimer) {
      clearTimeout(state._idleTimer);
      state._idleTimer = null;
    }
    // Clear existing topic timer and reset warning state
    if (state._topicTimer) {
      clearTimeout(state._topicTimer);
      state._topicTimer = null;
    }
    state._topicStartTime = null;
    state._topicWarningSent = false;


    render();
    window.scrollTo(0, 0);

    const m = (state.modules && state.modules[state.activeModuleIdx]) ? state.modules[state.activeModuleIdx] : null;

    // Speak Krishna's message — use plain text (not htmlContent) so buttons aren't read aloud
    const _voiceMsg = state.activeNotification
      ? (state.activeNotification.text || '')
      : krishnaInitiatorFor(screen);
    GKVoice.speak(_voiceMsg);

    // Set idle timer for 5 mins in learning/subtopics to remind about assessment
    if (screen === 'learning' || screen === 'subtopics') {
      state._idleTimer = setTimeout(() => {
        if (state.currentScreen === 'learning' || state.currentScreen === 'subtopics') {
          // Automatic voice reminders removed as per user request
        }
      }, 5 * 60 * 1000); // 5 minutes
    }

    // Push live state to server so mentor mirror reflects this navigation
    _pushLiveState();

    // Start topic timer when entering 'learning' screen
    if (screen === 'learning') {
      state._topicStartTime = Date.now();
      state._topicWarningSent = false;
    }

    // Award XP for the first concept when entering 'learning' screen
    if (screen === 'learning' && state.phase === 'concepts') {
      const m = state.modules[state.activeModuleIdx];
      const conceptKey = `${m.subjectId}-${m.topicId}-${state.activeSubtopicIdx}-${state.conceptIdx}`;
      if (!state.seenConcepts.has(conceptKey)) {
        const xp = GKXPManager.awardXP(state.user.id, 'conceptRead');
        if (xp > 0 && state.user) state.user.totalXP = (state.user.totalXP || 0) + xp;
        state.seenConcepts.add(conceptKey);
      }
    }
  }

  // ── Live state broadcaster ────────────────────────────────────────────────
  // Fire-and-forget: pushes current UI state to server so mentor mirror can
  // apply it directly (no iframe reload, no black flash).
  function _pushLiveState() {
    if (state.isMirror || !state.user) return;
    console.log('[GKLive] push →', state.currentScreen, 'module:', state.activeModuleIdx, 'subtopic:', state.activeSubtopicIdx, 'concept:', state.conceptIdx);
    GKDatabase._post('/api/live-state', {
      userId: state.user.id,
      liveState: {
        screen:           state.currentScreen,
        activeModuleIdx:  state.activeModuleIdx,
        activeTopicId:    state.activeTopicId,
        activeSubjectId:  state.activeSubjectId,
        activeSubtopicIdx: state.activeSubtopicIdx,
        conceptIdx:       state.conceptIdx,
        phase:            state.phase,
        assessmentTopicId: state.assessmentTopicId,
        moodPhase:        state.moodPhase
      }
    });
  }

  // ---- Root Render ----
  const SCREENS = {
    login: renderLogin,
    mood: renderMood,
    ancientGame: renderAncientGame,
    modules: renderModules,
    subtopics: renderSubtopics,
    learning: renderLearning,
    assessment: renderAssessment,
    subtopicFeedback: renderSubtopicFeedback,
    moduleFeedback: renderModuleFeedback,
    feedback: renderFeedback
  };

  function render() {
    // Prevent DOM reset during sensitive operations (like drag and drop) to avoid "Node not found" errors
    if (state.isDragging) return;

    const app = document.getElementById('app');
    const renderer = SCREENS[state.currentScreen] || renderLogin;
    app.innerHTML = `
      ${renderer()}
      <!-- Notifications Overlay -->
      <div id="notif-overlay" class="notif-overlay" style="display:none;" onclick="if(event.target===this) GKApp.toggleNotifications()">
        <div class="notif-panel">
          <div class="notif-header">
            <h3>🔔 Guru Messages</h3>
            <button class="btn btn-ghost btn-sm" onclick="GKApp.toggleNotifications()">✕</button>
          </div>
          <div class="notif-list" id="notif-list">
            <!-- Populated dynamically -->
          </div>
        </div>
      </div>
    `;
    attachEvents(state.currentScreen);
    _bindSidebarDismissListeners();

    // Re-apply mood phase state if we are on the mood screen
    if (state.currentScreen === 'mood' && state.moodPhase === 'game') {
      const inputsEl = document.getElementById('mood-inputs-section');
      const gameEl = document.getElementById('mood-game-section');
      if (inputsEl) inputsEl.style.display = 'none';
      if (gameEl) gameEl.style.display = 'block';
    }
  }

  // ---- Krishna Contextual Initiator ----
  function krishnaInitiatorFor(screen, topicName = '') {
    const name = state.user ? state.user.displayName : 'Student';

    const messages = {
      login: 'Namaste! Enter your name to begin the sacred journey \ud83d\ude4f',
      mood: `Hey ${name}! Let us quickly do a mood check \ud83c\udf38`,
      ancientGame: `Ready for today's learning journey, ${name}? \ud83c\udf38`,
      modules: `How can I help you today, ${name}? \ud83d\ude4f`,
      subtopics: () => {
        const m = state.modules ? state.modules[state.activeModuleIdx] : null;
        if (!m) return "Let's explore this topic! \ud83d\udcda";
        const topicData = GKRecommender.getTopicData(m.subjectId, m.topicId);
        if (!topicData) return "Let's explore this topic! \ud83d\udcda";
        const completedSubtopics = (GKStore.getSession() || {}).completedSubtopics || [];
        const mandatorySts = topicData.topic.subtopics.filter(st => st.mandatory !== false);
        const doneCount = mandatorySts.filter(st => completedSubtopics.includes(m.topicId + '-' + st.id)).length;
        const totalCount = mandatorySts.length;
        const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

        if (pct === 100) return `Wonderful! You've mastered ${topicData.topic.name}! \ud83c\udfc6`;
        if (pct >= 50) return `Great progress on ${topicData.topic.name}! Keep going, you're halfway there! \ud83d\udd25`;
        return `Let's explore ${topicData.topic.name} together. Take it one step at a time! \ud83c\udf1f`;
      },
      learning: `Focus well, ${name}. Knowledge is the greatest treasure! \ud83d\udcd6`,
      assessment: `You've got this, ${name}! Show what you've learned! \u26a1`,
      feedback: 'Your voice matters! Share how you felt about this journey.',
      summary: `Wonderful session, ${name}! 🌟 Come back tomorrow for more!`,
      subtopicFeedback: () => {
        const xp = state._lastXpEarned || 0;
        return `You gained ${xp} XP! See Moksha Patam for your progress. 🕉️`;
      },
      moduleFeedback: 'Share your thoughts on this module — it helps us improve!',
      reviewRequest: '🙏 Your reflection has been submitted! Now go to your Guru for review and blessings.'
    };

    // If there's an active notification (mentor note or XP prize), show it!
    if (state.activeNotification) {
      return state.activeNotification.htmlContent || state.activeNotification.text;
    }

    // Custom logic for retry suggestion on feedback pages
    if ((screen === 'moduleFeedback' || screen === 'feedback' || screen === 'subtopicFeedback') && state._lastAssessmentScore !== null) {
      if (state._lastAssessmentScore < 60) {
        return `I noticed some struggles with the assessment, ${name}. Why don't you retry it? Perseverance is the key to wisdom! \ud83c\udf38`;
      } else {
        return `Excellent work on the assessment, ${name}! Your dedication shines brightly. Keep up the great work! ✨`;
      }
    }

    const msgSource = messages[screen] || messages.modules;
    return (typeof msgSource === 'function') ? msgSource() : msgSource;
  }

  function _assistantAvatarImg(screen, className) {
    const av = GKAssistant.avatarUrlForScreen(screen, {
      activeNotificationXp: !!(state.activeNotification && state.activeNotification.text && state.activeNotification.text.includes('XP'))
    });
    const cls = className || 'agent-avatar';
    return `<img src="${av.src}" alt="${av.alt}" class="${cls}" onerror="this.onerror=null;this.src='${av.fallback}'" />`;
  }

  function _assistantName() {
    return GKAssistant.getSelected().name;
  }

  function krishnaAvatarFor(screen) {
    const av = GKAssistant.avatarUrlForScreen(screen, {
      activeNotificationXp: !!(state.activeNotification && state.activeNotification.text && state.activeNotification.text.includes('XP'))
    });
    return av.src.replace(/^img\//, '').split('?')[0];
  }

  function selectAssistant(id) {
    if (!_canPickAssistant()) return;
    if (!GKAssistant.setSelected(id)) return;
    state.aiAssistantId = GKAssistant.getSelectedId();
    render();
  }

  /** AI guide picker is admin-only; students and mentors use the configured default. */
  function _canPickAssistant() {
    if (state.isMirror) return false;
    const role = state.user && state.user.role;
    return role === 'SME' || role === 'Admin' || role === 'Administrator';
  }

  function _syncAssistantForUser(userId) {
    GKAssistant.init(userId || null);
    state.aiAssistantId = GKAssistant.getSelectedId();
  }

  function _agentHtml(screen, options = {}) {
    if (screen === 'login') return ''; // Krishna should not be shown on the login page
    const msg = krishnaInitiatorFor(screen);
    const hasBg = false;
    const embedded = !!options.embedded;
    const paneClasses = [
      'agent-left-pane',
      embedded ? 'agent-embedded' : '',
      hasBg ? 'has-agent-bg' : ''
    ].filter(Boolean).join(' ');

    return `
      <div class="${paneClasses}" id="krishna-agent-pane">
        <div class="dhyana-backdrop" onclick="GKApp.toggleDhyanaMode()"></div>
        <div class="agent-inner-presence">
          <div class="dhyana-header-glow"></div>
          <div class="agent-avatar-wrap" onclick="GKApp.toggleDhyanaMode()" title="Enter Dhyana Mode">
            <div class="prana-pulse" id="krishna-prana-pulse"></div>
            ${_assistantAvatarImg(screen)}
          </div>

          <div class="agent-speech-bubble" onclick="GKApp.toggleDhyanaMode()">
            <div class="bubble-content" id="krishna-bubble-content">
              ${GKApp.parseMD(msg)}
            </div>
            <div class="bubble-actions">
              <button class="dhyana-expand-btn" title="Expand for Deep Focus">⛶</button>
              <button class="gk-voice-toggle" onclick="event.stopPropagation(); GKVoice.toggle(this)" title="Toggle ${_assistantName()} voice"
                style="background:none;border:none;cursor:pointer;font-size:1.1rem;opacity:0.65;padding:0.15rem 0.3rem;line-height:1;" aria-label="Toggle voice">${GKVoice.isEnabled() ? '🔊' : '🔇'}</button>
            </div>
          </div>

          <div class="agent-inline-chat" style="margin-top: 15px;">
            <input type="text" id="agent-query-input" class="agent-inline-input" placeholder="Ask ${_assistantName()}…"
              onkeydown="if(event.key==='Enter') { event.stopPropagation(); GKApp.sendAgentQuery(); }" onclick="event.stopPropagation();">
            <button class="agent-inline-send" onclick="event.stopPropagation(); GKApp.sendAgentQuery()" title="Send">
              <svg viewBox="0 0 24 24" width="16" height="16" style="flex-shrink: 0;"><path fill="currentColor" d="M2.01 21L23 12L2.01 3L2 10l15 2l-15 2z"/></svg>
            </button>
          </div>
          <button class="dhyana-close-btn" onclick="event.stopPropagation(); GKApp.toggleDhyanaMode()" title="Close Dhyana Mode">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>`;
  }

  function _scheduleBackBtnHtml() {
    return `<button type="button" class="schedule-back-btn" onclick="GKApp.backToSchedule()"
      title="Back to Today's Schedule" aria-label="Back to Today's Schedule">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
    </button>`;
  }

  /** Icon-only back control for onboarding flow (tooltip on hover). */
  function _flowBackBtnIcon(tooltip, handlerName) {
    const tip = String(tooltip).replace(/"/g, '&quot;');
    return `<button type="button" class="schedule-back-btn flow-back-btn-icon" onclick="GKApp.${handlerName}()"
      title="${tip}" aria-label="${tip}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
    </button>`;
  }

  function backToHomePage() {
    window.location.href = 'start.html';
  }

  function _resetMoodInputsView() {
    state.moodPhase = 'inputs';
    const inputsEl = document.getElementById('mood-inputs-section');
    const gameEl = document.getElementById('mood-game-section');
    if (inputsEl) inputsEl.style.display = 'block';
    if (gameEl) gameEl.style.display = 'none';
  }

  function backToLogin() {
    _resetMoodInputsView();
    state.aiMessages = [];
    navigate('login');
  }

  function backFromMood() {
    const gameEl = document.getElementById('mood-game-section');
    if (gameEl && gameEl.style.display !== 'none') {
      _resetMoodInputsView();
      render();
      return;
    }
    backToLogin();
  }

  function backFromSchedule() {
    const dest = state.modulesBackScreen || 'ancientGame';
    if (dest === 'mood') {
      _resetMoodInputsView();
    }
    navigate(dest);
  }

  function backFromAncientGame() {
    _resetMoodInputsView();
    navigate('mood');
  }

  /** Back arrow in top header, immediately left of the profile avatar. */
  function _headerWithBack(tooltip, handlerName) {
    return renderHeader(true, true, _flowBackBtnIcon(tooltip, handlerName));
  }

  /** Compact chat column for lesson flow (no avatar/header; message + ask input). */
  function renderCompactAgentPane(screen) {
    const msg = krishnaInitiatorFor(screen);
    const guideName = _assistantName();

    return `
      <aside class="learning-chat-pane chat-pane agent-left-pane agent-session-pane agent-session-pane-compact" id="krishna-agent-pane">
        <div class="dhyana-backdrop" onclick="GKApp.toggleDhyanaMode()"></div>
        <div class="chat-stream learning-chat-stream-compact">
          <div class="msg prajna msg-compact">
            <div class="msg-body">
              <div class="bubble agent-speech-bubble" onclick="GKApp.toggleDhyanaMode()">
                <div class="bubble-content" id="krishna-bubble-content">${GKApp.parseMD(msg)}</div>
                <div class="bubble-actions">
                  <button type="button" class="dhyana-expand-btn" title="Expand for Deep Focus">⛶</button>
                  <button type="button" class="gk-voice-toggle" onclick="event.stopPropagation(); GKVoice.toggle(this)" title="Toggle ${guideName} voice"
                    style="background:none;border:none;cursor:pointer;font-size:1.1rem;opacity:0.65;padding:0.15rem 0.3rem;line-height:1;" aria-label="Toggle voice">${GKVoice.isEnabled() ? '🔊' : '🔇'}</button>
                </div>
              </div>
              <div class="msg-meta">${guideName} · your guide</div>
            </div>
          </div>
        </div>
        <footer class="chat-input learning-chat-input">
          <div class="input-row agent-inline-chat">
            <input type="text" id="agent-query-input" class="agent-inline-input" placeholder="Type your question here…"
              onkeydown="if(event.key==='Enter') { event.stopPropagation(); GKApp.sendAgentQuery(); }" onclick="event.stopPropagation();">
            <button type="button" class="send-btn agent-inline-send" onclick="event.stopPropagation(); GKApp.sendAgentQuery()" title="Send" aria-label="Send">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M2.01 21L23 12L2.01 3L2 10l15 2l-15 2z"/></svg>
            </button>
          </div>
          <div class="input-hint">
            <span>Press Enter to send</span>
          </div>
        </footer>
        <button type="button" class="dhyana-close-btn" onclick="event.stopPropagation(); GKApp.toggleDhyanaMode()" title="Close Dhyana Mode">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
        <div class="dhyana-header-glow"></div>
      </aside>`;
  }

  /** EdVantage-style chat column for the learning session (Krishna / Prajna pane). */
  function renderLearningAgentPane(screen, m, topic, subtopic) {
    return renderCompactAgentPane('learning');
  }

  function _renderLessonFlowAssessmentShell(agentScreen, bodyHtml) {
    return `
      <div class="screen screen-assessment lesson-session-active">
        ${renderHeader()}
        <div class="learning-session">
          ${renderCompactAgentPane(agentScreen)}
          <div class="learning-workspace-pane workspace-pane">
            <div class="ws-body">
              ${bodyHtml}
            </div>
          </div>
        </div>
      </div>`;
  }

  // ---- SCREEN 1: Login ----
  function renderLogin() {
    return `
      <div class="screen screen-login">
        ${renderHeader(false, false)}
        <div class="login-center-wrapper">
          <div class="login-card" style="width: 100%; max-width: 420px; margin: 0 auto;">
              <div class="login-logo" style="text-align: center; margin-bottom: 0.8rem;">
                <img src="${GKBranding.logoPath()}" alt="${GKBranding.schoolName()}" style="width:50px; height:auto; margin: 0 auto 0.4rem auto; display: block;" />
                <h1 class="logo-title" style="font-size: 1.5rem; margin-bottom: 0.2rem; color: #6B3F1A;">${GKBranding.schoolName()}</h1>
                <p class="logo-subtitle" style="font-size: 0.8rem; color: #888;">${GKBranding.loginSubtitle()}</p>
              </div>
              <form id="login-form" class="login-form">
                <div class="form-group">
                  <label for="username">Username</label>
                  <input type="text" id="username" placeholder="Enter your username" autocomplete="off" />
                </div>
                <div class="form-group">
                  <label for="password">Password</label>
                  <input type="password" id="password" placeholder="Enter your password" />
                </div>
                <div id="login-error" class="error-msg hidden"></div>
                <button type="submit" class="btn btn-primary btn-full">${GKBranding.loginButtonText()}</button>
              </form>

              <!-- Student credentials reference — tap a row to auto-fill -->
              <div class="login-creds-panel">
                <div class="login-creds-title">👆 Tap your name to fill in credentials</div>
                <div class="login-creds-grid">
                  ${GK_USERS.map(u => `
                    <div class="login-cred-row" onclick="
                      document.getElementById('username').value='${u.username}';
                      document.getElementById('password').value='${u.password}';
                      document.getElementById('login-error').classList.add('hidden');
                    ">
                      <span class="login-cred-avatar">${u.avatar}</span>
                      <div class="login-cred-info">
                        <span class="login-cred-name">${u.displayName}</span>
                        <span class="login-cred-user">${u.username} &nbsp;/&nbsp; ${u.password}</span>
                      </div>
                      <span class="login-cred-arrow">→</span>
                    </div>`).join('')}
                </div>
              </div>
          </div>
        </div>
      </div>`;
  }

  // ---- SCREEN 2: Mood Check ----
  function renderMood() {
    if (!state._selectedVibe) state._selectedVibe = 'high_energy';
    return `
      <div class="screen screen-mood">
        ${_headerWithBack('Back to previous page', 'backFromMood')}
        <div class="screen-agent-row">
          ${_agentHtml('mood')}
          <div class="agent-pane-spacer"></div>
          <div class="mood-center-wrapper" style="flex:1; display:flex; align-items:center; justify-content:center; padding:1rem;">
            <div class="mood-card">

              <!-- PHASE 1: Mood inputs -->
              <div id="mood-inputs-section">
                <div class="mood-section">
                  <label class="mood-label" style="align-items: center; justify-content: flex-start; margin-bottom: 0.4rem;">
                    <span>🔋 Brain Battery</span>
                  </label>
                  <div style="text-align: left; margin-bottom: 0.5rem;">
                    <span id="battery-text-desc" style="font-size:0.85rem; color:#F57C00; font-weight:600;">Ready for a challenge!</span>
                  </div>
                  <input type="range" id="brain-battery" min="0" max="100" value="70"
                    class="battery-slider" oninput="GKApp.updateBattery(this.value)" />
                  <div class="battery-track" style="justify-content: space-between; margin-top: 0.4rem;">
                    <span style="font-weight: bold; color: #888;">0%</span>
                    <span style="font-weight: bold; color: #888;">100%</span>
                  </div>
                </div>
                <div class="mood-section">
                  <label class="mood-label">Current Vibe</label>
                  <div class="vibe-options" id="vibe-options">
                    ${Object.entries(GKMoodEngine.VIBE_LABELS).map(([key, val]) => `
                      <button class="vibe-btn ${key === 'high_energy' ? 'selected' : ''}"
                        data-vibe="${key}" onclick="GKApp.selectVibe('${key}')">
                        <span class="vibe-emoji">${val.emoji}</span>
                        <span class="vibe-label">${val.label}</span>
                      </button>`).join('')}
                  </div>
                </div>
                <div class="mood-action-row">
                  <button class="btn btn-outline mood-action-btn" onclick="GKApp.submitMood()">
                    🎮 Play
                  </button>
                  <button class="btn btn-primary mood-action-btn" onclick="GKApp.skipToLearning()">
                    Start Learning →
                  </button>
                </div>
              </div>

              <!-- PHASE 2: Inline game -->
              <div id="mood-game-section" style="display:none;">
                <div id="mood-game-host"></div>
              </div>
            </div>
          </div>
        </div>
      </div>`;
  }

  // ---- SCREEN 2b: Moksha Patam — Ancient Board Game ----
  // Moksha Patam (Snakes & Ladders originated in ancient India)
  // Board is 5x5 = 25 cells. Student token moves based on XP earned.
  // Ladders = topic mastery bonuses. Snakes = challenges to overcome.

  const MOKSHA_BOARD = {
    size: 25,
    cols: 5,
    // Ladders: from -> to (Virtues that lift you)
    ladders: {
      3: { to: 12, virtue: 'Vidya (Knowledge)' },
      7: { to: 16, virtue: 'Shraddha (Faith)' },
      11: { to: 19, virtue: 'Tapas (Dedication)' },
      15: { to: 23, virtue: 'Dharma (Righteousness)' }
    },
    // Snakes: from -> to (Vices that pull you down)
    snakes: {
      14: { to: 6, vice: 'Alasya (Laziness)' },
      20: { to: 10, vice: 'Ahamkara (Ego)' },
      24: { to: 17, vice: 'Krodha (Anger)' }
    },
    // Cell themes
    cellThemes: {
      1: '\ud83c\udf3f Start', 5: '\ud83d\udcda', 9: '\ud83e\uddd8', 13: '\ud83d\udd2e',
      18: '\ud83c\udf1f', 21: '\ud83c\udfaf', 25: '\ud83c\udfc6 Moksha!'
    }
  };

  function _getMokshaPosition(userId) {
    return parseInt(localStorage.getItem('gk_moksha_pos_' + userId) || '1');
  }

  function _setMokshaPosition(userId, pos) {
    localStorage.setItem('gk_moksha_pos_' + userId, Math.min(Math.max(pos, 1), 25).toString());
  }

  function _getMokshaHistory(userId) {
    return JSON.parse(localStorage.getItem('gk_moksha_history_' + userId) || '[]');
  }

  function _addMokshaHistory(userId, entry) {
    const h = _getMokshaHistory(userId);
    h.push({ ...entry, time: Date.now() });
    if (h.length > 20) h.shift();
    localStorage.setItem('gk_moksha_history_' + userId, JSON.stringify(h));
  }

  function renderAncientGame() {
    const user = state.user;
    const totalXP = GKStore.getTotalXP(user.id);
    const level = GKXPManager.getLevelForXP(totalXP);
    const nextLevel = GKXPManager.getNextLevel(totalXP);
    const progress = GKXPManager.getProgressToNext(totalXP);
    const streak = GKXPManager.getStreak(user.id);
    const earnedBadgeIds = GKXPManager.getBadges(user.id);
    const allBadges = GKXPManager.BADGES();
    const completedModules = state.modules.filter(m => _isModuleDoneInSession(m));

    const playerPos = _getMokshaPosition(user.id);

    // Sync position with XP (every 40 XP = 1 cell advance, max 25)
    const xpBasedPos = Math.min(25, 1 + Math.floor(totalXP / 40));
    if (xpBasedPos > playerPos) {
      _setMokshaPosition(user.id, xpBasedPos);
    }
    const currentPos = _getMokshaPosition(user.id);

    GKXPManager.checkAndAwardBadges(user.id);

    // Build the 5x5 board (numbered bottom-left to top-right, snake-style)
    const boardCells = [];
    for (let row = 4; row >= 0; row--) {
      const rowCells = [];
      for (let col = 0; col < 5; col++) {
        // Boustrophedon (snake) numbering
        const cellNum = (row % 2 === 0)
          ? (4 - row) * 5 + col + 1    // left-to-right for even rows from bottom
          : (4 - row) * 5 + (4 - col) + 1; // right-to-left for odd rows
        rowCells.push(cellNum);
      }
      boardCells.push(rowCells);
    }

    // Correct boustrophedon: row 0 (bottom) = 1-5 L-R, row 1 = 10-6 R-L, etc.
    const board = [];
    for (let row = 0; row < 5; row++) {
      const cells = [];
      for (let col = 0; col < 5; col++) {
        const r = 4 - row; // flip: top row in display = highest numbers
        const cellNum = (r % 2 === 0)
          ? r * 5 + col + 1
          : r * 5 + (4 - col) + 1;
        cells.push(cellNum);
      }
      board.push(cells);
    }

    // Build progress strip dots
    const avatarEmoji = (user.avatar || '🌟');
    const progressDots = Array.from({ length: 25 }, (_, i) => {
      const pos = i + 1;
      const visited = pos < currentPos;
      const current = pos === currentPos;
      const moksha = pos === 25;
      let cls = 'mp-ps-dot';
      if (moksha) cls += ' mp-ps-moksha';
      else if (current) cls += ' mp-ps-current';
      else if (visited) cls += ' mp-ps-visited';
      const posLabel = current ? `<span class="mp-ps-pos-text">${pos}</span>` : '';
      return `<div class="${cls}" ${current ? `data-avatar="${avatarEmoji}"` : ''}>${posLabel}</div>`;
    }).join('');

    return `
      <div class="screen screen-ancient-game">
        ${_headerWithBack('Back to previous page', 'backFromAncientGame')}
        <div class="screen-agent-row">
          ${_agentHtml('ancientGame')}
          <div class="agent-pane-spacer"></div>
          <div class="screen-content-col">
            <!-- Floating ambient particles -->
            <div class="mp-anim-bg" aria-hidden="true">
              <span class="mp-fp" style="left:8%;animation-delay:0s;animation-duration:7s;">🌸</span>
              <span class="mp-fp" style="left:22%;animation-delay:1.2s;animation-duration:9s;">⭐</span>
              <span class="mp-fp" style="left:40%;animation-delay:2.5s;animation-duration:6.5s;">🪷</span>
              <span class="mp-fp" style="left:58%;animation-delay:0.7s;animation-duration:8s;">✨</span>
              <span class="mp-fp" style="left:74%;animation-delay:3.1s;animation-duration:7.5s;">🌟</span>
              <span class="mp-fp" style="left:88%;animation-delay:1.8s;animation-duration:10s;">🪔</span>
            </div>

            <div class="mp-container">

              <!-- Moksha Patam — collapsed chip -->
              <button class="mp-game-chip" onclick="GKApp.toggleMokshaPanel()">
                <div class="mp-chip-left">
                  <span class="mp-chip-icon">🕹️</span>
                  <div class="mp-chip-info">
                    <span class="mp-chip-title">Moksha Patam</span>
                  </div>
                </div>
                <span class="mp-chip-toggle" id="mp-chip-toggle">▼ Details</span>
              </button>

              <!-- Expandable detail panel (collapsed by default) -->
              <div id="mp-detail-panel" class="mp-detail-panel">

                <div class="mrp-section-title" style="margin-top:0.5rem; text-align:left;">HOW TO PLAY</div>
                <ul class="mrp-rules" style="text-align:left; margin-bottom:1.5rem;">
                  <li>🎲 Complete learning modules to earn XP and roll the dice</li>
                  <li>📈 Every <strong>10 XP</strong> moves your piece one square forward</li>
                  <li>🐍 Land on a <em>Snake</em> — slide down (a lesson in humility!)</li>
                  <li>🪜 Land on a <em>Ladder</em> — climb up (wisdom rewarded!)</li>
                  <li>🏆 Reach square <strong>100 (Moksha)</strong> to attain liberation</li>
                  <li>✅ Assessments give <strong>bonus XP</strong> based on your score</li>
                </ul>
                <!-- Badge collection -->
                <div class="mp-mini-badges-wrap">
                  <p class="mp-mini-badges-title" style="text-align:left;">🏆 BADGE COLLECTION</p>
                  <div class="mp-mini-badges-grid">
                    ${allBadges.map(b => {
      const earned = earnedBadgeIds.includes(b.id);
      return `<div class="mp-mini-badge ${earned ? 'mp-mini-badge-earned' : ''}" title="${b.desc}">
                        <span class="mp-mini-badge-icon">${b.icon}</span>
                        <span class="mp-mini-badge-name">${b.name}</span>
                      </div>`;
    }).join('')}
                  </div>
                </div>

              </div>

              <!-- Mini journey progress strip -->
              <div class="mp-progress-strip" aria-label="Your journey: position ${currentPos} of 25">
                <span class="mp-ps-label">Your Journey</span>
                <div class="mp-ps-track">
                  ${progressDots}
                </div>
                <span class="mp-ps-end-icon">🕉️</span>
              </div>

              <!-- Continue Learning — always prominent -->
              <button class="btn btn-primary btn-full mp-continue-btn" onclick="GKApp.navigate('modules')">
                Continue Learning →
              </button>

            </div>
          </div>
        </div>
      </div>`;
  }

  function rollMokshaDice() {
    const btn = document.getElementById('mp-dice-btn');
    const display = document.getElementById('mp-dice-display');
    if (!btn || !display) return;

    btn.disabled = true;
    btn.textContent = 'Rolling...';

    const diceFaces = ['\u2680', '\u2681', '\u2682', '\u2683', '\u2684', '\u2685'];
    let rolls = 0;
    const maxRolls = 12;
    const rollInterval = setInterval(() => {
      display.textContent = diceFaces[Math.floor(Math.random() * 6)];
      display.classList.add('mp-dice-spin');
      rolls++;
      if (rolls >= maxRolls) {
        clearInterval(rollInterval);
        const diceVal = Math.floor(Math.random() * 6) + 1;
        display.textContent = diceFaces[diceVal - 1];
        display.classList.remove('mp-dice-spin');
        display.classList.add('mp-dice-landed');

        // Move player
        const userId = state.user.id;
        let pos = _getMokshaPosition(userId);
        let newPos = Math.min(25, pos + diceVal);

        // Check for ladder
        if (MOKSHA_BOARD.ladders[newPos]) {
          const ladder = MOKSHA_BOARD.ladders[newPos];
          _addMokshaHistory(userId, { type: 'ladder', from: newPos, to: ladder.to, virtue: ladder.virtue });
          setTimeout(() => {
            display.textContent = '\ud83e\ude9c';
            btn.textContent = `Ladder! ${ladder.virtue} (\u2191 ${ladder.to})`;
          }, 600);
          newPos = ladder.to;
        }
        // Check for snake
        else if (MOKSHA_BOARD.snakes[newPos]) {
          const snake = MOKSHA_BOARD.snakes[newPos];
          _addMokshaHistory(userId, { type: 'snake', from: newPos, to: snake.to, vice: snake.vice });
          setTimeout(() => {
            display.textContent = '\ud83d\udc0d';
            btn.textContent = `Snake! ${snake.vice} (\u2193 ${snake.to})`;
          }, 600);
          newPos = snake.to;
        }
        else {
          _addMokshaHistory(userId, { type: 'move', from: pos, to: newPos });
        }

        _setMokshaPosition(userId, newPos);

        setTimeout(() => {
          btn.disabled = false;
          btn.textContent = 'Roll Again';
          // Check for Moksha (win!)
          if (newPos >= 25) {
            display.textContent = '\ud83c\udfc6';
            btn.textContent = '\ud83c\udf89 MOKSHA ACHIEVED! \ud83c\udf89';
            btn.disabled = true;
            // Award bonus XP
            GKStore.addXPToUser(userId, 50);
          }
          navigate('ancientGame'); // Re-render to update board
        }, 1200);
      }
    }, 100);
  }

  function rollAncientDice() {
    // Navigate to modules (start learning)
    navigate('modules');
  }

  function toggleMokshaPanel() {
    const panel = document.getElementById('mp-detail-panel');
    const toggle = document.getElementById('mp-chip-toggle');
    if (!panel) return;
    const open = panel.classList.toggle('mp-detail-panel-open');
    if (toggle) toggle.textContent = open ? '▲ Hide' : '▼ Details';
  }

  function showMokshaRules() {
    // Remove any existing popup
    const existing = document.getElementById('moksha-rules-popup');
    if (existing) { existing.remove(); return; }

    const totalXP = GKStore.getTotalXP(state.user.id);
    const level = GKXPManager.getLevelForXP(totalXP);
    const xpGain = state._modulesLastXP !== undefined && totalXP > state._modulesLastXP
      ? totalXP - state._modulesLastXP : 0;
    const rewardBanner = xpGain > 0
      ? `<div class="mrp-reward">🎉 You just earned <strong>+${xpGain} XP</strong> — your piece has moved on the board!</div>`
      : '';

    const popup = document.createElement('div');
    popup.id = 'moksha-rules-popup';
    popup.className = 'mrp-overlay';
    popup.innerHTML = `
      <div class="mrp-card">
        <button class="mrp-close" onclick="document.getElementById('moksha-rules-popup').remove()">✕</button>
        <div class="mrp-header">
          <span class="mrp-icon">🕹️</span>
          <div>
            <div class="mrp-title">Moksha Patam</div>
            <div class="mrp-subtitle">Ancient Game of Karma &amp; Wisdom</div>
          </div>
        </div>

        ${rewardBanner}

        <div class="mrp-stats">
          <div class="mrp-stat"><span class="mrp-stat-label">Your XP</span><span class="mrp-stat-val">${totalXP} ⭐</span></div>
          <div class="mrp-stat"><span class="mrp-stat-label">Level</span><span class="mrp-stat-val">${level.icon} ${level.title}</span></div>
          <div class="mrp-stat"><span class="mrp-stat-label">Board Position</span><span class="mrp-stat-val">Square ${Math.min(100, Math.floor(totalXP / 10) + 1)}</span></div>
        </div>

        <div class="mrp-section-title">Badges &amp; Levels</div>
        <div class="mrp-badges">
          <div class="mrp-badge">🌱<span>Shishya</span><small>0–99 XP</small></div>
          <div class="mrp-badge">📚<span>Adhyayi</span><small>100–249 XP</small></div>
          <div class="mrp-badge">🔥<span>Sadhaka</span><small>250–499 XP</small></div>
          <div class="mrp-badge">🧘<span>Yogi</span><small>500–999 XP</small></div>
          <div class="mrp-badge">🕉️<span>Guru</span><small>1000+ XP</small></div>
        </div>
      </div>
    `;
    popup.addEventListener('click', e => { if (e.target === popup) popup.remove(); });
    document.body.appendChild(popup);

    // After showing the reward, "consume" it by updating baseline XP
    state._modulesLastXP = totalXP;
  }

  // ---- Daily vertical schedule (Math / Science alternating + fixed lunch) ───
  const TIMETABLE_SUBJECT_IDS = ['mathematics', 'science'];
  const MODULE_SLOT_MIN = 45;
  const LUNCH_SLOT_MIN = 60;
  const DAY_START_HOUR = 9;

  const DAILY_SCHEDULE = [
    { type: 'module', subjectId: 'mathematics', mins: 45 },
    { type: 'module', subjectId: 'science', mins: 45 },
    { type: 'module', subjectId: 'mathematics', mins: 45 },
    { type: 'module', subjectId: 'science', mins: 45 },
    { type: 'lunch', mins: LUNCH_SLOT_MIN },
    { type: 'module', subjectId: 'mathematics', mins: 45 },
    { type: 'module', subjectId: 'science', mins: 45 },
    { type: 'module', subjectId: 'mathematics', mins: 45 }
  ];

  function _defaultVerticalDaySlots() {
    return DAILY_SCHEDULE.map(s => ({ type: s.type, subjectId: s.subjectId || null, topicId: null }));
  }

  function _formatClockLabel(date) {
    return date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  }

  function _formatScheduleRange(slot) {
    return `${slot.startLabel} – ${slot.endLabel}`;
  }

  function _moduleScheduleDescription(m) {
    if (!m) return '';
    const topicData = GKRecommender.getTopicData(m.subjectId, m.topicId);
    const topic = topicData && topicData.topic;
    const desc = (topic && (topic.scheduleDescription || topic.description)) || m.topicDescription || '';
    return String(desc).trim();
  }

  function _syncModuleTopicDescriptions() {
    if (!state.modules || !state.modules.length) return;
    state.modules = state.modules.map(m => {
      const desc = _moduleScheduleDescription(m);
      return desc ? { ...m, topicDescription: desc } : m;
    });
  }

  function _scheduleConceptPreview(m) {
    if (!m) return '';
    const desc = _moduleScheduleDescription(m);
    if (desc) return desc;
    return `Explore ${m.topicName} in ${m.subjectName} — curiosity hooks, concept cards, light checks, and more.`;
  }

  function _scheduleTimeRangeForSubject(visibleModules, subjectId) {
    const slots = _getVerticalScheduleTimed(visibleModules);
    const slot = slots.find(s => s.type === 'module' && s.subjectId === subjectId);
    return slot ? _formatScheduleRange(slot) : '';
  }

  function _moveVerticalScheduleSlot(slots, fromIdx, toIdx) {
    if (fromIdx === toIdx) return slots;
    if (slots[fromIdx]?.type === 'lunch' || slots[toIdx]?.type === 'lunch') return null;
    const next = slots.map(s => ({ ...s }));
    const [item] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, item);
    return next;
  }

  function _syncVerticalSlotTopics(slots, visibleModules) {
    slots.forEach(slot => {
      if (slot.type !== 'module') return;
      const m = _moduleForSlot(slot, visibleModules);
      if (m) slot.topicId = m.topicId;
    });
    return slots;
  }

  function _readSavedVerticalSchedule() {
    try {
      const raw = sessionStorage.getItem('gk_vertical_schedule_v10_' + state.user.id);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length !== DAILY_SCHEDULE.length) return null;
      const lunchIdx = DAILY_SCHEDULE.findIndex(s => s.type === 'lunch');
      if (parsed[lunchIdx]?.type !== 'lunch') return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function _saveVerticalSchedule() {
    try {
      sessionStorage.setItem(
        'gk_vertical_schedule_v10_' + state.user.id,
        JSON.stringify(state.verticalSchedule)
      );
    } catch (_) { /* ignore */ }
  }

  function _moduleForSlot(slot, visibleModules) {
    if (!slot || slot.type !== 'module') return null;
    const byTopic = slot.topicId
      ? visibleModules.find(m => m.subjectId === slot.subjectId && m.topicId === slot.topicId)
      : null;
    if (byTopic) return byTopic;
    const subjectModules = visibleModules.filter(m => m.subjectId === slot.subjectId);
    if (!subjectModules.length) return null;
    const active = subjectModules.find(mod => _getTopicProgress(mod).status === 'in_progress');
    if (active) return active;
    const incomplete = subjectModules.find(mod => _getTopicProgress(mod).status !== 'complete');
    return incomplete || subjectModules[subjectModules.length - 1];
  }

  function _assignTimesToSlots(slots) {
    const cursor = new Date();
    cursor.setHours(DAY_START_HOUR, 0, 0, 0);
    return slots.map(slot => {
      const mins = slot.type === 'lunch' ? LUNCH_SLOT_MIN : MODULE_SLOT_MIN;
      const start = new Date(cursor);
      cursor.setMinutes(cursor.getMinutes() + mins);
      return {
        ...slot,
        durationMins: mins,
        startLabel: _formatClockLabel(start),
        endLabel: _formatClockLabel(cursor)
      };
    });
  }

  function _ensureVerticalSchedule(visibleModules) {
    if (!state.user) return;
    if (!state.verticalSchedule) {
      state.verticalSchedule = _readSavedVerticalSchedule() || _defaultVerticalDaySlots();
    }
    let changed = false;
    state.verticalSchedule.forEach(slot => {
      if (slot.type !== 'module') return;
      const m = _moduleForSlot(slot, visibleModules);
      if (m && slot.topicId !== m.topicId) {
        slot.topicId = m.topicId;
        changed = true;
      }
    });
    if (changed) _saveVerticalSchedule();
  }

  function _getVerticalScheduleTimed(visibleModules) {
    _ensureVerticalSchedule(visibleModules);
    return _assignTimesToSlots(state.verticalSchedule);
  }

  function _defaultTimetableFlexOrder() {
    return DAILY_SCHEDULE
      .filter(s => s.type === 'module' && !s.locked)
      .map(s => ({ subjectId: s.subjectId, topicId: s.topicId || null }));
  }

  function _normalizeTimetableFlexOrder(order) {
    const defaultFlexOrder = _defaultTimetableFlexOrder();
    const validOrder = Array.isArray(order)
      ? order.filter(item => item && TIMETABLE_SUBJECT_IDS.includes(item.subjectId))
      : [];
    if (validOrder.length !== defaultFlexOrder.length) return defaultFlexOrder;
    return validOrder.slice(0, defaultFlexOrder.length);
  }

  function _readSavedTimetableFlexOrder() {
    try {
      const saved = sessionStorage.getItem('gk_tt_flex_order_v9_' + state.user.id);
      return saved ? JSON.parse(saved) : _defaultTimetableFlexOrder();
    } catch (_) {
      return _defaultTimetableFlexOrder();
    }
  }

  function renderTimetable(visibleModules, assessResults, allDone) {
    // ── Initialise flex order: read from sessionStorage or derive from DAILY_SCHEDULE ──
    if (!state.ttFlexOrder) {
      state.ttFlexOrder = _normalizeTimetableFlexOrder(_readSavedTimetableFlexOrder());
    } else {
      state.ttFlexOrder = _normalizeTimetableFlexOrder(state.ttFlexOrder);
    }

    if (!state.ttLockedSubs) {
      const savedLocked = sessionStorage.getItem('gk_tt_locked_subs_v7_' + state.user.id);
      state.ttLockedSubs = savedLocked ? JSON.parse(savedLocked) : {};
    }

    // --- Dynamic Injection of Unlocked Subjects ---
    if (state.user.isPromoted) {
      let flexSubjects = state.ttFlexOrder.map(f => f.subjectId);
      let lockedSubjects = DAILY_SCHEDULE.filter(s => s.type === 'module' && s.locked).map(s => {
        const key = `${s.subjectId}-${s.topicId}`;
        if (state.ttLockedSubs && state.ttLockedSubs[key]) return state.ttLockedSubs[key].subjectId;
        return s.subjectId;
      });
      let assignedSubjects = [...flexSubjects, ...lockedSubjects];

      const allVisibleSubjects = [...new Set(visibleModules.map(m => m.subjectId))];
      const sess = GKStore.getSession() || {};
      const overridesLocal = state.user.overrides || {};

      function isTopicDoneLocally(m) {
        const key = `${m.subjectId}-${m.topicId}`;
        const td = GKRecommender.getTopicData(m.subjectId, m.topicId);
        if (!td) return true;
        
        // Topic is done if formally completed, overridden, or (fallback) all mandatory subtopics done in this session
        const isCompleted = (state.user.completedTopics || []).includes(key);
        if (isCompleted || !!overridesLocal[key]) return true;

        const mandatorySts = td.topic.subtopics.filter(st => st.mandatory !== false);
        const compSts = sess.completedSubtopics || [];
        const subDone = mandatorySts.length > 0 ? mandatorySts.every(st => compSts.includes(m.topicId + '-' + st.id)) : false;
        return subDone;
      }

      const incompleteSubjects = allVisibleSubjects.filter(sub => {
        const mods = visibleModules.filter(m => m.subjectId === sub);
        return mods.some(m => !isTopicDoneLocally(m));
      });

      const missingSubjects = incompleteSubjects.filter(sub => !assignedSubjects.includes(sub));

      if (missingSubjects.length > 0) {
        let changedFlex = false;
        let changedLocked = false;

        // 1. Swap completed Flex Slots (Allowing all flex slots to be replaced now)
        for (let i = 0; i < state.ttFlexOrder.length; i++) {
          const fSub = state.ttFlexOrder[i].subjectId;
          const fTopic = state.ttFlexOrder[i].topicId;

          // For promoted users, we are more aggressive: if the subject is done OR if it's an old subject and we have new ones waiting
          let isSlotDone = false;
          if (fTopic) {
            const slotMod = visibleModules.find(m => m.subjectId === fSub && m.topicId === fTopic);
            isSlotDone = slotMod ? isTopicDoneLocally(slotMod) : true;
          } else {
            const fMods = visibleModules.filter(m => m.subjectId === fSub);
            isSlotDone = fMods.length > 0 && fMods.every(m => isTopicDoneLocally(m));
          }

          if (isSlotDone && missingSubjects.length > 0) {
            state.ttFlexOrder[i].subjectId = missingSubjects.shift();
            state.ttFlexOrder[i].topicId = null;
            changedFlex = true;
          }
        }

        // 2. Swap completed Locked Slots
        for (const slot of DAILY_SCHEDULE.filter(s => s.type === 'module' && s.locked)) {
          const key = `${slot.subjectId}-${slot.topicId}`;
          const currentAssign = state.ttLockedSubs[key] || { subjectId: slot.subjectId, topicId: slot.topicId };

          let isSlotDone = false;
          if (currentAssign.topicId) {
            const slotMod = visibleModules.find(m => m.subjectId === currentAssign.subjectId && m.topicId === currentAssign.topicId);
            isSlotDone = slotMod ? isTopicDoneLocally(slotMod) : true;
          } else {
            const fMods = visibleModules.filter(m => m.subjectId === currentAssign.subjectId);
            isSlotDone = fMods.length > 0 && fMods.every(m => isTopicDoneLocally(m));
          }

          if (isSlotDone && missingSubjects.length > 0) {
            state.ttLockedSubs[key] = { subjectId: missingSubjects.shift(), topicId: null };
            changedLocked = true;
          }
        }

        if (changedFlex) {
          sessionStorage.setItem('gk_tt_flex_order_v9_' + state.user.id, JSON.stringify(state.ttFlexOrder));
        }
        if (changedLocked) {
          sessionStorage.setItem('gk_tt_locked_subs_v7_' + state.user.id, JSON.stringify(state.ttLockedSubs));
        }
      }
    }

    // Fast lookup: subjectId + topicId → module object
    function moduleFor(subjectId, topicId) {
      if (topicId) {
        const found = visibleModules.find(m => m.subjectId === subjectId && m.topicId === topicId) || null;
        if (!found) console.warn('[GK] moduleFor: NOT FOUND', subjectId, topicId, 'visibleModules:', visibleModules.map(m => m.subjectId + '/' + m.topicId));
        return found;
      }

      const subjectModules = visibleModules.filter(m => m.subjectId === subjectId);
      if (subjectModules.length === 0) return null;

      const incomplete = subjectModules.find(m => !m.isCompleted);
      if (incomplete) return incomplete;

      return subjectModules[subjectModules.length - 1]; // Return most advanced completed topic if all are done
    }

    // Walk through DAILY_SCHEDULE; flexible module slots consume from ttFlexOrder
    let fp = 0; // flex position counter
    const blocks = DAILY_SCHEDULE.map((slot) => {

      // ── Fixed (non-draggable) slots ──────────────────────────────────────
      if (slot.type === 'fixed') {
        const isAssessClickable = slot.label === 'Assessment' && allDone;
        const lockBadge = slot.locked
          ? '<span class="tt-lock-badge" title="Fixed time">🔒</span>' : '';
        return `
          <div class="tt-block tt-fixed${isAssessClickable ? ' tt-assess' : ''}${slot.locked ? ' tt-locked' : ''}"
               style="flex:${slot.mins};--tt-bg:${slot.bg};--tt-fg:${slot.fg}"
               ${isAssessClickable ? 'onclick="GKApp.startFinalAssessment()"' : ''}>
            ${lockBadge}
            <span class="tt-icon">${slot.icon}</span>
            <span class="tt-label">${slot.label}</span>
          </div>`;
      }

      // ── Locked module slot — fixed position, not draggable ───────────────
      if (slot.locked) {
        const key = `${slot.subjectId}-${slot.topicId}`;
        const assign = state.ttLockedSubs[key] || { subjectId: slot.subjectId, topicId: slot.topicId };
        const m = moduleFor(assign.subjectId, assign.topicId);
        const isDone = m ? _isTopicDone(m) : false;
        const cls = m ? (isDone ? 'tt-done' : 'tt-active') : 'tt-ghost';
        const color = m ? `--tt-bg:${m.subjectColor}` : '';
        return `
          <div class="tt-block ${cls} tt-locked"
               style="flex:${slot.mins};${color}"
               ${m ? `onclick="GKApp.startModule(${m._origIdx})"` : ''}>
            <span class="tt-lock-badge" title="Fixed time">🔒</span>
            ${isDone ? '<span class="tt-check">✓</span>' : ''}
            <span class="tt-icon">${m ? `${m.subjectIcon} ${m.topicIcon}` : slot.icon}</span>
            ${m
            ? `<span class="tt-subject-label">${m.subjectName}</span>
                 <span class="tt-topic-label">${m.topicName}</span>`
            : `<span class="tt-label">${slot.label}</span>`}
            ${m ? (isDone ? '<span class="tt-go">🔄 Review</span>' : '<span class="tt-go">▶ Go</span>') : ''}
          </div>`;
      }

      // ── Pinned module slot — fixed topic, not draggable, no lock icon ───
      if (slot.pinned) {
        const m = moduleFor(slot.subjectId, slot.topicId);
        const isDone = m ? _isTopicDone(m) : false;
        const cls = m ? (isDone ? 'tt-done' : 'tt-active') : 'tt-ghost';
        const color = m ? `--tt-bg:${m.subjectColor}` : '';
        fp++; // still consume a flex slot position so indices stay aligned
        return `
          <div class="tt-block ${cls}"
               style="flex:${slot.mins};${color}"
               ${m ? `onclick="GKApp.startModule(${m._origIdx})"` : ''}>
            ${isDone ? '<span class="tt-check">✓</span>' : ''}
            <span class="tt-icon">${m ? `${m.subjectIcon} ${m.topicIcon}` : slot.icon}</span>
            ${m
              ? `<span class="tt-subject-label">${m.subjectName}</span>
                 <span class="tt-topic-label">${m.topicName}</span>`
              : `<span class="tt-label">${slot.label}</span>`}
            ${m ? (isDone ? '<span class="tt-go">🔄 Review</span>' : '<span class="tt-go">▶ Go</span>') : ''}
          </div>`;
      }

      // ── Flexible module slot — draggable ────────────────────────────────
      const curFp = fp++;
      const assignment = state.ttFlexOrder[curFp];
      const m = assignment ? moduleFor(assignment.subjectId, assignment.topicId) : null;

      if (!m) {
        // Ghost: no matching visible module for this assignment
        return `
          <div class="tt-block tt-ghost tt-droptarget"
               style="flex:${slot.mins}"
               data-fp="${curFp}"
               ondragover="GKApp.onTTDragOver(event,${curFp})"
               ondragleave="GKApp.onTTDragLeave(event)"
               ondrop="GKApp.onTTDrop(event,${curFp})">
            <span class="tt-icon">${slot.icon}</span>
            <span class="tt-label">${assignment ? assignment.subjectId : slot.label}</span>
          </div>`;
      }

      const topicData = GKRecommender.getTopicData(m.subjectId, m.topicId);
      const doneSet = _getCompletedSubtopicsSet();
      let allSubtopicsDone = false;
      if (topicData) {
        const mandatorySts = topicData.topic.subtopics.filter(st => st.mandatory !== false);
        allSubtopicsDone = mandatorySts.length > 0
          ? mandatorySts.every(st => doneSet.has(`${m.topicId}-${st.id}`))
          : false;
      }

      const isDone = _isTopicDone(m);
      const isCompleted = (state.user.completedTopics || []).includes(`${m.subjectId}-${m.topicId}`);
      const cls = isDone ? 'tt-done' : 'tt-active';

      // Assessment tab ALWAYS shows, but is locked if subtopics are NOT done OR already attempted
      const isAssessibleModule = true; // Enabled for all modules
      const hasAssessTab = isAssessibleModule;
      const isAlreadyAssessed = isCompleted;
      const isAssessLocked = !allSubtopicsDone || isAlreadyAssessed;

      const dragAttrs = `draggable="true" data-fp="${curFp}"
             ondragstart="GKApp.onTTDragStart(event,${curFp})"
             ondragend="GKApp.onTTDragEnd(event)"
             ondragover="GKApp.onTTDragOver(event,${curFp})"
             ondragleave="GKApp.onTTDragLeave(event)"
             ondrop="GKApp.onTTDrop(event,${curFp})"`;

      return `
        <div class="tt-block ${cls} tt-draggable${hasAssessTab ? ' tt-has-assess' : ''}"
             style="flex:${slot.mins};--tt-bg:${m.subjectColor}; position:relative;"
             ${dragAttrs}>
          <div class="tt-main" onclick="GKApp.startModule(${m._origIdx})">
            <span class="tt-drag-handle">⠿</span>
            ${isDone ? '<span class="tt-check" style="right: 80px;">✓</span>' : ''}
            <span class="tt-icon">${m.subjectIcon} ${m.topicIcon}</span>
            <span class="tt-subject-label">${m.subjectName}</span>
            <span class="tt-topic-label">${m.topicName}</span>
            ${isDone ? '<span class="tt-go">🔄 Review</span>' : '<span class="tt-go">▶ Go</span>'}
          </div>
          ${hasAssessTab ? `
            <div class="tt-assess-tab ${isAssessLocked ? 'tt-assess-locked' : ''}"
                 ${isAssessLocked ? `title="${isAlreadyAssessed ? 'Assessment already completed' : 'Complete all subtopics first'}"` : `onclick="event.stopPropagation(); GKApp.startModuleAssessment(${m._origIdx})"`}>
              <span class="tt-assess-icon">${isAlreadyAssessed ? '✅' : (isAssessLocked ? '🔒' : '📝')}</span>
              <span class="tt-assess-label">Assessment</span>
            </div>` : ''}
        </div>`;
    }).join('');

    const ruler = DAILY_SCHEDULE.map(s =>
      `<span class="tt-tick" style="flex:${s.mins}">${s.start}</span>`
    ).join('');

    return `
      <div class="tt-wrap ev-timetable">
        <div class="tt-scroll">
          <div class="tt-track" id="tt-track">${blocks}</div>
          <div class="tt-ruler">${ruler}</div>
        </div>
        <p class="tt-hint">⠿ Drag coloured blocks to rearrange your day &nbsp;·&nbsp; 🔒 Lunch is fixed &nbsp;·&nbsp; Tap to begin</p>
      </div>`;
  }

  function _formatModulesDayLabel() {
    return new Date().toLocaleDateString('en-IN', {
      weekday: 'long',
      day: 'numeric',
      month: 'short'
    });
  }

  const MINS_PER_SUBTOPIC = 15;

  function _resumeStorageKey() {
    return state.user ? `gk_resume_${state.user.id}` : null;
  }

  /** Merge latest XP/progress from GKStore into state.user (login snapshot goes stale). */
  function _refreshUserFromStore() {
    if (!state.user?.id) return;
    const profile = GKStore.getUserProfile(state.user.id);
    if (profile) state.user = { ...state.user, ...profile };
  }

  function _ensureTimetableTopicAssignments() {
    if (!state.user || !state.modules?.length) return;
    const visible = state.modules.filter(
      m => m.assigned !== false && TIMETABLE_SUBJECT_IDS.includes(m.subjectId)
    );
    _ensureVerticalSchedule(visible);
    if (state.verticalSchedule.some(s => s.type === 'module' && !s.topicId)) {
      _syncTimetableWithMood();
    }
  }

  function _getTimetableAssignmentForSubject(subjectId) {
    const visible = (state.modules || []).filter(
      m => m.assigned !== false && TIMETABLE_SUBJECT_IDS.includes(m.subjectId)
    );
    _ensureVerticalSchedule(visible);
    return state.verticalSchedule.find(s => s.type === 'module' && s.subjectId === subjectId) || null;
  }

  /**
   * Module shown on Today's Schedule / lesson cards — matches timetable topic when set,
   * not the next incomplete topic deeper in the learning path.
   */
  function _getTodaySubjectModule(visibleModules, subjectId) {
    const assign = _getTimetableAssignmentForSubject(subjectId);
    if (assign?.topicId) {
      const pinned = visibleModules.find(
        m => m.subjectId === subjectId && m.topicId === assign.topicId
      );
      if (pinned) return pinned;
    }
    return _getSubjectLessonModule(visibleModules, subjectId);
  }

  function _sessionStartMs() {
    const session = GKStore.getSession();
    if (!session?.startTime) return null;
    if (typeof session.startTime === 'number') return session.startTime;
    const parsed = Date.parse(session.startTime);
    return Number.isNaN(parsed) ? null : parsed;
  }

  function _isTopicDone(m) {
    if (!m) return false;
    const topicKey = `${m.subjectId}-${m.topicId}`;
    const overrides = state.user?.overrides || {};
    if ((state.user?.completedTopics || []).includes(topicKey) || overrides[topicKey]) {
      return true;
    }
    return _getTopicProgress(m).status === 'complete';
  }

  function _maybeMarkTopicComplete(m) {
    if (!state.user || !m) return;
    const topicKey = `${m.subjectId}-${m.topicId}`;
    if ((state.user.completedTopics || []).includes(topicKey)) return;
    if (_getTopicProgress(m).status !== 'complete') return;
    GKStore.markTopicComplete(state.user.id, topicKey);
    if (!state.user.completedTopics) state.user.completedTopics = [];
    if (!state.user.completedTopics.includes(topicKey)) {
      state.user.completedTopics.push(topicKey);
    }
    state.modules.forEach((mod, idx) => {
      if (mod.subjectId === m.subjectId && mod.topicId === m.topicId) {
        state.modules[idx] = { ...mod, isCompleted: true };
      }
    });
  }

  function _getCompletedSubtopicsSet() {
    const profile = state.user ? GKStore.getUserProfile(state.user.id) : null;
    const session = GKStore.getSession() || {};
    const keys = [
      ...(profile?.completedSubtopics || []),
      ...(session.completedSubtopics || [])
    ];
    return new Set(keys);
  }

  /** Subtopic-level progress for one module/topic (EdVantage-style). */
  function _getTopicProgress(m) {
    const topicData = GKRecommender.getTopicData(m.subjectId, m.topicId);
    const overrides = state.user?.overrides || {};
    const topicKey = `${m.subjectId}-${m.topicId}`;
    const topicComplete = m.isCompleted
      || (state.user?.completedTopics || []).includes(topicKey)
      || !!overrides[topicKey];

    if (!topicData) {
      return { done: 0, total: 1, pct: topicComplete ? 100 : 0, status: topicComplete ? 'complete' : 'not_started' };
    }

    const allSubtopics = topicData.topic.subtopics || [];
    const mandatory = allSubtopics.filter(st => st.mandatory !== false);
    const pool = mandatory.length ? mandatory : allSubtopics;
    const total = Math.max(pool.length, 1);
    const doneSet = _getCompletedSubtopicsSet();

    let done = 0;
    pool.forEach(st => {
      if (doneSet.has(`${m.topicId}-${st.id}`)) done++;
    });

    if (topicComplete) {
      return { done: total, total, pct: 100, status: 'complete' };
    }

    const pct = Math.round((done / total) * 100);
    let status = 'not_started';
    if (pct >= 100) status = 'complete';
    else if (pct > 0) status = 'in_progress';

    return { done, total, pct, status };
  }

  function _getSubjectLessonModule(visibleModules, subjectId) {
    const subjectModules = visibleModules.filter(m => m.subjectId === subjectId);
    if (!subjectModules.length) return null;
    const active = subjectModules.find(mod => {
      const p = _getTopicProgress(mod);
      return p.status === 'in_progress';
    });
    if (active) return active;
    const incomplete = subjectModules.find(mod => _getTopicProgress(mod).status !== 'complete');
    return incomplete || subjectModules[subjectModules.length - 1];
  }

  function _syncAllVisibleTopicCompletions(visibleModules) {
    visibleModules.forEach(m => _maybeMarkTopicComplete(m));
  }

  function _persistResumeLesson(m) {
    const key = _resumeStorageKey();
    if (!key || !m) return;
    const prog = _getTopicProgress(m);
    if (prog.status === 'complete') {
      try { sessionStorage.removeItem(key); } catch (_) { /* ignore */ }
      return;
    }
    let data;
    try {
      const existing = sessionStorage.getItem(key);
      data = existing ? JSON.parse(existing) : {};
    } catch (_) {
      data = {};
    }
    if (!data.startedAt || data.topicId !== m.topicId) {
      data.startedAt = Date.now();
    }
    try {
      sessionStorage.setItem(key, JSON.stringify({
        subjectId: m.subjectId,
        topicId: m.topicId,
        moduleIdx: m._origIdx,
        topicName: m.topicName,
        subjectName: m.subjectName,
        subjectIcon: m.subjectIcon,
        startedAt: data.startedAt,
        progressPct: prog.pct,
        doneSteps: prog.done,
        totalSteps: prog.total
      }));
    } catch (_) { /* ignore */ }
  }

  function _getResumeLesson(visibleModules) {
    const key = _resumeStorageKey();
    if (!key) return null;

    let saved = null;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) saved = JSON.parse(raw);
    } catch (_) { /* ignore */ }

    if (saved && saved.moduleIdx != null) {
      const m = state.modules[saved.moduleIdx];
      if (m) {
        const prog = _getTopicProgress(m);
        if (prog.status === 'in_progress') {
          return { module: m, prog, startedAt: saved.startedAt || Date.now() };
        }
        if (prog.status === 'complete') {
          try { sessionStorage.removeItem(key); } catch (_) { /* ignore */ }
        }
      }
    }

    for (const sid of TIMETABLE_SUBJECT_IDS) {
      const m = _getSubjectLessonModule(visibleModules, sid);
      if (!m) continue;
      const prog = _getTopicProgress(m);
      if (prog.status === 'in_progress') {
        return { module: m, prog, startedAt: Date.now() };
      }
    }
    return null;
  }

  function _formatMinsLabel(mins) {
    if (mins < 1) return 'just started';
    if (mins === 1) return '1 min';
    return `${mins} mins`;
  }

  function _modulesDayProgress(visibleModules) {
    const subjectSlots = TIMETABLE_SUBJECT_IDS.map(sid => {
      const m = _getTodaySubjectModule(visibleModules, sid);
      if (!m) return null;
      return { subjectId: sid, module: m, prog: _getTopicProgress(m) };
    }).filter(Boolean);

    if (!subjectSlots.length) {
      const total = TIMETABLE_SUBJECT_IDS.length;
      return {
        done: 0,
        total,
        pct: 0,
        segments: TIMETABLE_SUBJECT_IDS.map(() => '<div class="ev-seg"></div>').join(''),
        subjectsComplete: 0,
        subtopicsDone: 0,
        subtopicsTotal: 0,
        minsSoFar: 0,
        minsLeft: total * MINS_PER_SUBTOPIC,
        subjectSlots: []
      };
    }

    const total = Math.max(subjectSlots.length, 1);
    let subjectsComplete = 0;
    let subtopicsDone = 0;
    let subtopicsTotal = 0;
    let remainingMins = 0;

    subjectSlots.forEach(slot => {
      subtopicsDone += slot.prog.done;
      subtopicsTotal += slot.prog.total;
      remainingMins += (slot.prog.total - slot.prog.done) * MINS_PER_SUBTOPIC;
      if (slot.prog.status === 'complete') subjectsComplete++;
    });

    const pct = subtopicsTotal > 0
      ? Math.round((subtopicsDone / subtopicsTotal) * 100)
      : Math.round((subjectsComplete / total) * 100);

    const segments = subjectSlots.map(slot => {
      const cls = slot.prog.status === 'complete'
        ? 'done'
        : (slot.prog.status === 'in_progress' ? 'partial' : '');
      const pct = slot.prog.pct;
      const style = slot.prog.status === 'in_progress'
        ? ` style="background:linear-gradient(90deg,var(--accent) ${pct}%,var(--soft) ${pct}%)"`
        : '';
      return `<div class="ev-seg ${cls}"${style} title="${slot.module.subjectName}: ${pct}%"></div>`;
    }).join('');

    const startMs = _sessionStartMs();
    let minsSoFar = 0;
    if (startMs != null) {
      minsSoFar = Math.max(1, Math.round((Date.now() - startMs) / 60000));
    } else {
      minsSoFar = subtopicsDone * MINS_PER_SUBTOPIC;
    }

    return {
      done: subjectsComplete,
      total,
      pct,
      segments,
      subjectsComplete,
      subtopicsDone,
      subtopicsTotal,
      minsSoFar,
      minsLeft: remainingMins,
      subjectSlots
    };
  }

  function renderResumeCard(visibleModules) {
    const resume = _getResumeLesson(visibleModules);
    if (!resume) return '';

    const { module: m, prog, startedAt } = resume;
    const elapsedMins = Math.max(1, Math.round((Date.now() - startedAt) / 60000));
    const stepsLeft = Math.max(0, prog.total - prog.done);
    const aboutLeft = Math.max(MINS_PER_SUBTOPIC, stepsLeft * MINS_PER_SUBTOPIC);

    return `
      <div class="ev-resume-card" role="button" tabindex="0"
           onclick="GKApp.continueResumeLesson()"
           onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();GKApp.continueResumeLesson()}">
        <div class="ev-resume-body">
          <div class="ev-resume-lbl">Resume where you left off</div>
          <div class="ev-resume-title">${m.subjectName} — ${m.topicName}</div>
          <div class="ev-resume-meta">
            You started ${_formatMinsLabel(elapsedMins)} ago · about ${_formatMinsLabel(aboutLeft)} left
            · ${prog.done} of ${prog.total} steps (${prog.pct}%)
          </div>
          <div class="ev-resume-track">
            <div class="ev-resume-fill" style="width:${prog.pct}%"></div>
          </div>
        </div>
        <div class="ev-resume-cta">Continue →</div>
      </div>`;
  }

  function renderTodayLessonCards(visibleModules) {
    const lessonSubjects = TIMETABLE_SUBJECT_IDS.filter(sid =>
      visibleModules.some(m => m.subjectId === sid)
    );

    const cards = lessonSubjects.map(subjectId => {
      const m = _getTodaySubjectModule(visibleModules, subjectId);
      if (!m) return '';

      const prog = _getTopicProgress(m);
      const statusBadge = prog.status === 'complete'
        ? '<span class="lc-tag is-complete">✓ Completed</span>'
        : (prog.status === 'in_progress'
          ? '<span class="lc-tag is-progress">In progress</span>'
          : '');
      const cardClass = prog.status === 'complete' ? 'is-complete' : (prog.status === 'in_progress' ? 'is-in-progress' : '');
      const ctaText = prog.status === 'complete' ? 'Review lesson →' : (prog.status === 'in_progress' ? 'Continue →' : 'Start lesson →');
      const timeRange = _scheduleTimeRangeForSubject(visibleModules, subjectId);
      const desc = _escapeHtml(_moduleScheduleDescription(m) || 'Explore the key ideas for today and complete the guided activities.');

      return `
        <article class="today-lesson-card subject-${subjectId} ${cardClass}" style="--lesson-color:${m.subjectColor}"
                 role="button" tabindex="0"
                 onclick="GKApp.openTodayLesson('${subjectId}')"
                 onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();GKApp.openTodayLesson('${subjectId}')}">
          ${statusBadge}
          <div class="tlc-summary">
            <div class="tlc-topline">
              <span class="tlc-subject"><span class="tlc-dot"></span>${m.subjectName}</span>
              ${timeRange ? `<span class="schedule-time-range">${timeRange}</span>` : ''}
            </div>
            <h3>${_escapeHtml(m.topicName)}</h3>
            <p class="tlc-desc">${desc}</p>
            <div class="tlc-progress-row">
              <div class="tlc-progress-track">
                <div class="tlc-progress-fill" style="width:${prog.pct}%"></div>
              </div>
              <span class="tlc-progress-label">${prog.done}/${prog.total} steps · ${prog.pct}%</span>
            </div>
            <div class="tlc-divider"></div>
            <div class="tlc-footer">
              <span class="tlc-teacher">${m.subjectIcon} Guided with Krishna</span>
              <span class="tlc-cta">${ctaText}</span>
            </div>
          </div>
        </article>`;
    }).join('');

    return `
      <section class="today-lessons ev-lessons">
        <div class="today-lessons-grid">
          ${cards}
        </div>
      </section>`;
  }

  function renderVerticalLessonSchedule(visibleModules) {
    const slots = _getVerticalScheduleTimed(visibleModules);

    const cards = slots.map((slot, idx) => {
      if (slot.type === 'lunch') {
        return `
          <article class="today-lesson-card schedule-card schedule-card-compact schedule-lunch is-fixed" data-vslot="${idx}">
            <div class="schedule-compact-row">
              <span class="schedule-drag-handle is-disabled" aria-hidden="true">⠿</span>
              <span class="tlc-subject"><span class="tlc-dot"></span>Lunch</span>
              <span class="schedule-compact-spacer" aria-hidden="true"></span>
              <span class="schedule-time-range" aria-label="Lunch time">${_formatScheduleRange(slot)}</span>
            </div>
          </article>`;
      }

      const m = _moduleForSlot(slot, visibleModules);
      if (!m) return '';

      const prog = _getTopicProgress(m);
      const statusBadge = prog.status === 'complete'
        ? '<span class="lc-tag schedule-status-tag is-complete">✓ Completed</span>'
        : (prog.status === 'in_progress'
          ? '<span class="lc-tag schedule-status-tag is-progress">In progress</span>'
          : '');
      const cardClass = prog.status === 'complete' ? 'is-complete' : (prog.status === 'in_progress' ? 'is-in-progress' : '');
      const timeRange = _formatScheduleRange(slot);

      return `
        <article class="today-lesson-card schedule-card schedule-card-compact subject-${m.subjectId} ${cardClass} vsched-draggable"
                 data-vslot="${idx}"
                 style="--lesson-color:${m.subjectColor}"
                 role="button" tabindex="0"
                 onclick="GKApp.onVSchedCardClick(event,${m._origIdx})"
                 onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();GKApp.onVSchedCardClick(event,${m._origIdx})}">
          <div class="schedule-compact-row">
            <span class="schedule-drag-handle" title="Drag to reorder"
                  onpointerdown="GKApp.onVSchedPointerDown(event,${idx})">⠿</span>
            <span class="tlc-subject"><span class="tlc-dot"></span>${m.subjectName}</span>
            <span class="schedule-compact-title">${_escapeHtml(m.topicName)}</span>
            ${statusBadge}
            <span class="schedule-time-range" aria-label="Lesson time">${timeRange}</span>
          </div>
        </article>`;
    }).join('');

    return `
      <section class="today-lessons ev-lessons vertical-schedule-section vertical-schedule-fit">
        <div class="vertical-schedule-list">
          ${cards}
        </div>
      </section>`;
  }

  // ---- SCREEN 3: Module Selection ----
  function renderModules() {
    const user = state.user;
    if (!user) return renderLogin();

    _refreshUserFromStore();
    _ensureStudentModules();
    _ensureTimetableTopicAssignments();
    _syncModuleTopicDescriptions();

    const totalXP = GKStore.getTotalXP(user.id);
    const level = GKXPManager.getLevelForXP(totalXP);
    // Track XP growth since last visit to this screen
    const xpGain = (state._modulesLastXP !== undefined && totalXP > state._modulesLastXP)
      ? totalXP - state._modulesLastXP : 0;

    const session = GKStore.getSession() || {};
    const assessResults = session.assessmentResults || {};
    const mentorNotes = (GKStore.getMentorNotes(user.id) || []).filter(n => !n.read);
    const alreadySubmitted = session.submittedForReview;

    // Modules shown in the timetable track
    const visibleModules = state.modules.filter(m =>
      m.assigned !== false && TIMETABLE_SUBJECT_IDS.includes(m.subjectId)
    );
    const lessonSubjectCount = TIMETABLE_SUBJECT_IDS.filter(sid =>
      visibleModules.some(m => m.subjectId === sid)
    ).length;

    _syncAllVisibleTopicCompletions(visibleModules);

    // Determine if the entire assigned learning path is finished
    const overrides = state.user.overrides || {};
    const allLearningPathDone = visibleModules.length > 0 && visibleModules.every(m => {
      const topicKey = `${m.subjectId}-${m.topicId}`;
      return (state.user.completedTopics || []).includes(topicKey) || overrides[topicKey];
    });

    const prog = _modulesDayProgress(visibleModules);
    const progressTimeBig = prog.minsLeft <= 0 ? 'All done' : `~ ${prog.minsLeft} min`;
    const progressTimeSub = prog.minsLeft <= 0 ? 'Great work today' : 'left to feel done';
    const progressRightText = prog.subtopicsTotal > 0
      ? `${prog.subjectsComplete} of ${prog.total} done · ${_formatMinsLabel(prog.minsSoFar)} so far`
      : `${prog.done} of ${prog.total} done · ${prog.pct}%`;

    return `
      <div class="screen screen-modules ${state.sidebarCollapsed ? 'sidebar-nav-collapsed' : ''}">
        ${_headerWithBack('Back to previous page', 'backFromSchedule')}
        ${state.sidebarCollapsed ? renderSidebarToggleBtn() : ''}
        ${renderSidebarMenu('schedule', null)}
        <div class="screen-agent-row">
          ${_agentHtml('modules')}
          <div class="agent-pane-spacer"></div>
          <main class="screen-content-col modules-main-col">
            <div class="modules-page-topbar">
              <div class="modules-page-intro">
                <h1 class="modules-greeting">Hello, <span class="accent">${user.displayName}</span></h1>
                <p class="modules-greeting-sub">${_formatModulesDayLabel()} · Your personalized learning path</p>
              </div>
              <div class="modules-topbar-actions">
                <div class="ev-pill"><span class="ev-pill-dot"></span>${level.icon} ${level.title}</div>
                <div class="mtb-moksha ${xpGain > 0 ? 'mtb-moksha-glow' : ''}"
                     id="mtb-moksha-btn"
                     onclick="GKApp.showMokshaRules()"
                     title="View Moksha Patam Rules">
                  <span class="mtb-moksha-emoji">🕹️</span>
                  <div class="mtb-moksha-meta">
                    <span class="mtb-moksha-name">Moksha Patam</span>
                    <span class="mtb-moksha-xp">${totalXP} XP</span>
                  </div>
                  ${xpGain > 0 ? `<div class="mtb-reward-badge" id="mtb-reward-badge">+${xpGain} XP ✨</div>` : ''}
                </div>
              </div>
            </div>
            <div class="ev-status-bar ev-status-bar-compact">
              <div class="ev-status-progress">
                <div class="top">
                  <span class="lbl">Today's progress</span>
                  <span class="right">${progressRightText}</span>
                </div>
                <div class="ev-status-track">
                  <div class="ev-status-fill" style="width:${prog.pct}%"></div>
                </div>
              </div>
              <div class="ev-status-time">
                <span class="big">${progressTimeBig}</span>
                <span>${progressTimeSub}</span>
              </div>
            </div>
            ${renderResumeCard(visibleModules)}
            <div class="modules-schedule-panel">
            <div class="ev-section-label">
              <span class="lbl">Today's schedule</span>
              <span class="meta">${lessonSubjectCount ? `Math & Science · ${MODULE_SLOT_MIN} min each · lunch 12:00–1:00 PM` : 'Complete mood check-in to load lessons'}</span>
            </div>
        <div class="modules-content-wrap modules-content-wrap-schedule">
          ${renderVerticalLessonSchedule(visibleModules)}
        </div>
            </div>
          <!-- Submit for Mentor Review -->
          <div class="mrb-wrap">
            ${alreadySubmitted
        ? `<button class="btn mrb-btn mrb-submitted" disabled>
                   ✅ Submitted for Mentor Review
                 </button>
                 <p class="mrb-hint">Your mentor has been notified. Check back later!</p>`
        : allLearningPathDone
          ? `<button class="btn mrb-btn mrb-ready" onclick="GKApp.openReviewPopup()">
                     📤 Submit for Mentor Review
                   </button>
                   <p class="mrb-hint">Great work! Let your mentor know you've finished today's path.</p>`
          : `<button class="btn mrb-btn mrb-locked" disabled>
                     🔒 Submit for Mentor Review
                   </button>
                   <p class="mrb-hint">Complete all modules in today's learning path to unlock.</p>`
      }
          </div>

          <!-- Subtle Skip to Review button at the bottom right -->
          <div class="demo-helpers" style="text-align: right; margin-top: 1rem; padding: 0 1rem;">
             <button class="btn btn-ghost btn-sm" onclick="GKApp.completeDay()" style="color: #bbb; border: 1px solid #ddd; font-size: 0.7rem;">
               Override
             </button>
          </div>

          </main>
        </div>
      </div>`;
  }

  // Completed module chip — collapsible (collapsed by default, expand to review/retake)
  function renderModuleChipDone(m, idx, assessResults) {
    const topicKey = `${m.subjectId}-${m.topicId}`;
    const r = assessResults[topicKey] || {};
    const scoreText = (r.score != null)
      ? `✅ ${r.score}/${r.total} · ${r.percentage}%`
      : '✅ Completed';
    const isExpanded = state.expandedDoneModules.has(idx);

    if (!isExpanded) {
      // Collapsed: compact single row with toggle arrow
      return `
        <div class="module-chip chip-done chip-collapsed"
             style="--subject-color: ${m.subjectColor}"
             onclick="GKApp.toggleCompletedModule(${idx})">
          <div class="chip-done-row">
            <span class="chip-done-icons">${m.subjectIcon} ${m.topicIcon}</span>
            <span class="chip-done-name">${m.topicName}</span>
            <span class="chip-done-score">${scoreText}</span>
            <span class="chip-done-expand">▾</span>
          </div>
        </div>`;
    }

    // Expanded: full chip with review/retake action
    const typeBadge = _moduleTypeBadge(m);
    return `
      <div class="module-chip chip-done chip-expanded"
           style="--subject-color: ${m.subjectColor}">
        <div class="chip-done-row chip-done-row-hdr" onclick="GKApp.toggleCompletedModule(${idx})">
          <span class="chip-done-icons">${m.subjectIcon} ${m.topicIcon}</span>
          <span class="chip-done-name">${m.topicName}</span>
          <span class="chip-done-score">${scoreText}</span>
          <span class="chip-done-expand">▴</span>
        </div>
        <div class="chip-expanded-body">
          ${typeBadge ? `<div class="chip-type-badge ${m.moduleType}">${typeBadge}</div>` : ''}
          ${r.score != null ? `<div class="chip-done-badge">${scoreText}</div>` : ''}
          <div class="chip-subject">${m.subjectName}</div>
          <div class="chip-xp">${m.topicXP} XP · ${m.subtopicCount} subtopics</div>
          <div class="chip-cta" onclick="GKApp.startModule(${idx})">🔄 Review &amp; Retake</div>
        </div>
      </div>`;
  }

  // Mentor notes banner shown at top of modules screen
  function renderMentorNotesBanner(notes) {
    const latest = notes[notes.length - 1];
    return `
      <div class="mentor-notes-banner" id="mentor-notes-banner">
        <div class="mnb-header">
          <span class="mnb-icon">👩‍🏫</span>
          <span class="mnb-title">Message from your Mentor</span>
          <button class="mnb-dismiss" onclick="GKApp.dismissMentorNotes()">✕</button>
        </div>
        <div class="mnb-body">
          <p class="mnb-message">${latest.message || 'Your mentor has a note for you.'}</p>
          ${latest.focusTopics && latest.focusTopics.length > 0 ? `
            <div class="mnb-focus">
              <strong>📌 Focus on:</strong>
              <ul>${latest.focusTopics.map(t => `<li>${t}</li>`).join('')}</ul>
            </div>` : ''}
          ${notes.length > 1 ? `<p class="mnb-more">+ ${notes.length - 1} more note(s)</p>` : ''}
        </div>
        <button class="btn btn-ghost btn-sm mt-sm" onclick="GKApp.dismissMentorNotes()">
          Got it! ✓
        </button>
      </div>`;
  }

  // ---- SCREEN 3b: Subtopic Selection (Classroom-style accordion list) ----
  function renderSubtopics() {
    const m = state.modules[state.activeModuleIdx];
    const topicData = GKRecommender.getTopicData(m.subjectId, m.topicId);
    if (!topicData) return '<div class="screen"><p>Topic not found.</p></div>';
    const { topic } = topicData;
    const session = GKStore.getSession() || {};
    const sessionCompleted = session.completedSubtopics || [];
    // Merge with profile-persisted completed list so data survives page refresh
    const profile = state.user ? GKStore.getUserProfile(state.user.id) : null;
    const profileCompleted = profile ? (profile.completedSubtopics || []) : [];
    const subtopicScores = profile ? (profile.subtopicScores || {}) : {};
    const completedSet = new Set([...sessionCompleted, ...profileCompleted]);
    const completed = [...completedSet];

    const allSubtopics = topic.subtopics;
    const mandatorySubtopics = allSubtopics.filter(st => st.mandatory !== false);
    const optionalSubtopics = allSubtopics.filter(st => st.mandatory === false);
    const allMandatoryDone = mandatorySubtopics.length > 0 &&
      mandatorySubtopics.every(st => completed.includes(m.topicId + '-' + st.id));

    // Derive classroom-style prefix code.
    // If the subtopic declares an explicit lessonPrefix, use it directly.
    // Otherwise fall back to type-based auto-derivation.
    function subtopicCodePrefix(st, seqIdx) {
      const n = seqIdx + 1;
      if (st.lessonPrefix) return `${st.lessonPrefix} ${n}`;
      if (st.subtopicType === 'challenge') return `IMP ${n}`;
      if (st.subtopicType === 'advanced') return `INT ${n}`;
      return seqIdx === 0 ? `EXP ${n}` : `EXP & INT ${n}`;
    }

    // Compact row — tap opens lesson directly (EdVantage-style, no inline content preview)
    function subtopicRow(st, globalIdx, seqIdx) {
      const stKey = m.topicId + '-' + st.id;
      const isDone = completed.includes(stKey);
      const scoreData = subtopicScores[stKey];
      const prefix = subtopicCodePrefix(st, seqIdx);
      const iconChar = st.subtopicType === 'challenge' ? '⚡'
        : st.subtopicType === 'advanced' ? '📝'
          : '📋';

      const scoreChip = isDone && scoreData
        ? `<span class="cl-score-chip">${scoreData.score}/${scoreData.total} ✓</span>`
        : '';

      return `
        <div class="cl-item cl-item-direct ${isDone ? 'cl-done' : ''}"
             style="--subject-color: ${m.subjectColor}"
             role="button" tabindex="0"
             onclick="GKApp.startSubtopic(${globalIdx})"
             onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();GKApp.startSubtopic(${globalIdx})}">
          <div class="cl-row">
            <div class="cl-icon-wrap ${st.subtopicType || 'core'}">${iconChar}</div>
            <div class="cl-title-area">
              <span class="cl-prefix-tag">${prefix}</span>
              <span class="cl-item-name">${st.name}</span>
              ${isDone ? '<span class="cl-done-check">✅</span>' : ''}
            </div>
            <div class="cl-row-meta">
              ${scoreChip}
              <span class="cl-due-date">${isDone ? 'Completed' : `${st.xp || 0} XP`}</span>
              <span class="cl-chevron cl-go-arrow">${isDone ? 'Review →' : 'Start →'}</span>
            </div>
          </div>
        </div>`;
    }

    // Show ALL mandatory subtopics at once (no progressive unlock).
    // Each subtopic shows as completed, in-progress, or assigned.
    const firstIncompleteIdx = mandatorySubtopics.findIndex(
      st => !completed.includes(m.topicId + '-' + st.id)
    );
    const currentStepIdx = firstIncompleteIdx === -1 ? mandatorySubtopics.length - 1 : firstIncompleteIdx;

    const mandatoryWithIdx = mandatorySubtopics.map((st, seqIdx) => {
      return { st, globalIdx: allSubtopics.indexOf(st), seqIdx };
    });
    const optionalWithIdx = optionalSubtopics.map((st, seqIdx) => ({
      st, globalIdx: allSubtopics.indexOf(st), seqIdx: mandatorySubtopics.length + seqIdx
    }));

    // Progress calculation
    const totalSubCount = allSubtopics.length;
    const doneSubCount = allSubtopics.filter(st => completed.includes(m.topicId + '-' + st.id)).length;
    const progressPct = totalSubCount > 0 ? Math.round((doneSubCount / totalSubCount) * 100) : 0;

    // Krishna speech based on progress
    const krishnaSpeech = progressPct === 100
      ? `Wonderful! You've mastered ${topic.name}! 🏆`
      : progressPct >= 50
        ? `Great progress on ${topic.name}! Keep going, you're halfway there! 🔥`
        : `Let's explore ${topic.name} together. Take it one step at a time! 🌟`;

    // XP / level for Moksha icon
    const stTotalXP = GKStore.getTotalXP(state.user.id);
    const stLevel = GKXPManager.getLevelForXP(stTotalXP);
    const stXpGain = (state._modulesLastXP !== undefined && stTotalXP > state._modulesLastXP)
      ? stTotalXP - state._modulesLastXP : 0;

    return `
      <div class="screen screen-subtopics">
        ${renderHeader()}
        <div class="screen-agent-row">
          ${_agentHtml('subtopics')}
          <div class="agent-pane-spacer"></div>
          <div class="screen-content-col">
            <div class="modules-topbar" style="justify-content: flex-end;">
              <div class="mtb-right-group">
                <div class="mtb-moksha ${stXpGain > 0 ? 'mtb-moksha-glow' : ''}"
                     onclick="GKApp.showMokshaRules()"
                     title="View Moksha Patam Rules">
                  <span class="mtb-moksha-emoji">🕹️</span>
                  <div class="mtb-moksha-meta">
                    <span class="mtb-moksha-name">Moksha Patam</span>
                    <span class="mtb-moksha-xp">${stTotalXP} XP · ${stLevel.icon} ${stLevel.title}</span>
                  </div>
                  ${stXpGain > 0 ? `<div class="mtb-reward-badge">+${stXpGain} XP ✨</div>` : ''}
                </div>
                <button class="btn btn-ghost btn-sm stb-back-btn" onclick="GKApp.backToModules()">← Today's Path</button>
              </div>
            </div>

            <!-- ── Progress bar ── -->
            <div class="sub-progress-wrap">
              <div class="sub-progress-header">
                <span class="sub-progress-label">${m.subjectIcon} ${topic.pageTitle || topic.name}</span>
                <span class="sub-progress-count">Step ${Math.min(currentStepIdx + 1, mandatorySubtopics.length)} of ${mandatorySubtopics.length} · ${doneSubCount} done</span>
              </div>
              <div class="sub-progress-track">
                <div class="sub-progress-fill" style="width:${progressPct}%"
                     data-pct="${progressPct}"></div>
              </div>
              ${progressPct === 100
        ? '<div class="sub-progress-complete">🎉 All lessons complete! Ready for the challenge.</div>'
        : ''}
            </div>

            <div class="modules-layout">
              <div class="modules-content">

                <!-- Classroom-style course header -->
                <div class="cl-header" style="--subject-color: ${m.subjectColor}">
                  <button class="btn btn-ghost btn-sm cl-back-btn" style="display:none" onclick="GKApp.backToModules()">← Today's Path</button>
                  <div class="cl-header-body">
                    <span class="cl-header-icon">${m.subjectIcon}</span>
                    <div class="cl-header-text">
                      <h2 class="cl-course-code">${topic.pageTitle || topic.name}</h2>
                      <p class="cl-course-meta">${mandatorySubtopics.length} lesson${mandatorySubtopics.length !== 1 ? 's' : ''}${optionalSubtopics.length > 0 ? ' · ' + optionalSubtopics.length + ' optional' : ''} · ${m.topicXP} XP available</p>
                    </div>
                    <span class="cl-expand-icon">▲</span>
                  </div>
                </div>

                <!-- Classroom accordion list -->
                <div class="cl-list">
                  ${mandatoryWithIdx.map(({ st, globalIdx, seqIdx }) => subtopicRow(st, globalIdx, seqIdx)).join('')}
                </div>

                ${optionalSubtopics.length > 0 ? `
                  <div class="optional-section">
                    <div class="optional-section-header" onclick="GKApp.toggleOptionalSubtopics()">
                      <span>💡 Optional Topics (${optionalSubtopics.length})</span>
                      <span class="optional-section-arrow">${state.optionalSubtopicsExpanded ? '▴' : '▾'}</span>
                    </div>
                    ${state.optionalSubtopicsExpanded ? `
                      <div class="cl-list optional-cl-list">
                        ${optionalWithIdx.map(({ st, globalIdx, seqIdx }) => subtopicRow(st, globalIdx, seqIdx)).join('')}
                      </div>` : ''}
                  </div>` : ''}

              </div>
            </div>
          </div>
        </div>
      </div>`;
  }

  function _hasLessonFlow(subtopic) {
    return !!(subtopic && subtopic.lessonFlow && subtopic.lessonFlow.cycles && subtopic.lessonFlow.cycles.length);
  }

  function _lessonFlowPhaseLabel(subtopic) {
    if (state.phase === 'game') return 'Practice activity';
    if (!_hasLessonFlow(subtopic)) {
      const n = (subtopic && subtopic.concepts && subtopic.concepts.length) || 1;
      return `Concept ${state.conceptIdx + 1} of ${n}`;
    }
    const flow = subtopic.lessonFlow;
    const cycleNum = state.conceptIdx + 1;
    const cycleTotal = flow.cycles.length;
    const labels = {
      hook: `Curiosity hook · Part ${cycleNum} of ${cycleTotal}`,
      concept: `Concept card · Part ${cycleNum} of ${cycleTotal}`,
      'deep-dive': 'Deep dive zone',
      project: 'Project activity'
    };
    return labels[state.lessonPhase] || `Lesson · Part ${cycleNum} of ${cycleTotal}`;
  }

  function _lessonFlowWorkspacePhase(subtopic) {
    if (!_hasLessonFlow(subtopic)) {
      return state.phase === 'game' ? 'Interactive practice' : 'Guided concept';
    }
    const map = {
      hook: 'Curiosity hook',
      concept: 'Concept card',
      'deep-dive': 'Deep dive',
      project: 'Project activity'
    };
    return map[state.lessonPhase] || 'Lesson';
  }

  function _currentLessonCycle(subtopic) {
    if (!_hasLessonFlow(subtopic)) return null;
    return subtopic.lessonFlow.cycles[state.conceptIdx] || null;
  }

  function _escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _escapeAttr(text) {
    return _escapeHtml(text).replace(/'/g, '&#39;');
  }

  function _resolveConceptVideoEmbed(concept) {
    if (!concept || typeof GKContentLoader === 'undefined') return concept?.videoEmbed || null;
    const link = concept.videoLink || concept.videoUrl || '';
    return GKContentLoader.parseVideoEmbed(link)
      || concept.videoEmbed
      || null;
  }

  function _conceptVideoTitle(concept) {
    const title = concept.videoTitle || concept.video || '';
    if (!title) return '';
    if (typeof GKContentLoader !== 'undefined' && GKContentLoader.extractVideoUrl(title)) return '';
    if (/^https?:\/\//i.test(String(title).trim()) || /<iframe\b/i.test(title)) return '';
    return String(title).trim();
  }

  function _renderConceptVideoPlayer(embed, displayTitle) {
    if (!embed) return '';
    const titleHtml = displayTitle
      ? `<div class="concept-video-label">${_escapeHtml(displayTitle)}</div>`
      : '';
    if (embed.kind === 'iframe') {
      return `
        <div class="concept-video-wrap">
          ${titleHtml}
          <div class="concept-video-frame">
            <iframe
              src="${_escapeAttr(embed.src)}"
              title="${_escapeAttr(displayTitle || 'Lesson video')}"
              frameborder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowfullscreen
              loading="lazy"
              referrerpolicy="strict-origin-when-cross-origin"></iframe>
          </div>
        </div>`;
    }
    if (embed.kind === 'video') {
      return `
        <div class="concept-video-wrap">
          ${titleHtml}
          <video class="concept-video-native" controls playsinline preload="metadata" src="${_escapeAttr(embed.src)}"></video>
        </div>`;
    }
    if (embed.kind === 'link') {
      return `
        <div class="concept-video-wrap concept-video-fallback">
          ${titleHtml}
          <a class="btn btn-primary" href="${_escapeAttr(embed.href)}" target="_blank" rel="noopener noreferrer">▶ Open video in new tab</a>
        </div>`;
    }
    return '';
  }

  function _renderConceptVideoSection(concept) {
    const displayTitle = _conceptVideoTitle(concept);
    const embed = _resolveConceptVideoEmbed(concept);
    const hasVideoSlot = displayTitle || embed || concept.videoLink || concept.videoUrl || concept.video;

    if (!hasVideoSlot) return '';

    if (embed) {
      return _renderConceptVideoPlayer(embed, displayTitle);
    }

    return `
      <div class="concept-video-wrap">
        ${displayTitle ? `<div class="concept-video-label">${_escapeHtml(displayTitle)}</div>` : ''}
        <div class="concept-video-placeholder">
          <p class="concept-video-placeholder-text">Paste your link for the video to be shown</p>
        </div>
      </div>`;
  }

  function _renderConceptMedia(concept) {
    if (!concept) return '';
    const blocks = [];

    if (concept.keyword) {
      blocks.push(`<div class="concept-meta-line"><strong>Keyword:</strong> ${_escapeHtml(concept.keyword)}</div>`);
    }

    const videoSection = _renderConceptVideoSection(concept);
    if (videoSection) blocks.push(videoSection);

    const imageSrc = concept.image && /^https?:\/\//i.test(concept.image) ? concept.image : null;
    if (imageSrc) {
      blocks.push(`<div class="concept-image-wrap"><img src="${_escapeAttr(imageSrc)}" alt="" loading="lazy" /></div>`);
    } else if (concept.image) {
      blocks.push(`<div class="concept-meta-line">${_escapeHtml(concept.image)}</div>`);
    }

    if (concept.observe) {
      blocks.push(`<div class="concept-meta-line"><strong>Observe:</strong> ${_escapeHtml(concept.observe)}</div>`);
    }

    if (!blocks.length && concept.visual && concept.visual !== '📖') {
      blocks.push(`<div class="concept-visual-legacy"><code>${_escapeHtml(concept.visual)}</code></div>`);
    }

    if (!blocks.length) return '';
    return `<div class="concept-media">${blocks.join('')}</div>`;
  }

  function _renderLessonCardShell(badge, title, body, examples, actionsHtml) {
    return `
      <div class="concept-card lesson-flow-card">
        <div class="lesson-phase-badge">${badge}</div>
        <h2 class="concept-title">${_escapeHtml(title)}</h2>
        <p class="concept-body">${_escapeHtml(body).replace(/\n/g, '<br>')}</p>
        ${examples && examples.length ? `
        <div class="concept-examples">
          <strong>Think about:</strong>
          <ul>${examples.map(e => `<li>${_escapeHtml(e)}</li>`).join('')}</ul>
        </div>` : ''}
        <div class="concept-actions">${actionsHtml}</div>
      </div>`;
  }

  function renderLessonFlowContent(subtopic) {
    const flow = subtopic.lessonFlow;
    const cycle = _currentLessonCycle(subtopic);
    const cycleTotal = flow.cycles.length;
    const canPrev = state.lessonPhase === 'concept' || (state.lessonPhase === 'hook' && state.conceptIdx > 0);

    if (state.lessonPhase === 'hook' && cycle && !cycle.hook && cycle.concept) {
      state.lessonPhase = 'concept';
    }

    if (state.lessonPhase === 'hook' && cycle && cycle.hook) {
      const backBtn = canPrev
        ? `<button class="btn btn-ghost" onclick="GKApp.prevLessonFlow()">← Back</button>`
        : '';
      return _renderLessonCardShell(
        `✨ Curiosity hook · ${state.conceptIdx + 1}/${cycleTotal}`,
        cycle.hook.title,
        cycle.hook.body,
        cycle.hook.examples,
        `${backBtn}<button class="btn btn-primary" onclick="GKApp.advanceLessonFlow()">Continue to concept →</button>`
      );
    }

    if (state.lessonPhase === 'concept' && cycle && cycle.concept) {
      const backBtn = `<button class="btn btn-ghost" onclick="GKApp.prevLessonFlow()">← Back</button>`;
      const c = cycle.concept;
      return `
        <div class="concept-card lesson-flow-card">
          <div class="lesson-phase-badge">📖 Concept card · ${state.conceptIdx + 1}/${cycleTotal}</div>
          <h2 class="concept-title">${_escapeHtml(c.title)}</h2>
          <p class="concept-body">${_escapeHtml(c.body).replace(/\n/g, '<br>')}</p>
          ${_renderConceptMedia(c)}
          ${c.examples && c.examples.length ? `
          <div class="concept-examples">
            <strong>Examples:</strong>
            <ul>${c.examples.map(e => `<li>${_escapeHtml(e)}</li>`).join('')}</ul>
          </div>` : ''}
          <div class="concept-actions">
            ${backBtn}
            <button class="btn btn-primary" onclick="GKApp.advanceLessonFlow()">
              ${cycle.lightAssessment && cycle.lightAssessment.length ? 'Quick check →' : 'Next →'}
            </button>
          </div>
        </div>`;
    }

    if (state.lessonPhase === 'deep-dive' && flow.deepDive) {
      const d = flow.deepDive;
      return _renderLessonCardShell(
        '🔍 Deep dive zone',
        d.title,
        d.body,
        d.examples,
        `<button class="btn btn-primary" onclick="GKApp.advanceLessonFlow()">
          ${flow.finalAssessment && flow.finalAssessment.length ? 'Chapter assessment →' : 'Continue →'}
        </button>`
      );
    }

    if (state.lessonPhase === 'project' && flow.project) {
      const p = flow.project;
      const projectList = (p.projects || []).slice(0, 6).map(pr => `
        <li><strong>${_escapeHtml(pr.project_title || pr.title || 'Project')}</strong>
          ${pr.project_objective ? `<br><span class="tlc-desc">${_escapeHtml(pr.project_objective)}</span>` : ''}
        </li>`).join('');
      return `
        <div class="concept-card lesson-flow-card">
          <div class="lesson-phase-badge">🛠️ Project activity</div>
          <h2 class="concept-title">${_escapeHtml(p.title)}</h2>
          <p class="concept-body">${_escapeHtml(p.body).replace(/\n/g, '<br>')}</p>
          ${projectList ? `<div class="concept-examples"><strong>Choose a challenge:</strong><ul>${projectList}</ul></div>` : ''}
          <div class="concept-actions">
            <button class="btn btn-primary" onclick="GKApp.completeLessonFlow()">Finish lesson ✓</button>
          </div>
        </div>`;
    }

    return renderConceptContent(subtopic);
  }

  function _startLessonFlowAt(subtopic, cycleIdx, phase) {
    state.conceptIdx = cycleIdx;
    state.lessonPhase = phase;
    state.phase = 'concepts';
    state.gameState = {};
    state.aiMessages = [];
    if (phase === 'hook') {
      const cycle = subtopic.lessonFlow.cycles[cycleIdx];
      if (!cycle || !cycle.hook) state.lessonPhase = 'concept';
    }
    navigate('learning');
  }

  function advanceLessonFlow() {
    const subtopic = _getCurrentSubtopic();
    if (!_hasLessonFlow(subtopic)) {
      nextConcept();
      return;
    }
    const flow = subtopic.lessonFlow;
    const cycle = _currentLessonCycle(subtopic);

    if (state.lessonPhase === 'hook') {
      state.lessonPhase = 'concept';
      const m = state.modules[state.activeModuleIdx];
      const conceptKey = `${m.subjectId}-${m.topicId}-${state.activeSubtopicIdx}-${state.conceptIdx}-concept`;
      if (!state.seenConcepts.has(conceptKey)) {
        GKXPManager.awardXP(state.user.id, 'conceptRead');
        state.seenConcepts.add(conceptKey);
      }
      render();
      _pushLiveState();
      return;
    }

    if (state.lessonPhase === 'concept') {
      if (cycle && cycle.lightAssessment && cycle.lightAssessment.length) {
        GKAssessment.init(cycle.lightAssessment);
        state._lessonFlowMode = 'light';
        state._isFinalAssessment = false;
        navigate('assessment');
        return;
      }
      _lessonFlowAfterLightAssessment();
      return;
    }

    if (state.lessonPhase === 'deep-dive') {
      state.lessonPhase = 'project';
      if (!flow.project) {
        completeLessonFlow();
        return;
      }
      render();
      _pushLiveState();
      return;
    }

    if (state.lessonPhase === 'project') {
      completeLessonFlow();
    }
  }

  function prevLessonFlow() {
    const subtopic = _getCurrentSubtopic();
    if (!_hasLessonFlow(subtopic)) {
      prevConcept();
      return;
    }
    if (state.lessonPhase === 'concept') {
      const cycle = _currentLessonCycle(subtopic);
      if (cycle && cycle.hook) {
        state.lessonPhase = 'hook';
      } else if (state.conceptIdx > 0) {
        state.conceptIdx--;
        const prev = subtopic.lessonFlow.cycles[state.conceptIdx];
        state.lessonPhase = prev && prev.hook ? 'hook' : 'concept';
      }
      render();
      _pushLiveState();
      return;
    }
    if (state.lessonPhase === 'hook' && state.conceptIdx > 0) {
      state.conceptIdx--;
      const prev = subtopic.lessonFlow.cycles[state.conceptIdx];
      state.lessonPhase = prev && prev.concept ? 'concept' : 'hook';
      render();
      _pushLiveState();
    }
  }

  function _lessonFlowAfterLightAssessment() {
    const subtopic = _getCurrentSubtopic();
    if (!_hasLessonFlow(subtopic)) return;
    const flow = subtopic.lessonFlow;
    if (state.conceptIdx + 1 < flow.cycles.length) {
      _startLessonFlowAt(subtopic, state.conceptIdx + 1, 'hook');
      return;
    }
    
    state._afterSubtopicFeedback = 'lessonFlow-mid';
    const m = state.modules[state.activeModuleIdx];
    state._pendingTopicKey = m.topicId;
    state._pendingSubtopicKey = m.topicId + '-' + subtopic.id;
    navigate('subtopicFeedback');
  }

  function _continueLessonFlowAfterFeedback() {
    const subtopic = _getCurrentSubtopic();
    if (!_hasLessonFlow(subtopic)) return;
    const flow = subtopic.lessonFlow;
    
    if (flow.deepDive) {
      state.lessonPhase = 'deep-dive';
      state.phase = 'concepts';
      navigate('learning');
      return;
    }
    if (flow.project) {
      state.lessonPhase = 'project';
      navigate('learning');
      return;
    }
    completeLessonFlow();
  }

  function continueLessonFlowAfterLight() {
    state._lessonFlowMode = null;
    _lessonFlowAfterLightAssessment();
  }

  function continueLessonFlowAfterFinal() {
    state._lessonFlowMode = null;
    const subtopic = _getCurrentSubtopic();
    if (_hasLessonFlow(subtopic) && subtopic.lessonFlow.project) {
      state.lessonPhase = 'project';
      state.phase = 'concepts';
      navigate('learning');
      return;
    }
    completeLessonFlow();
  }

  function completeLessonFlow() {
    state.lessonPhase = null;
    state._lessonFlowMode = null;
    state.phase = 'concepts';
    state._lastAssessmentScore = state._lastAssessmentScore ?? 100;
    
    const m = state.modules[state.activeModuleIdx];
    if (!m) {
      navigate('subtopics');
      return;
    }
    const subtopic = _getCurrentSubtopic();
    if (subtopic) {
      const subtopicKey = m.topicId + '-' + subtopic.id;
      GKStore.recordSubtopicComplete(subtopicKey);
      GKStore.saveSubtopicScore(state.user.id, subtopicKey, 100, 100);
    }
    _maybeMarkTopicComplete(m);
    _refreshUserFromStore();
    
    const profile = GKStore.getUserProfile(state.user.id) || {};
    const session = GKStore.getSession() || {};
    const doneSet = new Set([...(profile.completedSubtopics || []), ...(session.completedSubtopics || [])]);
    const topicData = GKRecommender.getTopicData(m.subjectId, m.topicId);
    
    if (topicData) {
      const allSts = topicData.topic.subtopics.filter(st => st.mandatory !== false);
      const allDone = allSts.every(st => doneSet.has(m.topicId + '-' + st.id));
      if (allDone) {
        startChallenge();
        return;
      }
    }
    navigate('subtopics');
  }

  // ---- SCREEN 4: Learning ----
  function renderLearning() {
    const m = state.modules[state.activeModuleIdx];
    const topicData = GKRecommender.getTopicData(m.subjectId, m.topicId);
    if (!topicData) return '<div class="screen"><p>Topic not found.</p></div>';

    const { topic } = topicData;
    const subtopic = topic.subtopics[state.activeSubtopicIdx];
    if (!subtopic) return '<div class="screen"><p>Subtopic not found.</p></div>';

    const dots = topic.subtopics.map((st, i) => `
      <span class="nav-dot ${i === state.activeSubtopicIdx ? 'active' : i < state.activeSubtopicIdx ? 'done' : ''}"
        title="${st.name}"></span>`).join('');

    let mainContent;
    if (_hasLessonFlow(subtopic) && state.phase !== 'game') {
      mainContent = renderLessonFlowContent(subtopic);
    } else if (state.phase === 'game') {
      mainContent = renderGameContent(subtopic);
    } else {
      mainContent = renderConceptContent(subtopic);
    }

    // Apply the entrance animation class ONLY when first visiting this concept or game
    const currentViewId = `${subtopic.id}-${state.phase}-${state.lessonPhase || ''}-${state.conceptIdx}`;
    if (window._lastAnimViewId !== currentViewId) {
      mainContent = mainContent.replace('class="concept-card"', 'class="concept-card animate-entrance"')
        .replace('class="game-card"', 'class="game-card animate-entrance"');
      window._lastAnimViewId = currentViewId;
    }

    const subtopicPct = Math.round(((state.activeSubtopicIdx + 1) / topic.subtopics.length) * 100);
    const workspacePhase = _lessonFlowWorkspacePhase(subtopic);

    return `
      <div class="screen screen-learning learning-session-active ${state.sidebarCollapsed ? 'sidebar-nav-collapsed' : ''}">
        ${renderHeader()}
        ${state.sidebarCollapsed ? renderSidebarToggleBtn() : ''}
        ${renderSidebarMenu('topics', m.subjectId)}
        <div class="learning-session">
          ${renderLearningAgentPane('learning', m, topic, subtopic)}
          <div class="learning-workspace-pane workspace-pane">
            <header class="ws-header">
              <div class="ws-header-text">
                <div class="ws-title">${subtopic.name}</div>
                <div class="ws-sub">${m.subjectIcon} ${topic.name} · ${workspacePhase}</div>
              </div>
              <div class="ws-header-right">
                <div class="nav-dots ws-nav-dots">${dots}</div>
                <div class="mastery-pill">
                  <span>Lesson path</span>
                  <div class="mb-bar"><div class="mb-fill" style="width:${subtopicPct}%"></div></div>
                  <span class="mb-pct">${subtopicPct}%</span>
                </div>
                ${_scheduleBackBtnHtml()}
              </div>
            </header>
            <div class="ws-body">
              <div class="learning-main">
                ${mainContent}
              </div>
            </div>
          </div>
        </div>
      </div>`;
  }

  function renderConceptContent(subtopic) {
    const concept = subtopic.concepts[state.conceptIdx];
    const isLast = state.conceptIdx >= subtopic.concepts.length - 1;
    return `
      <div class="concept-card">
        <div class="concept-progress">
          Concept ${state.conceptIdx + 1} of ${subtopic.concepts.length}
        </div>
        <h2 class="concept-title">${concept.title}</h2>
        <p class="concept-body">${concept.body.replace(/\n/g, '<br>')}</p>
        ${_renderConceptMedia(concept)}
        <div class="concept-examples">
          <strong>Examples:</strong>
          <ul>${concept.examples.map(e => `<li>${e}</li>`).join('')}</ul>
        </div>
        <div class="concept-actions">
          ${state.conceptIdx > 0 ? `<button class="btn btn-ghost" onclick="GKApp.prevConcept()">← Back</button>` : ''}
          ${!isLast
        ? `<button class="btn btn-primary" onclick="GKApp.nextConcept()">Next Concept →</button>`
        : (subtopic.game
          ? `<button class="btn btn-accent" onclick="GKApp.startGame()">🎮 Play Game & Earn XP!</button>`
          : `<button class="btn btn-accent" onclick="GKApp.afterGame()">✅ Complete Lesson & Earn XP!</button>`)
      }
        </div>
      </div>`;
  }

  function renderGameContent(subtopic) {
    const { game } = subtopic;
    const gs = state.gameState;

    if (gs.completed) {
      return `
        <div class="game-result-card">
          <div class="game-result-icon">${gs.score === gs.total ? '🌟' : gs.score >= gs.total * 0.6 ? '⭐' : '💪'}</div>
          <h2>${gs.score === gs.total ? 'Perfect Score!' : gs.score >= gs.total * 0.6 ? 'Well Done!' : 'Keep Practicing!'}</h2>
          <p class="game-score">${gs.score} / ${gs.total} correct</p>
          ${gs.xpEarned > 0 ? `<div class="xp-badge">+${gs.xpEarned} XP earned! 🏆</div>` : ''}
          <button class="btn btn-primary" onclick="GKApp.afterGame()">
            Done! Quick Feedback →
          </button>
        </div>`;
    }

    if (!game) {
      return `
        <div class="game-card">
          <div class="game-header">
            <h2>✅ Lesson Complete</h2>
            <p class="game-instructions">You've finished all concepts for this subtopic!</p>
          </div>
          <p class="mt-md">Take a moment to reflect on what you've learned. Ready to move on?</p>
          <button class="btn btn-primary mt-lg" onclick="GKApp.afterGame()">Finish Subtopic →</button>
        </div>`;
    }

    if (game.type === 'classify') return renderClassifyGame(game, gs);
    if (game.type === 'mcq-game') return renderMCQGame(game, gs);
    if (game.type === 'graph-read') return renderGraphGame(game, gs);
    if (game.type === 'sequence-order') return renderSequenceGame(game, gs);
    if (game.type === 'breathe') return renderBreatheGame(game, gs);
    if (game.type === 'fill-blank') return renderFillBlankGame(game, gs);
    if (game.type === 'para-writing') return renderParaWritingGame(game, gs);
    return `<div class="game-card"><p>Game loading...</p></div>`;
  }

  function renderClassifyGame(game, gs) {
    if (!gs.selected) gs.selected = {};
    return `
      <div class="game-card">
        <div class="game-header">
          <h2>🎮 ${game.title}</h2>
          <p class="game-instructions">${game.instructions}</p>
        </div>
        <div class="classify-grid">
          ${game.items.map(item => {
      const sel = gs.selected[item.id];
      const isProper = item.num !== undefined ? item.num < item.den : false;
      let cls = 'classify-item';
      if (gs.submitted) {
        cls += isProper ? ' correct-item' : ' wrong-item';
        if (sel && isProper) cls += ' selected-correct';
        else if (sel && !isProper) cls += ' selected-wrong';
      } else if (sel) {
        cls += ' selected';
      }
      return `<button class="${cls}" onclick="GKApp.classifyToggle(${item.id})">${item.value}</button>`;
    }).join('')}
        </div>
        ${!gs.submitted
        ? `<button class="btn btn-primary mt-md" onclick="GKApp.submitClassify()">Check Answers ✓</button>`
        : `<div class="game-feedback">
              <p>${gs.score === gs.total ? '🌟 All correct!' : `${gs.score}/${gs.total} correct — great effort!`}</p>
              <button class="btn btn-accent mt-sm" onclick="GKApp.afterGame()">
                Done! Quick Feedback →
              </button>
            </div>`}
      </div>`;
  }

  function renderMCQGame(game, gs) {
    if (!gs.itemIdx) gs.itemIdx = 0;
    const item = game.items[gs.itemIdx];
    const answered = gs.answer !== undefined;
    return `
      <div class="game-card">
        <div class="game-header">
          <h2>🎮 ${game.title}</h2>
          <p class="game-instructions">Question ${gs.itemIdx + 1} of ${game.items.length}</p>
        </div>
        <div class="mcq-question">${item.question}</div>
        <div class="mcq-options">
          ${item.options.map((opt, i) => {
      let cls = 'mcq-option';
      if (answered) {
        cls += i === item.correct ? ' correct' : i === gs.answer ? ' wrong' : '';
      }
      return `<button class="${cls}" onclick="GKApp.answerMCQGame(${i})" ${answered ? 'disabled' : ''}>${opt}</button>`;
    }).join('')}
        </div>
        ${answered
        ? `<div class="mcq-hint">${gs.answer === item.correct ? '✅ Correct!' : `❌ Correct answer: ${item.options[item.correct]}`}<br><em>${item.hint}</em></div>
             <button class="btn btn-primary mt-md" onclick="GKApp.nextMCQGame()">
               ${gs.itemIdx + 1 < game.items.length ? 'Next →' : 'Finish Game 🎯'}
             </button>`
        : ''}
      </div>`;
  }

  function renderGraphGame(game, gs) {
    if (gs.qIdx === undefined) gs.qIdx = 0;
    const q = game.questions[gs.qIdx];
    const answered = gs.answer !== undefined;
    const data = game.data;

    const graphRows = data.rows.map(row => {
      const count = row.symbols;
      const symbols = Array(count).fill(row.emoji).join(' ');
      return `<tr><td class="graph-label">${row.label}</td><td class="graph-cells">${symbols}</td><td class="graph-count">${count * data.keyValue}</td></tr>`;
    }).join('');

    return `
      <div class="game-card">
        <div class="game-header">
          <h2>🎮 ${game.title}</h2>
          <p class="game-instructions">${game.instructions}</p>
        </div>
        <div class="graph-table-wrap">
          <table class="graph-table">
            <caption>${data.title}</caption>
            <thead><tr><th>Item</th><th>Data</th><th>Count</th></tr></thead>
            <tbody>${graphRows}</tbody>
          </table>
          <div class="graph-key">Key: ${data.keyLabel}</div>
        </div>
        <div class="graph-question">
          <strong>Q${gs.qIdx + 1}: ${q.q}</strong>
        </div>
        <div class="mcq-options">
          ${q.options.map((opt, i) => {
      const isCorrect = q.correctIdx !== undefined ? i === q.correctIdx : opt === q.answer;
      let cls = 'mcq-option';
      if (answered) cls += isCorrect ? ' correct' : i === gs.answer ? ' wrong' : '';
      return `<button class="${cls}" onclick="GKApp.answerGraph(${i})" ${answered ? 'disabled' : ''}>${opt}</button>`;
    }).join('')}
        </div>
        ${answered
        ? `<button class="btn btn-primary mt-md" onclick="GKApp.nextGraphQ()">
               ${gs.qIdx + 1 < game.questions.length ? 'Next Question →' : 'Finish Game 🎯'}
             </button>`
        : ''}
      </div>`;
  }

  function renderSequenceGame(game, gs) {
    if (!gs.order) gs.order = new Array(game.items.length).fill(null);
    if (!gs.nextNum) gs.nextNum = 1;
    return `
      <div class="game-card">
        <div class="game-header">
          <h2>🎮 ${game.title}</h2>
          <p class="game-instructions">${game.instructions} Click items in the correct order.</p>
        </div>
        <div class="sequence-grid">
          ${game.items.map((item, i) => {
      const pos = gs.order[i];
      const cls = 'seq-item' + (pos !== null ? ' seq-numbered' : '') + (gs.checked ? (item.correct === pos ? ' seq-correct' : ' seq-wrong') : '');
      return `<button class="${cls}" onclick="GKApp.seqClick(${i})" ${gs.checked ? 'disabled' : ''}>
              ${pos !== null ? `<span class="seq-num">${pos}</span>` : ''}
              <span class="seq-text">${item.pose || item.part}</span>
            </button>`;
    }).join('')}
        </div>
        ${!gs.checked
        ? `<button class="btn btn-primary mt-md" onclick="GKApp.checkSequence()" ${gs.order.includes(null) ? 'disabled' : ''}>Check Order ✓</button>`
        : `<div class="game-feedback">
              <p>${gs.score === game.items.length ? '🌟 Perfect order!' : `${gs.score}/${game.items.length} correct!`}</p>
              <button class="btn btn-accent mt-sm" onclick="GKApp.afterGame()">
                Done! Quick Feedback →
              </button>
            </div>`}
      </div>`;
  }

  function renderBreatheGame(game, gs) {
    const isRunning = gs.running;
    const step = gs.step || 0;
    const round = gs.round || 0;
    const phase = game.steps[step % game.steps.length];
    const done = gs.done;

    return `
      <div class="game-card breathe-game">
        <div class="game-header">
          <h2>🌬️ ${game.title}</h2>
          <p class="game-instructions">${game.instructions}</p>
        </div>
        <div class="breathe-circle-wrap">
          <div class="breathe-circle ${isRunning ? 'breathe-animate-' + (step % 4) : ''}"
               id="breathe-circle"
               style="${isRunning ? `background: ${phase.color}22; border-color: ${phase.color}` : ''}">
            <div class="breathe-phase">${isRunning ? phase.phase : '🧘'}</div>
            <div class="breathe-count" id="breathe-count">${isRunning ? phase.duration : ''}</div>
          </div>
        </div>
        ${isRunning ? `<p class="breathe-instruction">${phase.instruction}</p>
          <p class="breathe-rounds">Round ${round + 1} of ${game.rounds}</p>` : ''}
        ${done
        ? `<div class="game-feedback">
              <p>✨ ${game.rounds} rounds complete! How do you feel?</p>
              <div class="xp-badge">+${gs.xpEarned || 0} XP earned! 🏆</div>
              <button class="btn btn-accent mt-sm" onclick="GKApp.afterGame()">
                Done! Quick Feedback →
              </button>
            </div>`
        : !isRunning
          ? `<button class="btn btn-primary mt-md" onclick="GKApp.startBreathing()">▶ Start Breathing</button>`
          : `<button class="btn btn-ghost mt-md" onclick="GKApp.stopBreathing()">■ Stop</button>`}
      </div>`;
  }

  // ---- Fill-in-the-Blank Game ----
  function renderFillBlankGame(game, gs) {
    if (!gs.answers) gs.answers = {};
    return `
      <div class="game-card fill-blank-game">
        <div class="game-header">
          <h2>\u270d\ufe0f ${game.title}</h2>
          <p class="game-instructions">${game.instructions}</p>
        </div>
        <div class="fb-questions">
          ${game.sentences.map((s, i) => {
      const answered = gs.submitted;
      const userAns = gs.answers[i] || '';
      const isCorrect = answered && userAns.toLowerCase().trim() === s.answer.toLowerCase().trim();
      return `
              <div class="fb-sentence ${answered ? (isCorrect ? 'fb-correct' : 'fb-wrong') : ''}">
                <div class="fb-text">${s.text.replace('____',
        answered
          ? `<span class="fb-answer-inline ${isCorrect ? 'correct' : 'wrong'}">${userAns || '(empty)'}</span>`
          : `<input type="text" class="fb-input" id="fb-input-${i}" placeholder="Type answer"
                        value="${userAns}" oninput="GKApp._fbUpdate(${i}, this.value)" />`
      )}</div>
                ${answered && !isCorrect ? `<div class="fb-correct-answer">Correct: ${s.answer}</div>` : ''}
              </div>`;
    }).join('')}
        </div>
        ${!gs.submitted
        ? `<button class="btn btn-primary mt-md" onclick="GKApp.submitFillBlank()">Check Answers \u2705</button>`
        : `<div class="game-feedback">
              <p>${gs.score === gs.total ? '\ud83c\udf1f Perfect!' : gs.score >= gs.total * 0.6 ? '\u2b50 Well Done!' : '\ud83d\udcaa Keep Practicing!'}</p>
              <p class="game-score">${gs.score} / ${gs.total} correct</p>
              <button class="btn btn-primary mt-sm" onclick="GKApp.afterGame()">Done! Quick Feedback \u2192</button>
            </div>`}
      </div>`;
  }

  function submitFillBlank() {
    const gs = state.gameState;
    const m = state.modules[state.activeModuleIdx];
    const subtopic = m.topic.subtopics[state.activeSubtopicIdx];
    const game = subtopic.game;
    // Collect answers from inputs
    game.sentences.forEach((s, i) => {
      const input = document.getElementById(`fb-input-${i}`);
      if (input) gs.answers[i] = input.value;
    });
    gs.submitted = true;
    let score = 0;
    game.sentences.forEach((s, i) => {
      if ((gs.answers[i] || '').toLowerCase().trim() === s.answer.toLowerCase().trim()) score++;
    });
    gs.score = score;
    gs.total = game.sentences.length;
    gs.completed = false; // Show inline results first
    const xp = GKXPManager.awardXP(state.user.id, 'gameCompleted', score === gs.total ? 10 : 0);
    gs.xpEarned = xp;
    state.sessionXP += xp;
    if (xp > 0) gkConfetti(score === gs.total ? 24 : 14);
    render();
  }

  function _fbUpdate(idx, value) {
    state.gameState.answers[idx] = value;
  }

  // ---- Paragraph Writing Game ----
  function renderParaWritingGame(game, gs) {
    return `
      <div class="game-card para-writing-game">
        <div class="game-header">
          <h2>\ud83d\udcdd ${game.title}</h2>
          <p class="game-instructions">${game.instructions}</p>
        </div>
        <div class="pw-prompt">
          <div class="pw-prompt-text">${game.prompt}</div>
          ${game.hints ? `<div class="pw-hints"><strong>Hints:</strong> ${game.hints.join(', ')}</div>` : ''}
        </div>
        <div class="pw-writing-area">
          <textarea id="pw-textarea" class="pw-textarea" rows="6"
            placeholder="Write your answer here..."
            ${gs.submitted ? 'disabled' : ''}>${gs.answer || ''}</textarea>
          <div class="pw-word-count" id="pw-word-count">
            ${(gs.answer || '').split(/\s+/).filter(w => w).length} / ${game.minWords || 20} words minimum
          </div>
        </div>
        ${!gs.submitted
        ? `<button class="btn btn-primary mt-md" onclick="GKApp.submitParaWriting()">Submit Writing \ud83d\udcdd</button>`
        : `<div class="game-feedback">
              <p>\u2728 Great reflection! Writing helps deepen understanding.</p>
              ${game.sampleAnswer ? `<div class="pw-sample"><strong>Sample answer:</strong> ${game.sampleAnswer}</div>` : ''}
              <div class="xp-badge">+${gs.xpEarned || 0} XP earned! \ud83c\udfc6</div>
              <button class="btn btn-primary mt-sm" onclick="GKApp.afterGame()">Done! Quick Feedback \u2192</button>
            </div>`}
      </div>`;
  }

  function submitParaWriting() {
    const gs = state.gameState;
    const textarea = document.getElementById('pw-textarea');
    if (textarea) gs.answer = textarea.value;
    const wordCount = (gs.answer || '').split(/\s+/).filter(w => w).length;
    const m = state.modules[state.activeModuleIdx];
    const subtopic = m.topic.subtopics[state.activeSubtopicIdx];
    const game = subtopic.game;
    const minWords = game.minWords || 20;
    gs.submitted = true;
    gs.score = wordCount >= minWords ? 1 : 0;
    gs.total = 1;
    gs.completed = false;
    const xp = GKXPManager.awardXP(state.user.id, 'gameCompleted', wordCount >= minWords ? 10 : 0);
    gs.xpEarned = xp;
    state.sessionXP += xp;
    render();
  }


  // ---- SCREEN 5: Assessment (Challenge Zone) ----
  function _renderQuestionBody(q) {
    const qType = q.type || 'mcq';

    // ── True / False ──
    if (qType === 'true-false') {
      return `
        <div class="answer-options tf-options" id="answer-options">
          <button class="answer-btn tf-btn" onclick="GKApp.selectAnswer(0)">
            <span class="opt-label">✅</span> True
          </button>
          <button class="answer-btn tf-btn" onclick="GKApp.selectAnswer(1)">
            <span class="opt-label">❌</span> False
          </button>
        </div>`;
    }

    // ── Fill in the Blank ──
    if (qType === 'fill-blank') {
      return `
        <div class="fill-blank-wrap" id="answer-options">
          <input type="text" id="fill-blank-input" class="fill-blank-input" placeholder="Type your answer here…" autocomplete="off" />
          <button class="btn btn-primary mt-sm" onclick="GKApp.submitFillBlankAssessment()">Submit Answer</button>
        </div>`;
    }

    // ── Short Answer ──
    if (qType === 'short-answer') {
      return `
        <div class="fill-blank-wrap" id="answer-options">
          <textarea id="short-answer-input" class="short-answer-input" rows="3" placeholder="Write your answer…"></textarea>
          <button class="btn btn-primary mt-sm" onclick="GKApp.submitShortAnswer()">Submit Answer</button>
        </div>`;
    }

    // ── Multiple Correct (checkboxes) ──
    if (qType === 'multiple-correct') {
      return `
        <div class="answer-options mc-options" id="answer-options">
          ${q.options.map((opt, i) => `
            <label class="answer-btn mc-label">
              <input type="checkbox" class="mc-checkbox" data-idx="${i}" value="${i}" />
              <span class="opt-label">${String.fromCharCode(65 + i)}.</span>
              ${opt}
            </label>`).join('')}
          <button class="btn btn-primary mt-sm" onclick="GKApp.submitMultipleCorrect()">Submit</button>
        </div>`;
    }

    // ── File Upload (Image/Drawing) ──
    if (qType === 'file-upload') {
      return `
        <div class="file-upload-wrap" id="answer-options" style="text-align:center;">
          <p style="font-size:0.85rem;color:var(--text-light);margin-bottom:1rem;">Click below to upload your image:</p>
          <input type="file" id="assessment-file-upload" accept="image/png, image/jpeg, application/pdf" style="display:none;" onchange="document.getElementById('file-upload-name').textContent = this.files[0] ? this.files[0].name : 'No file chosen';" />
          <button class="btn btn-secondary" onclick="document.getElementById('assessment-file-upload').click()" style="margin-bottom:1rem; padding: 0.8rem 1.5rem; border: 2px dashed #C4882A; background: #FFFDE7; color: #6B3F1A; border-radius: 12px;">
            <span style="font-size: 1.2rem; display:block; margin-bottom: 0.3rem;">📷</span> Choose File
          </button>
          <div id="file-upload-name" style="font-size: 0.85rem; color: #666; font-style: italic; margin-bottom: 1rem;">No file chosen</div>
          <button class="btn btn-primary mt-sm" onclick="GKApp.submitFileUpload()" style="width:100%;">Submit Upload</button>
        </div>`;
    }

    // ── Ordering / Sequencing ──
    if (qType === 'ordering') {
      return `
        <div class="ordering-wrap" id="answer-options">
          <p style="font-size:0.85rem;color:var(--text-light);margin-bottom:0.5rem;">Click items in the correct order:</p>
          <div class="ordering-items" id="ordering-items">
            ${q.options.map((opt, i) => `
              <button class="answer-btn ordering-btn" data-idx="${i}" onclick="GKApp.selectOrderItem(${i})">
                ${opt}
              </button>`).join('')}
          </div>
          <div class="ordering-selected" id="ordering-selected" style="min-height:40px;margin-top:0.5rem;padding:0.5rem;background:#f5f5f5;border-radius:8px;font-size:0.85rem;color:#555;">
            Your order will appear here…
          </div>
          <button class="btn btn-primary mt-sm" onclick="GKApp.submitOrdering()">Submit Order</button>
        </div>`;
    }

    // ── Match the Following ──
    if (qType === 'match') {
      return `
        <div class="match-wrap" id="answer-options">
          <p style="font-size:0.85rem;color:var(--text-light);margin-bottom:0.5rem;">Match Column A with Column B:</p>
          ${q.pairs.map((pair, i) => `
            <div class="match-row" style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.5rem;">
              <span class="match-left" style="flex:1;font-weight:600;">${pair.left}</span>
              <span>→</span>
              <select class="match-select" id="match-select-${i}" style="flex:1;padding:0.4rem;border-radius:6px;border:1px solid #ccc;">
                <option value="">Select…</option>
                ${q.rightOptions.map(r => `<option value="${r}">${r}</option>`).join('')}
              </select>
            </div>`).join('')}
          <button class="btn btn-primary mt-sm" onclick="GKApp.submitMatch()">Submit Matches</button>
        </div>`;
    }

    // ── Default: Standard MCQ ──
    return `
      <div class="answer-options" id="answer-options">
        ${q.options.map((opt, i) => `
          <button class="answer-btn" data-idx="${i}" onclick="GKApp.selectAnswer(${i})">
            <span class="opt-label">${String.fromCharCode(65 + i)}.</span>
            ${opt}
          </button>`).join('')}
      </div>`;
  }

  function renderAssessment() {
    const q = GKAssessment.getCurrentQuestion();
    if (!q) {
      const results = GKAssessment.getResults();
      return renderAssessmentResults(results);
    }
    const assessTitle = state._lessonFlowMode === 'light'
      ? '⚡ Quick check'
      : (state._lessonFlowMode === 'final' ? '🏆 Chapter assessment' : '⚡ Challenge Zone');
    const assessSub = state._lessonFlowMode === 'light'
      ? 'Light assessment for this part of the lesson'
      : (state._lessonFlowMode === 'final'
        ? 'Final assessment for this chapter'
        : 'Test your understanding — you\'ve got this!');
    const qType = q.type || 'mcq';
    const typeLabels = {
      'mcq': '📝 Multiple Choice', 'true-false': '✅❌ True or False', 'fill-blank': '✏️ Fill in the Blank',
      'short-answer': '📝 Short Answer', 'multiple-correct': '☑️ Select All Correct', 'ordering': '🔢 Arrange in Order', 'match': '🔗 Match the Following'
    };
    const assessmentBody = `
            <div class="content-wrap">
              <div class="learning-schedule-bar">
                ${_scheduleBackBtnHtml()}
              </div>
              <div class="challenge-header">
                <h2>${assessTitle}</h2>
                <p>${assessSub}</p>
                ${state._lessonFlowMode ? '' : `
                <div class="xp-info-tip">
                  <span class="xp-info-icon" title="XP Rules">&#x2139;&#xFE0F;</span>
                  <span class="xp-info-text">1st attempt: +3 XP per correct | 2nd: +2 XP | 3rd+: +1 XP</span>
                </div>`}
              </div>
              <div class="assessment-progress">
                <div class="prog-bar">
                  <div class="prog-fill" style="width: ${(q.index / q.total) * 100}%"></div>
                </div>
                <span>Question ${q.index + 1} of ${q.total}</span>
              </div>
              <div class="question-card">
                <div class="q-type-badge" style="font-size:0.75rem;color:var(--primary);font-weight:600;margin-bottom:0.3rem;">${typeLabels[qType] || '📝 Question'}</div>
                <p class="question-text">${q.question}</p>
                ${_renderQuestionBody(q)}
                <div id="answer-feedback" class="answer-feedback hidden"></div>
                <button id="next-btn" class="btn btn-primary mt-md hidden"
                  onclick="GKApp.nextQuestion()">
                  ${q.index + 1 < q.total ? 'Next Question →' : 'See Results 🎯'}
                </button>
              </div>
            </div>`;

    if (state._lessonFlowMode) {
      return _renderLessonFlowAssessmentShell('assessment', assessmentBody);
    }

    return `
      <div class="screen screen-assessment">
        ${renderHeader()}
        <div class="screen-agent-row">
          ${_agentHtml('assessment')}
          <div class="agent-pane-spacer"></div>
          <div class="screen-content-col">
            ${assessmentBody}
          </div>
        </div>
      </div>`;
  }

  function renderAssessmentResults(results) {
    const perf = GKAssessment.getPerformanceLabel(results.percentage);
    const isFinal = state._isFinalAssessment;
    const lessonFlowMode = state._lessonFlowMode;
    const m = state.modules[state.activeModuleIdx];
    const topicKey = isFinal ? 'final' : `${m.subjectId}-${m.topicId}`;

    // Save to session store
    state._lastAssessmentScore = results.percentage; // Track for Krishna's feedback

    if (!lessonFlowMode) {
      GKStore.recordAssessmentResult(topicKey, results.score, results.total);
    }
    if (!lessonFlowMode) {
      GKStore.saveDetailedAssessmentResult(
        state.user.id, topicKey,
        results.score, results.total, results.answers
      );
    }
    // For subtopic-level pure assessment: also persist per-subtopic score so it
    // shows on the subtopics list after a page refresh
    if (!lessonFlowMode && !isFinal && state.user && state.activeSubtopicIdx !== undefined) {
      const st = _getCurrentSubtopic();
      if (st) {
        const stKey = m.topicId + '-' + st.id;
        GKStore.saveSubtopicScore(state.user.id, stKey, results.score, results.total);
        // Also mark subtopic as complete in the session for immediate UI update
        GKStore.recordSubtopicComplete(stKey);
      }
    }

    const passed = results.percentage >= 60;

    let actionBtn;
    if (lessonFlowMode === 'light') {
      actionBtn = `<button class="btn btn-primary" onclick="GKApp.continueLessonFlowAfterLight()">Continue lesson →</button>`;
    } else if (lessonFlowMode === 'final') {
      actionBtn = `<button class="btn btn-primary" onclick="GKApp.continueLessonFlowAfterFinal()">
        ${(_getCurrentSubtopic()?.lessonFlow?.project) ? 'Project activity →' : 'Finish lesson ✓'}
      </button>`;
    } else if (isFinal) {
      actionBtn = `<button class="btn btn-primary" onclick="GKApp.finishFinalAssessment()">Share Feedback 💬</button>`;
    } else {
      // After topic assessment → go to module feedback
      actionBtn = `<button class="btn btn-primary" onclick="GKApp.goToModuleFeedback()">
        Share Module Feedback 💬
      </button>`;
      
      // Award Topic Completion XP if passed and not already rewarded
      if (passed && state.user && !state.user.completedTopics?.includes(topicKey)) {
        const xp = GKXPManager.awardXP(state.user.id, 'topicCompleted');
        if (xp > 0 && state.user) state.user.totalXP = (state.user.totalXP || 0) + xp;
      }
    }

    const retakeBtn = (!isFinal && !lessonFlowMode) ? `
      <button class="btn btn-ghost mt-sm" onclick="GKApp.retakeChallenge()">
        🔄 Retake Challenge
      </button>` : '';

    const resultsBody = `
            <div class="content-wrap">
              <div class="learning-schedule-bar">
                ${_scheduleBackBtnHtml()}
              </div>
              <div class="results-card">
                <div class="results-icon">${isFinal ? '🏆' : (perf.label.split('!')[0].trim().split(' ').pop())}</div>
                <h2 style="color: ${perf.color}">${lessonFlowMode === 'light' ? 'Quick check complete!' : (lessonFlowMode === 'final' ? 'Chapter assessment complete!' : (isFinal ? 'Final Assessment Complete!' : perf.label))}</h2>
                <div class="score-ring">
                  <span class="score-num">${results.score}/${results.total}</span>
                  <span class="score-pct">${results.percentage}%</span>
                </div>
                <!-- Removed XP badge from assessment as per user request -->
                ${(() => {
        const bloom = GKXPManager.getBloomsLevel(results.percentage);
        return `
                  <div class="blooms-badge" style="margin-top:1rem; padding:0.8rem 1.2rem; border-radius:12px; background: linear-gradient(135deg, ${bloom.color}22, ${bloom.color}11); border: 2px solid ${bloom.color}; text-align:center;">
                    <div style="font-size:1.5rem;">${bloom.icon}</div>
                    <div style="font-weight:700; color:${bloom.color}; font-size:1.1rem;">${bloom.label}</div>
                    <div style="font-size:0.8rem; color:#666;">${bloom.desc} (Bloom's Taxonomy)</div>
                  </div>`;
      })()}
                ${!passed && !isFinal ? `
                  <div class="retake-hint">
                    <p>💡 Score below 60% — your mentor may suggest topics to revisit. You can always retake!</p>
                  </div>` : ''}
                <div class="answer-review">
                  ${results.answers.map((a, i) => `
                    <div class="review-item ${a.isCorrect ? 'review-correct' : 'review-wrong'}">
                      <span>${a.isCorrect ? '✅' : '❌'} Q${i + 1}</span>
                      ${!a.isCorrect ? `<span class="review-exp">${a.explanation}</span>` : ''}
                    </div>`).join('')}
                </div>
                <div class="results-actions">
                  ${actionBtn}
                  ${retakeBtn}
                </div>
              </div>
            </div>`;

    if (lessonFlowMode) {
      return _renderLessonFlowAssessmentShell('results', resultsBody);
    }

    return `
      <div class="screen screen-assessment">
        ${renderHeader()}
        <div class="screen-agent-row">
          ${_agentHtml('results')}
          <div class="agent-pane-spacer"></div>
          <div class="screen-content-col">
            ${resultsBody}
          </div>
        </div>
      </div>`;
  }

  // ---- SCREEN 5b: Subtopic Feedback (quick, 2 questions) ----
  function renderSubtopicFeedback() {
    const m = state.modules[state.activeModuleIdx];
    const topicData = GKRecommender.getTopicData(m.subjectId, m.topicId);
    const subtopicName = topicData
      ? topicData.topic.subtopics[state.activeSubtopicIdx].name
      : 'this subtopic';
    const responses = state.subtopicFeedbackResponses || {};

    return `
      <div class="screen screen-feedback">
        ${renderHeader()}
        <div class="screen-agent-row">
          ${_agentHtml('feedback')}
          <div class="agent-pane-spacer"></div>
          <div class="screen-content-col">
            <div class="content-wrap">
              <div class="feedback-header granular-feedback-header">
                <span class="feedback-badge">Quick Check-In</span>
                <h2>📝 How was "${subtopicName}"?</h2>
                <p>Share your quick thoughts about this lesson!</p>
              </div>
              <div class="feedback-form">
                <div class="feedback-question">
                  <p class="fq-text">★ What did you enjoy the most?</p>
                  <textarea id="stfb-enjoy" class="fq-textarea" placeholder="Write what you liked or found interesting..."
                    style="width:100%; min-height:80px; padding:1rem; border:2px solid #F5EDD8; border-radius:10px; font-family:inherit; font-size:1rem; resize:vertical;"></textarea>
                </div>
                <div class="feedback-question" style="margin-top:1.2rem;">
                  <p class="fq-text">🎯 What is the  improvement point u suggest?</p>
                  <textarea id="stfb-improve" class="fq-textarea" placeholder="Write anything you found difficult or want to get better at..."
                    style="width:100%; min-height:80px; padding:1rem; border:2px solid #F5EDD8; border-radius:10px; font-family:inherit; font-size:1rem; resize:vertical;"></textarea>
                </div>
                <div id="stfb-error" class="error-msg hidden">Please share at least one thought.</div>
                <div class="feedback-actions" style="margin-top:1.5rem;">
                  <button class="btn btn-primary" onclick="GKApp.submitSubtopicFeedback()">
                    Submit ✓
                  </button>
                  <button class="btn btn-ghost" onclick="GKApp.skipSubtopicFeedback()">
                    Skip
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>`;
  }

  // ---- SCREEN 5c: Module Feedback (3 questions, shown after challenge zone) ----
  function renderModuleFeedback() {
    const m = state.modules[state.activeModuleIdx];
    const topicName = m ? m.topicName : 'this module';
    const responses = state.moduleFeedbackResponses || {};

    return `
      <div class="screen screen-feedback">
        ${renderHeader()}
        <div class="screen-agent-row">
          ${_agentHtml('feedback')}
          <div class="agent-pane-spacer"></div>
          <div class="screen-content-col">
            <div class="content-wrap">
              <div class="feedback-header granular-feedback-header">
                <span class="feedback-badge">Module Review</span>
                <h2>🏅 How was "${topicName}"?</h2>
                <p>Tell your Guru what you learned and what you need help with.</p>
              </div>
              <div class="feedback-form">
                <div class="feedback-question">
                  <p class="fq-text">★ What did you enjoy the most about this module?</p>
                  <textarea id="mfb-enjoy" class="fq-textarea" placeholder="Write what you liked or found interesting..."
                    style="width:100%; min-height:80px; padding:1rem; border:2px solid #F5EDD8; border-radius:10px; font-family:inherit; font-size:1rem; resize:vertical;"></textarea>
                </div>
                <div class="feedback-question" style="margin-top:1.2rem;">
                  <p class="fq-text">🎯 What is your improvement point?</p>
                  <textarea id="mfb-improve" class="fq-textarea" placeholder="Write anything you found difficult or want to get better at..."
                    style="width:100%; min-height:80px; padding:1rem; border:2px solid #F5EDD8; border-radius:10px; font-family:inherit; font-size:1rem; resize:vertical;"></textarea>
                </div>
                <div id="mfb-error" class="error-msg hidden">Please share at least one thought.</div>
                <div class="feedback-actions">
                  <button class="btn btn-primary" onclick="GKApp.submitModuleFeedback()">
                    Submit ✓
                  </button>
                  <button class="btn btn-ghost" onclick="GKApp.skipModuleFeedback()">
                    Skip
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>`;
  }

  // ---- SCREEN 6: End-of-Session Feedback ----
  function renderFeedback() {
    return `
      <div class="screen screen-feedback">
        ${renderHeader()}
        <div class="screen-agent-row">
          ${_agentHtml('feedback')}
          <div class="agent-pane-spacer"></div>
          <div class="screen-content-col">
            <div class="content-wrap">
              <div class="feedback-header">
                <h2>💬 Share Your Experience</h2>
                <p>Your reflections help us personalize your next session!</p>
              </div>
              <div class="feedback-form">
                <div class="feedback-question">
                  <p class="fq-text">★ What did you enjoy the most in today's session?</p>
                  <textarea id="fb-enjoy" class="fq-textarea" placeholder="Write anything you liked, found interesting or fun..."
                    style="width:100%; min-height:100px; padding:1rem; border:2px solid #F5EDD8; border-radius:10px; font-family:inherit; font-size:1rem; resize:vertical;"></textarea>
                </div>
                <div class="feedback-question" style="margin-top:1.2rem;">
                  <p class="fq-text">🎯 What is one thing you want to improve or understand better?</p>
                  <textarea id="fb-improve" class="fq-textarea" placeholder="Write anything you found difficult, unclear, or want to revisit..."
                    style="width:100%; min-height:100px; padding:1rem; border:2px solid #F5EDD8; border-radius:10px; font-family:inherit; font-size:1rem; resize:vertical;"></textarea>
                </div>
                <div id="fb-error" class="error-msg hidden">Please share at least one thought before submitting.</div>
                <button class="btn btn-primary btn-full mt-md" onclick="GKApp.submitFeedback()">
                  Submit Feedback ✨
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>`;
  }

  // ---- SCREEN 7: Summary ----
  function renderSummary() {
    const session = GKStore.getSession() || {};
    const user = state.user;
    const totalXPSummary = GKStore.getTotalXP(user.id);
    const level = GKXPManager.getLevelForXP(totalXPSummary);
    const nextLevel = GKXPManager.getNextLevel(totalXPSummary);
    const progress = GKXPManager.getProgressToNext(totalXPSummary);
    const assessResults = session.assessmentResults || {};
    const completedSubs = session.completedSubtopics || [];

    return `
      <div class="screen screen-summary">
        ${renderHeader(true)}
        <div class="screen-agent-row">
          ${_agentHtml('summary')}
          <div class="agent-pane-spacer"></div>
          <div class="screen-content-col">
            <div class="content-wrap" style="padding: 1rem 2rem;">
              <div class="summary-hero" style="text-align:center; margin-bottom: 1rem;">
                <div class="summary-avatar" style="width:80px; height:80px; margin: 0 auto 0.5rem; border-radius:50%; overflow:hidden; border:4px solid #E2C9A0; display:flex; align-items:center; justify-content:center; background:#fff;">
                  ${user.photo ? `<img src="${user.photo}" style="width:100%; height:100%; object-fit:cover;"/>` : `<div style="font-size:2.5rem;">${user.avatar}</div>`}
                </div>
                <h2 style="font-size:1.5rem; color:#6B3F1A; margin-bottom:0.2rem;">Excellent Work, ${user.displayName}! 🌟</h2>
                <p style="color:#888; font-size:0.9rem;">Session complete. Here's what you achieved today.</p>
              </div>

              <div class="xp-section" style="background:#fff; padding:1.2rem; border-radius:15px; border:1px solid #eee; margin-bottom:1.5rem;">
                <div class="xp-earned" style="font-size:1.3rem; font-weight:700; color:#4A7C59; text-align:center; margin-bottom:0.8rem;">+${session.xpEarned || 0} XP Earned Today</div>
                <div class="level-info" style="display:flex; justify-content:center; gap:1rem; align-items:center; margin-bottom:0.8rem; font-weight:600;">
                  <span style="color:#C4882A;">${level.icon} ${level.title}</span>
                  ${nextLevel ? `<span style="color:#888;">→ ${nextLevel.icon} ${nextLevel.title}</span>` : '<span>Max Level! 🏆</span>'}
                </div>
                <div class="prog-bar mt-sm" style="height:12px; background:#f5f5f5; border-radius:6px; overflow:hidden;">
                  <div class="prog-fill" style="width: ${progress}%; height:100%; background:linear-gradient(90deg, #4A7C59, #6B3F1A);"></div>
                </div>
                <div class="prog-label" style="font-size:0.8rem; color:#888; text-align:center; margin-top:0.5rem;">${progress}% to next level · Total: ${totalXPSummary} XP</div>
              </div>

              ${completedSubs.length > 0 ? `
              <div class="summary-section" style="margin-bottom:1.5rem;">
                <h3 style="font-size:1rem; color:#6B3F1A; margin-bottom:0.6rem; border-bottom:2px solid #F5EDD8; padding-bottom:0.4rem;">Topics Completed ✅</h3>
                <ul class="completed-list" style="list-style:none; padding:0; display:grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap:0.5rem;">
                  ${completedSubs.map(id => `<li style="background:#F1F8E9; padding:0.5rem 0.8rem; border-radius:10px; font-size:0.85rem; color:#2E7D32; display:flex; align-items:center; gap:0.4rem;">✅ ${id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</li>`).join('')}
                </ul>
              </div>` : ''}

              <div class="summary-actions" style="display:flex; flex-direction:column; gap:0.6rem; margin-top:1.5rem;">
                <button class="btn btn-primary" onclick="GKApp.startNewSession()" style="padding:0.8rem; font-size:1rem; border-radius:30px;">
                  🚀 Start New Session
                </button>
                <button class="btn btn-ghost" onclick="GKApp.navigate('modules')" style="padding:0.6rem; border-radius:30px; border:2px solid var(--primary); color:var(--primary); font-weight:600;">
                  Continue Learning
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>`;
  }

  // ---- Shared Header ----
  function renderHeader(showProfile = true, showLogout = true, headerExtraHtml = '') {
    if (!state.user) return '';
    const totalXP = GKStore.getTotalXP(state.user.id);
    const level = GKXPManager.getLevelForXP(totalXP);
    const sessionXP = (GKStore.getSession() || {}).xpEarned || 0;

    const logoutHtml = showLogout ? `
      <button onclick="GKApp.logout()" style="font-size:0.75rem; color:#C4882A; padding:0; background:none; border:none; cursor:pointer; font-weight:600;">Sign Out</button>
    ` : '';

    const profileHtml = showProfile ? `
          <div class="user-info" style="display:flex; align-items:center; gap: 0.6rem;">
            <div class="header-avatar" style="width:60px; height:60px; border-radius:50%; overflow:hidden; border:2px solid #E2C9A0;">
              ${state.user.photo ? `<img src="${state.user.photo}" style="width:100%; height:100%; object-fit:cover;"/>` : `<div style="width:100%; height:100%; background:#FFF9C4; display:flex; align-items:center; justify-content:center; font-size:1.4rem;">${state.user.avatar}</div>`}
            </div>
            <div style="text-align:left;">
              <div style="font-size:0.9rem; font-weight:600; color:#2D1B0E;">${state.user.displayName}</div>
              <div style="display:flex; align-items:center; gap:0.5rem; margin-top:4px;">
                ${logoutHtml}
              </div>
            </div>
          </div>
        ` : `
        <div class="header-profile" style="display:flex; align-items:center; gap: 1rem;">
           ${showLogout ? `<button onclick="GKApp.logout()" style="font-size:1rem; color:#C4882A; padding:0; background:none; border:none; cursor:pointer; font-weight:600;">Sign Out</button>` : ''}
        </div>`;

    return `
      <header class="app-header ev-header" style="display:flex; align-items:center; justify-content:space-between; padding: 0.8rem 1.5rem; background:#fff; border-bottom: 1px solid #eee; margin-bottom: 0.5rem; border-radius: 12px 12px 0 0;">
        <div class="header-branding" style="display:flex; align-items:center;">
          <img src="${GKBranding.logoPath()}" alt="${GKBranding.schoolName()}" style="width:40px; height:auto; margin-right: 0.6rem;" />
          <div style="text-align:left;">
            <div style="font-size:1.1rem; font-weight:700; color:#6B3F1A; line-height:1;">${GKBranding.schoolName()}</div>
            <div style="font-size:0.75rem; color:#888; margin-top:2px;">${GKBranding.tagline()}</div>
          </div>
        </div>
        <div class="header-actions" style="display:flex; align-items:center; gap:0.65rem;">
          ${headerExtraHtml}
          ${profileHtml}
        </div>
      </header>`;
  }

  // ---- Event Attachment ----
  function attachEvents(screen) {
    if (typeof checkNotifications === 'function') checkNotifications();
    if (screen === 'login') {
      const form = document.getElementById('login-form');
      if (form) form.addEventListener('submit', handleLogin);
    }
    if (screen === 'modules') {
      GKAITutor.setContext([
        "Click any topic card to start — your path is optimized for your energy today!",
        "Start from the top card — it's chosen to match your current mood.",
        "Ask me about any topic before you begin. I'm here to help!",
        "Wellness topics like Yoga and Meditation recharge energy for deeper learning."
      ]);
    }
    if (screen === 'subtopics') {
      const m = state.modules[state.activeModuleIdx];
      const topicData = GKRecommender.getTopicData(m.subjectId, m.topicId);
      const topicName = topicData ? topicData.topic.name : 'this topic';
      GKAITutor.setContext([
        `Let's learn about ${topicName}! Tap any lesson to jump straight in.`,
        "Complete each subtopic in order for the best learning experience!",
        "After finishing all subtopics, you'll unlock the Challenge Zone ⚡",
        "Ask me anything about the subtopics — I'm ready to help!"
      ]);
    }
    if (screen === 'learning') {
      const input = document.getElementById('ai-input');
      if (input) input.focus();
      const m = state.modules[state.activeModuleIdx];
      const topicData = GKRecommender.getTopicData(m.subjectId, m.topicId);
      if (topicData) {
        const subtopic = topicData.topic.subtopics[state.activeSubtopicIdx];
        if (subtopic) GKAITutor.setContext(subtopic.aiHints);
      }
      if (state.phase === 'concepts') {
        // Removed awardXP from here to prevent infinite loop on render
      }
    }
  }

  // ---- Helpers ----

  function _isModuleDoneInSession(m) {
    const session = GKStore.getSession() || {};
    const sessionResults = session.assessmentResults || {};
    const topicKey = `${m.subjectId}-${m.topicId}`;
    return !!sessionResults[topicKey];
  }

  function _moduleTypeBadge(m) {
    if (m.mandatory && m.moduleType === 'standard') return '🏅 Mandatory';
    if (m.moduleType === 'advanced') return '🚀 Advanced';
    if (m.moduleType === 'suggested') return '💡 Suggested';
    if (m.moduleType === 'next-path') return '🎓 Next Level';
    return null;
  }

  function _subtopicTypeBadge(st) {
    if (st.mandatory && (st.subtopicType === 'core' || !st.subtopicType)) return '🏅 Mandatory';
    if (st.subtopicType === 'advanced') return '💡 Suggested';
    if (st.subtopicType === 'challenge') return '⚡ Challenge';
    return null;
  }

  // Suggested + next-path modules are hidden until mentor explicitly unlocks them.
  // Standard modules are always visible. Suggested modules are always hidden from Today's Path
  // (their subtopics appear in the Optional section inside mandatory modules).
  // Next-path modules appear only after mentor promotes the student.
  function _isTopicHidden(m, unlockedTopics) {
    if (m.moduleType === 'suggested') return true;
    if (m.subjectId === 'english') return false;
    if (m.moduleType === 'next-path') {
      const key = `${m.subjectId}-${m.topicId}`;
      return !(unlockedTopics && unlockedTopics.includes(key));
    }
    return false;
  }

  /** Modules for timetable/schedule: path topics with published: true only (from backend config). */
  function _assignStudentModules(calibration, completedTopics, unlockedTopics) {
    const published = GKStore.getPublishedTopicIds(state.user.id);
    const modules = GKRecommender.getRecommendedModules(calibration, completedTopics || [])
      .filter(m => !_isTopicHidden(m, unlockedTopics))
      .filter(m => !published || published.has(m.topicId))
      .map((m, idx) => ({ ...m, _origIdx: idx }));
    state.modules = modules;
    _syncModuleTopicDescriptions();
    return state.modules;
  }

  /** Rebuild module list when opening schedule if mood flow did not run (e.g. page refresh). */
  function _ensureStudentModules() {
    if (!state.user || (state.modules && state.modules.length > 0)) return;
    const session = GKStore.getSession();
    if (session?.mood) {
      state.mood = session.mood;
      state.calibration = GKMoodEngine.calibrateSession(
        session.mood.brainBattery, session.mood.currentVibe
      );
    }
    if (!state.calibration) return;
    const profile = GKAuth.refreshUser();
    const unlockedTopics = profile.unlockedTopics || [];
    state.modules = _assignStudentModules(
      state.calibration,
      profile.completedTopics || [],
      unlockedTopics
    );
    if (state.modules.length) _syncTimetableWithMood();
  }

  // ---- Event Handlers ----
  function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const result = GKAuth.login(username, password);
    if (!result.success) {
      const errEl = document.getElementById('login-error');
      errEl.textContent = result.error;
      errEl.classList.remove('hidden');
      return;
    }
    state.user = result.user;
    _syncAssistantForUser(state.user.id);
    state.aiMessages = [];
    navigate('mood');
  }

  function updateBattery(val) {
    const el = document.getElementById('battery-display');
    const descEl = document.getElementById('battery-text-desc');
    if (el) el.textContent = `${val}%`;
    if (descEl) {
      if (val < 30) descEl.textContent = "Need a gentle start today 😌";
      else if (val < 70) descEl.textContent = "Feeling balanced and ready ⚖️";
      else descEl.textContent = "High energy, bring it on! ⚡";
    }
  }

  function selectVibe(vibe) {
    document.querySelectorAll('.vibe-btn').forEach(b => b.classList.remove('selected'));
    document.querySelectorAll(`[data-vibe="${vibe}"]`).forEach(b => b.classList.add('selected'));
    state._selectedVibe = vibe;

    // Update vibe description text
    const descEl = document.getElementById('vibe-desc');
    if (descEl && GKMoodEngine.VIBE_LABELS[vibe]) {
      descEl.textContent = GKMoodEngine.VIBE_LABELS[vibe].desc || '';
    }
  }

  // Krishna messages for each of the 6 mood games
  function _gameKrishnaMsg(battery, vibe) {
    const name = state.user ? state.user.displayName : 'Student';
    const type = GKMoodGame.getGameType(battery, vibe);
    const msgs = {
      breathing: `I can see you need a gentle moment, ${name}. Let's breathe together before we begin 🫧`,
      star_tap: `High energy — I love it, ${name}! Let's channel it — catch those stars before they vanish! ⭐`,
      word_zen: `Let's calm and focus the mind, ${name}. Unscramble these words and feel your thoughts settle 🌿`,
      speed_math: `Your energy is good today, ${name}! Let's warm up those brain cells with some quick maths ⚡`,
      memory_flip: `Excellent energy, ${name}! Let's channel it into a memory challenge — find all the pairs! 🧩`,
      lightning_quiz: `You're on fire, ${name}! Let's put that energy to good use — lightning quiz time! 🏆`
    };
    return msgs[type] || `Let's play a quick game before we begin, ${name}! 🎮`;
  }

  function submitMood() {
    const battery = parseInt(document.getElementById('brain-battery').value, 10);
    const vibe = state._selectedVibe || document.querySelector('.vibe-btn.selected')?.dataset.vibe || 'high_energy';
    state.mood = { brainBattery: battery, currentVibe: vibe };
    state.calibration = GKMoodEngine.calibrateSession(battery, vibe);
    GKStore.startSession(state.user.id, state.mood);

    // Update streak on session start
    GKXPManager.updateStreak(state.user.id);

    const profile = GKAuth.refreshUser();
    const unlockedTopics = profile.unlockedTopics || [];
    state.modules = _assignStudentModules(
      state.calibration,
      profile.completedTopics || [],
      unlockedTopics
    );

    _syncTimetableWithMood();

    state.expandedDoneModules = new Set();
    state.optionalSubtopicsExpanded = false;
    state.aiMessages = [];

    // Switch mood screen from inputs → inline game
    const inputsEl = document.getElementById('mood-inputs-section');
    const gameEl = document.getElementById('mood-game-section');
    if (inputsEl) inputsEl.style.display = 'none';
    if (gameEl) gameEl.style.display = 'block';

    // Update Krishna bubble with game-specific message
    const krishnaWrap = document.getElementById('mood-krishna-wrap');
    if (krishnaWrap) {
      const gameMsg = _gameKrishnaMsg(battery, vibe);
      krishnaWrap.innerHTML = `
        <div class="krishna-initiator-wrap" id="krishna-init">
          <div class="krishna-img-box">
            ${_assistantAvatarImg('ancientGame')}
          </div>
          <div class="krishna-speech-bubble">
            ${gameMsg}
            <button class="gk-voice-toggle" onclick="GKVoice.toggle(this)" title="Toggle Krishna voice"
              style="background:none;border:none;cursor:pointer;font-size:1rem;opacity:0.65;padding:0.15rem 0.3rem;float:right;line-height:1;" aria-label="Toggle voice">${GKVoice.isEnabled() ? '🔊' : '🔇'}</button>
          </div>
        </div>`;
      GKVoice.speak(gameMsg);
    }

    // Render game inline — "Let's Go!" inside the game navigates forward
    GKMoodGame.renderInto('mood-game-host', battery, vibe, () => {
      navigate('ancientGame');
    });
  }

  function skipToLearning() {
    const battery = parseInt(document.getElementById('brain-battery').value, 10);
    const vibe = state._selectedVibe || document.querySelector('.vibe-btn.selected')?.dataset.vibe || 'high_energy';
    state.mood = { brainBattery: battery, currentVibe: vibe };
    state.calibration = GKMoodEngine.calibrateSession(battery, vibe);
    GKStore.startSession(state.user.id, state.mood);
    GKXPManager.updateStreak(state.user.id);
    const profile = GKAuth.refreshUser();
    const unlockedTopics = profile.unlockedTopics || [];
    state.modules = _assignStudentModules(
      state.calibration,
      profile.completedTopics || [],
      unlockedTopics
    );

    _syncTimetableWithMood();

    state.expandedDoneModules = new Set();
    state.optionalSubtopicsExpanded = false;
    state.aiMessages = [];
    navigate('ancientGame');
  }

  /**
   * Automatically re-arranges the timetable's flexible slots to match the recommended module order
   * based on the student's mood.
   */
  function _syncTimetableWithMood() {
    if (!state.user || !state.modules || state.modules.length === 0) return;

    const visible = state.modules.filter(
      m => m.assigned !== false && TIMETABLE_SUBJECT_IDS.includes(m.subjectId)
    );
    _ensureVerticalSchedule(visible);

    const recommendedBySubject = {};
    state.modules
      .filter(m => TIMETABLE_SUBJECT_IDS.includes(m.subjectId))
      .forEach(m => {
        if (!recommendedBySubject[m.subjectId]) {
          recommendedBySubject[m.subjectId] = m.topicId;
        }
      });

    state.verticalSchedule.forEach(slot => {
      if (slot.type !== 'module') return;
      const topicId = recommendedBySubject[slot.subjectId];
      if (topicId) slot.topicId = topicId;
      else {
        const m = _moduleForSlot(slot, visible);
        if (m) slot.topicId = m.topicId;
      }
    });

    _saveVerticalSchedule();
  }

  function _firstSubtopicIdxForModule(moduleIdx) {
    const m = state.modules[moduleIdx];
    if (!m) return 0;
    const topicData = GKRecommender.getTopicData(m.subjectId, m.topicId);
    if (!topicData) return 0;

    const allSubtopics = topicData.topic.subtopics;
    const mandatory = allSubtopics.filter(st => st.mandatory !== false);
    const pool = mandatory.length ? mandatory : allSubtopics;
    const profile = state.user ? GKStore.getUserProfile(state.user.id) : null;
    const completed = profile ? (profile.completedSubtopics || []) : [];
    const session = GKStore.getSession() || {};
    const sessionDone = session.completedSubtopics || [];
    const doneSet = new Set([...completed, ...sessionDone]);

    const next = pool.find(st => !doneSet.has(m.topicId + '-' + st.id));
    if (next) return allSubtopics.indexOf(next);
    return pool.length ? allSubtopics.indexOf(pool[0]) : 0;
  }

  async function enterLessonFromModule(idx) {
    state.activeModuleIdx = idx;
    state.expandedSubtopicIdx = null;
    state._modulesLastXP = GKStore.getTotalXP(state.user.id);
    const m = state.modules[idx];
    if (m) {
      _persistResumeLesson(m);
      const topicData = GKRecommender.getTopicData(m.subjectId, m.topicId);
      if (topicData && topicData.topic && topicData.topic.githubFolder && typeof GKContentLoader !== 'undefined') {
        await GKContentLoader.loadAndApply(topicData);
      }
    }
    startSubtopic(_firstSubtopicIdxForModule(idx));
  }

  function continueResumeLesson() {
    const visibleModules = state.modules.filter(m => m.assigned !== false);
    const resume = _getResumeLesson(visibleModules);
    if (!resume?.module) return;
    enterLessonFromModule(resume.module._origIdx);
  }

  function openTodayLesson(subjectId) {
    const visibleModules = state.modules.filter(m => m.assigned !== false);
    const subjectModules = visibleModules.filter(m => m.subjectId === subjectId);
    if (!subjectModules.length) return;
    const m = subjectModules.find(mod => !mod.isCompleted) || subjectModules[subjectModules.length - 1];
    enterLessonFromModule(m._origIdx);
  }

  function startModule(idx) {
    enterLessonFromModule(idx);
  }

  function startModuleRetake(idx) {
    enterLessonFromModule(idx);
  }

  // Toggle expand/collapse for a completed module chip
  function toggleCompletedModule(idx) {
    if (state.expandedDoneModules.has(idx)) {
      state.expandedDoneModules.delete(idx);
    } else {
      state.expandedDoneModules.add(idx);
    }
    render();
  }

  // Toggle the optional subtopics collapsible section within a module
  function toggleOptionalSubtopics() {
    state.optionalSubtopicsExpanded = !state.optionalSubtopicsExpanded;
    render();
  }

  // Toggle expand/collapse for an individual subtopic row in classroom view
  function toggleSubtopicExpand(idx) {
    state.expandedSubtopicIdx = (state.expandedSubtopicIdx === idx) ? null : idx;
    render();
  }

  function dismissMentorNotes() {
    GKStore.markMentorNotesRead(state.user.id);
    render();
  }

  function backToModules() {
    navigate('modules');
  }

  function backToSchedule() {
    if (state.currentScreen === 'learning' || state.currentScreen === 'assessment') {
      _capturePartialResult();
      state.aiMessages = [];
      state.gameState = {};
      const m = state.modules[state.activeModuleIdx];
      if (m) _persistResumeLesson(m);
    }
    navigate('modules');
  }

  function startSubtopic(idx) {
    const m = state.modules[state.activeModuleIdx];
    const topicData = GKRecommender.getTopicData(m.subjectId, m.topicId);
    const subtopic = topicData.topic.subtopics[idx];

    state.activeSubtopicIdx = idx;
    state._lessonFlowMode = null;
    if (m) _persistResumeLesson(m);

    if (_hasLessonFlow(subtopic)) {
      _startLessonFlowAt(subtopic, 0, 'hook');
      return;
    }

    state.lessonPhase = null;

    // If it's pure assessment (no concepts, no distinct game object with a 'type')
    if ((!subtopic.concepts || subtopic.concepts.length === 0) && (!subtopic.game || !subtopic.game.type) && subtopic.assessment) {
      GKAssessment.init(subtopic.assessment);
      state._isFinalAssessment = false;
      navigate('assessment');
      return;
    }

    state.conceptIdx = 0;
    state.phase = (!subtopic.concepts || subtopic.concepts.length === 0) ? 'game' : 'concepts';
    state.gameState = {};
    state.aiMessages = [];
    navigate('learning');
  }

  // ─── Capture whatever game/assessment progress exists and persist to profile ───
  // Called whenever the student navigates away before completing the full flow.
  //
  // KEY RULE: clicking "Play Game & Earn XP!" (startGame) is the point of no
  // return — it sets state.phase = 'game'. From that moment the attempt is
  // counted even if the student answered 0 questions. Score = correct / total
  // where unanswered questions count as 0 correct.
  function _capturePartialResult() {
    if (!state.user) return;
    const m = state.modules[state.activeModuleIdx];
    if (!m) return;
    const subtopic = _getCurrentSubtopic();
    if (!subtopic) return;
    const subtopicKey = m.topicId + '-' + subtopic.id;

    // ── Path A: game phase — startGame() was explicitly called ──────────────
    // state.phase === 'game' is set only by startGame() (user clicked the CTA).
    // That deliberate action constitutes an attempt; always save.
    if (state.currentScreen === 'learning' && state.phase === 'game' && subtopic.game) {
      const gs = state.gameState;
      const game = subtopic.game;
      let score = gs.score || 0;
      let total = 0;

      if (game.type === 'mcq-game') {
        // total is always the full question bank; unanswered count as wrong
        total = (gs.completed && gs.total) ? gs.total : game.items.length;

      } else if (game.type === 'graph-read') {
        total = (gs.completed && gs.total) ? gs.total : (game.questions ? game.questions.length : 0);

      } else if (game.type === 'classify') {
        total = game.items ? game.items.length : 0;
        // score only exists after submission; if not submitted yet, stays 0

      } else if (game.type === 'sequence-order') {
        total = game.items ? game.items.length : 0;

      } else if (game.type === 'fill-blank') {
        total = game.sentences ? game.sentences.length : 0;

      } else if (game.type === 'para-writing') {
        total = 1;

      } else {
        // breathe / unknown — mark as 1/1 so it shows as completed
        total = 1;
        score = 1;
      }

      if (total === 0) return;   // no questions to speak of — skip
      GKStore.recordSubtopicComplete(subtopicKey);
      GKStore.saveSubtopicScore(state.user.id, subtopicKey, score, total);
      const modCapture = state.modules[state.activeModuleIdx];
      if (modCapture) _maybeMarkTopicComplete(modCapture);
      _refreshUserFromStore();
      localStorage.setItem('gk_sync_ping', Date.now().toString());
      return;
    }

    // ── Path B: concepts phase — student hasn't started game yet ────────────
    // (phase === 'concepts') Do NOT count as attempted; they only read concepts.

    // ── Path C: pure assessment screen ──────────────────────────────────────
    // Entering the assessment screen (navigate('assessment') from startSubtopic)
    // is itself the attempt trigger — same logic as Path A.
    if (state.currentScreen === 'assessment' && !state._isFinalAssessment) {
      const results = GKAssessment.getResults();
      // total comes from how many questions were loaded (even if 0 answered)
      if (results.total === 0) return;
      GKStore.recordSubtopicComplete(subtopicKey);
      GKStore.saveSubtopicScore(state.user.id, subtopicKey, results.score, results.total);
      const modCapture = state.modules[state.activeModuleIdx];
      if (modCapture) _maybeMarkTopicComplete(modCapture);
      _refreshUserFromStore();
      localStorage.setItem('gk_sync_ping', Date.now().toString());
    }
  }

  function backToSubtopics() {
    _capturePartialResult();   // always save before leaving
    state.aiMessages = [];
    state.gameState = {};      // reset game state so next entry starts fresh
    const m = state.modules[state.activeModuleIdx];
    if (m) _persistResumeLesson(m);
    navigate('subtopics');
  }

  function _getChallengeQuestions(topicData) {
    let allQ = topicData.topic.subtopics.flatMap(st => st.assessment || []);
    if (allQ.length < 1) {
      const tName = topicData.topic.name;
      const pool = [
        { question: `What is a core principle of ${tName}?`, type: 'mcq', options: ['Option A', 'Option B', 'Option C', 'Option D'], correct: 0, explanation: `The core principle involves Option A.` },
        { question: `True or False: ${tName} is fundamental to this subject area.`, type: 'true-false', options: ['True', 'False'], correct: 0 },
        { question: `Complete this sentence: ${tName} allows us to explore ___. (Hint: "knowledge")`, type: 'fill-blank', correct: ['knowledge', 'concepts'], explanation: 'Accurate terminology is key.' },
        { question: `Which of the following is NOT related to ${tName}?`, type: 'mcq', options: ['Concept X', 'Concept Y', 'Unrelated Concept', 'Concept Z'], correct: 2, explanation: `The unrelated concept is not part of ${tName}.` },
        { question: `True or False: The concepts in ${tName} are only theoretical and have no practical application.`, type: 'true-false', options: ['True', 'False'], correct: 1, explanation: 'False! Most concepts here have strong practical components.' }
      ];
      allQ = [...pool].sort(() => 0.5 - Math.random()).slice(0, 5);
    }
    return allQ.slice(0, 5);
  }

  function startModuleAssessment(idx) {
    state.activeModuleIdx = idx;
    startChallenge();
  }

  function startChallenge() {
    const m = state.modules[state.activeModuleIdx];
    const topicData = GKRecommender.getTopicData(m.subjectId, m.topicId);
    GKAssessment.init(_getChallengeQuestions(topicData));
    state._isFinalAssessment = false;
    navigate('assessment');
  }

  function retakeChallenge() {
    const m = state.modules[state.activeModuleIdx];
    const topicData = GKRecommender.getTopicData(m.subjectId, m.topicId);
    GKAssessment.init(_getChallengeQuestions(topicData));
    state._isFinalAssessment = false;
    navigate('assessment');
  }

  function startFinalAssessment() {
    const allQ = [];
    state.modules.forEach(m => {
      const topicData = GKRecommender.getTopicData(m.subjectId, m.topicId);
      if (topicData) {
        topicData.topic.subtopics.forEach(st => {
          if (st.assessment) allQ.push(...st.assessment);
        });
      }
    });
    GKAssessment.init(allQ);
    state._isFinalAssessment = true;
    navigate('assessment');
  }

  function finishFinalAssessment() {
    state._isFinalAssessment = false;
    navigate('feedback');
  }

  // After topic assessment (non-final) → go to module feedback
  function goToModuleFeedback() {
    const m = state.modules[state.activeModuleIdx];
    state._pendingTopicKey = `${m.subjectId}-${m.topicId}`;
    state.moduleFeedbackResponses = {};
    navigate('moduleFeedback');
  }

  function nextConcept() {
    const subtopic = _getCurrentSubtopic();
    if (_hasLessonFlow(subtopic)) {
      advanceLessonFlow();
      return;
    }

    state.conceptIdx++;

    // Award XP only if new
    const m = state.modules[state.activeModuleIdx];
    const conceptKey = `${m.subjectId}-${m.topicId}-${state.activeSubtopicIdx}-${state.conceptIdx}`;
    if (!state.seenConcepts.has(conceptKey)) {
      GKXPManager.awardXP(state.user.id, 'conceptRead');
      state.seenConcepts.add(conceptKey);
    }

    render();
    _pushLiveState();
  }

  function prevConcept() {
    const subtopic = _getCurrentSubtopic();
    if (_hasLessonFlow(subtopic)) {
      prevLessonFlow();
      return;
    }
    if (state.conceptIdx > 0) {
      state.conceptIdx--;
      render();
      _pushLiveState();
    }
  }

  function startGame() {
    state.phase = 'game';
    state.gameState = { score: 0, total: 0 };
    navigate('learning');
  }

  // --- Game Handlers ---

  function classifyToggle(itemId) {
    const gs = state.gameState;
    if (gs.submitted) return;
    if (!gs.selected) gs.selected = {};
    gs.selected[itemId] = !gs.selected[itemId];
    render();
  }

  function submitClassify() {
    const gs = state.gameState;
    const m = state.modules[state.activeModuleIdx];
    const topicData = GKRecommender.getTopicData(m.subjectId, m.topicId);
    const subtopic = topicData.topic.subtopics[state.activeSubtopicIdx];
    const items = subtopic.game.items;

    let score = 0, total = 0;
    items.forEach(item => {
      const isProper = item.num < item.den;
      const selected = !!gs.selected[item.id];
      if (isProper) {
        total++;
        if (selected) score++;
      } else {
        if (!selected) score++;
        total++;
      }
    });

    gs.submitted = true;
    gs.score = score;
    gs.total = total;
    const xp = GKXPManager.awardXP(state.user.id, 'gameCompleted', score === total ? 10 : 0);
    if (xp > 0 && state.user) state.user.totalXP = (state.user.totalXP || 0) + xp;
    gs.xpEarned = xp;
    if (xp > 0) gkConfetti(score === total ? 22 : 12);
    render();
  }

  function answerMCQGame(idx) {
    const gs = state.gameState;
    if (gs.answer !== undefined) return;
    gs.answer = idx;
    const m = state.modules[state.activeModuleIdx];
    const topicData = GKRecommender.getTopicData(m.subjectId, m.topicId);
    const subtopic = topicData.topic.subtopics[state.activeSubtopicIdx];
    const item = subtopic.game.items[gs.itemIdx || 0];
    if (idx === item.correct) gs.score = (gs.score || 0) + 1;
    render();
  }

  function nextMCQGame() {
    const gs = state.gameState;
    const m = state.modules[state.activeModuleIdx];
    const topicData = GKRecommender.getTopicData(m.subjectId, m.topicId);
    const subtopic = topicData.topic.subtopics[state.activeSubtopicIdx];
    gs.itemIdx = (gs.itemIdx || 0) + 1;
    gs.answer = undefined;
    if (gs.itemIdx >= subtopic.game.items.length) {
      gs.total = subtopic.game.items.length;
      gs.completed = true;
      const xp = GKXPManager.awardXP(state.user.id, 'gameCompleted', gs.score === gs.total ? 10 : 0);
      if (xp > 0 && state.user) state.user.totalXP = (state.user.totalXP || 0) + xp;
      gs.xpEarned = xp;
    }
    render();
  }

  function answerGraph(idx) {
    const gs = state.gameState;
    if (gs.answer !== undefined) return;
    gs.answer = idx;
    const m = state.modules[state.activeModuleIdx];
    const topicData = GKRecommender.getTopicData(m.subjectId, m.topicId);
    const subtopic = topicData.topic.subtopics[state.activeSubtopicIdx];
    const q = subtopic.game.questions[gs.qIdx || 0];
    const isCorrect = q.correctIdx !== undefined ? idx === q.correctIdx : subtopic.game.data.rows.find ? false : idx === q.answer;
    if (isCorrect) gs.score = (gs.score || 0) + 1;
    render();
  }

  function nextGraphQ() {
    const gs = state.gameState;
    const m = state.modules[state.activeModuleIdx];
    const topicData = GKRecommender.getTopicData(m.subjectId, m.topicId);
    const subtopic = topicData.topic.subtopics[state.activeSubtopicIdx];
    gs.qIdx = (gs.qIdx || 0) + 1;
    gs.answer = undefined;
    if (gs.qIdx >= subtopic.game.questions.length) {
      gs.total = subtopic.game.questions.length;
      gs.completed = true;
      const xp = GKXPManager.awardXP(state.user.id, 'gameCompleted', gs.score === gs.total ? 10 : 0);
      if (xp > 0 && state.user) state.user.totalXP = (state.user.totalXP || 0) + xp;
      gs.xpEarned = xp;
    }
    render();
  }

  function seqClick(idx) {
    const gs = state.gameState;
    if (gs.checked) return;
    if (!gs.order) gs.order = new Array(state.modules.length).fill(null);
    if (!gs.nextNum) gs.nextNum = 1;
    const m = state.modules[state.activeModuleIdx];
    const topicData = GKRecommender.getTopicData(m.subjectId, m.topicId);
    const subtopic = topicData.topic.subtopics[state.activeSubtopicIdx];
    const len = subtopic.game.items.length;
    if (!gs.order) gs.order = new Array(len).fill(null);

    if (gs.order[idx] !== null) {
      const removed = gs.order[idx];
      gs.order = gs.order.map(v => v === null ? null : v > removed ? v - 1 : v === removed ? null : v);
      gs.nextNum = Math.max(...gs.order.filter(v => v !== null), 0) + 1;
    } else {
      gs.order[idx] = gs.nextNum;
      gs.nextNum++;
    }
    render();
  }

  function checkSequence() {
    const gs = state.gameState;
    const m = state.modules[state.activeModuleIdx];
    const topicData = GKRecommender.getTopicData(m.subjectId, m.topicId);
    const subtopic = topicData.topic.subtopics[state.activeSubtopicIdx];
    let score = 0;
    subtopic.game.items.forEach((item, i) => {
      if (gs.order[i] === item.correct) score++;
    });
    gs.score = score;
    gs.total = subtopic.game.items.length;
    gs.checked = true;
    const xp = GKXPManager.awardXP(state.user.id, 'gameCompleted', score === gs.total ? 10 : 0);
    if (xp > 0 && state.user) state.user.totalXP = (state.user.totalXP || 0) + xp;
    gs.xpEarned = xp;
    render();
  }

  let _breatheTimer = null;

  function startBreathing() {
    const gs = state.gameState;
    gs.running = true;
    gs.step = 0;
    gs.round = 0;
    gs.count = 4;
    render();
    _runBreatheStep();
  }

  function _runBreatheStep() {
    const m = state.modules[state.activeModuleIdx];
    const topicData = GKRecommender.getTopicData(m.subjectId, m.topicId);
    const subtopic = topicData.topic.subtopics[state.activeSubtopicIdx];
    const game = subtopic.game;
    const gs = state.gameState;
    if (!gs.running) return;

    const phaseIdx = gs.step % game.steps.length;
    const phase = game.steps[phaseIdx];
    gs.count = phase.duration;

    const countEl = document.getElementById('breathe-count');
    if (countEl) countEl.textContent = gs.count;

    _breatheTimer = setInterval(() => {
      gs.count--;
      const el = document.getElementById('breathe-count');
      if (el) el.textContent = gs.count;
      if (gs.count <= 0) {
        clearInterval(_breatheTimer);
        gs.step++;
        if (gs.step % game.steps.length === 0) gs.round++;
        if (gs.round >= game.rounds) {
          gs.running = false;
          gs.done = true;
          const xp = GKXPManager.awardXP(state.user.id, 'gameCompleted', 0);
          if (xp > 0 && state.user) state.user.totalXP = (state.user.totalXP || 0) + xp;
          gs.xpEarned = xp;
          if (xp > 0) gkConfetti(16);
          render();
        } else {
          render();
          setTimeout(_runBreatheStep, 300);
        }
      }
    }, 1000);
  }

  function stopBreathing() {
    clearInterval(_breatheTimer);
    const gs = state.gameState;
    gs.running = false;
    gs.done = true;
    gs.xpEarned = 0;
    render();
  }

  // After game completes → go to subtopic feedback
  function afterGame() {
    const gs = state.gameState;
    // Calculate percentage for Krishna's feedback logic
    if (gs.score !== undefined && gs.total) {
      state._lastAssessmentScore = Math.round((gs.score / gs.total) * 100);
    } else {
      state._lastAssessmentScore = 100; // Reset if no score (like breathe game)
    }

    const m = state.modules[state.activeModuleIdx];
    const subtopic = _getCurrentSubtopic();
    const subtopicKey = m.topicId + '-' + subtopic.id;
    GKStore.recordSubtopicComplete(subtopicKey);
    // Persist score to user profile so it survives page refresh
    if (state.user && gs.score !== undefined && gs.total) {
      GKStore.saveSubtopicScore(state.user.id, subtopicKey, gs.score, gs.total);
    }
    _maybeMarkTopicComplete(m);
    _refreshUserFromStore();
    localStorage.setItem('gk_sync_ping', Date.now().toString());
    state._pendingTopicKey = m.topicId;
    state._pendingSubtopicKey = subtopicKey;
    state.subtopicFeedbackResponses = {};
    state.conceptIdx = 0;
    state.phase = 'concepts';
    state._lastXpEarned = gs.xpEarned || 0; // Store for Krishna's message
    state.gameState = {};
    state.aiMessages = [];
    navigate('subtopicFeedback');
  }

  // ---- Assessment Handlers (generalized for all question types) ----
  function _showAssessmentFeedback(result) {
    const fb = document.getElementById('answer-feedback');
    if (fb) {
      fb.innerHTML = `${result.isCorrect ? '✅ Correct!' : '❌ Incorrect'} — ${result.explanation}`;
      fb.className = `answer-feedback ${result.isCorrect ? 'fb-correct' : 'fb-wrong'}`;
    }
    const nextBtn = document.getElementById('next-btn');
    if (nextBtn) nextBtn.classList.remove('hidden');

    // Update Krishna feedback
    const bubble = document.getElementById('krishna-speech-bubble');
    if (bubble) {
      const msg = result.isCorrect
        ? `Excellent! ${result.explanation}`
        : `Not quite, but don't worry! ${result.explanation}`;
      bubble.textContent = msg;
      GKVoice.speak(msg);
    }
  }

  function selectAnswer(idx) {
    const result = GKAssessment.submitAnswer(idx);
    if (!result) return;

    // Disable all answer buttons
    document.querySelectorAll('.answer-btn').forEach((btn, i) => {
      btn.disabled = true;
      if (result.type === 'true-false') {
        if (i === result.correctAnswer) btn.classList.add('correct');
        else if (i === idx && !result.isCorrect) btn.classList.add('wrong');
      } else {
        if (i === result.correctAnswer) btn.classList.add('correct');
        else if (i === idx && !result.isCorrect) btn.classList.add('wrong');
      }
    });

    _showAssessmentFeedback(result);
  }

  function submitFillBlankAssessment() {
    const input = document.getElementById('fill-blank-input');
    if (!input || !input.value.trim()) return;
    const result = GKAssessment.submitAnswer(input.value.trim());
    if (!result) return;
    input.disabled = true;
    input.style.borderColor = result.isCorrect ? '#4CAF50' : '#F44336';
    input.style.background = result.isCorrect ? '#E8F5E9' : '#FFEBEE';
    _showAssessmentFeedback(result);
  }

  function submitShortAnswer() {
    const input = document.getElementById('short-answer-input');
    if (!input || !input.value.trim()) return;
    const result = GKAssessment.submitAnswer(input.value.trim());
    if (!result) return;
    input.disabled = true;
    input.style.borderColor = result.isCorrect ? '#4CAF50' : '#F44336';
    input.style.background = result.isCorrect ? '#E8F5E9' : '#FFEBEE';
    _showAssessmentFeedback(result);
  }

  function submitMultipleCorrect() {
    const checked = [...document.querySelectorAll('.mc-checkbox:checked')].map(cb => parseInt(cb.value));
    if (checked.length === 0) return;
    const result = GKAssessment.submitAnswer(checked);
    if (!result) return;
    document.querySelectorAll('.mc-checkbox').forEach(cb => cb.disabled = true);
    document.querySelectorAll('.mc-label').forEach(label => {
      const idx = parseInt(label.querySelector('.mc-checkbox').value);
      if (result.correctAnswer.includes(idx)) label.classList.add('correct');
      else if (checked.includes(idx) && !result.isCorrect) label.classList.add('wrong');
    });
    _showAssessmentFeedback(result);
  }

  // Ordering state
  let _orderingSequence = [];
  function selectOrderItem(idx) {
    if (_orderingSequence.includes(idx)) return;
    _orderingSequence.push(idx);
    const q = GKAssessment.getCurrentQuestion();
    const btn = document.querySelectorAll('.ordering-btn')[idx];
    if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }
    const selEl = document.getElementById('ordering-selected');
    if (selEl && q) {
      selEl.innerHTML = _orderingSequence.map((oi, pos) => `<span style="display:inline-block;background:#E3F2FD;padding:4px 10px;border-radius:12px;margin:2px 4px;font-size:0.85rem;">${pos + 1}. ${q.options[oi]}</span>`).join('');
    }
  }

  function submitOrdering() {
    if (_orderingSequence.length === 0) return;
    const result = GKAssessment.submitAnswer(_orderingSequence);
    if (!result) return;
    document.querySelectorAll('.ordering-btn').forEach(b => b.disabled = true);
    _orderingSequence = [];
    _showAssessmentFeedback(result);
  }

  function submitFileUpload() {
    const fileInput = document.getElementById('assessment-file-upload');
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) return;

    // Simulate successful file upload
    const fileName = fileInput.files[0].name;
    const result = GKAssessment.submitAnswer(fileName);
    if (!result) return;

    fileInput.disabled = true;
    _showAssessmentFeedback(result);
  }

  function submitMatch() {
    const q = GKAssessment.getCurrentQuestion();
    if (!q) return;
    const answers = q.pairs.map((_, i) => {
      const sel = document.getElementById(`match-select-${i}`);
      return sel ? sel.value : '';
    });
    if (answers.some(a => !a)) return; // all must be filled
    const result = GKAssessment.submitAnswer(answers);
    if (!result) return;
    document.querySelectorAll('.match-select').forEach(sel => sel.disabled = true);
    _showAssessmentFeedback(result);
  }

  function nextQuestion() {
    _orderingSequence = [];
    GKAssessment.nextQuestion();
    render();
  }

  // ---- Subtopic Feedback Handlers ----
  function selectSubtopicFeedback(questionId, value) {
    if (!state.subtopicFeedbackResponses) state.subtopicFeedbackResponses = {};
    state.subtopicFeedbackResponses[questionId] = value;
    render();
  }

  function submitSubtopicFeedback() {
    const enjoyEl = document.getElementById('stfb-enjoy');
    const improveEl = document.getElementById('stfb-improve');
    const enjoyText = enjoyEl ? enjoyEl.value.trim() : '';
    const improveText = improveEl ? improveEl.value.trim() : '';

    if (!enjoyText && !improveText) {
      document.getElementById('stfb-error').classList.remove('hidden');
      return;
    }

    const feedbackData = {
      type: 'open-ended',
      responses: {
        enjoyedMost: enjoyText,
        improvementPoint: improveText
      }
    };

    if (state._pendingSubtopicKey) {
      GKStore.saveSubtopicFeedback(state.user.id, state._pendingTopicKey, state._pendingSubtopicKey, feedbackData);
    }
    const xp = GKXPManager.awardXP(state.user.id, 'feedbackSubmitted');
    if (xp > 0 && state.user) state.user.totalXP = (state.user.totalXP || 0) + xp;
    _finishSubtopicFeedback();
  }

  function skipSubtopicFeedback() {
    _finishSubtopicFeedback();
  }

  function _finishSubtopicFeedback() {
    state.subtopicFeedbackResponses = {};
    if (state._afterSubtopicFeedback === 'lessonFlow-mid') {
      state._afterSubtopicFeedback = null;
      _continueLessonFlowAfterFeedback();
    } else {
      navigate('subtopics');
    }
  }

  // ---- Module Feedback Handlers ----
  function selectModuleFeedback(questionId, value) {
    if (!state.moduleFeedbackResponses) state.moduleFeedbackResponses = {};
    state.moduleFeedbackResponses[questionId] = value;
    render();
  }

  function submitModuleFeedback() {
    const enjoyEl = document.getElementById('mfb-enjoy');
    const improveEl = document.getElementById('mfb-improve');
    const enjoyText = enjoyEl ? enjoyEl.value.trim() : '';
    const improveText = improveEl ? improveEl.value.trim() : '';

    if (!enjoyText && !improveText) {
      document.getElementById('mfb-error').classList.remove('hidden');
      return;
    }

    const feedbackData = {
      type: 'open-ended',
      responses: {
        enjoyedMost: enjoyText,
        improvementPoint: improveText
      }
    };

    if (state._pendingTopicKey) {
      GKStore.saveModuleFeedback(state.user.id, state._pendingTopicKey, feedbackData);
    }
    const xp = GKXPManager.awardXP(state.user.id, 'feedbackSubmitted');
    if (xp > 0 && state.user) state.user.totalXP = (state.user.totalXP || 0) + xp;
    state.moduleFeedbackResponses = {};
    // After module feedback: continue to next module or back to modules
    if (_hasMoreModules()) {
      startModule(state.activeModuleIdx + 1);
    } else {
      navigate('modules');
    }
  }

  function skipModuleFeedback() {
    state.moduleFeedbackResponses = {};
    if (_hasMoreModules()) {
      startModule(state.activeModuleIdx + 1);
    } else {
      navigate('modules');
    }
  }

  // ---- End-of-Session Feedback Handlers ----
  function selectFeedback(questionId, value) {
    if (!state.feedbackResponses) state.feedbackResponses = {};
    state.feedbackResponses[questionId] = value;
    render();
  }

  function submitFeedback() {
    const enjoyEl = document.getElementById('fb-enjoy');
    const improveEl = document.getElementById('fb-improve');
    const enjoyText = enjoyEl ? enjoyEl.value.trim() : '';
    const improveText = improveEl ? improveEl.value.trim() : '';

    if (!enjoyText && !improveText) {
      const errEl = document.getElementById('fb-error');
      if (errEl) errEl.classList.remove('hidden');
      return;
    }

    const feedbackData = {
      type: 'open-ended',
      sessionDate: new Date().toISOString(),
      responses: {
        enjoyedMost: enjoyText,
        improvementPoint: improveText
      }
    };
    GKStore.saveFeedback(feedbackData);
    GKStore.logCompletedSession();
    const xp = GKXPManager.awardXP(state.user.id, 'feedbackSubmitted');
    if (xp > 0 && state.user) state.user.totalXP = (state.user.totalXP || 0) + xp;
    state.feedbackResponses = {};
    navigate('modules');
  }

  // ---- AI Tutor Handlers ----
  function askAI() {
    const input = document.getElementById('ai-input');
    if (!input) return;
    const question = input.value.trim();
    if (!question) return;
    if (!state.aiMessages) state.aiMessages = [];
    state.aiMessages.push({ role: 'user', text: question });
    const response = GKAITutor.respond(question);
    state.aiMessages.push({ role: 'ai', text: response });
    input.value = '';
    render();
    setTimeout(() => {
      const chat = document.getElementById('sidebar-chat');
      if (chat) chat.scrollTop = chat.scrollHeight;
    }, 50);
  }

  function getHint() {
    if (!state.aiMessages) state.aiMessages = [];
    const hint = GKAITutor.getNextHint();
    state.aiMessages.push({ role: 'ai', text: `💡 Hint: ${hint}` });
    render();
    setTimeout(() => {
      const chat = document.getElementById('sidebar-chat');
      if (chat) chat.scrollTop = chat.scrollHeight;
    }, 50);
  }

  // ---- Session Flow ----
  function goToFeedback() {
    navigate('feedback');
  }

  function nextModule() {
    const nextIdx = state.activeModuleIdx + 1;
    if (nextIdx < state.modules.length) {
      startModule(nextIdx);
    } else {
      goToFeedback();
    }
  }

  function startNewSession() {
    state.mood = null;
    state.calibration = null;
    state.modules = [];
    state.activeModuleIdx = 0;
    state.activeSubtopicIdx = 0;
    state.conceptIdx = 0;
    state.phase = 'concepts';
    state.gameState = {};
    state.aiMessages = [];
    state.feedbackResponses = {};
    state.subtopicFeedbackResponses = {};
    state.moduleFeedbackResponses = {};
    state.sessionXP = 0;
    state.expandedDoneModules = new Set();
    state.optionalSubtopicsExpanded = false;
    state.expandedSubtopicIdx = 0;
    state.user = GKAuth.refreshUser();
    navigate('mood');
  }


  // ---- Notifications System ----
  function checkNotifications() {
    if (!state.user) return;
    const badgeEl = document.getElementById('notif-badge');
    if (!badgeEl) return;

    // Check for unread mentor notes
    const unreadNotes = GKStore.getMentorNotes(state.user.id).filter(n => !n.read);

    // Check for recently earned badges (in last 5 mins)
    const recentBadges = GKXPManager.getEarnedBadges(state.user.id).filter(b => (Date.now() - b.earnedAt) < 5 * 60 * 1000);

    const totalUnread = unreadNotes.length + recentBadges.length;

    if (totalUnread > 0) {
      badgeEl.style.display = 'flex';
      badgeEl.textContent = totalUnread;
    } else {
      badgeEl.style.display = 'none';
      badgeEl.textContent = '0';
    }
  }

  function toggleNotifications() {
    const overlay = document.getElementById('notif-overlay');
    if (!overlay) return;

    if (overlay.style.display === 'none' || overlay.style.display === '') {
      // Populating before showing
      const listEl = document.getElementById('notif-list');
      if (listEl && state.user) {
        let html = '';

        // 1. Unread Mentor Notes
        const unreadNotes = GKStore.getMentorNotes(state.user.id).filter(n => !n.read);
        if (unreadNotes.length > 0) {
          html += `<div class="notif-section-title">Message from Acharya</div>`;
          unreadNotes.forEach(note => {
            html += `
              <div class="notif-item">
                <div class="notif-icon">📜</div>
                <div class="notif-content">
                  <div class="notif-text">${note.message || note.text}</div>
                  <div class="notif-actions" style="margin-top: 0.8rem; display: flex; justify-content: flex-end;">
                    <button class="btn btn-sm btn-ghost" onclick="GKApp.markNoteRead('${note.id}')" 
                      style="border: 1px solid #FFE082; color: #6B3F1A; background: #FFF9C4; border-radius: 20px; padding: 4px 15px; font-weight: 600;">
                      ✅ Got it
                    </button>
                  </div>
                </div>
              </div>`;
          });
        }

        // 2. Newly Earned Badges
        const recentBadges = GKXPManager.getEarnedBadges(state.user.id).filter(b => (Date.now() - b.earnedAt) < 5 * 60 * 1000);
        if (recentBadges.length > 0) {
          html += `<div class="notif-section-title">Sacred Badges Earned</div>`;
          const allBadges = GKXPManager.BADGES();
          recentBadges.forEach(eb => {
            const b = allBadges.find(x => x.id === eb.id);
            if (b) {
              html += `
                <div class="notif-item notif-badge-item">
                  <div class="notif-icon">${b.icon}</div>
                  <div class="notif-content">
                    <strong>${b.name}</strong>
                    <p style="font-size:0.8rem;color:#888">${b.desc}</p>
                  </div>
                </div>`;
            }
          });
        }

        if (html === '') {
          html = `
            <div style="text-align:center; padding: 2rem; color: #888;">
              <div style="font-size: 3rem; margin-bottom: 1rem;">🛕</div>
              <p>Everything is peaceful. No new messages.</p>
            </div>`;
        }
        listEl.innerHTML = html;
      }

      overlay.style.display = 'flex';
    } else {
      overlay.style.display = 'none';
    }
  }

  function markNoteRead(id) {
    if (!state.user) return;
    GKStore.markSpecificMentorNoteRead(state.user.id, id);
    checkNotifications();
    toggleNotifications(); // refresh open panel
    setTimeout(() => toggleNotifications(), 100); // re-open to show updated list
  }

  function dismissMentorNotes() {
    const el = document.getElementById('mentor-notes-banner');
    if (el) el.style.display = 'none';
    if (state.user && state.user.id) {
      GKStore.markMentorNotesRead(state.user.id);
      render();
    }
  }

  function logout() {
    GKAuth.logout();
    state.user = null;
    navigate('login');
  }

  // ---- Helpers ----
  function _getCurrentSubtopic() {
    const m = state.modules[state.activeModuleIdx];
    const topicData = GKRecommender.getTopicData(m.subjectId, m.topicId);
    return topicData.topic.subtopics[state.activeSubtopicIdx];
  }

  function _hasMoreSubtopics() {
    const m = state.modules[state.activeModuleIdx];
    const topicData = GKRecommender.getTopicData(m.subjectId, m.topicId);
    return state.activeSubtopicIdx + 1 < topicData.topic.subtopics.length;
  }

  function _hasMoreModules() {
    return state.activeModuleIdx + 1 < state.modules.length;
  }

  function init() {
    // Menu hidden by default so Krishna is always visible on first paint
    state.sidebarCollapsed = true;
    try {
      if (sessionStorage.getItem('gk_sidebar_collapsed') === 'false') {
        sessionStorage.setItem('gk_sidebar_collapsed', 'true');
      }
      const subjectsExpanded = sessionStorage.getItem('gk_sidebar_subjects_expanded');
      if (subjectsExpanded === 'false') state.sidebarSubjectsExpanded = false;
    } catch (_) { /* ignore */ }

    // Mirroring check: if opened inside mentor student dashboard as a 'Sacred Mirror'
    const params = new URLSearchParams(window.location.search);
    const isMirror = params.get('mirror') === 'true';
    const mirrorUserId = params.get('userId');

    if (isMirror && mirrorUserId) {
      state.isMirror = true;
      const baseUser = GK_USERS.find(u => u.id === mirrorUserId);
      if (baseUser) {
        const profile = GKStore.getUserProfile(mirrorUserId);
        state.user = { ...baseUser, ...(profile || {}) };
        
        // --- Sync Learning Path Metadata for Mirror View ---
        // This ensures the timetable has access to subject colors and topic info
        const session = GKStore.getSession();
        if (session && session.userId === mirrorUserId) {
          state.mood = session.mood;
          if (state.mood) {
            state.calibration = GKMoodEngine.calibrateSession(state.mood.brainBattery, state.mood.currentVibe);
          }
        }
        
        // Re-populate modules to ensure subjectColor etc are present for rendering
        const unlockedTopics = profile.unlockedTopics || [];
        state.modules = _assignStudentModules(
          state.calibration || GKMoodEngine.calibrateSession(80, 'high_energy'),
          profile.completedTopics || [],
          unlockedTopics
        );

        // Disable TTS in mirror mode to prevent audio overlap for mentor
        if (typeof GKVoice !== 'undefined') {
          GKVoice.toggle(); // Start muted
        }
        navigate('modules');

        // ── Mirror live-refresh via SSE ──────────────────────────────────────
        // Two types of SSE events are handled:
        //
        // 1. live_state — student navigated/changed screen/concept.
        //    Apply the state snapshot directly and re-render (no network fetch,
        //    no iframe reload — instant and flicker-free).
        //
        // 2. Everything else (update) — student saved data to the server.
        //    Re-fetch the full snapshot and rebuild the modules list so the
        //    mentor sees the latest scores and completions.

        // Fetch and apply the student's last known live state immediately on
        // load so the mirror starts on the correct screen rather than always
        // showing the modules list.
        fetch(`/api/live-state/${mirrorUserId}`)
          .then(r => r.json())
          .then(({ data }) => {
            if (!data) return;
            const ls = data;
            if (ls.screen) state.currentScreen = ls.screen;
            if (ls.activeModuleIdx  != null) state.activeModuleIdx   = ls.activeModuleIdx;
            if (ls.activeTopicId    != null) state.activeTopicId     = ls.activeTopicId;
            if (ls.activeSubjectId  != null) state.activeSubjectId   = ls.activeSubjectId;
            if (ls.activeSubtopicIdx != null) state.activeSubtopicIdx = ls.activeSubtopicIdx;
            if (ls.conceptIdx       != null) state.conceptIdx        = ls.conceptIdx;
            if (ls.phase            != null) state.phase             = ls.phase;
            if (ls.assessmentTopicId != null) state.assessmentTopicId = ls.assessmentTopicId;
            if (ls.moodPhase        != null) state.moodPhase         = ls.moodPhase;
            render();
          })
          .catch(() => {}); // silently ignore — modules screen remains

        const _mirrorSse = new EventSource('/api/events');
        _mirrorSse.addEventListener('update', async (e) => {
          let payload = {};
          try { payload = JSON.parse(e.data || '{}'); } catch (_) {}

          // ── live_state: student navigated — apply immediately ──────────────
          if (payload.type === 'live_state' && payload.userId === mirrorUserId) {
            const ls = payload.liveState || {};
            if (ls.screen            != null) state.currentScreen    = ls.screen;
            if (ls.activeModuleIdx   != null) state.activeModuleIdx  = ls.activeModuleIdx;
            if (ls.activeTopicId     != null) state.activeTopicId    = ls.activeTopicId;
            if (ls.activeSubjectId   != null) state.activeSubjectId  = ls.activeSubjectId;
            if (ls.activeSubtopicIdx != null) state.activeSubtopicIdx = ls.activeSubtopicIdx;
            if (ls.conceptIdx        != null) state.conceptIdx       = ls.conceptIdx;
            if (ls.phase             != null) state.phase            = ls.phase;
            if (ls.assessmentTopicId != null) state.assessmentTopicId = ls.assessmentTopicId;
            if (ls.moodPhase         != null) state.moodPhase        = ls.moodPhase;
            render();
            return;
          }

          // ── data update: student saved something — refresh from server ─────
          await GKDatabase.refresh();
          const freshProfile = GKStore.getUserProfile(mirrorUserId);
          if (!freshProfile) return;

          state.user = { ...baseUser, ...freshProfile };

          const freshSession = GKStore.getSession();
          if (freshSession && freshSession.userId === mirrorUserId) {
            state.mood = freshSession.mood;
            if (state.mood) {
              state.calibration = GKMoodEngine.calibrateSession(
                state.mood.brainBattery, state.mood.currentVibe
              );
            }
          }

          const unlockedTopics = freshProfile.unlockedTopics || [];
          state.modules = _assignStudentModules(
            state.calibration || GKMoodEngine.calibrateSession(80, 'high_energy'),
            freshProfile.completedTopics || [],
            unlockedTopics
          );

          render();
        });
        _mirrorSse.onerror = () => console.warn('[GKMirror] SSE connection lost — browser will retry automatically');

        // ── Polling fallback ─────────────────────────────────────────────────
        // Poll /api/live-state every 2 s as a reliable backup to SSE.
        // Change detection prevents unnecessary re-renders.
        let _mirrorLastSig = '';
        function _applyLiveState(ls) {
          const sig = `${ls.screen}|${ls.activeModuleIdx}|${ls.activeSubtopicIdx}|${ls.conceptIdx}|${ls.phase}`;
          if (sig === _mirrorLastSig) return;
          _mirrorLastSig = sig;
          console.log('[GKMirror] state →', sig);
          if (ls.screen            != null) state.currentScreen    = ls.screen;
          if (ls.activeModuleIdx   != null) state.activeModuleIdx  = ls.activeModuleIdx;
          if (ls.activeSubtopicIdx != null) state.activeSubtopicIdx = ls.activeSubtopicIdx;
          if (ls.conceptIdx        != null) state.conceptIdx       = ls.conceptIdx;
          if (ls.phase             != null) state.phase            = ls.phase;
          if (ls.assessmentTopicId != null) state.assessmentTopicId = ls.assessmentTopicId;
          if (ls.moodPhase         != null) state.moodPhase        = ls.moodPhase;
          render();
        }
        setInterval(async () => {
          try {
            const r = await fetch(`/api/live-state/${mirrorUserId}`);
            const { data } = await r.json();
            if (data) _applyLiveState(data);
          } catch (_) {}
        }, 2000);
      }
    } else {
      // Check if user is already logged in
      const user = typeof GKAuth !== 'undefined' ? GKAuth.getCurrentUser() : null;
      if (user) {
        state.user = user;
        _syncAssistantForUser(state.user.id);
        navigate('mood');
      } else {
        navigate('login');
      }
    }

    // Periodically push live state so mirror can catch up even if it opens late.
    // _pushLiveState() is a no-op when user is not logged in or in mirror mode.
    setInterval(() => _pushLiveState(), 3000);

    // Real-time synchronization: listen for changes from mentor dashboard (or other tabs)
    window.addEventListener('storage', (e) => {
      if (state.isMirror) return;  // mirror mode uses SSE — storage events not needed
      const activeId = state.user ? state.user.id : null;
      if (activeId) {
        // Re-sync user profile from storage
        const profile = GKStore.getUserProfile(activeId);
        if (profile) {
          const baseUser = GK_USERS.find(u => u.id === activeId) || {};
          const updatedUser = { ...baseUser, ...profile };
          
          if (JSON.stringify(state.user) !== JSON.stringify(updatedUser)) {
            // Logic for Krishna to announce mentor rewards/notes
            const oldNotes = state.user.mentorNotes || [];
            const newNotes = updatedUser.mentorNotes || [];
            if (newNotes.length > oldNotes.length) {
              const note = newNotes[newNotes.length - 1];
              const msg = `Namaste! A new word of guidance has arrived from your Guru: "${note.message}" 🙏`;
              GKVoice.speak(msg);
              state.activeNotification = {
                text: msg,
                htmlContent: `${msg} <div style="margin-top:10px;"><button class="btn btn-sm" onclick="event.stopPropagation(); GKApp.clearAgentNotification()" style="background:#FFF9C4; color:#6B3F1A; border:1px solid #FFE082; padding:2px 10px; font-size:0.75rem; border-radius:15px; font-weight:700;">✅ Got it</button></div>`
              };
            } else if ((updatedUser.totalXP || 0) > (state.user.totalXP || 0)) {
              const diff = updatedUser.totalXP - state.user.totalXP;
              const msg = `Wonderful news! Your Guru has awarded you ${diff} bonus XP for your dedication. 🌟`;
              GKVoice.speak(msg);
              state.activeNotification = {
                text: msg,
                htmlContent: `${msg} <div style="margin-top:10px;"><button class="btn btn-sm" onclick="event.stopPropagation(); GKApp.clearAgentNotification()" style="background:#FFF9C4; color:#6B3F1A; border:1px solid #FFE082; padding:2px 10px; font-size:0.75rem; border-radius:15px; font-weight:700;">✅ Clear</button></div>`
              };
            }

            state.user = updatedUser;
            _syncAssistantForUser(activeId);

            // Clear TTS memory on cross-tab rank/profile mutation
            if (typeof _spokenScreens !== 'undefined') _spokenScreens.clear();

            // Re-populate and re-filter modules if we have a session active
            if (state.calibration) {
              const unlockedTopics = updatedUser.unlockedTopics || [];
              state.modules = _assignStudentModules(
                state.calibration,
                updatedUser.completedTopics || [],
                unlockedTopics
              );
            }

            // Re-render current screen to reflect new completions/unlocks/resets
            render();
          }
        }
      }
    });

    // Fallback polling (essential for local file:// cross-tab syncing)
    setInterval(async () => {
      if (state.isMirror) return;  // mirror mode uses SSE — polling not needed
      const activeId = state.user ? state.user.id : null;
      if (activeId) {
        // Refresh cache from server so mentor notes & other updates arrive
        await GKDatabase.refresh();
        const profile = GKStore.getUserProfile(activeId);
        if (!profile) return;
        const baseUser = GK_USERS.find(u => u.id === activeId) || {};
        const mergedUser = { ...baseUser, ...profile };
        const newData = JSON.stringify(mergedUser);
        if (JSON.stringify(state.user) !== newData) {
          // Announcement logic for polling fallback too
          const newNotes = mergedUser.mentorNotes || [];
          const oldNotes = state.user.mentorNotes || [];
          if (newNotes.length > oldNotes.length) {
            const note = newNotes[newNotes.length - 1];
            const msg = `Namaste! Your Guru has sent some new guidance: "${note.message}" 🙏`;
            GKVoice.speak(msg);
            state.activeNotification = {
              text: msg,
              htmlContent: `${msg} <div style="margin-top:10px;"><button class="btn btn-sm" onclick="event.stopPropagation(); GKApp.clearAgentNotification()" style="background:#FFF9C4; color:#6B3F1A; border:1px solid #FFE082; padding:2px 10px; font-size:0.75rem; border-radius:15px; font-weight:700;">✅ Got it</button></div>`
            };
          } else if ((mergedUser.totalXP || 0) > (state.user.totalXP || 0)) {
            const diff = mergedUser.totalXP - state.user.totalXP;
            const msg = `Excellent! You have received ${diff} bonus XP from your Guru. 🌟`;
            GKVoice.speak(msg);
            state.activeNotification = {
              text: msg,
              htmlContent: `${msg} <div style="margin-top:10px;"><button class="btn btn-sm" onclick="event.stopPropagation(); GKApp.clearAgentNotification()" style="background:#FFF9C4; color:#6B3F1A; border:1px solid #FFE082; padding:2px 10px; font-size:0.75rem; border-radius:15px; font-weight:700;">✅ Clear</button></div>`
            };
          }

          state.user = mergedUser;
          if (typeof _spokenScreens !== 'undefined') _spokenScreens.clear();

          if (state.calibration) {
            const unlockedTopics = profile.unlockedTopics || [];
            state.modules = _assignStudentModules(
              state.calibration,
              profile.completedTopics || [],
              unlockedTopics
            );
          }
          render();
        }
      }

      // Topic timer logic - added as per user request
      if (state.currentScreen === 'learning' && state._topicStartTime && !state._topicWarningSent) {
        const elapsed = Date.now() - state._topicStartTime;
        if (elapsed > 180000) { // 3 minutes = 180s
          state._topicWarningSent = true;
          const msg = "Guru says: 2 minutes left to master this topic! 🙏";
          state.activeNotification = {
            text: msg,
            htmlContent: `<div style="display:flex; align-items:center; gap:1rem;">
                            <div style="font-size:2rem;">⏳</div>
                            <div>
                              <div style="font-weight:700; color:#6B3F1A;">Time Enlightenment</div>
                              <div style="font-size:0.85rem;">${msg}</div>
                            </div>
                          </div>
                          <div style="margin-top:10px; text-align:right;">
                            <button class="btn btn-sm" onclick="event.stopPropagation(); GKApp.clearAgentNotification()" style="background:#FFF9C4; color:#6B3F1A; border:1px solid #FFE082; padding:2px 10px; font-size:0.75rem; border-radius:15px; font-weight:700;">✅ Understood</button>
                          </div>`
          };
          GKVoice.speak(msg);
          render();
        }
      }
    }, 5000); // Polling every 5s
  }

  // ---- Collapsible Sidebar Menu ----
  function renderSidebarToggleBtn(inHeader = false) {
    const label = state.sidebarCollapsed ? 'Open menu' : 'Close menu';
    const extraClass = inHeader ? ' sidebar-toggle-in-header' : ' sidebar-toggle-floating';
    return `
      <button type="button" class="sidebar-toggle-btn${extraClass}" onclick="GKApp.toggleSidebar()" title="${label}" aria-label="${label}">
        <span class="sidebar-toggle-icon" aria-hidden="true"><span></span><span></span><span></span></span>
      </button>`;
  }

  function _getSidebarSubjects() {
    const seen = new Map();
    const modules = state.modules || [];

    modules.forEach(m => {
      if (m.assigned === false) return;
      if (!seen.has(m.subjectId)) {
        seen.set(m.subjectId, {
          id: m.subjectId,
          name: m.subjectName,
          icon: m.subjectIcon,
          color: m.subjectColor
        });
      }
    });

    if (seen.size === 0 && typeof GK_TOPICS !== 'undefined') {
      GK_TOPICS.subjects
        .filter(s => s.type !== 'para-vidya')
        .forEach(s => {
          seen.set(s.id, { id: s.id, name: s.name, icon: s.icon, color: s.color });
        });
    }

    const order = [...TIMETABLE_SUBJECT_IDS];
    return [...seen.values()].sort((a, b) => {
      const ai = order.indexOf(a.id);
      const bi = order.indexOf(b.id);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  }

  function _resolveActiveSidebarSubject(activeSubjectId) {
    if (activeSubjectId) return activeSubjectId;
    if (state.activeSidebarSubjectId) return state.activeSidebarSubjectId;
    if (state.currentScreen === 'learning' && state.modules[state.activeModuleIdx]) {
      return state.modules[state.activeModuleIdx].subjectId;
    }
    return null;
  }

  function renderSidebarSubjectsBlock(activeSubjectId) {
    const subjects = _getSidebarSubjects();
    if (subjects.length === 0) return '';

    const active = _resolveActiveSidebarSubject(activeSubjectId);
    const expanded = state.sidebarSubjectsExpanded;
    const listHtml = subjects.map(s => `
      <button type="button"
        class="sidebar-menu-item sidebar-subject-item subject-${s.id} ${active === s.id ? 'active' : ''}"
        onclick="GKApp.selectSidebarSubject('${s.id}')"
        style="--subject-accent:${s.color || 'var(--primary)'}">
        <span class="sidebar-menu-item-icon">${s.icon}</span>
        <span class="sidebar-menu-item-label">${s.name}</span>
        <span class="sidebar-subject-dot" aria-hidden="true"></span>
      </button>
    `).join('');

    return `
      <div class="sidebar-subjects-block">
        <button type="button" class="sidebar-subjects-toggle" onclick="GKApp.toggleSidebarSubjects()"
          aria-expanded="${expanded}">
          <span class="sidebar-subjects-toggle-label">Subjects</span>
          <span class="sidebar-subjects-chevron" aria-hidden="true">${expanded ? '▴' : '▾'}</span>
        </button>
        ${expanded ? `<div class="sidebar-subjects-list">${listHtml}</div>` : ''}
      </div>`;
  }

  function renderSidebarMenu(activeId = 'topics', activeSubjectId = null) {
    const menuItems = [
      { id: 'schedule', icon: '📅', label: "Today's Schedule", active: activeId === 'schedule' },
      { id: 'dashboard', icon: '📊', label: 'Dashboard', active: activeId === 'dashboard' },
      { id: 'progress', icon: '📈', label: 'My Progress', active: activeId === 'progress' },
      { id: 'topics', icon: '📚', label: 'All Topics', active: activeId === 'topics' },
      { id: 'achievements', icon: '🏆', label: 'Achievements', active: activeId === 'achievements' },
      { id: 'resources', icon: '🔗', label: 'Resources', active: activeId === 'resources' },
      { id: 'help', icon: '❓', label: 'Help & Support', active: activeId === 'help' }
    ];

    const menuItemsHtml = menuItems.map(item => `
      <button type="button" class="sidebar-menu-item ${item.active ? 'active' : ''}" onclick="GKApp.selectSidebarItem('${item.id}')">
        <span class="sidebar-menu-item-icon">${item.icon}</span>
        <span class="sidebar-menu-item-label">${item.label}</span>
      </button>
    `).join('');

    const subjectsBlock = renderSidebarSubjectsBlock(activeSubjectId);

    const backdrop = state.sidebarCollapsed
      ? ''
      : '<div class="sidebar-backdrop" id="sidebar-backdrop" aria-hidden="true"></div>';

    return `
      ${backdrop}
      <div class="sidebar-container ${state.sidebarCollapsed ? 'collapsed' : ''}" id="gk-sidebar-menu">
        <div class="sidebar-header">
          <h2 class="sidebar-title">📚 Menu</h2>
          ${!state.sidebarCollapsed ? renderSidebarToggleBtn(true) : ''}
        </div>
        <nav class="sidebar-menu">
          ${menuItemsHtml}
          ${subjectsBlock}
        </nav>
        <div class="sidebar-footer">
          <button type="button" class="sidebar-footer-btn" onclick="GKApp.toggleSidebar()">Hide menu</button>
        </div>
      </div>
    `;
  }

  function _collapseSidebarState() {
    state.sidebarCollapsed = true;
    try {
      sessionStorage.setItem('gk_sidebar_collapsed', 'true');
    } catch (_) { /* ignore */ }
  }

  function closeSidebar() {
    if (state.sidebarCollapsed) return;
    _collapseSidebarState();
    render();
  }

  function toggleSidebar() {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    try {
      sessionStorage.setItem('gk_sidebar_collapsed', String(state.sidebarCollapsed));
    } catch (_) { /* ignore */ }
    render();
  }

  function _bindSidebarDismissListeners() {
    if (state._sidebarDismissHandler) {
      document.removeEventListener('mousedown', state._sidebarDismissHandler, true);
      state._sidebarDismissHandler = null;
    }
    if (state.sidebarCollapsed) return;
    if (state.currentScreen !== 'modules' && state.currentScreen !== 'learning') return;

    const onOutside = (e) => {
      if (state.sidebarCollapsed) return;
      const t = e.target;
      if (!t || !(t instanceof Element)) return;
      if (t.closest('#gk-sidebar-menu') || t.closest('.sidebar-toggle-btn')) return;
      closeSidebar();
    };

    state._sidebarDismissHandler = onOutside;
    document.addEventListener('mousedown', onOutside, true);

    const backdrop = document.getElementById('sidebar-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', () => closeSidebar());
    }
  }

  function selectSidebarItem(itemId) {
    if (itemId === 'schedule' || itemId === 'dashboard') {
      state.activeSidebarSubjectId = null;
      navigate('modules');
      return;
    }
    if (itemId === 'topics' && state.currentScreen !== 'learning') {
      if (state.currentModule) {
        navigate('subtopics');
      } else {
        navigate('modules');
      }
      return;
    }
    _collapseSidebarState();
    render();
    console.log('Selected sidebar item:', itemId);
  }

  function selectSidebarSubject(subjectId) {
    state.activeSidebarSubjectId = subjectId;
    openTodayLesson(subjectId);
  }

  function toggleSidebarSubjects() {
    state.sidebarSubjectsExpanded = !state.sidebarSubjectsExpanded;
    try {
      sessionStorage.setItem('gk_sidebar_subjects_expanded', String(state.sidebarSubjectsExpanded));
    } catch (_) { /* ignore */ }
    render();
  }

  // Expose public API
  // ── Timetable drag-and-drop handlers ─────────────────────────────────────
  function onTTDragStart(event, fp) {
    state.isDragging = true;
    state.ttDragSrc = fp;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(fp));
    // Apply dragging style after a tick so the ghost image is captured first
    setTimeout(() => {
      const el = document.querySelector(`[data-fp="${fp}"]`);
      if (el) el.classList.add('tt-dragging');
    }, 0);
  }

  function onTTDragEnd(event) {
    state.isDragging = false;
    document.querySelectorAll('.tt-dragging, .tt-drag-over').forEach(el => {
      el.classList.remove('tt-dragging', 'tt-drag-over');
    });
    state.ttDragSrc = null;

    // Safety: ensure UI refreshes to clear any stuck states
    render();
  }

  function onTTDragOver(event, fp) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (fp !== state.ttDragSrc) {
      event.currentTarget.classList.add('tt-drag-over');
    }
  }

  function onTTDragLeave(event) {
    event.currentTarget.classList.remove('tt-drag-over');
  }

  function onTTDrop(event, fp) {
    event.preventDefault();
    event.currentTarget.classList.remove('tt-drag-over');
    const src = state.ttDragSrc;
    if (src === null || src === fp) return;

    // Swap the two flex-slot assignments
    const order = state.ttFlexOrder;
    [order[src], order[fp]] = [order[fp], order[src]];
    state.ttFlexOrder = order;
    sessionStorage.setItem('gk_tt_flex_order_v9_' + state.user.id, JSON.stringify(order));

    // Fix: Clear dragging state before render, otherwise render() will return early
    state.isDragging = false;
    render();
  }

  let _vschedPointer = null;

  function _vSchedIdxFromPoint(clientX, clientY) {
    const dragging = document.querySelector('.vsched-dragging');
    if (dragging) dragging.style.pointerEvents = 'none';
    const el = document.elementFromPoint(clientX, clientY);
    if (dragging) dragging.style.pointerEvents = '';
    const card = el && el.closest ? el.closest('[data-vslot].vsched-draggable') : null;
    if (!card) return null;
    const idx = parseInt(card.getAttribute('data-vslot'), 10);
    if (Number.isNaN(idx)) return null;
    const slot = state.verticalSchedule?.[idx];
    if (!slot || slot.type === 'lunch') return null;
    return idx;
  }

  function _vSchedClearDragOver() {
    document.querySelectorAll('.vsched-drag-over').forEach(el => {
      el.classList.remove('vsched-drag-over');
    });
  }

  function _vSchedHighlightTarget(idx) {
    _vSchedClearDragOver();
    if (idx == null || idx === state.verticalDragSrc) return;
    const card = document.querySelector(`[data-vslot="${idx}"].vsched-draggable`);
    if (card) card.classList.add('vsched-drag-over');
  }

  function _vSchedCommitMove(src, targetIdx) {
    if (src == null || targetIdx == null || Number.isNaN(targetIdx)) return false;
    if (src === targetIdx) return false;
    const targetSlot = state.verticalSchedule?.[targetIdx];
    if (!targetSlot || targetSlot.type === 'lunch') return false;

    let slots = state.verticalSchedule.map(s => ({ ...s }));
    slots = _moveVerticalScheduleSlot(slots, src, targetIdx);
    if (!slots) return false;

    const visible = (state.modules || []).filter(
      m => m.assigned !== false && TIMETABLE_SUBJECT_IDS.includes(m.subjectId)
    );
    slots = _syncVerticalSlotTopics(slots, visible);

    state.verticalSchedule = slots;
    _saveVerticalSchedule();
    return true;
  }

  function _vSchedEndPointerDrag(committed) {
    document.removeEventListener('pointermove', _vSchedOnPointerMove);
    document.removeEventListener('pointerup', _vSchedOnPointerUp);
    document.removeEventListener('pointercancel', _vSchedOnPointerUp);
    _vschedPointer = null;
    _vSchedClearDragOver();
    document.querySelectorAll('.vsched-dragging').forEach(el => {
      el.classList.remove('vsched-dragging');
      el.style.pointerEvents = '';
    });
    const list = document.querySelector('.vertical-schedule-list');
    if (list) list.classList.remove('is-vsched-dragging');

    state.isDragging = false;
    state.verticalDragSrc = null;
    state.verticalDropTarget = null;

    if (committed) {
      state.verticalDragCommitted = true;
      state.verticalSuppressClick = true;
      state.vschedDidMove = true;
      render();
    } else {
      state.verticalDragCommitted = false;
    }
  }

  function _vSchedOnPointerMove(event) {
    if (!_vschedPointer || event.pointerId !== _vschedPointer.pointerId) return;
    event.preventDefault();
    if (Math.abs(event.clientY - _vschedPointer.startY) > 4) {
      _vschedPointer.moved = true;
    }
    const idx = _vSchedIdxFromPoint(event.clientX, event.clientY);
    state.verticalDropTarget = idx;
    _vSchedHighlightTarget(idx);
  }

  function _vSchedOnPointerUp(event) {
    if (!_vschedPointer || event.pointerId !== _vschedPointer.pointerId) return;
    event.preventDefault();

    const src = _vschedPointer.src;
    let targetIdx = _vSchedIdxFromPoint(event.clientX, event.clientY);
    if (targetIdx == null) targetIdx = state.verticalDropTarget;

    const committed = _vschedPointer.moved && _vSchedCommitMove(src, targetIdx);
    _vSchedEndPointerDrag(committed);
  }

  function onVSchedPointerDown(event, idx) {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    const slot = state.verticalSchedule?.[idx];
    if (!slot || slot.type === 'lunch') return;

    event.preventDefault();
    event.stopPropagation();

    const handle = event.currentTarget;
    try { handle.setPointerCapture(event.pointerId); } catch (_) { /* ignore */ }

    state.isDragging = true;
    state.verticalDragSrc = idx;
    state.verticalDropTarget = null;
    state.verticalDragCommitted = false;
    state.vschedDidMove = false;

    const card = handle.closest('[data-vslot]');
    if (card) card.classList.add('vsched-dragging');
    document.querySelector('.vertical-schedule-list')?.classList.add('is-vsched-dragging');

    _vschedPointer = {
      pointerId: event.pointerId,
      src: idx,
      startY: event.clientY,
      moved: false
    };

    document.addEventListener('pointermove', _vSchedOnPointerMove, { passive: false });
    document.addEventListener('pointerup', _vSchedOnPointerUp, { passive: false });
    document.addEventListener('pointercancel', _vSchedOnPointerUp, { passive: false });
  }

  function onVSchedCardClick(event, moduleIdx) {
    if (state.verticalSuppressClick || state.vschedDidMove) {
      state.verticalSuppressClick = false;
      state.vschedDidMove = false;
      return;
    }
    startModule(moduleIdx);
  }

  // ---- Demo Override (tick button to mark a module as complete) ----
  function toggleDemoOverride(subjectId, topicId) {
    const userId = state.user.id;
    const key = `${subjectId}-${topicId}`;
    
    // Read from profile state, not local storage
    const overrides = state.user.overrides || {};
    const newState = !overrides[key];
    
    // Save to server
    GKStore.saveUserProfile(userId, { overrides: { [key]: newState } });
    
    // Update local state immediately for fast feedback
    state.user.overrides = { ...overrides, [key]: newState };
    
    render(); // Re-render to reflect the change
  }

  function completeDay() {
    const userId = state.user.id;
    const overrides = state.user.overrides || {};

    // Mark ALL currently assigned modules as complete for demo purposes
    const newOverrides = {};
    state.modules.forEach(m => {
      const key = `${m.subjectId}-${m.topicId}`;
      overrides[key] = true;
      newOverrides[key] = true;
    });

    // Sync all new overrides to server
    GKStore.saveUserProfile(userId, { overrides: newOverrides });
    
    // Update local state immediately
    state.user.overrides = { ...overrides, ...newOverrides };
    
    render();
  }

  // ---- Topic Quick-Check Modal ----

  function openTopicQuickCheck(subjectId, topicId) {
    const td = GKRecommender.getTopicData(subjectId, topicId);
    if (!td) return;

    const modIdx = state.modules.findIndex(m => m.subjectId === subjectId && m.topicId === topicId);
    if (modIdx !== -1) state.activeModuleIdx = modIdx;

    // Check if user already has a result for this (Single Attempt Limit)
    const results = GKStore.getQuickCheckResults(state.user.id) || [];
    const existing = results.find(r => r.subjectId === subjectId && r.topicId === topicId);

    if (existing) {
      _quickCheck = { ...existing, submitted: true, alreadyDone: true };
      _renderQuickCheckModal();
      return;
    }

    // Try to get assessment questions from subtopics first
    let qs = td.topic.subtopics.flatMap(st => st.assessment || []);

    if (qs.length < 1) {
      // If no embedded questions, generate mixed-type demo questions (Variety)
      const tName = td.topic.name;

      // Basic pool of questions to randomly draw from for retakes
      const pool = [
        { question: `What is a core principle of ${tName}?`, type: 'mcq', options: ['Option A', 'Option B', 'Option C', 'Option D'], correct: 0, explanation: `The core principle involves Option A.` },
        { question: `True or False: ${tName} is fundamental to this subject area.`, type: 'true-false', options: ['True', 'False'], correct: 0 },
        { question: `Complete this sentence: ${tName} allows us to explore ___. (Hint: "knowledge")`, type: 'fill-blank', correct: ['knowledge', 'concepts'], explanation: 'Accurate terminology is key.' },
        { question: `Give a brief real-world example of ${tName} in 1-2 sentences.`, type: 'short-answer', explanation: 'Your mentor will review your practical understanding.' },
        { question: `Reflecting on your studies, how does ${tName} connect to other topics we've covered? Write a paragraph.`, type: 'long-answer', explanation: 'This helps gauge your depth of synthesis.' },
        { question: `Which of the following is NOT related to ${tName}?`, type: 'mcq', options: ['Concept X', 'Concept Y', 'Unrelated Concept', 'Concept Z'], correct: 2, explanation: `The unrelated concept is not part of ${tName}.` },
        { question: `Write a short summary of the most interesting fact you learned about ${tName}.`, type: 'short-answer', explanation: 'Reflection helps solidify memory.' },
        { question: `True or False: The concepts in ${tName} are only theoretical and have no practical application.`, type: 'true-false', options: ['True', 'False'], correct: 1, explanation: 'False! Most concepts here have strong practical components.' }
      ];

      // Shuffle and pick 5 to provide variety on retakes
      const shuffled = [...pool].sort(() => 0.5 - Math.random());
      qs = shuffled.slice(0, 5);
    }

    // Take up to 5 questions
    qs = qs.slice(0, 5);
    _quickCheck = { subjectId, topicId, topicName: td.topic.name, questions: qs, answers: {}, submitted: false };
    _renderQuickCheckModal();
  }

  function _renderQuickCheckModal() {
    const existing = document.getElementById('qc-overlay');
    if (existing) existing.remove();
    const { topicName, questions, answers, submitted } = _quickCheck;

    const overlay = document.createElement('div');
    overlay.id = 'qc-overlay';
    overlay.className = 'qc-overlay';
    // Prevent closing by clicking backdrop once submitted
    overlay.addEventListener('click', e => {
      if (e.target === overlay && !submitted) GKApp.closeTopicQuickCheck();
    });

    overlay.innerHTML = submitted
      ? `
        <div class="qc-modal">
          <div class="qc-header">
            <span class="qc-title">📝 Quick Check · ${topicName}</span>
          </div>
          <div class="qc-body qc-submitted-body">
            <div class="qc-submitted-icon">✅</div>
            <p class="qc-submitted-msg">Assessment submitted!</p>
            <p class="qc-submitted-sub">Your responses have been recorded. Your mentor will review your answers.</p>
          </div>
          <div class="qc-footer">
            <button class="btn qc-done-btn" onclick="GKApp.closeTopicQuickCheckAndFeedback()">Continue to Module Feedback →</button>
          </div>
        </div>`
      : `
        <div class="qc-modal">
          <div class="qc-header">
            <span class="qc-title">📝 Quick Check · ${topicName}</span>
            <button class="qc-close-btn" onclick="GKApp.closeTopicQuickCheck()">✕</button>
          </div>
          <div class="qc-body">
            ${_quickCheck.alreadyDone ? `
              <div class="qc-submitted-body" style="padding: 1rem; text-align: center;">
                <div class="qc-submitted-icon" style="font-size: 2.5rem; margin-bottom: 0.5rem;">📜</div>
                <p class="qc-submitted-msg" style="font-weight: 700;">Assessment Already Completed</p>
                <p class="qc-submitted-sub">You have already submitted this assessment. To maintain the integrity of your learning path, each topic assessment can only be taken once.</p>
              </div>
            ` :
        questions.map((q, qi) => {
          const hasOptions = q.options && Array.isArray(q.options) && q.options.length > 0;
          const isLong = q.type === 'long-answer';
          const isFile = q.type === 'file-upload';
          const isOrder = q.type === 'ordering';

          return `
                <div class="qc-question">
                  <p class="qc-q-text">${qi + 1}. ${q.question}</p>
                  <div class="qc-options">
                    ${hasOptions && !isOrder ? q.options.map((opt, oi) => `
                      <label class="qc-option">
                        <input type="radio" name="qcq${qi}" value="${oi}"
                          ${answers[qi] === oi ? 'checked' : ''}
                          onchange="GKApp.onQCAnswer(${qi},${oi})">
                        <span>${opt}</span>
                      </label>`).join('') :
              (isOrder ? `
                      <div class="ordering-items">
                         ${q.options.map((opt, oi) => `
                          <button class="btn btn-secondary ordering-btn-qc" onclick="GKApp.onQCOrdering(${qi}, ${oi}); this.disabled=true; this.style.opacity='0.5';">${opt}</button>`
              ).join('')}
                      </div>
                      <div id="ordering-qc-${qi}" style="margin-top:10px; font-size:0.8rem; background:#eee; padding:5px;"></div>
                    ` :
                (isFile ? `
                      <div class="file-upload-wrap" style="text-align:center;">
                        <input type="file" onchange="GKApp.onQCAnswer(${qi}, this.files[0] ? this.files[0].name : '')" />
                      </div>
                    ` :
                  (isLong ? `
                      <textarea class="qc-text-area" placeholder="Write your paragraph here..." 
                                style="width: 100%; min-height: 100px; padding: 0.75rem; border: 1.5px solid var(--border); border-radius: 8px; font-family: inherit; font-size: 0.88rem; resize: vertical;"
                                oninput="GKApp.onQCAnswer(${qi}, this.value)">${answers[qi] || ''}</textarea>
                      ` : `
                      <div class="qc-text-input-wrap">
                        <input type="text" class="qc-text-input" placeholder="Type your answer here..." 
                               oninput="GKApp.onQCAnswer(${qi}, this.value)"
                               value="${answers[qi] || ''}"
                               style="width: 100%; padding: 0.65rem; border: 1.5px solid var(--border); border-radius: 8px; font-size: 0.88rem;">
                      </div>
                    `)))}
                  </div>
                </div>`;
        }).join('')
      }
          </div >
  <div class="qc-footer">
    ${_quickCheck.alreadyDone ?
        `<button class="btn btn-primary qc-done-btn" style="width: 100%" onclick="GKApp.closeTopicQuickCheck()">Understood</button>` :
        `<button class="btn btn-primary qc-submit-btn" style="width: 100%" onclick="GKApp.submitTopicQuickCheck()">Submit Assessment</button>`
      }
  </div>
        </div > `;

    document.body.appendChild(overlay);
  }

  function onQCAnswer(qi, oi) {
    if (!_quickCheck || _quickCheck.submitted) return;
    _quickCheck.answers[qi] = oi;
  }

  function onQCOrdering(qi, oi) {
    if (!_quickCheck || _quickCheck.submitted) return;
    if (!Array.isArray(_quickCheck.answers[qi])) _quickCheck.answers[qi] = [];
    _quickCheck.answers[qi].push(oi);

    // Add visual feedback
    const selEl = document.getElementById(`ordering-qc-${qi}`);
    if (selEl) {
      const q = _quickCheck.questions[qi];
      selEl.innerHTML = _quickCheck.answers[qi].map((selectedOi, pos) => `<span style="display:inline-block;background:#E3F2FD;padding:4px 8px;border-radius:8px;margin:2px;font-size:0.75rem;">${pos + 1}. ${q.options[selectedOi]}</span>`).join('');
    }
  }

  function submitTopicQuickCheck() {
    if (!_quickCheck || _quickCheck.submitted) return;
    const { subjectId, topicId, topicName, questions, answers } = _quickCheck;

    // Build per-question answer record (results hidden from student, visible to mentor)
    const answerRecord = questions.map((q, i) => ({
      question: q.question,
      options: q.options,
      selectedOption: answers[i] !== undefined ? answers[i] : null,
      correct: q.correct,
      isCorrect: Array.isArray(q.correct) ?
        (Array.isArray(answers[i]) ? JSON.stringify(answers[i]) === JSON.stringify(q.options.map((_, idx) => idx).reverse()) : answers[i] === q.correct) :
        (answers[i] === q.correct)
    }));
    const score = answerRecord.filter(a => a.isCorrect).length;

    // Persist to data layer under the student's profile (mentor-visible, score hidden from student)
    GKStore.saveQuickCheckResult(state.user.id, {
      subjectId, topicId, topicName,
      answers: answerRecord,
      score,
      total: questions.length,
      submittedAt: new Date().toISOString()
    });

    // Also record it as a formal assessment attempt so it shows as "Done" on timetable
    GKStore.saveDetailedAssessmentResult(state.user.id, `${subjectId}-${topicId}`, score, questions.length, answerRecord);

    // Recording result in the active session so renderTimetable shows the tick mark immediately
    GKStore.recordAssessmentResult(`${subjectId}-${topicId}`, score, questions.length);

    // Topic completion is recorded
    GKStore.markTopicComplete(state.user.id, `${subjectId}-${topicId}`);

    _quickCheck.submitted = true;
    _renderQuickCheckModal();
    render(); // Re-render the background screen to reflect completion (unlock buttons)

    // Krishna feedback for Quick Check
    const bubble = document.getElementById('krishna-speech-bubble');
    if (bubble) {
      const percentage = Math.round((score / questions.length) * 100);
      let msg = "";
      if (percentage >= 80) msg = "Truly impressive! Your understanding shines bright. 🕉️";
      else if (percentage >= 60) msg = "Well done! You have a solid grasp of these concepts.";
      else msg = "This was a good attempt. Focus on specific areas and try again to deepen your wisdom. 🙏";

      bubble.textContent = msg;
      GKVoice.speak(msg);
    }
  }

  function closeTopicQuickCheck() {
    const overlay = document.getElementById('qc-overlay');
    if (overlay) {
      overlay.classList.add('qc-closing');
      setTimeout(() => overlay.remove(), 220);
    }
    _quickCheck = null;
  }

  function closeTopicQuickCheckAndFeedback() {
    closeTopicQuickCheck();
    if (state.activeModuleIdx !== undefined && state.activeModuleIdx !== null) {
      goToModuleFeedback();
    }
  }

  // ---- Floating Krishna Chat ----
  function toggleKrishnaChat() {
    const panel = document.getElementById('krishna-chat-panel');
    const btn = document.getElementById('krishna-float-btn');
    if (!panel) return;
    if (panel.style.display === 'none' || panel.style.display === '') {
      panel.style.display = 'block';
      if (btn) btn.style.transform = 'scale(0)';
    } else {
      panel.style.display = 'none';
      if (btn) btn.style.transform = 'scale(1)';
    }
  }

  function _getKrishnaContext() {
    const user = state.user || {};
    const mood = state.mood || {};
    
    let subjectName = 'Exploring';
    let topicName = 'General';
    let subtopicName = 'Introduction';
    
    // Attempt to derive from current module
    if (state.modules && state.modules[state.activeModuleIdx]) {
      const m = state.modules[state.activeModuleIdx];
      subjectName = m.subjectName || m.subjectId || 'Subject';
      topicName = m.topicName || m.topicId || 'Topic';
      
      const topicData = GKRecommender.getTopicData(m.subjectId, m.topicId);
      if (topicData && topicData.topic.subtopics[state.activeSubtopicIdx]) {
        subtopicName = topicData.topic.subtopics[state.activeSubtopicIdx].title || 'Subtopic';
      }
    }

    return {
      userName: user.displayName || 'Student',
      subject: subjectName,
      topic: topicName,
      subtopic: subtopicName,
      mood: mood.currentVibe || 'Balanced',
      energy: mood.brainBattery || 80,
      xp: user.totalXP || 0,
      completedTopics: user.completedTopics || [],
      persona: user.persona || 'Standard',
      history: state.chatHistory || []
    };
  }

  async function sendKrishnaChat() {
    const input = document.getElementById('krishna-chat-input');
    const msgs = document.getElementById('krishna-chat-msgs');
    if (!input || !msgs || !input.value.trim()) return;

    const q = input.value.trim();
    input.value = '';

    // Add user message
    msgs.innerHTML += `<div style="background:#E3F2FD;padding:0.6rem 0.8rem;border-radius:12px;margin-bottom:0.5rem;text-align:right;">${q}</div>`;
    msgs.scrollTop = msgs.scrollHeight;

    // Show loading indicator
    const loadingId = 'acharya-loading-' + Date.now();
    msgs.innerHTML += `<div id="${loadingId}" style="background:#F5F5F5;padding:0.6rem 0.8rem;border-radius:12px;margin-bottom:0.5rem;font-style:italic;color:#888;">Acharya is thinking... ✨</div>`;
    msgs.scrollTop = msgs.scrollHeight;

    if (!state.chatHistory) state.chatHistory = [];
    state.chatHistory.push({ role: 'user', text: q });

    try {
      const context = _getKrishnaContext();
      const response = await GKAITutor.respond(q, context);
      
      state.chatHistory.push({ role: 'ai', text: response });
      
      const loadingEl = document.getElementById(loadingId);
      if (loadingEl) loadingEl.remove();

      msgs.innerHTML += `<div style="background:#FFF8E1;padding:0.6rem 0.8rem;border-radius:12px;margin-bottom:0.5rem;">${response}</div>`;
      msgs.scrollTop = msgs.scrollHeight;
    } catch (e) {
      const loadingEl = document.getElementById(loadingId);
      if (loadingEl) loadingEl.remove();
      msgs.innerHTML += `<div style="background:#FFEBEE;padding:0.6rem 0.8rem;border-radius:12px;margin-bottom:0.5rem;color:#C62828;">I'm having trouble connecting right now. Let's try again in a moment! 🙏</div>`;
    }
  }

  async function askAI() {
    const input = document.getElementById('ai-input');
    if (!input) return;
    const question = input.value.trim();
    if (!question) return;

    if (!state.aiMessages) state.aiMessages = [];
    state.aiMessages.push({ role: 'user', text: question });

    // UI Feedback
    state.aiMessages.push({ role: 'ai', text: 'Acharya is thinking...', isLoading: true });
    input.value = '';
    render();

    try {
      await GK_AI_CONFIG.ensureLoaded();
      const context = _getKrishnaContext();
      context.history = state.aiMessages || []; 
      const response = await GKAITutor.respond(question, context);
      state.aiMessages = state.aiMessages.filter(m => !m.isLoading);
      state.aiMessages.push({ role: 'ai', text: response });
    } catch (e) {
      console.error("Sidebar Chat Error:", e);
      state.aiMessages = state.aiMessages.filter(m => !m.isLoading);
      state.aiMessages.push({ 
        role: 'ai', 
        text: `I'm having trouble connecting. 🙏 <div class="chat-error-notice">⚠️ ${e.message}</div>` 
      });
    }
    render();
    setTimeout(() => {
      const chat = document.getElementById('sidebar-chat');
      if (chat) chat.scrollTop = chat.scrollHeight;
    }, 100);
  }

  // ---- Mentor Review Submission (Popup) ----

  function openReviewPopup() {
    const existing = document.getElementById('review-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'review-overlay';
    overlay.className = 'qc-overlay'; // Re-use the quick check overlay styling
    // Prevent closing by clicking backdrop
    overlay.addEventListener('click', e => {
      if (e.target === overlay) GKApp.closeReviewPopup();
    });

    overlay.innerHTML = `
        <div class="qc-modal" style="max-width: 500px;">
          <div class="qc-header">
            <span class="qc-title">✨ ${_assistantName()}</span>
            <button class="qc-close-btn" onclick="GKApp.closeReviewPopup()">✕</button>
          </div>
          <div class="qc-body" style="text-align: center; padding: 1.5rem;">
            ${(() => { const av = GKAssistant.avatarUrlForExpression('guide'); return `<img src="${av.src}" alt="${av.alt}" style="width:100px; height:auto; margin-bottom: 1rem;" onerror="this.onerror=null;this.src='${av.fallback}'" />`; })()}
            <p style="font-size: 1rem; color: #6B3F1A; margin-bottom: 1rem; font-weight: 500;">
              Share your thoughts, reflections, or questions for your Guru from today's learning journey.
            </p>
            <div style="text-align: left;">
              <h3 style="font-size: 0.95rem; color: #6B3F1A; margin-bottom: 0.5rem; display:flex; align-items:center; gap: 0.4rem;">
                <span>✍️</span> My Letter to Guru
              </h3>
              <textarea id="popup-student-reflection" style="width: 100%; min-height: 100px; padding: 0.75rem; border: 1.5px solid #F5EDD8; border-radius: 8px; font-family: inherit; font-size: 0.95rem; resize: vertical;" placeholder="Dear Guru, today I learned..."></textarea>
            </div>
          </div>
          <div class="qc-footer">
            <button class="btn btn-primary qc-submit-btn" style="width: 100%" onclick="GKApp.submitPopupReflection()">Submit to Mentor</button>
          </div>
        </div>`;

    document.body.appendChild(overlay);
  }

  function closeReviewPopup() {
    const overlay = document.getElementById('review-overlay');
    if (overlay) {
      overlay.classList.add('qc-closing');
      setTimeout(() => overlay.remove(), 220);
    }
  }

  function submitPopupReflection() {
    const reflectionEl = document.getElementById('popup-student-reflection');
    let text = '';
    if (reflectionEl) {
      text = reflectionEl.value.trim();
      if (text) {
        GKStore.updateSession({ studentReflection: text });
      }
    }

    // Trigger actual mentor review submission logic
    const { user } = state;
    const session = GKStore.getSession() || {};
    GKStore.saveMentorReviewRequest(user.id, {
      studentName: user.displayName,
      date: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
      xpEarned: session.xpEarned || state.sessionXP || 0,
      completedSubtopics: session.completedSubtopics || [],
      studentReflection: text
    });
    GKXPManager.checkAndAwardBadges(user.id);

    // Mark session as fully complete locally
    session.submittedForReview = true;
    localStorage.setItem('gk_session_' + user.id, JSON.stringify(session));

    closeReviewPopup();
    _showToast("✅ Submitted to Mentor");
    navigate('feedback');
  }

  function _showToast(message) {
    const existing = document.getElementById('gk-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'gk-toast';
    toast.className = 'gk-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('gk-toast-visible'));
    setTimeout(() => {
      toast.classList.remove('gk-toast-visible');
      setTimeout(() => toast.remove(), 400);
    }, 3500);
  }

  return {
    init, navigate, render,
    // Mood
    updateBattery, selectVibe, submitMood, skipToLearning,
    // Modules
    startModule, startModuleRetake, enterLessonFromModule, openTodayLesson, continueResumeLesson,
    backToModules, backToSchedule, backToLogin, backToHomePage, backFromMood, backFromSchedule, backFromAncientGame,
    toggleCompletedModule,
    dismissMentorNotes,
    // Mentor Review Submission popup
    openReviewPopup, closeReviewPopup, submitPopupReflection,
    // Topic Quick-Check Modal
    openTopicQuickCheck, onQCAnswer, onQCOrdering, submitTopicQuickCheck, closeTopicQuickCheck, closeTopicQuickCheckAndFeedback, startModuleAssessment,
    // Demo Override
    toggleDemoOverride, completeDay,
    // Timetable drag-and-drop
    onTTDragStart, onTTDragEnd, onTTDragOver, onTTDragLeave, onTTDrop,
    onVSchedPointerDown, onVSchedCardClick,
    // Subtopics
    startSubtopic, backToSubtopics, startChallenge, retakeChallenge,
    toggleOptionalSubtopics, toggleSubtopicExpand,
    // Concepts
    nextConcept, prevConcept, startGame,
    advanceLessonFlow, prevLessonFlow, continueLessonFlowAfterLight, continueLessonFlowAfterFinal, completeLessonFlow,
    // Games 
    classifyToggle, submitClassify,
    answerMCQGame, nextMCQGame,
    answerGraph, nextGraphQ,
    seqClick, checkSequence,
    startBreathing, stopBreathing,
    afterGame,
    // Assessment
    selectAnswer, nextQuestion,
    // New assessment question type handlers
    submitFillBlankAssessment, submitShortAnswer, submitMultipleCorrect,
    selectOrderItem, submitOrdering, submitMatch, submitFileUpload,
    // Subtopic feedback
    selectSubtopicFeedback: () => { }, submitSubtopicFeedback, skipSubtopicFeedback,
    // Module feedback
    selectModuleFeedback: () => { }, submitModuleFeedback, skipModuleFeedback,
    goToModuleFeedback,
    // End-of-session feedback
    selectFeedback: () => { }, submitFeedback,
    // AI
    askAI, getHint,
    // Final Assessment
    startFinalAssessment, finishFinalAssessment,
    // Navigation
    goToFeedback, nextModule, startNewSession, logout,
    toggleNotifications, toggleKrishnaChat, sendKrishnaChat, markNoteRead, checkNotifications,
    // Veda Yatra & New Game types
    rollAncientDice, toggleMokshaPanel, showMokshaRules,
    submitParaWriting, _fbUpdate,
    // Sidebar Menu
    toggleSidebar, closeSidebar, selectSidebarItem, selectSidebarSubject, toggleSidebarSubjects,
    selectAssistant,
    // Clear Agent Notification
    clearAgentNotification() {
      state.activeNotification = null;
      render();
    },
    async sendAgentQuery() {
      const input = document.getElementById('agent-query-input');
      const text = input ? input.value.trim() : '';
      if (!text) return;
      
      const bubble = document.querySelector('.agent-speech-bubble');
      if (!bubble) return;

      // 1. Ensure config initialized
      await GK_AI_CONFIG.ensureLoaded();

      // 2. Show dynamic loading state
      const toggleHtml = `<button class="krishna-voice-toggle" onclick="event.stopPropagation(); GKVoice.toggle(this)" title="Toggle Krishna voice" style="background:none;border:none;cursor:pointer;font-size:1.1rem;opacity:0.65;padding:0.15rem 0.3rem;line-height:1;" aria-label="Toggle voice">${GKVoice.isEnabled() ? '🔊' : '🔇'}</button>`;
      const actionsHtml = `
        <div class="bubble-actions">
          <button class="dhyana-expand-btn" title="Expand for Deep Focus">⛶</button>
          ${toggleHtml}
        </div>
      `;

      bubble.innerHTML = `<div class="bubble-content" id="krishna-bubble-content"><span class="sparkle-rotate">✨</span> <span class="thinking-dots">Acharya is reflecting</span></div>${actionsHtml}`;
      
      // 3. Update avatar to thinking state
      const avatarImg = document.querySelector('.agent-avatar');
      if (avatarImg) avatarImg.src = GKAssistant.avatarUrlForExpression('thinking').src;

      // 4. Clear input
      input.value = '';

      // 5. Gather context
      const m = (state.modules && state.modules[state.activeModuleIdx]) ? state.modules[state.activeModuleIdx] : {};
      const context = {
        userName: state.user.displayName,
        subject: m.subjectName || 'General Learning',
        topic: m.topicName || 'Exploring',
        energy: state.calibration ? state.calibration.battery : 80,
        mood: state._selectedVibe || 'balanced',
        xp: state.user.totalXP || 0,
        persona: state.user.persona || 'Standard',
        completedTopics: state.user.completedTopics || [],
        history: state.chatHistory || []
      };

      try {
        const response = await GKAITutor.respond(text, context);
        // Restoring avatar to happy/engaged
        if (avatarImg) avatarImg.src = GKAssistant.avatarUrlForExpression('happy').src;
        // Use robust parser to render Markdown
        const formattedResponse = GKApp.parseMD(response);
        bubble.innerHTML = `<div class="bubble-content" id="krishna-bubble-content">${formattedResponse}</div>${actionsHtml}`;
        GKVoice.speak(response);
        if (!state.chatHistory) state.chatHistory = [];
        state.chatHistory.push({ role: 'user', text });
        state.chatHistory.push({ role: 'ai', text: response });
      } catch (e) {
        if (avatarImg) avatarImg.src = GKAssistant.avatarUrlForExpression('concerned').src;
        console.error("Krishna Chat Error:", e);
        bubble.innerHTML = `
          <div class="bubble-content" id="krishna-bubble-content">
            <div>I apologize, my ethereal connection is fading. Ask me again shortly! 🙏</div>
            <div class="chat-error-notice">
              <span>⚠️</span> <span>System Insight: ${e.message}</span>
            </div>
          </div>
          ${actionsHtml}`;
      }
    },
    toggleMute: (btn) => {
      GKVoice.toggle(btn);
    },
    toggleDhyanaMode: () => {
      const pane = document.getElementById('krishna-agent-pane');
      if (pane) {
        pane.classList.toggle('dhyana-active');
        const isDhyana = pane.classList.contains('dhyana-active');
        if (isDhyana) {
           // Auto-replay on open if voice enabled
           GKVoice.replay();
        }
      }
    },
    toggleMute: (btn) => {
      GKVoice.toggle(btn);
    },
    // Robust Markdown Parser for Krishna 2.0
    parseMD: (text) => {
      if (!text) return "";
      try {
        if (typeof marked === 'function') return marked(text);
        if (typeof marked !== 'undefined' && marked.parse) return marked.parse(text);
      } catch (e) {
        console.error("Markdown Parser Error:", e);
      }
      return text;
    }
  };
})();

// Boot the app when DOM is ready.
// GKDatabase.init() is async (sql.js WASM load); everything after is synchronous.
document.addEventListener('DOMContentLoaded', async () => {
  await GKDatabase.init();
  if (!GKBranding.isReady()) await GKBranding.init();
  await GKAssistant.loadConfig();
  if (typeof GKContentLoader !== 'undefined') await GKContentLoader.preloadApiSubjects();
  GKApp.init();
});
