// ============================================================
// MENTOR UI LAYER: mentor-app.js
// Mentor dashboard SPA controller.
// Handles mentor login, student overview, and mentor actions.
// ============================================================

const GKMentorApp = (() => {



  const state = {
    currentScreen: 'login',
    mentor: null,
    students: {},
    selectedStudentId: null,
    suggestionTopicKey: null,
    sidebarCollapsed: true,
    narayanaMsg: '',
    narayanaExpanded: false, // widget state
    mentorMoodSelected: 'high_energy', // Initialized to match UI default
    mentorBrainBattery: 70,            // Initialized to match UI default
    expandedSections: {},              // Tracks expanded state for bento items
    pendingInputs: {},                 // Tracks textarea values during typing
    evalCheckedState: {}               // Tracks eval checkbox states across re-renders
  };

  const KRISHNA_STATES = {
    default: { img: 'img/krishna-default.png', anim: 'breathe-soft' },
    meditating: { img: 'img/krishna-calm.png', anim: 'sway-subtle' },
    joyful: { img: 'img/krishna-encouraging.png', anim: 'bounce-joy' },
    thinking: { img: 'img/krishna-thinking.png', anim: 'pulse-glow' }
  };

  // ---- Navigation ----
  function navigate(screen, noScroll) {
    state.currentScreen = screen;
    render();
    if (!noScroll) window.scrollTo(0, 0);
  }

  function renderInPlace() {
    // If we are on liveView, don't swap the mentor's outer HTML — the iframe
    // manages its own real-time updates via SSE live_state events.
    if (state.currentScreen === 'liveView') {
      const frame = document.getElementById('sacred-mirror-frame');
      if (frame) return;
    }
    const scrollY = window.scrollY;
    render();
    window.scrollTo(0, scrollY);
  }

  // ---- Root Render ----
  function render() {
    const app = document.getElementById('mentor-app');
    const screens = {
      login: renderLogin,
      mentorMood: renderMentorMoodEval,
      dashboard: renderDashboard,
      studentDetail: renderStudentDetail,
      liveView: renderLiveView,
      holisticDetail: renderHolisticDetail,
      hqGeneration: renderHQGeneration,
      feedbackDashboard: renderFeedbackDashboard
    };
    const renderer = screens[state.currentScreen] || renderLogin;
    
    // PERSIST FOCUS: Save active element ID before re-rendering
    const activeId = document.activeElement ? document.activeElement.id : null;
    const scrollPos = window.scrollY;

    app.innerHTML = renderer();

    // RESTORE FOCUS: Restore focus if it was on a tracked element
    if (activeId) {
      const el = document.getElementById(activeId);
      if (el) {
        el.focus();
        // If it was a textarea/input, move cursor to end
        if (el.setSelectionRange && el.value) {
          const len = el.value.length;
          el.setSelectionRange(len, len);
        }
      }
    }

    attachEvents(state.currentScreen);
  }

  function renderKrishnaBody(mood = 'default', scale = 1) {
    const config = KRISHNA_STATES[mood] || KRISHNA_STATES.default;
    return `
      <div class="krishna-presence ${config.anim}" style="transform: scale(${scale});">
        <div class="krishna-halo"></div>
        <img src="${config.img}" class="krishna-image" alt="My Krishna" />
      </div>
    `;
  }


  // ---- Krishna: student summary for mentor detail view ----

  function renderKrishnaStudentCard(student, studentId) {
    const name = student.displayName || studentId;
    const completedTopics = student.completedTopics || [];
    const totalXP = student.totalXP || 0;
    const level = GKXPManager.getLevelForXP(totalXP);
    const sessionHistory = GKStore.getSessionHistory(studentId);
    const lastSession = sessionHistory[sessionHistory.length - 1];
    const isPromoted = student.isPromoted;

    const uniqueDays = new Set(sessionHistory.map(s => s.startTime ? s.startTime.split('T')[0] : null).filter(Boolean)).size;
    const hoursSpent = Math.round(sessionHistory.length * 0.5 * 10) / 10;
    const allCompletedSubs = (student.completedSubtopics || []).length;

    // Mood
    const moodSessions = sessionHistory.filter(s => s.mood && s.mood.currentVibe);
    const highCount = moodSessions.filter(s => s.mood.currentVibe === 'high_energy').length;
    const lowCount = moodSessions.filter(s => s.mood.currentVibe === 'low_energy').length;
    const lastMoodVibe = moodSessions.length > 0 ? moodSessions[moodSessions.length - 1].mood.currentVibe : null;
    const moodLabel = lastMoodVibe === 'high_energy' ? 'High Energy' : lastMoodVibe === 'low_energy' ? 'Low Energy' : '—';
    const moodIcon = lastMoodVibe === 'high_energy' ? '⚡' : lastMoodVibe === 'low_energy' ? '😌' : '😐';
    const moodColor = lastMoodVibe === 'high_energy' ? '#FF6F00' : '#757575';
    const moodBorder = lastMoodVibe === 'high_energy' ? '#FFA000' : lastMoodVibe === 'low_energy' ? '#BDBDBD' : '#E0E0E0';
    const moodBg = lastMoodVibe === 'high_energy' ? '#FFF8E1' : '#FAFAFA';
    const moodSub = moodSessions.length === 0 ? 'No mood data' : `⚡ ${highCount} high · 😌 ${lowCount} low`;

    const points = [
      { icon: '📚', label: 'Modules Completed', value: `${completedTopics.length}`, sub: `${allCompletedSubs} subtopics done`, color: '#E8F5E9', border: '#43A047' },
      { icon: '⏱', label: 'Hours in Learning', value: `${hoursSpent}h`, sub: `${sessionHistory.length} sessions`, color: '#E3F2FD', border: '#1E88E5' },
      { icon: '📅', label: 'Days Attended', value: `${uniqueDays}`, sub: uniqueDays > 0 ? `Last: ${_formatDate(lastSession ? lastSession.startTime : null)}` : 'No attendance yet', color: '#FFF8E1', border: '#FFC107' },
      { icon: moodIcon, label: 'Mood', value: moodLabel, sub: moodSub, color: moodBg, border: moodBorder, valColor: moodColor }
    ];

    const photo = student.photo || `https://api.dicebear.com/7.x/avataaars/svg?seed=${studentId}`;
    return `
      <div class="ksc-wrapper">
        <div class="student-card-profile">
          <div class="card-avatar-wrap">
            <img src="${photo}" alt="${name}" class="card-avatar" onerror="this.src='https://api.dicebear.com/7.x/avataaars/svg?seed=${studentId}';">
          </div>
          <div class="card-student-meta">
            <h3 class="card-student-name">${name}</h3>
            <p class="card-student-grade">Grade ${student.grade || '6'}</p>
          </div>
        </div>


        <!-- Krishna presenter row removed as per user request -->
        <div class="ksc-speech-bubble" style="margin-left: 0;">
            <div class="ksc-speech-text">Look at ${name}'s results 🙏</div>
            <div class="ksc-speech-sub">Grade ${student.grade || '?'} · ${student.preferredStyle || 'visual'} learner${isPromoted ? ' · ⬆️ Promoted' : ''}</div>
          </div>
        </div>

        <!-- 4 highlight chips -->
        <div class="ksc-highlights-row">
          ${points.map(p => `
            <div class="ksc-chip" style="background:${p.color}; border-bottom: 3px solid ${p.border};">
              <div class="ksc-chip-icon">${p.icon}</div>
              <div class="ksc-chip-val" ${p.valColor ? `style="color:${p.valColor};"` : ''}>${p.value}</div>
              <div class="ksc-chip-label">${p.label}</div>
              <div class="ksc-chip-sub">${p.sub}</div>
            </div>`).join('')}
        </div>

      </div>`;
  }

  function renderKrishnaSays(message, mood = 'thinking') {
    return `
      <div class="krishna-initiator-v3 krishna-initiator-column">
        <div class="krishna-speech-cloud">
          <span class="krishna-initiator-name">✨ Co-Mentor Krishna</span>
          <div class="krishna-initiator-text">${message}</div>
        </div>
        <div class="krishna-mini-body">
           ${renderKrishnaBody(mood, 1.0)}
        </div>
      </div>`;
  }

  function renderLogin() {
    return `
      <div class="screen screen-login">
        <div class="login-center-wrapper">
          <div class="login-card">
            <div class="login-logo">
              <img src="${GKBranding.logoPath()}" alt="${GKBranding.schoolName()}" style="width: 100px; height: auto; margin-bottom: 0.5rem;" />
              <h1 class="logo-title">${GKBranding.schoolName()}</h1>
              <p class="logo-subtitle">${GKBranding.get('mentorLoginSubtitle')}</p>
            </div>
            <form id="mentor-login-form" class="login-form">
              <div class="form-group">
                <label for="username">Mentor Username</label>
                <input type="text" id="username" placeholder="Enter mentor username"
                  autocomplete="off" value="mentor" />
              </div>
              <div class="form-group">
                <label for="password">Password</label>
                <input type="password" id="password" placeholder="Enter password" value="mentor123" />
              </div>
              <div id="login-error" class="error-msg hidden"></div>
              <button type="submit" class="btn btn-primary btn-full">
                Enter Mentor Dashboard 🎓
              </button>
            </form>
            <p class="login-hint">Demo: mentor / mentor123</p>
            <p class="login-hint"><a href="start.html" class="back-link">← Back to Home</a></p>
          </div>
        </div>
      </div>`;
  }


  // ---- SCREEN 1b: Mentor Mood Evaluation ----
  function renderMentorMoodEval() {
    const sel = state.mentorMoodSelected;
    const battery = state.mentorBrainBattery;
    const canSubmit = sel !== null;
    const vibeKeys = Object.keys(GKMoodEngine.VIBE_LABELS);

    return `
      <div class="screen screen-mentor screen-mood">
        ${renderMentorHeader()}
        <div class="screen-agent-row mood-unified-layout">
          ${_narayanaHtml('mentorMood', { _customMsg: "Aum! 🙏 Take a moment to reflect on your energy today, Guru. How are you feeling before you guide your students?" })}
          <div class="screen-content-col mood-glass-container">
            <div class="mood-card" style="width: 100%; max-width: 650px; margin: 0 auto; box-shadow: 0 30px 70px rgba(0,0,0,0.12);">
              <div class="mood-header">
                
                
                <p>Sync your energy with the Gurukul resonance.</p>
              </div>

              <div class="mood-section">
                <label class="mood-label" style="align-items: center; justify-content: flex-start; margin-bottom: 0.4rem;">
                  <span id="mentor-battery-label-text">🔋 Brain Battery</span>
                  <span id="mentor-battery-pct" style="margin-left: auto; font-weight: 700; color: var(--m-accent);">${battery}%</span>
                </label>
                <div style="text-align: left; margin-bottom: 0.5rem;">
                  <span id="mentor-battery-desc" style="font-size:0.85rem; color:#F57C00; font-weight:600;">
                    ${battery >= 70 ? 'Radiant & Ready' : battery >= 40 ? 'Stable & Focused' : 'Needs Contemplation'}
                  </span>
                </div>
                <input type="range" min="0" max="100" value="${battery}"
                       class="battery-slider"
                       oninput="GKMentorApp.updateMentorBattery(this.value)">
                <div class="battery-track" style="justify-content: space-between; margin-top: 0.4rem;">
                  <span style="font-weight: bold; color: #888;">0%</span>
                  <span style="font-weight: bold; color: #888;">100%</span>
                </div>
              </div>

              <div class="mood-section">
                <label class="mood-label">Current Vibe</label>
                <div class="vibe-options">
                  ${vibeKeys.map(key => {
      const v = GKMoodEngine.VIBE_LABELS[key];
      return `
                      <button class="vibe-btn ${sel === key ? 'selected' : ''}" 
                           onclick="GKMentorApp.selectMentorMood('${key}')">
                         <span class="vibe-emoji">${v.emoji}</span>
                         <span class="vibe-label">${v.label}</span>
                      </button>`;
    }).join('')}
                </div>
              </div>

              <div class="mood-action-row">
                <button class="btn btn-primary mood-action-btn" style="width: 100%;" 
                        onclick="GKMentorApp.submitMentorMood()" ${canSubmit ? '' : 'disabled'}>
                  ${canSubmit ? 'Enter Sacred Workspace →' : 'Align Energy to Continue'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>`;
  }

  // ---- SCREEN 2: Student Dashboard ----
  function renderDashboard() {
    return `
      <div class="screen screen-mentor">
        ${renderMentorHeader()}
        <div class="screen-full-col">
          <div class="mentor-content">
            <div class="mentor-page-header" style="flex-direction: row; justify-content: space-between; align-items: center;">
              <div>
                <h2 style="margin: 0;">Guru Dashboard</h2>
                <p style="margin: 0;">Monitor your students' progress and holistic development.</p>
              </div>
              <button class="btn btn-primary" onclick="GKMentorApp.loadFeedbackDashboard()" style="padding: 0.75rem 1.5rem; font-size: 1rem; border-radius: 8px;">Feedback Dashboard</button>
            </div>
            
            <div class="student-grid">
              ${Object.keys(state.students).length === 0
        ? '<div class="empty-state">No students found.</div>'
        : Object.entries(state.students).map(([id, s]) => renderStudentCard(id, s)).join('')
      }
            </div>
          </div>
        </div>
        ${_narayanaHtml('dashboard')}
      </div>
    `;
  }

  function renderStudentCard(userId, student) {
    const sessionHistory = GKStore.getSessionHistory(userId);
    const tracking = _getQuotientProgress(student);
    const totalDone = tracking.IQ.done + tracking.SQ.done;
    const totalPossible = tracking.IQ.total + tracking.SQ.total;
    const progress = Math.round((totalDone / totalPossible) * 100) || 0;
    const isPromoted = student.level > 1;
    const photo = student.photo || `https://api.dicebear.com/7.x/avataaars/svg?seed=${userId}`;

    return `
      <div class="student-card sc-premium ${isPromoted ? 'sc-is-promoted' : ''}" onclick="GKMentorApp.selectStudent('${userId}')">
        <div class="sc-header-row">
          <div class="sc-identity">
            <div class="sc-avatar-aura">
              <img src="${photo}" alt="${student.displayName}" class="sc-avatar-img" onerror="this.src='https://api.dicebear.com/7.x/avataaars/svg?seed=${userId}';">
            </div>
            <div class="sc-name-stack">
              <span class="sc-student-name">${student.displayName}</span>
              <span class="sc-student-grade">Grade ${student.grade || '6'}</span>
            </div>
          </div>
          <div class="sc-status-indicator">
            ${isPromoted ? '<div class="sc-crown" title="Promoted">👑</div>' : '<div class="sc-dot-active" title="Active"></div>'}
          </div>
        </div>
        
        <div class="sc-stats-bento">
          <div class="sc-stat">
            <span class="sc-stat-label">Level</span>
            <span class="sc-stat-val val-glow">${student.level || 1}</span>
          </div>
          <div class="sc-stat">
            <span class="sc-stat-label">XP</span>
            <span class="sc-stat-val val-glow">${student.totalXP || 0}</span>
          </div>
          <div class="sc-stat">
            <span class="sc-stat-label">Topics</span>
            <span class="sc-stat-val val-glow">${(student.completedTopics || []).length}</span>
          </div>
        </div>

        <div class="sc-progress-box">
          <div class="sc-prog-header">
            <span class="sc-prog-label">Mastery</span>
            <span class="sc-prog-perc">${progress}%</span>
          </div>
          <div class="sc-prog-track">
            <div class="sc-prog-fill" style="width: ${progress}%"></div>
          </div>
        </div>

        <div class="sc-footer-row">
          <div class="sc-session-tag">
            <span class="sc-tag-icon">⚡</span> ${sessionHistory.length} Sessions
          </div>
          <button class="btn btn-sm btn-outline" style="font-size: 0.65rem; padding: 4px 8px;" 
                  onclick="event.stopPropagation(); GKMentorApp.viewHolisticDetail('${userId}')">
            📊 Holistic Report
          </button>
          <div class="sc-action-link">Open Profile →</div>
        </div>
      </div>`;
  }

  // ---- SCREEN 3: Student Detail ----

  // Krishna shows student-specific summary when mentor opens a student's dashboard
  function getKrishnaStudentSummary(student) {
    const name = student.displayName || student.name || 'Student';
    const profile = JSON.parse(localStorage.getItem('gk_profile_' + student.id) || '{}');
    const completedTopics = profile.completedTopics || [];
    const totalXP = profile.totalXP || 0;
    const sessions = JSON.parse(localStorage.getItem('gk_session_history_' + student.id) || '[]');

    let summary = `Namaste Guru! Here is ${name}'s journey so far:nn`;

    if (completedTopics.length > 0) {
      summary += `u2705 Completed ${completedTopics.length} module(s): ${completedTopics.slice(0, 3).join(', ')}${completedTopics.length > 3 ? '...' : ''}n`;
    } else {
      summary += `ud83dudcda ${name} hasn't completed any modules yet.n`;
    }

    summary += `u2728 Total XP: ${totalXP}n`;
    summary += `ud83dudcc5 Sessions attended: ${sessions.length}n`;

    // Check for areas needing attention
    const attempts = JSON.parse(localStorage.getItem('gk_assessment_attempts_' + student.id) || '{}');
    const weakAreas = [];
    Object.entries(attempts).forEach(([key, arr]) => {
      if (arr && arr.length > 0) {
        const latest = arr[arr.length - 1];
        if (latest.percentage < 60) weakAreas.push(key);
      }
    });

    if (weakAreas.length > 0) {
      summary += `u26a0ufe0f Needs attention in: ${weakAreas.join(', ')}n`;
    } else if (completedTopics.length > 0) {
      summary += `ud83cudf1f ${name} is doing excellent! All assessments passed.n`;
    }

    return summary;
  }

    function renderStudentDetail() {
    const id = state.selectedStudentId;
    const student = state.students[id];
    if (!student) return `<div class="screen"><p>Student not found.</p></div>`;

    const assessmentAttempts = GKStore.getAssessmentAttempts(id);
    const assessmentList = Object.values(assessmentAttempts).flat();
    const sessionHistory = GKStore.getSessionHistory(id);
    const quotientTracking = _getQuotientProgress(student);

    const totalDone = quotientTracking.IQ.done + quotientTracking.SQ.done;
    const totalPossible = quotientTracking.IQ.total + quotientTracking.SQ.total;
    const progressPerc = Math.round((totalDone / totalPossible) * 100) || 0;
    const uniqueDays = new Set(sessionHistory.map(s => s.startTime ? s.startTime.split('T')[0] : null).filter(Boolean)).size;
    const moodEmoji = student.moodEmoji || '🙂';

    return `
      <div class="screen screen-mentor">
        ${renderMentorHeader()}
        <div class="screen-full-col">
          <div class="mentor-content">
            <div class="detail-nav-row">
              <button class="btn btn-ghost btn-sm" onclick="GKMentorApp.navigate('dashboard')">← Dashboard</button>
              <div class="detail-nav-actions">
                <button class="btn btn-outline btn-sm" style="margin-right:0.5rem;" onclick="GKMentorApp.viewHolisticDetail('${id}')">📊 HOLISTIC REPORT</button>
                <button class="p-header-btn btn-live-view" onclick="GKMentorApp.navigate('liveView')">👁️ VIEW LIVE SCREEN</button>
                <div class="detail-header-id">ID: ${id.toUpperCase()}</div>
              </div>
            </div>

            <!-- RESTORED: System Analysis & Insights -->
            <div class="summary-unified-hero" style="margin-bottom: 2.5rem;">
              <div class="uh-analysis">
                <div class="uh-label">System Analysis & Insights</div>
                <div class="uh-text">
                  ${student.displayName} has completed <strong>${totalDone} out of ${totalPossible}</strong> modules. 
                  With a progress of <strong>${progressPerc}%</strong>, they are following a consistent learning curve. 
                  Recent assessments show a PASS rate of <strong>${Math.round((assessmentList.filter(a => a.percentage >= 60).length / assessmentList.length) * 100) || 0}%</strong>.
                </div>
              </div>
              <div class="uh-divider"></div>
              <div class="uh-stats-grid">
                <div class="uh-stat">
                  <span class="uh-stat-icon">📚</span>
                  <div class="uh-stat-info">
                    <span class="uh-stat-val">${totalDone}/${totalPossible}</span>
                    <span class="uh-stat-lbl">Modules</span>
                  </div>
                </div>
                <div class="uh-stat">
                  <span class="uh-stat-icon">🏫</span>
                  <div class="uh-stat-info">
                    <span class="uh-stat-val">${progressPerc}%</span>
                    <span class="uh-stat-lbl">Attendance</span>
                  </div>
                </div>
                <div class="uh-stat">
                  <span class="uh-stat-icon">📅</span>
                  <div class="uh-stat-info">
                    <span class="uh-stat-val">${uniqueDays}</span>
                    <span class="uh-stat-lbl">Study Days</span>
                  </div>
                </div>
                <div class="uh-stat">
                  <span class="uh-stat-icon">🧘</span>
                  <div class="uh-stat-info">
                    <span class="uh-stat-val">${moodEmoji}</span>
                    <span class="uh-stat-lbl">Mood</span>
                  </div>
                </div>
              </div>
            </div>

            <div class="nebula-bento-grid">
              
              <!-- Row 1: Achievement & Curriculum -->
              <div class="nebula-bento-item bento-half ${state.expandedSections['achievement-log'] ? '' : 'collapsed'}">
                <div class="p-section-header collapse-trigger" onclick="GKMentorApp.toggleSection('achievement-log')">
                  <div class="p-header-info">
                    <h3>Achievement Progress</h3>
                    <p>Recent Performance Metrics</p>
                  </div>
                  <div class="toggle-icon">${state.expandedSections['achievement-log'] ? '▼' : '▶'}</div>
                </div>
                <div id="achievement-log" class="collapsible-inner nebula-orbs-container" style="display: flex; flex-wrap: wrap; gap: 1.5rem; margin-top: 1rem;">
                  ${_renderAssessments(id, assessmentAttempts)}
                </div>
              </div>

              <div class="nebula-bento-item bento-half ${state.expandedSections['curriculum-path'] ? '' : 'collapsed'}">
                <div class="p-section-header collapse-trigger" onclick="GKMentorApp.toggleSection('curriculum-path')">
                  <div class="p-header-info">
                    <h3>Curriculum Journey</h3>
                    <p>Milestones & Continuity</p>
                  </div>
                  <div class="toggle-icon">${state.expandedSections['curriculum-path'] ? '▼' : '▶'}</div>
                </div>
                <div id="curriculum-path" class="collapsible-inner curriculum-nebula-list" style="margin-top: 1rem; max-height: 350px; overflow-y: auto;">
                  ${_renderTopicsProgress(student)}
                </div>
              </div>

              <!-- Row 2: Promote & Evaluation -->
              <div class="nebula-bento-item bento-half ${state.expandedSections['promotion-gateway'] ? '' : 'collapsed'}">
                <div class="p-section-header collapse-trigger" onclick="GKMentorApp.toggleSection('promotion-gateway')">
                  <div class="p-header-info">
                    <h3>🚀 Promote to Next Path</h3>
                    <div style="display:flex; justify-content: space-between; align-items:center; width: 100%;">
                      <p>Unlocking the Next Frontier</p>
                      <button class="btn btn-outline btn-xs" style="font-size: 0.65rem; padding: 2px 8px; margin-left: 10px;" onclick="event.stopPropagation(); GKMentorApp.unlockAllNextPath('${id}')">✨ Unlock All Available</button>
                    </div>
                  </div>
                  <div class="toggle-icon">${state.expandedSections['promotion-gateway'] ? '▼' : '▶'}</div>
                </div>
                <div id="promotion-gateway" class="collapsible-inner nebula-path-container" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 1.5rem; margin-top: 1.5rem;">
                   ${_renderNextPathSection(id, student)}
                </div>
              </div>

              <div class="nebula-bento-item bento-half ${state.expandedSections['evaluation-console'] ? '' : 'collapsed'}">
                <div class="p-section-header collapse-trigger" onclick="GKMentorApp.toggleSection('evaluation-console')">
                  <div class="p-header-info">
                    <h3>🎯 Evaluation Console</h3>
                    <div style="display:flex; justify-content: space-between; align-items:center; width: 100%;">
                      <p>Final Appraisal & Verification</p>
                      <button class="btn btn-outline btn-xs" style="font-size: 0.65rem; padding: 2px 8px; margin-left: 10px;" onclick="event.stopPropagation(); GKMentorApp.selectAllEvalTopics()">✅ Select All</button>
                    </div>
                  </div>
                  <div class="toggle-icon">${state.expandedSections['evaluation-console'] ? '▼' : '▶'}</div>
                </div>
                <div id="evaluation-console" class="collapsible-inner eval-topics-list" style="margin-top: 1rem;">
                   ${(() => {
                     // Merge assessment attempts AND override completions into one unified list
                     const overrides = student.overrides || {};
                     const allTopicKeys = new Set([
                       ...Object.keys(assessmentAttempts),
                       ...Object.keys(overrides)
                     ]);

                     if (allTopicKeys.size === 0) return `
                       <div style="text-align:center; padding: 3rem; opacity: 0.5;">
                         <p style="font-size: 2.5rem;">🧘</p>
                         <p style="font-weight: 700;">Awaiting Assessments</p>
                         <p style="font-size: 0.8rem; color: #888;">Subjects will appear here once the student completes an assessment or the Override button is pressed.</p>
                       </div>`;

                     return `
                       <div class="eval-grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem;">
                          ${[...allTopicKeys].map(tk => {
                            const attempts = assessmentAttempts[tk] || [];
                            const latest = attempts.length > 0 ? attempts[attempts.length - 1] : null;
                            const isOverride = !!overrides[tk];
                            const isDone = student.completedTopics && student.completedTopics.includes(tk);
                            const scoreText = latest ? `Latest: ${latest.percentage}%` : (isOverride ? '✔ Override complete' : 'Pending');
                            const scoreColor = latest ? (latest.percentage >= 60 ? '#27ae60' : '#e74c3c') : (isOverride ? '#7B3FA0' : '#888');
                            return `
                              <label class="eval-topic-item" style="background: #fff; border: 1px solid ${isDone ? '#c8e6c9' : 'rgba(0,0,0,0.05)'}; padding: 1.25rem; border-radius: 20px; display: flex; align-items: center; gap: 1rem; cursor: pointer;">
                                <input type="checkbox" class="eval-topic-cb" value="${tk}" ${(state.evalCheckedState[tk] !== undefined ? state.evalCheckedState[tk] : isDone) ? 'checked' : ''} onchange="GKMentorApp.onEvalCheckChange('${tk}', this.checked)" style="width: 20px; height: 20px; accent-color: var(--m-accent);">
                                <div style="flex: 1;">
                                  <div style="font-weight: 800; font-size: 0.95rem;">${_formatTopicId(tk)}</div>
                                  <div style="font-size: 0.75rem; font-weight: 700; color: ${scoreColor};">${scoreText}</div>
                                </div>
                                ${isDone ? '<span>✅</span>' : ''}
                              </label>`;
                          }).join('')}
                       </div>
                       <div class="eval-footer" style="margin-top: 2rem; display: flex; gap: 1rem;">
                          <button class="btn-premium-v2" style="flex: 2; padding: 1rem;" onclick="GKMentorApp.submitEvaluation('${id}', 'accept')">Approve & Promote Student</button>
                          <button class="btn btn-outline" style="flex: 1; border-radius: 14px; font-weight: 800;" onclick="GKMentorApp.submitEvaluation('${id}', 'redo')">Reset Modules</button>
                       </div>`;
                   })()}
                </div>
              </div>

              <!-- Row 3: Wisdom Hub (Full Width) -->
              <div class="nebula-bento-item bento-full mas-wisdom-card ${state.expandedSections['wisdom-hub-content'] ? '' : 'collapsed'}">
                <div class="mas-panel-header collapse-trigger" onclick="GKMentorApp.toggleSection('wisdom-hub-content')">
                  <div class="mas-header-info">
                    <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                      <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <span class="mas-icon">✨</span>
                        <span class="mas-title">Wisdom Hub</span>
                      </div>
                      <div class="toggle-icon">${state.expandedSections['wisdom-hub-content'] ? '▼' : '▶'}</div>
                    </div>
                  </div>
                  <p class="mas-subtitle">Channel Guidance & Honors</p>
                </div>
                
                <div id="wisdom-hub-content" class="collapsible-inner">
                  <div class="mas-panel-body">
                    <!-- Group 1: Student Guidance -->
                    <div class="mas-control-group">
                      <div class="mas-group-header">
                        <span class="mas-group-label">Guidance to Shishya</span>
                      </div>
                      <div class="mas-input-stack">
                        <textarea id="suggestion-message" class="mas-textarea" placeholder="Channel your insights..." 
                                  oninput="GKMentorApp.persistInput(this.id, this.value)">${state.pendingInputs['suggestion-message'] || ''}</textarea>
                        <div class="mas-control-row">
                          <select id="suggestion-topic" class="mas-select">
                            <option value="">General Guidance</option>
                            ${student.topicsEnrolled ? Object.keys(student.topicsEnrolled).map(tk => `<option value="${tk}">${tk}</option>`).join('') : ''}
                          </select>
                          <button class="mas-btn-primary" onclick="GKMentorApp.sendSuggestion('${id}')">Send</button>
                        </div>
                      </div>
                    </div>

                    <!-- Group 2: Guru Private Notes -->
                    <div class="mas-control-group">
                       <div class="mas-group-header">
                        <span class="mas-group-label">Guru Observations (Not visible to student)</span>
                      </div>
                      <div class="mas-input-stack">
                        <textarea id="admin-feedback-msg" class="mas-textarea mas-textarea-small" placeholder="Internal notes..." 
                                  oninput="GKMentorApp.persistInput(this.id, this.value)">${state.pendingInputs['admin-feedback-msg'] || ''}</textarea>
                        <button class="mas-btn-secondary" onclick="GKMentorApp.sendAdminFeedback('${id}')">Save Private Note</button>
                      </div>
                    </div>

                    <!-- Group 3: Merit Awards -->
                    <div class="mas-control-group">
                      <div class="mas-group-header">
                        <span class="mas-group-label">Spiritual Merits (XP)</span>
                      </div>
                      <div class="mas-control-row">
                        <select id="reward-amount" class="mas-select">
                          <option value="50">👍 50 XP</option>
                          <option value="100">✨ 100 XP</option>
                          <option value="200">💎 200 XP</option>
                        </select>
                        <button class="mas-btn-gold" onclick="GKMentorApp.rewardStudent('${id}')">Award</button>
                      </div>
                    </div>

                    <!-- Group 4: Score Management -->
                    <div class="mas-control-group" style="border-top: 1px solid #f0e8ff; padding-top: 1.25rem; margin-top: 0.5rem;">
                      <div class="mas-group-header">
                        <span class="mas-group-label" style="color:#b91c1c;">⚠️ Score Management</span>
                      </div>
                      <div style="font-size:0.78rem; color:#6b7280; margin-bottom:0.75rem;">
                        Clears all XP (Prana), Levels, subtopic scores, assessment attempts, and completion markers for this student. This cannot be undone.
                      </div>
                      <button class="mas-btn-danger" onclick="GKMentorApp.clearAllScores('${id}')">
                        🗑️ Clear All Scores
                      </button>
                      <div id="clear-scores-confirm" class="mas-confirm-toast hidden" style="background:#fef2f2; color:#b91c1c; border:1px solid #fca5a5;">
                        ✅ All scores cleared for ${student.displayName}
                      </div>
                    </div>

                    <div id="note-confirm" class="mas-confirm-toast hidden">✅ Guidance Transmitted</div>
                    <div id="admin-feedback-confirm" class="mas-confirm-toast hidden">✅ Private Note Saved</div>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>
        ${_narayanaHtml('studentDetail')}
      </div>`;
  }

  function renderHolisticDetail() {
    const id = state.selectedStudentId;
    const student = state.students[id];
    if (!student) return `<div class="screen"><p>Student not found.</p></div>`;

    return `
      <div class="screen screen-mentor">
        ${renderMentorHeader()}
        <div class="screen-full-col">
          <div class="mentor-content">
            <div class="detail-nav-row" style="margin-bottom: 2rem;">
              <div style="display: flex; align-items: center; gap: 1rem;">
                <button class="btn btn-ghost btn-sm" onclick="GKMentorApp.navigate('studentDetail')">← Back to Profile</button>
              </div>
              <div class="detail-nav-actions">
                <div class="detail-header-id">ID: ${id.toUpperCase()}</div>
              </div>
            </div>

            <div class="mentor-page-header" style="margin-bottom: 3rem; text-align:center;">
              <h2 style="font-size: 2.5rem;">📊 Holistic Development Report</h2>
              <p>In-depth analysis of ${student.displayName}'s multi-quotient achievement.</p>
            </div>

            <div class="nebula-bento-grid" style="grid-template-columns: 1.5fr 1fr;">
              <!-- Left side: Matrix -->
              <div class="nebula-bento-item" style="padding: 2.5rem;">
                 ${HolisticQUIC.renderEvaluationPanel(id)}
                 
                  <!-- Removed large recalculate button row per user request -->
              </div>

              <!-- Right side: Visualization & Progression -->
              <div class="nebula-bento-item" style="padding: 2.5rem; background: #fafafa;">
                 ${HolisticQUIC.renderHQVisualization(id)}
              </div>
            </div>
          </div>
        </div>
        ${_narayanaHtml('studentDetail')}
      </div>`;
  }


  function renderMentorHeader() {
    const mentor = state.mentor || { displayName: 'Bela', photo: 'img/mentor-photo.png', avatar: '🕉' };
    return `
      <header class="app-header">
          <div class="header-left">
            <img src="${GKBranding.logoPath()}" alt="${GKBranding.schoolName()}" class="header-logo-img" />
            <div class="header-title-wrap">
              <div class="header-main-title">${GKBranding.schoolName()}</div>
              <div class="header-sub-title">${GKBranding.get('mentorHeaderSubtitle')}</div>
            </div>
          </div>
        <div class="header-center">
        </div>

        <div class="header-right">
          <button onclick="GKMentorApp.toggleMute(this)" class="gk-voice-toggle" style="margin-right: 1rem;" title="Toggle Voice Audio">
            ${GKVoice.isEnabled() ? '🔊' : '🔇'}
          </button>
          <div class="mentor-profile-brief">
            <div class="mentor-brief-text">
              <div class="mentor-brief-name">${mentor.displayName}</div>
              <div class="mentor-brief-role">Lead Guru</div>
            </div>
            <div class="header-avatar-wrap">
              <img src="${mentor.photo || 'img/mentor-photo.png'}" class="header-avatar-img" 
                   onerror="this.src='https://api.dicebear.com/7.x/avataaars/svg?seed=${mentor.id || 'mentor'}'; this.style.opacity='0.5';" />
            </div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="GKMentorApp.logout()">Sign Out</button>
        </div>
      </header>`;
  }

  function attachEvents(screen) {
    if (screen === 'login') {
      const form = document.getElementById('mentor-login-form');
      if (form) form.addEventListener('submit', handleLogin);
    }
  }

  // ---- Event Handlers ----
  function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    if (username === GK_MENTOR.username && password === GK_MENTOR.password) {
      state.mentor = GK_MENTOR;
      state.students = GKStore.getAllStudentProfiles();
      navigate('mentorMood');
    } else {
      const errEl = document.getElementById('login-error');
      errEl.textContent = 'Invalid mentor credentials. Try: mentor / mentor123';
      errEl.classList.remove('hidden');
    }
  }

  function viewStudent(userId) {
    state.selectedStudentId = userId;
    state.suggestionTopicKey = null;
    state.evalCheckedState = {};  // reset eval checkboxes for new student
    navigate('studentDetail');
  }

  function viewHolisticDetail(userId) {
    state.selectedStudentId = userId;
    navigate('holisticDetail');
  }

  function backToDashboard() {
    state.students = GKStore.getAllStudentProfiles();
    navigate('dashboard');
  }

  function rewardStudent(userId) {
    const amountEl = document.getElementById('reward-amount');
    const amount = parseInt(amountEl.value, 10);
    const reasons = { 50: 'Good effort', 100: 'Well done!', 200: 'Outstanding!', 300: 'Exceptional!' };
    const reason = reasons[amount] || 'Mentor reward';

    GKStore.awardBonusXP(userId, amount, reason);

    const btn = document.getElementById('reward-btn');
    const confirm = document.getElementById('reward-confirm');
    if (btn) { btn.textContent = '✅ Awarded!'; btn.disabled = true; }
    if (confirm) confirm.classList.remove('hidden');

    state.students = GKStore.getAllStudentProfiles();
    setTimeout(() => renderInPlace(), 1500);
  }

  function addToPath(userId, topicKey) {
    GKStore.unlockTopicForStudent(userId, topicKey);
    state.students = GKStore.getAllStudentProfiles();
    renderInPlace();
  }

  function removeFromPath(userId, topicKey) {
    GKStore.lockTopicForStudent(userId, topicKey);
    state.students = GKStore.getAllStudentProfiles();
    renderInPlace();
  }

  function openSuggestionForm(userId, topicKey) {
    state.suggestionTopicKey = topicKey;
    // Scroll to suggestion panel
    navigate('studentDetail');
    setTimeout(() => {
      const panel = document.getElementById('suggestion-panel');
      if (panel) panel.scrollIntoView({ behavior: 'smooth' });
      const select = document.getElementById('suggestion-topic');
      if (select) select.value = topicKey;
    }, 100);
  }

  function sendSuggestion(userId) {
    const topicKey = (document.getElementById('suggestion-topic') || {}).value || '';
    const message = (document.getElementById('suggestion-message') || {}).value || '';
    const focusRaw = (document.getElementById('suggestion-focus') || {}).value || '';
    const focusTopics = focusRaw.split(',').map(s => s.trim()).filter(Boolean);

    if (!message.trim()) {
      const el = document.getElementById('suggestion-message');
      if (el) { el.style.border = '2px solid #C0392B'; el.focus(); }
      return;
    }

    GKStore.addMentorNote(userId, {
      message: message.trim(),
      topicKey: topicKey || null,
      focusTopics
    });

    const confirm = document.getElementById('note-confirm');
    if (confirm) confirm.classList.remove('hidden');

    // Clear inputs
    const msgEl = document.getElementById('suggestion-message');
    const focusEl = document.getElementById('suggestion-focus');
    if (msgEl) msgEl.value = '';
    if (focusEl) focusEl.value = '';
    delete state.pendingInputs['suggestion-message'];
    delete state.pendingInputs['suggestion-focus'];

    setTimeout(() => {
      renderInPlace();
    }, 1500);
  }

  function sendAdminFeedback(userId) {
    const message = (document.getElementById('admin-feedback-msg') || {}).value || '';
    if (!message.trim()) {
      const el = document.getElementById('admin-feedback-msg');
      if (el) { el.style.border = '2px solid #C0392B'; el.focus(); }
      return;
    }

    // Save admin feedback to profile (not visible to student)
    const profile = GKStore.getUserProfile(userId) || {};
    if (!profile.adminNotes) profile.adminNotes = [];
    profile.adminNotes.push({
      message: message.trim(),
      createdAt: new Date().toISOString(),
      mentor: state.mentor.displayName
    });
    GKStore.saveUserProfile(userId, profile);

    const confirm = document.getElementById('admin-feedback-confirm');
    if (confirm) confirm.classList.remove('hidden');
    const msgEl = document.getElementById('admin-feedback-msg');
    if (msgEl) msgEl.value = '';
    delete state.pendingInputs['admin-feedback-msg'];

    setTimeout(() => { renderInPlace(); }, 1500);
  }

  function clearAllScores(userId) {
    const student = state.students[userId];
    const name = student ? (student.displayName || userId) : userId;
    const confirmed = window.confirm(
      `Clear ALL data for ${name}?nnThis will erase:n• Total XP (Prana) & Leveln• All subtopic scoresn• All assessment attemptsn• All completion markersnnThis cannot be undone.`
    );
    if (!confirmed) return;

    GKStore.resetAllScores(userId);

    // Refresh local mentor state so the UI reflects the reset immediately
    const freshProfile = GKStore.getUserProfile(userId);
    if (freshProfile) state.students[userId] = { ...state.students[userId], ...freshProfile };

    const confirmEl = document.getElementById('clear-scores-confirm');
    if (confirmEl) confirmEl.classList.remove('hidden');
    setTimeout(() => { renderInPlace(); }, 1500);
  }

  function sendParentFeedback(userId) {
    const message = (document.getElementById('parent-feedback-msg') || {}).value || '';
    if (!message.trim()) {
      const el = document.getElementById('parent-feedback-msg');
      if (el) { el.style.border = '2px solid #C0392B'; el.focus(); }
      return;
    }
    const profile = GKStore.getUserProfile(userId) || {};
    if (!profile.parentNotes) profile.parentNotes = [];
    profile.parentNotes.push({
      message: message.trim(),
      createdAt: new Date().toISOString(),
      mentor: state.mentor.displayName
    });
    GKStore.saveUserProfile(userId, profile);
    const confirm = document.getElementById('parent-feedback-confirm');
    if (confirm) confirm.classList.remove('hidden');
    const msgEl = document.getElementById('parent-feedback-msg');
    if (msgEl) msgEl.value = '';
    setTimeout(() => { renderInPlace(); }, 1500);
  }

  function renderNarayanaSays(msg) {
    return `
      <div id="narayana-left-pane" class="narayana-left-pane">
        <div class="narayana-unified-control">
          <div class="nlp-avatar-section">
            <img src="img/narayana-guide.png" alt="Narayana" class="nlp-avatar">
            <div class="nlp-status-dot"></div>
          </div>
          
          <div class="nlp-message-box bubble-style">
            <div class="nlp-bubble-title">Narayana</div>
            <div class="nlp-bubble-text">${msg || "Here are the student details."}</div>
          </div>

          <div class="nlp-chat-controls">
            <input type="text" id="narayana-query-input" placeholder="Ask Acharya..." onkeydown="if(event.key==='Enter') GKMentorApp.sendNarayanaQuery()">
            <button class="nlp-send-btn" onclick="GKMentorApp.sendNarayanaQuery()">
              <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M2.01 21L23 12L2.01 3L2 10l15 2l-15 2z"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function _narayanaHtml(context, options = {}) {
    const msg = options._customMsg || state.narayanaMsg;
    return renderNarayanaSays(msg);
  }

  function _refreshNarayanaWidget() {
    const existing = document.getElementById('narayana-left-pane');
    if (!existing) return;
    const scrollY = window.scrollY;

    // Use a temporary div to generate the HTML
    const tmp = document.createElement('div');
    tmp.innerHTML = renderNarayanaSays(state.narayanaMsg);
    const narEl = tmp.querySelector('#narayana-left-pane');
    if (narEl) existing.replaceWith(narEl);
    window.scrollTo(0, scrollY);
  }

  function toggleNarayanaExpand() {
    state.narayanaExpanded = !state.narayanaExpanded;
    _refreshNarayanaWidget();
  }

  function toggleNarayanaPanel(panel) {
    state.narayanaPanel = state.narayanaPanel === panel ? null : panel;
    _refreshNarayanaWidget();
  }


  function updateMentorBattery(value) {
    state.mentorBrainBattery = parseInt(value, 10);
    const b = state.mentorBrainBattery;

    // Update labels
    const pctEl = document.getElementById('mentor-battery-pct');
    const descEl = document.getElementById('mentor-battery-desc');
    const labelEl = document.getElementById('mentor-battery-label-text');

    if (pctEl) pctEl.textContent = b + '%';
    if (descEl) {
      descEl.textContent = b >= 70 ? 'Radiant & Ready' : b >= 40 ? 'Stable & Focused' : 'Needs Contemplation';
    }
  }

  function selectMentorMood(vibe) {
    state.mentorMoodSelected = vibe;
    renderInPlace();
  }

  function submitMentorMood() {
    if (!state.mentorMoodSelected) return;
    GKStore.saveMentorMoodLog(state.mentor.id, {
      vibe: state.mentorMoodSelected,
      brainBattery: state.mentorBrainBattery,
      mentor: state.mentor.displayName
    });
    navigate('dashboard');
  }

  function _getNarayanaContext() {
    const studentId = state.selectedStudentId;
    const student = studentId ? (state.students[studentId] || {}) : {};
    const sessionHistory = studentId ? GKStore.getSessionHistory(studentId) : [];
    const moods = sessionHistory.filter(s => s.type === 'login_mood').map(s => s.mood);
    const lastFeedback = sessionHistory.filter(s => s.type === 'mentor_feedback').slice(-1)[0]?.message || 'None';

    let hqScores = { aq: 'N/A', sq: 'N/A', pq: 'N/A', eq: 'N/A' };
    if (studentId && typeof HolisticEvaluationEngine !== 'undefined') {
      const merged = HolisticEvaluationEngine.getMergedScores(studentId);
      const m = merged.metrics || {};
      hqScores.aq = m.human_aq !== null ? Math.round((m.ai_aq + m.human_aq) / 2) : (m.ai_aq || 'N/A');
      hqScores.sq = m.human_sq !== null ? Math.round((m.ai_sq + m.human_sq) / 2) : (m.ai_sq || 'N/A');
      hqScores.pq = m.human_pq !== null ? Math.round((m.ai_pq + m.human_pq) / 2) : (m.ai_pq || 'N/A');
      hqScores.eq = m.human_eq !== null ? Math.round((m.ai_eq + m.human_eq) / 2) : (m.ai_eq || 'N/A');
    }

  return {
      mentorName: state.mentor ? (state.mentor.displayName || 'Guru') : 'Guru',
      studentName: student.displayName || 'Shishya',
      topicId: state.selectedTopicId || 'Overall',
      aq: hqScores.aq,
      sq: hqScores.sq,
      pq: hqScores.pq,
      eq: hqScores.eq,
      level: student.level || 1,
      xp: student.totalXP || 0,
      moods: moods.slice(-5),
      lastFeedback: lastFeedback,
      persona: student.persona || 'General learner',
      history: state.narayanaMessages || []
    };
  }

  async function sendNarayanaQuery() {
    const inputEl = document.getElementById('narayana-query-input');
    if (!inputEl) return;
    const query = inputEl.value.trim();
    if (!query) return;

    const msgEl = document.querySelector('.nlp-bubble-text');
    if (!msgEl) return;
    const queryBtn = document.querySelector('.nlp-send-btn');

    if (!state.narayanaMessages) state.narayanaMessages = [];
    state.narayanaMessages.push({ role: 'user', text: query });

    // 1. Ensure config initialized
    await GK_AI_CONFIG.ensureLoaded();

    const loadingMsg = `<span class="sparkle-rotate">✨</span> <span class="thinking-dots">Narayana is contemplating</span>`;
    msgEl.innerHTML = loadingMsg;
    state.narayanaMsg = loadingMsg;
    inputEl.value = '';
    if (queryBtn) { queryBtn.disabled = true; queryBtn.style.opacity = '0.5'; }

    try {
      const context = _getNarayanaContext();
      const response = await GKAITutor.respond(query, context, 'mentor');
      
      const formattedResponse = typeof marked !== 'undefined' ? marked.parse(response) : response;
      
      state.narayanaMessages.push({ role: 'ai', text: response });
      msgEl.innerHTML = formattedResponse;
      state.narayanaMsg = formattedResponse;
      if (queryBtn) { queryBtn.disabled = false; queryBtn.style.opacity = '1'; }
    } catch (e) {
      console.error("Narayana AI Error:", e);
      const errorMsg = `
        <div>The ethereal connection is faint. Let us try again soon, Guru. 🙏</div>
        <div class="chat-error-notice">
          <span>⚠️</span> <span>Insight: ${e.message}</span>
        </div>`;
      msgEl.innerHTML = errorMsg;
      state.narayanaMsg = errorMsg;
      if (queryBtn) { queryBtn.disabled = false; queryBtn.style.opacity = '1'; }
    }
  }

  // --- Holistic Quotient ---
  function onQuotientInput(userId) {
    const aqEl = document.getElementById('hq-aq-input');
    const sqEl = document.getElementById('hq-sq-input');
    if (!aqEl || !sqEl) return;
    const aq = parseInt(aqEl.value, 10);
    const sq = parseInt(sqEl.value, 10);
    if (isNaN(aq) || isNaN(sq) || aq < 0 || aq > 100 || sq < 0 || sq > 100) return;
    const student = state.students[userId];
    const sessionHistory = GKStore.getSessionHistory(userId);
    const { pq, eq } = _computeSystemQuotients(student, sessionHistory);
    const avg = Math.round((aq + sq + pq + eq) / 4);
    const bloom = _bloomsLevel(avg);
    const panel = document.getElementById('hq-result-panel');
    if (panel) {
      panel.innerHTML = _renderHQResult({ aq, sq, pq, eq, avg, hq: bloom.label }, bloom);
      panel.classList.remove('hidden');
    }
  }

  function saveHolisticScores(userId, holisticData) {
    GKStore.saveHolisticScores(userId, holisticData);
    _showToast("✅ Holistic Quotient Saved!");
    setTimeout(() => navigate('dashboard'), 1500);
  }

  function saveHolisticQuotient(userId) {
    const aqEl = document.getElementById('hq-aq-input');
    const sqEl = document.getElementById('hq-sq-input');
    if (!aqEl || !sqEl) return;
    const aq = parseInt(aqEl.value, 10);
    const sq = parseInt(sqEl.value, 10);
    if (isNaN(aq) || aq < 0 || aq > 100) { if (aqEl) { aqEl.style.border = '2px solid #C0392B'; aqEl.focus(); } return; }
    if (isNaN(sq) || sq < 0 || sq > 100) { if (sqEl) { sqEl.style.border = '2px solid #C0392B'; sqEl.focus(); } return; }
    const student = state.students[userId];
    const sessionHistory = GKStore.getSessionHistory(userId);
    const { pq, eq } = _computeSystemQuotients(student, sessionHistory);
    const avg = Math.round((aq + sq + pq + eq) / 4);
    const bloom = _bloomsLevel(avg);
    const holisticData = {
      aq, sq, pq, eq, avg,
      hq: bloom.label,
      bloomLevel: bloom.level,
      computedAt: new Date().toISOString(),
      computedBy: state.mentor ? state.mentor.displayName : 'Mentor'
    };
    saveHolisticScores(userId, holisticData);
    const panel = document.getElementById('hq-result-panel');
    if (panel) {
      panel.innerHTML = _renderHQResult(holisticData, bloom);
      panel.classList.remove('hidden');
    }
    const confirm = document.getElementById('hq-confirm');
    if (confirm) { confirm.classList.remove('hidden'); setTimeout(() => confirm.classList.add('hidden'), 3000); }
  }

  function promoteStudent(userId) {
    const student = state.students[userId];
    const name = student ? (student.displayName || userId) : userId;

    // Build list of next-path topics that can be unlocked
    const nextPathTopics = [];
    GK_TOPICS.subjects.forEach(subj => {
      if (subj.id === 'aq-challenge') return;
      subj.topics.forEach(t => {
        if (t.moduleType === 'next-path') {
          const key = subj.id + '-' + t.id;
          const alreadyUnlocked = (student.unlockedTopics || []).includes(key);
          nextPathTopics.push({ subject: subj, topic: t, key, alreadyUnlocked });
        }
      });
    });

    let topicChoices = '';
    if (nextPathTopics.length > 0) {
      topicChoices = 'nnSelect topics to unlock (enter numbers, comma-separated):n';
      nextPathTopics.forEach((t, i) => {
        topicChoices += `${i + 1}. ${t.subject.icon} ${t.subject.name}: ${t.topic.name}${t.alreadyUnlocked ? ' (already unlocked)' : ''}n`;
      });
    }

    const input = prompt(`Promote ${name} to the next level?${topicChoices}nnENTRUSTMENT: Enter topic numbers (e.g. 1,2,3) to guide them toward these advanced modules. Leave empty to promote without new assignments:`);
    if (input === null) return false; // cancelled

    // Parse selected topic numbers
    if (input.trim()) {
      const nums = input.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
      nums.forEach(n => {
        const idx = n - 1;
        if (idx >= 0 && idx < nextPathTopics.length && !nextPathTopics[idx].alreadyUnlocked) {
          GKStore.unlockTopicForStudent(userId, nextPathTopics[idx].key);
        }
      });
    }

    GKStore.promoteStudent(userId);
    state.students = GKStore.getAllStudentProfiles();
    renderInPlace();
    return true;
  }

  function submitEvaluation(userId, decision) {
    const uncheckedBoxes = document.querySelectorAll('.eval-topic-cb:not(:checked)');

    if (decision === 'accept') {
      if (uncheckedBoxes.length > 0) {
        alert("Wait! You have unchecked some topics. If you want the student to re-take them, click 'Request Redo'. Otherwise, check all boxes to Approve everything.");
        return;
      }
      // Trigger unlock topic prompt before promoting
      const promoted = promoteStudent(userId);
      if (!promoted) return; // Prompt cancelled

      GKStore.submitMentorEvaluation(userId, { feedback: '', decision });
      GKStore.awardBonusXP(userId, 500, "Mentor Assessment Passed!");
      GKStore.addMentorNote(userId, {
        message: "🎉 Congratulations! You passed the Mentor Assessment!",
        topicKey: null,
        focusTopics: []
      });
    } else {
      if (uncheckedBoxes.length === 0) {
        alert("Please uncheck the topics you want the student to redo before clicking 'Request Redo'.");
        return;
      }

      const resetTopicKeys = [];
      const resetTopicNames = [];
      uncheckedBoxes.forEach(cb => {
        resetTopicKeys.push(cb.value);
        const label = cb.closest('label');
        if (label) resetTopicNames.push(label.textContent.split('Score:')[0].trim());
      });

      GKStore.resetTopics(userId, resetTopicKeys);
      GKStore.submitMentorEvaluation(userId, { feedback: '', decision });

      GKStore.addMentorNote(userId, {
        message: "📝 Please redo the following topics and their assessments:n" + resetTopicNames.join(', '),
        topicKey: null,
        focusTopics: resetTopicNames
      });
    }

    // Force real-time cross-tab sync by pinging localStorage with a dummy key (hack to reliably trigger 'storage' event in the other tab)
    localStorage.setItem('gk_mentor_edit_ping', Date.now().toString());

    state.students = GKStore.getAllStudentProfiles();
    renderInPlace();
  }

  function selectAllEvalTopics() {
    const boxes = document.querySelectorAll('.eval-topic-cb');
    boxes.forEach(b => { b.checked = true; state.evalCheckedState[b.value] = true; });
  }

  function onEvalCheckChange(topicKey, isChecked) {
    state.evalCheckedState[topicKey] = isChecked;
  }

  // Per-subject Accept: mark topic complete, show toast
  function acceptSubject(userId, topicKey) {
    GKStore.markTopicComplete(userId, topicKey);
    _showToast(`✅ "${_formatTopicId(topicKey)}" has been accepted and marked complete for ${state.students[userId].displayName}. 🙏`);
    localStorage.setItem('gk_mentor_edit_ping', Date.now().toString());
    state.students = GKStore.getAllStudentProfiles();
    renderInPlace();
  }

  // Per-subject Reject: reset the topic and add a mentor note
  function rejectSubject(userId, topicKey) {
    GKStore.resetTopics(userId, [topicKey]);
    GKStore.addMentorNote(userId, {
      message: `❌ Your Guru has reviewed "${_formatTopicId(topicKey)}" and asked you to redo it. Please revisit and complete the assessment again. 🙏`,
      topicKey
    });
    _showToast(`❌ "${_formatTopicId(topicKey)}" has been rejected. ${state.students[userId].displayName} will be asked to redo it.`);
    localStorage.setItem('gk_mentor_edit_ping', Date.now().toString());
    state.students = GKStore.getAllStudentProfiles();
    renderInPlace();
  }

  function unlockAllNextPath(userId) {
    const student = state.students[userId];
    if (!student) return;

    let count = 0;
    GK_TOPICS.subjects.forEach(subj => {
      if (subj.id === 'aq-challenge') return;
      subj.topics.forEach(t => {
        if (t.moduleType === 'next-path') {
          const key = subj.id + '-' + t.id;
          const alreadyUnlocked = (student.unlockedTopics || []).includes(key);
          if (!alreadyUnlocked) {
            GKStore.unlockTopicForStudent(userId, key);
            count++;
          }
        }
      });
    });

    if (count > 0) {
      _showToast(`Succesfully unlocked ${count} advanced modules! 🚀`);
      state.students = GKStore.getAllStudentProfiles();
      renderInPlace();
    } else {
      _showToast(`All available advanced modules are already unlocked. ✨`);
    }
  }

  function logout() {
    state.mentor = null;
    state.students = {};
    navigate('login');
  }

  // ---- Helpers ----

  function _getQuotientProgress(studentProfile) {
    const tracking = {
      IQ: { done: 0, total: 0, color: '#3A6FA6', name: 'Intelligence (IQ)' },
      SQ: { done: 0, total: 0, color: '#4A7C59', name: 'Para-Vidya (SQ)' }
    };

    const profileSubs = studentProfile.completedSubtopics || [];

    GKRecommender.getAllTopics().forEach(t => {
      const td = GKRecommender.getTopicData(t.subjectId, t.topicId);
      if (td && td.topic && td.topic.moduleType === 'standard' && td.subject.quotient) {
        const q = td.subject.quotient;
        if (tracking[q]) {
          tracking[q].total++;
          // Module is done if all its mandatory subtopics are completed OR if it has an assessment OR if it's overridden
          const mandatorySubs = td.topic.subtopics.filter(st => st.mandatory !== false);
          const subtopicsDone = mandatorySubs.length > 0 && mandatorySubs.every(st =>
            profileSubs.includes(td.topic.id + '-' + st.id)
          );
          const moduleKey = `${t.subjectId}-${t.topicId}`;
          const isAssessed = studentProfile.assessmentAttempts && studentProfile.assessmentAttempts[moduleKey];
          const isOverridden = studentProfile.overrides && studentProfile.overrides[moduleKey];
          
          if (subtopicsDone || isAssessed || isOverridden) tracking[q].done++;
        }
      }
    });
    return tracking;
  }

  // Returns level object for a 0-100 average score
  function _bloomsLevel(score) {
    if (score >= 85) return { level: 6, label: 'Create', category: 'Creative Innovator', icon: '🌟', desc: 'Student creates original solutions and demonstrates full mastery of the subject.', color: '#7B1FA2', bg: '#F3E5F5' };
    if (score >= 70) return { level: 5, label: 'Evaluate', category: 'Reflective Evaluator', icon: '⚖️', desc: 'Student can assess ideas, judge their quality and confidently justify decisions.', color: '#1565C0', bg: '#E3F2FD' };
    if (score >= 55) return { level: 4, label: 'Analyze', category: 'Critical Thinker', icon: '🔍', desc: 'Student can break topics into parts, draw meaningful connections and spot patterns.', color: '#00695C', bg: '#E0F2F1' };
    if (score >= 40) return { level: 3, label: 'Apply', category: 'Skill Practitioner', icon: '🔧', desc: 'Student applies learned knowledge to solve real-world problems and new situations.', color: '#E65100', bg: '#FFF3E0' };
    if (score >= 25) return { level: 2, label: 'Understand', category: 'Concept Learner', icon: '💡', desc: 'Student understands core concepts and can explain or interpret them in their own words.', color: '#F57F17', bg: '#FFFDE7' };
    return { level: 1, label: 'Remember', category: 'Foundation Builder', icon: '📝', desc: 'Student is building basic knowledge and can recall key facts and concepts from memory.', color: '#C62828', bg: '#FFEBEE' };
  }

  // Compute PQ (attendance-based) and EQ (mood/feedback-based) from system data
  function _computeSystemQuotients(student, sessionHistory) {
    // PQ: unique session days / 20 * 100, capped at 100
    const uniqueDays = new Set(
      sessionHistory.map(s => s.startTime ? s.startTime.split('T')[0] : null).filter(Boolean)
    ).size;
    const pq = Math.min(100, Math.round((uniqueDays / 20) * 100));

    // EQ: 50% feedback engagement + 50% positive mood, default 50 if no sessions
    const total = sessionHistory.length;
    if (total === 0) return { pq, eq: 50 };
    const withFeedback = sessionHistory.filter(s => s.feedback && s.feedback.responses).length;
    const highMood = sessionHistory.filter(s => s.mood && s.mood.currentVibe === 'high_energy').length;
    const eq = Math.round(((withFeedback / total) * 50) + ((highMood / total) * 50));
    return { pq, eq };
  }

  // Render the HQ result card — plain-language category breakdown
  function _renderHQResult(data, bloom) {
    const allLevels = [
      {
        level: 1, category: 'Foundation Builder', icon: '📝', color: '#C62828', bg: '#FFEBEE', minScore: 0, maxScore: 24,
        what: 'Student can recall key facts and concepts from memory.',
        how: 'Can list, name and identify what they have learned.'
      },
      {
        level: 2, category: 'Concept Learner', icon: '💡', color: '#F57F17', bg: '#FFFDE7', minScore: 25, maxScore: 39,
        what: 'Student understands core ideas and explains them in own words.',
        how: 'Can interpret, summarise and describe topics with clarity.'
      },
      {
        level: 3, category: 'Skill Practitioner', icon: '🔧', color: '#E65100', bg: '#FFF3E0', minScore: 40, maxScore: 54,
        what: 'Student applies learned knowledge to solve real-world problems.',
        how: 'Can execute, implement and use skills in new situations.'
      },
      {
        level: 4, category: 'Critical Thinker', icon: '🔍', color: '#00695C', bg: '#E0F2F1', minScore: 55, maxScore: 69,
        what: 'Student breaks topics into parts and draws meaningful connections.',
        how: 'Can differentiate, organise and spot patterns across ideas.'
      },
      {
        level: 5, category: 'Reflective Evaluator', icon: '⚖️', color: '#1565C0', bg: '#E3F2FD', minScore: 70, maxScore: 84,
        what: 'Student assesses ideas, judges their quality and justifies decisions.',
        how: 'Can critique, compare and defend conclusions with reasoning.'
      },
      {
        level: 6, category: 'Creative Innovator', icon: '🌟', color: '#7B1FA2', bg: '#F3E5F5', minScore: 85, maxScore: 100,
        what: 'Student creates original solutions and demonstrates full mastery.',
        how: 'Can design, construct and produce new ideas independently.'
      }
    ];

    return `
      <div class="hq-result-card" style="border-left:5px solid ${bloom.color}; background:${bloom.bg};">

        <!-- Summary header -->
        <div class="hq-result-header">
          <span class="hq-bloom-icon">${bloom.icon}</span>
          <div class="hq-bloom-info">
            <div class="hq-bloom-label" style="color:${bloom.color};">${bloom.category}</div>
            <div class="hq-bloom-level">Category ${bloom.level} of 6</div>
          </div>
          <div class="hq-avg-score" style="color:${bloom.color};">HQ&nbsp;${data.avg}</div>
        </div>
        <div class="hq-bloom-desc">${bloom.desc}</div>

        <!-- Score breakdown chips -->
        <div class="hq-scores-row">
          <span class="hq-score-chip">📖 AQ: ${data.aq}</span>
          <span class="hq-score-chip">🕉️ SQ: ${data.sq}</span>
          <span class="hq-score-chip">💪 PQ: ${data.pq}</span>
          <span class="hq-score-chip">❤️ EQ: ${data.eq}</span>
        </div>

        <!-- All categories: score range + student achievement -->
        <div class="hq-catlist">
          <div class="hq-catlist-heading">Student Performance Across All Categories</div>

          ${allLevels.slice().reverse().map(l => {
      const isCurrent = l.level === bloom.level;
      const isAchieved = l.level < bloom.level;
      const isTarget = l.level > bloom.level;
      const gapNeeded = isTarget ? (l.minScore - data.avg) : 0;
      return `
            <div class="hq-catlist-row ${isCurrent ? 'hq-catlist-current' : ''}"
                 style="${isCurrent ? `border-left:4px solid ${l.color}; background:${l.bg};` : 'border-left:4px solid transparent;'}">

              <div class="hq-catlist-left">
                <span class="hq-catlist-icon" style="color:${l.color};">${l.icon}</span>
                <div class="hq-catlist-body">
                  <div class="hq-catlist-name" style="color:${l.color};">${l.category}</div>
                  <div class="hq-catlist-what">${l.what}</div>
                  ${isCurrent ? `<div class="hq-catlist-how">${l.how}</div>` : ''}
                </div>
              </div>

              <div class="hq-catlist-right">
                <div class="hq-catlist-range">Expected: ${l.minScore} – ${l.maxScore}</div>
                <div class="hq-catlist-achieved">Student: ${data.avg}</div>
                <span class="hq-catlist-badge ${isAchieved ? 'hq-badge-achieved' : isCurrent ? 'hq-badge-current' : 'hq-badge-target'}"
                      style="${isCurrent ? `background:${l.color};` : ''}">
                  ${isAchieved ? '✓ Achieved' : isCurrent ? '● Current Level' : `+${gapNeeded} to reach`}
                </span>
              </div>

            </div>`;
    }).join('')}
        </div>

      </div>`;
  }

  function _renderTopicsProgress(studentProfile) {
    const completedTopics = studentProfile.completedTopics || [];
    const unlockedTopics = studentProfile.unlockedTopics || [];

    const visibleTopics = GKRecommender.getAllTopics().filter(t => {
      const td = GKRecommender.getTopicData(t.subjectId, t.topicId);
      if (!td || !td.topic) return false;
      const key = t.subjectId + '-' + t.topicId;
      return td.topic.moduleType !== 'next-path' || unlockedTopics.includes(key);
    });

    const rows = visibleTopics.map(t => {
      const td = GKRecommender.getTopicData(t.subjectId, t.topicId);
      let status = 'pending'; // 'completed', 'inprogress', 'pending'

      if (td && td.topic) {
        const key = t.subjectId + '-' + t.topicId;
        const mandatorySubs = td.topic.subtopics.filter(st => st.mandatory !== false);
        const allSubs = td.topic.subtopics;

        const doneCount = allSubs.filter(st => studentProfile.completedSubtopics && studentProfile.completedSubtopics.includes(td.topic.id + '-' + st.id)).length;
        // Fix: If no mandatory subs, mandatoryDone should not be true unless all (optional) subs are done
        const mandatoryDone = mandatorySubs.length > 0
          ? mandatorySubs.every(st => studentProfile.completedSubtopics && studentProfile.completedSubtopics.includes(td.topic.id + '-' + st.id))
          : (allSubs.length > 0 && doneCount === allSubs.length);
        const isExplicitlyDone = (completedTopics && completedTopics.includes(key));
        const isOverridden = (studentProfile.overrides && studentProfile.overrides[key]);

        if (mandatoryDone || isExplicitlyDone || isOverridden) {
          status = 'completed';
        } else if (doneCount > 0) {
          status = 'inprogress';
        } else {
          status = 'pending';
        }
      }

      const statusLabels = {
        'completed': 'COMPLETED',
        'inprogress': 'IN PROGRESS',
        'pending': 'ENROLLED'
      };

      return `
        <div class="nebula-path-node tp-v2-${status}" style="border-left: 6px solid ${status === 'completed' ? '#27ae60' : (status === 'inprogress' ? '#3498db' : '#eee')};">
          <div style="font-size: 1.5rem; width: 40px;">${t.subjectIcon}</div>
          <div style="flex: 1;">
            <div style="font-weight: 800; font-size: 0.9rem; color: var(--m-primary);">${t.topicName}</div>
            <div style="font-size: 0.7rem; color: #999; text-transform: uppercase; font-weight: 700;">${t.subjectName}</div>
          </div>
          <div style="font-size: 0.6rem; font-weight: 900; color: #888;">${statusLabels[status]}</div>
        </div>`;
    });
    return `<div>${rows.length > 0 ? rows.join('') : '<p class="empty-note">Awaiting discovery.</p>'}</div>`;
  }

  function _renderAssessments(userId, assessmentObj) {
    const keys = Object.keys(assessmentObj);
    if (keys.length === 0) return '<p class="empty-note">No attempts yet.</p>';

    const rows = keys.map(topicKey => {
      const attempts = assessmentObj[topicKey];
      const latest = attempts[attempts.length - 1];
      const statusClass = latest.percentage >= 60 ? 'status-pass-v2' : 'status-fail-v2';

      return `
        <div class="nebula-orb-wrap" style="text-align: center;">
          <div class="achievement-orb ${latest.percentage >= 60 ? 'orb-pass' : 'orb-fail'}">
            ${latest.percentage}%
          </div>
          <div style="font-weight: 800; font-size: 0.7rem; color: var(--m-primary); max-width: 80px; margin: 0 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${_formatTopicId(topicKey)}
          </div>
          <div style="font-size: 0.55rem; color: #999; font-weight: 700;">${_formatDate(latest.attemptedAt)}</div>
        </div>`;
    });

    return rows.join('');
  }

  function _renderNextPathSection(userId, studentProfile) {
    const unlockedTopics = studentProfile.unlockedTopics || [];

    // Find all topics marked as 'next-path' but not yet unlocked
    const available = [];
    GK_TOPICS.subjects.forEach(subj => {
      subj.topics.forEach(t => {
        if (t.moduleType === 'next-path') {
          const key = subj.id + '-' + t.id;
          if (!unlockedTopics.includes(key)) {
            available.push({ subject: subj, topic: t, key });
          }
        }
      });
    });

    if (available.length === 0) {
      return `
        <div class="next-path-card empty">
          <p>No new topics available to unlock. All path topics have been assigned.</p>
        </div>`;
    }

    return available.map(item => `
        <div class="nebula-path-node next-path-locked" onclick="GKMentorApp.showPromotionNotice('${item.topic.name}')"
             title="Promote the student to unlock this module.">
          <div class="node-lock-overlay">🔒</div>
          <div class="node-icon">${item.subject.icon}</div>
          <div class="node-body">
            <div class="node-title">${item.topic.name}</div>
            <div class="node-subtitle">READY TO UNLOCK</div>
          </div>
          <div class="node-action-prompt">🎓</div>
        </div>`).join('');
  }

  function showPromotionNotice(topicName) {
    _showToast(`🛡️ Guru, "${topicName}" can only be assigned during the formal Promotion process. Please complete the Evaluation Console below when the student is ready. 🙏`);
  }



  function _renderFeedbackHistory(sessionHistory) {
    const sessionsWithFeedback = sessionHistory
      .filter(s => s.feedback && s.feedback.responses)
      .slice(-5)
      .reverse();

    if (sessionsWithFeedback.length === 0) {
      return `<p class="empty-note">No feedback submitted yet.</p>`;
    }

    return sessionsWithFeedback.map(s => {
      const formatted = GKFeedback.getFormattedResponses(s.feedback.responses);
      const insights = s.feedback.insights || [];
      return `
        <div class="feedback-history-card">
          <div class="fh-date">📅 ${_formatDate(s.startTime)}</div>
          <div class="fh-responses">
            ${formatted.map(r => `
              <div class="fh-row">
                <span class="fh-question">${r.questionText}</span>
                <span class="fh-answer">${r.label}</span>
              </div>`).join('')}
          </div>
          ${insights.length > 0 ? `
          <div class="fh-insights">
            ${insights.map(i => `<span class="fh-insight">💡 ${i}</span>`).join('')}
          </div>` : ''}
        </div>`;
    }).join('');
  }

  function _formatDate(isoString) {
    if (!isoString) return '—';
    return new Date(isoString).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric'
    });
  }

  function _formatTopicId(tid) {
    if (tid === 'final') return '🏆 Final Assessment';
    return tid.replace(/-/g, ' → ').replace(/bw/g, c => c.toUpperCase());
  }


  function renderLiveView() {
    const id = state.selectedStudentId;
    const student = state.students[id];
    if (!student) return `<div class="screen"><p>Student not found.</p></div>`;

    return `
      <div class="screen screen-mentor">
        ${renderMentorHeader()}
        <div class="screen-agent-row">
          ${_narayanaHtml('liveView')}
          <div class="screen-content-col">
            <div class="mentor-content">
              <div class="detail-nav-row" style="margin-bottom:1.5rem;">
                <button class="btn btn-ghost" onclick="GKMentorApp.navigate('studentDetail')">← Back to Profile</button>
              </div>
              <div id="live-session-container" class="live-view-container">
                <h2 class="live-heading" style="margin-bottom:1.5rem; color:#6B3F1A;">👁️ Live Session: Monitoring ${student.displayName}</h2>
                <div class="live-screen-preview">
                  <button class="btn-fs-toggle" onclick="GKMentorApp.toggleLiveFullscreen()" title="Toggle Full-Screen">⛶</button>
                  <div class="live-screen-viewport">
                    <iframe src="student.html?mirror=true&userId=${id}"
                            style="width: 1440px; height: 900px; border: none; pointer-events: none;"
                            id="sacred-mirror-frame"></iframe>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>`;
  }

  function toggleLiveFullscreen() {
    const el = document.getElementById('live-session-container');
    if (!el) return;
    el.classList.toggle('mentor-live-fs');

    const btn = document.querySelector('.btn-fs-toggle');
    const isFS = el.classList.contains('mentor-live-fs');
    if (btn) btn.textContent = isFS ? '⧉' : '⛶';

    // Announce to Narayana
    if (isFS) {
      state.narayanaMsg = "Guru, I have expanded the sacred mirror. You can now observe the student's journey in full clarity. 👁️";
    } else {
      state.narayanaMsg = "The mirror returns to its frame, Guru. I am still monitoring from here. 🙏";
    }
    _refreshNarayanaWidget();
  }

  function renderHQGeneration() {
    const id = state.selectedStudentId;
    const student = state.students[id];
    if (!student) return `<div class="screen"><p>Student not found.</p></div>`;

    const existingHQ = GKStore.getHolisticScores(id);
    const sessionHistory = GKStore.getSessionHistory(id);
    const { pq: sysPQ, eq: sysEQ } = _computeSystemQuotients(student, sessionHistory);

    return `
      <div class="screen screen-mentor">
        ${renderMentorHeader()}
        <div class="screen-agent-row">
          ${_narayanaHtml('hqGeneration', { _customMsg: `Excellent work, Guru! 🙏 ${student.displayName} has been promoted. Now, let's generate their Holistic Quotient report to finalize this milestone.` })}
          <div class="screen-content-col">
            <div class="mentor-content">
              <div class="mentor-page-header">
                <h2>📊 Generate Holistic Quotient (HQ)</h2>
                <p>Finalize the assessment for ${student.displayName} by entering the Academic and Spiritual quotients.</p>
              </div>

              <div class="detail-section hq-generation-container hq-standalone-card">
                <div class="quotient-row-horizontal">
                  <div class="hq-input-card">
                    <div class="hqic-left">
                      <div class="hqic-icon">📖</div>
                      <div class="hqic-meta">
                        <span class="hqic-tag">AQ</span>
                        <span class="hqic-label">Academic Quotient</span>
                      </div>
                    </div>
                    <div class="hqic-right">
                      <input type="number" id="hq-aq-input" class="hq-num-input" min="0" max="100"
                             placeholder="0–100" value="${existingHQ ? existingHQ.aq : ''}" />
                    </div>
                  </div>

                  <div class="hq-input-card">
                    <div class="hqic-left">
                      <div class="hqic-icon">🕉️</div>
                      <div class="hqic-meta">
                        <span class="hqic-tag">SQ</span>
                        <span class="hqic-label">Spiritual Quotient</span>
                      </div>
                    </div>
                    <div class="hqic-right">
                      <input type="number" id="hq-sq-input" class="hq-num-input" min="0" max="100"
                             placeholder="0–100" value="${existingHQ ? existingHQ.sq : ''}" />
                    </div>
                  </div>

                  <div class="hq-status-card">
                    <div class="hqsc-item">
                      <span class="hqsc-val">${sysPQ}</span>
                      <span class="hqsc-lbl">PQ (Auto)</span>
                    </div>
                    <div class="hqsc-sep"></div>
                    <div class="hqsc-item">
                      <span class="hqsc-val">${sysEQ}</span>
                      <span class="hqsc-lbl">EQ (Auto)</span>
                    </div>
                  </div>
                </div>

                <div class="hq-actions-row">
                  <button class="btn btn-primary" onclick="GKMentorApp.generateAndSaveHQ('${id}')">🌟 Generate & Save HQ Report</button>
                  <button class="btn btn-ghost" onclick="GKMentorApp.navigate('dashboard')">Skip for now</button>
                </div>

                <div id="hq-result-panel" class="hidden"></div>
              </div>
            </div>
          </div>
        </div>
      </div>`;
  }

  function generateAndSaveHQ(userId) {
    const aq = parseInt(document.getElementById('hq-aq-input').value || 0, 10);
    const sq = parseInt(document.getElementById('hq-sq-input').value || 0, 10);
    const student = state.students[userId];
    const sessionHistory = GKStore.getSessionHistory(userId);
    const { pq, eq } = _computeSystemQuotients(student, sessionHistory);
    const avg = Math.round((aq + sq + pq + eq) / 4);
    const bloom = _bloomsLevel(avg);

    const holisticData = {
      aq, sq, pq, eq, avg,
      bloomLevel: bloom.level,
      bloomCategory: bloom.label,
      computedAt: new Date().toISOString(),
      computedBy: state.mentor ? (state.mentor.displayName || state.mentor.username) : 'Mentor'
    };

    GKStore.saveHolisticScores(userId, holisticData);
    _showToast("✅ HQ Report Generated & Saved!");

    // Show a quick preview before returning
    const resPanel = document.getElementById('hq-result-panel');
    if (resPanel) {
      resPanel.classList.remove('hidden');
      resPanel.innerHTML = _renderHQResult(holisticData, bloom);
    }

    const card = document.querySelector('.hq-standalone-card');
    if (card) {
      card.innerHTML = `
        <div class="hq-final-preview">
          ${_renderHQResult(holisticData, bloom)}
          <div style="margin-top:2rem; text-align:center;">
            <button class="btn btn-primary" onclick="GKMentorApp.navigate('dashboard')">Return to Dashboard</button>
          </div>
        </div>
      `;
    }
  }

  function toggleNarayana(forceState) {
    const bubble = document.getElementById('narayana-bubble');
    if (!bubble) return;

    if (forceState !== undefined) {
      if (forceState) bubble.classList.add('active');
      else bubble.classList.remove('active');
    } else {
      bubble.classList.toggle('active');
    }
  }

  async function triggerAIEvaluation(userId) {
    const ev = window.event || {};
    const btn = ev.target;
    const originalText = btn ? btn.textContent : '🌟 Recalculate Analysis';
    if (btn) {
      btn.textContent = '⏳ Analyzing...';
      btn.disabled = true;
    }

    await HolisticEvaluationEngine.analyzeStudent(userId);

    if (btn) {
      btn.textContent = originalText;
      btn.disabled = false;
    }
    renderInPlace();
  }

  function renderInPlace() {
    render();
  }

  function _showToast(msg) {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed; bottom:2rem; right:2rem; background:#2D1B0E; color:#fff; padding:1rem 2rem; border-radius:50px; box-shadow:0 10px 20px rgba(0,0,0,0.3); z-index:10000; animation: slideInUp 0.3s ease-out;';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => {
      el.style.animation = 'fadeOut 0.3s ease-in forwards';
      setTimeout(() => el.remove(), 300);
    }, 3000);
  }

  // ---- Init ----

  function init() {
    // Check session
    const savedMentor = JSON.parse(sessionStorage.getItem('gk_mentor'));
    if (savedMentor) {
      state.mentor = savedMentor;
      state.currentScreen = 'dashboard';
      state.students = GKStore.getAllStudentProfiles();
    } else {
      // For demo fallback
      if (typeof GK_MENTOR !== 'undefined') {
        state.mentor = GK_MENTOR;
        state.currentScreen = 'dashboard';
        state.students = GKStore.getAllStudentProfiles();
      }
    }

    render();

    // Real-time sync via Server-Sent Events — fires whenever any student
    // writes data (server broadcasts 'update' after every write endpoint).
    const _sse = new EventSource('/api/events');
    _sse.addEventListener('update', async () => {
      if (state.mentor) {
        await GKDatabase.refresh();   // re-fetch full snapshot into cache
        state.students = GKStore.getAllStudentProfiles();
        if (state.selectedStudentId) {
          const profile = GKStore.getUserProfile(state.selectedStudentId);
          if (profile) state.students[state.selectedStudentId] = { ...state.students[state.selectedStudentId], ...profile };
        }
        renderInPlace();
      }
    });
    _sse.onerror = () => {
      console.warn('[GKMentor] SSE connection lost — will retry automatically');
    };

    // Fallback polling (essential for local file:// cross-tab syncing)
    setInterval(() => {
      if (state.mentor) {
        const newDataRaw = GKStore.getAllStudentProfiles();
        const newDataStr = JSON.stringify(newDataRaw);

        if (JSON.stringify(state.students) !== newDataStr) {
          // Identify what changed for Narayana to announce
          Object.keys(newDataRaw).forEach(sid => {
            const oldS = state.students[sid];
            const newS = newDataRaw[sid];
            if (oldS && newS) {
              const oldDone = oldS.completedTopics || [];
              const newDone = newS.completedTopics || [];
              if (newDone.length > oldDone.length) {
                const newTopic = newDone.find(t => !oldDone.includes(t));
                if (newTopic) {
                  const msg = `Guru, ${newS.displayName} has just completed the assessment for ${_formatTopicId(newTopic)}! 🙏`;
                  state.narayanaMsg = msg;
                  // if (typeof GKVoice !== 'undefined') GKVoice.speak(msg); // Silenced
                }
              }
            }
          });

          state.students = newDataRaw;
          if (document.querySelector('.screen-mentor')) {
            renderInPlace();
          }
        }
      }
    }, 2000);
  }

  function toggleSection(sectionId) {
    state.expandedSections[sectionId] = !state.expandedSections[sectionId];
    renderInPlace();
  }

  function persistInput(id, value) {
    state.pendingInputs[id] = value;
  }







    // ---- FEEDBACK DASHBOARD ----
  async function loadFeedbackDashboard() {
    state.currentScreen = 'feedbackDashboard';
    state.feedbackLoading = true;
    render(); // Show loading skeleton

    try {
      const res = await fetch('/api/feedback/all');
      const rawData = await res.json();
      state.feedbackData = parseFeedbackData(rawData);
    } catch(err) {
      console.error("Failed to load feedback", err);
      state.feedbackData = null;
    } finally {
      state.feedbackLoading = false;
      if (state.currentScreen === 'feedbackDashboard') renderInPlace();
    }
  }

  function toggleStudentDetails(userId) {
    state.expandedStudentId = state.expandedStudentId === userId ? null : userId;
    if (state.currentScreen === 'feedbackDashboard') renderInPlace();
  }

  function updateFeedbackSearch(query) {
    state.feedbackSearchQuery = query.toLowerCase();
    if (state.currentScreen === 'feedbackDashboard') renderInPlace();
  }

  function analyzeFeedbackSentiment(text) {
    if (!text || typeof text !== 'string' || text.trim().length < 4) return 'Sentiment Unavailable';
    
    // Check for meaningless repeats (e.g. "ds ds", "cc")
    const words = text.toLowerCase().trim().split(/s+/);
    if (words.length <= 2 && words[0] === words[1]) return 'Sentiment Unavailable';

    const t = text.toLowerCase();
    const positive = ['fun', 'great', 'good', 'easy', 'understood', 'awesome', 'clear', 'nice', 'enjoyed', 'loved', 'helpful', 'interesting', 'liked', 'excellent'];
    const negative = ['hard', 'difficult', 'confusing', 'boring', 'bad', 'tough', 'complicated', 'did not get', 'did not understand', 'poor'];
    
    let posCount = 0;
    let negCount = 0;
    positive.forEach(w => { if (t.includes(w)) posCount++; });
    negative.forEach(w => { if (t.includes(w)) negCount++; });
    
    if (posCount > negCount) return 'Positive';
    if (negCount > posCount) return 'Negative';
    if (posCount === 0 && negCount === 0 && text.length < 10) return 'Sentiment Unavailable';
    return 'Neutral';
  }

  function parseFeedbackData(rawData) {
    let studentMetrics = [];
    let totalFeedback = 0;
    let totalPositive = 0;
    let totalNeutral = 0;
    let totalNegative = 0;
    let validSentimentRecords = 0;
    let recentFeedback = [];

    rawData.forEach(student => {
      let entries = [];
      
      (student.sessions || []).forEach(s => {
        if (s.enjoyedMost || s.improvementPoint) {
          entries.push({ date: s.savedAt, source: 'Session', text: ((s.enjoyedMost || '') + ' ' + (s.improvementPoint || '')).trim() });
        }
      });

      (student.modules || []).forEach(m => {
        if (m.feedback && (m.feedback.enjoyedMost || m.feedback.improvementPoint)) {
          entries.push({ date: m.savedAt, source: 'Module: ' + m.topicName, text: ((m.feedback.enjoyedMost || '') + ' ' + (m.feedback.improvementPoint || '')).trim() });
        }
        (m.subtopics || []).forEach(st => {
          if (st.feedback && (st.feedback.enjoyedMost || st.feedback.improvementPoint)) {
            entries.push({ date: st.savedAt, source: 'Subtopic: ' + st.subtopicName, text: ((st.feedback.enjoyedMost || '') + ' ' + (st.feedback.improvementPoint || '')).trim() });
          }
        });
      });

      if (entries.length === 0) return;

      let posCount = 0;
      let validCountForStudent = 0;

      entries = entries.map(e => {
        const sentiment = analyzeFeedbackSentiment(e.text);
        if (sentiment !== 'Sentiment Unavailable') {
          validSentimentRecords++;
          validCountForStudent++;
          if (sentiment === 'Positive') { totalPositive++; posCount++; }
          else if (sentiment === 'Negative') totalNegative++;
          else totalNeutral++;
        }
        recentFeedback.push({ userId: student.userId, ...e, sentiment });
        return { ...e, sentiment };
      });

      const positivePercentage = validCountForStudent > 0 ? Math.round((posCount / validCountForStudent) * 100) : null;
      let status = 'Insufficient Data';
      
      if (validCountForStudent > 0) {
        if (positivePercentage >= 80) status = 'Excellent';
        else if (positivePercentage >= 60) status = 'Good';
        else if (positivePercentage >= 40) status = 'Average';
        else status = 'Needs Attention';
      }

      totalFeedback += entries.length;

      studentMetrics.push({
        userId: student.userId,
        feedbackCount: entries.length,
        positivePercentage,
        status,
        entries
      });
    });

    recentFeedback.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    return {
      studentMetrics,
      totalFeedback,
      totalStudents: studentMetrics.length,
      validSentimentRecords,
      totalPositive,
      totalNeutral,
      totalNegative,
      recentFeedback: recentFeedback.slice(0, 10)
    };
  }

  function renderFeedbackDashboard() {
    if (state.feedbackLoading) {
      return `
        <div class="screen screen-mentor">
          ${renderMentorHeader()}
          <div class="screen-full-col">
            <div class="mentor-content">
              <div class="empty-state">Loading feedback data...</div>
            </div>
          </div>
        </div>
      `;
    }

    if (!state.feedbackData || state.feedbackData.studentMetrics.length === 0) {
      return `
        <div class="screen screen-mentor">
          ${renderMentorHeader()}
          <div class="screen-full-col">
            <div class="mentor-content">
               <div class="detail-nav-row" style="margin-bottom: 2rem;">
                <button class="btn btn-ghost btn-sm" onclick="GKMentorApp.navigate('dashboard')">← Back to Dashboard</button>
              </div>
              <div class="empty-state">No feedback available yet.</div>
            </div>
          </div>
        </div>
      `;
    }

    const data = state.feedbackData;
    const hasValidSentiment = data.validSentimentRecords >= 10;
    const overallPosPercent = data.validSentimentRecords > 0 ? Math.round((data.totalPositive / data.validSentimentRecords) * 100) : 0;
    const overallNeuPercent = data.validSentimentRecords > 0 ? Math.round((data.totalNeutral / data.validSentimentRecords) * 100) : 0;
    const overallNegPercent = data.validSentimentRecords > 0 ? Math.round((data.totalNegative / data.validSentimentRecords) * 100) : 0;

    let avgFeedback = data.totalStudents > 0 ? (data.totalFeedback / data.totalStudents).toFixed(1) : 0;

    // Summary Cards
    let summaryHtml = `
      <div class="sc-stats-bento" style="margin-bottom: 2rem; grid-template-columns: repeat(${hasValidSentiment ? 4 : 3}, 1fr);">
        <div class="sc-stat">
          <div class="sc-stat-label">Total Feedback</div>
          <div class="sc-stat-val">${data.totalFeedback}</div>
        </div>
        <div class="sc-stat">
          <div class="sc-stat-label">Total Students</div>
          <div class="sc-stat-val">${data.totalStudents}</div>
        </div>
        ${hasValidSentiment ? `
        <div class="sc-stat">
          <div class="sc-stat-label">Positive Feedback</div>
          <div class="sc-stat-val" style="color: #27ae60;">${overallPosPercent}%</div>
        </div>` : ''}
        <div class="sc-stat">
          <div class="sc-stat-label">Avg / Student</div>
          <div class="sc-stat-val">${avgFeedback}</div>
        </div>
      </div>
    `;

    // Recent Feedback
    const isRecentExpanded = state.expandedSections['recentFeedback'] !== false; // Default true
    let recentHtml = `
      <div class="qv2-card" style="margin-bottom: 2rem;">
        <div class="section-header" style="margin-bottom: 1rem; cursor: pointer; display: flex; justify-content: space-between; align-items: center;" onclick="GKMentorApp.toggleSection('recentFeedback')">
          <h3 style="margin: 0;">Recent Feedback</h3>
          <div style="font-size: 1rem; color: #888;">${isRecentExpanded ? '▲' : '▼'}</div>
        </div>
        ${isRecentExpanded ? `
        <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; text-align: left;">
          <thead>
            <tr style="border-bottom: 1px solid #eee;">
              <th style="padding: 0.5rem; color: #888;">Student</th>
              <th style="padding: 0.5rem; color: #888;">Date</th>
              <th style="padding: 0.5rem; color: #888;">Feedback</th>
            </tr>
          </thead>
          <tbody>
            ${data.recentFeedback.map(e => `
              <tr style="border-bottom: 1px solid #f9f9f9;">
                <td style="padding: 0.5rem; text-transform: capitalize; font-weight: 600;">${e.userId}</td>
                <td style="padding: 0.5rem; color: #999;">${e.date ? new Date(e.date).toLocaleDateString() : ''}</td>
                <td style="padding: 0.5rem;">
                  <div>${e.text}</div>
                  <div style="font-size: 0.7rem; color: #aaa; margin-top: 4px;">
                    <span style="padding: 2px 6px; border-radius: 4px; background: ${e.sentiment==='Positive'?'#e8f5e9':e.sentiment==='Negative'?'#ffebee':e.sentiment==='Neutral'?'#fff8e1':'#f5f5f5'}; color: ${e.sentiment==='Positive'?'#2e7d32':e.sentiment==='Negative'?'#c62828':e.sentiment==='Neutral'?'#f39c12':'#777'};">
                      ${e.sentiment}
                    </span>
                    <span style="margin-left: 8px;">Source: ${e.source}</span>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        ` : ''}
      </div>
    `;

    // Student Analysis
    const sq = state.feedbackSearchQuery || '';
    const filteredStudents = data.studentMetrics.filter(s => s.userId.toLowerCase().includes(sq));

    let studentsHtml = `
      <div class="qv2-card" style="margin-bottom: 2rem;">
        <div class="section-header" style="margin-bottom: 1rem;">
          <h3>Student-wise Analysis</h3>
          <input type="text" placeholder="Search Student..." value="${sq}" oninput="GKMentorApp.updateFeedbackSearch(this.value)" style="padding: 0.4rem 0.8rem; border-radius: 20px; border: 1px solid #ccc; font-family: inherit; font-size: 0.85rem;" />
        </div>
        <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem; text-align: left;">
          <thead>
            <tr style="border-bottom: 1px solid #eee;">
              <th style="padding: 0.75rem; color: #888;">Student Name</th>
              <th style="padding: 0.75rem; color: #888;">Feedback Count</th>
              <th style="padding: 0.75rem; color: #888;">Positive Score</th>
              <th style="padding: 0.75rem; color: #888;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${filteredStudents.map(s => {
              const isExpanded = state.expandedStudentId === s.userId;
              let statusColor = '#777';
              let statusBg = '#f5f5f5';
              if (s.status === 'Excellent') { statusColor = '#2e7d32'; statusBg = '#e8f5e9'; }
              if (s.status === 'Good') { statusColor = '#1976d2'; statusBg = '#e3f2fd'; }
              if (s.status === 'Average') { statusColor = '#f39c12'; statusBg = '#fff8e1'; }
              if (s.status === 'Needs Attention') { statusColor = '#c62828'; statusBg = '#ffebee'; }
              
              return `
                <tr style="border-bottom: 1px solid #eee; cursor: pointer; transition: background 0.2s;" onclick="GKMentorApp.toggleStudentDetails('${s.userId}')" onmouseover="this.style.background='#fdfbf7'" onmouseout="this.style.background='transparent'">
                  <td style="padding: 0.75rem; text-transform: capitalize; font-weight: 700; color: var(--m-primary);">${s.userId} ${isExpanded ? '🔽' : '▶️'}</td>
                  <td style="padding: 0.75rem; font-weight: 600;">${s.feedbackCount}</td>
                  <td style="padding: 0.75rem;">${s.positivePercentage !== null ? s.positivePercentage + '%' : 'N/A'}</td>
                  <td style="padding: 0.75rem;">
                    <span style="padding: 4px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 800; background: ${statusBg}; color: ${statusColor};">
                      ${s.status}
                    </span>
                  </td>
                </tr>
                ${isExpanded ? `
                <tr style="background: #fdfbf7;">
                  <td colspan="4" style="padding: 1rem;">
                    <div style="font-size: 0.85rem; padding-left: 1rem; border-left: 3px solid var(--m-accent);">
                      <strong>Detailed Feedback Records:</strong>
                      <ul style="margin-top: 0.5rem; padding-left: 1rem;">
                        ${s.entries.map(e => `
                          <li style="margin-bottom: 0.5rem;">
                            <div style="color: #666; font-size: 0.75rem;">${e.source} ${e.date ? '(' + new Date(e.date).toLocaleDateString() + ')' : ''}</div>
                            <div>"${e.text}"</div>
                            <div style="font-size: 0.7rem; font-weight: 600; color: ${e.sentiment==='Positive'?'#2e7d32':e.sentiment==='Negative'?'#c62828':'#888'};">Sentiment: ${e.sentiment}</div>
                          </li>
                        `).join('')}
                      </ul>
                    </div>
                  </td>
                </tr>
                ` : ''}
              `;
            }).join('')}
            ${filteredStudents.length === 0 ? `<tr><td colspan="4" style="padding: 1rem; text-align: center; color: #888;">No students found matching your search.</td></tr>` : ''}
          </tbody>
        </table>
      </div>
    `;

    // Overall Analysis & Comparison Insights
    let overallHtml = '';
    let comparisonHtml = '';

    if (hasValidSentiment && data.studentMetrics.filter(s => s.status !== 'Insufficient Data').length >= 3) {
      overallHtml = `
        <div class="qv2-card" style="margin-bottom: 2rem;">
          <div class="section-header" style="margin-bottom: 1rem;">
            <h3>Overall Feedback Analysis</h3>
          </div>
          <div style="display: flex; flex-direction: column; gap: 1rem;">
            <div>
              <div style="display: flex; justify-content: space-between; font-size: 0.85rem; font-weight: 600; margin-bottom: 4px;">
                <span>Positive</span><span>${overallPosPercent}%</span>
              </div>
              <div class="qv2-meter"><div class="qv2-fill" style="width: ${overallPosPercent}%; background: #27ae60;"></div></div>
            </div>
            <div>
              <div style="display: flex; justify-content: space-between; font-size: 0.85rem; font-weight: 600; margin-bottom: 4px;">
                <span>Neutral</span><span>${overallNeuPercent}%</span>
              </div>
              <div class="qv2-meter"><div class="qv2-fill" style="width: ${overallNeuPercent}%; background: #f39c12;"></div></div>
            </div>
            <div>
              <div style="display: flex; justify-content: space-between; font-size: 0.85rem; font-weight: 600; margin-bottom: 4px;">
                <span>Negative</span><span>${overallNegPercent}%</span>
              </div>
              <div class="qv2-meter"><div class="qv2-fill" style="width: ${overallNegPercent}%; background: #e74c3c;"></div></div>
            </div>
          </div>
        </div>
      `;

      const validStudents = data.studentMetrics.filter(s => s.status !== 'Insufficient Data');
      const topStudents = [...validStudents].sort((a,b) => b.positivePercentage - a.positivePercentage).slice(0, 5);
      const bottomStudents = [...validStudents].sort((a,b) => a.positivePercentage - b.positivePercentage).slice(0, 5);

      comparisonHtml = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 2rem;">
          <div class="qv2-card">
            <div class="section-header" style="margin-bottom: 1rem;">
              <h3>Top Positive Students</h3>
            </div>
            <ul style="list-style: none; padding: 0; margin: 0; font-size: 0.9rem;">
              ${topStudents.map(s => `
                <li style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid #eee;">
                  <span style="text-transform: capitalize; font-weight: 600;">${s.userId}</span>
                  <span style="font-weight: 800; color: #27ae60;">${s.positivePercentage}%</span>
                </li>
              `).join('')}
            </ul>
          </div>
          <div class="qv2-card">
            <div class="section-header" style="margin-bottom: 1rem;">
              <h3>Needs Attention</h3>
            </div>
            <ul style="list-style: none; padding: 0; margin: 0; font-size: 0.9rem;">
              ${bottomStudents.map(s => `
                <li style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid #eee;">
                  <span style="text-transform: capitalize; font-weight: 600;">${s.userId}</span>
                  <span style="font-weight: 800; color: #e74c3c;">${s.positivePercentage}%</span>
                </li>
              `).join('')}
            </ul>
          </div>
        </div>
      `;
    } else {
      comparisonHtml = `
        <div class="qv2-card" style="margin-bottom: 2rem; text-align: center; color: #888; font-weight: 600;">
          More feedback data is required for comparison insights and overall sentiment analysis.
        </div>
      `;
    }

    return `
      <div class="screen screen-mentor">
        ${renderMentorHeader()}
        <div class="screen-full-col">
          <div class="mentor-content">
            <div class="detail-nav-row" style="margin-bottom: 2rem;">
              <button class="btn btn-ghost btn-sm" onclick="GKMentorApp.navigate('dashboard')">← Back to Dashboard</button>
            </div>
            
            <div class="mentor-page-header" style="margin-bottom: 2rem;">
              <h2>Feedback Dashboard</h2>
              <p>Analyze student sentiment and identify areas for curriculum improvement.</p>
            </div>

            ${summaryHtml}
            ${recentHtml}
            ${studentsHtml}
            ${overallHtml}
            ${comparisonHtml}
            
          </div>
        </div>
      </div>
    `;
  }


  return {
    init, selectStudent: viewStudent, backToDashboard,
    viewHolisticDetail,
    rewardStudent, promoteStudent,
    addToPath, removeFromPath,
    openSuggestionForm, sendSuggestion,
    sendAdminFeedback, sendParentFeedback, submitEvaluation, clearAllScores,
    onQuotientInput, saveHolisticQuotient,
    triggerAIEvaluation, renderInPlace,
    toggleNarayana, toggleSection, persistInput,
    toggleLiveFullscreen, showPromotionNotice,
    selectAllEvalTopics, onEvalCheckChange, unlockAllNextPath, acceptSubject, rejectSubject,
    selectMentorMood, submitMentorMood, updateMentorBattery,
    navigate, renderLiveView, generateAndSaveHQ,
    sendNarayanaQuery,
    toggleMute: (btn) => GKVoice.toggle(btn),
    loadFeedbackDashboard, toggleStudentDetails, updateFeedbackSearch,
    logout
  };

})();

// Boot when DOM ready — v18
// GKDatabase.init() is async (sql.js WASM load); everything after is synchronous.
document.addEventListener('DOMContentLoaded', async () => {
  await GKDatabase.init();
  if (!GKBranding.isReady()) await GKBranding.init();
  GKMentorApp.init();
});
