// ========================================
// NITKnot — Frontend Application (Production Ready)
// ========================================

const API = '';
const INTEREST_OPTIONS = [
  "Coding","Music","Sports","Travel","Photography","Reading",
  "Gaming","Cooking","Art","Dance","Fitness","Movies",
  "Anime","Food","Nature","Poetry","Chess","Startups","Astronomy","Robotics"
];

const COMMON_EMOJIS = ['😊','😂','❤️','💕','😍','🤩','😎','🥺','😭','😅',
  '🔥','✨','💯','🎉','👍','😄','🤔','🙈','💪','🌟',
  '😘','🤗','😌','🥰','😜','🎂','👏','🤝','✌️','💖'];

let socket = null;
let currentView = '';
let currentMatchId = null;
let currentMatchedUser = null;

// ========================================
// Socket
// ========================================
function initSocket() {
  if (socket && socket.connected) return;
  if (typeof io !== 'function') {
    console.warn('Socket.io not available');
    return;
  }

  socket = io({ reconnection: true, reconnectionAttempts: 10, reconnectionDelay: 2000 });

  socket.on('connect', () => {
    const user = getCachedUser();
    if (user) socket.emit('register', user.id);
  });

  socket.on('match_found', (data) => {
    // data = { match_id, user: {...} }
    if (data && data.user) {
      showMatch(data.user, data.match_id);
    }
  });

  socket.on('new_message', (msg) => {
    if (!msg) return;
    if (currentView === 'chatConvo' && window._chatMatchId == msg.match_id) {
      appendMessage(msg);
      markAsRead(msg.match_id);
    } else if (currentView === 'chat') {
      renderChatList();
    } else {
      showToast(`💬 ${msg.sender_name}: ${(msg.text || '📷 Photo').substring(0, 40)}`, 'info');
      updateChatBadge();
    }
  });

  socket.on('message_sent', (msg) => {
    // Confirm our own message was saved
  });

  socket.on('message_deleted', ({ messageId, matchId }) => {
    if (currentView === 'chatConvo' && window._chatMatchId == matchId) {
      const el = document.getElementById('msg-' + messageId);
      if (el) el.remove();
    }
  });

  socket.on('messages_read', ({ matchId }) => {
    if (currentView === 'chatConvo' && window._chatMatchId == matchId) {
      document.querySelectorAll('.msg-sent-container .msg-status').forEach(el => {
        el.textContent = '✓✓'; el.style.color = '#34b7f1';
      });
    }
  });

  socket.on('online_status', ({ userId, online }) => {
    if (currentView === 'chatConvo' && window._chatToUserId == userId) {
      const el = document.getElementById('chat-online-status');
      if (el) {
        el.textContent = online ? 'Online' : 'Offline';
        el.style.color = online ? 'var(--success)' : 'var(--text-muted)';
      }
    }
  });

  socket.on('typing_start', ({ fromUserId }) => {
    if (currentView === 'chatConvo' && window._chatToUserId == fromUserId) {
      const el = document.getElementById('typing-area');
      if (el) el.classList.remove('hidden');
    }
  });

  socket.on('typing_stop', ({ fromUserId }) => {
    if (currentView === 'chatConvo' && window._chatToUserId == fromUserId) {
      const el = document.getElementById('typing-area');
      if (el) el.classList.add('hidden');
    }
  });

  socket.on('super_like_received', ({ name }) => {
    showToast(`⭐ ${name} super-liked you!`, 'info');
  });
}

// ========================================
// Auth
// ========================================
function getToken() { return localStorage.getItem('nk_token'); }
function setToken(t) { localStorage.setItem('nk_token', t); }
function clearToken() { localStorage.removeItem('nk_token'); localStorage.removeItem('nk_user'); }
function getCachedUser() { try { return JSON.parse(localStorage.getItem('nk_user')); } catch { return null; } }
function setCachedUser(u) { localStorage.setItem('nk_user', JSON.stringify(u)); }

async function apiFetch(path, opts = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${API}${path}`, { ...opts, headers });
  } catch (e) {
    throw new Error('Network error — check your connection');
  }

  let data;
  try { data = await res.json(); } catch { data = {}; }

  if (!res.ok) {
    if (res.status === 401) {
      const isAuthRoute = path.includes('/auth/login') || path.includes('/auth/register') || path.includes('/auth/send-otp') || path.includes('/auth/verify-otp');
      if (!isAuthRoute) {
        clearToken();
        navigate('landing');
        throw new Error('Session expired. Please login again.');
      }
    }
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

async function apiUpload(path, formData) {
  const token = getToken();
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${API}${path}`, { method: 'POST', headers, body: formData });
  } catch (e) {
    throw new Error('Network error — check your connection');
  }
  let data;
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data;
}

function markAsRead(matchId) {
  apiFetch(`/api/messages/${matchId}/read`, { method: 'POST' }).catch(() => {});
}

async function updateChatBadge() {
  try {
    const data = await apiFetch('/api/matches');
    const total = (data.matches || []).reduce((s, m) => s + (m.unread_count || 0), 0);
    const badge = document.getElementById('nav-chat-badge');
    if (badge) {
      if (total > 0) { badge.textContent = total > 9 ? '9+' : total; badge.classList.remove('hidden'); }
      else { badge.classList.add('hidden'); }
    }
  } catch {}
}

// ========================================
// Helpers
// ========================================
function defaultAvatar(name = 'user') {
  return `https://api.dicebear.com/7.x/adventurer/svg?seed=${encodeURIComponent(name)}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`;
}

function escapeHtml(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

function formatTime(t) {
  if (!t) return '';
  const d = new Date(t);
  if (isNaN(d)) return '';
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'now';
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diff < 7 * 24 * 60 * 60 * 1000) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function showToast(msg, type = '', duration = 3000) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast ' + type;
  clearTimeout(t._tid);
  t._tid = setTimeout(() => t.classList.add('hidden'), duration);
}

function openImageViewer(url) {
  const viewer = document.getElementById('image-viewer');
  const img = document.getElementById('image-viewer-img');
  if (!viewer || !img) return;
  img.src = url;
  viewer.classList.remove('hidden');
}

function closeImageViewer() {
  document.getElementById('image-viewer')?.classList.add('hidden');
}

// ========================================
// Router
// ========================================
function navigate(view, data) {
  currentView = view;
  const app = document.getElementById('app');
  const nav = document.getElementById('bottom-nav');

  const mainViews = ['discover', 'connections', 'chat', 'likes', 'profile'];
  if (mainViews.includes(view)) {
    nav.classList.remove('hidden');
    document.querySelectorAll('.nav-item').forEach(n => {
      n.classList.toggle('active', n.dataset.view === view);
    });
  } else {
    nav.classList.add('hidden');
  }

  // Stop chat polling when leaving chat
  if (view !== 'chatConvo') stopChatPoll();

  if (getToken() && !socket) initSocket();

  app.innerHTML = '';

  const routes = {
    landing: renderLanding,
    login: renderLogin,
    signup: renderSignup,
    discover: renderDiscover,
    connections: renderConnections,
    chat: renderChatList,
    chatConvo: () => renderChatConvo(data),
    likes: renderLikes,
    profile: renderProfile,
    viewProfile: () => renderViewProfile(data),
    editProfile: renderEditProfile,
  };

  if (routes[view]) routes[view]();
  else renderLanding();
}

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => navigate(btn.dataset.view));
});

// ========================================
// Landing
// ========================================
function renderLanding() {
  document.getElementById('app').innerHTML = `
    <div class="landing-page view-animate">
      <div class="hero-section">
        <div class="hero-logo">NITKnot 💕</div>
        <p class="hero-tagline">Swipe. Match. Connect.</p>
        <p class="hero-subtext">The dating app made exclusively for NITK Surathkal students. Find your campus connection today.</p>
        <div class="hero-actions">
          <button class="btn-primary" onclick="navigate('signup')">
            <span class="material-symbols-outlined fill-icon">favorite</span>Start Swiping
          </button>
          <button class="btn-secondary" onclick="navigate('login')">
            <span class="material-symbols-outlined">login</span>Log In
          </button>
        </div>
      </div>
      <div class="landing-features" style="padding:32px 20px 60px">
        <h3 style="font-size:1.3rem;font-weight:800;margin-bottom:16px;text-align:center">Why NITKnot?</h3>
        <div class="features-grid">
          <div class="feature-card">
            <span class="material-symbols-outlined fill-icon">verified_user</span>
            <h4>NITK Verified</h4>
            <p>Only real students with nitk.edu.in emails</p>
          </div>
          <div class="feature-card">
            <span class="material-symbols-outlined fill-icon">style</span>
            <h4>Smart Matching</h4>
            <p>Matches based on shared interests</p>
          </div>
          <div class="feature-card">
            <span class="material-symbols-outlined fill-icon">chat_bubble</span>
            <h4>Real-time Chat</h4>
            <p>Message instantly with your matches</p>
          </div>
          <div class="feature-card">
            <span class="material-symbols-outlined fill-icon">security</span>
            <h4>Safe & Private</h4>
            <p>Easy reporting, anonymous until match</p>
          </div>
        </div>
      </div>
    </div>`;
}

// ========================================
// Login
// ========================================
function renderLogin() {
  document.getElementById('app').innerHTML = `
    <div class="auth-page view-animate">
      <div class="auth-header">
        <button class="btn-icon" onclick="navigate('landing')"><span class="material-symbols-outlined">arrow_back</span></button>
        <h2>Log In</h2>
      </div>
      <div class="auth-body">
        <div class="auth-icon-wrap">
          <div class="auth-icon"><span class="material-symbols-outlined fill-icon">lock_open</span></div>
        </div>
        <h1 class="auth-title font-serif">Welcome Back</h1>
        <p class="auth-subtitle">Enter your NITK credentials</p>
        <div style="display:flex;flex-direction:column;gap:14px">
          <div class="input-group">
            <label>NITK Email</label>
            <input type="email" class="input-field" id="login-email" placeholder="yourname@nitk.edu.in" autocomplete="email">
          </div>
          <div class="input-group">
            <label>Password</label>
            <input type="password" class="input-field" id="login-pass" placeholder="Enter password" autocomplete="current-password">
          </div>
          <button class="btn-primary" id="login-btn" onclick="doLogin()">
            <span class="material-symbols-outlined">login</span>Log In
          </button>
          <p style="text-align:center;font-size:0.85rem">
            <a onclick="promptForgotPassword()" style="color:var(--text-secondary);cursor:pointer">Forgot password?</a>
          </p>
        </div>
      </div>
      <div class="auth-footer">
        Don't have an account? <a onclick="navigate('signup')">Sign Up</a>
      </div>
    </div>`;

  document.getElementById('login-pass').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });
}

