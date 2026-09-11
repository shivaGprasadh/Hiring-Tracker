let STATUSES = [
  { key: "Sourcing",             color: "#8B98A5", bg: "#1C2A36" },
  { key: "Screening",            color: "#A78BFA", bg: "#2A2340" },
  { key: "Interview Scheduled",  color: "#F5A623", bg: "#3F2E0C" },
  { key: "Interview Completed",  color: "#2DD4BF", bg: "#123B36" },
  { key: "Offer Extended",       color: "#4ADE80", bg: "#143622" },
  { key: "Hired",                color: "#4ADE80", bg: "#143622" },
  { key: "On Hold",              color: "#8B98A5", bg: "#1C2A36" },
  { key: "Rejected",             color: "#F0645C", bg: "#3A1917" }
];

const STAGE_PRESETS = ["Screening Call", "Technical Round 1", "Technical Round 2", "Bar Raiser", "HR Discussion", "Manager Round"];

let candidates = [];
let roles = [];
let vendors = [];
let vendorsManaged = [];
let STATUSES_MANAGED = [];
let adminDrafts = null;
let filters = { search: "", role: "all", status: "all", vendor: "all" };
let refreshSeq = 0;
let currentPage = 1;
let pageSize = 20;
let totalCount = 0;
let dashboardStats = {};
let __credPassword = null;
let selectedCandidateId = null;
let pendingUploadCandidateId = null;
let editCandidateId = null;
let candidateEditDraft = null;
let armedStageDeleteId = null;
let armedResumeDelId = null;
let editingStageId = null;
let stageEditDraft = null;
let stagesCache = [];
let lastEvents = [];
let selectedIds = new Set();
let armedBulkDelete = false;
let armBulkDeleteTimer = null;
let settings = { brand_eyebrow: "", brand_title: "", brand_subtitle: "" };
let currentUser = null;
let users = [];
let authMode = "login";
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const POLICY_HINT = "Password must be 8+ characters with at least one uppercase letter, one lowercase letter and one digit.";


async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: opts.body && !(opts.body instanceof FormData) ? { "Content-Type": "application/json" } : {},
    ...opts
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      detail = data.detail || JSON.stringify(data);
    } catch (e) { /* ignore */ }
    if (res.status === 401 && !path.startsWith("/api/auth/") && typeof showLogin === "function" && !window.__authRedirecting) {
      window.__authRedirecting = true;
      showLogin();
      setTimeout(() => { window.__authRedirecting = false; }, 400);
    }
    const err = new Error(detail);
    err.status = res.status;
    throw err;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function statusMeta(key) {
  return STATUSES.find(s => s.key === key) || STATUSES[0];
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function canEdit() {
  return currentUser && (currentUser.role === "admin" || currentUser.role === "manager");
}

function isAdmin() {
  return currentUser && currentUser.role === "admin";
}

function validatePolicy(pw) {
  return pw && pw.length >= 8 && /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /[0-9]/.test(pw);
}

function setAuthMessage(msg, type) { setInlineMessage("authMessage", msg, type); }

function switchView(view) {
  const tabs = { dashboard: "dashboardTab", admin: "adminTab", profile: "profileTab" };
  for (const key in tabs) {
    const el = document.getElementById(tabs[key]);
    if (el) el.classList.toggle("hidden", key !== view);
  }
  const ab = document.getElementById("adminBtn");
  if (ab) ab.classList.toggle("active", view === "admin");
  const pb = document.getElementById("profileBtn");
  if (pb) pb.classList.toggle("active", view === "profile");
}

function showLogin() {
  if (typeof closeDrawer === "function") closeDrawer();
  if (typeof closeResumeView === "function") closeResumeView();
  ["dashboardTab", "adminTab", "profileTab"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add("hidden");
  });
  const auth = document.getElementById("authView");
  if (auth) auth.classList.remove("hidden");
  const hb = document.querySelector(".headbtns");
  if (hb) hb.classList.add("hidden");
  const sub = document.getElementById("brandSub");
  if (sub) sub.style.display = "none";
}

function showApp() {
  const auth = document.getElementById("authView");
  if (auth) auth.classList.add("hidden");
  const forgot = document.getElementById("forgotView");
  if (forgot) forgot.style.display = "none";
  const hb = document.querySelector(".headbtns");
  if (hb) hb.classList.remove("hidden");
  const sub = document.getElementById("brandSub");
  if (sub) sub.style.display = "";
  switchView("dashboard");
}

function updateAuthUI() {
  const adminBtn = document.getElementById("adminBtn");
  if (adminBtn) adminBtn.classList.toggle("hidden", !isAdmin());
  const addRow = document.querySelector(".add-row");
  if (addRow) addRow.style.display = canEdit() ? "" : "none";
  const chipLabel = document.getElementById("userChipLabel");
  if (chipLabel) chipLabel.textContent = currentUser ? currentUser.name : "";
}

async function boot() {
  try {
    currentUser = await api("/api/auth/me");
    showApp();
    await loadAll();
    updateAuthUI();
  } catch (e) {
    currentUser = null;
    showLogin();
  }
}

function setAuthMode(mode) {
  authMode = mode;
  const signup = mode === "signup";
  document.getElementById("nameFieldRow").style.display = signup ? "" : "none";
  document.getElementById("confirmFieldRow").style.display = signup ? "" : "none";
  document.getElementById("authPolicy").style.display = signup ? "" : "none";
  document.getElementById("authTitle").textContent = signup ? "Create your account" : "Sign in to continue";
  document.getElementById("authSub").textContent = signup
    ? "No email verification needed \u2014 you're in once you sign up."
    : "Enter your email and password.";
  document.getElementById("authSubmitBtn").textContent = signup ? "Create account" : "Sign in";
  const prefix = document.getElementById("authTogglePrefix");
  const link = document.getElementById("authToggleLink");
  if (prefix) prefix.textContent = signup ? "Already have an account? " : "Don't have an account? ";
  if (link) link.textContent = signup ? "Sign in" : "Create one";
  document.getElementById("authPassword").autocomplete = signup ? "new-password" : "current-password";
  setAuthMessage(null);
}

async function handleAuthSubmit() {
  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;
  if (authMode === "signup") {
    const name = document.getElementById("authName").value.trim();
    const confirm = document.getElementById("authConfirm").value;
    if (!email || !EMAIL_RE.test(email)) return setAuthMessage("Enter a valid email address (e.g. name@example.com).", "error");
    if (!validatePolicy(password)) return setAuthMessage(POLICY_HINT, "error");
    if (password !== confirm) return setAuthMessage("Passwords do not match.", "error");
    const btn = document.getElementById("authSubmitBtn");
    btn.disabled = true;
    try {
      currentUser = await api("/api/auth/signup", { method: "POST", body: JSON.stringify({ name, email, password }) });
      btn.disabled = false;
      showApp();
      await loadAll();
      updateAuthUI();
      setDashboardMessage(currentUser.role === "admin"
        ? "Admin account created. Open Admin > Users to add people."
        : "Account created. Welcome!", "saved");
    } catch (e) { btn.disabled = false; setAuthMessage(e.message, "error"); }
    return;
  }
  if (!email) return setAuthMessage("Enter your email address.", "error");
  if (!password) return setAuthMessage("Enter your password.", "error");
  const loginBtn = document.getElementById("authSubmitBtn");
  loginBtn.disabled = true;
  try {
    currentUser = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    loginBtn.disabled = false;
    showApp();
    await loadAll();
    updateAuthUI();
  } catch (e) {
    loginBtn.disabled = false;
    setAuthMessage(e.message, "error");
  }
}

async function logout() {
  try { await api("/api/auth/logout", { method: "POST" }); } catch (e) { /* ignore */ }
  currentUser = null;
  setAuthMode("login");
  ["authName", "authEmail", "authPassword", "authConfirm"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  showLogin();
}

let forgotStep = 0;
let forgotEmail = "";

function resetForgotFlow() {
  forgotStep = 0;
  forgotEmail = "";
  ["fpEmail", "fpAnswer", "fpNewPassword", "fpNewConfirm"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  ["fpQuestionRow", "fpAnswerRow", "fpNewRow", "fpNewConfirmRow", "fpPolicy", "fpQuestion"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });
  const qel = document.getElementById("fpQuestion");
  if (qel) qel.value = "";
  const msg = document.getElementById("fpMessage");
  if (msg) { msg.style.display = "none"; msg.className = "inline-msg"; msg.textContent = ""; }
  document.getElementById("fpSub").textContent = "Verify your security question to set a new password.";
  document.getElementById("fpNextBtn").textContent = "Verify";
}

function showForgotView() {
  const auth = document.getElementById("authView");
  const forgot = document.getElementById("forgotView");
  if (auth) auth.style.display = "none";
  if (forgot) forgot.style.display = "";
  resetForgotFlow();
  document.getElementById("fpEmail").focus();
}

function showAuthBox() {
  const auth = document.getElementById("authView");
  const forgot = document.getElementById("forgotView");
  if (auth) { auth.style.display = ""; setAuthMessage(null); }
  if (forgot) forgot.style.display = "none";
}

async function handleForgotSubmit() {
  const email = document.getElementById("fpEmail").value.trim();
  const nextBtn = document.getElementById("fpNextBtn");
  nextBtn.disabled = true;
  try {
    if (forgotStep === 0) {
      if (!email || !EMAIL_RE.test(email)) { nextBtn.disabled = false; return setInlineMessage("fpMessage", "Enter a valid email address.", "error"); }
      const res = await api("/api/auth/forgot-question", { method: "POST", body: JSON.stringify({ email }) });
      if (!res.has_security_question) {
        nextBtn.disabled = false;
        return setInlineMessage("fpMessage", "This account has no security question set. Ask an admin to reset your password.", "error");
      }
      forgotEmail = email;
      forgotStep = 1;
      document.getElementById("fpQuestion").value = res.question;
      document.getElementById("fpSub").textContent = res.question;
      ["fpQuestionRow", "fpAnswerRow", "fpNewRow", "fpNewConfirmRow", "fpPolicy"].forEach(id => {
        document.getElementById(id).style.display = "";
      });
      setInlineMessage("fpMessage", null);
      document.getElementById("fpNextBtn").textContent = "Reset password";
      document.getElementById("fpAnswer").focus();
    } else {
      const answer = document.getElementById("fpAnswer").value.trim();
      const next = document.getElementById("fpNewPassword").value;
      const confirm = document.getElementById("fpNewConfirm").value;
      if (!answer) { nextBtn.disabled = false; return setInlineMessage("fpMessage", "Enter your answer.", "error"); }
      if (!validatePolicy(next)) { nextBtn.disabled = false; return setInlineMessage("fpMessage", POLICY_HINT, "error"); }
      if (next !== confirm) { nextBtn.disabled = false; return setInlineMessage("fpMessage", "New passwords do not match.", "error"); }
      const question = document.getElementById("fpQuestion").value;
      await api("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: forgotEmail, question, answer, new_password: next })
      });
      forgotStep = 0;
      nextBtn.disabled = false;
      showAuthBox();
      showLogin();
      setAuthMode("login");
      return setAuthMessage("Password reset successfully. Sign in with your new password.", "saved");
    }
  } catch (e) {
    setInlineMessage("fpMessage", e.message, "error");
  }
  nextBtn.disabled = false;
}

