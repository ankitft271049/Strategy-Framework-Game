/* ==========================================================================
   THE STRATEGY BOARDROOM — MASTER SIMULATION ENGINE
   303 Case Dilemmas, 27 Canonical Frameworks, Fluid Debrief & Web Audio
   ========================================================================== */

const SafeStorage = {
  memoryStore: {},
  getItem: function(key) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(key);
      }
    } catch (e) {}
    return this.memoryStore[key] || null;
  },
  setItem: function(key, val) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, val);
      }
    } catch (e) {}
    this.memoryStore[key] = val;
  },
  removeItem: function(key) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(key);
      }
    } catch (e) {}
    delete this.memoryStore[key];
  }
};

const APP_CONFIG = {
  adminFt: 'FT271049',
  storageKeyUser: 'StrategyBoardroom_ActiveUser_v11',
  storageKeyLeaderboard: 'StrategyBoardroom_Leaderboard_v11',
  soundEnabled: true,
  googleAppsScriptUrl: 'https://script.google.com/macros/s/AKfycbwGHW64n0dZczgznSwlzEL2BAYDXjmSHjCuSwV5sRrdxmb2LYUIG56gE9mJ3lhp1sI/exec' // Set by user deployment
};

let gameState = {
  user: null,
  activeTrack: 'all',
  currentIndex: 0,
  filteredCases: [],
  score: 0,
  streak: 0,
  bestStreak: 0,
  answered: false,
  activeFrameworkId: 1,
  audioCtx: null
};

// ==========================================================================
// SOUND SYNTHESIZER
// ==========================================================================
const sound = {
  ctx: null,
  init() {
    if (!this.ctx) {
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContext();
      } catch (e) {}
    }
  },
  correct() {
    if (!APP_CONFIG.soundEnabled) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    [523.25, 659.25, 783.99].forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.05);
      gain.gain.setValueAtTime(0.12, now + idx * 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.05 + 0.4);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now + idx * 0.05);
      osc.stop(now + idx * 0.05 + 0.45);
    });
  },
  wrong() {
    if (!APP_CONFIG.soundEnabled) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.setValueAtTime(110, now + 0.1);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.3);
  },
  click() {
    if (!APP_CONFIG.soundEnabled) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, now);
    gain.gain.setValueAtTime(0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.06);
  }
};

function toggleSound() {
  APP_CONFIG.soundEnabled = !APP_CONFIG.soundEnabled;
  const btn = document.getElementById('soundToggleBtn');
  if (btn) btn.textContent = APP_CONFIG.soundEnabled ? '🔊' : '🔇';
}

// ==========================================================================
// INITIALIZATION & AUTH
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

function initApp() {
  renderLibrary();
  renderAdminTable();
  setupEventListeners();
  checkLoginState();
}

function checkLoginState() {
  const savedUser = SafeStorage.getItem(APP_CONFIG.storageKeyUser);
  const loginOverlay = document.getElementById('loginOverlay');
  if (savedUser) {
    try {
      gameState.user = JSON.parse(savedUser);
      updateUserUI();
      if (loginOverlay) loginOverlay.style.display = 'none';

      // Check if logged-in user has in-progress session
      const rawSession = SafeStorage.getItem(getUserSessionKey(gameState.user.ftNumber));
      if (rawSession) {
        const sessionData = JSON.parse(rawSession);
        if (sessionData && sessionData.currentIndex > 0) {
          promptResumeModal(sessionData);
          return;
        }
      }
      startSession();
      return;
    } catch (e) {}
  }
  if (loginOverlay) loginOverlay.style.display = 'flex';
  startSession();
}

function checkIsAdmin(ftNumber, name) {
  const cleanFt = (ftNumber || '').replace(/\s+/g, '').toUpperCase();
  const cleanName = (name || '').trim().toUpperCase();
  return (
    cleanFt === 'FT271049' ||
    cleanName === 'ANKIT_ADMIN' ||
    cleanName === 'ANKIT AGRAWAL' ||
    cleanName === 'ANKIT'
  );
}


// ==========================================================================
// USER SESSION STORAGE (Per-User Isolation)
// ==========================================================================
function getUserSessionKey(ftNumber) {
  return 'StrategyBoardroom_UserSession_' + (ftNumber || 'anon').toUpperCase();
}

function saveUserSession() {
  if (!gameState.user) return;
  const key = getUserSessionKey(gameState.user.ftNumber);
  const data = {
    score: gameState.score,
    streak: gameState.streak,
    bestStreak: gameState.bestStreak,
    currentIndex: gameState.currentIndex,
    answered: gameState.answered,
    activeTrack: gameState.activeTrack
  };
  SafeStorage.setItem(key, JSON.stringify(data));
}

function loadUserSession(ftNumber) {
  if (!ftNumber) return false;
  const key = getUserSessionKey(ftNumber);
  const raw = SafeStorage.getItem(key);
  if (!raw) return false;
  try {
    const data = JSON.parse(raw);
    gameState.score = data.score || 0;
    gameState.streak = data.streak || 0;
    gameState.bestStreak = data.bestStreak || 0;
    gameState.currentIndex = data.currentIndex || 0;
    gameState.answered = !!data.answered;
    gameState.activeTrack = data.activeTrack || 'all';
    return true;
  } catch (e) {
    return false;
  }
}


// ==========================================================================
// TOAST NOTIFICATIONS & PROGRESS RESUME ENGINE
// ==========================================================================
let toastTimeout = null;
function showToast(message, icon = '💾') {
  const toast = document.getElementById('toastNotification');
  const msgEl = document.getElementById('toastMessage');
  const iconEl = document.querySelector('.toast-icon');
  if (!toast || !msgEl) return;

  if (iconEl) iconEl.innerText = icon;
  msgEl.innerText = message;
  toast.classList.add('active');

  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('active');
  }, 2800);
}

function handleManualSave() {
  sound.click();
  if (!gameState.user) {
    showToast('Please enter candidate details to save progress', '⚠️');
    return;
  }
  saveUserSession();
  saveParticipantScore(false);

  const curr = gameState.currentIndex + 1;
  const total = gameState.filteredCases ? gameState.filteredCases.length : 303;
  showToast(`Progress Saved: Case ${curr} of ${total} (${gameState.score} Points)`, '💾');
}

function promptResumeModal(sessionData) {
  const modal = document.getElementById('resumeModalOverlay');
  if (!modal) return;

  const nameEl = document.getElementById('resumeName');
  const subEl = document.getElementById('resumeCandidateSubtitle');
  const caseEl = document.getElementById('resumeCaseNum');
  const scoreEl = document.getElementById('resumeScoreVal');
  const accEl = document.getElementById('resumeAccuracyVal');
  const streakEl = document.getElementById('resumeStreakVal');

  const currCase = (sessionData.currentIndex || 0) + 1;
  const totalCases = (typeof CASES_DATA !== 'undefined') ? CASES_DATA.length : 303;
  const attempted = sessionData.currentIndex || 0;
  const score = sessionData.score || 0;
  const pct = attempted > 0 ? Math.round((score / attempted) * 100) : 100;

  if (nameEl) nameEl.innerText = gameState.user ? gameState.user.fullName : 'Candidate';
  if (subEl) subEl.innerText = `Saved session for ${gameState.user ? gameState.user.ftNumber : 'Candidate'}`;
  if (caseEl) caseEl.innerText = `Case ${currCase} of ${totalCases}`;
  if (scoreEl) scoreEl.innerText = `${score} / ${attempted}`;
  if (accEl) accEl.innerText = `${pct}%`;
  if (streakEl) streakEl.innerText = `${sessionData.bestStreak || 0} Streak`;

  modal.style.display = 'flex';
  modal.classList.add('active');
}

function closeResumeModal() {
  const modal = document.getElementById('resumeModalOverlay');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.remove('active');
  }
}

function confirmResumeSession() {
  sound.click();
  closeResumeModal();
  if (!gameState.user) return;

  const raw = SafeStorage.getItem(getUserSessionKey(gameState.user.ftNumber));
  if (raw) {
    try {
      const data = JSON.parse(raw);
      gameState.score = data.score || 0;
      gameState.streak = data.streak || 0;
      gameState.bestStreak = data.bestStreak || 0;
      gameState.currentIndex = data.currentIndex || 0;
      gameState.answered = !!data.answered;
      gameState.activeTrack = data.activeTrack || 'all';

      // Setup cases
      let allCases = (typeof CASES_DATA !== 'undefined') ? CASES_DATA.slice() : [];
      if (gameState.activeTrack !== 'all') {
        allCases = allCases.filter(c => c.track === gameState.activeTrack);
      }
      gameState.filteredCases = allCases;

      // Update track buttons in UI
      document.querySelectorAll('.track-pill').forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('onclick') && btn.getAttribute('onclick').includes(`'${gameState.activeTrack}'`)) {
          btn.classList.add('active');
        }
      });

      updateHeaderStats();
      saveParticipantScore(true); // Sync resumed score immediately to leaderboard & cloud
      switchMainView('quiz');
      loadCase(gameState.currentIndex);
      showToast(`Resumed at Case ${gameState.currentIndex + 1} of ${allCases.length}`, '▶');
      return;
    } catch (e) {}
  }
  startSession();
}

function confirmRestartFresh() {
  sound.click();
  closeResumeModal();
  if (gameState.user) {
    SafeStorage.removeItem(getUserSessionKey(gameState.user.ftNumber));
    // Reset active player row in cloud
    pushScoreToCloud({
      ftNumber: gameState.user.ftNumber,
      fullName: gameState.user.fullName,
      correct: 0,
      attempted: 0,
      scoreRatio: '0 / 0',
      accuracy: '0%',
      bestStreak: 0,
      date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    });
  }
  startSession();
  showToast('Simulation restarted fresh at Case 1', '🔄');
}

function handleLogin(e) {
  if (e) e.preventDefault();
  const ftEl = document.getElementById('loginFtNumber');
  const nameEl = document.getElementById('loginFullName');

  let rawFt = ftEl ? ftEl.value.trim() : '';
  let rawName = nameEl ? nameEl.value.trim() : '';

  if (!rawFt || !rawName) return;

  let cleanFt = rawFt.replace(/\s+/g, '').toUpperCase();
  if (/^\d{6}$/.test(cleanFt)) cleanFt = 'FT' + cleanFt;

  const isAdmin = checkIsAdmin(cleanFt, rawName);

  gameState.user = {
    ftNumber: cleanFt,
    fullName: rawName,
    isAdmin: isAdmin,
    loginTimestamp: new Date().toISOString()
  };

  SafeStorage.setItem(APP_CONFIG.storageKeyUser, JSON.stringify(gameState.user));
  
  const loginOverlay = document.getElementById('loginOverlay');
  if (loginOverlay) loginOverlay.style.display = 'none';

  updateUserUI();

  // Check if candidate has saved progress
  const rawSession = SafeStorage.getItem(getUserSessionKey(cleanFt));
  if (rawSession) {
    try {
      const sessionData = JSON.parse(rawSession);
      if (sessionData && sessionData.currentIndex > 0) {
        promptResumeModal(sessionData);
        renderAdminTable();
        return;
      }
    } catch (err) {}
  }

  startSession();
  renderAdminTable();
}