async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-pass').value;
  if (!email || !pass) return showToast('Fill in all fields', 'error');
  if (!email.toLowerCase().endsWith('@nitk.edu.in')) return showToast('Only @nitk.edu.in emails allowed', 'error');

  const btn = document.getElementById('login-btn');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:20px;height:20px"></div> Logging in...';

  try {
    const data = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password: pass }) });
    setToken(data.token);
    setCachedUser(data.user);
    initSocket();
    showToast('Welcome back! 💕', 'success');
    navigate('discover');
  } catch (e) {
    showToast(e.message, 'error');
    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined">login</span>Log In';
  }
}

async function promptForgotPassword() {
  const email = prompt('Enter your NITK email to reset password:');
  if (!email) return;
  try {
    await apiFetch('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
    showToast('Temporary password sent! Check your email.', 'success');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ========================================
// Signup (Multi-step)
// ========================================
let signupStep = 1, signupData = {}, otpSent = false, otpVerified = false;

function renderSignup() {
  signupStep = 1; signupData = { interests: [] };
  otpSent = false; otpVerified = false;
  renderSignupStep();
}

function renderSignupStep() {
  [renderStep1, renderStep2, renderStep3, renderStep4, renderStep5][signupStep - 1]();
}

function stepBar() {
  return `<div class="step-progress">${[1,2,3,4,5].map(i => `<div class="step-bar ${i <= signupStep ? 'active' : ''}"></div>`).join('')}</div>`;
}

function renderStep1() {
  document.getElementById('app').innerHTML = `
    <div class="auth-page view-animate">
      <div class="auth-header">
        <button class="btn-icon" onclick="navigate('landing')"><span class="material-symbols-outlined">arrow_back</span></button>
        <h2>Verify Email</h2>
      </div>
      <div class="auth-body">
        ${stepBar()}
        <div class="auth-icon-wrap"><div class="auth-icon"><span class="material-symbols-outlined fill-icon">mail_lock</span></div></div>
        <h1 class="auth-title font-serif" style="font-size:1.4rem">NITK Email Verification</h1>
        <p class="auth-subtitle">We'll send a 6-digit OTP to your college email</p>
        <div style="display:flex;flex-direction:column;gap:14px">
          <div class="input-group">
            <label>NITK Email</label>
            <input class="input-field" id="s-email" type="email" placeholder="yourname@nitk.edu.in"
              value="${escapeHtml(signupData.email || '')}" ${otpVerified ? 'disabled style="opacity:0.6"' : ''} autocomplete="email">
          </div>
          ${!otpSent ? `
            <button class="btn-primary" id="send-otp-btn" onclick="sendOtpAction()">
              <span class="material-symbols-outlined">send</span>Send OTP
            </button>
          ` : !otpVerified ? `
            <div class="input-group">
              <label>6-digit OTP</label>
              <input class="input-field" id="s-otp" type="number" placeholder="123456" maxlength="6"
                style="font-size:1.5rem;text-align:center;letter-spacing:8px;font-weight:800" autocomplete="one-time-code">
            </div>
            <button class="btn-primary" id="verify-otp-btn" onclick="verifyOtpAction()">
              <span class="material-symbols-outlined">verified</span>Verify OTP
            </button>
            <button class="btn-ghost" onclick="resendOtp()">Didn't receive it? Resend OTP</button>
          ` : `
            <div style="display:flex;align-items:center;gap:10px;padding:14px 16px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:12px">
              <span class="material-symbols-outlined fill-icon" style="color:#10b981;font-size:22px">check_circle</span>
              <span style="color:#10b981;font-weight:700">Email verified!</span>
            </div>
            <button class="btn-primary" onclick="signupStep=2;renderSignupStep()">
              Continue <span class="material-symbols-outlined">arrow_forward</span>
            </button>
          `}
        </div>
      </div>
    </div>`;
}

async function sendOtpAction() {
  const email = document.getElementById('s-email')?.value.trim();
  if (!email) return showToast('Enter your NITK email', 'error');
  if (!email.toLowerCase().endsWith('@nitk.edu.in')) return showToast('Only @nitk.edu.in emails allowed!', 'error');
  const btn = document.getElementById('send-otp-btn');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:18px;height:18px"></div> Sending...';
  try {
    await apiFetch('/api/auth/send-otp', { method: 'POST', body: JSON.stringify({ email }) });
    signupData.email = email;
    otpSent = true;
    showToast('OTP sent! Check your inbox 📧', 'success');
    renderStep1();
  } catch (e) {
    showToast(e.message, 'error');
    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined">send</span>Send OTP';
  }
}

async function verifyOtpAction() {
  const otp = document.getElementById('s-otp')?.value.trim();
  if (!otp || otp.length !== 6) return showToast('Enter the 6-digit OTP', 'error');
  const btn = document.getElementById('verify-otp-btn');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:18px;height:18px"></div> Verifying...';
  try {
    await apiFetch('/api/auth/verify-otp', { method: 'POST', body: JSON.stringify({ email: signupData.email, otp }) });
    otpVerified = true;
    showToast('Email verified! ✅', 'success');
    renderStep1();
  } catch (e) {
    showToast(e.message, 'error');
    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined">verified</span>Verify OTP';
  }
}

function resendOtp() {
  otpSent = false;
  renderStep1();
  setTimeout(() => sendOtpAction(), 50);
}

function extractNameFromEmail(email) {
  const prefix = email.split('@')[0];
  const parts = prefix.split('.');
  const nameParts = parts.filter(p => /^[a-zA-Z]/.test(p));
  return nameParts.map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ') || prefix;
}

function renderStep2() {
  if (!signupData.name) signupData.name = extractNameFromEmail(signupData.email);
  document.getElementById('app').innerHTML = `
    <div class="auth-page view-animate">
      <div class="auth-header">
        <button class="btn-icon" onclick="signupStep=1;renderSignupStep()"><span class="material-symbols-outlined">arrow_back</span></button>
        <h2>Your Details</h2>
      </div>
      <div class="auth-body">
        ${stepBar()}
        <h1 class="auth-title font-serif" style="font-size:1.4rem">Let's set up your profile</h1>
        <div style="display:flex;flex-direction:column;gap:14px">
          <div class="input-group"><label>Email (verified)</label>
            <input class="input-field" value="${escapeHtml(signupData.email)}" disabled style="opacity:0.5">
          </div>
          <div class="input-group"><label>Full Name</label>
            <input class="input-field" id="s-name" placeholder="Your name" value="${escapeHtml(signupData.name || '')}" autocomplete="name">
          </div>
          <div class="input-group"><label>Password (min 4 chars)</label>
            <input type="password" class="input-field" id="s-pass" placeholder="Create a strong password" autocomplete="new-password">
          </div>
          <div class="input-group"><label>Age</label>
            <input type="number" class="input-field" id="s-age" placeholder="18" min="18" max="30" value="${signupData.age || ''}">
          </div>
          <button class="btn-primary" onclick="nextStep2()">Continue</button>
        </div>
      </div>
    </div>`;
  document.getElementById('s-name').focus();
}

function nextStep2() {
  const name = document.getElementById('s-name').value.trim();
  const pass = document.getElementById('s-pass').value;
  const age = parseInt(document.getElementById('s-age').value);
  if (!name) return showToast('Enter your name', 'error');
  if (!pass || pass.length < 4) return showToast('Password must be 4+ characters', 'error');
  if (!age || age < 18 || age > 30) return showToast('Age must be between 18 and 30', 'error');
  Object.assign(signupData, { name, password: pass, age });
  signupStep = 3; renderSignupStep();
}

function renderStep3() {
  document.getElementById('app').innerHTML = `
    <div class="auth-page view-animate">
      <div class="auth-header">
        <button class="btn-icon" onclick="signupStep=2;renderSignupStep()"><span class="material-symbols-outlined">arrow_back</span></button>
        <h2>About You</h2>
      </div>
      <div class="auth-body">
        ${stepBar()}
        <h1 class="auth-title font-serif" style="font-size:1.4rem">Tell Us More</h1>
        <div style="display:flex;flex-direction:column;gap:14px">
          <div class="input-group"><label>Gender</label>
            <div class="gender-select">
              <button class="gender-btn ${signupData.gender === 'male' ? 'active' : ''}" onclick="pickGender('male')">Male</button>
              <button class="gender-btn ${signupData.gender === 'female' ? 'active' : ''}" onclick="pickGender('female')">Female</button>
              <button class="gender-btn ${signupData.gender === 'other' ? 'active' : ''}" onclick="pickGender('other')">Other</button>
            </div>
          </div>
          <div class="input-group"><label>Branch</label>
            <select class="input-field" id="s-branch">
              <option value="">Select branch</option>
              ${["Computer Science","IT","Electronics","EEE","Mechanical","Civil","Chemical","Metallurgy","Mining","Math & Computing","Physics"].map(b => `<option value="${b}" ${signupData.branch === b ? 'selected' : ''}>${b}</option>`).join('')}
            </select>
          </div>
          <div class="input-group"><label>Year</label>
            <select class="input-field" id="s-year">
              <option value="">Select year</option>
              ${["1st Year","2nd Year","3rd Year","4th Year","M.Tech","PhD"].map(y => `<option value="${y}" ${signupData.year === y ? 'selected' : ''}>${y}</option>`).join('')}
            </select>
          </div>
          <div class="input-group"><label>Bio</label>
            <textarea class="textarea-field" id="s-bio" placeholder="Tell people about yourself...">${escapeHtml(signupData.bio || '')}</textarea>
          </div>
          <button class="btn-primary" onclick="nextStep3()">Continue</button>
        </div>
      </div>
    </div>`;
}

function pickGender(g) {
  signupData.gender = g;
  document.querySelectorAll('.gender-btn').forEach(b => {
    b.classList.toggle('active', b.textContent.toLowerCase() === g || (g === 'female' && b.textContent === 'Female') || (g === 'other' && b.textContent === 'Other'));
  });
}

function nextStep3() {
  const branch = document.getElementById('s-branch').value;
  const year = document.getElementById('s-year').value;
  const bio = document.getElementById('s-bio').value.trim();
  if (!signupData.gender) return showToast('Select your gender', 'error');
  if (!branch) return showToast('Select your branch', 'error');
  if (!year) return showToast('Select your year', 'error');
  Object.assign(signupData, { branch, year, bio: bio || "Hey there! I'm on NITKnot 💕" });
  signupStep = 4; renderSignupStep();
}

function renderStep4() {
  document.getElementById('app').innerHTML = `
    <div class="auth-page view-animate">
      <div class="auth-header">
        <button class="btn-icon" onclick="signupStep=3;renderSignupStep()"><span class="material-symbols-outlined">arrow_back</span></button>
        <h2>Interests</h2>
      </div>
      <div class="auth-body">
        ${stepBar()}
        <h1 class="auth-title font-serif" style="font-size:1.4rem">Pick Your Interests</h1>
        <p class="auth-subtitle">Choose at least 3 (max 8)</p>
        <div class="interest-tags">
          ${INTEREST_OPTIONS.map(i => `<button class="interest-tag ${(signupData.interests || []).includes(i) ? 'selected' : ''}" onclick="toggleInterest('${i}')">${i}</button>`).join('')}
        </div>
        <div style="margin-top:20px"><button class="btn-primary" onclick="nextStep4()">Continue</button></div>
      </div>
    </div>`;
}

function toggleInterest(i) {
  const idx = (signupData.interests || []).indexOf(i);
  if (idx >= 0) signupData.interests.splice(idx, 1);
  else if (signupData.interests.length < 8) signupData.interests.push(i);
  else return showToast('Max 8 interests', 'error');
  renderStep4();
}

function nextStep4() {
  if ((signupData.interests || []).length < 3) return showToast('Pick at least 3 interests', 'error');
  signupStep = 5; renderSignupStep();
}

function renderStep5() {
  document.getElementById('app').innerHTML = `
    <div class="auth-page view-animate">
      <div class="auth-header">
        <button class="btn-icon" onclick="signupStep=4;renderSignupStep()"><span class="material-symbols-outlined">arrow_back</span></button>
        <h2>Preferences</h2>
      </div>
      <div class="auth-body">
        ${stepBar()}
        <h1 class="auth-title font-serif" style="font-size:1.4rem">Almost Done!</h1>
        <p class="auth-subtitle">Who would you like to see?</p>
        <div style="display:flex;flex-direction:column;gap:14px">
          <div class="input-group"><label>Show Me</label>
            <div class="gender-select">
              <button class="gender-btn ${signupData.show_me === 'male' ? 'active' : ''}" onclick="pickShowMe('male')">Men</button>
              <button class="gender-btn ${signupData.show_me === 'female' ? 'active' : ''}" onclick="pickShowMe('female')">Women</button>
              <button class="gender-btn ${signupData.show_me === 'all' ? 'active' : ''}" onclick="pickShowMe('all')">Everyone</button>
            </div>
          </div>
          <div class="input-group">
            <label>Green Flags (comma separated)</label>
            <input class="input-field" id="s-green" placeholder="e.g. Good listener, Honest, Kind" value="${(signupData.green_flags || []).join(', ')}">
          </div>
          <div class="input-group">
            <label>Red Flags (comma separated)</label>
            <input class="input-field" id="s-red" placeholder="e.g. Ghosting, Rude, Flaky" value="${(signupData.red_flags || []).join(', ')}">
          </div>
          <button class="btn-primary" id="signup-btn" style="margin-top:8px" onclick="finishSignup()">
            <span class="material-symbols-outlined fill-icon">celebration</span>Start Matching!
          </button>
        </div>
      </div>
    </div>`;
}

function pickShowMe(v) {
  signupData.show_me = v;
  document.querySelectorAll('.gender-btn').forEach(b => {
    const t = b.textContent.toLowerCase();
    b.classList.toggle('active', (v === 'male' && t === 'men') || (v === 'female' && t === 'women') || (v === 'all' && t === 'everyone'));
  });
}

async function finishSignup() {
  if (!signupData.show_me) return showToast('Select who you want to see', 'error');
  const green = document.getElementById('s-green').value.split(',').map(s => s.trim()).filter(Boolean);
  const red = document.getElementById('s-red').value.split(',').map(s => s.trim()).filter(Boolean);
  signupData.green_flags = green.length ? green : ['Open-minded'];
  signupData.red_flags = red.length ? red : ['Ghosting'];

  const btn = document.getElementById('signup-btn');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:18px;height:18px"></div> Creating account...';

  try {
    const data = await apiFetch('/api/auth/register', { method: 'POST', body: JSON.stringify(signupData) });
    setToken(data.token); setCachedUser(data.user);
    showToast('Welcome to NITKnot! 🎉', 'success');
    navigate('discover');
  } catch (e) {
    showToast(e.message, 'error');
    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined fill-icon">celebration</span>Start Matching!';
  }
}

// ========================================
// Discover / Swipe
// ========================================
let cardQueue = [], isDragging = false, startX = 0, currentX = 0, startY = 0;

async function renderDiscover() {
  if (!getToken()) return navigate('landing');
  const user = getCachedUser();

  document.getElementById('app').innerHTML = `
    <div class="discover-page view-animate">
      <div class="discover-header">
        <div style="display:flex;align-items:center;gap:8px">
          <div class="logo-icon"><span class="material-symbols-outlined fill-icon text-gold">favorite</span></div>
          <span class="logo-text font-serif">NITKnot</span>
        </div>
        <button class="btn-icon" onclick="navigate('profile')" style="overflow:hidden;padding:0">
          <img src="${user?.photo || defaultAvatar(user?.name)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">
        </button>
      </div>
      <div class="swipe-area">
        <div class="card-stack" id="card-stack">
          <div class="empty-state">
            <div class="spinner" style="width:36px;height:36px;margin-bottom:12px"></div>
            <h3>Loading profiles...</h3>
          </div>
        </div>
        <div class="swipe-actions">
          <button class="action-btn medium" title="Pass" onclick="swipeAction('pass')">
            <span class="material-symbols-outlined nope-icon" style="color:#ef4444;font-size:26px;font-variation-settings:'FILL' 1">close</span>
          </button>
          <button class="action-btn large" title="Like" onclick="swipeAction('like')">
            <span class="material-symbols-outlined fill-icon" style="color:white;font-size:28px">favorite</span>
          </button>
          <button class="action-btn small" title="Super Like" onclick="swipeAction('super_like')">
            <span class="material-symbols-outlined fill-icon" style="color:#3b82f6;font-size:22px">star</span>
          </button>
        </div>
      </div>
    </div>`;

  try {
    const data = await apiFetch('/api/discover');
    cardQueue = data.profiles || [];
    renderCards();
  } catch (e) {
    showToast(e.message, 'error');
    document.getElementById('card-stack').innerHTML = `
      <div class="error-state">
        <span class="material-symbols-outlined">error</span>
        <h3>Couldn't load profiles</h3>
        <p>${escapeHtml(e.message)}</p>
        <button class="btn-primary" style="max-width:200px;margin-top:12px" onclick="renderDiscover()">Retry</button>
      </div>`;
  }
}

function renderCards() {
  const stack = document.getElementById('card-stack');
  if (!stack) return;
  stack.innerHTML = '';

  if (cardQueue.length === 0) {
    stack.innerHTML = `
      <div class="empty-state">
        <span class="material-symbols-outlined">search_off</span>
        <h3>You've seen everyone!</h3>
        <p>Check back later for new profiles</p>
        <button class="btn-primary" style="max-width:200px;margin-top:16px" onclick="renderDiscover()">
          <span class="material-symbols-outlined">refresh</span>Refresh
        </button>
      </div>`;
    return;
  }

  const show = cardQueue.slice(0, 3).reverse();
  show.forEach((p, idx) => {
    const pos = show.length - 1 - idx;
    const card = document.createElement('div');
    card.className = `swipe-card ${pos === 0 ? '' : pos === 1 ? 'behind' : 'far-behind'}`;
    card.dataset.id = p.id;

    card.innerHTML = `
      <div class="card-photo-area">
        <img src="${p.photo || defaultAvatar(p.name)}" alt="${escapeHtml(p.name)}" loading="lazy"
          onerror="this.src='${defaultAvatar(p.name)}'">
        <div class="card-gradient-top"></div>
        <div class="card-gradient-bottom"></div>
        <div class="card-info-overlay">
          <div class="card-name-row">
            <span class="card-name font-serif">${escapeHtml(p.name)}, ${p.age}</span>
            ${p.is_verified ? '<span class="material-symbols-outlined fill-icon" style="color:#ee2b9d;font-size:20px">verified</span>' : ''}
          </div>
          <div class="card-detail">${escapeHtml(p.branch)} • ${escapeHtml(p.year)}</div>
          <div class="card-location"><span class="material-symbols-outlined">location_on</span>NITK Surathkal</div>
          <div class="card-match-badge">✨ ${p.match_percent || 70}% match</div>
        </div>
        <div class="swipe-label swipe-label-like">LIKE 💚</div>
        <div class="swipe-label swipe-label-nope">NOPE ❌</div>
      </div>
      <div class="card-body">
        <p class="card-bio">${escapeHtml(p.bio || 'Hey there!')}</p>
        <div class="card-tags">
          ${(p.interests || []).slice(0, 4).map(i => `<span class="card-tag">${escapeHtml(i)}</span>`).join('')}
        </div>
        <button class="card-view-btn" onclick="event.stopPropagation();viewProfileFromCard(${JSON.stringify(p).replace(/"/g, '&quot;')})">
          View Full Profile
        </button>
      </div>`;

    if (pos === 0) setupDrag(card);
    stack.appendChild(card);
  });
}

function viewProfileFromCard(profile) {
  navigate('viewProfile', profile);
}

function setupDrag(card) {
  let startTime;

  const onStart = e => {
    if (e.target.closest('.card-view-btn')) return;
    isDragging = true;
    startTime = Date.now();
    startX = e.touches ? e.touches[0].clientX : e.clientX;
    startY = e.touches ? e.touches[0].clientY : e.clientY;
    currentX = 0;
    card.classList.add('swiping');
    card.classList.remove('animating');
    card.style.willChange = 'transform';
  };

  const onMove = e => {
    if (!isDragging) return;
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    currentX = cx - startX;
    const dy = cy - startY;

    // If scrolling vertically more than horizontally, don't swipe
    if (Math.abs(dy) > Math.abs(currentX) && Math.abs(currentX) < 10) return;

    e.preventDefault && e.preventDefault();
    const rotate = currentX * 0.07;
    card.style.transform = `translateX(${currentX}px) rotate(${rotate}deg)`;
    const likeLabel = card.querySelector('.swipe-label-like');
    const nopeLabel = card.querySelector('.swipe-label-nope');
    if (likeLabel) likeLabel.style.opacity = Math.max(0, Math.min(1, currentX / 80));
    if (nopeLabel) nopeLabel.style.opacity = Math.max(0, Math.min(1, -currentX / 80));
  };

  const onEnd = () => {
    if (!isDragging) return;
    isDragging = false;
    card.classList.remove('swiping');
    card.style.willChange = '';

    const elapsed = Date.now() - startTime;
    const velocity = Math.abs(currentX) / elapsed;
    const threshold = window.innerWidth * 0.25;

    if (Math.abs(currentX) > threshold || (velocity > 0.5 && Math.abs(currentX) > 60)) {
      const dir = currentX > 0 ? 'like' : 'pass';
      card.classList.add('animating');
      card.style.transform = `translateX(${currentX > 0 ? 700 : -700}px) rotate(${currentX > 0 ? 30 : -30}deg)`;
      card.style.opacity = '0';
      setTimeout(() => processSwipe(dir), 300);
    } else {
      card.classList.add('animating');
      card.style.transform = '';
      const likeLabel = card.querySelector('.swipe-label-like');
      const nopeLabel = card.querySelector('.swipe-label-nope');
      if (likeLabel) likeLabel.style.opacity = 0;
      if (nopeLabel) nopeLabel.style.opacity = 0;
      setTimeout(() => card.classList.remove('animating'), 300);
    }
    currentX = 0;
  };

  card.addEventListener('mousedown', onStart);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onEnd);
  card.addEventListener('touchstart', onStart, { passive: true });
  card.addEventListener('touchmove', onMove, { passive: false });
  card.addEventListener('touchend', onEnd);
}

function swipeAction(action) {
  if (cardQueue.length === 0) return showToast('No more cards!', 'error');
  const stack = document.getElementById('card-stack');
  const top = stack?.querySelector('.swipe-card:not(.behind):not(.far-behind)');
  if (!top) return;
  top.classList.add('animating');
  if (action === 'like') {
    top.style.transform = 'translateX(700px) rotate(30deg)';
    const l = top.querySelector('.swipe-label-like');
    if (l) l.style.opacity = 1;
  } else if (action === 'pass') {
    top.style.transform = 'translateX(-700px) rotate(-30deg)';
    const n = top.querySelector('.swipe-label-nope');
    if (n) n.style.opacity = 1;
  } else {
    top.style.transform = 'translateY(-700px) scale(0.8)';
  }
  top.style.opacity = '0';
  setTimeout(() => processSwipe(action), 300);
}

let _swipePending = false;
async function processSwipe(action) {
  if (_swipePending) return;
  if (cardQueue.length === 0) return;
  _swipePending = true;
  const profile = cardQueue.shift();

  try {
    const data = await apiFetch('/api/swipe', {
      method: 'POST',
      body: JSON.stringify({ target_id: profile.id, action })
    });

    if (data.match && data.matched_user) {
      showMatch(data.matched_user, data.match_id);
    } else {
      if (action === 'like') showToast('💕 Liked!', 'success', 1500);
      if (action === 'super_like') showToast('⭐ Super Liked!', 'success', 1500);
    }
  } catch (e) {
    if (!e.message.includes('Already swiped')) {
      showToast(e.message, 'error');
    }
  } finally {
    _swipePending = false;
    renderCards();
  }
}

// ========================================
// Match Overlay
// ========================================
function showMatch(matchedUser, matchId) {
  currentMatchId = matchId;
  currentMatchedUser = matchedUser;
  const user = getCachedUser();
  document.getElementById('match-name').textContent = matchedUser.name || 'them';
  document.getElementById('match-photo-me').src = user?.photo || defaultAvatar(user?.name);
  document.getElementById('match-photo-me').onerror = function() { this.src = defaultAvatar(user?.name); };
  document.getElementById('match-photo-them').src = matchedUser.photo || defaultAvatar(matchedUser.name);
  document.getElementById('match-photo-them').onerror = function() { this.src = defaultAvatar(matchedUser.name); };
  document.getElementById('match-overlay').classList.remove('hidden');
}

function closeMatch() {
  document.getElementById('match-overlay').classList.add('hidden');
  if (currentView === 'discover') renderCards();
}

function goToMatchChat() {
  document.getElementById('match-overlay').classList.add('hidden');
  if (currentMatchId && currentMatchedUser) {
    navigate('chatConvo', {
      match_id: currentMatchId,
      user_id: currentMatchedUser.id,
      name: currentMatchedUser.name,
      photo: currentMatchedUser.photo
    });
  } else {
    navigate('chat');
  }
}

// ========================================
// Likes Page
// ========================================
async function renderLikes() {
  if (!getToken()) return navigate('landing');
  document.getElementById('app').innerHTML = `
    <div class="likes-page view-animate">
      <div class="page-header"><h1 class="font-serif">Likes You 💕</h1></div>
      <div id="likes-content" style="padding:14px">
        <div class="empty-state"><div class="spinner" style="width:32px;height:32px"></div><h3>Loading...</h3></div>
      </div>
    </div>`;

  try {
    const likes = await apiFetch('/api/likes/received');
    const container = document.getElementById('likes-content');
    if (!likes || likes.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding-top:60px">
          <span class="material-symbols-outlined fill-icon" style="color:var(--primary)">favorite_border</span>
          <h3>No likes yet</h3>
          <p>Keep swiping! Your likes will show up here.</p>
        </div>`;
    } else {
      container.innerHTML = `
        <p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:12px">${likes.length} people liked you</p>
        <div class="connections-grid">
          ${likes.map(u => `
            <div class="connection-card" onclick='viewLikedProfile(${JSON.stringify(u).replace(/'/g, "&#39;").replace(/"/g, "&quot;")})'>
              <img src="${u.photo || defaultAvatar(u.name)}" alt="${escapeHtml(u.name)}"
                style="${u.is_super_like ? 'border:3px solid #3b82f6' : ''}"
                onerror="this.src='${defaultAvatar(u.name)}'">
              <div class="connection-card-overlay">
                <h3>${escapeHtml(u.name)}, ${u.age} ${u.is_verified ? '✅' : ''}</h3>
                <p>${escapeHtml(u.branch)}</p>
              </div>
              ${u.is_super_like ? '<span class="connection-card-badge" style="background:#3b82f6">⭐ Super Like</span>' : '<span class="connection-card-badge">Likes You</span>'}
            </div>`).join('')}
        </div>`;
    }
  } catch (e) {
    document.getElementById('likes-content').innerHTML = `
      <div class="error-state"><span class="material-symbols-outlined">error</span><h3>Couldn't load likes</h3><p>${escapeHtml(e.message)}</p>
      <button class="btn-primary" style="max-width:200px;margin-top:12px" onclick="renderLikes()">Retry</button></div>`;
  }
}

function viewLikedProfile(u) {
  navigate('viewProfile', u);
}

// ========================================
// View Profile
// ========================================
function renderViewProfile(profile) {
  if (!profile) return navigate('discover');
  const isMatch = !!profile.match_id;

  document.getElementById('app').innerHTML = `
    <div class="view-profile-page view-animate">
      <div class="profile-header">
        <button class="btn-icon" onclick="history.back()"><span class="material-symbols-outlined">arrow_back</span></button>
        <h2 class="font-serif" style="font-size:1rem">${escapeHtml(profile.name)}'s Profile</h2>
        ${!isMatch ? `<button class="btn-icon" style="margin-left:auto" onclick="showReportModal(${profile.id},'${escapeHtml(profile.name)}')">
          <span class="material-symbols-outlined">flag</span></button>` : ''}
      </div>
      <div class="vp-photo-section">
        <img class="vp-photo" src="${profile.photo || defaultAvatar(profile.name)}" alt="${escapeHtml(profile.name)}"
          onerror="this.src='${defaultAvatar(profile.name)}'">
        <div class="vp-photo-gradient"></div>
      </div>
      <div class="vp-info">
        <div class="vp-name-row">
          <h1 class="vp-name font-serif">${escapeHtml(profile.name)}, ${profile.age}</h1>
          ${profile.is_verified ? '<span class="material-symbols-outlined fill-icon" style="color:var(--primary)">verified</span>' : ''}
        </div>
        <p class="vp-details">${escapeHtml(profile.branch || '')} • ${escapeHtml(profile.year || '')} • NITK Surathkal</p>

        <div class="vp-section"><h3>About</h3>
          <p class="vp-bio">${escapeHtml(profile.bio || 'No bio yet')}</p>
        </div>

        ${(profile.interests || []).length > 0 ? `
        <div class="vp-section"><h3>Interests</h3>
          <div class="vp-tags">
            ${(profile.interests || []).map(i => `<span class="vp-tag">${escapeHtml(i)}</span>`).join('')}
          </div>
        </div>` : ''}

        ${(profile.green_flags || []).length > 0 ? `
        <div class="vp-section"><h3>Green Flags 💚</h3>
          <div class="flag-list">
            ${(profile.green_flags || []).map(f => `
              <div class="flag-item green">
                <span class="material-symbols-outlined fill-icon">check_circle</span>
                <span>${escapeHtml(f)}</span>
              </div>`).join('')}
          </div>
        </div>` : ''}

        ${(profile.red_flags || []).length > 0 ? `
        <div class="vp-section"><h3>Red Flags 🚩</h3>
          <div class="flag-list">
            ${(profile.red_flags || []).map(f => `
              <div class="flag-item red">
                <span class="material-symbols-outlined fill-icon">warning</span>
                <span>${escapeHtml(f)}</span>
              </div>`).join('')}
          </div>
        </div>` : ''}
      </div>

      <div class="vp-actions">
        ${isMatch ? `
          <button class="btn-primary" style="flex:1" onclick="navigate('chatConvo',${JSON.stringify({match_id:profile.match_id,user_id:profile.id||profile.user_id,name:profile.name,photo:profile.photo})})">
            <span class="material-symbols-outlined fill-icon" style="color:white">chat</span>Message
          </button>` : `
          <button class="action-btn medium" onclick="handleQuickSwipe(${profile.id},'pass')" title="Pass">
            <span class="material-symbols-outlined fill-icon" style="color:#ef4444;font-size:24px">close</span>
          </button>
          <button class="btn-primary" style="flex:1" onclick="handleQuickSwipe(${profile.id},'like')">
            <span class="material-symbols-outlined fill-icon" style="color:white">favorite</span>Like
          </button>
          <button class="action-btn small" onclick="handleQuickSwipe(${profile.id},'super_like')" title="Super Like">
            <span class="material-symbols-outlined fill-icon" style="color:#3b82f6;font-size:20px">star</span>
          </button>`}
      </div>
    </div>`;
}

async function handleQuickSwipe(id, action) {
  try {
    const data = await apiFetch('/api/swipe', { method: 'POST', body: JSON.stringify({ target_id: id, action }) });
    if (data.match && data.matched_user) {
      showMatch(data.matched_user, data.match_id);
    } else {
      showToast(action === 'like' ? 'Liked! 💕' : action === 'super_like' ? '⭐ Super Liked!' : 'Passed', 'success', 1500);
      navigate('discover');
    }
  } catch (e) { showToast(e.message, 'error'); }
}

function showReportModal(userId, name) {
  const reasons = ['Inappropriate photos','Fake profile','Harassment','Spam','Underage user','Other'];
  const div = document.createElement('div');
  div.className = 'modal-overlay';
  div.id = 'report-modal-overlay';
  div.onclick = e => { if (e.target === div) div.remove(); };
  div.innerHTML = `
    <div class="report-modal">
      <h3 style="margin-bottom:4px">Report ${escapeHtml(name)}</h3>
      <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:16px">Select a reason:</p>
      ${reasons.map(r => `<button class="report-option" onclick="submitReport(${userId},'${r}',this.closest('#report-modal-overlay'))">${r}</button>`).join('')}
      <button class="btn-ghost" style="margin-top:8px" onclick="document.getElementById('report-modal-overlay').remove()">Cancel</button>
    </div>`;
  document.body.appendChild(div);
}

async function submitReport(reportedId, reason, overlay) {
  try {
    await apiFetch('/api/report', { method: 'POST', body: JSON.stringify({ reported_id: reportedId, reason }) });
    overlay?.remove();
    showToast('Report submitted. Thank you! 🛡️', 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

// ========================================
// Connections
// ========================================
async function renderConnections() {
  if (!getToken()) return navigate('landing');
  document.getElementById('app').innerHTML = `
    <div class="connections-page view-animate">
      <div class="page-header"><h1 class="font-serif">Matches</h1></div>
      <div id="conn-content" style="padding:14px">
        <div class="empty-state"><div class="spinner" style="width:32px;height:32px"></div><h3>Loading...</h3></div>
      </div>
    </div>`;

  try {
    const data = await apiFetch('/api/matches');
    const matches = data.matches || [];
    const container = document.getElementById('conn-content');

    if (matches.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding-top:60px">
          <span class="material-symbols-outlined fill-icon" style="color:var(--primary)">group</span>
          <h3>No matches yet</h3>
          <p>Keep swiping to find your match!</p>
          <button class="btn-primary" style="max-width:200px;margin-top:16px" onclick="navigate('discover')">
            <span class="material-symbols-outlined">style</span>Discover
          </button>
        </div>`;
    } else {
      container.innerHTML = `
        <p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:12px">${matches.length} match${matches.length !== 1 ? 'es' : ''}</p>
        <div class="connections-grid">
          ${matches.map(m => `
            <div class="connection-card" onclick='navigate("chatConvo",${JSON.stringify({match_id:m.match_id,name:m.name,photo:m.photo,user_id:m.user_id}).replace(/'/g,"&#39;")})'>
              <img src="${m.photo || defaultAvatar(m.name)}" alt="${escapeHtml(m.name)}" onerror="this.src='${defaultAvatar(m.name)}'">
              <div class="connection-card-overlay">
                <h3>${escapeHtml(m.name)}</h3>
                <p>${escapeHtml(m.branch || '')} • ${escapeHtml(m.year || '')}</p>
              </div>
              <span class="connection-card-badge">Match 💕</span>
            </div>`).join('')}
        </div>`;
    }
  } catch (e) {
    document.getElementById('conn-content').innerHTML = `
      <div class="error-state"><span class="material-symbols-outlined">error</span><h3>Couldn't load</h3><p>${escapeHtml(e.message)}</p>
      <button class="btn-primary" style="max-width:200px;margin-top:12px" onclick="renderConnections()">Retry</button></div>`;
  }
}