function openProfile() {
  switchView("profile");
  document.getElementById("profileName").value = currentUser ? currentUser.name : "";
  document.getElementById("profileEmail").value = currentUser ? currentUser.email : "";
  document.getElementById("profileRole").textContent = currentUser ? currentUser.role.toUpperCase() : "";
  ["pwCurrent", "pwNew", "pwConfirm", "sqAnswer"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  populateSecurityQuestions();
  setInlineMessage("profileMessage", null);
}

async function saveProfile() {
  const name = document.getElementById("profileName").value.trim();
  const email = document.getElementById("profileEmail").value.trim();
  if (!email || !EMAIL_RE.test(email)) return setInlineMessage("profileMessage", "Enter a valid email address.", "error");
  const body = { name: name || currentUser.name };
  if (email !== currentUser.email) body.email = email;
  try {
    currentUser = await api("/api/auth/me/profile", { method: "PUT", body: JSON.stringify(body) });
    updateAuthUI();
    openProfile();
    setInlineMessage("profileMessage", "Profile updated.", "saved");
  } catch (e) { setInlineMessage("profileMessage", e.message, "error"); }
}

async function changePassword() {
  const current = document.getElementById("pwCurrent").value;
  const next = document.getElementById("pwNew").value;
  const confirm = document.getElementById("pwConfirm").value;
  if (!validatePolicy(next)) return setInlineMessage("profileMessage", POLICY_HINT, "error");
  if (next !== confirm) return setInlineMessage("profileMessage", "New passwords do not match.", "error");
  try {
    const res = await api("/api/auth/me/password", { method: "PUT", body: JSON.stringify({ current_password: current, new_password: next }) });
    if (res && res.warn) setInlineMessage("profileMessage", res.warn + " Changes were saved.", "saved");
    ["pwCurrent", "pwNew", "pwConfirm"].forEach(id => { document.getElementById(id).value = ""; });
    setInlineMessage("profileMessage", "Password changed.", "saved");
  } catch (e) { setInlineMessage("profileMessage", e.message, "error"); }
}

async function populateSecurityQuestions() {
  const sq = document.getElementById("sqQuestion");
  if (!sq || sq.options.length) return;
  try {
    const list = await api("/api/auth/security-questions");
    if (!Array.isArray(list)) return;
    sq.innerHTML = "";
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "Select a question\u2026";
    sq.appendChild(none);
    list.forEach(q => {
      const opt = document.createElement("option");
      opt.value = q;
      opt.textContent = q;
      sq.appendChild(opt);
    });
    if (currentUser && currentUser.security_question) sq.value = currentUser.security_question;
  } catch (e) { /* profile still usable without the list */ }
}

async function saveSecurityQuestion() {
  const question = document.getElementById("sqQuestion").value;
  const answer = document.getElementById("sqAnswer").value.trim();
  if (!question) return setInlineMessage("profileMessage", "Select a security question.", "error");
  if (!answer) return setInlineMessage("profileMessage", "Enter your answer.", "error");
  try {
    await api("/api/auth/me/security-question", { method: "PUT", body: JSON.stringify({ question, answer }) });
    setInlineMessage("profileMessage", "Security question saved.", "saved");
    document.getElementById("sqAnswer").value = "";
  } catch (e) { setInlineMessage("profileMessage", e.message, "error"); }
}

async function loadAll() {
  try {
    const [candPage, roleList, stats, managed, statusList, appSettings] = await Promise.all([
      api("/api/candidates?page=1&page_size=" + pageSize),
      api("/api/roles"),
      api("/api/stats"),
      api("/api/vendors"),
      api("/api/statuses"),
      api("/api/settings")
    ]);
    candidates = candPage.items || [];
    totalCount = candPage.total || 0;
    currentPage = 1;
    dashboardStats = stats || {};
    roles = roleList;
    vendorsManaged = Array.isArray(managed) ? managed : [];
    vendors = getVendors();
    STATUSES_MANAGED = Array.isArray(statusList) ? statusList : [];
    STATUSES = STATUSES_MANAGED.map(s => ({ key: s.name, color: s.color, bg: s.bg }));
    settings = {
      brand_eyebrow: (appSettings && appSettings.brand_eyebrow) || "",
      brand_title: (appSettings && appSettings.brand_title) || "",
      brand_subtitle: (appSettings && appSettings.brand_subtitle) || ""
    };
    applyBranding();
    if (filters.status !== "all" && !STATUSES.some(s => s.key === filters.status)) {
      filters.status = "all";
    }
    adminDrafts = null;
    render();
  } catch (e) {
    setDashboardMessage("Failed to load data: " + e.message, "error");
  }
}

function applyBranding() {
  const eyebrow = document.getElementById("brandEyebrow");
  const title = document.getElementById("brandTitle");
  const sub = document.getElementById("brandSub");
  if (eyebrow) eyebrow.textContent = settings.brand_eyebrow || "";
  if (title) title.textContent = settings.brand_title || "";
  if (sub) sub.textContent = settings.brand_subtitle || "";
  document.title = settings.brand_title || "Hiring Tracker";
}

async function refreshCandidates() {
  const reqId = ++refreshSeq;
  const params = new URLSearchParams();
  if (filters.role && filters.role !== "all") params.set("role_id", filters.role);
  if (filters.status && filters.status !== "all") params.set("status", filters.status);
  if (filters.vendor && filters.vendor !== "all") params.set("vendor", filters.vendor);
  if (filters.search) params.set("search", filters.search);
  params.set("page", currentPage);
  params.set("page_size", pageSize);
  try {
    const data = await api("/api/candidates?" + params.toString());
    if (reqId !== refreshSeq) return;
    candidates = data.items || [];
    totalCount = data.total || 0;
    const maxPage = Math.max(1, Math.ceil(totalCount / pageSize));
    if (currentPage > maxPage) {
      currentPage = maxPage;
      refreshCandidates();
      return;
    }
    renderTable();
    renderFooter();
  } catch (e) {
    if (reqId !== refreshSeq) return;
    setDashboardMessage("Failed to load candidates: " + e.message, "error");
  }
}

async function refreshStats() {
  try {
    dashboardStats = await api("/api/stats");
    renderStats();
  } catch (e) { /* ignore */ }
}

function populateSelect(select, options, includeAll, allLabel, selectedValue) {
  select.innerHTML = "";
  if (includeAll) {
    const opt = document.createElement("option");
    opt.value = "all";
    opt.textContent = allLabel || "All";
    select.appendChild(opt);
  }
  options.forEach(o => {
    const opt = document.createElement("option");
    opt.value = o.value !== undefined ? o.value : o;
    opt.textContent = o.label !== undefined ? o.label : o;
    if (selectedValue !== undefined && String(opt.value) === String(selectedValue)) opt.selected = true;
    select.appendChild(opt);
  });
}

function renderStats() {
  const statsEl = document.getElementById("stats");
  statsEl.innerHTML = "";

  const statusCounts = (dashboardStats && dashboardStats.statuses) || {};
  const total = (dashboardStats && dashboardStats.total) || totalCount;

  const cards = [
    { label: "All", n: total, color: null, key: "all" },
    ...STATUSES.map(s => ({ label: s.key, n: statusCounts[s.key] || 0, color: s.color, key: s.key }))
  ];

  cards.forEach(card => {
    const el = document.createElement("div");
    el.className = "stat" + (filters.status === card.key ? " active" : "");
    el.innerHTML = `<div class="n" ${card.color ? `style="color:${card.color}"` : ""}>${card.n}</div><div class="l">${escapeHtml(card.label)}</div>`;
    el.onclick = () => {
      filters.status = filters.status === card.key ? "all" : card.key;
      currentPage = 1;
      syncControls();
      refreshCandidates();
    };
    statsEl.appendChild(el);
  });
}

function syncControls() {
  document.getElementById("statusFilter").value = filters.status;
  document.getElementById("roleFilter").value = filters.role;
  document.getElementById("search").value = filters.search;
  document.getElementById("vendorFilter").value = filters.vendor;
}

function tableTd(label) {
  const el = document.createElement("td");
  if (label) el.setAttribute("data-label", label);
  return el;
}

function smallBtn(text, cls, onClick) {
  const b = document.createElement("button");
  b.className = "btn small" + (cls ? " " + cls : "");
  b.textContent = text;
  b.onclick = onClick;
  return b;
}

function buildCandidateReadRow(c) {
  const meta = statusMeta(c.status);
  const role = roles.find(r => r.id === c.role_id);
  const tr = document.createElement("tr");

  tr.appendChild(selectCell(c));

  const nameTd = tableTd("Candidate");
  if (c.name) {
    const link = document.createElement("a");
    link.className = "name-link";
    link.textContent = c.name;
    link.onclick = () => openDrawer(c.id);
    nameTd.appendChild(link);
  } else {
    nameTd.innerHTML = `<span class="name empty">Unassigned</span>`;
  }
  tr.appendChild(nameTd);

  const roleTd = tableTd("Role");
  roleTd.innerHTML = role ? `<span style="font-size:13px;">${escapeHtml(role.name)}</span>` : `<span class="vendor-tag empty">—</span>`;
  tr.appendChild(roleTd);

  const vendorTd = tableTd("Vendor");
  vendorTd.innerHTML = c.vendor
    ? `<span class="vendor-tag">${escapeHtml(c.vendor)}</span>`
    : `<span class="vendor-tag empty">—</span>`;
  tr.appendChild(vendorTd);

  const statusTd = tableTd("Status");
  statusTd.innerHTML = `<span style="font-family:var(--mono); font-size:11px; color:${meta.color}; border:1px solid var(--border); border-radius:4px; padding:2px 8px;">${escapeHtml(c.status)}</span>`;
  tr.appendChild(statusTd);

  const resumeTd = tableTd("Resume");
  resumeTd.className = "resume-cell";
  if (c.has_resume) {
    const wrap = document.createElement("div");
    wrap.className = "resume-file";
    const link = document.createElement("a");
    link.className = "resume-name";
    link.textContent = c.resume_filename || "Resume";
    link.href = `/api/candidates/${c.id}/resume`;
    link.onclick = (e) => { e.preventDefault(); openResumeView(c.id); };
    wrap.appendChild(link);
    resumeTd.appendChild(wrap);
  } else if (canEdit()) {
    const uploadBtn = document.createElement("button");
    uploadBtn.className = "btn ghost small";
    uploadBtn.textContent = "Upload";
    uploadBtn.onclick = () => {
      pendingUploadCandidateId = c.id;
      document.getElementById("resumeFileInput").click();
    };
    resumeTd.appendChild(uploadBtn);
  } else {
    resumeTd.innerHTML = `<span class="vendor-tag empty">—</span>`;
  }
  tr.appendChild(resumeTd);

  const notesTd = tableTd("Notes");
  notesTd.className = "notes-cell";
  notesTd.textContent = c.notes || "";
  if (!c.notes) notesTd.style.color = "var(--muted)";
  tr.appendChild(notesTd);

  const actionTd = tableTd("");
  if (canEdit()) actionTd.appendChild(smallBtn("Edit", "ghost", () => startEditCandidate(c.id)));
  tr.appendChild(actionTd);

  return tr;
}

function buildCandidateEditRow(c) {
  const d = candidateEditDraft;
  const meta = statusMeta(d.status);
  const tr = document.createElement("tr");
  tr.style.outline = "1px solid var(--cyan)";
  tr.style.outlineOffset = "-1px";

  tr.appendChild(selectCell(c));

  const nameTd = tableTd("Candidate");
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = d.name || "";
  nameInput.placeholder = "Candidate name";
  nameInput.style.width = "100%";
  nameInput.oninput = () => { candidateEditDraft.name = nameInput.value; };
  nameInput.onkeydown = (e) => { if (e.key === "Enter") saveCandidateEdit(c.id); };
  nameTd.appendChild(nameInput);
  tr.appendChild(nameTd);

  const roleTd = tableTd("Role");
  const roleSel = document.createElement("select");
  roleSel.className = "status-select";
  roleSel.style.color = "var(--muted)";
  roleSel.style.background = "var(--panel-2)";
  roleSel.style.padding = "5px 8px";
  roleSel.style.borderRadius = "4px";
  roleSel.style.fontFamily = "var(--sans)";
  roleSel.style.fontSize = "12.5px";
  const roleOptions = roles.length ? roles.map(r => ({ value: r.id, label: r.name })) : [];
  roleOptions.forEach(r => {
    const opt = document.createElement("option");
    opt.value = r.value;
    opt.textContent = r.label;
    if (String(r.value) === String(d.role_id)) opt.selected = true;
    roleSel.appendChild(opt);
  });
  roleSel.onchange = () => {
    candidateEditDraft.role_id = roleSel.value ? parseInt(roleSel.value, 10) : null;
  };
  roleTd.appendChild(roleSel);
  tr.appendChild(roleTd);

  const vendorTd = tableTd("Vendor");
  const vendorInput = document.createElement("input");
  vendorInput.type = "text";
  vendorInput.list = "vendorOptions";
  vendorInput.value = d.vendor || "";
  vendorInput.placeholder = "e.g. Naukri, in-house";
  vendorInput.style.width = "100%";
  vendorInput.oninput = () => { candidateEditDraft.vendor = vendorInput.value; };
  vendorTd.appendChild(vendorInput);
  tr.appendChild(vendorTd);

  const statusTd = tableTd("Status");
  const sel = document.createElement("select");
  sel.className = "status-select";
  sel.style.color = meta.color;
  sel.style.background = meta.bg;
  STATUSES.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s.key;
    opt.textContent = s.key;
    if (s.key === d.status) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.onchange = () => { candidateEditDraft.status = sel.value; };
  statusTd.appendChild(sel);
  tr.appendChild(statusTd);

  const resumeTd = tableTd("Resume");
  resumeTd.className = "resume-cell";
  if (c.has_resume) {
    const wrap = document.createElement("div");
    wrap.className = "resume-file";
    const link = document.createElement("a");
    link.className = "resume-name";
    link.textContent = c.resume_filename || "Resume";
    link.href = `/api/candidates/${c.id}/resume`;
    link.onclick = (e) => { e.preventDefault(); openResumeView(c.id); };
    wrap.appendChild(link);
    const armed = armedDelete && armedDelete.type === "resume" && armedDelete.id === c.id;
    const rm = document.createElement("button");
    rm.className = armed ? "btn danger small" : "btn ghost small";
    rm.textContent = armed ? "Confirm" : "Remove";
    rm.onclick = () => removeResumeFromTable(c.id);
    wrap.appendChild(rm);
    resumeTd.appendChild(wrap);
  } else {
    resumeTd.innerHTML = `<span class="vendor-tag empty">—</span>`;
  }
  tr.appendChild(resumeTd);

  const notesTd = tableTd("Notes");
  notesTd.className = "notes-cell";
  const notesInput = document.createElement("input");
  notesInput.type = "text";
  notesInput.value = d.notes || "";
  notesInput.placeholder = "Add a note...";
  notesInput.style.width = "100%";
  notesInput.oninput = () => { candidateEditDraft.notes = notesInput.value; };
  notesTd.appendChild(notesInput);
  tr.appendChild(notesTd);

  return tr;
}

function buildCandidateEditActionsRow(c) {
  const tr = document.createElement("tr");
  tr.style.outline = "1px solid var(--cyan)";
  tr.style.outlineOffset = "-1px";
  tr.style.background = "var(--bg)";
  const td = document.createElement("td");
  td.colSpan = 8;
  td.style.padding = "8px 10px";
  const wrap = document.createElement("div");
  wrap.style.display = "flex";
  wrap.style.alignItems = "center";
  wrap.style.gap = "8px";
  wrap.style.flexWrap = "wrap";
  const armedDel = armedDelete && armedDelete.type === "candidate" && armedDelete.id === c.id;
  wrap.appendChild(smallBtn("Save", "", () => saveCandidateEdit(c.id)));
  wrap.appendChild(smallBtn(armedDel ? "Confirm delete" : "Delete", "danger", () => deleteCandidate(c.id)));
  wrap.appendChild(smallBtn("Cancel", "ghost", cancelEditCandidate));
  td.appendChild(wrap);
  tr.appendChild(td);
  return tr;
}

function renderTable() {
  const tbody = document.getElementById("tbody");
  const emptyState = document.getElementById("emptyState");
  tbody.innerHTML = "";

  if (candidates.length === 0) {
    emptyState.style.display = "block";
    return;
  }
  emptyState.style.display = "none";

  candidates.forEach(c => {
    if (editCandidateId === c.id) {
      tbody.appendChild(buildCandidateEditRow(c));
      tbody.appendChild(buildCandidateEditActionsRow(c));
    } else {
      tbody.appendChild(buildCandidateReadRow(c));
    }
  });

  syncSelectAllCheck();
  renderSelectionBar();
}

function selectCell(c) {
  const td = tableTd("");
  td.style.width = "30px";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.className = "row-select";
  cb.dataset.id = c.id;
  cb.checked = selectedIds.has(c.id);
  cb.onchange = () => toggleRowSelect(c.id, cb.checked);
  td.appendChild(cb);
  return td;
}

function syncSelectAllCheck() {
  const el = document.getElementById("selectAllCheck");
  if (!el) return;
  const allVisible = candidates.length > 0 && candidates.every(c => selectedIds.has(c.id));
  el.checked = allVisible;
  el.indeterminate = selectedIds.size > 0 && !allVisible;
}

function syncRowCheckboxes() {
  document.querySelectorAll("#tbody .row-select").forEach(cb => {
    cb.checked = selectedIds.has(parseInt(cb.dataset.id, 10));
  });
}

function renderSelectionBar() {
  const bar = document.getElementById("selectionBar");
  if (!bar) return;
  if (selectedIds.size === 0) {
    bar.style.display = "none";
    return;
  }
  bar.style.display = "flex";
  document.getElementById("selectionCount").textContent =
    `${selectedIds.size} selected`;
  const allBtn = document.getElementById("selectionSelectBtn");
  const allVisible = candidates.length > 0 && candidates.every(c => selectedIds.has(c.id));
  allBtn.innerHTML = allVisible
    ? `<button class="btn ghost small" onclick="toggleSelectAll(false)">Deselect all (${candidates.length})</button>`
    : `<button class="btn ghost small" onclick="toggleSelectAll(true)">Select all (${candidates.length})</button>`;
  document.getElementById("deleteSelectedBtn").textContent =
    armedBulkDelete ? "Confirm delete" : "Delete selected";
}

window.toggleRowSelect = (id, checked) => {
  const num = typeof id === "number" ? id : parseInt(id, 10);
  if (checked) selectedIds.add(num); else selectedIds.delete(num);
  syncSelectAllCheck();
  renderSelectionBar();
};

window.toggleSelectAll = (checked) => {
  candidates.forEach(c => checked ? selectedIds.add(c.id) : selectedIds.delete(c.id));
  syncSelectAllCheck();
  renderSelectionBar();
  syncRowCheckboxes();
};

window.clearSelection = () => {
  selectedIds.clear();
  armedBulkDelete = false;
  clearTimeout(armBulkDeleteTimer);
  const el = document.getElementById("selectAllCheck");
  if (el) { el.checked = false; el.indeterminate = false; }
  renderSelectionBar();
  syncRowCheckboxes();
};

window.deleteSelected = async () => {
  const n = selectedIds.size;
  if (!n) return;
  if (!armedBulkDelete) {
    armedBulkDelete = true;
    clearTimeout(armBulkDeleteTimer);
    armBulkDeleteTimer = setTimeout(() => { armedBulkDelete = false; renderSelectionBar(); }, 5000);
    setDashboardMessage(`Delete ${n} selected candidate${n === 1 ? "" : "s"}? Click Delete selected again to confirm.`, "info");
    renderSelectionBar();
    return;
  }
  const ids = [...selectedIds];
  try {
    const res = await api("/api/candidates/bulk-delete", { method: "POST", body: JSON.stringify({ ids }) });
    selectedIds.clear();
    armedBulkDelete = false;
    clearTimeout(armBulkDeleteTimer);
    setDashboardMessage(`Deleted ${res.deleted} candidate${res.deleted === 1 ? "" : "s"}.`, "saved");
    await refreshCandidates();
    refreshStats();
  } catch (e) {
    setDashboardMessage("Delete failed: " + e.message, "error");
  }
};

window.startEditCandidate = (id) => {
  if (!canEdit()) return;
  const c = candidates.find(x => x.id === id);
  if (!c) return;
  editCandidateId = id;
  candidateEditDraft = {
    name: c.name || "",
    role_id: c.role_id ?? null,
    vendor: c.vendor || "",
    status: c.status || "Sourcing",
    notes: c.notes || ""
  };
  renderTable();
};

window.cancelEditCandidate = () => {
  editCandidateId = null;
  candidateEditDraft = null;
  armedDelete = null;
  renderTable();
};

window.saveCandidateEdit = async (id) => {
  if (!canEdit()) return;
  if (!candidateEditDraft) return;
  const name = (candidateEditDraft.name || "").trim();
  if (!name) { setDashboardMessage("Candidate name cannot be empty.", "error"); return; }
  try {
    await api(`/api/candidates/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name,
        role_id: candidateEditDraft.role_id ?? null,
        vendor: (candidateEditDraft.vendor || "").trim() || null,
        status: candidateEditDraft.status || "Sourcing",
        notes: (candidateEditDraft.notes || "").trim()
      })
    });
    editCandidateId = null;
    candidateEditDraft = null;
    armedDelete = null;
    await refreshCandidates();
    renderStats();
    setDashboardMessage(`Candidate "${name}" saved.`, "saved");
  } catch (e) { setDashboardMessage("Save failed: " + e.message, "error"); }
};

window.deleteCandidate = async (id) => {
  const c = candidates.find(x => x.id === id);
  if (!c) return;
  if (armedDelete && armedDelete.type === "candidate" && armedDelete.id === id) {
    try {
      await api(`/api/candidates/${id}`, { method: "DELETE" });
      armedDelete = null;
      editCandidateId = null;
      candidateEditDraft = null;
      await refreshCandidates();
      renderStats();
      setDashboardMessage(`Candidate "${c.name || "Unassigned"}" deleted.`, "saved");
    } catch (err) { setDashboardMessage("Delete failed: " + err.message, "error"); }
  } else {
    setDashboardMessage(`Delete ${c.name ? `"${c.name}"` : "this candidate"}? Click Delete again to confirm.`, "info");
    armDelete("candidate", id, renderTable);
  }
};

window.removeResumeFromTable = async (id) => {
  if (armedDelete && armedDelete.type === "resume" && armedDelete.id === id) {
    try {
      await api(`/api/candidates/${id}/resume`, { method: "DELETE" });
      armedDelete = null;
      await refreshCandidates();
      refreshStats();
      setDashboardMessage("Resume removed.", "saved");
    } catch (err) { setDashboardMessage("Remove failed: " + err.message, "error"); }
  } else {
    setDashboardMessage("Remove this resume? Click Remove again to confirm.", "info");
    armDelete("resume", id, renderTable);
  }
};

function renderFooter() {
  const footer = document.getElementById("footer");
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const start = totalCount === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const end = Math.min(totalCount, currentPage * pageSize);

  const sizeOptions = [10, 20, 50, 100].map(n =>
    `<option value="${n}" ${n === pageSize ? "selected" : ""}>${n}</option>`
  ).join("");

  const pages = [];
  for (let p = 1; p <= totalPages; p++) {
    if (totalPages > 7 && p > 1 && p < totalPages && Math.abs(p - currentPage) > 2) {
      if (pages[pages.length - 1] !== "…") pages.push("…");
      continue;
    }
    pages.push(p);
  }

  const pageBtns = pages.map(p =>
    p === "…"
      ? `<span class="page-ellipsis">…</span>`
      : `<button class="page-btn ${p === currentPage ? "active" : ""}" onclick="goToPage(${p})">${p}</button>`
  ).join("");

  footer.innerHTML =
    `<div class="page-size-row">
       <label>Show</label>
       <select class="page-size" onchange="changePageSize(this.value)">${sizeOptions}</select>
       <span>per page</span>
     </div>
     <div class="page-info">Showing ${start}\u2013${end} of ${totalCount}</div>
     <div class="page-nav">
       <button class="page-btn" ${currentPage <= 1 ? "disabled" : ""} onclick="goToPage(${currentPage - 1})">\u2039</button>
       ${pageBtns}
       <button class="page-btn" ${currentPage >= totalPages ? "disabled" : ""} onclick="goToPage(${currentPage + 1})">\u203a</button>
     </div>`;
}

window.goToPage = (p) => {
  if (p < 1) return;
  currentPage = p;
  clearSelection();
  refreshCandidates();
};

window.changePageSize = (n) => {
  pageSize = parseInt(n, 10) || 20;
  currentPage = 1;
  clearSelection();
  refreshCandidates();
};

/* ---------------- Drawer / Drill-Down ---------------- */

async function openDrawer(candidateId) {
  selectedCandidateId = candidateId;
  editingStageId = null;
  stageEditDraft = null;
  const overlay = document.getElementById("drawerOverlay");
  const content = document.getElementById("drawerContent");
  const prevScroll = content.scrollTop;
  overlay.style.display = "flex";
  content.innerHTML = `<div style="text-align:center; padding:40px; color:var(--muted);">Loading...</div>`;
  try {
    const cand = candidates.find(x => x.id === candidateId) || {};
    const [stages, events] = await Promise.all([
      api(`/api/candidates/${candidateId}/stages`),
      api(`/api/candidates/${candidateId}/events`)
    ]);
    stagesCache = stages;
    lastEvents = events;
    renderDrawer(cand, stages, events);
    content.scrollTop = prevScroll;
  } catch (e) {
    content.innerHTML = `<div class="modal-close" onclick="closeDrawer()">&times;</div><div style="color:var(--red); padding:20px;">Failed to load candidate: ${escapeHtml(e.message)}</div>`;
  }
}

function renderDrawer(cand, stages, events) {
  const content = document.getElementById("drawerContent");
  const meta = statusMeta(cand.status);

  function tlColor(ev) {
    const t = ev.event_type;
    const lbl = (ev.label || "").toLowerCase();
    if (t === "created" || t === "note") return "var(--cyan)";
    if (t === "stage_completed" || t === "resume" || lbl.includes("hired")) return "var(--green)";
    if (t === "stage_scheduled" || lbl.includes("interview scheduled")) return "var(--amber)";
    if (lbl.includes("rejected")) return "var(--red)";
    if (lbl.includes("on hold")) return "var(--muted)";
    return "var(--dim)";
  }

  const timelineHtml = (events && events.length)
    ? events.map(ev => `
      <div class="tl-item">
        <div class="tl-dot" style="background:${tlColor(ev)}"></div>
        <div class="tl-body">
          <div class="tl-label">${escapeHtml(ev.label)}</div>
          <div class="tl-time">${escapeHtml(fmtDate(ev.occurred_at))}</div>
        </div>
      </div>`).join("")
    : `<div style="color:var(--muted); font-size:13px; padding:6px 0;">No timeline events yet.</div>`;

  stagesCache = stages;
  lastEvents = events;

  const stagesHtml = buildStagesHtml(stages);

  const canEditThis = canEdit();

  const vendorField = canEditThis
    ? `<div class="modal-field">
        <label>Vendor</label>
        <input type="text" id="drawerVendor" list="vendorOptions" value="${escapeHtml(cand.vendor || "")}" style="flex:1;" onchange="updateCandidateField(${cand.id}, 'vendor', this.value)" />
      </div>`
    : `<div class="modal-field">
        <label>Vendor</label>
        <span>${escapeHtml(cand.vendor || "—")}</span>
      </div>`;

  const roleField = canEditThis
    ? `<div class="modal-field">
        <label>Role</label>
        <select id="drawerRole" onchange="updateCandidateField(${cand.id}, 'role_id', this.value)">
          <option value="">— No role —</option>
          ${roles.map(r => `<option value="${r.id}" ${r.id === cand.role_id ? "selected" : ""}>${escapeHtml(r.name)}</option>`).join("")}
        </select>
      </div>`
    : `<div class="modal-field">
        <label>Role</label>
        <span>${cand.role_name ? escapeHtml(cand.role_name) : "—"}</span>
      </div>`;

  const statusField = canEditThis
    ? `<div class="modal-field">
        <label>Status</label>
        <select onchange="updateCandidateField(${cand.id}, 'status', this.value)" style="color:${meta.color}; background:${meta.bg}; border-radius:20px; border:none; padding:5px 12px; cursor:pointer;">
          ${STATUSES.map(s => `<option value="${s.key}" ${s.key === cand.status ? "selected" : ""}>${s.key}</option>`).join("")}
        </select>
      </div>`
    : `<div class="modal-field">
        <label>Status</label>
        <span style="color:${meta.color}; background:${meta.bg}; border-radius:20px; border:none; padding:5px 12px;">${escapeHtml(cand.status || "—")}</span>
      </div>`;

  const notesField = canEditThis
    ? `<div class="modal-field" style="align-items:flex-start;">
        <label>Notes</label>
        <textarea id="drawerNotes" placeholder="Add notes..." style="flex:1;" onchange="updateCandidateField(${cand.id}, 'notes', this.value)">${escapeHtml(cand.notes || "")}</textarea>
      </div>`
    : `<div class="modal-field" style="align-items:flex-start;">
        <label>Notes</label>
        <span style="white-space:pre-wrap;">${escapeHtml(cand.notes || "—")}</span>
      </div>`;

  const addStageForm = canEditThis ? `
    <div class="form-row">
      <div>
        <div class="form-label">STAGE</div>
        <select id="newStageName">
          ${STAGE_PRESETS.map(s => `<option>${escapeHtml(s)}</option>`).join("")}
        </select>
      </div>
      <div>
        <div class="form-label">INTERVIEWER</div>
        <input type="text" id="newStageInterviewer" placeholder="Interviewer name" />
      </div>
    </div>
    <div class="form-row">
      <div>
        <div class="form-label">SCHEDULED AT</div>
        <input type="datetime-local" id="newStageDate" />
      </div>
      <div>
        <div class="form-label">ACTION</div>
        <button class="btn" style="width:100%; margin-top:14px;" onclick="addStage(${cand.id})">Add stage</button>
      </div>
    </div>` : "";

  const resumeActions = cand.has_resume
    ? (canEditThis
        ? `${armedResumeDelId === cand.id
             ? `<button class="btn danger small" onclick="deleteResumeFromDrawer(${cand.id})">Confirm</button>`
             : `<button class="btn ghost small" onclick="deleteResumeFromDrawer(${cand.id})">Remove</button>`}`
        : "")
    : (canEditThis
        ? `<div class="dropzone" id="drawerDropzone">Drop resume here or click to upload (.pdf, .doc, .docx)</div>`
        : `<span class="vendor-tag empty">—</span>`);

  content.innerHTML = `
    <div class="modal-close" onclick="closeDrawer()">&times;</div>
    <div class="modal-title">${cand.name ? escapeHtml(cand.name) : "Unassigned"}</div>
    <div style="text-align:center; margin-bottom:12px;"><span id="drawerMsg" class="inline-msg" style="display:none;"></span></div>

    <div class="modal-section">
      <div class="modal-section-title">DETAILS</div>
      ${roleField}
      ${vendorField}
      ${statusField}
      ${notesField}
      <div class="modal-field">
        <label>Created</label>
        <span>${escapeHtml(fmtDate(cand.created_at))}</span>
      </div>
    </div>

    <div class="modal-section">
      <div class="modal-section-title">TIMELINE</div>
      <div class="timeline">${timelineHtml}</div>
    </div>

    <div class="modal-section">
      <div class="modal-section-title">INTERVIEW STAGES</div>
      ${addStageForm}
      <div style="margin-top:12px;" id="drawerStages">${stagesHtml}</div>
    </div>

    ${cand.name ? `
    <div class="modal-section">
      <div class="modal-section-title">RESUME</div>
      <div class="resume-cell">
        ${cand.has_resume
          ? `<a class="resume-name" href="/api/candidates/${cand.id}/resume" onclick="event.preventDefault(); openResumeView(${cand.id})">${escapeHtml(cand.resume_filename)}</a> ${resumeActions}`
          : resumeActions}
      </div>
    </div>` : ""}
  `;
  const dz = document.getElementById("drawerDropzone");
  if (dz) {
    dz.onclick = () => {
      pendingUploadCandidateId = cand.id;
      document.getElementById("resumeFileInput").click();
    };
    dz.ondragover = (e) => { e.preventDefault(); dz.classList.add("dragover"); };
    dz.ondragleave = () => dz.classList.remove("dragover");
    dz.ondrop = (e) => {
      e.preventDefault();
      dz.classList.remove("dragover");
      const file = e.dataTransfer.files[0];
      if (file) uploadResume(cand.id, file);
    };
  }
}

function toLocalDatetime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

window.startEditStage = (id) => {
  const s = stagesCache.find(x => x.id === id);
  if (!s) return;
  editingStageId = id;
  stageEditDraft = {
    stage_name: s.stage_name || "",
    interviewer: s.interviewer || "",
    scheduled_at: toLocalDatetime(s.scheduled_at),
    feedback: s.feedback || ""
  };
  renderDrawer(candidates.find(x => x.id === selectedCandidateId) || {}, stagesCache, lastEvents);
};

window.stageEditField = (field, value) => {
  if (stageEditDraft && Object.prototype.hasOwnProperty.call(stageEditDraft, field)) stageEditDraft[field] = value;
};

window.saveStageEdit = async (id) => {
  if (!stageEditDraft) return;
  const body = {
    stage_name: (stageEditDraft.stage_name || "").trim(),
    interviewer: (stageEditDraft.interviewer || "").trim() || null,
    feedback: (stageEditDraft.feedback || "").trim() || null
  };
  if (stageEditDraft.scheduled_at) {
    const t = new Date(stageEditDraft.scheduled_at);
    body.scheduled_at = isNaN(t) ? null : t.toISOString();
  } else {
    body.scheduled_at = null;
  }
  try {
    await api(`/api/stages/${id}`, { method: "PUT", body: JSON.stringify(body) });
    editingStageId = null;
    stageEditDraft = null;
    refreshStages();
    refreshCandidates();
  } catch (e) { setInlineMessage("drawerMsg", "Error saving stage: " + e.message, "error"); }
};

window.cancelEditStage = () => {
  editingStageId = null;
  stageEditDraft = null;
  refreshStages();
};

window.setStageRating = async (id, rating) => {
  const s = stagesCache.find(x => x.id === id);
  const next = (s && s.rating === rating) ? null : rating;
  try {
    await api(`/api/stages/${id}`, { method: "PUT", body: JSON.stringify({ rating: next }) });
    refreshStages();
    refreshCandidates();
  } catch (e) { setInlineMessage("drawerMsg", "Error saving rating: " + e.message, "error"); }
};

window.cycleStar = (id, starIndex) => {
  const s = stagesCache.find(x => x.id === id);
  const cur = s ? s.rating : null;
  const whole = starIndex + 1;
  const half = whole - 0.5;
  let next;
  if (cur === whole) next = half;
  else if (cur === half) next = null;
  else next = whole;
  setStageRating(id, next);
};

function starCells(id, rating, editable) {
  const halfSteps = rating ? Math.round(rating * 2) : 0;
  let html = "";
  for (let i = 0; i < 5; i++) {
    const fill = Math.max(0, Math.min(2, halfSteps - i * 2));
    let inner = `<span class="star ${fill === 2 ? "filled" : ""}">★</span>`;
    if (fill === 1) inner += `<span class="star-half">★</span>`;
    if (!editable) {
      html += `<span class="star-cell">${inner}</span>`;
    } else {
      const whole = i + 1;
      const title = `Click: ${whole} · ${whole - 0.5}/5 · click same to clear`;
      html += `<span class="star-cell" onclick="cycleStar(${id}, ${i})" title="${title}">${inner}</span>`;
    }
  }
  return html;
}

function buildStagesHtml(stages) {
  const editable = canEdit();
  let html = "";
  (stages || []).forEach(s => {
    const isEditing = editingStageId === s.id;
    const d = isEditing && stageEditDraft ? stageEditDraft : null;
    const stars = starCells(s.id, s.rating, editable);

    let head;
    if (isEditing && d) {
      head = `<input type="text" value="${escapeHtml(d.stage_name)}" style="width:100%;" oninput="stageEditField('stage_name', this.value)" />`;
    } else {
      head = `<span class="stage-name">${escapeHtml(s.stage_name)}</span>
          ${s.completed ? '<span class="completed-badge">COMPLETED</span>' : '<span class="pending-badge">PENDING</span>'}`;
    }

    let meta;
    if (isEditing && d) {
      meta = `
        <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:6px;">
          <input type="text" placeholder="Interviewer name" value="${escapeHtml(d.interviewer)}" style="flex:1; min-width:120px;" oninput="stageEditField('interviewer', this.value)" />
          <input type="datetime-local" value="${escapeHtml(d.scheduled_at)}" style="flex:1; min-width:160px;" oninput="stageEditField('scheduled_at', this.value)" />
        </div>`;
    } else {
      meta = `<div class="stage-meta">
          ${s.interviewer ? `Interviewer: ${escapeHtml(s.interviewer)}` : ""}
          ${s.scheduled_at ? ` &middot; Scheduled: ${escapeHtml(fmtDate(s.scheduled_at))}` : ""}
        </div>`;
    }

    let feedback;
    if (isEditing && d) {
      feedback = `<textarea rows="2" placeholder="Feedback..." style="width:100%; margin-top:6px;" oninput="stageEditField('feedback', this.value)">${escapeHtml(d.feedback)}</textarea>`;
    } else if (s.feedback) {
      feedback = `<div class="stage-feedback">${escapeHtml(s.feedback)}</div>`;
    } else {
      feedback = "";
    }

    let actions = "";
    if (editable) {
      actions = isEditing && d
        ? `<button class="btn small" onclick="saveStageEdit(${s.id})">Save</button>
           <button class="btn ghost small" onclick="cancelEditStage()">Cancel</button>`
        : `<button class="btn ghost small" onclick="startEditStage(${s.id})">Edit</button>`;
      actions += `
      <button class="btn ghost small" onclick="toggleStageComplete(${s.id}, ${s.completed ? 0 : 1})">${s.completed ? "Reopen" : "Mark complete"}</button>
      ${armedStageDeleteId === s.id
        ? '<button class="btn danger small" onclick="deleteStage(' + s.id + ')">Confirm delete</button>'
        : '<button class="btn ghost small" onclick="deleteStage(' + s.id + ')" style="color:var(--red);">Delete</button>'}`;
    }

    html += `
      <div class="stage-card" ${isEditing ? 'style="border:1px solid var(--cyan);"' : ""}>
        <div class="stage-head" ${isEditing ? 'style="justify-content:flex-start;"' : ""}>${head}</div>
        ${meta}
        <div class="star-rating" style="margin-top:6px;">
          ${stars}
          <span style="margin-left:8px; font-size:12px; color:var(--muted);">${s.rating ? s.rating + "/5" : "No rating"}</span>
        </div>
        ${feedback}
        <div style="margin-top:8px; display:flex; gap:6px; align-items:center; flex-wrap:wrap;">${actions}</div>
      </div>`;
  });
  if (!stages || !stages.length) {
    html = `<div style="color:var(--muted); font-size:13px; padding:8px 0;">No interview stages logged yet.</div>`;
  }
  return html;
}

window.refreshStages = async () => {
  if (!selectedCandidateId) return;
  try {
    const stages = await api(`/api/candidates/${selectedCandidateId}/stages`);
    stagesCache = stages;
    const el = document.getElementById("drawerStages");
    if (el) el.innerHTML = buildStagesHtml(stages);
    refreshCandidates();
  } catch (e) { setInlineMessage("drawerMsg", "Error refreshing stages: " + e.message, "error"); }
};

window.toggleStageComplete = async (stageId, completed) => {
  try {
    await api(`/api/stages/${stageId}`, { method: "PUT", body: JSON.stringify({ completed: !!completed }) });
    if (completed) {
      const c = candidates.find(x => x.id === selectedCandidateId);
      if (c && c.status === "Screening") {
        await api(`/api/candidates/${c.id}`, { method: "PATCH", body: JSON.stringify({ status: "Interview Scheduled" }) });
      }
    }
    openDrawer(selectedCandidateId);
    refreshCandidates();
    refreshStats();
  } catch (e) { setInlineMessage("drawerMsg", "Error updating stage: " + e.message, "error"); }
};

window.deleteStage = async (stageId) => {
  if (armedStageDeleteId === stageId) {
    try {
      await api(`/api/stages/${stageId}`, { method: "DELETE" });
    } catch (e) { /* endpoint may be unavailable */ }
    armedStageDeleteId = null;
    openDrawer(selectedCandidateId);
    refreshCandidates();
    return;
  }
  armedStageDeleteId = stageId;
  openDrawer(selectedCandidateId);
  setInlineMessage("drawerMsg", "Delete this stage? Click Delete again to confirm.", "info");
};

window.closeDrawer = () => {
  document.getElementById("drawerOverlay").style.display = "none";
  selectedCandidateId = null;
  armedStageDeleteId = null;
  armedResumeDelId = null;
};

window.updateCandidateField = async (candidateId, field, value) => {
  if (!canEdit()) return;
  const body = { [field]: field === "role_id" ? (value ? parseInt(value, 10) : null) : value };
  try {
    await api(`/api/candidates/${candidateId}`, { method: "PATCH", body: JSON.stringify(body) });
    refreshCandidates();
    if (selectedCandidateId === candidateId) openDrawer(candidateId);
  } catch (e) { setInlineMessage("drawerMsg", "Error updating candidate: " + e.message, "error"); }
};

window.addStage = async (candidateId) => {
  if (!canEdit()) return;
  const name = document.getElementById("newStageName").value.trim();
  const interviewer = document.getElementById("newStageInterviewer").value.trim();
  const scheduled = document.getElementById("newStageDate").value;
  if (!name) { setInlineMessage("drawerMsg", "Stage name is required.", "error"); return; }
  const body = { stage_name: name, interviewer: interviewer || null };
  if (scheduled) body.scheduled_at = new Date(scheduled).toISOString();
  try {
    await api(`/api/candidates/${candidateId}/stages`, { method: "POST", body: JSON.stringify(body) });
    openDrawer(candidateId);
  } catch (e) { setInlineMessage("drawerMsg", "Error adding stage: " + e.message, "error"); }
};

window.deleteResumeFromDrawer = async (candidateId) => {
  if (!canEdit()) return;
  if (armedResumeDelId === candidateId) {
    try {
      await api(`/api/candidates/${candidateId}/resume`, { method: "DELETE" });
      armedResumeDelId = null;
      openDrawer(candidateId);
      refreshCandidates();
    } catch (e) { setInlineMessage("drawerMsg", "Error removing resume: " + e.message, "error"); }
    return;
  }
  armedResumeDelId = candidateId;
  openDrawer(candidateId);
  setInlineMessage("drawerMsg", "Remove this resume? Click Remove again to confirm.", "info");
};

/* ---------------- Resume Upload ---------------- */

async function uploadResume(candidateId, file) {
  if (!canEdit()) return;
  const fd = new FormData();
  fd.append("file", file);
  try {
    await api(`/api/candidates/${candidateId}/resume`, { method: "POST", body: fd });
    refreshCandidates();
    if (selectedCandidateId === candidateId) openDrawer(candidateId);
  } catch (e) {
    const drawerOpen = document.getElementById("drawerOverlay").style.display === "flex";
    if (drawerOpen && selectedCandidateId === candidateId) {
      setInlineMessage("drawerMsg", "Couldn't upload resume: " + e.message, "error");
    } else {
      setDashboardMessage("Couldn't upload resume: " + e.message, "error");
    }
  }
}

/* ---------------- Resume Viewer ---------------- */

function resumeFileExt(name) {
  const base = String(name || "").split("?")[0];
  if (!base.includes(".")) return "";
  return base.split(".").pop().toLowerCase();
}

window.openResumeView = (candidateId) => {
  const c = candidates.find(x => x.id === candidateId) || {};
  const name = c.resume_filename || "Resume";
  const ext = resumeFileExt(name);
  const overlay = document.getElementById("resumeOverlay");
  const content = document.getElementById("resumeContent");
  const viewHref = `/api/candidates/${candidateId}/resume`;
  const downloadHref = `${viewHref}?download=1`;
  const IMG_EXTS = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif"];
  const IFRAME_EXTS = ["pdf", "txt", "md", "csv", "json", "log", "html", "htm", "rtf"];

  let body;
  if (IMG_EXTS.includes(ext)) {
    body = `<img src="${viewHref}" alt="${escapeHtml(name)}" style="max-width:100%; max-height:calc(100vh - 150px); display:block; margin:0 auto; background:var(--panel-2); border-radius:6px;" />`;
  } else if (IFRAME_EXTS.includes(ext)) {
    body = `<iframe class="resume-frame" src="${viewHref}" title="${escapeHtml(name)}"></iframe>`;
  } else {
    body = `<div class="resume-unsupported">
      <div style="font-size:16px; font-weight:500; margin-bottom:6px;">Preview not available</div>
      <div style="color:var(--muted); font-size:13px; max-width:420px; margin-bottom:18px;">
        ${escapeHtml((ext || "this file type").toUpperCase())} files can't be shown in the browser. Download the file to view it.
      </div>
      <a class="btn" href="${downloadHref}" download>Download ${escapeHtml(name)}</a>
    </div>`;
  }

  content.innerHTML = `
    <div class="resume-viewer-head">
      <div style="display:flex; align-items:center; gap:8px; min-width:0;">
        <span style="font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:380px;">${escapeHtml(name)}</span>
        <span style="font-family:var(--mono); font-size:11px; color:var(--muted); border:1px solid var(--border); border-radius:4px; padding:1px 6px; text-transform:uppercase;">${escapeHtml(ext || "file")}</span>
      </div>
      <div style="display:flex; gap:8px; align-items:center;">
        <a class="btn small" href="${downloadHref}" download>Download</a>
        <button class="modal-close" onclick="closeResumeView()">&times;</button>
      </div>
    </div>
    ${body}`;
  overlay.style.display = "flex";
};

window.closeResumeView = () => {
  document.getElementById("resumeOverlay").style.display = "none";
  document.getElementById("resumeContent").innerHTML = "";
};

document.getElementById("resumeOverlay").addEventListener("click", (e) => {
  if (e.target && e.target.id === "resumeOverlay") closeResumeView();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeResumeView();
});

/* ---------------- Admin / Roles + Vendors ---------------- */

let editRoleId = null;
let roleEditDraft = null;
let editVendorId = null;
let vendorEditDraft = null;
let editStatusId = null;
let statusEditDraft = null;
let armedDelete = null;

function initAdminDrafts() {
  adminDrafts = { newRoles: [], newVendors: [], newStatuses: [], newUsers: [] };
}

function setInlineMessage(elId, msg, type) {
  const el = document.getElementById(elId);
  if (!el) return;
  clearTimeout(window["__msg_" + elId]);
  if (!msg) {
    el.style.display = "none";
    el.className = "inline-msg";
    el.textContent = "";
    return;
  }
  el.style.display = "inline-block";
  el.className = "inline-msg" + (type ? " " + type : "");
  el.textContent = msg;
  window["__msg_" + elId] = setTimeout(() => {
    el.style.display = "none";
    el.className = "inline-msg";
    el.textContent = "";
  }, 5000);
}

function setAdminMessage(msg, type) {
  setInlineMessage("adminMessage", msg, type);
}

function setDashboardMessage(msg, type) {
  setInlineMessage("dashboardMessage", msg, type);
}

function statusBadge(status) {
  const color = status === "Open" ? "var(--green)" : status === "Closed" ? "var(--dim)" : "var(--amber)";
  return `<span style="font-family:var(--mono); font-size:11px; color:${color}; border:1px solid var(--border); border-radius:4px; padding:2px 8px;">${escapeHtml(status)}</span>`;
}

function roleReadRow(r) {
  return `
    <div class="admin-role-row">
      <div><span style="font-weight:500;">${escapeHtml(r.name)}</span></div>
      <div style="font-family:var(--mono); font-size:12px; color:var(--muted);">
        ${r.candidate_count ?? 0} candidate${r.candidate_count === 1 ? "" : "s"} / ${escapeHtml(r.target_headcount)}
      </div>
      <div>${statusBadge(r.status)}</div>
      <div style="font-family:var(--mono); font-size:12px; color:var(--muted);">${escapeHtml(r.target_headcount)}</div>
      <div style="color:var(--muted); font-size:13px;">${escapeHtml(r.department)}</div>
      <div class="admin-row-actions">
        <button class="btn ghost small" onclick="startEditRole(${r.id})">Edit</button>
        <button class="btn ghost small" onclick="toggleRoleJd(${r.id})">JD</button>
      </div>
    </div>
    <div id="roleJd${r.id}" style="display:none; margin:4px 8px 10px;">
      <div class="form-label" style="margin:4px 0;">JOB DESCRIPTION</div>
      <div style="font-size:13px; color:var(--muted); white-space:pre-wrap;">${escapeHtml(r.job_description || "")}</div>
    </div>`;
}

function roleEditRow(r) {
  const d = roleEditDraft;
  const statusColor = d.status === "Open" ? "var(--green)" : d.status === "Closed" ? "var(--dim)" : "var(--amber)";
  const armed = armedDelete && armedDelete.type === "role" && armedDelete.id === r.id;
  return `
    <div class="admin-role-row" style="border:1px solid var(--cyan); border-radius:6px;">
      <div><input type="text" value="${escapeHtml(d.name)}" style="width:100%;" oninput="roleEditField('name', this.value)" onkeydown="if(event.key==='Enter')saveRoleEdit(${r.id})" /></div>
      <div style="font-family:var(--mono); font-size:12px; color:var(--muted);">${r.candidate_count ?? 0} candidate${r.candidate_count === 1 ? "" : "s"}</div>
      <div>
        <select class="status-select" style="color:${statusColor}; background:var(--panel-2);" onchange="roleEditField('status', this.value)">
          ${["Open", "Closed", "On Hold"].map(s => `<option value="${s}" ${s === d.status ? "selected" : ""}>${s}</option>`).join("")}
        </select>
      </div>
      <div><input type="number" min="1" value="${escapeHtml(d.target_headcount)}" style="width:70px;" oninput="roleEditField('target_headcount', this.value)" /></div>
      <div><input type="text" value="${escapeHtml(d.department)}" style="width:100%;" oninput="roleEditField('department', this.value)" /></div>
      <div class="admin-row-actions">
        <button class="btn small" onclick="saveRoleEdit(${r.id})">Save</button>
        <button class="btn danger small" onclick="deleteRole(${r.id})">${armed ? "Confirm delete" : "Delete"}</button>
        <button class="btn ghost small" onclick="cancelEditRole()">Cancel</button>
      </div>
    </div>
    <div id="roleJd${r.id}" style="margin:4px 8px 10px;">
      <div class="form-label" style="margin:6px 0 4px;">JOB DESCRIPTION</div>
      <textarea rows="3" placeholder="Job description..." style="width:100%;" oninput="roleEditField('job_description', this.value)">${escapeHtml(d.job_description)}</textarea>
    </div>`;
}

function newRoleRow(d, i) {
  return `
    <div class="admin-role-row" style="border:1px dashed var(--cyan-dim); border-radius:6px;">
      <div><input type="text" value="${escapeHtml(d.name)}" placeholder="Role name" style="width:100%;" oninput="adminEditNewRole(${i}, 'name', this.value)" /></div>
      <div style="font-family:var(--mono); font-size:11px; color:var(--cyan);">0 candidates</div>
      <div>
        <select class="status-select" style="color:var(--green); background:var(--panel-2);" onchange="adminEditNewRole(${i}, 'status', this.value)">
          ${["Open", "Closed", "On Hold"].map(s => `<option value="${s}" ${s === d.status ? "selected" : ""}>${s}</option>`).join("")}
        </select>
      </div>
      <div><input type="number" min="1" value="${escapeHtml(d.target_headcount)}" style="width:70px;" oninput="adminEditNewRole(${i}, 'target_headcount', this.value)" /></div>
      <div><input type="text" value="${escapeHtml(d.department)}" placeholder="Department" style="width:100%;" oninput="adminEditNewRole(${i}, 'department', this.value)" /></div>
      <div class="admin-row-actions">
        <button class="btn small" id="commitRoleBtn${i}" onclick="commitNewRole(${i})" ${d.name.trim() ? "" : "disabled"}>Add</button>
        <button class="btn ghost small" onclick="cancelNewRole(${i})">Cancel</button>
      </div>
    </div>`;
}

function vendorReadRow(v) {
  const count = (candidates || []).filter(c => (c.vendor || "").toLowerCase() === v.name.toLowerCase()).length;
  return `
    <div class="admin-role-row">
      <div><span style="font-weight:500;">${escapeHtml(v.name)}</span></div>
      <div style="font-family:var(--mono); font-size:12px; color:var(--muted);">${count} candidate${count === 1 ? "" : "s"}</div>
      <div></div>
      <div></div>
      <div></div>
      <div class="admin-row-actions">
        <button class="btn ghost small" onclick="startEditVendor(${v.id})">Edit</button>
      </div>
    </div>`;
}

function vendorEditRow(v) {
  const count = (candidates || []).filter(c => (c.vendor || "").toLowerCase() === (vendorEditDraft.name || "").trim().toLowerCase()).length;
  const armed = armedDelete && armedDelete.type === "vendor" && armedDelete.id === v.id;
  return `
    <div class="admin-role-row" style="border:1px solid var(--cyan); border-radius:6px;">
      <div><input type="text" value="${escapeHtml(vendorEditDraft.name)}" style="width:100%;" oninput="vendorEditField(this.value)" onkeydown="if(event.key==='Enter')saveVendorEdit(${v.id})" /></div>
      <div style="font-family:var(--mono); font-size:12px; color:var(--muted);">${count} candidate${count === 1 ? "" : "s"}</div>
      <div></div>
      <div></div>
      <div></div>
      <div class="admin-row-actions">
        <button class="btn small" onclick="saveVendorEdit(${v.id})">Save</button>
        <button class="btn danger small" onclick="deleteVendor(${v.id})">${armed ? "Confirm delete" : "Delete"}</button>
        <button class="btn ghost small" onclick="cancelEditVendor()">Cancel</button>
      </div>
    </div>`;
}

function newVendorRow(d, i) {
  return `
    <div class="admin-role-row" style="border:1px dashed var(--cyan-dim); border-radius:6px;">
      <div><input type="text" value="${escapeHtml(d.name)}" placeholder="Vendor name" style="width:100%;" oninput="adminEditNewVendor(${i}, this.value)" /></div>
      <div style="font-family:var(--mono); font-size:11px; color:var(--cyan);">new</div>
      <div></div>
      <div></div>
      <div></div>
      <div class="admin-row-actions">
        <button class="btn small" id="commitVendorBtn${i}" onclick="commitNewVendor(${i})" ${d.name.trim() ? "" : "disabled"}>Add</button>
        <button class="btn ghost small" onclick="cancelNewVendor(${i})">Cancel</button>
      </div>
    </div>`;
}

function statusSwatch(color, size) {
  const px = size || 22;
  return `<span style="display:inline-block; width:${Math.round(px * 1.6)}px; height:${px}px; border-radius:4px; background:${color}; border:1px solid var(--border); vertical-align:middle;"></span>`;
}

function statusSampleBadge(s) {
  return `<span style="color:${s.color}; background:${s.bg}; border:1px solid var(--border); border-radius:4px; padding:2px 8px; font-size:12px;">${escapeHtml(s.name || "Status")}</span>`;
}

function statusReadRow(s) {
  return `
    <div class="admin-role-row">
      <div><span style="font-weight:500;">${escapeHtml(s.name)}</span></div>
      <div>${statusSwatch(s.color)}</div>
      <div>${statusSwatch(s.bg)}</div>
      <div style="font-family:var(--mono); font-size:12px; color:var(--muted);">${s.candidate_count ?? 0} candidate${s.candidate_count === 1 ? "" : "s"}</div>
      <div>${statusSampleBadge(s)}</div>
      <div class="admin-row-actions">
        <button class="btn ghost small" onclick="startEditStatus(${s.id})">Edit</button>
      </div>
    </div>`;
}

function statusEditRow(s) {
  const d = statusEditDraft;
  const armed = armedDelete && armedDelete.type === "status" && armedDelete.id === s.id;
  return `
    <div class="admin-role-row" style="border:1px solid var(--cyan); border-radius:6px;">
      <div><input type="text" value="${escapeHtml(d.name)}" style="width:100%;" oninput="statusEditField('name', this.value)" onkeydown="if(event.key==='Enter')saveStatusEdit(${s.id})" /></div>
      <div><input type="color" value="${escapeHtml(d.color)}" style="width:38px; height:24px; padding:1px; background:var(--panel-2); border:1px solid var(--border); border-radius:4px;" oninput="statusEditField('color', this.value)" /></div>
      <div><input type="color" value="${escapeHtml(d.bg)}" style="width:38px; height:24px; padding:1px; background:var(--panel-2); border:1px solid var(--border); border-radius:4px;" oninput="statusEditField('bg', this.value)" /></div>
      <div style="font-family:var(--mono); font-size:12px; color:var(--muted);">${s.candidate_count ?? 0} candidate${s.candidate_count === 1 ? "" : "s"}</div>
      <div>${statusSampleBadge(d)}</div>
      <div class="admin-row-actions">
        <button class="btn small" onclick="saveStatusEdit(${s.id})">Save</button>
        <button class="btn danger small" onclick="deleteStatus(${s.id})">${armed ? "Confirm delete" : "Delete"}</button>
        <button class="btn ghost small" onclick="cancelEditStatus()">Cancel</button>
      </div>
    </div>`;
}

function newStatusRow(d, i) {
  return `
    <div class="admin-role-row" style="border:1px dashed var(--cyan-dim); border-radius:6px;">
      <div><input type="text" value="${escapeHtml(d.name)}" placeholder="Status name" style="width:100%;" oninput="adminEditNewStatus(${i}, 'name', this.value)" /></div>
      <div><input type="color" value="${escapeHtml(d.color)}" style="width:38px; height:24px; padding:1px; background:var(--panel-2); border:1px solid var(--border); border-radius:4px;" oninput="adminEditNewStatus(${i}, 'color', this.value)" /></div>
      <div><input type="color" value="${escapeHtml(d.bg)}" style="width:38px; height:24px; padding:1px; background:var(--panel-2); border:1px solid var(--border); border-radius:4px;" oninput="adminEditNewStatus(${i}, 'bg', this.value)" /></div>
      <div style="font-family:var(--mono); font-size:11px; color:var(--cyan);">new</div>
      <div>${statusSampleBadge(d)}</div>
      <div class="admin-row-actions">
        <button class="btn small" id="commitStatusBtn${i}" onclick="commitNewStatus(${i})" ${d.name.trim() ? "" : "disabled"}>Add</button>
        <button class="btn ghost small" onclick="cancelNewStatus(${i})">Cancel</button>
      </div>
    </div>`;
}

function userReadRow(u) {
  const self = currentUser && currentUser.id === u.id;
  return `
    <div class="admin-role-row">
      <div><span style="font-weight:500;">${escapeHtml(u.name || u.email)}</span>${self ? ' <span style="font-size:11px; color:var(--cyan); font-family:var(--mono);">(you)</span>' : ""}</div>
      <div style="font-family:var(--mono); font-size:12px; color:var(--muted);">${escapeHtml(u.email)}</div>
      <div>
        <select onchange="updateUserRole(${u.id}, this.value)" ${self ? "disabled" : ""} style="padding:4px 8px; font-size:12.5px;">
          ${["admin","manager","view"].map(r => `<option value="${r}" ${u.role === r ? "selected" : ""}>${r}</option>`).join("")}
        </select>
      </div>
      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        <span style="font-family:var(--mono); font-size:11px; color:${u.active ? "var(--green)" : "var(--red)"};">${u.active ? "ACTIVE" : "DISABLED"}</span>
        ${self ? "" : `<button class="btn ghost small" onclick="toggleUserActive(${u.id}, ${u.active ? 0 : 1})">${u.active ? "Disable" : "Enable"}</button>`}
      </div>
      <div>
        <input type="password" id="resetPw${u.id}" placeholder="New password" style="width:100%;" ${self ? "disabled" : ""} />
      </div>
      <div class="admin-row-actions">
        <button class="btn small" onclick="resetUserPassword(${u.id})" ${self ? "disabled" : ""}>Reset pw</button>
        ${self ? "" : `<button class="btn danger small" onclick="deleteUser(${u.id})">${(armedDelete && armedDelete.type === "user" && armedDelete.id === u.id) ? "Confirm delete" : "Delete"}</button>`}
      </div>
    </div>`;
}

function newUserRow(d, i) {
  return `
    <div class="admin-role-row" style="border:1px dashed var(--cyan-dim); border-radius:6px;">
      <div><input type="text" placeholder="Name" value="${escapeHtml(d.name)}" style="width:100%;" oninput="userRowField(${i}, 'name', this.value)" /></div>
      <div><input type="email" placeholder="Email" value="${escapeHtml(d.email)}" style="width:100%;" oninput="userRowField(${i}, 'email', this.value)" /></div>
      <div>
        <select style="padding:4px 8px; font-size:12.5px;" onchange="userRowField(${i}, 'role', this.value)">
          ${["admin","manager","view"].map(r => `<option value="${r}" ${d.role === r ? "selected" : ""}>${r}</option>`).join("")}
        </select>
      </div>
      <div><input type="password" placeholder="Password (policy enforced)" value="${escapeHtml(d.password)}" style="width:100%;" oninput="userRowField(${i}, 'password', this.value)" /></div>
      <div style="grid-column: span 2;" class="admin-row-actions">
        <button class="btn small" onclick="createUser(${i})">Create</button>
        <button class="btn ghost small" onclick="removeNewUser(${i})">Cancel</button>
      </div>
    </div>`;
}

window.userRowField = (i, field, value) => { adminDrafts.newUsers[i][field] = value; };
window.removeNewUser = (i) => { adminDrafts.newUsers.splice(i, 1); renderAdminPanel(); };

window.updateUserRole = async (id, role) => {
  if (!isAdmin()) return;
  if (id === currentUser.id) { setAdminMessage("You cannot change your own role.", "error"); renderAdminPanel(); return; }
  try {
    const updated = await api(`/api/auth/users/${id}`, { method: "PATCH", body: JSON.stringify({ role }) });
    users = users.map(u => u.id === id ? updated : u);
    renderAdminPanel();
  } catch (e) { setAdminMessage("Failed to update role: " + e.message, "error"); renderAdminPanel(); }
};

window.toggleUserActive = async (id, active) => {
  if (!isAdmin()) return;
  if (id === currentUser.id) { setAdminMessage("You cannot disable your own account.", "error"); renderAdminPanel(); return; }
  try {
    const updated = await api(`/api/auth/users/${id}`, { method: "PATCH", body: JSON.stringify({ active: !!active }) });
    users = users.map(u => u.id === id ? updated : u);
    renderAdminPanel();
  } catch (e) { setAdminMessage("Failed to update: " + e.message, "error"); renderAdminPanel(); }
};

window.resetUserPassword = async (id) => {
  if (!isAdmin()) return;
  const pwEl = document.getElementById("resetPw" + id);
  const pw = pwEl ? pwEl.value : "";
  if (!validatePolicy(pw)) { setAdminMessage(POLICY_HINT, "error"); return; }
  try {
    await api(`/api/auth/users/${id}/reset-password`, { method: "POST", body: JSON.stringify({ new_password: pw }) });
    const user = users.find(u => u.id === id);
    if (pwEl) pwEl.value = "";
    setAdminMessage("Password reset. The user is signed out on all devices.", "saved");
    if (user) showCredentialsOnce(user, pw);
  } catch (e) { setAdminMessage("Reset failed: " + e.message, "error"); }
};

window.deleteUser = async (id) => {
  if (!isAdmin()) return;
  const user = users.find(u => u.id === id);
  if (!user) return;
  if (armedDelete && armedDelete.type === "user" && armedDelete.id === id) {
    try {
      await api(`/api/auth/users/${id}`, { method: "DELETE" });
      armedDelete = null;
      await refreshUsers();
      setAdminMessage(`User "${user.name || user.email}" deleted.`, "saved");
    } catch (e) { setAdminMessage("Delete failed: " + e.message, "error"); }
  } else {
    setAdminMessage(`Delete ${user.email}? Click Delete again to confirm.`, "info");
    armDelete("user", id, renderAdminPanel);
  }
};

window.copyCredentialPassword = async () => {
  if (!__credPassword) return;
  try {
    await navigator.clipboard.writeText(__credPassword);
    setAdminMessage("Password copied to clipboard.", "saved");
  } catch (e) {
    const ta = document.createElement("textarea");
    ta.value = __credPassword;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); setAdminMessage("Password copied to clipboard.", "saved"); }
    catch (ee) { setAdminMessage("Copy failed \u2014 select the password manually.", "error"); }
    ta.remove();
  }
};

function showCredentialsOnce(user, password) {
  __credPassword = password;
  const box = document.getElementById("adminCredBox");
  if (!box) return;
  const body = `Hi,\n\nYour Hiring Tracker login:\n\nEmail: ${user.email}\nPassword: ${password}\n\nSign in at the Hiring Tracker URL.`;
  box.innerHTML = `
    <div style="border:1px solid var(--cyan-dim); border-radius:6px; padding:10px 12px; margin-top:8px; background:rgba(45,212,191,.05);">
      <div style="font-weight:500; color:var(--cyan); font-family:var(--mono); font-size:12px; margin-bottom:6px;">CREDENTIALS \u2014 shown once. Share them, then they're gone.</div>
      <div style="font-size:13px; line-height:1.8;">
        <div><span style="color:var(--muted); width:70px; display:inline-block;">Email:</span> <b>${escapeHtml(user.email)}</b></div>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <span style="color:var(--muted); width:70px;">Password:</span>
          <span id="credPw" style="font-family:var(--mono);">${escapeHtml(password)}</span>
          <button class="btn small" onclick="copyCredentialPassword()">Copy password</button>
          <a href="mailto:${encodeURIComponent(user.email)}?subject=${encodeURIComponent("Hiring Tracker login")}&body=${encodeURIComponent(body)}" style="color:var(--cyan); font-size:12.5px;">Email to user</a>
        </div>
      </div>
    </div>`;
  box.scrollIntoView({ block: "nearest" });
}

window.createUser = async (i) => {
  if (!isAdmin()) return;
  const d = adminDrafts.newUsers[i];
  if (!d) return;
  if (!d.email || !EMAIL_RE.test(d.email)) { setAdminMessage("Enter a valid email address.", "error"); return; }
  if (!validatePolicy(d.password)) { setAdminMessage(POLICY_HINT, "error"); return; }
  if (!d.name) { setAdminMessage("Enter a name.", "error"); return; }
  try {
    const created = await api("/api/auth/users", { method: "POST", body: JSON.stringify({ name: d.name, email: d.email, password: d.password, role: d.role }) });
    adminDrafts.newUsers.splice(i, 1);
    await refreshUsers();
    setAdminMessage(`User "${created.name}" created. Copy the password below to share log-in details.`, "saved");
    showCredentialsOnce(created, d.password);
  } catch (e) { setAdminMessage("Create failed: " + e.message, "error"); }
};

async function refreshUsers() {
  try {
    users = await api("/api/auth/users");
  } catch (e) {
    users = [];
    setAdminMessage("Failed to load users: " + e.message, "error");
  }
  renderAdminPanel();
}

function renderAdminPanel() {
  const list = document.getElementById("adminRolesList");
  const vlist = document.getElementById("adminVendorsList");
  const slist = document.getElementById("adminStatusesList");
  const nroles = document.getElementById("adminNewRoles");
  const nvendors = document.getElementById("adminNewVendors");
  const nstatuses = document.getElementById("adminNewStatuses");
  if (!list || !vlist || !slist) return;
  if (!adminDrafts) initAdminDrafts();

  if (!roles.length) {
    list.innerHTML = `<div style="color:var(--muted); font-size:13px; padding:8px 0;">No roles yet. Add one below.</div>`;
  } else {
    list.innerHTML = roles.map(r => (editRoleId === r.id ? roleEditRow(r) : roleReadRow(r))).join("");
  }

  nroles.innerHTML = adminDrafts.newRoles.map((d, i) => newRoleRow(d, i)).join("");
  nroles.style.display = adminDrafts.newRoles.length ? "" : "none";

  if (!vendorsManaged.length) {
    vlist.innerHTML = `<div style="color:var(--muted); font-size:13px; padding:8px 0;">No vendors yet. Add one below.</div>`;
  } else {
    vlist.innerHTML = vendorsManaged.map(v => (editVendorId === v.id ? vendorEditRow(v) : vendorReadRow(v))).join("");
  }

  nvendors.innerHTML = adminDrafts.newVendors.map((d, i) => newVendorRow(d, i)).join("");
  nvendors.style.display = adminDrafts.newVendors.length ? "" : "none";

  if (!STATUSES_MANAGED.length) {
    slist.innerHTML = `<div style="color:var(--muted); font-size:13px; padding:8px 0;">No statuses yet. Add one below.</div>`;
  } else {
    slist.innerHTML = STATUSES_MANAGED.map(s => (editStatusId === s.id ? statusEditRow(s) : statusReadRow(s))).join("");
  }

  nstatuses.innerHTML = adminDrafts.newStatuses.map((d, i) => newStatusRow(d, i)).join("");
  nstatuses.style.display = adminDrafts.newStatuses.length ? "" : "none";

  const be = document.getElementById("brandEyebrowInput");
  const bt = document.getElementById("brandTitleInput");
  const bs = document.getElementById("brandSubtitleInput");
  if (be) be.value = settings.brand_eyebrow || "";
  if (bt) bt.value = settings.brand_title || "";
  if (bs) bs.value = settings.brand_subtitle || "";

  const ulist = document.getElementById("adminUsersList");
  const nusers = document.getElementById("adminNewUsers");
  if (ulist) {
    if (!isAdmin()) {
      ulist.innerHTML = "";
    } else if (!users.length) {
      ulist.innerHTML = `<div style="color:var(--muted); font-size:13px; padding:8px 0;">No users yet. Add one below.</div>`;
    } else {
      ulist.innerHTML = users.map(u => userReadRow(u)).join("");
    }
  }
  if (nusers) {
    nusers.innerHTML = adminDrafts.newUsers.map((d, i) => newUserRow(d, i)).join("");
    nusers.style.display = adminDrafts.newUsers.length ? "" : "none";
  }
}

window.saveBranding = async () => {
  const body = {
    brand_eyebrow: document.getElementById("brandEyebrowInput").value,
    brand_title: document.getElementById("brandTitleInput").value,
    brand_subtitle: document.getElementById("brandSubtitleInput").value
  };
  try {
    const updated = await api("/api/settings", { method: "PUT", body: JSON.stringify(body) });
    settings = {
      brand_eyebrow: updated.brand_eyebrow || "",
      brand_title: updated.brand_title || "",
      brand_subtitle: updated.brand_subtitle || ""
    };
    applyBranding();
    setAdminMessage("Branding saved.", "saved");
  } catch (e) { setAdminMessage("Save failed: " + e.message, "error"); }
};

window.startEditRole = (id) => {
  const r = roles.find(x => x.id === id);
  if (!r) return;
  editRoleId = id;
  editVendorId = null;
  editStatusId = null;
  roleEditDraft = {
    name: r.name || "",
    department: r.department || "Engineering",
    target_headcount: r.target_headcount ?? 1,
    status: r.status || "Open",
    job_description: r.job_description || ""
  };
  renderAdminPanel();
};

window.startEditVendor = (id) => {
  const v = vendorsManaged.find(x => x.id === id);
  if (!v) return;
  editVendorId = id;
  editRoleId = null;
  editStatusId = null;
  vendorEditDraft = { name: v.name || "" };
  renderAdminPanel();
};

window.cancelEditRole = () => {
  editRoleId = null;
  roleEditDraft = null;
  armedDelete = null;
  renderAdminPanel();
};

window.cancelEditVendor = () => {
  editVendorId = null;
  vendorEditDraft = null;
  armedDelete = null;
  renderAdminPanel();
};

window.roleEditField = (field, value) => {
  if (!roleEditDraft) return;
  roleEditDraft[field] = field === "target_headcount" ? (parseInt(value, 10) || 1) : value;
};

window.vendorEditField = (value) => {
  if (!vendorEditDraft) return;
  vendorEditDraft.name = value;
};

window.adminEditNewRole = (idx, field, value) => {
  if (!adminDrafts) return;
  adminDrafts.newRoles[idx][field] = field === "target_headcount" ? (parseInt(value, 10) || 1) : value;
  const btn = document.getElementById("commitRoleBtn" + idx);
  if (btn) btn.disabled = !(adminDrafts.newRoles[idx].name || "").trim();
};

window.adminEditNewVendor = (idx, value) => {
  if (!adminDrafts) return;
  adminDrafts.newVendors[idx].name = value;
  const btn = document.getElementById("commitVendorBtn" + idx);
  if (btn) btn.disabled = !(adminDrafts.newVendors[idx].name || "").trim();
};

window.cancelNewRole = (idx) => {
  adminDrafts.newRoles.splice(idx, 1);
  renderAdminPanel();
};

window.cancelNewVendor = (idx) => {
  adminDrafts.newVendors.splice(idx, 1);
  renderAdminPanel();
};

window.commitNewRole = async (idx) => {
  if (!adminDrafts) return;
  const d = adminDrafts.newRoles[idx];
  const name = (d.name || "").trim();
  if (!name) { setAdminMessage("Enter a role name.", "error"); return; }
  const allNames = [
    ...roles.map(r => r.name),
    ...adminDrafts.newRoles.filter((_, i) => i !== idx).map(n => (n.name || "").trim())
  ];
  if (allNames.some(n => n && n.toLowerCase() === name.toLowerCase())) {
    setAdminMessage(`A role named "${name}" already exists.`, "error");
    return;
  }
  try {
    const created = await api("/api/roles", {
      method: "POST",
      body: JSON.stringify({
        name,
        department: (d.department || "Engineering").trim(),
        target_headcount: d.target_headcount || 1,
        status: d.status || "Open"
      })
    });
    adminDrafts.newRoles.splice(idx, 1);
    roles.push({ ...created, candidate_count: 0 });
    editRoleId = null;
    roleEditDraft = null;
    setAdminMessage(`Role "${name}" added.`, "saved");
    render();
  } catch (e) { setAdminMessage("Add failed: " + e.message, "error"); }
};

window.commitNewVendor = async (idx) => {
  if (!adminDrafts) return;
  const d = adminDrafts.newVendors[idx];
  const name = (d.name || "").trim();
  if (!name) { setAdminMessage("Enter a vendor name.", "error"); return; }
  const allNames = [
    ...vendorsManaged.map(v => v.name),
    ...adminDrafts.newVendors.filter((_, i) => i !== idx).map(n => (n.name || "").trim())
  ];
  if (allNames.some(n => n && n.toLowerCase() === name.toLowerCase())) {
    setAdminMessage(`Vendor "${name}" already exists.`, "error");
    return;
  }
  try {
    const created = await api("/api/vendors", { method: "POST", body: JSON.stringify({ name }) });
    adminDrafts.newVendors.splice(idx, 1);
    vendorsManaged.push({ id: created.id, name: created.name });
    editVendorId = null;
    vendorEditDraft = null;
    setAdminMessage(`Vendor "${name}" added.`, "saved");
    render();
  } catch (e) { setAdminMessage("Add failed: " + e.message, "error"); }
};

window.saveRoleEdit = async (id) => {
  if (!roleEditDraft) return;
  const name = (roleEditDraft.name || "").trim();
  if (!name) { setAdminMessage("Role name cannot be empty.", "error"); return; }
  const dup = roles.find(r => r.id !== id && r.name.toLowerCase() === name.toLowerCase());
  if (dup) { setAdminMessage(`A role named "${name}" already exists.`, "error"); return; }
  try {
    await api(`/api/roles/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        name,
        department: (roleEditDraft.department || "Engineering").trim(),
        target_headcount: Number(roleEditDraft.target_headcount) || 1,
        status: roleEditDraft.status,
        job_description: (roleEditDraft.job_description || "").trim()
      })
    });
    editRoleId = null;
    roleEditDraft = null;
    armedDelete = null;
    await loadAll();
    setAdminMessage(`Role "${name}" saved.`, "saved");
  } catch (e) { setAdminMessage("Save failed: " + e.message, "error"); }
};