function handleLogout() {
  if (gameState.user) {
    saveUserSession();
  }
  SafeStorage.removeItem(APP_CONFIG.storageKeyUser);
  gameState.user = null;
  
  // Clean memory state completely
  gameState.score = 0;
  gameState.streak = 0;
  gameState.bestStreak = 0;
  gameState.currentIndex = 0;
  gameState.answered = false;
  updateHeaderStats();

  const loginOverlay = document.getElementById('loginOverlay');
  if (loginOverlay) {
    loginOverlay.style.display = 'flex';
    const ftEl = document.getElementById('loginFtNumber');
    const nameEl = document.getElementById('loginFullName');
    if (ftEl) ftEl.value = '';
    if (nameEl) nameEl.value = '';
  }
  updateUserUI();
  renderAdminTable();
}

function updateUserUI() {
  const badge = document.getElementById('userHeaderBadge');
  const nameEl = document.getElementById('userBadgeName');
  const adminTab = document.getElementById('adminTabBtn');
  const adminControls = document.getElementById('adminControlsArea');

  if (gameState.user) {
    if (badge) badge.style.display = 'flex';
    if (nameEl) nameEl.innerText = `${gameState.user.fullName} (${gameState.user.ftNumber})`;
    if (gameState.user.isAdmin) {
      if (adminTab) adminTab.style.display = 'inline-flex';
      if (adminControls) adminControls.style.display = 'flex';
    } else {
      if (adminTab) adminTab.style.display = 'none';
      if (adminControls) adminControls.style.display = 'none';
    }
  } else {
    if (badge) badge.style.display = 'none';
    if (adminTab) adminTab.style.display = 'none';
    if (adminControls) adminControls.style.display = 'none';
  }
}

// ==========================================================================
// SESSION & CASE MANAGEMENT
// ==========================================================================
function startSession() {
  gameState.score = 0;
  gameState.streak = 0;
  gameState.bestStreak = 0;
  gameState.currentIndex = 0;
  gameState.answered = false;

  let allCases = (typeof CASES_DATA !== 'undefined') ? CASES_DATA.slice() : [];
  if (gameState.activeTrack !== 'all') {
    allCases = allCases.filter(c => c.track === gameState.activeTrack);
  }

  gameState.filteredCases = shuffleArray(allCases);
  updateHeaderStats();
  loadCase(0);
}

function setTrack(track, btnEl) {
  sound.click();
  gameState.activeTrack = track;
  document.querySelectorAll('.track-pill').forEach(p => p.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
  startSession();
}

function loadCase(index) {
  if (!gameState.filteredCases || gameState.filteredCases.length === 0) return;
  if (index >= gameState.filteredCases.length) {
    showResults();
    return;
  }

  gameState.currentIndex = index;
  gameState.answered = false;
  updateHeaderStats();

  const c = gameState.filteredCases[index];
  if (!c) return;

  // Dynamically shuffle options and re-letter them A, B, C, D on each run to prevent any pattern
  if (c.options && c.options.length > 0) {
    const letters = ['A', 'B', 'C', 'D'];
    const shuffled = shuffleArray(c.options.slice());
    shuffled.forEach((opt, idx) => {
      opt.id = letters[idx] || String.fromCharCode(65 + idx);
    });
    c.options = shuffled;
  }

  // Resolve active framework ID
  let fwObj = null;
  if (typeof FRAMEWORKS !== 'undefined') {
    const corrOpt = (c.options && c.options.find(o => o.isCorrect)) || (c.options && c.options[0]);
    const slug = (corrOpt && corrOpt.frameworkSlug) || '';
    fwObj = FRAMEWORKS.find(f => f.title.toLowerCase() === slug.toLowerCase() || f.slug.toLowerCase() === slug.toLowerCase() || f.title.toLowerCase().includes(slug.toLowerCase())) || FRAMEWORKS[0];
  }
  gameState.activeFrameworkId = fwObj ? fwObj.id : 1;

  // Progress
  const total = gameState.filteredCases.length;
  const curr = index + 1;
  const pct = Math.round((curr / total) * 100);

  const progText = document.getElementById('progressText');
  const progPct = document.getElementById('progressPercent');
  const progFill = document.getElementById('progressBarFill');

  if (progText) progText.innerText = `Case ${curr} of ${total}`;
  if (progPct) progPct.innerText = `${pct}%`;
  if (progFill) progFill.style.width = `${pct}%`;

  // Badges & Scenario
  const sectorBadge = document.getElementById('caseSectorBadge');
  const compBadge = document.getElementById('caseCompanyBadge');
  const titleEl = document.getElementById('caseTitle');
  const contextEl = document.getElementById('caseContext');
  const promptEl = document.getElementById('questionPrompt');

  if (sectorBadge) sectorBadge.innerText = c.sector || 'Corporate Strategy';
  if (compBadge) compBadge.innerText = c.company || 'Enterprise Dilemma';
  if (titleEl) titleEl.innerText = c.title;
  if (contextEl) contextEl.innerText = `"${c.context}"`;
  if (promptEl) promptEl.innerText = c.prompt;

  // Options
  const optContainer = document.getElementById('optionsContainer');
  if (optContainer) {
    optContainer.innerHTML = c.options.map(opt => `
      <button class="option-btn" data-id="${opt.id}" onclick="selectOption('${opt.id}')">
        <span class="option-letter">${opt.id}</span>
        <span class="option-text">${opt.text}</span>
      </button>
    `).join('');
  }

  // Hide Feedback Card
  const fb = document.getElementById('feedbackCard');
  if (fb) fb.classList.remove('active');
}

function selectOption(optId) {
  if (gameState.answered) return;
  gameState.answered = true;

  const c = gameState.filteredCases[gameState.currentIndex];
  if (!c) return;

  const chosenOpt = c.options.find(o => o.id === optId);
  const correctOpt = c.options.find(o => o.isCorrect) || c.options[0];
  const isCorrect = chosenOpt && chosenOpt.isCorrect;

  // Highlight options
  document.querySelectorAll('.option-btn').forEach(btn => {
    btn.classList.add('disabled');
    const id = btn.dataset.id;
    if (id === correctOpt.id) {
      btn.classList.add('correct');
    } else if (id === optId && !isCorrect) {
      btn.classList.add('wrong');
    }
  });

  // Update Score & Streak
  if (isCorrect) {
    sound.correct();
    gameState.score++;
    gameState.streak++;
    if (gameState.streak > gameState.bestStreak) {
      gameState.bestStreak = gameState.streak;
    }
  } else {
    sound.wrong();
    gameState.streak = 0;
  }

  updateHeaderStats();
  saveParticipantScore(false);

  // Authoritative Canonical Framework Resolution (Guarantees 100% correct debrief on both right & wrong answers)
  let fwObj = null;
  if (typeof FRAMEWORKS !== 'undefined') {
    fwObj = FRAMEWORKS.find(f => f.id === gameState.activeFrameworkId) ||
            FRAMEWORKS.find(f => f.title.toLowerCase() === (correctOpt.frameworkSlug || '').toLowerCase() || f.slug.toLowerCase() === (correctOpt.frameworkSlug || '').toLowerCase()) ||
            FRAMEWORKS[0];
  }

  const fwTitle = fwObj ? fwObj.title : (correctOpt.frameworkSlug || 'Strategic Framework');
  const fwBreakdown = fwObj ? `**${fwObj.title} (${fwObj.part})**: ${fwObj.desc}` : (correctOpt.frameworkBreakdown || '');
  const fwUtil = fwObj ? `How to read it. ${fwObj.schematic}` : (correctOpt.frameworkUtilization || '');
  const fwTrap = fwObj ? `**Boundary Trap & Novice Anti-Pattern**: ${fwObj.when_not}` : (correctOpt.boundaryTrap || '');

  // Populate Fluid Debrief Card (Matching Netlify)
  const fb = document.getElementById('feedbackCard');
  const fbIcon = document.getElementById('feedbackIcon');
  const fbTitle = document.getElementById('feedbackTitle');
  const fbSubtitle = document.getElementById('feedbackSubtitle');
  const streakNotice = document.getElementById('streakBonusNotice');

  if (isCorrect) {
    if (fbIcon) fbIcon.innerText = "✅";
    if (fbTitle) {
      fbTitle.innerText = "Top-Tier Strategic Recommendation!";
      fbTitle.style.color = "var(--emerald-light)";
    }
    if (fbSubtitle) fbSubtitle.innerText = `Governing Framework: ${fwTitle}`;
    if (streakNotice) streakNotice.innerText = `+100 Points • Streak: ${gameState.streak} 🔥`;
  } else {
    if (fbIcon) fbIcon.innerText = "❌";
    if (fbTitle) {
      fbTitle.innerText = `Suboptimal Recommendation. Best Move: Option ${correctOpt.id}`;
      fbTitle.style.color = "var(--crimson-light)";
    }
    if (fbSubtitle) fbSubtitle.innerText = `Governing Framework: ${fwTitle}`;
    if (streakNotice) streakNotice.innerText = "Streak reset. Review the consultant justification and framework theory below!";
  }

  const justEl = document.getElementById('feedbackJustification');
  const fwEl = document.getElementById('feedbackFramework');
  const utilEl = document.getElementById('feedbackUtilization');
  const trapEl = document.getElementById('feedbackTrap');

  if (justEl) justEl.innerHTML = parseMarkdown(correctOpt.justification || 'The chosen strategic move aligns market evidence, unit economics, and competitive advantage.');
  if (fwEl) fwEl.innerHTML = parseMarkdown(fwBreakdown);
  if (utilEl) utilEl.innerHTML = `<strong>Step-by-Step Framework Utilization:</strong> ` + parseMarkdown(fwUtil);
  if (trapEl) trapEl.innerHTML = parseMarkdown(fwTrap);

  if (fb) fb.classList.add('active');
}

function nextQuestion() {
  sound.click();
  loadCase(gameState.currentIndex + 1);
}

function updateHeaderStats() {
  const scoreEl = document.getElementById('headerScore');
  const streakEl = document.getElementById('headerStreak');
  const attempted = gameState.currentIndex + (gameState.answered ? 1 : 0);

  if (scoreEl) scoreEl.innerText = `${gameState.score} / ${attempted}`;
  if (streakEl) streakEl.innerText = `${gameState.streak} Streak`;
}

// ==========================================================================
// RESULTS & LEADERBOARD
// ==========================================================================
function showResults() {
  const total = gameState.filteredCases.length || 1;
  const correct = gameState.score;
  const pct = Math.round((correct / total) * 100);

  const dialVal = document.getElementById('finalScoreVal');
  const dialPct = document.getElementById('finalPercentVal');
  const bestStreakEl = document.getElementById('finalBestStreak');
  const countEl = document.getElementById('finalMasteredCount');
  const candName = document.getElementById('resultsCandidateName');
  const candFt = document.getElementById('resultsCandidateFt');

  if (dialVal) dialVal.innerText = `${correct} / ${total}`;
  if (dialPct) dialPct.innerText = `${pct}% Strategic Precision`;
  if (bestStreakEl) bestStreakEl.innerText = `${gameState.bestStreak} in a row`;
  if (countEl) countEl.innerText = `${correct} / ${total} Cases`;
  if (candName) candName.innerText = gameState.user ? gameState.user.fullName : 'Candidate';
  if (candFt) candFt.innerText = gameState.user ? gameState.user.ftNumber : 'FT000000';

  saveParticipantScore(true);
  switchMainView('results');
}

function restartQuiz() {
  sound.click();
  switchMainView('quiz');
  startSession();
}


// ==========================================================================
// CLOUD LEADERBOARD SYNC (Google Sheets Webhook Engine)
// ==========================================================================
let isCloudSyncing = false;

async function syncLeaderboardWithCloud() {
  if (!APP_CONFIG.googleAppsScriptUrl || isCloudSyncing) return;
  isCloudSyncing = true;
  updateCloudSyncStatus('syncing');

  try {
    const res = await fetch(APP_CONFIG.googleAppsScriptUrl);
    if (!res.ok) throw new Error('Network error');
    const json = await res.json();
    if (json && json.status === 'success' && Array.isArray(json.data)) {
      let cloudRecords = json.data;

      // If active candidate is currently logged in, ensure their active progress takes precedence
      if (gameState.user) {
        const activeFt = gameState.user.ftNumber.toUpperCase();
        const activeAttempted = gameState.currentIndex + (gameState.answered ? 1 : 0);
        if (activeAttempted > 0) {
          const activeIndex = cloudRecords.findIndex(r => r.ftNumber.toUpperCase() === activeFt);
          const activeRecord = {
            ftNumber: activeFt,
            fullName: gameState.user.fullName,
            correct: gameState.score,
            attempted: activeAttempted,
            scoreRatio: `${gameState.score} / ${activeAttempted}`,
            accuracy: `${Math.round((gameState.score / activeAttempted) * 100)}%`,
            bestStreak: Math.max(gameState.bestStreak, activeIndex >= 0 ? (cloudRecords[activeIndex].bestStreak || 0) : 0),
            date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
          };
          if (activeIndex >= 0) {
            cloudRecords[activeIndex] = activeRecord;
          } else {
            cloudRecords.push(activeRecord);
          }
        }
      }

      cloudRecords.sort((a, b) => {
        const rB = b.attempted > 0 ? (b.correct / b.attempted) : 0;
        const rA = a.attempted > 0 ? (a.correct / a.attempted) : 0;
        if (rB !== rA) return rB - rA;
        return (b.correct || 0) - (a.correct || 0);
      });

      SafeStorage.setItem(APP_CONFIG.storageKeyLeaderboard, JSON.stringify(cloudRecords));
      renderAdminTable();
      updateCloudSyncStatus('connected');
    } else {
      updateCloudSyncStatus('error');
    }
  } catch (err) {
    console.warn('Cloud sync error (using local fallback):', err);
    updateCloudSyncStatus('offline');
  } finally {
    isCloudSyncing = false;
  }
}

async function pushScoreToCloud(scoreRecord) {
  if (!APP_CONFIG.googleAppsScriptUrl || !scoreRecord) return;
  try {
    updateCloudSyncStatus('syncing');
    await fetch(APP_CONFIG.googleAppsScriptUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(scoreRecord)
    });
    updateCloudSyncStatus('connected');
  } catch (err) {
    console.warn('Failed to push score to Google Sheet:', err);
    updateCloudSyncStatus('offline');
  }
}