// ========================================
// Chat List
// ========================================
async function renderChatList() {
  if (!getToken()) return navigate('landing');
  document.getElementById('app').innerHTML = `
    <div class="chat-list-page view-animate">
      <div class="page-header"><h1 class="font-serif">Messages</h1></div>
      <div class="chat-search">
        <span class="material-symbols-outlined">search</span>
        <input id="chat-search-input" placeholder="Search conversations..." oninput="filterChats(this.value)">
      </div>
      <div class="chat-list" id="chat-list-content">
        <div class="empty-state"><div class="spinner" style="width:32px;height:32px"></div><h3>Loading...</h3></div>
      </div>
    </div>`;

  try {
    const data = await apiFetch('/api/matches');
    window._allChats = data.matches || [];
    renderChatItems(window._allChats);
  } catch (e) {
    document.getElementById('chat-list-content').innerHTML = `
      <div class="error-state"><span class="material-symbols-outlined">error</span><h3>Couldn't load</h3><p>${escapeHtml(e.message)}</p>
      <button class="btn-primary" style="max-width:200px;margin-top:12px" onclick="renderChatList()">Retry</button></div>`;
  }
}

function filterChats(q) {
  const all = window._allChats || [];
  const filtered = q ? all.filter(m => m.name.toLowerCase().includes(q.toLowerCase())) : all;
  renderChatItems(filtered);
}