window.saveVendorEdit = async (id) => {
  if (!vendorEditDraft) return;
  const name = (vendorEditDraft.name || "").trim();
  if (!name) { setAdminMessage("Vendor name cannot be empty.", "error"); return; }
  const dup = vendorsManaged.find(v => v.id !== id && v.name.toLowerCase() === name.toLowerCase());
  if (dup) { setAdminMessage(`A vendor named "${name}" already exists.`, "error"); return; }
  try {
    await api(`/api/vendors/${id}`, { method: "PUT", body: JSON.stringify({ name }) });
    editVendorId = null;
    vendorEditDraft = null;
    armedDelete = null;
    await loadAll();
    setAdminMessage(`Vendor "${name}" saved.`, "saved");
  } catch (e) { setAdminMessage("Save failed: " + e.message, "error"); }
};

function armDelete(type, id, rerender) {
  armedDelete = { type, id };
  clearTimeout(window.__armedTimer);
  window.__armedTimer = setTimeout(() => {
    armedDelete = null;
    if (rerender) rerender();
  }, 5000);
  if (rerender) rerender();
}

window.deleteRole = async (id) => {
  const role = roles.find(r => r.id === id);
  if (!role) return;
  if ((role.candidate_count ?? 0) > 0) {
    setAdminMessage(`Cannot delete "${role.name}" — ${role.candidate_count} candidate(s) are assigned.`, "error");
    return;
  }
  if (armedDelete && armedDelete.type === "role" && armedDelete.id === id) {
    try {
      await api(`/api/roles/${id}`, { method: "DELETE" });
      editRoleId = null;
      roleEditDraft = null;
      armedDelete = null;
      await loadAll();
      setAdminMessage(`Role "${role.name}" deleted.`, "saved");
    } catch (e) { setAdminMessage("Delete failed: " + e.message, "error"); }
  } else {
    setAdminMessage(`Delete role "${role.name}"? Click Delete again to confirm.`, "info");
    armDelete("role", id, renderAdminPanel);
  }
};