function updateCloudSyncStatus(status) {
  const syncBadge = document.getElementById('cloudSyncStatusBadge');
  if (!syncBadge) return;

  if (!APP_CONFIG.googleAppsScriptUrl) {
    syncBadge.style.display = 'none';
    return;
  }

  syncBadge.style.display = 'inline-flex';
  if (status === 'syncing') {
    syncBadge.innerHTML = '🔄 <span style="font-size:0.75rem; margin-left:4px;">Syncing with Sheet...</span>';
    syncBadge.style.color = 'var(--gold-light)';
    syncBadge.style.borderColor = 'var(--gold-primary)';
  } else if (status === 'connected') {
    syncBadge.innerHTML = '🟢 <span style="font-size:0.75rem; margin-left:4px;">Live Sheet Synced</span>';
    syncBadge.style.color = '#34d399';
    syncBadge.style.borderColor = 'var(--emerald-primary)';
  } else {
    syncBadge.innerHTML = '⚪ <span style="font-size:0.75rem; margin-left:4px;">Local Mode</span>';
    syncBadge.style.color = 'var(--text-muted)';
    syncBadge.style.borderColor = 'var(--border-color)';
  }
}

function getLeaderboard() {
  const raw = SafeStorage.getItem(APP_CONFIG.storageKeyLeaderboard);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function saveParticipantScore(forceSave = false) {
  if (!gameState.user) return;
  const attempted = gameState.currentIndex + (gameState.answered ? 1 : 0);
  if (attempted === 0 && !forceSave) return;

  saveUserSession();

  const records = getLeaderboard();
  const ft = gameState.user.ftNumber.toUpperCase();
  const name = gameState.user.fullName;
  const ratio = attempted > 0 ? (gameState.score / attempted) : 0;
  const pct = Math.round(ratio * 100);

  let existingIndex = records.findIndex(r => r.ftNumber.toUpperCase() === ft);

  if (existingIndex >= 0) {
    records[existingIndex] = {
      ftNumber: ft,
      fullName: name,
      correct: gameState.score,
      attempted: attempted,
      scoreRatio: `${gameState.score} / ${attempted}`,
      accuracy: `${pct}%`,
      bestStreak: Math.max(gameState.bestStreak, records[existingIndex].bestStreak || 0),
      date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    };
  } else if (attempted > 0) {
    records.push({
      ftNumber: ft,
      fullName: name,
      correct: gameState.score,
      attempted: attempted,
      scoreRatio: `${gameState.score} / ${attempted}`,
      accuracy: `${pct}%`,
      bestStreak: gameState.bestStreak,
      date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    });
  }

  records.sort((a, b) => {
    const rB = b.attempted > 0 ? (b.correct / b.attempted) : 0;
    const rA = a.attempted > 0 ? (a.correct / a.attempted) : 0;
    if (rB !== rA) return rB - rA;
    return (b.correct || 0) - (a.correct || 0);
  });

  SafeStorage.setItem(APP_CONFIG.storageKeyLeaderboard, JSON.stringify(records));
  renderAdminTable();
  
  // Push live update to Google Sheets cloud database
  const activeRecord = records.find(r => r.ftNumber.toUpperCase() === ft);
  if (activeRecord) {
    pushScoreToCloud(activeRecord);
  }
}

function renderAdminTable(filterText = '') {
  const tbody = document.getElementById('adminTableBody');
  if (!tbody) return;

  const records = getLeaderboard();
  let list = records;
  if (filterText) {
    const q = filterText.toLowerCase();
    list = records.filter(r => 
      r.fullName.toLowerCase().includes(q) || 
      r.ftNumber.toLowerCase().includes(q)
    );
  }

  tbody.innerHTML = '';
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 2.5rem; color: var(--text-muted);">No candidate records logged yet. Complete a case simulation to record your score!</td></tr>`;
    return;
  }

  list.forEach((r, idx) => {
    const isCurrent = gameState.user && gameState.user.ftNumber.toUpperCase() === r.ftNumber.toUpperCase();
    const tr = document.createElement('tr');
    if (isCurrent) tr.style.backgroundColor = 'rgba(6, 182, 212, 0.1)';

    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td style="font-weight: 600; color: #fff;">${r.fullName} ${isCurrent ? '<span style="color:var(--gold-light); font-size:0.75rem;">(You)</span>' : ''}</td>
      <td><span style="font-family: var(--font-mono); color: var(--gold-light);">${r.ftNumber}</span></td>
      <td><strong style="color: var(--cyan-light); font-family: var(--font-mono);">${r.scoreRatio || `${r.correct}/${r.attempted}`}</strong></td>
      <td style="font-weight: 700; color: #34d399;">${r.accuracy || '100%'}</td>
      <td>🔥 ${r.bestStreak || 0}</td>
      <td style="font-size: 0.75rem; color: var(--text-muted);">${r.date || 'Recent'}</td>
    `;
    tbody.appendChild(tr);
  });
}

function filterAdminTable(term) {
  renderAdminTable(term);
}

function exportScoresCSV() {
  sound.click();
  const records = getLeaderboard();
  if (!records || records.length === 0) {
    alert('No candidate records available to export.');
    return;
  }

  const headers = ['Rank', 'Candidate Name', 'FT Number', 'Score Ratio', 'Correct', 'Attempted', 'Accuracy', 'Best Streak', 'Date & Time'];
  
  const csvRows = [headers.join(',')];

  records.forEach((r, idx) => {
    const row = [
      idx + 1,
      `"${(r.fullName || '').replace(/"/g, '""')}"`,
      `"${(r.ftNumber || '').replace(/"/g, '""')}"`,
      `"${(r.scoreRatio || `${r.correct || 0}/${r.attempted || 0}`).replace(/"/g, '""')}"`,
      r.correct || 0,
      r.attempted || 0,
      `"${(r.accuracy || '0%').replace(/"/g, '""')}"`,
      r.bestStreak || 0,
      `"${(r.date || '').replace(/"/g, '""')}"`
    ];
    csvRows.push(row.join(','));
  });

  const csvContent = '\uFEFF' + csvRows.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const dateStr = new Date().toISOString().slice(0, 10);
  a.download = `Strategy_Boardroom_Leaderboard_${dateStr}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportScores() {
  const records = getLeaderboard();
  const blob = new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Strategy_Boardroom_Leaderboard_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
}

async function clearScores() {
  sound.click();
  if (confirm('Clear all candidate records from leaderboard database and Google Sheet?')) {
    SafeStorage.removeItem(APP_CONFIG.storageKeyLeaderboard);
    
    // Reset active user session
    if (gameState.user) {
      SafeStorage.removeItem(getUserSessionKey(gameState.user.ftNumber));
    }
    gameState.score = 0;
    gameState.streak = 0;
    gameState.bestStreak = 0;
    gameState.currentIndex = 0;
    gameState.answered = false;
    updateHeaderStats();
    renderAdminTable();

    // Send clearAll signal to Google Sheets
    if (APP_CONFIG.googleAppsScriptUrl) {
      updateCloudSyncStatus('syncing');
      try {
        await fetch(APP_CONFIG.googleAppsScriptUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'clearAll' })
        });
        updateCloudSyncStatus('connected');
        showToast('Leaderboard and Google Sheet reset successfully!', '🗑️');
      } catch (err) {
        console.warn('Failed to clear Google Sheet:', err);
      }
    }
  }
}

// ==========================================================================
// 27 FRAMEWORKS ARSENAL & BLUEPRINT MODAL (REAL KARPATHY WIKI DATA)
// ==========================================================================
function renderLibrary() {
  const container = document.getElementById('libraryGrid');
  if (!container || typeof FRAMEWORKS === 'undefined') return;

  container.innerHTML = FRAMEWORKS.map(fw => `
    <div class="library-card" onclick="openFrameworkModalById(${fw.id})">
      <div>
        <div class="library-card-part">${fw.part}</div>
        <div class="library-card-title">${fw.title.split('(')[0]}</div>
        <div class="library-card-subtitle">${fw.subtitle}</div>
      </div>
      <div style="margin-top: 1rem; border-top: 1px solid var(--border-color); padding-top: 0.5rem; font-size: 0.75rem; color: var(--cyan-light);">
        View Theory Blueprint ▶
      </div>
    </div>
  `).join('');
}

function filterLibrary(term) {
  const q = (term || '').toLowerCase();
  document.querySelectorAll('.library-card').forEach(card => {
    const text = card.innerText.toLowerCase();
    card.style.display = text.includes(q) ? 'flex' : 'none';
  });
}

function openActiveFrameworkModal() {
  openFrameworkModalById(gameState.activeFrameworkId);
}

function openFrameworkModalById(fwId) {
  sound.click();
  if (typeof FRAMEWORKS === 'undefined') return;
  const fw = FRAMEWORKS.find(f => f.id === fwId || f.slug === fwId) || FRAMEWORKS[0];
  if (!fw) return;

  const titleEl = document.getElementById('modalTitle');
  const subEl = document.getElementById('modalSubtitle');
  const descEl = document.getElementById('modalDesc');
  const schEl = document.getElementById('modalSchematic');
  const useEl = document.getElementById('modalWhenUse');
  const notEl = document.getElementById('modalWhenNot');
  const srcEl = document.getElementById('modalSources');

  if (titleEl) titleEl.innerText = fw.title;
  if (subEl) subEl.innerText = `${fw.part} • ${fw.subtitle}`;
  if (descEl) descEl.innerText = fw.desc;
  if (schEl) schEl.innerHTML = renderFrameworkVisual(fw);
  if (useEl) useEl.innerHTML = parseMarkdown(fw.when_use);
  if (notEl) notEl.innerHTML = parseMarkdown(fw.when_not);
  if (srcEl) srcEl.innerHTML = parseMarkdown(fw.sources);

  const overlay = document.getElementById('frameworkModalOverlay');
  if (overlay) overlay.classList.add('active');
}

function closeFrameworkModal() {
  const overlay = document.getElementById('frameworkModalOverlay');
  if (overlay) overlay.classList.remove('active');
}

function renderFrameworkVisual(fw) {
  if (!fw) return '';
  const fid = fw.id;
  let visualHtml = '';

  switch (fid) {
    case 1: // RISE Framework
      visualHtml = `
        <div class="fw-flow-container" style="max-width: 540px;">
          <div class="fw-flow-step" style="border-top: 3px solid var(--cyan-primary);">
            <div class="fw-cell-title" style="color: var(--cyan-light);">1. Research</div>
            <div class="fw-cell-desc">Evidence & Data</div>
          </div>
          <div class="fw-flow-arrow">→</div>
          <div class="fw-flow-step" style="border-top: 3px solid var(--gold-primary);">
            <div class="fw-cell-title" style="color: var(--gold-light);">2. Insight</div>
            <div class="fw-cell-desc">Non-Obvious 'Why'</div>
          </div>
          <div class="fw-flow-arrow">→</div>
          <div class="fw-flow-step" style="border-top: 3px solid var(--emerald-primary);">
            <div class="fw-cell-title" style="color: var(--emerald-light);">3. Strategy</div>
            <div class="fw-cell-desc">Choice & Trade-offs</div>
          </div>
          <div class="fw-flow-arrow">→</div>
          <div class="fw-flow-step" style="border-top: 3px solid var(--crimson-primary);">
            <div class="fw-cell-title" style="color: var(--crimson-light);">4. Execution</div>
            <div class="fw-cell-desc">Action & Feedback</div>
          </div>
        </div>
        <div style="margin-top: 0.5rem; font-size: 0.72rem; color: var(--gold-light); text-align: center;">
          ⚡ Gate Rules: 'So what?' (after Research) • 'Which choices?' (after Insight) • 'On brief?' (after Strategy)
        </div>
      `;
      break;

    case 2: // PESTEL Analysis
      visualHtml = `
        <div class="fw-grid-2x2" style="grid-template-columns: repeat(3, 1fr); max-width: 520px; gap: 6px;">
          <div class="fw-grid-cell" style="padding: 8px 6px;">
            <div class="fw-cell-title" style="color: #38bdf8; font-size: 0.75rem;">🏛️ Political</div>
            <div class="fw-cell-desc" style="font-size: 0.62rem;">Tariffs, Subsidies, Geopolitics</div>
          </div>
          <div class="fw-grid-cell" style="padding: 8px 6px;">
            <div class="fw-cell-title" style="color: #34d399; font-size: 0.75rem;">📈 Economic</div>
            <div class="fw-cell-desc" style="font-size: 0.62rem;">Inflation, FX, Interest Rates</div>
          </div>
          <div class="fw-grid-cell" style="padding: 8px 6px;">
            <div class="fw-cell-title" style="color: #fbbf24; font-size: 0.75rem;">👥 Social</div>
            <div class="fw-cell-desc" style="font-size: 0.62rem;">Demographics, Cultural Shifts</div>
          </div>
          <div class="fw-grid-cell" style="padding: 8px 6px;">
            <div class="fw-cell-title" style="color: #a78bfa; font-size: 0.75rem;">💻 Technological</div>
            <div class="fw-cell-desc" style="font-size: 0.62rem;">AI, Automation, R&D Shifts</div>
          </div>
          <div class="fw-grid-cell" style="padding: 8px 6px;">
            <div class="fw-cell-title" style="color: #4ade80; font-size: 0.75rem;">🌱 Environmental</div>
            <div class="fw-cell-desc" style="font-size: 0.62rem;">ESG, Climate, Carbon Costs</div>
          </div>
          <div class="fw-grid-cell" style="padding: 8px 6px;">
            <div class="fw-cell-title" style="color: #f43f5e; font-size: 0.75rem;">⚖️ Legal</div>
            <div class="fw-cell-desc" style="font-size: 0.62rem;">Antitrust, Labor, IP Laws</div>
          </div>
        </div>
      `;
      break;

    case 3: // SWOT Analysis
      visualHtml = `
        <div class="fw-grid-2x2" style="max-width: 520px; gap: 6px;">
          <div class="fw-grid-cell" style="border-left: 3px solid var(--emerald-primary);">
            <div class="fw-cell-title" style="color: var(--emerald-light);">S — Strengths (Internal)</div>
            <div class="fw-cell-desc">Proprietary IP, low-cost assets, brand equity</div>
          </div>
          <div class="fw-grid-cell" style="border-left: 3px solid var(--crimson-primary);">
            <div class="fw-cell-title" style="color: var(--crimson-light);">W — Weaknesses (Internal)</div>
            <div class="fw-cell-desc">High debt, legacy tech, talent deficits</div>
          </div>
          <div class="fw-grid-cell" style="border-left: 3px solid var(--cyan-primary);">
            <div class="fw-cell-title" style="color: var(--cyan-light);">O — Opportunities (External)</div>
            <div class="fw-cell-desc">Unserved niches, regulatory tailwinds, tech shifts</div>
          </div>
          <div class="fw-grid-cell" style="border-left: 3px solid var(--gold-primary);">
            <div class="fw-cell-title" style="color: var(--gold-light);">T — Threats (External)</div>
            <div class="fw-cell-desc">Price wars, substitute entrants, supply crunches</div>
          </div>
        </div>
      `;
      break;

    case 4: // Porter's Five Forces
      visualHtml = `
        <div style="display: flex; flex-direction: column; align-items: center; width: 100%; max-width: 480px; gap: 6px;">
          <div style="background: rgba(6,182,212,0.1); border: 1px solid var(--cyan-primary); padding: 6px 12px; border-radius: 4px; font-size: 0.72rem; color: var(--cyan-light);">
            ⬆️ Threat of New Entrants (Barriers to Entry, Capital)
          </div>
          <div style="display: flex; justify-content: space-between; width: 100%; gap: 6px;">
            <div style="flex: 1; background: rgba(245,158,11,0.1); border: 1px solid var(--gold-primary); padding: 8px 6px; border-radius: 4px; font-size: 0.68rem; color: var(--gold-light); text-align: center;">
              ⬅️ Supplier Power<br><span style="font-size: 0.58rem; color: #94a3b8;">Concentration, Switching Costs</span>
            </div>
            <div style="flex: 1.2; background: rgba(244,63,94,0.15); border: 2px solid var(--crimson-primary); padding: 8px 6px; border-radius: 4px; font-size: 0.75rem; font-weight: bold; color: var(--crimson-light); text-align: center;">
              ⚡ Competitive Rivalry<br><span style="font-size: 0.6rem; font-weight: normal; color: #f8fafc;">Price wars, Capacity</span>
            </div>
            <div style="flex: 1; background: rgba(16,185,129,0.1); border: 1px solid var(--emerald-primary); padding: 8px 6px; border-radius: 4px; font-size: 0.68rem; color: var(--emerald-light); text-align: center;">
              Buyer Power ➡️<br><span style="font-size: 0.58rem; color: #94a3b8;">Price Sensitivity, Volume</span>
            </div>
          </div>
          <div style="background: rgba(6,182,212,0.1); border: 1px solid var(--cyan-primary); padding: 6px 12px; border-radius: 4px; font-size: 0.72rem; color: var(--cyan-light);">
            ⬇️ Threat of Substitutes (Cross-Elasticity, Alternatives)
          </div>
        </div>
      `;
      break;

    case 5: // Value Chain Analysis (Porter)
      visualHtml = `
        <div style="display: flex; flex-direction: column; width: 100%; max-width: 520px; gap: 4px; font-size: 0.68rem;">
          <div style="background: rgba(255,255,255,0.03); border: 1px dashed var(--border-color); padding: 6px; border-radius: 4px; color: var(--text-muted);">
            🛠️ <strong>Support Activities:</strong> Firm Infrastructure • HR Management • Technology Development • Procurement
          </div>
          <div style="display: flex; gap: 4px; align-items: stretch;">
            <div style="flex: 1; background: rgba(6,182,212,0.1); border: 1px solid var(--cyan-primary); padding: 8px 4px; text-align: center; border-radius: 4px; color: var(--cyan-light);">
              Inbound<br>Logistics
            </div>
            <div style="flex: 1; background: rgba(6,182,212,0.1); border: 1px solid var(--cyan-primary); padding: 8px 4px; text-align: center; border-radius: 4px; color: var(--cyan-light);">
              Operations
            </div>
            <div style="flex: 1; background: rgba(6,182,212,0.1); border: 1px solid var(--cyan-primary); padding: 8px 4px; text-align: center; border-radius: 4px; color: var(--cyan-light);">
              Outbound<br>Logistics
            </div>
            <div style="flex: 1; background: rgba(6,182,212,0.1); border: 1px solid var(--cyan-primary); padding: 8px 4px; text-align: center; border-radius: 4px; color: var(--cyan-light);">
              Marketing<br>& Sales
            </div>
            <div style="flex: 1; background: rgba(6,182,212,0.1); border: 1px solid var(--cyan-primary); padding: 8px 4px; text-align: center; border-radius: 4px; color: var(--cyan-light);">
              Service
            </div>
            <div style="width: 54px; background: rgba(245,158,11,0.2); border: 2px solid var(--gold-primary); display: flex; align-items: center; justify-content: center; font-weight: bold; color: var(--gold-light); border-radius: 4px; writing-mode: vertical-lr; text-orientation: mixed; font-size: 0.65rem;">
              MARGIN
            </div>
          </div>
        </div>
      `;
      break;

    case 6: // Porter's Generic Strategies
      visualHtml = `
        <div class="fw-grid-2x2" style="max-width: 520px; gap: 6px;">
          <div class="fw-grid-cell" style="border: 2px solid var(--cyan-primary); background: rgba(6,182,212,0.06);">
            <div class="fw-cell-title" style="color: var(--cyan-light);">Cost Leadership (Broad)</div>
            <div class="fw-cell-desc">Lowest operational cost structure across entire industry (e.g., IndiGo, Walmart)</div>
          </div>
          <div class="fw-grid-cell" style="border: 2px solid var(--gold-primary); background: rgba(245,158,11,0.06);">
            <div class="fw-cell-title" style="color: var(--gold-light);">Differentiation (Broad)</div>
            <div class="fw-cell-desc">Unique perceived value commanding industry-wide price premium (e.g., Apple)</div>
          </div>
          <div class="fw-grid-cell" style="border-left: 3px solid var(--cyan-primary);">
            <div class="fw-cell-title" style="color: var(--cyan-light);">Cost Focus (Narrow)</div>
            <div class="fw-cell-desc">Cost optimization tailored strictly to a dedicated niche market</div>
          </div>
          <div class="fw-grid-cell" style="border-left: 3px solid var(--gold-primary);">
            <div class="fw-cell-title" style="color: var(--gold-light);">Differentiation Focus (Narrow)</div>
            <div class="fw-cell-desc">High-customization / ultra-luxury for dedicated niche (e.g., Rolex, Shouldice)</div>
          </div>
        </div>
        <div style="margin-top: 0.5rem; font-size: 0.72rem; color: var(--crimson-light); text-align: center;">
          ⚠️ Trap: <strong>Stuck in the Middle</strong> (Pursuing both cost and differentiation without commitment)
        </div>
      `;
      break;

    case 7: // VRIO Framework
      visualHtml = `
        <div class="fw-flow-container" style="max-width: 540px;">
          <div class="fw-flow-step" style="border-top: 3px solid #38bdf8;">
            <div class="fw-cell-title" style="font-size: 0.75rem;">1. Valuable?</div>
            <div class="fw-cell-desc">No = Disadvantage</div>
          </div>
          <div class="fw-flow-arrow">→</div>
          <div class="fw-flow-step" style="border-top: 3px solid #fbbf24;">
            <div class="fw-cell-title" style="font-size: 0.75rem;">2. Rare?</div>
            <div class="fw-cell-desc">No = Parity</div>
          </div>
          <div class="fw-flow-arrow">→</div>
          <div class="fw-flow-step" style="border-top: 3px solid #f472b6;">
            <div class="fw-cell-title" style="font-size: 0.75rem;">3. Inimitable?</div>
            <div class="fw-cell-desc">No = Temp Advantage</div>
          </div>
          <div class="fw-flow-arrow">→</div>
          <div class="fw-flow-step" style="border-top: 3px solid #34d399;">
            <div class="fw-cell-title" style="font-size: 0.75rem;">4. Organised?</div>
            <div class="fw-cell-desc" style="color: var(--emerald-light); font-weight: bold;">Yes = Sustained Moat</div>
          </div>
        </div>
      `;
      break;

    case 8: // Core Competence (Prahalad & Hamel)
      visualHtml = `
        <div style="display: flex; flex-direction: column; align-items: center; width: 100%; max-width: 500px; gap: 6px;">
          <div style="background: rgba(16,185,129,0.1); border: 1px solid var(--emerald-primary); padding: 8px 12px; border-radius: 4px; text-align: center; width: 100%;">
            🍃 <strong>End Products:</strong> Consumer goods & distinct business unit offerings
          </div>
          <div style="font-size: 0.8rem; color: var(--gold-light);">⬆️ Derived From ⬆️</div>
          <div style="background: rgba(6,182,212,0.1); border: 1px solid var(--cyan-primary); padding: 8px 12px; border-radius: 4px; text-align: center; width: 100%;">
            🪵 <strong>Core Products:</strong> Physical sub-assemblies & platforms (e.g. Honda Engines, Canon Optics)
          </div>
          <div style="font-size: 0.8rem; color: var(--gold-light);">⬆️ Rooted In ⬆️</div>
          <div style="background: rgba(245,158,11,0.15); border: 2px solid var(--gold-primary); padding: 8px 12px; border-radius: 4px; text-align: center; width: 100%; color: var(--gold-light); font-weight: bold;">
            🌱 <strong>Core Competencies (The Roots):</strong> Collective cross-functional learning & hard-to-imitate mastery
          </div>
        </div>
      `;
      break;

    case 9: // BCG Growth–Share Matrix
      visualHtml = `
        <div class="fw-grid-2x2" style="max-width: 520px; gap: 6px;">
          <div class="fw-grid-cell" style="border: 2px solid var(--gold-primary); background: rgba(245,158,11,0.06);">
            <div class="fw-cell-title" style="color: var(--gold-light);">⭐ STARS (High Growth / High Share)</div>
            <div class="fw-cell-desc">Rapid expansion; reinvest heavy cash flows to defend market leadership</div>
          </div>
          <div class="fw-grid-cell" style="border: 2px solid var(--cyan-primary); background: rgba(6,182,212,0.06);">
            <div class="fw-cell-title" style="color: var(--cyan-light);">❓ QUESTION MARKS (High Growth / Low Share)</div>
            <div class="fw-cell-desc">High capital burn; selectively invest heavily to create a star or divest</div>
          </div>
          <div class="fw-grid-cell" style="border: 2px solid var(--emerald-primary); background: rgba(16,185,129,0.06);">
            <div class="fw-cell-title" style="color: var(--emerald-light);">🐄 CASH COWS (Low Growth / High Share)</div>
            <div class="fw-cell-desc">Mature cash generators; harvest dividends to fund emerging growth engines</div>
          </div>
          <div class="fw-grid-cell" style="border: 2px solid var(--crimson-primary); background: rgba(244,63,94,0.06);">
            <div class="fw-cell-title" style="color: var(--crimson-light);">🐕 DOGS (Low Growth / Low Share)</div>
            <div class="fw-cell-desc">Trapped capital; turnaround, divest, or harvest systematically</div>
          </div>
        </div>
      `;
      break;

    case 10: // GE–McKinsey Nine-Box Matrix
      visualHtml = `
        <div class="fw-grid-3x3" style="max-width: 520px; gap: 4px;">
          <div class="fw-grid-cell" style="background: rgba(16,185,129,0.2); border: 1px solid var(--emerald-primary); color: #34d399; font-weight: bold; font-size: 0.7rem; text-align: center;">GROW / INVEST</div>
          <div class="fw-grid-cell" style="background: rgba(16,185,129,0.2); border: 1px solid var(--emerald-primary); color: #34d399; font-weight: bold; font-size: 0.7rem; text-align: center;">GROW / INVEST</div>
          <div class="fw-grid-cell" style="background: rgba(245,158,11,0.15); border: 1px solid var(--gold-primary); color: #fbbf24; font-weight: bold; font-size: 0.7rem; text-align: center;">HOLD / SELECT</div>
          
          <div class="fw-grid-cell" style="background: rgba(16,185,129,0.2); border: 1px solid var(--emerald-primary); color: #34d399; font-weight: bold; font-size: 0.7rem; text-align: center;">GROW / INVEST</div>
          <div class="fw-grid-cell" style="background: rgba(245,158,11,0.15); border: 1px solid var(--gold-primary); color: #fbbf24; font-weight: bold; font-size: 0.7rem; text-align: center;">HOLD / SELECT</div>
          <div class="fw-grid-cell" style="background: rgba(244,63,94,0.15); border: 1px solid var(--crimson-primary); color: #f43f5e; font-weight: bold; font-size: 0.7rem; text-align: center;">HARVEST / EXIT</div>
          
          <div class="fw-grid-cell" style="background: rgba(245,158,11,0.15); border: 1px solid var(--gold-primary); color: #fbbf24; font-weight: bold; font-size: 0.7rem; text-align: center;">HOLD / SELECT</div>
          <div class="fw-grid-cell" style="background: rgba(244,63,94,0.15); border: 1px solid var(--crimson-primary); color: #f43f5e; font-weight: bold; font-size: 0.7rem; text-align: center;">HARVEST / EXIT</div>
          <div class="fw-grid-cell" style="background: rgba(244,63,94,0.15); border: 1px solid var(--crimson-primary); color: #f43f5e; font-weight: bold; font-size: 0.7rem; text-align: center;">HARVEST / EXIT</div>
        </div>
        <div style="margin-top: 0.4rem; font-size: 0.68rem; color: var(--text-muted); text-align: center;">
          Axes: Industry Attractiveness (Vertical) vs Business Unit Strength (Horizontal)
        </div>
      `;
      break;

    case 11: // Ansoff Matrix
      visualHtml = `
        <div class="fw-grid-2x2" style="max-width: 520px; gap: 6px;">
          <div class="fw-grid-cell" style="border-left: 3px solid var(--emerald-primary);">
            <div class="fw-cell-title" style="color: var(--emerald-light);">Market Penetration</div>
            <div class="fw-cell-desc">Existing Products in Existing Markets (Lowest Risk: pricing, promos, share capture)</div>
          </div>
          <div class="fw-grid-cell" style="border-left: 3px solid var(--cyan-primary);">
            <div class="fw-cell-title" style="color: var(--cyan-light);">Product Development</div>
            <div class="fw-cell-desc">New Products in Existing Markets (R&D, brand extensions, upgrades)</div>
          </div>
          <div class="fw-grid-cell" style="border-left: 3px solid var(--gold-primary);">
            <div class="fw-cell-title" style="color: var(--gold-light);">Market Development</div>
            <div class="fw-cell-desc">Existing Products in New Markets (Geographic expansion, new customer segments)</div>
          </div>
          <div class="fw-grid-cell" style="border: 2px solid var(--crimson-primary); background: rgba(244,63,94,0.06);">
            <div class="fw-cell-title" style="color: var(--crimson-light);">Diversification (Highest Risk)</div>
            <div class="fw-cell-desc">New Products in New Markets (Related synergies or unrelated conglomerates)</div>
          </div>
        </div>
      `;
      break;

    case 12: // RASCI Responsibility Matrix
      visualHtml = `
        <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; width: 100%; max-width: 520px; font-size: 0.65rem; text-align: center;">
          <div style="background: rgba(6,182,212,0.15); border: 1px solid var(--cyan-primary); padding: 8px 4px; border-radius: 4px;">
            <strong style="color: var(--cyan-light); font-size: 0.78rem;">R</strong><br>Responsible<br><span style="color: #94a3b8; font-size: 0.58rem;">Does the work</span>
          </div>
          <div style="background: rgba(245,158,11,0.2); border: 2px solid var(--gold-primary); padding: 8px 4px; border-radius: 4px;">
            <strong style="color: var(--gold-light); font-size: 0.78rem;">A</strong><br>Accountable<br><span style="color: #94a3b8; font-size: 0.58rem;">Single decision owner</span>
          </div>
          <div style="background: rgba(16,185,129,0.15); border: 1px solid var(--emerald-primary); padding: 8px 4px; border-radius: 4px;">
            <strong style="color: var(--emerald-light); font-size: 0.78rem;">S</strong><br>Support<br><span style="color: #94a3b8; font-size: 0.58rem;">Provides resources</span>
          </div>
          <div style="background: rgba(244,63,94,0.15); border: 1px solid var(--crimson-primary); padding: 8px 4px; border-radius: 4px;">
            <strong style="color: var(--crimson-light); font-size: 0.78rem;">C</strong><br>Consulted<br><span style="color: #94a3b8; font-size: 0.58rem;">Two-way expert input</span>
          </div>
          <div style="background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); padding: 8px 4px; border-radius: 4px;">
            <strong style="color: #cbd5e1; font-size: 0.78rem;">I</strong><br>Informed<br><span style="color: #94a3b8; font-size: 0.58rem;">One-way updates</span>
          </div>
        </div>
        <div style="margin-top: 0.5rem; font-size: 0.72rem; color: var(--gold-light); text-align: center;">
          ⚠️ Golden Rule: Exactly <strong>ONE Accountable ('A')</strong> per decision/task to avoid diffusion of responsibility.
        </div>
      `;
      break;

    case 13: // Marketing Mix: 4Ps / 7Ps
      visualHtml = `
        <div class="fw-grid-2x2" style="max-width: 520px; gap: 6px;">
          <div class="fw-grid-cell" style="border-left: 3px solid var(--cyan-primary);">
            <div class="fw-cell-title" style="color: var(--cyan-light);">1. Product</div>
            <div class="fw-cell-desc">Features, quality, branding, packaging, lifecycle</div>
          </div>
          <div class="fw-grid-cell" style="border-left: 3px solid var(--gold-primary);">
            <div class="fw-cell-title" style="color: var(--gold-light);">2. Price</div>
            <div class="fw-cell-desc">Skimming, penetration, discounting, perceived value</div>
          </div>
          <div class="fw-grid-cell" style="border-left: 3px solid var(--emerald-primary);">
            <div class="fw-cell-title" style="color: var(--emerald-light);">3. Place</div>
            <div class="fw-cell-desc">Distribution channels, direct vs indirect, logistics</div>
          </div>
          <div class="fw-grid-cell" style="border-left: 3px solid var(--crimson-primary);">
            <div class="fw-cell-title" style="color: var(--crimson-light);">4. Promotion</div>
            <div class="fw-cell-desc">Advertising, PR, sales promo, performance digital</div>
          </div>
        </div>
        <div style="margin-top: 0.5rem; font-size: 0.7rem; color: var(--text-muted); text-align: center;">
          ➕ Services 7Ps Extension: <strong>People</strong> (Staff) • <strong>Process</strong> (Service Delivery) • <strong>Physical Evidence</strong> (Environment)
        </div>
      `;
      break;

    case 14: // 4Cs: The Customer-Centric Mix (Lauterborn)
      visualHtml = `
        <div style="display: flex; flex-direction: column; width: 100%; max-width: 520px; gap: 6px;">
          <div style="display: grid; grid-template-columns: 1fr auto 1fr; gap: 8px; align-items: center; background: rgba(6,182,212,0.06); border: 1px solid var(--cyan-glow); padding: 6px 12px; border-radius: 4px;">
            <div style="font-size: 0.75rem; color: var(--text-secondary); text-align: right;">📦 Product (Seller Frame)</div>
            <div style="color: var(--cyan-light); font-weight: bold;">➔</div>
            <div style="font-size: 0.78rem; font-weight: bold; color: var(--cyan-light);">💎 Customer Value & Solution</div>
          </div>
          <div style="display: grid; grid-template-columns: 1fr auto 1fr; gap: 8px; align-items: center; background: rgba(245,158,11,0.06); border: 1px solid var(--gold-glow); padding: 6px 12px; border-radius: 4px;">
            <div style="font-size: 0.75rem; color: var(--text-secondary); text-align: right;">🏷️ Price (Seller Frame)</div>
            <div style="color: var(--gold-light); font-weight: bold;">➔</div>
            <div style="font-size: 0.78rem; font-weight: bold; color: var(--gold-light);">💰 Cost to Satisfy & Total TCO</div>
          </div>
          <div style="display: grid; grid-template-columns: 1fr auto 1fr; gap: 8px; align-items: center; background: rgba(16,185,129,0.06); border: 1px solid var(--emerald-glow); padding: 6px 12px; border-radius: 4px;">
            <div style="font-size: 0.75rem; color: var(--text-secondary); text-align: right;">🚚 Place (Seller Frame)</div>
            <div style="color: var(--emerald-light); font-weight: bold;">➔</div>
            <div style="font-size: 0.78rem; font-weight: bold; color: var(--emerald-light);">⚡ Convenience to Buy & Access</div>
          </div>
          <div style="display: grid; grid-template-columns: 1fr auto 1fr; gap: 8px; align-items: center; background: rgba(244,63,94,0.06); border: 1px solid var(--crimson-glow); padding: 6px 12px; border-radius: 4px;">
            <div style="font-size: 0.75rem; color: var(--text-secondary); text-align: right;">📢 Promotion (Seller Frame)</div>
            <div style="color: var(--crimson-light); font-weight: bold;">➔</div>
            <div style="font-size: 0.78rem; font-weight: bold; color: var(--crimson-light);">💬 Two-Way Communication & Dialogue</div>
          </div>
        </div>
        <div style="margin-top: 0.5rem; font-size: 0.72rem; color: var(--gold-light); text-align: center;">
          🔄 Core Translation: Re-framing internal operational levers into outside-in customer utility.
        </div>
      `;
      break;

    case 15: // STP: Segmentation, Targeting, Positioning (Kotler)
      visualHtml = `
        <div class="fw-flow-container" style="max-width: 530px;">
          <div class="fw-flow-step" style="border-top: 3px solid var(--cyan-primary);">
            <div class="fw-cell-title" style="color: var(--cyan-light);">1. Segmentation</div>
            <div class="fw-cell-desc">Disaggregate by Behaviors, Needs, Demographics</div>
          </div>
          <div class="fw-flow-arrow">→</div>
          <div class="fw-flow-step" style="border-top: 3px solid var(--gold-primary);">
            <div class="fw-cell-title" style="color: var(--gold-light);">2. Targeting</div>
            <div class="fw-cell-desc">Evaluate attractiveness & win-probability</div>
          </div>
          <div class="fw-flow-arrow">→</div>
          <div class="fw-flow-step" style="border-top: 3px solid var(--emerald-primary);">
            <div class="fw-cell-title" style="color: var(--emerald-light);">3. Positioning</div>
            <div class="fw-cell-desc">Distinct mental space & unique value proposition</div>
          </div>
        </div>
        <div style="margin-top: 0.65rem; font-size: 0.72rem; color: var(--text-muted); text-align: center; border-top: 1px dashed rgba(255,255,255,0.08); padding-top: 0.5rem;">
          🎯 <strong>Positioning Formula:</strong> For <em>[Target Segment]</em>, Brand X is the <em>[Frame of Reference]</em> that delivers <em>[Core Benefit]</em> because <em>[Reason to Believe]</em>.
        </div>
      `;
      break;

    case 16: // Perceptual / Positioning Maps
      visualHtml = `
        <div style="position: relative; width: 100%; max-width: 460px; height: 210px; background: rgba(17,24,39,0.8); border: 1px solid var(--border-color); border-radius: 6px; padding: 10px;">
          <!-- Axes -->
          <div style="position: absolute; left: 10px; right: 10px; top: 50%; height: 1px; background: rgba(255,255,255,0.15);"></div>
          <div style="position: absolute; top: 10px; bottom: 10px; left: 50%; width: 1px; background: rgba(255,255,255,0.15);"></div>
          
          <!-- Labels -->
          <div style="position: absolute; top: 4px; left: 50%; transform: translateX(-50%); font-size: 0.65rem; color: var(--gold-light); font-weight: bold;">High Quality / Premium Experience ▲</div>
          <div style="position: absolute; bottom: 4px; left: 50%; transform: translateX(-50%); font-size: 0.65rem; color: var(--text-muted);">▼ Basic / Functional</div>
          <div style="position: absolute; left: 4px; top: 50%; transform: translateY(-50%); font-size: 0.65rem; color: var(--text-muted);">◄ Low Price</div>
          <div style="position: absolute; right: 4px; top: 50%; transform: translateY(-50%); font-size: 0.65rem; color: var(--cyan-light); font-weight: bold;">High Price ►</div>

          <!-- Quadrant Items -->
          <div style="position: absolute; top: 22px; right: 30px; background: rgba(244,63,94,0.2); border: 1px solid var(--crimson-primary); border-radius: 4px; padding: 3px 6px; font-size: 0.62rem; color: var(--crimson-light);">Incumbent A</div>
          <div style="position: absolute; bottom: 25px; left: 25px; background: rgba(6,182,212,0.2); border: 1px solid var(--cyan-primary); border-radius: 4px; padding: 3px 6px; font-size: 0.62rem; color: var(--cyan-light);">Budget Rivals</div>
          
          <!-- White Space Bubble -->
          <div style="position: absolute; top: 25px; left: 30px; border: 2px dashed var(--emerald-primary); background: rgba(16,185,129,0.15); border-radius: 50%; width: 90px; height: 55px; display: flex; align-items: center; justify-content: center; text-align: center; font-size: 0.62rem; color: var(--emerald-light); font-weight: bold;">
            ✨ White Space Opportunity
          </div>
        </div>
      `;
      break;

    case 17: // Product Life Cycle (PLC)
      visualHtml = `
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; width: 100%; max-width: 530px; font-size: 0.65rem;">
          <div style="background: rgba(6,182,212,0.1); border-top: 3px solid var(--cyan-primary); padding: 8px 4px; border-radius: 4px; text-align: center;">
            <strong style="color: var(--cyan-light); font-size: 0.72rem;">1. Introduction</strong><br>
            <span style="color: var(--crimson-light); font-size: 0.6rem;">Negative Profit</span><br>
            <span style="color: var(--text-muted); font-size: 0.58rem;">Focus: Trial & Awareness</span>
          </div>
          <div style="background: rgba(16,185,129,0.1); border-top: 3px solid var(--emerald-primary); padding: 8px 4px; border-radius: 4px; text-align: center;">
            <strong style="color: var(--emerald-light); font-size: 0.72rem;">2. Growth</strong><br>
            <span style="color: var(--emerald-light); font-size: 0.6rem;">Profit Surge & Peak</span><br>
            <span style="color: var(--text-muted); font-size: 0.58rem;">Focus: Market Share Race</span>
          </div>
          <div style="background: rgba(245,158,11,0.1); border-top: 3px solid var(--gold-primary); padding: 8px 4px; border-radius: 4px; text-align: center;">
            <strong style="color: var(--gold-light); font-size: 0.72rem;">3. Maturity</strong><br>
            <span style="color: var(--gold-light); font-size: 0.6rem;">Sales Peak / Margin Squeeze</span><br>
            <span style="color: var(--text-muted); font-size: 0.58rem;">Focus: Defend & Differentiate</span>
          </div>
          <div style="background: rgba(244,63,94,0.1); border-top: 3px solid var(--crimson-primary); padding: 8px 4px; border-radius: 4px; text-align: center;">
            <strong style="color: var(--crimson-light); font-size: 0.72rem;">4. Decline</strong><br>
            <span style="color: var(--crimson-light); font-size: 0.6rem;">Volume Contraction</span><br>
            <span style="color: var(--text-muted); font-size: 0.58rem;">Focus: Harvest or Exit</span>
          </div>
        </div>
        <div style="margin-top: 0.5rem; font-size: 0.72rem; color: var(--gold-light); text-align: center;">
          📈 Key Lead-Lag Dynamic: <strong>Profit peaks during Growth</strong>, while <strong>Sales volume peaks later in Maturity</strong>.
        </div>
      `;
      break;

    case 18: // Kano Model
      visualHtml = `
        <div class="fw-grid-2x2" style="max-width: 520px; gap: 6px;">
          <div class="fw-grid-cell" style="border: 2px solid var(--emerald-primary); background: rgba(16,185,129,0.06);">
            <div class="fw-cell-title" style="color: var(--emerald-light);">✨ Attractive / Delighters</div>
            <div class="fw-cell-desc">Unexpected innovations creating disproportionate delight; no penalty if absent</div>
          </div>
          <div class="fw-grid-cell" style="border: 2px solid var(--cyan-primary); background: rgba(6,182,212,0.06);">
            <div class="fw-cell-title" style="color: var(--cyan-light);">⚡ One-Dimensional (Performance)</div>
            <div class="fw-cell-desc">Linear satisfaction: more battery life / faster speed = proportionally higher satisfaction</div>
          </div>
          <div class="fw-grid-cell" style="border: 2px solid var(--crimson-primary); background: rgba(244,63,94,0.06);">
            <div class="fw-cell-title" style="color: var(--crimson-light);">⚠️ Must-Be (Basic Expectations)</div>
            <div class="fw-cell-desc">Taken for granted; absence causes extreme dissatisfaction, presence yields only neutral</div>
          </div>
          <div class="fw-grid-cell" style="border: 1px dashed var(--border-color); background: rgba(255,255,255,0.02);">
            <div class="fw-cell-title" style="color: var(--text-muted);">🔄 Indifferent / Reverse</div>
            <div class="fw-cell-desc">Features customers do not value, or features whose excess creates friction</div>
          </div>
        </div>
        <div style="margin-top: 0.4rem; font-size: 0.7rem; color: var(--gold-light); text-align: center;">
          ⏳ Dynamic Decay: Today's <em>Delighters</em> inevitably decay into tomorrow's <em>Must-Be</em> expectations over time.
        </div>
      `;
      break;

    case 19: // Customer Journey & the AIDA Funnel
      visualHtml = `
        <div style="display: flex; flex-direction: column; align-items: center; width: 100%; max-width: 480px; gap: 4px;">
          <div style="width: 100%; background: rgba(56,189,248,0.15); border: 1px solid #38bdf8; padding: 6px; border-radius: 4px; text-align: center; color: #38bdf8; font-weight: bold; font-size: 0.75rem;">
            A — ATTENTION (Top of Funnel: Broad Visibility, PR & Paid Search)
          </div>
          <div style="width: 85%; background: rgba(6,182,212,0.15); border: 1px solid var(--cyan-primary); padding: 6px; border-radius: 4px; text-align: center; color: var(--cyan-light); font-weight: bold; font-size: 0.75rem;">
            I — INTEREST (Mid Funnel: Problem-Solution Resonance, Content & Demos)
          </div>
          <div style="width: 70%; background: rgba(245,158,11,0.15); border: 1px solid var(--gold-primary); padding: 6px; border-radius: 4px; text-align: center; color: var(--gold-light); font-weight: bold; font-size: 0.75rem;">
            D — DESIRE (Lower Funnel: Social Proof, Comparison & Emotional Conviction)
          </div>
          <div style="width: 55%; background: rgba(16,185,129,0.2); border: 1px solid var(--emerald-primary); padding: 6px; border-radius: 4px; text-align: center; color: var(--emerald-light); font-weight: bold; font-size: 0.75rem;">
            A — ACTION (Bottom: Frictionless Checkout & Conversion)
          </div>
        </div>
        <div style="margin-top: 0.5rem; font-size: 0.72rem; color: var(--gold-light); text-align: center;">
          🔁 Modern Flywheel Extension: Post-purchase <strong>Retention & Advocacy Loops</strong> compound CAC efficiency.
        </div>
      `;
      break;

    case 20: // TAM / SAM / SOM
      visualHtml = `
        <div style="display: flex; flex-direction: column; align-items: center; width: 100%; max-width: 460px; position: relative;">
          <!-- TAM Outer Ring -->
          <div style="width: 100%; border: 2px solid var(--cyan-primary); background: rgba(6,182,212,0.06); border-radius: 12px; padding: 12px 14px; text-align: center;">
            <div style="font-size: 0.75rem; font-weight: bold; color: var(--cyan-light);">🌍 TAM: Total Addressable Market</div>
            <div style="font-size: 0.62rem; color: var(--text-muted); margin-bottom: 8px;">100% total theoretical global demand for category</div>

            <!-- SAM Middle Ring -->
            <div style="width: 82%; margin: 0 auto; border: 2px solid var(--gold-primary); background: rgba(245,158,11,0.08); border-radius: 8px; padding: 10px 12px;">
              <div style="font-size: 0.72rem; font-weight: bold; color: var(--gold-light);">🎯 SAM: Serviceable Addressable Market</div>
              <div style="font-size: 0.6rem; color: var(--text-muted); margin-bottom: 6px;">Geography, channel fit, & target segment constraints</div>

              <!-- SOM Core -->
              <div style="width: 72%; margin: 0 auto; border: 2px solid var(--emerald-primary); background: rgba(16,185,129,0.2); border-radius: 6px; padding: 8px;">
                <div style="font-size: 0.72rem; font-weight: bold; color: var(--emerald-light);">🏆 SOM: Serviceable Obtainable Market</div>
                <div style="font-size: 0.58rem; color: #f8fafc;">Realistic 3-5 yr captured share given sales capacity</div>
              </div>
            </div>
          </div>
        </div>
      `;
      break;

    case 21: // Product–Market Fit
      visualHtml = `
        <div style="display: flex; flex-direction: column; width: 100%; max-width: 520px; gap: 8px;">
          <div style="display: flex; gap: 6px;">
            <div style="flex: 1; border: 2px solid var(--crimson-primary); background: rgba(244,63,94,0.08); border-radius: 6px; padding: 8px; text-align: center;">
              <div style="font-size: 0.72rem; font-weight: bold; color: var(--crimson-light);">📉 False PMF (Leakage)</div>
              <div style="font-size: 0.62rem; color: var(--text-muted); margin-top: 4px;">Cohort retention curve decays to 0%; scaling spend burns capital</div>
            </div>
            <div style="flex: 1; border: 2px solid var(--emerald-primary); background: rgba(16,185,129,0.12); border-radius: 6px; padding: 8px; text-align: center;">
              <div style="font-size: 0.72rem; font-weight: bold; color: var(--emerald-light);">📈 True PMF (Flattening Curve)</div>
              <div style="font-size: 0.62rem; color: var(--text-muted); margin-top: 4px;">Cohort curve flattens in parallel with x-axis; >40% Ellis 'very disappointed' threshold</div>
            </div>
          </div>
          <div style="background: rgba(245,158,11,0.1); border: 1px solid var(--gold-primary); padding: 6px; border-radius: 4px; font-size: 0.68rem; color: var(--gold-light); text-align: center;">
            ⚡ Sequencing Rule: <strong>Iterate Value Proposition ↔ Target Segment</strong> BEFORE unlocking paid acquisition growth spend.
          </div>
        </div>
      `;
      break;

    case 22: // Crossing the Chasm (Moore)
      visualHtml = `
        <div style="display: flex; flex-direction: column; width: 100%; max-width: 540px; gap: 4px;">
          <div style="display: flex; gap: 3px; align-items: stretch;">
            <div style="flex: 1; background: rgba(56,189,248,0.15); border: 1px solid #38bdf8; border-radius: 4px; padding: 6px 2px; text-align: center;">
              <span style="font-size: 0.62rem; color: #38bdf8; font-weight: bold;">Innovators</span><br>
              <span style="font-size: 0.55rem; color: var(--text-muted);">2.5% (Tech Enthusiasts)</span>
            </div>
            <div style="flex: 1.2; background: rgba(6,182,212,0.15); border: 1px solid var(--cyan-primary); border-radius: 4px; padding: 6px 2px; text-align: center;">
              <span style="font-size: 0.62rem; color: var(--cyan-light); font-weight: bold;">Early Adopters</span><br>
              <span style="font-size: 0.55rem; color: var(--text-muted);">13.5% (Visionaries)</span>
            </div>
            
            <!-- THE CHASM -->
            <div style="width: 70px; background: rgba(244,63,94,0.25); border: 2px dashed var(--crimson-primary); border-radius: 4px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 4px 2px;">
              <span style="font-size: 0.65rem; font-weight: bold; color: var(--crimson-light);">⚡ THE CHASM</span>
              <span style="font-size: 0.52rem; color: #f8fafc;">Psychological Gap</span>
            </div>

            <div style="flex: 1.6; background: rgba(16,185,129,0.15); border: 1px solid var(--emerald-primary); border-radius: 4px; padding: 6px 2px; text-align: center;">
              <span style="font-size: 0.62rem; color: var(--emerald-light); font-weight: bold;">Early Majority</span><br>
              <span style="font-size: 0.55rem; color: var(--text-muted);">34% (Pragmatists)</span>
            </div>
            <div style="flex: 1.6; background: rgba(245,158,11,0.15); border: 1px solid var(--gold-primary); border-radius: 4px; padding: 6px 2px; text-align: center;">
              <span style="font-size: 0.62rem; color: var(--gold-light); font-weight: bold;">Late Majority</span><br>
              <span style="font-size: 0.55rem; color: var(--text-muted);">34% (Conservatives)</span>
            </div>
            <div style="flex: 1; background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); border-radius: 4px; padding: 6px 2px; text-align: center;">
              <span style="font-size: 0.62rem; color: var(--text-muted); font-weight: bold;">Laggards</span><br>
              <span style="font-size: 0.55rem; color: var(--text-muted);">16% (Skeptics)</span>
            </div>
          </div>
          <div style="margin-top: 0.4rem; font-size: 0.7rem; color: var(--emerald-light); text-align: center;">
            🎯 Bridge Strategy: <strong>Dominate a Narrow Beachhead Niche</strong> with a 100% Whole Product Solution before broad expansion.
          </div>
        </div>
      `;
      break;

    case 23: // Diffusion of Innovations (Rogers)
      visualHtml = `
        <div style="display: flex; flex-direction: column; width: 100%; max-width: 520px; gap: 6px;">
          <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; text-align: center;">
            <div style="background: rgba(56,189,248,0.1); border: 1px solid #38bdf8; border-radius: 4px; padding: 6px 2px; font-size: 0.62rem;"><strong>2.5%</strong><br>Innovators</div>
            <div style="background: rgba(6,182,212,0.1); border: 1px solid var(--cyan-primary); border-radius: 4px; padding: 6px 2px; font-size: 0.62rem;"><strong>13.5%</strong><br>Early Adopters</div>
            <div style="background: rgba(16,185,129,0.15); border: 2px solid var(--emerald-primary); border-radius: 4px; padding: 6px 2px; font-size: 0.62rem; color: var(--emerald-light);"><strong>34%</strong><br>Early Majority</div>
            <div style="background: rgba(245,158,11,0.1); border: 1px solid var(--gold-primary); border-radius: 4px; padding: 6px 2px; font-size: 0.62rem;"><strong>34%</strong><br>Late Majority</div>
            <div style="background: rgba(244,63,94,0.1); border: 1px solid var(--crimson-primary); border-radius: 4px; padding: 6px 2px; font-size: 0.62rem;"><strong>16%</strong><br>Laggards</div>
          </div>
          <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); border-radius: 4px; padding: 6px; font-size: 0.65rem; color: var(--text-secondary);">
            🔑 <strong>5 Adoption Levers:</strong> Relative Advantage • Compatibility • Complexity (Low) • Trialability • Observability
          </div>
        </div>
      `;
      break;

    case 24: // Business Model Canvas
      visualHtml = `
        <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; width: 100%; max-width: 540px; font-size: 0.65rem; text-align: center;">
          <div style="background: var(--bg-tertiary); border: 1px solid var(--border-color); padding: 8px 4px; border-radius: 4px;"><strong style="color:var(--cyan-light);">Key Partners</strong><br><span style="font-size:0.58rem; color:#94a3b8;">Alliances, Vendors</span></div>
          <div style="background: var(--bg-tertiary); border: 1px solid var(--border-color); padding: 8px 4px; border-radius: 4px;"><strong style="color:var(--cyan-light);">Key Activities</strong><br><span style="font-size:0.58rem; color:#94a3b8;">Production, Platform</span></div>
          <div style="background: rgba(245,158,11,0.15); border: 2px solid var(--gold-primary); padding: 8px 4px; border-radius: 4px;"><strong style="color:var(--gold-light);">Value Props</strong><br><span style="font-size:0.58rem; color:#f8fafc;">Job-to-be-Done</span></div>
          <div style="background: var(--bg-tertiary); border: 1px solid var(--border-color); padding: 8px 4px; border-radius: 4px;"><strong style="color:var(--emerald-light);">Cust Relations</strong><br><span style="font-size:0.58rem; color:#94a3b8;">Self-serve, Dedicated</span></div>
          <div style="background: var(--bg-tertiary); border: 1px solid var(--border-color); padding: 8px 4px; border-radius: 4px;"><strong style="color:var(--emerald-light);">Segments</strong><br><span style="font-size:0.58rem; color:#94a3b8;">Target Personas</span></div>
          
          <div style="grid-column: span 2; background: rgba(244,63,94,0.1); border: 1px solid var(--crimson-primary); padding: 8px; border-radius: 4px;"><strong style="color:var(--crimson-light);">Cost Structure</strong><br><span style="font-size:0.58rem; color:#94a3b8;">Fixed & Variable Cost Drivers</span></div>
          <div style="grid-column: span 3; background: rgba(16,185,129,0.1); border: 1px solid var(--emerald-primary); padding: 8px; border-radius: 4px;"><strong style="color:var(--emerald-light);">Revenue Streams</strong><br><span style="font-size:0.58rem; color:#94a3b8;">Subscriptions, Usage, Licensing</span></div>
        </div>
      `;
      break;

    case 25: // Lean Startup: Build–Measure–Learn
      visualHtml = `
        <div class="fw-flow-container" style="max-width: 530px;">
          <div class="fw-flow-step" style="border-top: 3px solid var(--cyan-primary);">
            <div class="fw-cell-title" style="color: var(--cyan-light);">1. BUILD</div>
            <div class="fw-cell-desc">MVP / Feature Test (Artefact: Code/Product)</div>
          </div>
          <div class="fw-flow-arrow">→</div>
          <div class="fw-flow-step" style="border-top: 3px solid var(--gold-primary);">
            <div class="fw-cell-title" style="color: var(--gold-light);">2. MEASURE</div>
            <div class="fw-cell-desc">Actionable Metrics (Artefact: User Data)</div>
          </div>
          <div class="fw-flow-arrow">→</div>
          <div class="fw-flow-step" style="border-top: 3px solid var(--emerald-primary);">
            <div class="fw-cell-title" style="color: var(--emerald-light);">3. LEARN</div>
            <div class="fw-cell-desc">Validated Insights (Persevere or Pivot)</div>
          </div>
        </div>
        <div style="margin-top: 0.5rem; font-size: 0.72rem; color: var(--cyan-light); text-align: center;">
          ⚡ Core Velocity Metric: Minimize total elapsed cycle time through the <strong>Build-Measure-Learn</strong> feedback loop.
        </div>
      `;
      break;

    case 26: // Blue Ocean Strategy & ERRC Grid
      visualHtml = `
        <div class="fw-grid-2x2" style="max-width: 520px; gap: 6px;">
          <div class="fw-grid-cell" style="border: 2px solid var(--crimson-primary); background: rgba(244,63,94,0.06);">
            <div class="fw-cell-title" style="color: var(--crimson-light);">❌ ELIMINATE (Drive Cost Down)</div>
            <div class="fw-cell-desc">Which industry factors taken for granted should be completely removed?</div>
          </div>
          <div class="fw-grid-cell" style="border: 2px solid var(--gold-primary); background: rgba(245,158,11,0.06);">
            <div class="fw-cell-title" style="color: var(--gold-light);">📉 REDUCE (Drive Cost Down)</div>
            <div class="fw-cell-desc">Which factors should be reduced well below prevailing industry standards?</div>
          </div>
          <div class="fw-grid-cell" style="border: 2px solid var(--cyan-primary); background: rgba(6,182,212,0.06);">
            <div class="fw-cell-title" style="color: var(--cyan-light);">📈 RAISE (Drive Buyer Value Up)</div>
            <div class="fw-cell-desc">Which factors should be raised well above industry benchmarks?</div>
          </div>
          <div class="fw-grid-cell" style="border: 2px solid var(--emerald-primary); background: rgba(16,185,129,0.06);">
            <div class="fw-cell-title" style="color: var(--emerald-light);">✨ CREATE (Drive Buyer Value Up)</div>
            <div class="fw-cell-desc">Which unprecedented value factors should be created for non-customers?</div>
          </div>
        </div>
        <div style="margin-top: 0.5rem; font-size: 0.72rem; color: var(--cyan-light); text-align: center;">
          🌊 Result: <strong>Value Innovation</strong> (Simultaneous High Differentiation + Low Cost)
        </div>
      `;
      break;

    case 27: // Related vs. Unrelated Diversification
      visualHtml = `
        <div class="fw-grid-2x2" style="max-width: 520px; gap: 6px;">
          <div class="fw-grid-cell" style="border-left: 3px solid var(--cyan-primary);">
            <div class="fw-cell-title" style="color: var(--cyan-light);">Horizontal Integration</div>
            <div class="fw-cell-desc">Same stage of value chain; shared customer bases & scale synergies</div>
          </div>
          <div class="fw-grid-cell" style="border-left: 3px solid var(--emerald-primary);">
            <div class="fw-cell-title" style="color: var(--emerald-light);">Vertical Integration</div>
            <div class="fw-cell-desc">Forward (retail/channels) or Backward (suppliers/raw materials)</div>
          </div>
          <div class="fw-grid-cell" style="border-left: 3px solid var(--gold-primary);">
            <div class="fw-cell-title" style="color: var(--gold-light);">Related Diversification</div>
            <div class="fw-cell-desc">Shared technology, brand equity, or distribution infrastructure</div>
          </div>
          <div class="fw-grid-cell" style="border: 2px solid var(--crimson-primary); background: rgba(244,63,94,0.06);">
            <div class="fw-cell-title" style="color: var(--crimson-light);">Unrelated Conglomerate</div>
            <div class="fw-cell-desc">Financial capital reallocation & institutional voids intermediary</div>
          </div>
        </div>
        <div style="margin-top: 0.5rem; font-size: 0.72rem; color: var(--gold-light); text-align: center;">
          🏛️ Institutional Voids Filter: In developed markets ➔ <em>Conglomerate Discount</em>; In emerging markets ➔ <em>Conglomerate Premium</em>.
        </div>
      `;
      break;

    default:
      visualHtml = `
        <div class="fw-circle-layout">
          <div class="fw-circle-node" style="border-color: var(--cyan-primary); color: var(--cyan-light); font-size: 0.7rem; width: 120px; height: 50px; border-radius: var(--radius-sm);">${fw.title.split(':')[0]}</div>
          <div class="fw-flow-arrow">⚡</div>
          <div class="fw-circle-node" style="border-color: var(--gold-primary); color: var(--gold-light); font-size: 0.7rem; width: 120px; height: 50px; border-radius: var(--radius-sm);">Strategic Choices</div>
          <div class="fw-flow-arrow">⚡</div>
          <div class="fw-circle-node" style="border-color: var(--emerald-primary); color: var(--emerald-light); font-size: 0.7rem; width: 120px; height: 50px; border-radius: var(--radius-sm);">Market Execution</div>
        </div>
      `;
  }

  return `
    <div style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.5; margin-bottom: 0.75rem;">
      ${fw.schematic}
    </div>
    <div class="fw-visual-container">
      <div style="font-size: 0.65rem; color: var(--gold-light); text-transform: uppercase; font-family: var(--font-mono); letter-spacing: 0.1em; margin-bottom: 0.75rem;">Visual Retention Aid</div>
      ${visualHtml}
    </div>
  `;
}

// ==========================================================================
// VIEW SWITCHER
// ==========================================================================
function switchMainView(view) {
  sound.click();
  const quizView = document.getElementById('view-quiz-arena');
  const resultsView = document.getElementById('view-results-arena');
  const libraryView = document.getElementById('view-library-arena');
  const adminView = document.getElementById('view-leaderboard-arena');

  const quizBtn = document.getElementById('quizTabBtn');
  const libraryBtn = document.getElementById('libraryTabBtn');
  const leaderboardBtn = document.getElementById('leaderboardTabBtn');
  const adminBtn = document.getElementById('adminTabBtn');

  [quizBtn, libraryBtn, leaderboardBtn, adminBtn].forEach(b => { if (b) b.classList.remove('active'); });

  if (quizView) quizView.style.display = 'none';
  if (resultsView) resultsView.style.display = 'none';
  if (libraryView) libraryView.style.display = 'none';
  if (adminView) adminView.style.display = 'none';

  if (view === 'quiz') {
    if (quizView) quizView.style.display = 'block';
    if (quizBtn) quizBtn.classList.add('active');
  } else if (view === 'results') {
    if (resultsView) resultsView.style.display = 'block';
  } else if (view === 'library') {
    if (libraryView) libraryView.style.display = 'block';
    if (libraryBtn) libraryBtn.classList.add('active');
    renderLibrary();
  } else if (view === 'leaderboard' || view === 'admin') {
    if (adminView) adminView.style.display = 'block';
    if (view === 'admin' && adminBtn) adminBtn.classList.add('active');
    else if (leaderboardBtn) leaderboardBtn.classList.add('active');
    renderAdminTable();
    syncLeaderboardWithCloud();
  }
}

// ==========================================================================
// EVENT LISTENERS & UTILITIES
// ==========================================================================
function setupEventListeners() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeFrameworkModal();
    }
    const quizView = document.getElementById('view-quiz-arena');
    if (quizView && quizView.style.display !== 'none') {
      if (e.key === '1' || e.key === 'a' || e.key === 'A') selectOption('A');
      else if (e.key === '2' || e.key === 'b' || e.key === 'B') selectOption('B');
      else if (e.key === '3' || e.key === 'c' || e.key === 'C') selectOption('C');
      else if (e.key === '4' || e.key === 'd' || e.key === 'D') selectOption('D');
      else if (e.key === 'Enter' || e.key === ' ') {
        const nextBtn = document.getElementById('nextQuestionBtn');
        const fb = document.getElementById('feedbackCard');
        if (fb && fb.classList.contains('active') && nextBtn) {
          nextQuestion();
        }
      }
    }
  });
}

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}


function parseMarkdown(text) {
  if (!text) return "";
  let html = text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^\s*•\s*(.*)$/gm, '<li>$1</li>')
    .replace(/^\s*-\s*(.*)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/gs, '<ul style="margin: 0.35rem 0 0.35rem 1.25rem; padding: 0;">$1</ul>')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>');
  return html;
}