function renderChatItems(matches) {
  const el = document.getElementById('chat-list-content');
  if (!el) return;
  if (matches.length === 0) {
    el.innerHTML = `
      <div class="empty-state" style="padding-top:60px">
        <span class="material-symbols-outlined">chat_bubble</span>
        <h3>No conversations</h3>
        <p>Match with someone to start chatting!</p>
      </div>`;
    return;
  }
  el.innerHTML = matches.map(m => {
    const hasUnread = m.unread_count > 0;
    return `
      <div class="chat-item" onclick='navigate("chatConvo",${JSON.stringify({match_id:m.match_id,name:m.name,photo:m.photo,user_id:m.user_id}).replace(/'/g,"&#39;")})'>
        <img class="chat-avatar" src="${m.photo || defaultAvatar(m.name)}" onerror="this.src='${defaultAvatar(m.name)}'">
        <div class="chat-info">
          <div class="chat-info-top">
            <h3>${escapeHtml(m.name)}</h3>
            <span>${m.last_message_time ? formatTime(m.last_message_time) : 'New'}</span>
          </div>
          <p class="chat-preview ${hasUnread ? 'unread' : ''}">
            ${m.last_message_mine ? 'You: ' : ''}${escapeHtml(m.last_message || 'Say hello! 👋')}
          </p>
        </div>
        ${hasUnread ? `<span class="chat-unread-badge">${m.unread_count > 9 ? '9+' : m.unread_count}</span>` : ''}
      </div>`;
  }).join('');
}