window.deleteVendor = async (id) => {
  const vendor = vendorsManaged.find(v => v.id === id);
  if (!vendor) return;
  const count = (candidates || []).filter(c => (c.vendor || "").toLowerCase() === vendor.name.toLowerCase()).length;
  if (armedDelete && armedDelete.type === "vendor" && armedDelete.id === id) {
    try {
      await api(`/api/vendors/${id}`, { method: "DELETE" });
      editVendorId = null;
      vendorEditDraft = null;
      armedDelete = null;
      await loadAll();
      setAdminMessage(`Vendor "${vendor.name}" deleted.`, "saved");
    } catch (e) { setAdminMessage("Delete failed: " + e.message, "error"); }
  } else {
    if (count > 0) {
      setAdminMessage(`${count} candidate(s) use "${vendor.name}" — delete anyway? Click Delete again to confirm.`, "info");
    } else {
      setAdminMessage(`Delete vendor "${vendor.name}"? Click Delete again to confirm.`, "info");
    }
    armDelete("vendor", id, renderAdminPanel);
  }
};

window.toggleRoleJd = (id) => {
  const el = document.getElementById("roleJd" + id);
  if (el) el.style.display = el.style.display === "none" ? "block" : "none";
};

/* ---------------- Statuses ---------------- */

window.startEditStatus = (id) => {
  const s = STATUSES_MANAGED.find(x => x.id === id);
  if (!s) return;
  editStatusId = id;
  editRoleId = null;
  editVendorId = null;
  statusEditDraft = { name: s.name || "", color: s.color || "#8B98A5", bg: s.bg || "#1C2A36" };
  renderAdminPanel();
};

