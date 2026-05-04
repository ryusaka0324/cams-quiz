/* ============================================
   CAMS試験対策 PWA - Application Logic
   v2.0 Full Feature
   ============================================ */

const App = {
  // ========== 状態管理 ==========
  state: {
    questions: [],
    textbook: null,
    currentScreen: 'home',
    currentQuestion: null,
    currentSession: null,
    examState: null,
    textbookState: { unit: null, page: null },
    settings: { darkMode: false, fontSize: 'medium', dailyGoal: 10, textbookFontSize: 16, todayLearningCount: 20 }
  },

  // ========== 起動処理 ==========
  async init() {
    this.loadSettings();
    this.applyTheme();
    
    try {
      const res = await fetch('./questions.json');
      this.state.questions = await res.json();
    } catch (e) {
      console.error('Failed to load questions', e);
      alert('問題データの読み込みに失敗しました');
      return;
    }

    // 教科書データを読み込む（失敗してもアプリは起動する）
    try {
      const res = await fetch('./textbook.json');
      this.state.textbook = await res.json();
    } catch (e) {
      console.warn('Textbook not available', e);
    }

    this.checkStreak();
    this.bindEvents();
    
    setTimeout(() => {
      document.getElementById('loading').classList.add('hidden');
      document.getElementById('main-app').classList.remove('hidden');
      this.navigate('home');
    }, 800);
  },

  // ========== LocalStorage ==========
  storage: {
    get(key, defaultValue = null) {
      try {
        const v = localStorage.getItem(`cams.${key}`);
        return v ? JSON.parse(v) : defaultValue;
      } catch { return defaultValue; }
    },
    set(key, value) {
      try { localStorage.setItem(`cams.${key}`, JSON.stringify(value)); }
      catch (e) { console.error('Storage error', e); }
    }
  },

  loadSettings() {
    const defaults = { darkMode: false, fontSize: 'medium', dailyGoal: 10, textbookFontSize: 16, todayLearningCount: 20 };
    this.state.settings = { ...defaults, ...this.storage.get('settings', {}) };
  },
  saveSettings() {
    this.storage.set('settings', this.state.settings);
  },

  applyTheme() {
    document.documentElement.setAttribute('data-theme', this.state.settings.darkMode ? 'dark' : 'light');
    document.getElementById('theme-toggle').textContent = this.state.settings.darkMode ? '☀️' : '🌙';
  },

  // ========== 進捗管理 ==========
  getProgress() {
    return this.storage.get('progress', {});
  },
  recordAnswer(questionId, isCorrect, userAnswer) {
    const progress = this.getProgress();
    const today = this.formatDate(new Date());
    if (!progress[questionId]) {
      progress[questionId] = { attempts: 0, correct: 0, history: [] };
    }
    progress[questionId].attempts++;
    if (isCorrect) progress[questionId].correct++;
    progress[questionId].lastAnswer = userAnswer;
    progress[questionId].lastResult = isCorrect;
    progress[questionId].lastDate = today;
    this.updateReviewSchedule(progress[questionId], isCorrect, today);
    progress[questionId].history.push({ date: today, correct: isCorrect, answer: userAnswer });
    if (progress[questionId].history.length > 50) progress[questionId].history.shift();
    this.storage.set('progress', progress);
    this.updateStreak(today);
    this.updateDailyCount(today);
  },

  // ========== ストリーク管理 ==========
  checkStreak() {
    const streak = this.storage.get('streak', { current: 0, longest: 0, lastDate: null });
    if (!streak.lastDate) return;
    const last = new Date(streak.lastDate);
    const today = new Date(this.formatDate(new Date()));
    const diff = Math.floor((today - last) / (1000 * 60 * 60 * 24));
    if (diff > 1) {
      streak.current = 0;
      this.storage.set('streak', streak);
    }
  },
  updateStreak(today) {
    const streak = this.storage.get('streak', { current: 0, longest: 0, lastDate: null });
    if (streak.lastDate === today) return;
    if (!streak.lastDate) {
      streak.current = 1;
    } else {
      const last = new Date(streak.lastDate);
      const todayDate = new Date(today);
      const diff = Math.floor((todayDate - last) / (1000 * 60 * 60 * 24));
      streak.current = (diff === 1) ? streak.current + 1 : 1;
    }
    streak.longest = Math.max(streak.longest, streak.current);
    streak.lastDate = today;
    this.storage.set('streak', streak);
  },
  updateDailyCount(today) {
    const daily = this.storage.get('daily', {});
    daily[today] = (daily[today] || 0) + 1;
    this.storage.set('daily', daily);
  },

  // ========== ブックマーク ==========
  getBookmarks() { return this.storage.get('bookmarks', []); },
  toggleBookmark(qId) {
    const bookmarks = this.getBookmarks();
    const idx = bookmarks.indexOf(qId);
    if (idx >= 0) bookmarks.splice(idx, 1);
    else bookmarks.push(qId);
    this.storage.set('bookmarks', bookmarks);
    return idx < 0;
  },
  isBookmarked(qId) { return this.getBookmarks().includes(qId); },

  // ========== 演習セッションの途中保存 ==========
  serializeSession(session) {
    if (!session || !Array.isArray(session.questions)) return null;
    return {
      title: session.title,
      index: session.index || 0,
      from: session.from || 'practice',
      savedAt: new Date().toISOString(),
      questionIds: session.questions.map(q => q.id),
      results: (session.results || []).map(r => ({
        qid: r.q?.id || r.qid,
        userAnswer: r.userAnswer,
        isCorrect: r.isCorrect
      }))
    };
  },
  hydrateSession(saved) {
    if (!saved || !Array.isArray(saved.questionIds)) return null;
    const questions = saved.questionIds
      .map(id => this.state.questions.find(q => q.id === id))
      .filter(Boolean);
    if (questions.length === 0) return null;

    const safeIndex = Math.min(Math.max(saved.index || 0, 0), questions.length - 1);
    const results = (saved.results || []).map(r => {
      const q = this.state.questions.find(x => x.id === r.qid);
      return q ? { q, userAnswer: r.userAnswer, isCorrect: r.isCorrect } : null;
    }).filter(Boolean);

    return {
      questions,
      title: saved.title || '保存中の演習',
      index: safeIndex,
      from: saved.from || 'practice',
      results
    };
  },
  saveActiveSession() {
    const serialized = this.serializeSession(this.state.currentSession);
    if (!serialized) return;
    this.storage.set('activeSession', serialized);
  },
  getActiveSession() {
    const saved = this.storage.get('activeSession', null);
    const session = this.hydrateSession(saved);
    if (!session) return null;
    if (session.index >= session.questions.length) return null;
    return session;
  },
  clearActiveSession() {
    try { localStorage.removeItem('cams.activeSession'); }
    catch (e) { console.warn('Failed to clear active session', e); }
  },
  resumeActiveSession() {
    const session = this.getActiveSession();
    if (!session) {
      alert('再開できる演習はありません。');
      return;
    }
    this.state.currentSession = session;
    this.navigate('question');
  },
  describeActiveSession() {
    const session = this.getActiveSession();
    if (!session) return null;
    const saved = this.storage.get('activeSession', {});
    return {
      title: session.title,
      index: session.index + 1,
      total: session.questions.length,
      remaining: Math.max(0, session.questions.length - session.index),
      savedAt: this.formatSavedAt(saved?.savedAt)
    };
  },
  formatSavedAt(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mm}/${dd} ${hh}:${mi}`;
  },

  // ========== 試験履歴 ==========
  getExamHistory() { return this.storage.get('exams', []); },
  saveExamResult(result) {
    const history = this.getExamHistory();
    history.unshift(result);
    if (history.length > 20) history.pop();
    this.storage.set('exams', history);
  },

  // ========== ユーティリティ ==========
  formatDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  },
  parseDate(dateStr) {
    if (!dateStr) return null;
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  },
  addDays(dateStr, days) {
    const d = this.parseDate(dateStr) || new Date();
    d.setDate(d.getDate() + days);
    return this.formatDate(d);
  },
  daysBetween(fromDate, toDate) {
    const from = this.parseDate(fromDate);
    const to = this.parseDate(toDate);
    if (!from || !to) return 0;
    return Math.floor((to - from) / 86400000);
  },

  // ========== 忘却曲線・間隔反復 ==========
  updateReviewSchedule(item, isCorrect, today) {
    const intervals = [1, 3, 7, 14, 30, 60];
    const currentLevel = Number.isFinite(item.reviewLevel) ? item.reviewLevel : 0;

    if (isCorrect) {
      item.reviewLevel = Math.min(currentLevel + 1, intervals.length);
      item.intervalDays = intervals[item.reviewLevel - 1] || intervals[intervals.length - 1];
    } else {
      item.lapseCount = (item.lapseCount || 0) + 1;
      item.reviewLevel = Math.max(0, currentLevel - 2);
      item.intervalDays = 1;
    }

    item.nextReviewDate = this.addDays(today, item.intervalDays);
  },
  getReviewDueDate(progressItem, today) {
    if (!progressItem || !progressItem.attempts) return null;
    return progressItem.nextReviewDate || today;
  },
  getDueReviewQuestions(limit = Infinity) {
    const progress = this.getProgress();
    const today = this.formatDate(new Date());

    return this.state.questions
      .filter(q => {
        const p = progress[q.id];
        const dueDate = this.getReviewDueDate(p, today);
        return dueDate && dueDate <= today;
      })
      .sort((a, b) => {
        const pa = progress[a.id] || {};
        const pb = progress[b.id] || {};
        const da = this.getReviewDueDate(pa, today);
        const db = this.getReviewDueDate(pb, today);
        const overdueA = this.daysBetween(da, today);
        const overdueB = this.daysBetween(db, today);
        if (overdueB !== overdueA) return overdueB - overdueA;

        const lapseA = pa.lapseCount || 0;
        const lapseB = pb.lapseCount || 0;
        if (lapseB !== lapseA) return lapseB - lapseA;

        const rateA = pa.attempts ? pa.correct / pa.attempts : 1;
        const rateB = pb.attempts ? pb.correct / pb.attempts : 1;
        return rateA - rateB;
      })
      .slice(0, limit);
  },
  getReviewSummary() {
    const progress = this.getProgress();
    const today = this.formatDate(new Date());
    let due = 0, overdue = 0, scheduled = 0;

    this.state.questions.forEach(q => {
      const p = progress[q.id];
      if (!p || !p.attempts) return;
      const dueDate = this.getReviewDueDate(p, today);
      if (!dueDate) return;
      if (dueDate <= today) {
        due++;
        if (dueDate < today) overdue++;
      } else {
        scheduled++;
      }
    });

    return { due, overdue, scheduled };
  },
  getTodayLearningQuestions(limit = null) {
    const progress = this.getProgress();
    limit = limit || this.state.settings.todayLearningCount || 20;
    const today = this.formatDate(new Date());
    const selected = [];
    const used = new Set();

    const add = (list) => {
      list.forEach(q => {
        if (selected.length >= limit) return;
        if (!q || used.has(q.id)) return;
        used.add(q.id);
        selected.push(q);
      });
    };

    const due = this.getDueReviewQuestions(limit);
    add(due);

    const recentWrong = this.state.questions
      .filter(q => {
        const p = progress[q.id];
        return p && p.lastResult === false && !used.has(q.id);
      })
      .sort((a, b) => (progress[b.id]?.lastDate || '').localeCompare(progress[a.id]?.lastDate || ''));
    add(recentWrong);

    const weak = this.state.questions
      .filter(q => {
        const p = progress[q.id];
        return p && p.attempts >= 2 && !used.has(q.id);
      })
      .sort((a, b) => {
        const pa = progress[a.id], pb = progress[b.id];
        return (pa.correct / pa.attempts) - (pb.correct / pb.attempts);
      });
    add(weak);

    const unseen = this.shuffleArray(this.state.questions.filter(q => !progress[q.id]));
    add(unseen);

    return selected;
  },
  startTodayLearningSession(from = 'home') {
    const count = this.state.settings.todayLearningCount || 20;
    const qs = this.getTodayLearningQuestions(count);
    if (qs.length === 0) {
      alert('今日の学習対象はまだありません。まずはユニット別演習かランダム出題で問題を解いてください。');
      return;
    }
    this.startSession(qs, '今日の学習', { from });
  },
  startDueReviewSession(from = 'review') {
    const count = this.state.settings.todayLearningCount || 20;
    const qs = this.getDueReviewQuestions(count);
    if (qs.length === 0) {
      alert('今日が復習期限の問題はありません。');
      return;
    }
    this.startSession(qs, '今日の復習', { from });
  },

  shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  },
  vibrate(pattern) {
    if (navigator.vibrate) navigator.vibrate(pattern);
  },

  // ========== 苦手分野分析 ==========
  getWeaknesses(topN = 3) {
    const progress = this.getProgress();
    const sectionStats = {};
    this.state.questions.forEach(q => {
      const p = progress[q.id];
      if (!p || p.attempts === 0) return;
      const key = `${q.unit}-${q.section}`;
      if (!sectionStats[key]) {
        sectionStats[key] = { unit: q.unit, section: q.section, attempts: 0, correct: 0 };
      }
      sectionStats[key].attempts += p.attempts;
      sectionStats[key].correct += p.correct;
    });
    return Object.values(sectionStats)
      .filter(s => s.attempts >= 2)
      .map(s => ({ ...s, rate: Math.round(s.correct / s.attempts * 100) }))
      .sort((a, b) => a.rate - b.rate)
      .slice(0, topN);
  },

  getWeakQuestions(count = 10) {
    const progress = this.getProgress();
    const scored = this.state.questions.map(q => {
      const p = progress[q.id];
      if (!p || p.attempts === 0) return { q, score: 0.5 };
      return { q, score: p.correct / p.attempts };
    });
    return scored.sort((a, b) => a.score - b.score).slice(0, count).map(x => x.q);
  },

  // ========== ナビゲーション ==========
  bindEvents() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => this.navigate(btn.dataset.tab));
    });
    document.getElementById('back-btn').addEventListener('click', () => this.goBack());
    document.getElementById('theme-toggle').addEventListener('click', () => {
      this.state.settings.darkMode = !this.state.settings.darkMode;
      this.saveSettings();
      this.applyTheme();
    });
    document.getElementById('settings-btn').addEventListener('click', () => this.showSettings());
    document.getElementById('modal-close').addEventListener('click', () => {
      document.getElementById('modal').classList.add('hidden');
    });
  },

  navigate(screen, params = {}) {
    this.state.currentScreen = screen;
    document.getElementById('content').classList.remove('has-fixed-bar');
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === screen);
    });
    const isMain = ['home','practice','textbook','exam','review','stats'].includes(screen);
    document.getElementById('back-btn').classList.toggle('hidden', isMain);
    document.getElementById('tab-nav').style.display = isMain ? 'flex' : 'none';
    document.body.classList.toggle('has-tab-nav', isMain);
    
    const renderers = {
      home: () => this.renderHome(),
      practice: () => this.renderPractice(),
      textbook: () => this.renderTextbookHome(),
      exam: () => this.renderExamIntro(),
      review: () => this.renderReview(),
      stats: () => this.renderStats(),
      'practice-setup': () => this.renderPracticeSetup(params),
      'question': () => this.renderQuestion(),
      'exam-active': () => this.renderExamActive(),
      'exam-result': () => this.renderExamResult(params),
      'session-complete': () => this.renderSessionComplete(),
      'search': () => this.renderSearch(),
      'textbook-viewer': () => this.renderTextbookViewer(params)
    };
    if (renderers[screen]) renderers[screen]();
    window.scrollTo(0, 0);
  },

  goBack() {
    const flow = {
      'practice-setup': 'practice',
      'question': this.state.currentSession?.from || 'practice',
      'exam-active': 'exam',
      'exam-result': 'exam',
      'session-complete': 'home',
      'search': 'home',
      'textbook-viewer': 'textbook'
    };
    this.navigate(flow[this.state.currentScreen] || 'home');
  },

  setTitle(t) { document.getElementById('page-title').textContent = t; },

  // ========== ホーム画面 ==========
  renderHome() {
    this.setTitle('CAMS');
    const progress = this.getProgress();
    const totalQ = this.state.questions.length;
    const answered = Object.keys(progress).length;
    const percent = Math.round(answered / totalQ * 100);
    
    const streak = this.storage.get('streak', { current: 0, longest: 0 });
    const today = this.formatDate(new Date());
    const daily = this.storage.get('daily', {});
    const todayCount = daily[today] || 0;
    const goal = this.state.settings.dailyGoal;
    
    const lastQ = this.storage.get('lastQuestion', null);
    const hour = new Date().getHours();
    const greeting = hour < 6 ? 'こんばんは' : hour < 11 ? 'おはようございます' : hour < 17 ? 'こんにちは' : hour < 22 ? 'こんばんは' : 'お疲れ様です';
    const greetEmoji = hour < 11 ? '☀️' : hour < 17 ? '🌤' : hour < 22 ? '🌙' : '🌃';
    
    const weak = this.getWeaknesses(3);
    const activeSession = this.describeActiveSession();
    const reviewSummary = this.getReviewSummary();
    const todayLearningCount = this.state.settings.todayLearningCount || 20;
    const todayPlanCount = this.getTodayLearningQuestions(todayLearningCount).length;
    const countOptions = [5, 10, 20, 30, 50, 100];

    let html = `
      <div class="greeting">
        <div class="greeting-emoji">${greetEmoji}</div>
        <h2>${greeting}</h2>
        <p>今日も学習頑張りましょう！</p>
      </div>
    `;

    if (activeSession) {
      html += `
        <div class="resume-session-card" id="resume-session-card">
          <div class="resume-session-main">
            <div class="label">⏸ 保存中の演習</div>
            <div class="title">${activeSession.title}</div>
            <div class="meta">${activeSession.index}/${activeSession.total}問目 ・ 残り${activeSession.remaining}問${activeSession.savedAt ? ` ・ ${activeSession.savedAt}保存` : ''}</div>
          </div>
          <button class="resume-session-btn" id="resume-session-btn">再開</button>
        </div>
      `;
    }

    if (lastQ) {
      html += `
        <div class="continue-card" id="continue-card">
          <div class="label">📚 最後に解いた問題</div>
          <div class="title">${lastQ.unit} #${lastQ.no} まで完了</div>
          <div class="meta">同じユニットの続きから再開 →</div>
        </div>
      `;
    }

    html += `
      <div class="today-study-card">
        <div class="today-study-head">
          <div>
            <div class="label">🧠 忘却曲線ベース</div>
            <div class="title">今日の学習</div>
            <div class="desc">復習期限・誤答・未解答を自動で組み合わせます</div>
          </div>
          <div class="today-study-count">${todayPlanCount}<span>問</span></div>
        </div>
        <div class="review-pill-grid">
          <div class="review-pill"><span>期限切れ</span><strong>${reviewSummary.overdue}</strong></div>
          <div class="review-pill"><span>今日の復習</span><strong>${reviewSummary.due}</strong></div>
          <div class="review-pill"><span>予約済み</span><strong>${reviewSummary.scheduled}</strong></div>
        </div>
        <div class="study-count-selector">
          <div class="study-count-label">今回解く問題数</div>
          <div class="study-count-buttons">
            ${countOptions.map(n => `<button class="count-chip ${n === todayLearningCount ? 'active' : ''}" data-count="${n}">${n}</button>`).join('')}
          </div>
        </div>
        <button class="btn-primary today-study-btn" id="today-study-btn">今日の学習を始める</button>
      </div>

      <div class="stat-card">
        <div class="label">📈 全体進捗</div>
        <div class="progress-row">
          <span class="value">${answered} / ${totalQ}問</span>
          <span class="num">${percent}%</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${percent}%"></div></div>
      </div>
    `;

    if (streak.current > 0) {
      html += `
        <div class="streak-card">
          <span class="streak-emoji">🔥</span>
          <div class="streak-info">
            <div class="label">連続学習</div>
            <div class="num">${streak.current}日目</div>
          </div>
        </div>
      `;
    }

    const goalPct = Math.min(100, Math.round(todayCount / goal * 100));
    html += `
      <div class="stat-card">
        <div class="label">🎯 今日の目標</div>
        <div class="progress-row">
          <span class="value">${todayCount} / ${goal}問</span>
          <span class="num">${goalPct}%</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${goalPct}%"></div></div>
      </div>
    `;

    html += `
      <div class="quick-actions">
        <button class="quick-btn" data-action="practice">
          <div class="quick-btn-icon">📝</div>
          <div class="quick-btn-label">演習</div>
        </button>
        <button class="quick-btn" data-action="exam">
          <div class="quick-btn-icon">🎯</div>
          <div class="quick-btn-label">試験</div>
        </button>
        <button class="quick-btn" data-action="weak">
          <div class="quick-btn-icon">💪</div>
          <div class="quick-btn-label">弱点</div>
        </button>
        <button class="quick-btn" data-action="search">
          <div class="quick-btn-icon">🔍</div>
          <div class="quick-btn-label">検索</div>
        </button>
      </div>
    `;

    if (weak.length > 0) {
      html += `<div class="section-title">💡 苦手分野 TOP${weak.length}</div>`;
      weak.forEach(w => {
        html += `
          <div class="weakness-card" data-section="${w.unit}-${w.section}">
            <div class="info">
              <div class="name">${w.section}</div>
              <div class="meta">${w.unit} ・ ${w.attempts}回挑戦</div>
            </div>
            <div class="rate">${w.rate}%</div>
          </div>
        `;
      });
    }

    document.getElementById('content').innerHTML = html;
    
    document.getElementById('resume-session-card')?.addEventListener('click', () => {
      this.resumeActiveSession();
    });
    document.getElementById('resume-session-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.resumeActiveSession();
    });

    document.getElementById('continue-card')?.addEventListener('click', () => {
      const q = this.state.questions.find(x => x.id === lastQ.id);
      if (q) {
        const idx = this.state.questions.findIndex(x => x.id === lastQ.id);
        const remaining = this.state.questions.filter(x => x.unit === lastQ.unit && x.no >= lastQ.no + 1);
        if (remaining.length > 0) {
          this.startSession(remaining, `${lastQ.unit} 続きから`);
        }
      }
    });
    
    document.querySelectorAll('.count-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        this.state.settings.todayLearningCount = Number(btn.dataset.count);
        this.saveSettings();
        this.renderHome();
      });
    });

    document.getElementById('today-study-btn')?.addEventListener('click', () => {
      this.startTodayLearningSession('home');
    });

    document.querySelectorAll('.quick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (action === 'weak') this.startWeakSession();
        else if (action === 'search') this.navigate('search');
        else this.navigate(action);
      });
    });
    
    document.querySelectorAll('.weakness-card').forEach(card => {
      card.addEventListener('click', () => {
        const [unit, section] = card.dataset.section.split('-');
        const qs = this.state.questions.filter(q => q.unit === unit && q.section === section);
        this.startSession(this.shuffleArray(qs), `${section}`);
      });
    });
  },

  // ========== 演習画面 ==========
  renderPractice() {
    this.setTitle('問題演習');
    const progress = this.getProgress();
    
    const unitStats = {};
    ['U1','U2','U3','U4'].forEach(u => {
      const qs = this.state.questions.filter(q => q.unit === u);
      const answered = qs.filter(q => progress[q.id]).length;
      unitStats[u] = { total: qs.length, answered, pct: Math.round(answered / qs.length * 100) };
    });

    const reviewSummary = this.getReviewSummary();
    const activeSession = this.describeActiveSession();
    const todayLearningCount = this.state.settings.todayLearningCount || 20;
    const todayPlanCount = this.getTodayLearningQuestions(todayLearningCount).length;
    const countOptions = [5, 10, 20, 30, 50, 100];

    let html = `
      ${activeSession ? `
        <div class="resume-session-card compact" id="practice-resume-session-card">
          <div class="resume-session-main">
            <div class="label">⏸ 保存中の演習</div>
            <div class="title">${activeSession.title}</div>
            <div class="meta">${activeSession.index}/${activeSession.total}問目 ・ 残り${activeSession.remaining}問${activeSession.savedAt ? ` ・ ${activeSession.savedAt}保存` : ''}</div>
          </div>
          <button class="resume-session-btn" id="practice-resume-session-btn">再開</button>
        </div>
      ` : ''}

      <div class="mode-card featured-mode" id="today-learning-mode">
        <div class="mode-header">
          <span class="mode-icon">🧠</span>
          <div class="mode-info">
            <div class="title">今日の学習</div>
            <div class="desc">忘却曲線ベースで ${todayPlanCount}問を自動出題</div>
          </div>
        </div>
        <div class="mode-metrics">
          <span>今回 ${todayLearningCount}問</span>
          <span>期限切れ ${reviewSummary.overdue}</span>
          <span>復習 ${reviewSummary.due}</span>
          <span>予約済み ${reviewSummary.scheduled}</span>
        </div>
        <div class="study-count-selector compact">
          <div class="study-count-buttons">
            ${countOptions.map(n => `<button class="count-chip ${n === todayLearningCount ? 'active' : ''}" data-count="${n}">${n}</button>`).join('')}
          </div>
        </div>
      </div>

      <div class="mode-card" id="unit-mode">
        <div class="mode-header">
          <span class="mode-icon">📚</span>
          <div class="mode-info">
            <div class="title">ユニット別学習</div>
            <div class="desc">順番通りに解いていく</div>
          </div>
        </div>
        <div class="unit-list">
          ${['U1','U2','U3','U4'].map(u => {
            const s = unitStats[u];
            const titles = {
              U1: '金融犯罪のリスクと手法',
              U2: 'グローバルAFCの枠組み',
              U3: 'AFCコンプライアンス態勢',
              U4: 'ツール・テクノロジー'
            };
            return `
              <div class="unit-row" data-unit="${u}">
                <span class="unit-name">${u}</span>
                <div class="unit-progress">
                  <div style="font-size:13px;font-weight:600;margin-bottom:2px;">${titles[u]}</div>
                  <div class="progress-bar"><div class="progress-fill" style="width:${s.pct}%"></div></div>
                </div>
                <span class="unit-rate ${s.pct === 100 ? 'complete' : ''}">${s.answered}/${s.total}</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <div class="mode-card" id="random-mode">
        <div class="mode-header">
          <span class="mode-icon">🎲</span>
          <div class="mode-info">
            <div class="title">ランダム出題</div>
            <div class="desc">フィルター付きシャッフル</div>
          </div>
        </div>
      </div>

      <div class="mode-card" id="weak-mode">
        <div class="mode-header">
          <span class="mode-icon">💪</span>
          <div class="mode-info">
            <div class="title">弱点克服モード</div>
            <div class="desc">正答率から苦手問題を自動選定 → 10問</div>
          </div>
        </div>
      </div>

      <div class="mode-card" id="bookmark-mode">
        <div class="mode-header">
          <span class="mode-icon">🔖</span>
          <div class="mode-info">
            <div class="title">ブックマーク</div>
            <div class="desc">${this.getBookmarks().length}問が保存中</div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('content').innerHTML = html;

    document.getElementById('practice-resume-session-card')?.addEventListener('click', () => {
      this.resumeActiveSession();
    });
    document.getElementById('practice-resume-session-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.resumeActiveSession();
    });

    document.querySelectorAll('.unit-row').forEach(row => {
      row.addEventListener('click', () => {
        const unit = row.dataset.unit;
        const qs = this.state.questions.filter(q => q.unit === unit);
        this.startSession(qs, `${unit} 順番通り`, { from: 'practice' });
      });
    });

    document.querySelectorAll('.count-chip').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.state.settings.todayLearningCount = Number(btn.dataset.count);
        this.saveSettings();
        this.renderPractice();
      });
    });

    document.getElementById('today-learning-mode').addEventListener('click', () => {
      this.startTodayLearningSession('practice');
    });

    document.getElementById('random-mode').addEventListener('click', () => {
      this.navigate('practice-setup', { mode: 'random' });
    });

    document.getElementById('weak-mode').addEventListener('click', () => this.startWeakSession());

    document.getElementById('bookmark-mode').addEventListener('click', () => {
      const bookmarks = this.getBookmarks();
      if (bookmarks.length === 0) {
        alert('ブックマークがまだありません。\n問題画面で🔖ボタンをタップして追加してください。');
        return;
      }
      const qs = this.state.questions.filter(q => bookmarks.includes(q.id));
      this.startSession(this.shuffleArray(qs), 'ブックマーク', { from: 'practice' });
    });
  },

  // ========== ランダム出題セットアップ ==========
  renderPracticeSetup(params) {
    this.setTitle('ランダム出題');
    const setup = this.storage.get('lastFilter', {
      units: ['U1','U2','U3','U4'],
      levels: ['Lv.1','Lv.2','Lv.3'],
      filter: 'all',
      count: 10
    });

    const html = `
      <div class="mode-card">
        <div class="filter-section">
          <div class="filter-label">ユニット</div>
          <div class="chip-group" id="filter-units">
            ${['U1','U2','U3','U4'].map(u => 
              `<button class="chip ${setup.units.includes(u)?'active':''}" data-val="${u}">${u}</button>`
            ).join('')}
          </div>
        </div>
        <div class="filter-section">
          <div class="filter-label">難易度</div>
          <div class="chip-group" id="filter-levels">
            ${['Lv.1','Lv.2','Lv.3'].map(l => 
              `<button class="chip ${setup.levels.includes(l)?'active':''}" data-val="${l}">${l}</button>`
            ).join('')}
          </div>
        </div>
        <div class="filter-section">
          <div class="filter-label">対象</div>
          <div class="chip-group" id="filter-target">
            <button class="chip ${setup.filter==='all'?'active':''}" data-val="all">すべて</button>
            <button class="chip ${setup.filter==='unanswered'?'active':''}" data-val="unanswered">未解答のみ</button>
            <button class="chip ${setup.filter==='wrong'?'active':''}" data-val="wrong">誤答のみ</button>
          </div>
        </div>
        <div class="count-row">
          <div class="filter-label" style="margin:0;">出題数</div>
          <div class="count-input">
            <button class="count-btn" id="count-minus">−</button>
            <span class="count-display" id="count-display">${setup.count}</span>
            <button class="count-btn" id="count-plus">+</button>
          </div>
        </div>
        <div id="match-info" style="text-align:center;color:var(--text-secondary);font-size:13px;margin-top:12px;"></div>
      </div>
      <button class="btn-primary" id="start-random">開始する</button>
    `;
    document.getElementById('content').innerHTML = html;

    const updateMatch = () => {
      const units = Array.from(document.querySelectorAll('#filter-units .chip.active')).map(c => c.dataset.val);
      const levels = Array.from(document.querySelectorAll('#filter-levels .chip.active')).map(c => c.dataset.val);
      const filter = document.querySelector('#filter-target .chip.active').dataset.val;
      const progress = this.getProgress();
      
      let matched = this.state.questions.filter(q => 
        units.includes(q.unit) && levels.includes(q.level)
      );
      if (filter === 'unanswered') matched = matched.filter(q => !progress[q.id]);
      if (filter === 'wrong') matched = matched.filter(q => progress[q.id] && !progress[q.id].lastResult);
      
      document.getElementById('match-info').textContent = `該当: ${matched.length}問`;
      return matched;
    };

    ['filter-units','filter-levels','filter-target'].forEach(id => {
      document.getElementById(id).addEventListener('click', e => {
        if (!e.target.classList.contains('chip')) return;
        if (id === 'filter-target') {
          document.querySelectorAll(`#${id} .chip`).forEach(c => c.classList.remove('active'));
          e.target.classList.add('active');
        } else {
          e.target.classList.toggle('active');
          const active = document.querySelectorAll(`#${id} .chip.active`);
          if (active.length === 0) e.target.classList.add('active');
        }
        updateMatch();
      });
    });

    let count = setup.count;
    const countDisp = document.getElementById('count-display');
    document.getElementById('count-minus').addEventListener('click', () => {
      count = Math.max(5, count - 5);
      countDisp.textContent = count;
    });
    document.getElementById('count-plus').addEventListener('click', () => {
      count = Math.min(120, count + 5);
      countDisp.textContent = count;
    });

    updateMatch();

    document.getElementById('start-random').addEventListener('click', () => {
      const matched = updateMatch();
      if (matched.length === 0) { alert('該当する問題がありません'); return; }
      
      const units = Array.from(document.querySelectorAll('#filter-units .chip.active')).map(c => c.dataset.val);
      const levels = Array.from(document.querySelectorAll('#filter-levels .chip.active')).map(c => c.dataset.val);
      const filter = document.querySelector('#filter-target .chip.active').dataset.val;
      this.storage.set('lastFilter', { units, levels, filter, count });
      
      const selected = this.shuffleArray(matched).slice(0, count);
      this.startSession(selected, 'ランダム出題', { from: 'practice-setup' });
    });
  },

  startWeakSession() {
    const weak = this.getWeakQuestions(10);
    if (weak.length === 0) { alert('まずはいくつか問題を解いてください'); return; }
    this.startSession(weak, '弱点克服', { from: 'practice' });
  },

  // ========== セッション管理 ==========
  startSession(questions, title, opts = {}) {
    this.state.currentSession = {
      questions, title, index: 0,
      results: [],
      from: opts.from || 'practice'
    };
    this.saveActiveSession();
    this.navigate('question');
  },

  // ========== 問題画面 ==========
  renderQuestion() {
    const session = this.state.currentSession;
    if (!session) { this.navigate('home'); return; }
    if (session.index >= session.questions.length) {
      this.clearActiveSession();
      this.navigate('session-complete');
      return;
    }

    this.saveActiveSession();

    const q = session.questions[session.index];
    this.state.currentQuestion = q;
    this.setTitle(`${session.title} ${session.index + 1}/${session.questions.length}`);

    const isBookmarked = this.isBookmarked(q.id);
    const lvClass = q.level === 'Lv.1' ? 'lv1' : q.level === 'Lv.2' ? 'lv2' : 'lv3';
    const progress = ((session.index + 1) / session.questions.length) * 100;
    const qProgress = this.getProgress()[q.id];
    const reviewMeta = qProgress && qProgress.attempts
      ? `過去 ${qProgress.correct}/${qProgress.attempts} 正解 ・ 記憶Lv.${qProgress.reviewLevel || 0}${qProgress.nextReviewDate ? ` ・ 次回 ${qProgress.nextReviewDate}` : ''}`
      : '初回出題';

    let html = `
      <div class="question-progress"><div class="fill" style="width:${progress}%"></div></div>
      
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div class="q-meta">
          <span class="tag ${lvClass}">${q.level}</span>
          <span class="tag type">${q.type}</span>
        </div>
        <button class="icon-btn" id="bookmark-btn">${isBookmarked ? '🔖' : '📑'}</button>
      </div>
      
      <div class="q-page">${q.unit} #${q.no} ・ p.${q.page} ・ ${q.section}<br><span class="review-meta-line">🧠 ${reviewMeta}</span><br><span class="see-textbook-link" id="see-textbook">📖 教科書のp.${q.page}を見る</span></div>

      <div class="question-card">${this.escapeHtml(q.question)}</div>

      <div class="choices" id="choices">
        ${['A','B','C','D'].map(letter => `
          <button class="choice" data-letter="${letter}">
            <span class="choice-letter">${letter}</span>
            <span class="choice-text">${this.escapeHtml(q.choices[letter])}</span>
          </button>
        `).join('')}
      </div>

      <div class="answer-actions">
        <button class="btn-primary" id="submit-btn" disabled>解答する</button>
      </div>
    `;
    document.getElementById('content').innerHTML = html;

    let selected = null;
    document.querySelectorAll('.choice').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.choice').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selected = btn.dataset.letter;
        document.getElementById('submit-btn').disabled = false;
        this.vibrate(10);
      });
    });

    document.getElementById('submit-btn').addEventListener('click', () => {
      if (!selected) return;
      this.showAnswer(q, selected);
    });

    document.getElementById('bookmark-btn').addEventListener('click', () => {
      const added = this.toggleBookmark(q.id);
      document.getElementById('bookmark-btn').textContent = added ? '🔖' : '📑';
      this.vibrate(15);
    });

    document.getElementById('see-textbook')?.addEventListener('click', () => {
      this.jumpToTextbook(q.unit, q.page);
    });

    this.setupSwipe();
  },

  showAnswer(q, userAnswer) {
    const isCorrect = userAnswer === q.answer;
    this.recordAnswer(q.id, isCorrect, userAnswer);
    this.storage.set('lastQuestion', { id: q.id, unit: q.unit, no: q.no });
    
    this.state.currentSession.results.push({ q, userAnswer, isCorrect });

    // 閉じた場合は「解答済みの問題」ではなく「次の未解答問題」から再開する
    const savedIndex = this.state.currentSession.index;
    this.state.currentSession.index = Math.min(savedIndex + 1, this.state.currentSession.questions.length);
    if (this.state.currentSession.index >= this.state.currentSession.questions.length) {
      this.clearActiveSession();
    } else {
      this.saveActiveSession();
    }
    this.state.currentSession.index = savedIndex;

    this.vibrate(isCorrect ? [50] : [50, 50, 50]);

    document.querySelectorAll('.choice').forEach(btn => {
      btn.disabled = true;
      btn.classList.remove('selected');
      const letter = btn.dataset.letter;
      if (letter === q.answer) btn.classList.add('correct');
      else if (letter === userAnswer) btn.classList.add('incorrect');
    });

    const banner = `
      <div class="explanation-card">
        <div class="explanation-head">
          <div class="label">📖 解説</div>
          <div class="answer-summary ${isCorrect ? 'correct' : 'incorrect'}">
            <span class="answer-summary-icon">${isCorrect ? '✓' : '×'}</span>
            <span class="answer-summary-title">${isCorrect ? '正解' : '不正解'}</span>
            <span class="answer-summary-meta">正答：${q.answer} ／ あなたの解答：${userAnswer}</span>
          </div>
        </div>
        <div class="text">${this.escapeHtml(q.explanation)}</div>
      </div>
      <div class="fixed-actions">
        <button class="btn-secondary" id="bookmark-after">🔖</button>
        <button class="btn-primary" id="next-btn">次の問題 →</button>
      </div>
    `;
    
    const actionsArea = document.querySelector('.answer-actions');
    actionsArea.outerHTML = '';
    document.getElementById('content').insertAdjacentHTML('beforeend', banner);
    document.getElementById('content').classList.add('has-fixed-bar');
    
    document.getElementById('next-btn').addEventListener('click', () => {
      this.state.currentSession.index++;
      if (this.state.currentSession.index >= this.state.currentSession.questions.length) {
        this.clearActiveSession();
      } else {
        this.saveActiveSession();
      }
      this.navigate('question');
    });
    
    document.getElementById('bookmark-after').addEventListener('click', () => {
      const added = this.toggleBookmark(q.id);
      document.getElementById('bookmark-after').textContent = added ? '🔖 保存済' : '📑 復習';
    });
  },

  setupSwipe() {
    const content = document.getElementById('content');
    let startX = 0, startY = 0;
    content.addEventListener('touchstart', e => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }, { passive: true });
    content.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      if (Math.abs(dx) > 80 && Math.abs(dy) < 50) {
        if (dx < 0 && document.getElementById('next-btn')) {
          document.getElementById('next-btn').click();
        }
      }
    }, { passive: true });
  },

  // ========== セッション完了画面 ==========
  renderSessionComplete() {
    this.clearActiveSession();
    const session = this.state.currentSession;
    this.setTitle('お疲れ様でした！');
    const correct = session.results.filter(r => r.isCorrect).length;
    const total = session.results.length;
    const rate = Math.round(correct / total * 100);

    const html = `
      <div class="exam-result">
        <div style="font-size:64px;">${rate >= 80 ? '🎉' : rate >= 60 ? '😊' : '💪'}</div>
        <h2 style="font-size:28px;font-weight:700;margin:16px 0;">${session.title} 完了</h2>
        
        <div class="result-circle">
          <svg width="200" height="200" viewBox="0 0 200 200">
            <circle cx="100" cy="100" r="85" fill="none" stroke="var(--bg-secondary)" stroke-width="14"/>
            <circle cx="100" cy="100" r="85" fill="none" stroke="${rate >= 75 ? 'var(--success)' : 'var(--warning)'}"
              stroke-width="14" stroke-dasharray="${rate * 5.34} 534" stroke-linecap="round"/>
          </svg>
          <div class="score">
            <div class="num">${rate}%</div>
            <div class="label">正答率</div>
          </div>
        </div>

        <div style="display:flex;gap:16px;justify-content:center;margin:16px 0;">
          <div><div style="font-size:24px;font-weight:700;color:var(--success);">${correct}</div><div style="font-size:12px;color:var(--text-secondary);">正解</div></div>
          <div><div style="font-size:24px;font-weight:700;color:var(--danger);">${total - correct}</div><div style="font-size:12px;color:var(--text-secondary);">不正解</div></div>
        </div>

        <button class="btn-primary" id="finish-session" style="margin-top:24px;">完了</button>
      </div>
    `;
    document.getElementById('content').innerHTML = html;
    document.getElementById('finish-session').addEventListener('click', () => this.navigate('home'));
  },

  // ========== 模擬試験 ==========
  renderExamIntro() {
    this.setTitle('模擬試験');
    const history = this.getExamHistory();

    let html = `
      <div class="exam-intro">
        <div style="font-size:48px;margin-bottom:8px;">🎯</div>
        <h3>本番形式の模擬試験</h3>
        <div class="exam-info">
          <div class="exam-info-row"><span>出題数</span><strong>120問</strong></div>
          <div class="exam-info-row"><span>制限時間</span><strong>3時間30分</strong></div>
          <div class="exam-info-row"><span>出題範囲</span><strong>U1〜U4 全範囲</strong></div>
          <div class="exam-info-row"><span>合格ライン</span><strong>75%</strong></div>
        </div>
        <button class="btn-primary" id="start-exam" style="background:white;color:var(--primary);">🚀 試験開始する</button>
      </div>
      <div class="exam-warning">⚠️ タイマーは停止しません。集中できる環境で開始してください。</div>
    `;

    if (history.length > 0) {
      html += `<div class="section-title">📊 過去の試験結果</div>`;
      history.slice(0, 5).forEach(r => {
        const passed = r.score >= 75;
        html += `
          <div class="review-card">
            <div class="badge" style="background:${passed?'var(--success-light)':'var(--danger-light)'};color:${passed?'var(--success)':'var(--danger)'};">
              ${passed ? '合格' : '不合格'}
            </div>
            <div class="body">
              <div class="title">${r.score}% (${r.correct}/${r.total}問)</div>
              <div class="meta">${r.date} ・ 所要 ${r.duration}</div>
            </div>
          </div>
        `;
      });
    }

    document.getElementById('content').innerHTML = html;
    document.getElementById('start-exam').addEventListener('click', () => this.startExam());
  },

  startExam() {
    if (!confirm('模擬試験を開始します。よろしいですか？\n（タイマーは停止しません）')) return;
    
    const allQ = [...this.state.questions];
    const u1 = this.shuffleArray(allQ.filter(q => q.unit === 'U1')).slice(0, 28);
    const u2 = this.shuffleArray(allQ.filter(q => q.unit === 'U2')).slice(0, 22);
    const u3 = this.shuffleArray(allQ.filter(q => q.unit === 'U3')).slice(0, 38);
    const u4 = this.shuffleArray(allQ.filter(q => q.unit === 'U4')).slice(0, 32);
    const examQ = this.shuffleArray([...u1, ...u2, ...u3, ...u4]);

    this.state.examState = {
      questions: examQ,
      index: 0,
      answers: {},
      flagged: new Set(),
      startTime: Date.now(),
      duration: 3.5 * 60 * 60 * 1000
    };
    this.navigate('exam-active');
  },

  renderExamActive() {
    const exam = this.state.examState;
    if (!exam) { this.navigate('exam'); return; }
    if (exam.index >= exam.questions.length) {
      this.finishExam();
      return;
    }

    const q = exam.questions[exam.index];
    const progress = (exam.index + 1) / exam.questions.length * 100;
    const isFlagged = exam.flagged.has(exam.index);
    const userAns = exam.answers[exam.index];

    this.setTitle(`試験 ${exam.index + 1}/120`);

    let html = `
      <div class="exam-timer">
        <span style="font-size:13px;color:var(--text-secondary);">残り時間</span>
        <span class="timer-display" id="timer">--:--:--</span>
      </div>
      <div class="question-progress"><div class="fill" style="width:${progress}%"></div></div>
      
      <div class="q-meta">
        <span class="tag type">${q.unit} #${q.no}</span>
        <span class="tag ${q.level==='Lv.1'?'lv1':q.level==='Lv.2'?'lv2':'lv3'}">${q.level}</span>
      </div>
      
      <div class="question-card">${this.escapeHtml(q.question)}</div>

      <div class="choices">
        ${['A','B','C','D'].map(letter => `
          <button class="choice ${userAns === letter ? 'selected' : ''}" data-letter="${letter}">
            <span class="choice-letter">${letter}</span>
            <span class="choice-text">${this.escapeHtml(q.choices[letter])}</span>
          </button>
        `).join('')}
      </div>

      <div style="display:flex;align-items:center;gap:8px;margin:16px 0;">
        <button class="chip ${isFlagged?'active':''}" id="flag-btn">${isFlagged?'🚩 マーク済':'🚩 後で見直す'}</button>
      </div>

      <div style="display:flex;gap:10px;margin-top:16px;">
        <button class="btn-secondary" id="prev-btn" style="flex:1;" ${exam.index === 0 ? 'disabled' : ''}>← 前</button>
        <button class="btn-secondary" id="overview-btn" style="flex:1;">一覧</button>
        <button class="btn-primary" id="next-btn" style="flex:1;">${exam.index === exam.questions.length - 1 ? '終了' : '次 →'}</button>
      </div>
    `;
    document.getElementById('content').innerHTML = html;

    document.querySelectorAll('.choice').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.choice').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        exam.answers[exam.index] = btn.dataset.letter;
        this.vibrate(10);
      });
    });

    document.getElementById('flag-btn').addEventListener('click', () => {
      if (exam.flagged.has(exam.index)) exam.flagged.delete(exam.index);
      else exam.flagged.add(exam.index);
      this.renderExamActive();
    });

    document.getElementById('prev-btn').addEventListener('click', () => {
      exam.index--;
      this.renderExamActive();
    });

    document.getElementById('next-btn').addEventListener('click', () => {
      if (exam.index === exam.questions.length - 1) {
        if (confirm('試験を終了しますか？')) this.finishExam();
      } else {
        exam.index++;
        this.renderExamActive();
      }
    });

    document.getElementById('overview-btn').addEventListener('click', () => this.showExamOverview());

    this.startExamTimer();
  },

  startExamTimer() {
    if (this.examTimer) clearInterval(this.examTimer);
    const update = () => {
      const exam = this.state.examState;
      if (!exam) return;
      const elapsed = Date.now() - exam.startTime;
      const remaining = Math.max(0, exam.duration - elapsed);
      const h = Math.floor(remaining / 3600000);
      const m = Math.floor((remaining % 3600000) / 60000);
      const s = Math.floor((remaining % 60000) / 1000);
      const display = document.getElementById('timer');
      if (display) {
        display.textContent = `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        if (remaining < 600000) display.classList.add('warning');
      }
      if (remaining <= 0) {
        clearInterval(this.examTimer);
        alert('時間切れです。試験を終了します。');
        this.finishExam();
      }
    };
    update();
    this.examTimer = setInterval(update, 1000);
  },

  showExamOverview() {
    const exam = this.state.examState;
    let html = '<h3 style="margin-bottom:16px;">問題一覧</h3>';
    html += '<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:16px;">';
    for (let i = 0; i < exam.questions.length; i++) {
      const answered = exam.answers[i] !== undefined;
      const flagged = exam.flagged.has(i);
      const bg = flagged ? 'var(--warning)' : answered ? 'var(--success)' : 'var(--bg-secondary)';
      const color = (flagged || answered) ? 'white' : 'var(--text)';
      html += `<button class="overview-item" data-idx="${i}" style="padding:8px;background:${bg};color:${color};border:none;border-radius:6px;font-weight:600;cursor:pointer;">${i+1}</button>`;
    }
    html += '</div>';
    html += `<div style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">緑=回答済 / 黄=要見直し / 灰=未回答</div>`;

    document.getElementById('modal-body').innerHTML = html;
    document.getElementById('modal').classList.remove('hidden');
    
    document.querySelectorAll('.overview-item').forEach(btn => {
      btn.addEventListener('click', () => {
        exam.index = parseInt(btn.dataset.idx);
        document.getElementById('modal').classList.add('hidden');
        this.renderExamActive();
      });
    });
  },

  finishExam() {
    if (this.examTimer) clearInterval(this.examTimer);
    const exam = this.state.examState;
    let correct = 0;
    const unitStats = { U1: {c:0,t:0}, U2: {c:0,t:0}, U3: {c:0,t:0}, U4: {c:0,t:0} };
    
    exam.questions.forEach((q, i) => {
      const ans = exam.answers[i];
      const isCorrect = ans === q.answer;
      if (isCorrect) correct++;
      unitStats[q.unit].t++;
      if (isCorrect) unitStats[q.unit].c++;
      this.recordAnswer(q.id, isCorrect, ans);
    });

    const elapsed = Date.now() - exam.startTime;
    const h = Math.floor(elapsed / 3600000);
    const m = Math.floor((elapsed % 3600000) / 60000);
    const result = {
      date: this.formatDate(new Date()),
      score: Math.round(correct / exam.questions.length * 100),
      correct, total: exam.questions.length,
      duration: `${h}:${String(m).padStart(2,'0')}`,
      unitStats
    };
    this.saveExamResult(result);
    this.navigate('exam-result', result);
  },

  renderExamResult(r) {
    this.setTitle('試験結果');
    const passed = r.score >= 75;
    
    const html = `
      <div class="exam-result">
        <div class="pass-banner ${passed?'':'fail'}">${passed?'🎉 合格！':'💪 もう一歩！'}</div>
        <div class="result-circle">
          <svg width="200" height="200" viewBox="0 0 200 200">
            <circle cx="100" cy="100" r="85" fill="none" stroke="var(--bg-secondary)" stroke-width="14"/>
            <circle cx="100" cy="100" r="85" fill="none" stroke="${passed?'var(--success)':'var(--warning)'}"
              stroke-width="14" stroke-dasharray="${r.score * 5.34} 534" stroke-linecap="round"/>
          </svg>
          <div class="score">
            <div class="num">${r.score}%</div>
            <div class="label">${r.correct}/${r.total}問</div>
          </div>
        </div>
        <div style="color:var(--text-secondary);margin-bottom:24px;">所要時間: ${r.duration}</div>

        <div class="section-title text-center">ユニット別正答率</div>
        ${['U1','U2','U3','U4'].map(u => {
          const s = r.unitStats[u];
          const pct = Math.round(s.c/s.t*100);
          return `
            <div class="unit-row">
              <span class="unit-name">${u}</span>
              <div class="unit-progress">
                <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
              </div>
              <span class="unit-rate ${pct>=75?'complete':''}">${s.c}/${s.t}</span>
            </div>
          `;
        }).join('')}

        <button class="btn-primary" style="margin-top:24px;" id="back-home">完了</button>
      </div>
    `;
    document.getElementById('content').innerHTML = html;
    document.getElementById('back-home').addEventListener('click', () => this.navigate('home'));
  },

  // ========== 復習画面 ==========
  renderReview() {
    this.setTitle('復習');
    const progress = this.getProgress();
    const bookmarks = this.getBookmarks();
    
    const wrong = this.state.questions.filter(q => 
      progress[q.id] && progress[q.id].lastResult === false
    );
    const bookmarked = this.state.questions.filter(q => bookmarks.includes(q.id));
    const dueReview = this.getDueReviewQuestions(999);
    const todayLearningCount = this.state.settings.todayLearningCount || 20;
    const repeatWrong = this.state.questions.filter(q => {
      const p = progress[q.id];
      if (!p || p.history.length < 2) return false;
      const recent = p.history.slice(-3);
      return recent.every(h => !h.correct);
    });

    const html = `
      <div class="review-tabs">
        <button class="stat-tab active" data-tab="due">今日 ${dueReview.length}</button>
        <button class="stat-tab" data-tab="wrong">誤答 ${wrong.length}</button>
        <button class="stat-tab" data-tab="repeat">連続誤答 ${repeatWrong.length}</button>
        <button class="stat-tab" data-tab="bookmark">🔖 ${bookmarks.length}</button>
      </div>
      <div id="review-content"></div>
      ${dueReview.length > 0 ? `<button class="btn-primary" id="due-review" style="margin-top:16px;">🧠 今日の復習を${Math.min(todayLearningCount, dueReview.length)}問始める</button>` : ''}
      ${wrong.length > 0 ? `<button class="btn-secondary" id="quick-review" style="margin-top:12px;width:100%;">🎲 誤答から5問復習</button>` : ''}
    `;
    document.getElementById('content').innerHTML = html;

    const renderList = (list, emptyMsg) => {
      const c = document.getElementById('review-content');
      if (list.length === 0) {
        c.innerHTML = `<div class="empty-state"><div class="icon">📭</div><div class="text">${emptyMsg}</div></div>`;
        return;
      }
      c.innerHTML = list.map(q => {
        const p = progress[q.id] || {};
        const lvClass = q.level === 'Lv.1' ? 'lv1' : q.level === 'Lv.2' ? 'lv2' : 'lv3';
        return `
          <div class="review-card" data-qid="${q.id}">
            <span class="tag ${lvClass}">${q.level}</span>
            <div class="body">
              <div class="title">${this.escapeHtml(q.question.substring(0, 40))}...</div>
              <div class="meta">${q.unit} #${q.no} ・ ${q.section}${p.attempts ? ` ・ ${p.correct}/${p.attempts}回正解` : ''}</div>
            </div>
          </div>
        `;
      }).join('');
      c.querySelectorAll('.review-card').forEach(card => {
        card.addEventListener('click', () => {
          const qid = card.dataset.qid;
          const q = this.state.questions.find(x => x.id === qid);
          this.startSession([q], '復習', { from: 'review' });
        });
      });
    };

    renderList(dueReview, '今日が復習期限の問題はありません');

    document.querySelectorAll('.stat-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.stat-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const t = tab.dataset.tab;
        if (t === 'due') renderList(dueReview, '今日が復習期限の問題はありません');
        else if (t === 'wrong') renderList(wrong, '誤答した問題はまだありません');
        else if (t === 'repeat') renderList(repeatWrong, '連続誤答の問題はまだありません');
        else renderList(bookmarked, 'ブックマークはまだありません');
      });
    });

    document.getElementById('due-review')?.addEventListener('click', () => {
      this.startDueReviewSession('review');
    });

    document.getElementById('quick-review')?.addEventListener('click', () => {
      const sample = this.shuffleArray(wrong).slice(0, 5);
      this.startSession(sample, '誤答復習', { from: 'review' });
    });
  },

  // ========== 統計画面 ==========
  renderStats() {
    this.setTitle('学習統計');
    const progress = this.getProgress();
    const streak = this.storage.get('streak', { current: 0, longest: 0 });
    const daily = this.storage.get('daily', {});
    
    let totalAttempts = 0, totalCorrect = 0;
    Object.values(progress).forEach(p => {
      totalAttempts += p.attempts;
      totalCorrect += p.correct;
    });
    const overallRate = totalAttempts > 0 ? Math.round(totalCorrect / totalAttempts * 100) : 0;
    
    const unitStats = {};
    ['U1','U2','U3','U4'].forEach(u => {
      const qs = this.state.questions.filter(q => q.unit === u);
      let attempts = 0, correct = 0, answered = 0;
      qs.forEach(q => {
        const p = progress[q.id];
        if (p) {
          answered++;
          attempts += p.attempts;
          correct += p.correct;
        }
      });
      unitStats[u] = {
        total: qs.length, answered,
        rate: attempts > 0 ? Math.round(correct / attempts * 100) : 0
      };
    });
    
    const today = new Date();
    const last7days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = this.formatDate(d);
      last7days.push({ date: key, count: daily[key] || 0 });
    }
    const max7 = Math.max(1, ...last7days.map(d => d.count));

    let html = `
      <div class="chart-container text-center">
        <div class="chart-title">全体正答率</div>
        <div style="font-size:48px;font-weight:800;color:var(--primary);">${overallRate}%</div>
        <div style="color:var(--text-secondary);font-size:13px;margin-top:4px;">${totalCorrect} / ${totalAttempts}回</div>
      </div>

      <div class="chart-container">
        <div class="chart-title">📅 過去7日間の解答数</div>
        <div style="display:flex;align-items:flex-end;gap:6px;height:120px;margin-top:12px;">
          ${last7days.map(d => {
            const h = Math.max(4, d.count / max7 * 100);
            const dayLabel = ['日','月','火','水','木','金','土'][new Date(d.date).getDay()];
            return `
              <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;">
                <div style="font-size:10px;color:var(--text-secondary);">${d.count || ''}</div>
                <div style="width:100%;height:${h}%;background:linear-gradient(180deg,var(--primary),var(--accent));border-radius:6px 6px 0 0;min-height:4px;"></div>
                <div style="font-size:10px;color:var(--text-secondary);">${dayLabel}</div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <div class="chart-container">
        <div class="chart-title">📚 ユニット別習熟度</div>
        ${['U1','U2','U3','U4'].map(u => {
          const s = unitStats[u];
          return `
            <div style="margin-top:12px;">
              <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                <span style="font-weight:600;">${u}</span>
                <span style="font-size:13px;"><span style="color:var(--text-secondary);">${s.answered}/${s.total}問</span> ・ <strong>${s.rate}%</strong></span>
              </div>
              <div class="progress-bar"><div class="progress-fill" style="width:${s.rate}%"></div></div>
            </div>
          `;
        }).join('')}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;">
        <div class="stat-card text-center">
          <div class="label">🔥 現在の連続</div>
          <div class="value" style="color:#F97316;">${streak.current}日</div>
        </div>
        <div class="stat-card text-center">
          <div class="label">🏆 最長記録</div>
          <div class="value" style="color:var(--warning);">${streak.longest}日</div>
        </div>
      </div>

      <button class="btn-secondary" id="export-data" style="width:100%;margin-top:24px;">📤 学習データをエクスポート</button>
    `;
    document.getElementById('content').innerHTML = html;

    document.getElementById('export-data').addEventListener('click', () => this.exportData());
  },

  exportData() {
    const data = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      progress: this.getProgress(),
      bookmarks: this.getBookmarks(),
      streak: this.storage.get('streak'),
      daily: this.storage.get('daily'),
      exams: this.getExamHistory(),
      settings: this.state.settings
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cams-backup-${this.formatDate(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  // ========== 検索画面 ==========
  renderSearch() {
    this.setTitle('検索');
    const html = `
      <input type="search" class="search-input" id="search-input" placeholder="キーワードで検索（問題文・解説）..." autofocus>
      <div id="search-results"></div>
    `;
    document.getElementById('content').innerHTML = html;

    const input = document.getElementById('search-input');
    const results = document.getElementById('search-results');

    let timer;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const q = input.value.trim().toLowerCase();
        if (q.length < 2) {
          results.innerHTML = '<div class="empty-state"><div class="icon">🔍</div><div class="text">2文字以上で検索</div></div>';
          return;
        }
        const matched = this.state.questions.filter(qu => 
          qu.question.toLowerCase().includes(q) || 
          qu.explanation.toLowerCase().includes(q) ||
          qu.section.toLowerCase().includes(q) ||
          qu.subsection.toLowerCase().includes(q)
        ).slice(0, 30);
        
        if (matched.length === 0) {
          results.innerHTML = '<div class="empty-state"><div class="icon">😕</div><div class="text">該当する問題が見つかりません</div></div>';
          return;
        }
        
        results.innerHTML = `
          <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">${matched.length}件の結果</div>
          ${matched.map(qu => {
            const lvClass = qu.level === 'Lv.1' ? 'lv1' : qu.level === 'Lv.2' ? 'lv2' : 'lv3';
            return `
              <div class="review-card" data-qid="${qu.id}">
                <span class="tag ${lvClass}">${qu.level}</span>
                <div class="body">
                  <div class="title">${this.escapeHtml(qu.question.substring(0, 50))}...</div>
                  <div class="meta">${qu.unit} #${qu.no} ・ ${qu.section}</div>
                </div>
              </div>
            `;
          }).join('')}
        `;
        
        results.querySelectorAll('.review-card').forEach(card => {
          card.addEventListener('click', () => {
            const qu = this.state.questions.find(x => x.id === card.dataset.qid);
            this.startSession([qu], '検索結果', { from: 'search' });
          });
        });
      }, 300);
    });
  },

  // ========== 設定モーダル ==========
  showSettings() {
    const s = this.state.settings;
    document.getElementById('modal-body').innerHTML = `
      <h3 style="margin-bottom:16px;font-size:18px;">⚙️ 設定</h3>
      <div class="setting-row">
        <span class="label">🌙 ダークモード</span>
        <div class="toggle ${s.darkMode?'on':''}" id="set-dark"></div>
      </div>
      <div class="setting-row">
        <span class="label">🎯 1日の目標</span>
        <div class="count-input">
          <button class="count-btn" id="goal-minus">−</button>
          <span class="count-display" id="goal-display">${s.dailyGoal}問</span>
          <button class="count-btn" id="goal-plus">+</button>
        </div>
      </div>
      <div class="setting-row">
        <span class="label">📤 データエクスポート</span>
        <button class="btn-secondary" id="set-export">📥 保存</button>
      </div>
      <div class="setting-row">
        <span class="label" style="color:var(--danger);">🗑 全データ削除</span>
        <button class="btn-secondary" id="set-reset" style="color:var(--danger);">削除</button>
      </div>
      <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border);text-align:center;font-size:12px;color:var(--text-light);">
        CAMS試験対策 PWA v1.0<br>
        全${this.state.questions.length}問 / スタディガイド v7.03 完全網羅
      </div>
    `;
    document.getElementById('modal').classList.remove('hidden');

    document.getElementById('set-dark').addEventListener('click', () => {
      this.state.settings.darkMode = !this.state.settings.darkMode;
      this.saveSettings();
      this.applyTheme();
      document.getElementById('set-dark').classList.toggle('on');
    });

    let goal = s.dailyGoal;
    document.getElementById('goal-minus').addEventListener('click', () => {
      goal = Math.max(1, goal - 1);
      document.getElementById('goal-display').textContent = goal + '問';
      this.state.settings.dailyGoal = goal;
      this.saveSettings();
    });
    document.getElementById('goal-plus').addEventListener('click', () => {
      goal = Math.min(50, goal + 1);
      document.getElementById('goal-display').textContent = goal + '問';
      this.state.settings.dailyGoal = goal;
      this.saveSettings();
    });

    document.getElementById('set-export').addEventListener('click', () => this.exportData());
    
    document.getElementById('set-reset').addEventListener('click', () => {
      if (confirm('すべての学習データを削除しますか？\n（この操作は取り消せません）')) {
        if (confirm('本当に削除しますか？\n進捗、誤答リスト、ブックマーク、試験履歴がすべて消えます。')) {
          ['progress','bookmarks','streak','daily','exams','lastQuestion','lastFilter','activeSession'].forEach(k => {
            localStorage.removeItem(`cams.${k}`);
          });
          alert('削除しました');
          location.reload();
        }
      }
    });
  },

  // ========== 教科書モード ==========
  renderTextbookHome() {
    this.setTitle('教科書');
    
    if (!this.state.textbook) {
      document.getElementById('content').innerHTML = `
        <div class="empty-state">
          <div class="icon">📚</div>
          <div class="text">教科書データを読み込めませんでした</div>
        </div>
      `;
      return;
    }

    const lastRead = this.storage.get('lastTextbookPage', null);
    
    let html = `
      <div style="margin-bottom:16px;">
        <h2 style="font-size:22px;font-weight:700;margin-bottom:4px;">📖 スタディガイド</h2>
        <p style="color:var(--text-secondary);font-size:13px;">CAMS試験対策v7.03 全モジュール</p>
      </div>
    `;
    
    if (lastRead) {
      const tb = this.state.textbook[lastRead.unit];
      if (tb) {
        html += `
          <div class="continue-card" id="continue-textbook">
            <div class="label">📖 続きから</div>
            <div class="title">${tb.title} p.${lastRead.page}</div>
            <div class="meta">タップで再開 →</div>
          </div>
        `;
      }
    }

    html += `<div class="section-title">ユニット選択</div>`;

    const units = ['U1', 'U2', 'U3', 'U4', 'U5'];
    units.forEach(code => {
      const tb = this.state.textbook[code];
      if (!tb) return;
      const typeLabel = tb.type === 'image' ? '画像表示' : 'テキスト表示';
      html += `
        <div class="textbook-unit-card" data-unit="${code}">
          <div class="textbook-unit-icon">${code}</div>
          <div class="textbook-unit-info">
            <div class="title">${tb.title}</div>
            <div class="meta">${tb.total_pages}ページ ・ ${typeLabel}</div>
          </div>
          <div class="textbook-unit-arrow">›</div>
        </div>
      `;
    });

    document.getElementById('content').innerHTML = html;

    document.querySelectorAll('.textbook-unit-card').forEach(card => {
      card.addEventListener('click', () => {
        const unit = card.dataset.unit;
        this.navigate('textbook-viewer', { unit, pageIdx: 0 });
      });
    });

    if (lastRead) {
      document.getElementById('continue-textbook')?.addEventListener('click', () => {
        const tb = this.state.textbook[lastRead.unit];
        const pageIdx = tb.pages.findIndex(p => String(p.page) === String(lastRead.page));
        this.navigate('textbook-viewer', { 
          unit: lastRead.unit, 
          pageIdx: pageIdx >= 0 ? pageIdx : 0 
        });
      });
    }
  },

  renderTextbookViewer(params) {
    const unit = params.unit || this.state.textbookState.unit;
    let pageIdx = params.pageIdx !== undefined ? params.pageIdx : this.state.textbookState.page || 0;
    
    const tb = this.state.textbook[unit];
    if (!tb) { this.navigate('textbook'); return; }
    
    pageIdx = Math.max(0, Math.min(tb.total_pages - 1, pageIdx));
    const page = tb.pages[pageIdx];
    
    this.state.textbookState = { unit, page: pageIdx };
    this.setTitle(`${tb.title}`);
    this.storage.set('lastTextbookPage', { unit, page: page.page, pageIdx });

    const fontSize = this.state.settings.textbookFontSize || 16;

    let html = `
      <div class="textbook-controls">
        <button class="textbook-nav-btn" id="tb-prev" ${pageIdx === 0 ? 'disabled' : ''}>‹</button>
        <div class="textbook-page-jump">
          <span style="font-size:13px;color:var(--text-secondary);">p.</span>
          <input type="text" id="tb-page-input" value="${page.page}" inputmode="numeric">
          <span class="total">/ ${tb.pages[tb.pages.length-1].page}</span>
        </div>
        <button class="textbook-nav-btn" id="tb-next" ${pageIdx === tb.total_pages - 1 ? 'disabled' : ''}>›</button>
        <div class="textbook-font-size">
          <button data-size="14" class="${fontSize===14?'active':''}">A</button>
          <button data-size="16" class="${fontSize===16?'active':''}">A</button>
          <button data-size="18" class="${fontSize===18?'active':''}">A</button>
        </div>
      </div>
    `;

    if (tb.type === 'text') {
      html += `<div class="textbook-page-content" style="--tb-font-size:${fontSize}px;font-size:${fontSize}px;">${page.html}</div>`;
    } else {
      html += `<div class="textbook-image-wrapper"><img src="${page.image}" alt="p.${page.page}" loading="eager"></div>`;
    }

    html += `
      <div class="textbook-bottom-nav">
        <button id="tb-prev-bottom" ${pageIdx === 0 ? 'disabled' : ''}>← 前のページ</button>
        <button id="tb-next-bottom" ${pageIdx === tb.total_pages - 1 ? 'disabled' : ''}>次のページ →</button>
      </div>
    `;

    document.getElementById('content').innerHTML = html;

    const goPage = (idx) => {
      this.navigate('textbook-viewer', { unit, pageIdx: idx });
    };

    document.getElementById('tb-prev')?.addEventListener('click', () => goPage(pageIdx - 1));
    document.getElementById('tb-next')?.addEventListener('click', () => goPage(pageIdx + 1));
    document.getElementById('tb-prev-bottom')?.addEventListener('click', () => goPage(pageIdx - 1));
    document.getElementById('tb-next-bottom')?.addEventListener('click', () => goPage(pageIdx + 1));

    document.getElementById('tb-page-input')?.addEventListener('change', (e) => {
      const val = e.target.value.trim();
      const idx = tb.pages.findIndex(p => String(p.page) === String(val));
      if (idx >= 0) goPage(idx);
      else e.target.value = page.page;
    });

    document.querySelectorAll('.textbook-font-size button').forEach(btn => {
      btn.addEventListener('click', () => {
        const size = parseInt(btn.dataset.size);
        this.state.settings.textbookFontSize = size;
        this.saveSettings();
        this.renderTextbookViewer({ unit, pageIdx });
      });
    });

    // スワイプでページめくり
    this.setupTextbookSwipe(unit, pageIdx);
  },

  setupTextbookSwipe(unit, pageIdx) {
    const content = document.getElementById('content');
    let startX = 0, startY = 0;
    const onStart = (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    };
    const onEnd = (e) => {
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      if (Math.abs(dx) > 80 && Math.abs(dy) < 50) {
        const tb = this.state.textbook[unit];
        if (dx < 0 && pageIdx < tb.total_pages - 1) {
          this.navigate('textbook-viewer', { unit, pageIdx: pageIdx + 1 });
        } else if (dx > 0 && pageIdx > 0) {
          this.navigate('textbook-viewer', { unit, pageIdx: pageIdx - 1 });
        }
      }
    };
    content.addEventListener('touchstart', onStart, { passive: true });
    content.addEventListener('touchend', onEnd, { passive: true });
  },

  // 問題画面から該当ページへジャンプ
  jumpToTextbook(unit, pageNum) {
    if (!this.state.textbook || !this.state.textbook[unit]) {
      alert('該当の教科書ページが見つかりません');
      return;
    }
    const tb = this.state.textbook[unit];
    const idx = tb.pages.findIndex(p => String(p.page) === String(pageNum));
    if (idx >= 0) {
      this.navigate('textbook-viewer', { unit, pageIdx: idx });
    } else {
      // 近いページを探す
      const numPage = parseInt(pageNum);
      let closest = -1, minDiff = Infinity;
      tb.pages.forEach((p, i) => {
        const pn = parseInt(p.page);
        if (!isNaN(pn)) {
          const diff = Math.abs(pn - numPage);
          if (diff < minDiff) { minDiff = diff; closest = i; }
        }
      });
      if (closest >= 0) {
        this.navigate('textbook-viewer', { unit, pageIdx: closest });
      } else {
        this.navigate('textbook-viewer', { unit, pageIdx: 0 });
      }
    }
  },

  escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }
};

// 起動
document.addEventListener('DOMContentLoaded', () => App.init());