// ========================================
// Chat Conversation
// ========================================
let chatPollInterval = null;
let replyState = null;
let _pendingMessages = {};

function stopChatPoll() {
  if (chatPollInterval) { clearInterval(chatPollInterval); chatPollInterval = null; }
}

async function renderChatConvo(data) {
  if (!data || !data.match_id) return navigate('chat');

  document.getElementById('bottom-nav').classList.add('hidden');
  window._chatMatchId = data.match_id;
  window._chatToUserId = data.user_id;
  window._chatName = data.name;

  const myId = getCachedUser()?.id;

  document.getElementById('app').innerHTML = `
    <div class="chat-convo-page view-animate">
      <div class="chat-convo-header">
        <button class="btn-icon" style="width:38px;height:38px;flex-shrink:0" onclick="stopChatPoll();navigate('chat')">
          <span class="material-symbols-outlined" style="font-size:20px">arrow_back</span>
        </button>
        <img class="chat-convo-avatar" src="${data.photo || defaultAvatar(data.name)}"
          onerror="this.src='${defaultAvatar(data.name)}'"
          onclick="viewMatchProfile()">
        <div style="flex:1;margin-left:4px;min-width:0">
          <div class="chat-convo-name">${escapeHtml(data.name)}</div>
          <div id="chat-online-status" class="chat-convo-status">...</div>
        </div>
        <button class="chat-options-btn" onclick="showChatMenu(${data.match_id})">
          <span class="material-symbols-outlined">more_vert</span>
        </button>
      </div>

      <div class="chat-messages" id="chat-msgs"></div>

      <div id="typing-area" class="typing-indicator hidden">
        <span>${escapeHtml(data.name)} is typing</span>
        <div class="typing-dots"><span></span><span></span><span></span></div>
      </div>

      <div class="chat-input-container">
        <div class="reply-bar hidden" id="reply-bar">
          <div class="reply-info">
            <span class="reply-to-name" id="reply-name">Replying to...</span>
            <span class="reply-text-preview" id="reply-text">...</span>
          </div>
          <span class="material-symbols-outlined close-reply" onclick="cancelReply()">close</span>
        </div>
        <div class="emoji-area hidden" id="emoji-area">
          ${COMMON_EMOJIS.map(e => `<button class="emoji-btn" onclick="insertEmoji('${e}')">${e}</button>`).join('')}
        </div>
        <div class="chat-input-bar">
          <button class="btn-icon" style="width:38px;height:38px;background:none;border:none" onclick="toggleEmoji()">
            <span class="material-symbols-outlined" style="color:var(--text-secondary)">sentiment_satisfied</span>
          </button>
          <input type="file" id="chat-img-input" accept="image/*" style="display:none" onchange="handleImgSelect(event)">
          <button class="btn-icon" style="width:38px;height:38px;background:none;border:none" onclick="document.getElementById('chat-img-input').click()">
            <span class="material-symbols-outlined" style="color:var(--text-secondary)" id="img-btn-icon">add_photo_alternate</span>
          </button>
          <button class="btn-icon" style="width:38px;height:38px;background:none;border:none" id="mic-btn" onclick="toggleRecording(${data.match_id})">
            <span class="material-symbols-outlined" style="color:var(--text-secondary)">mic</span>
          </button>
          <input id="chat-input" type="text" placeholder="Message ${escapeHtml(data.name)}..."
            oninput="handleTyping()" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendMsg(${data.match_id})}">
          <button class="chat-send-btn" onclick="sendMsg(${data.match_id})">
            <span class="material-symbols-outlined">send</span>
          </button>
        </div>
        <div id="img-preview-bar" class="hidden" style="padding:6px 14px;display:flex;align-items:center;gap:8px;border-top:1px solid var(--border)">
          <img id="img-preview-thumb" class="img-preview-thumb" src="">
          <span style="font-size:0.8rem;color:var(--text-secondary);flex:1">Image ready to send</span>
          <button onclick="clearImgSelection()" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:18px">✕</button>
        </div>
      </div>
    </div>`;

  await loadMessages(data.match_id, myId, data.name);
  markAsRead(data.match_id);

  // Check online status
  apiFetch(`/api/users/${data.user_id}/online`).then(r => {
    const el = document.getElementById('chat-online-status');
    if (el) { el.textContent = r.online ? 'Online' : 'Offline'; el.style.color = r.online ? 'var(--success)' : 'var(--text-muted)'; }
  }).catch(() => {
    const el = document.getElementById('chat-online-status');
    if (el) el.textContent = 'Tap for profile';
  });

  // Re-bind socket typing handlers for this chat
  if (socket) {
    socket.off('typing_start');
    socket.off('typing_stop');
    socket.on('typing_start', ({ fromUserId }) => {
      if (fromUserId == window._chatToUserId) {
        document.getElementById('typing-area')?.classList.remove('hidden');
      }
    });
    socket.on('typing_stop', ({ fromUserId }) => {
      if (fromUserId == window._chatToUserId) {
        document.getElementById('typing-area')?.classList.add('hidden');
      }
    });
  }

  chatPollInterval = setInterval(() => {
    if (currentView === 'chatConvo') {
      loadMessages(data.match_id, myId, data.name, true);
    }
  }, 10000);
}