window.cancelEditStatus = () => {
  editStatusId = null;
  statusEditDraft = null;
  armedDelete = null;
  renderAdminPanel();
};

window.statusEditField = (field, value) => {
  if (!statusEditDraft) return;
  statusEditDraft[field] = value;
};

window.adminEditNewStatus = (idx, field, value) => {
  if (!adminDrafts) return;
  adminDrafts.newStatuses[idx][field] = value;
  const btn = document.getElementById("commitStatusBtn" + idx);
  if (btn) btn.disabled = !(adminDrafts.newStatuses[idx].name || "").trim();
};

window.cancelNewStatus = (idx) => {
  adminDrafts.newStatuses.splice(idx, 1);
  renderAdminPanel();
};

window.commitNewStatus = async (idx) => {
  if (!adminDrafts) return;
  const d = adminDrafts.newStatuses[idx];
  const name = (d.name || "").trim();
  if (!name) { setAdminMessage("Enter a status name.", "error"); return; }
  const allNames = [
    ...STATUSES_MANAGED.map(s => s.name),
    ...adminDrafts.newStatuses.filter((_, i) => i !== idx).map(n => (n.name || "").trim())
  ];
  if (allNames.some(n => n && n.toLowerCase() === name.toLowerCase())) {
    setAdminMessage(`A status named "${name}" already exists.`, "error");
    return;
  }
  try {
    const created = await api("/api/statuses", {
      method: "POST",
      body: JSON.stringify({ name, color: d.color || "#8B98A5", bg: d.bg || "#1C2A36" })
    });
    adminDrafts.newStatuses.splice(idx, 1);
    STATUSES_MANAGED.push({ id: created.id, name: created.name, color: created.color, bg: created.bg, candidate_count: 0 });
    editStatusId = null;
    statusEditDraft = null;
    setAdminMessage(`Status "${name}" added.`, "saved");
    render();
  } catch (e) { setAdminMessage("Add failed: " + e.message, "error"); }
};

