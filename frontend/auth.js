/**
 * BC CourseFinder™ - Auth Page Logic
 * Handles login, registration, tab switching, and token storage.
 */

const API = window.location.origin;

// If already logged in, go straight to chat
if (localStorage.getItem("bc_token")) {
  verifyExistingToken();
}

async function verifyExistingToken() {
  try {
    const res = await fetch(`${API}/api/me`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("bc_token")}` },
    });
    if (res.ok) window.location.href = "chat.html";
  } catch {
    // Token invalid or offline — stay on auth page
  }
}

// ================================================================
// TAB SWITCHING
// ================================================================
function switchTab(tab) {
  const isLogin = tab === "login";

  document.getElementById("loginForm").classList.toggle("hidden", !isLogin);
  document.getElementById("registerForm").classList.toggle("hidden", isLogin);
  document.getElementById("tabLogin").classList.toggle("active", isLogin);
  document.getElementById("tabRegister").classList.toggle("active", !isLogin);

  clearAlert();
  document.title = isLogin
    ? "BC CourseFinder™ - Sign In"
    : "BC CourseFinder™ - Create Account";
}

// Check URL param to open correct tab
const urlTab = new URLSearchParams(window.location.search).get("tab");
if (urlTab === "register") switchTab("register");

// ================================================================
// LOGIN
// ================================================================
async function handleLogin(e) {
  e.preventDefault();
  const email    = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;

  setLoading("loginBtn", true);
  clearAlert();

  try {
    const res  = await fetch(`${API}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      showAlert(data.error || "Login failed. Please try again.", "error");
      return;
    }

    localStorage.setItem("bc_token", data.token);
    localStorage.setItem("bc_user",  JSON.stringify(data.user));
    showAlert(`Welcome back, ${data.user.name}! Redirecting…`, "success");
    setTimeout(() => { window.location.href = "chat.html"; }, 800);
  } catch {
    showAlert("Could not connect to the server. Please try again.", "error");
  } finally {
    setLoading("loginBtn", false);
  }
}

// ================================================================
// REGISTER
// ================================================================
async function handleRegister(e) {
  e.preventDefault();
  const name     = document.getElementById("regName").value.trim();
  const email    = document.getElementById("regEmail").value.trim();
  const password = document.getElementById("regPassword").value;
  const confirm  = document.getElementById("regConfirm").value;

  if (password !== confirm) {
    showAlert("Passwords do not match.", "error");
    return;
  }

  setLoading("registerBtn", true);
  clearAlert();

  try {
    const res  = await fetch(`${API}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      showAlert(data.error || "Registration failed. Please try again.", "error");
      return;
    }

    localStorage.setItem("bc_token", data.token);
    localStorage.setItem("bc_user",  JSON.stringify(data.user));
    showAlert(`Account created! Welcome, ${data.user.name}! Redirecting…`, "success");
    setTimeout(() => { window.location.href = "chat.html"; }, 800);
  } catch {
    showAlert("Could not connect to the server. Please try again.", "error");
  } finally {
    setLoading("registerBtn", false);
  }
}

// ================================================================
// PASSWORD STRENGTH INDICATOR
// ================================================================
document.getElementById("regPassword").addEventListener("input", function () {
  const val = this.value;
  const bar = document.getElementById("pwStrength");
  if (!val) { bar.innerHTML = ""; return; }

  let score = 0;
  if (val.length >= 6)  score++;
  if (val.length >= 10) score++;
  if (/[A-Z]/.test(val)) score++;
  if (/[0-9]/.test(val)) score++;
  if (/[^A-Za-z0-9]/.test(val)) score++;

  const labels = ["", "Weak", "Fair", "Good", "Strong", "Very strong"];
  const colors = ["", "#e74c3c", "#e67e22", "#f1c40f", "#2ecc71", "#27ae60"];
  bar.innerHTML = `
    <div class="strength-bar">
      <div class="strength-fill" style="width:${score * 20}%; background:${colors[score]}"></div>
    </div>
    <span style="color:${colors[score]}">${labels[score]}</span>
  `;
});

// ================================================================
// PASSWORD VISIBILITY TOGGLE
// ================================================================
function togglePassword(inputId, btn) {
  const input = document.getElementById(inputId);
  const show  = input.type === "password";
  input.type  = show ? "text" : "password";
  btn.style.color = show ? "var(--bc-primary)" : "var(--bc-text-muted)";
}

// ================================================================
// UI HELPERS
// ================================================================
function showAlert(message, type) {
  const el = document.getElementById("authAlert");
  el.textContent = message;
  el.className   = `auth-alert ${type}`;
}

function clearAlert() {
  const el = document.getElementById("authAlert");
  el.className = "auth-alert hidden";
  el.textContent = "";
}

function setLoading(btnId, loading) {
  const btn     = document.getElementById(btnId);
  const label   = btn.querySelector(".btn-label");
  const spinner = btn.querySelector(".btn-spinner");
  btn.disabled  = loading;
  label.classList.toggle("hidden", loading);
  spinner.classList.toggle("hidden", !loading);
}