function viewMatchProfile() {
  const data = { id: window._chatToUserId, name: window._chatName, match_id: window._chatMatchId };
  navigate('viewProfile', data);
}

let _lastMsgIds = new Set();

async function loadMessages(matchId, myId, name, silent = false) {
  try {
    const data = await apiFetch(`/api/messages/${matchId}`);
    const msgs = data.messages || [];

    if (silent && msgs.length === _lastMsgIds.size && msgs.every(m => _lastMsgIds.has(m.id))) return;

    const box = document.getElementById('chat-msgs');
    if (!box) return;

    const wasAtBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 40;

    // Build new message IDs
    _lastMsgIds = new Set(msgs.map(m => m.id));

    if (msgs.length === 0) {
      box.innerHTML = `
        <div style="text-align:center;padding:40px 20px">
          <div style="font-size:3rem;margin-bottom:12px">💕</div>
          <p style="color:var(--text-secondary)">You matched with <strong>${escapeHtml(name)}</strong>!<br>Say something nice!</p>
        </div>`;
      return;
    }

    // Render messages with date separators
    let lastDate = null;
    const html = msgs.map(m => {
      const isMine = m.sender_id === myId;
      const msgDate = new Date(m.created_at).toDateString();
      let dateSep = '';
      if (msgDate !== lastDate) {
        lastDate = msgDate;
        const today = new Date().toDateString();
        const label = msgDate === today ? 'Today' : new Date(m.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' });
        dateSep = `<div class="date-separator"><span>${label}</span></div>`;
      }
      return dateSep + buildMsgHtml(m, isMine, myId, name);
    }).join('');

    box.innerHTML = html;

    if (wasAtBottom || !silent) {
      box.scrollTop = box.scrollHeight;
    }
  } catch (e) {
    if (!silent) showToast(e.message, 'error');
  }
}

function buildMsgHtml(m, isMine, myId, chatPartnerName) {
  const replyHtml = m.reply_to_text
    ? `<div class="msg-context" onclick="scrollToMsg(${m.reply_to_id})">
        <strong>${escapeHtml(m.reply_to_sender || 'User')}</strong>: ${escapeHtml((m.reply_to_text || '').substring(0, 60))}
       </div>`
    : '';

  const imgHtml = m.image_url
    ? `<img src="${escapeHtml(m.image_url)}" class="msg-image" loading="lazy"
        onclick="openImageViewer('${escapeHtml(m.image_url)}')" onerror="this.style.display='none'">`
    : '';

  const audioHtml = m.voice_url
    ? `<audio controls src="${escapeHtml(m.voice_url)}" class="msg-audio" preload="none"></audio>`
    : '';

  const textHtml = m.text ? `<div class="msg-text">${escapeHtml(m.text)}</div>` : '';

  const statusHtml = isMine
    ? `<span class="msg-status" style="${m.is_read ? 'color:#34b7f1' : ''}">${m.is_read ? '✓✓' : '✓'}</span>`
    : '';

  return `
    <div class="msg-wrapper ${isMine ? 'msg-sent-container' : 'msg-received-container'}"
      id="msg-${m.id}" style="margin-bottom:8px;align-self:${isMine ? 'flex-end' : 'flex-start'}">
      ${replyHtml}
      <div class="msg-bubble ${isMine ? 'msg-sent' : 'msg-received'}"
        onclick="showMsgOptions(${m.id},'${escapeHtml((m.text || '').substring(0,100)).replace(/'/g,"\\'").replace(/"/g,'&quot;')}','${isMine ? 'You' : escapeHtml(chatPartnerName || 'User')}',${isMine})">
        ${imgHtml}${audioHtml}${textHtml}
      </div>
      <div class="msg-time ${isMine ? 'sent' : ''}">
        ${formatTime(m.created_at)} ${statusHtml}
      </div>
    </div>`;
}

function appendMessage(m) {
  const box = document.getElementById('chat-msgs');
  if (!box) return;

  // Remove "say hello" placeholder
  const placeholder = box.querySelector('div[style*="padding:40px"]');
  if (placeholder) placeholder.remove();

  const myId = getCachedUser()?.id;
  const isMine = m.sender_id === myId;

  const wrapper = document.createElement('div');
  wrapper.innerHTML = buildMsgHtml(m, isMine, myId, window._chatName || 'User');
  const el = wrapper.firstElementChild;
  if (el) {
    box.appendChild(el);
    _lastMsgIds.add(m.id);
    box.scrollTop = box.scrollHeight;
  }
}

// Typing
let typingTimeout = null;
function handleTyping() {
  if (!socket || !window._chatToUserId) return;
  socket.emit('typing_start', { toUserId: window._chatToUserId });
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket?.emit('typing_stop', { toUserId: window._chatToUserId });
  }, 1500);
}

// Emoji
let emojiOpen = false;
function toggleEmoji() {
  const area = document.getElementById('emoji-area');
  if (!area) return;
  emojiOpen = !emojiOpen;
  area.classList.toggle('hidden', !emojiOpen);
}
function insertEmoji(e) {
  const input = document.getElementById('chat-input');
  if (!input) return;
  const pos = input.selectionStart || input.value.length;
  input.value = input.value.slice(0, pos) + e + input.value.slice(pos);
  input.focus();
  input.selectionStart = input.selectionEnd = pos + e.length;
  emojiOpen = false;
  document.getElementById('emoji-area')?.classList.add('hidden');
}

// Image
let _selectedFile = null;
function handleImgSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  _selectedFile = file;
  const icon = document.getElementById('img-btn-icon');
  if (icon) { icon.textContent = 'check_circle'; icon.style.color = 'var(--primary)'; }
  const previewBar = document.getElementById('img-preview-bar');
  const thumb = document.getElementById('img-preview-thumb');
  if (previewBar && thumb) {
    thumb.src = URL.createObjectURL(file);
    previewBar.classList.remove('hidden');
    previewBar.style.display = 'flex';
  }
}
function clearImgSelection() {
  _selectedFile = null;
  const fileInput = document.getElementById('chat-img-input');
  if (fileInput) fileInput.value = '';
  const icon = document.getElementById('img-btn-icon');
  if (icon) { icon.textContent = 'add_photo_alternate'; icon.style.color = 'var(--text-secondary)'; }
  const previewBar = document.getElementById('img-preview-bar');
  if (previewBar) { previewBar.classList.add('hidden'); previewBar.style.display = 'none'; }
}

// Voice recording
let mediaRecorder = null;
let audioChunks = [];

async function toggleRecording(matchId) {
  const btn = document.getElementById('mic-btn');
  const icon = btn?.querySelector('.material-symbols-outlined');

  if (!mediaRecorder || mediaRecorder.state === 'inactive') {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg' });
      audioChunks = [];
      mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        sendVoiceMsg(matchId, blob);
        stream.getTracks().forEach(t => t.stop());
      };
      mediaRecorder.start();
      if (icon) { icon.textContent = 'stop_circle'; icon.style.color = 'var(--danger)'; }
      showToast('Recording... Tap mic to stop', 'info');
    } catch (e) {
      showToast('Microphone access denied', 'error');
    }
  } else if (mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    if (icon) { icon.textContent = 'mic'; icon.style.color = 'var(--text-secondary)'; }
  }
}

async function sendVoiceMsg(matchId, blob) {
  const tempId = 'temp-' + Date.now();
  const box = document.getElementById('chat-msgs');
  const myId = getCachedUser()?.id;

  // Optimistic UI for voice
  const wrapper = document.createElement('div');
  wrapper.className = 'msg-wrapper msg-sent-container';
  wrapper.id = tempId;
  wrapper.style.cssText = 'align-self:flex-end;margin-bottom:8px;opacity:0.7';
  wrapper.innerHTML = `
    <div class="msg-bubble msg-sent">
      <audio controls src="${URL.createObjectURL(blob)}" class="msg-audio"></audio>
    </div>
    <div class="msg-time sent">Sending...</div>`;
  box?.appendChild(wrapper);
  box && (box.scrollTop = box.scrollHeight);

  try {
    const fd = new FormData();
    fd.append('audio', blob, 'voice.webm');
    const data = await apiUpload(`/api/messages/${matchId}`, fd);
    const el = document.getElementById(tempId);
    if (el) {
      el.style.opacity = '1';
      el.id = 'msg-' + data.message.id;
      el.querySelector('.msg-time').textContent = formatTime(data.message.created_at);
      const audio = el.querySelector('audio');
      if (audio && data.message.voice_url) audio.src = data.message.voice_url;
    }
    _lastMsgIds.add(data.message.id);
  } catch (e) {
    const el = document.getElementById(tempId);
    if (el) {
      el.style.opacity = '1';
      el.querySelector('.msg-time').innerHTML = `<span style="color:var(--danger);cursor:pointer" onclick="this.parentElement.parentElement.remove()">Failed to send ✕</span>`;
    }
    showToast('Failed to send voice message', 'error');
  }
}