window.saveStatusEdit = async (id) => {
  if (!statusEditDraft) return;
  const name = (statusEditDraft.name || "").trim();
  if (!name) { setAdminMessage("Status name cannot be empty.", "error"); return; }
  const dup = STATUSES_MANAGED.find(s => s.id !== id && s.name.toLowerCase() === name.toLowerCase());
  if (dup) { setAdminMessage(`A status named "${name}" already exists.`, "error"); return; }
  try {
    await api(`/api/statuses/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        name,
        color: statusEditDraft.color,
        bg: statusEditDraft.bg
      })
    });
    editStatusId = null;
    statusEditDraft = null;
    armedDelete = null;
    await loadAll();
    setAdminMessage(`Status "${name}" saved.`, "saved");
  } catch (e) { setAdminMessage("Save failed: " + e.message, "error"); }
};

window.deleteStatus = async (id) => {
  const status = STATUSES_MANAGED.find(s => s.id === id);
  if (!status) return;
  if (armedDelete && armedDelete.type === "status" && armedDelete.id === id) {
    try {
      await api(`/api/statuses/${id}`, { method: "DELETE" });
      editStatusId = null;
      statusEditDraft = null;
      armedDelete = null;
      await loadAll();
      setAdminMessage(`Status "${status.name}" deleted.`, "saved");
    } catch (e) { setAdminMessage("Delete failed: " + e.message, "error"); }
  } else {
    if ((status.candidate_count ?? 0) > 0) {
      setAdminMessage(`${status.candidate_count} candidate(s) are in "${status.name}" — delete anyway? Click Delete again to confirm.`, "info");
    } else {
      setAdminMessage(`Delete status "${status.name}"? Click Delete again to confirm.`, "info");
    }
    armDelete("status", id, renderAdminPanel);
  }
};

/* ---------------- Import / Export ---------------- */

async function exportData() {
  try {
    const res = await fetch("/api/candidates/export?fmt=json");
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "candidates.json";
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) { setAdminMessage("Export failed: " + e.message, "error"); }
}

async function importData(file) {
  try {
    const text = await file.text();
    let rows;
    if (file.name.endsWith(".csv")) {
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
      rows = lines.slice(1).map(l => {
        const vals = l.split(",").map(v => v.trim().replace(/^"|"$/g, ""));
        return Object.fromEntries(headers.map((h, i) => [h, vals[i]]));
      });
    } else {
      rows = JSON.parse(text);
      if (!Array.isArray(rows)) throw new Error("Expected a JSON array");
    }
    let added = 0;
    for (const r of rows) {
      const name = (r.name || "").trim();
      if (!name) continue;
      const roleName = (r.role_name || r.role || "").trim();
      let roleId = null;
      if (roleName) {
        let role = roles.find(x => x.name === roleName);
        if (!role) {
          const created = await api("/api/roles", { method: "POST", body: JSON.stringify({ name: roleName, department: "Engineering", target_headcount: 1 }) });
          roles = await api("/api/roles");
          role = created;
        }
        roleId = role.id;
      }
      await api("/api/candidates", {
        method: "POST",
        body: JSON.stringify({
          name,
          role_id: roleId,
          vendor: r.vendor || null,
          status: r.status || "Sourcing",
          notes: r.notes || null
        })
      });
      added++;
    }
    setAdminMessage(`Imported ${added} candidate(s).`, "saved");
    await loadAll();
  } catch (e) {
    setAdminMessage("Import failed: " + e.message, "error");
  }
}

/* ---------------- Render + Events ---------------- */

function getVendors() {
  const set = new Set((candidates || []).map(c => c.vendor).filter(Boolean));
  (vendorsManaged || []).forEach(v => { if (v.name) set.add(v.name); });
  return [...set].sort();
}

function render() {
  renderStats();
  populateSelect(document.getElementById("roleFilter"), roles.map(r => ({ value: String(r.id), label: r.name })), true, "All roles", filters.role);
  populateSelect(document.getElementById("vendorFilter"), getVendors().map(v => ({ value: v, label: v })), true, "", filters.vendor);
  const statusOptions = STATUSES.map(s => ({ value: s.key, label: s.key }));
  populateSelect(document.getElementById("statusFilter"), statusOptions, true, "All statuses", filters.status);
  populateSelect(document.getElementById("newStatus"), statusOptions, false);
  populateSelect(document.getElementById("newRole"), roles.map(r => ({ value: String(r.id), label: r.name })));
  const dl = document.getElementById("vendorOptions");
  if (dl) dl.innerHTML = getVendors().map(v => `<option value="${escapeHtml(v)}"></option>`).join("");
  renderAdminPanel();
  syncControls();
  renderTable();
  renderFooter();
}

document.getElementById("search").addEventListener("input", (e) => {
  filters.search = e.target.value;
  currentPage = 1;
  clearSelection();
  clearTimeout(window._searchTimer);
  window._searchTimer = setTimeout(refreshCandidates, 250);
});
document.getElementById("roleFilter").addEventListener("change", (e) => {
  filters.role = e.target.value;
  currentPage = 1;
  clearSelection();
  refreshCandidates();
});
document.getElementById("statusFilter").addEventListener("change", (e) => {
  filters.status = e.target.value;
  currentPage = 1;
  clearSelection();
  refreshCandidates();
});
document.getElementById("vendorFilter").addEventListener("change", (e) => {
  filters.vendor = e.target.value;
  currentPage = 1;
  clearSelection();
  refreshCandidates();
});
document.getElementById("clearFilters").addEventListener("click", () => {
  filters = { search: "", role: "all", status: "all", vendor: "all" };
  currentPage = 1;
  clearSelection();
  syncControls();
  refreshCandidates();
});

document.getElementById("resumeFileInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  const candidateId = pendingUploadCandidateId;
  e.target.value = "";
  if (!file || !candidateId) return;
  await uploadResume(candidateId, file);
  pendingUploadCandidateId = null;
});

document.getElementById("addBtn").addEventListener("click", async () => {
  if (!canEdit()) return;
  const name = document.getElementById("newName").value.trim();
  const role = document.getElementById("newRole").value;
  const vendor = document.getElementById("newVendor").value.trim();
  const status = document.getElementById("newStatus").value;
  const notes = document.getElementById("newNotes").value.trim();
  if (!name) { setDashboardMessage("Enter a candidate name.", "error"); return; }
  if (!role) { setDashboardMessage("Select a role first (add one in Admin / Roles).", "error"); return; }
  try {
    await api("/api/candidates", {
      method: "POST",
      body: JSON.stringify({
        name,
        role_id: parseInt(role, 10),
        vendor: vendor || null,
        status,
        notes: notes || null
      })
    });
    document.getElementById("newName").value = "";
    document.getElementById("newVendor").value = "";
    document.getElementById("newNotes").value = "";
    await refreshCandidates();
    renderStats();
  } catch (e) { setDashboardMessage("Error adding candidate: " + e.message, "error"); }
});

document.getElementById("addRoleBtn").addEventListener("click", () => {
  if (!adminDrafts) initAdminDrafts();
  adminDrafts.newRoles.push({ name: "", department: "Engineering", target_headcount: 1, status: "Open" });
  renderAdminPanel();
});

document.getElementById("addVendorBtn").addEventListener("click", () => {
  if (!adminDrafts) initAdminDrafts();
  adminDrafts.newVendors.push({ name: "" });
  renderAdminPanel();
});

document.getElementById("addStatusBtn").addEventListener("click", () => {
  if (!adminDrafts) initAdminDrafts();
  adminDrafts.newStatuses.push({ name: "", color: "#8B98A5", bg: "#1C2A36" });
  renderAdminPanel();
});

document.getElementById("addUserBtn").addEventListener("click", () => {
  if (!adminDrafts) initAdminDrafts();
  adminDrafts.newUsers.push({ name: "", email: "", password: "", role: "view" });
  renderAdminPanel();
});

document.getElementById("saveBrandingBtn").addEventListener("click", saveBranding);

document.getElementById("exportDataBtn").addEventListener("click", exportData);
document.getElementById("importDataBtn").addEventListener("click", () => document.getElementById("importFileInput").click());
document.getElementById("importFileInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (file) importData(file);
});

document.getElementById("adminBtn").addEventListener("click", () => {
  switchView("admin");
  if (isAdmin()) refreshUsers();
});

document.getElementById("backToDashboardBtn").addEventListener("click", () => switchView("dashboard"));

document.getElementById("profileBtn").addEventListener("click", openProfile);
document.getElementById("userChip").addEventListener("click", openProfile);
document.getElementById("backFromProfileBtn").addEventListener("click", () => switchView("dashboard"));
document.getElementById("logoutBtn").addEventListener("click", logout);
document.getElementById("authSubmitBtn").addEventListener("click", handleAuthSubmit);
document.getElementById("authToggleLink").addEventListener("click", (e) => {
  e.preventDefault();
  setAuthMode(authMode === "signup" ? "login" : "signup");
});
document.getElementById("saveProfileBtn").addEventListener("click", saveProfile);
document.getElementById("changePwBtn").addEventListener("click", changePassword);
document.getElementById("saveSqBtn").addEventListener("click", saveSecurityQuestion);

document.getElementById("authForgotLink").addEventListener("click", (e) => {
  e.preventDefault();
  setAuthMode("login");
  showForgotView();
});
document.getElementById("fpBackBtn").addEventListener("click", (e) => {
  e.preventDefault();
  showAuthBox();
});
document.getElementById("fpNextBtn").addEventListener("click", handleForgotSubmit);

document.getElementById("authPassword").addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleAuthSubmit();
});
document.getElementById("authEmail").addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleAuthSubmit();
});

document.getElementById("drawerOverlay").addEventListener("click", (e) => {
  if (e.target.id === "drawerOverlay") closeDrawer();
});

setAuthMode("login");
boot();