async function sendMsg(matchId) {
  const input = document.getElementById('chat-input');
  const text = input?.value.trim();
  const file = _selectedFile;

  if (!text && !file) return;

  const originalText = text;
  if (input) input.value = '';
  input?.focus();
  if (file) clearImgSelection();
  if (emojiOpen) { emojiOpen = false; document.getElementById('emoji-area')?.classList.add('hidden'); }

  const replyData = replyState ? { ...replyState } : null;
  cancelReply();

  const tempId = 'temp-' + Date.now();
  const myId = getCachedUser()?.id;

  // Optimistic UI
  const tempMsg = {
    id: tempId,
    match_id: matchId,
    sender_id: myId,
    text: originalText,
    created_at: new Date().toISOString(),
    reply_to_text: replyData?.text || null,
    reply_to_sender: replyData?.sender || null,
    reply_to_id: replyData?.id || null,
    image_url: file ? URL.createObjectURL(file) : null,
    is_read: false
  };

  const box = document.getElementById('chat-msgs');
  const placeholder = box?.querySelector('div[style*="padding:40px"]');
  if (placeholder) placeholder.remove();

  const isMine = true;
  const wrapper = document.createElement('div');
  wrapper.className = 'msg-wrapper msg-sent-container';
  wrapper.id = tempId;
  wrapper.style.cssText = 'align-self:flex-end;margin-bottom:8px;opacity:0.6';

  const replyHtml = replyData
    ? `<div class="msg-context"><strong>Replying to ${escapeHtml(replyData.sender)}</strong>: ${escapeHtml((replyData.text || '').substring(0, 60))}</div>`
    : '';
  const imgHtml = file ? `<img src="${URL.createObjectURL(file)}" class="msg-image" style="max-width:200px">` : '';
  const textHtml = originalText ? `<div class="msg-text">${escapeHtml(originalText)}</div>` : '';

  wrapper.innerHTML = `
    ${replyHtml}
    <div class="msg-bubble msg-sent">${imgHtml}${textHtml}</div>
    <div class="msg-time sent">Sending...</div>`;
  box?.appendChild(wrapper);
  box && (box.scrollTop = box.scrollHeight);

  try {
    let data;
    if (file) {
      const fd = new FormData();
      fd.append('image', file);
      if (originalText) fd.append('text', originalText);
      if (replyData) fd.append('replyToId', replyData.id);
      data = await apiUpload(`/api/messages/${matchId}`, fd);
    } else {
      const payload = { text: originalText };
      if (replyData) payload.replyToId = replyData.id;
      data = await apiFetch(`/api/messages/${matchId}`, { method: 'POST', body: JSON.stringify(payload) });
    }

    const el = document.getElementById(tempId);
    if (el) {
      el.id = 'msg-' + data.message.id;
      el.style.opacity = '1';
      el.querySelector('.msg-time').innerHTML = `${formatTime(data.message.created_at)} <span class="msg-status">✓</span>`;
      // Update image to real URL if needed
      if (data.message.image_url && el.querySelector('img')) {
        el.querySelector('img').src = data.message.image_url;
      }
    }
    _lastMsgIds.add(data.message.id);
  } catch (e) {
    const el = document.getElementById(tempId);
    if (el) {
      el.style.opacity = '1';
      el.querySelector('.msg-time').innerHTML = `
        <span style="color:var(--danger);cursor:pointer;font-weight:700" onclick="retrySendMsg(${matchId},'${escapeHtml(originalText).replace(/'/g,"\\'")}')">
          Failed — Tap to retry
        </span>`;
    }
    showToast(e.message, 'error');
  }
}

async function retrySendMsg(matchId, text) {
  const input = document.getElementById('chat-input');
  if (input) input.value = text;
  sendMsg(matchId);
}

function showMsgOptions(id, text, sender, isMine) {
  const existing = document.getElementById('msg-options-overlay');
  if (existing) existing.remove();

  const sheet = document.createElement('div');
  sheet.className = 'msg-actions-overlay';
  sheet.id = 'msg-options-overlay';
  sheet.onclick = e => { if (e.target === sheet) sheet.remove(); };
  sheet.innerHTML = `
    <div class="msg-actions-sheet">
      <button class="msg-action-btn" onclick="startReply(${id},'${escapeHtml(text).replace(/'/g,"\\'")}','${escapeHtml(sender).replace(/'/g,"\\'")}');document.getElementById('msg-options-overlay').remove()">
        <span class="material-symbols-outlined">reply</span>Reply
      </button>
      <button class="msg-action-btn" onclick="copyText('${escapeHtml(text).replace(/'/g,"\\'")}');document.getElementById('msg-options-overlay').remove()">
        <span class="material-symbols-outlined">content_copy</span>Copy
      </button>
      ${isMine ? `<button class="msg-action-btn delete" onclick="deleteMsg(${id});document.getElementById('msg-options-overlay').remove()">
        <span class="material-symbols-outlined">delete</span>Delete
      </button>` : `<button class="msg-action-btn" onclick="showReportModal(${window._chatToUserId},'${escapeHtml(sender).replace(/'/g,"\\'")}');document.getElementById('msg-options-overlay').remove()">
        <span class="material-symbols-outlined">flag</span>Report
      </button>`}
    </div>`;
  document.body.appendChild(sheet);
}

function copyText(text) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => showToast('Copied!', 'success')).catch(() => showToast('Copy failed', 'error'));
  } else { showToast('Copy not supported', 'error'); }
}

function startReply(id, text, sender) {
  replyState = { id, text, sender };
  const bar = document.getElementById('reply-bar');
  if (bar) {
    document.getElementById('reply-name').textContent = `Replying to ${sender}`;
    document.getElementById('reply-text').textContent = text.substring(0, 60);
    bar.classList.remove('hidden');
  }
  document.getElementById('chat-input')?.focus();
}

function cancelReply() {
  replyState = null;
  document.getElementById('reply-bar')?.classList.add('hidden');
}

function scrollToMsg(id) {
  document.getElementById('msg-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function deleteMsg(id) {
  try {
    await apiFetch('/api/messages/' + id, { method: 'DELETE' });
    document.getElementById('msg-' + id)?.remove();
    showToast('Message deleted', 'success', 1500);
  } catch (e) { showToast(e.message, 'error'); }
}

function showChatMenu(matchId) {
  const sheet = document.createElement('div');
  sheet.className = 'msg-actions-overlay';
  sheet.onclick = e => { if (e.target === sheet) sheet.remove(); };
  sheet.innerHTML = `
    <div class="msg-actions-sheet">
      <button class="msg-action-btn" onclick="viewMatchProfile();this.closest('.msg-actions-overlay').remove()">
        <span class="material-symbols-outlined">person</span>View Profile
      </button>
      <button class="msg-action-btn delete" onclick="confirmUnmatch(${matchId});this.closest('.msg-actions-overlay').remove()">
        <span class="material-symbols-outlined">heart_broken</span>Unmatch
      </button>
    </div>`;
  document.body.appendChild(sheet);
}

async function confirmUnmatch(matchId) {
  if (!confirm('Unmatch this person? This cannot be undone and all messages will be lost.')) return;
  try {
    await apiFetch('/api/matches/' + matchId, { method: 'DELETE' });
    stopChatPoll();
    showToast('Unmatched', 'success');
    navigate('chat');
  } catch (e) { showToast(e.message, 'error'); }
}

// ========================================
// Profile
// ========================================
async function renderProfile() {
  if (!getToken()) return navigate('landing');
  let user = getCachedUser();

  // Always fetch fresh data
  try {
    const data = await apiFetch('/api/auth/me');
    user = data.user; setCachedUser(user);
  } catch (e) {
    if (e.message.includes('Session')) { clearToken(); return navigate('landing'); }
  }

  let stats = { matches: 0, likes_given: 0, likes_received: 0 };
  try { stats = await apiFetch('/api/stats'); } catch {}

  document.getElementById('app').innerHTML = `
    <div class="profile-page view-animate">
      <div class="profile-hero">
        <img src="${user.photo || defaultAvatar(user.name, 600)}" alt="${escapeHtml(user.name)}"
          onerror="this.src='${defaultAvatar(user.name)}'">
        <div class="profile-hero-gradient"></div>
        <div class="profile-hero-info">
          <h1 class="font-serif">${escapeHtml(user.name)}, ${user.age}</h1>
          <p>${escapeHtml(user.branch)} • ${escapeHtml(user.year)}</p>
          <div class="profile-hero-badges">
            ${user.is_verified
              ? '<span class="profile-badge"><span class="material-symbols-outlined fill-icon" style="color:var(--primary)">verified</span>NITK Verified</span>'
              : '<span class="profile-badge"><span class="material-symbols-outlined" style="color:var(--warning)">warning</span>Unverified</span>'}
          </div>
        </div>
      </div>

      <div class="profile-content">
        <div class="profile-stats-card">
          <div class="stat-item"><div class="stat-number" style="color:var(--primary)">${stats.matches}</div><div class="stat-label">Matches</div></div>
          <div class="stat-item"><div class="stat-number" style="color:var(--success)">${stats.likes_given}</div><div class="stat-label">Liked</div></div>
          <div class="stat-item"><div class="stat-number" style="color:var(--info)">${stats.likes_received}</div><div class="stat-label">Liked You</div></div>
        </div>

        <div class="profile-section">
          <h3>Profile Photo</h3>
          <label style="cursor:pointer;display:flex;align-items:center;gap:12px;padding:14px;background:var(--bg-card);border:1px dashed var(--border);border-radius:var(--radius-lg)">
            <img src="${user.photo || defaultAvatar(user.name)}" style="width:52px;height:52px;border-radius:50%;object-fit:cover"
              onerror="this.src='${defaultAvatar(user.name)}'">
            <div>
              <div style="font-weight:700;font-size:0.9rem">Update Photo</div>
              <div style="font-size:0.78rem;color:var(--text-muted)">JPG, PNG or WebP</div>
            </div>
            <span class="material-symbols-outlined" style="margin-left:auto;color:var(--text-muted)">upload</span>
            <input type="file" accept="image/*" style="display:none" onchange="uploadPhoto(this)">
          </label>
        </div>

        <div class="profile-section">
          <h3>Bio</h3>
          <p style="color:var(--text-secondary);font-size:0.92rem;line-height:1.6;background:var(--bg-card);padding:14px;border-radius:var(--radius-lg);border:1px solid var(--border)">
            ${escapeHtml(user.bio || 'No bio yet')}
          </p>
        </div>

        <div class="profile-section">
          <h3>Interests</h3>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            ${(user.interests || []).map(i => `<span style="padding:7px 14px;background:var(--primary-soft);border:1px solid rgba(238,43,157,0.2);border-radius:var(--radius-full);font-size:0.83rem;font-weight:600;color:var(--primary)">${escapeHtml(i)}</span>`).join('')}
          </div>
        </div>

        <div class="profile-section">
          <div class="profile-action-grid">
            <button class="profile-action-btn edit" onclick="navigate('editProfile')">
              <span class="material-symbols-outlined">edit</span>Edit Profile
            </button>
            <button class="profile-action-btn logout" onclick="doLogout()">
              <span class="material-symbols-outlined">logout</span>Logout
            </button>
          </div>
        </div>

        <p class="profile-version">NITKnot v2.0 • Made with ❤️ for NITK</p>
      </div>
    </div>`;
}

let cropper = null;

function uploadPhoto(input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  const reader = new FileReader();
  reader.onload = e => {
    const img = document.getElementById('crop-image');
    if (!img) return;
    img.src = e.target.result;
    document.getElementById('crop-modal').classList.remove('hidden');
    if (cropper) { cropper.destroy(); cropper = null; }
    cropper = new Cropper(img, {
      aspectRatio: 1, viewMode: 1, dragMode: 'move',
      autoCropArea: 1, guides: false, center: false,
      highlight: false, cropBoxMovable: false, cropBoxResizable: false
    });
  };
  reader.readAsDataURL(file);
  input.value = '';
}

function closeCropModal() {
  document.getElementById('crop-modal').classList.add('hidden');
  if (cropper) { cropper.destroy(); cropper = null; }
}

async function saveCrop() {
  if (!cropper) return;
  const canvas = cropper.getCroppedCanvas({ width: 600, height: 600, imageSmoothingQuality: 'high' });
  canvas.toBlob(async (blob) => {
    if (!blob) return showToast('Crop failed', 'error');
    const form = new FormData();
    form.append('photo', blob, 'profile.jpg');
    const heroImg = document.querySelector('.profile-hero img');
    const tmpUrl = URL.createObjectURL(blob);
    if (heroImg) heroImg.src = tmpUrl;
    closeCropModal();
    showToast('Uploading photo...', 'info');
    try {
      const data = await apiUpload('/api/profile/photo', form);
      const user = getCachedUser();
      user.photo = data.photo;
      setCachedUser(user);
      showToast('Photo updated! 📸', 'success');
      renderProfile();
    } catch (e) {
      showToast(e.message, 'error');
      renderProfile();
    }
  }, 'image/jpeg', 0.9);
}

function doLogout() {
  if (!confirm('Are you sure you want to logout?')) return;
  stopChatPoll();
  if (socket) { socket.disconnect(); socket = null; }
  clearToken();
  showToast('Logged out. See you soon! 👋', 'success');
  navigate('landing');
}

// ========================================
// Edit Profile
// ========================================
function renderEditProfile() {
  if (!getToken()) return navigate('landing');
  const user = getCachedUser();
  document.getElementById('bottom-nav').classList.add('hidden');

  document.getElementById('app').innerHTML = `
    <div class="auth-page view-animate">
      <div class="auth-header">
        <button class="btn-icon" onclick="navigate('profile')"><span class="material-symbols-outlined">arrow_back</span></button>
        <h2>Edit Profile</h2>
      </div>
      <div class="auth-body">
        <div style="display:flex;flex-direction:column;gap:14px">
          <div class="input-group"><label>Name</label>
            <input class="input-field" id="e-name" value="${escapeHtml(user.name || '')}">
          </div>
          <div class="input-group"><label>Bio</label>
            <textarea class="textarea-field" id="e-bio">${escapeHtml(user.bio || '')}</textarea>
          </div>
          <div class="input-group"><label>Branch</label>
            <select class="input-field" id="e-branch">
              ${["Computer Science","IT","Electronics","EEE","Mechanical","Civil","Chemical","Metallurgy","Mining","Math & Computing","Physics"].map(b => `<option value="${b}" ${user.branch === b ? 'selected' : ''}>${b}</option>`).join('')}
            </select>
          </div>
          <div class="input-group"><label>Year</label>
            <select class="input-field" id="e-year">
              ${["1st Year","2nd Year","3rd Year","4th Year","M.Tech","PhD"].map(y => `<option value="${y}" ${user.year === y ? 'selected' : ''}>${y}</option>`).join('')}
            </select>
          </div>
          <div class="input-group"><label>Show Me</label>
            <select class="input-field" id="e-show-me">
              <option value="all" ${user.show_me === 'all' ? 'selected' : ''}>Everyone</option>
              <option value="male" ${user.show_me === 'male' ? 'selected' : ''}>Men</option>
              <option value="female" ${user.show_me === 'female' ? 'selected' : ''}>Women</option>
            </select>
          </div>

          <div class="input-group"><label>Interests</label>
            <div id="edit-interests" class="interest-tags" style="margin-top:4px">
              ${INTEREST_OPTIONS.map(i => `<button class="interest-tag ${(user.interests || []).includes(i) ? 'selected' : ''}" onclick="toggleEditInterest('${i}')" id="int-${i.replace(/ /g,'_')}">${i}</button>`).join('')}
            </div>
          </div>

          <div class="input-group"><label>Green Flags (comma separated)</label>
            <input class="input-field" id="e-green" value="${escapeHtml((user.green_flags || []).join(', '))}">
          </div>
          <div class="input-group"><label>Red Flags (comma separated)</label>
            <input class="input-field" id="e-red" value="${escapeHtml((user.red_flags || []).join(', '))}">
          </div>

          <button class="btn-primary" id="save-btn" onclick="saveProfileChanges()">
            <span class="material-symbols-outlined">save</span>Save Changes
          </button>

          <div style="margin-top:20px;border-top:1px solid var(--border);padding-top:20px">
            <h3 style="margin-bottom:12px;font-weight:700">Danger Zone</h3>
            <button class="btn-secondary" onclick="deactivateAccount()" style="margin-bottom:10px">Deactivate Account</button>
            <button class="btn-ghost" onclick="deleteAccount()" style="color:var(--danger);border-color:rgba(239,68,68,0.4)">Delete Account Permanently</button>
          </div>
        </div>
      </div>
    </div>`;

  // Store interests in memory for editing
  window._editInterests = [...(user.interests || [])];
}

function toggleEditInterest(i) {
  const interests = window._editInterests || [];
  const idx = interests.indexOf(i);
  if (idx >= 0) {
    interests.splice(idx, 1);
  } else if (interests.length < 8) {
    interests.push(i);
  } else {
    return showToast('Max 8 interests', 'error');
  }
  window._editInterests = interests;
  const btn = document.getElementById('int-' + i.replace(/ /g, '_'));
  if (btn) btn.classList.toggle('selected', interests.includes(i));
}

async function saveProfileChanges() {
  const name = document.getElementById('e-name').value.trim();
  const bio = document.getElementById('e-bio').value.trim();
  const branch = document.getElementById('e-branch').value;
  const year = document.getElementById('e-year').value;
  const show_me = document.getElementById('e-show-me').value;
  const green = document.getElementById('e-green').value.split(',').map(s => s.trim()).filter(Boolean);
  const red = document.getElementById('e-red').value.split(',').map(s => s.trim()).filter(Boolean);

  if (!name) return showToast('Name is required', 'error');

  const btn = document.getElementById('save-btn');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:18px;height:18px"></div> Saving...';

  try {
    const data = await apiFetch('/api/profile', {
      method: 'PUT',
      body: JSON.stringify({ name, bio, branch, year, show_me, interests: window._editInterests || [], green_flags: green, red_flags: red })
    });
    setCachedUser(data.user);
    showToast('Profile updated! ✨', 'success');
    navigate('profile');
  } catch (e) {
    showToast(e.message, 'error');
    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined">save</span>Save Changes';
  }
}

async function deactivateAccount() {
  if (!confirm('Deactivate your account? You can reactivate by logging in again.')) return;
  try {
    await apiFetch('/api/account/deactivate', { method: 'POST' });
    clearToken();
    showToast('Account deactivated. See you soon! 👋', 'success');
    navigate('landing');
  } catch (e) { showToast(e.message, 'error'); }
}

async function deleteAccount() {
  const conf = prompt('Type "DELETE" to permanently delete your account. This cannot be undone.');
  if (conf !== 'DELETE') return showToast('Deletion cancelled', 'error');
  try {
    await apiFetch('/api/account', { method: 'DELETE' });
    clearToken();
    showToast('Account deleted. Goodbye! 💔', 'success');
    navigate('landing');
  } catch (e) { showToast(e.message, 'error'); }
}

// ========================================
// Init
// ========================================
window.addEventListener('popstate', () => {
  const hash = window.location.hash.slice(1);
  if (hash && hash !== currentView) navigate(hash);
});

(function init() {
  const token = getToken();
  const hash = window.location.hash.slice(1);

  const protected_ = ['discover','connections','chat','profile','editProfile','viewProfile','chatConvo','likes'];
  const public_ = ['landing','login','signup'];

  if (token) {
    initSocket();
    // If on public page, go to discover
    if (!hash || public_.includes(hash)) return navigate('discover');
    if (protected_.includes(hash)) return navigate(hash);
    return navigate('discover');
  } else {
    if (public_.includes(hash)) return navigate(hash);
    return navigate('landing');
  }
})();
