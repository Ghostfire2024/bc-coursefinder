/**
 * ================================================================
 * BC CourseFinder™ - Frontend Chat Application
 * ================================================================
 * Handles the chat UI, message rendering, conversation history,
 * and communication with the backend API.
 * ================================================================
 */

// ================================================================
// CONFIGURATION
// ================================================================
const API_BASE = window.location.origin; // Same origin as the served frontend
const MAX_HISTORY = 20; // Number of past messages to send for context

// ================================================================
// STATE
// ================================================================
let conversationHistory = []; // Stores { role: "user"|"ai", content: string }
let isLoading = false; // Prevents double-sending while waiting for AI

// ================================================================
// DOM ELEMENTS
// ================================================================
const chatArea = document.getElementById("chatArea");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const quickQuestions = document.getElementById("quickQuestions");

// ================================================================
// LOGOUT
// ================================================================
function handleLogout() {
  localStorage.removeItem("bc_token");
  localStorage.removeItem("bc_user");
  window.location.href = "auth.html";
}

// ================================================================
// INITIALISATION
// ================================================================
document.addEventListener("DOMContentLoaded", () => {
  // Show logged-in user's name in the header
  const stored = localStorage.getItem("bc_user");
  if (stored) {
    try {
      const user = JSON.parse(stored);
      const nameEl = document.getElementById("headerUserName");
      if (nameEl) nameEl.textContent = user.name.split(" ")[0];
    } catch { /* ignore */ }
  }
  // Show welcome message from the AI
  addMessage(
    "ai",
    `Hey! 👋 I'm BC CourseFinder — here to help you figure out which IT course at Belgium Campus is right for you.

Tell me a bit about yourself — what subjects are you doing, what kind of work interests you, or just ask me anything. We'll figure it out together.`
  );

  // Set up event listeners
  sendBtn.addEventListener("click", handleSend);
  userInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // Quick question buttons
  document.querySelectorAll(".quick-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const question = btn.getAttribute("data-question");
      if (question && !isLoading) {
        userInput.value = question;
        handleSend();
      }
    });
  });

  // Focus input on load
  userInput.focus();
});

// ================================================================
// SEND MESSAGE
// ================================================================
async function handleSend() {
  const text = userInput.value.trim();
  if (!text || isLoading) return;

  // Clear input and disable while loading
  userInput.value = "";
  setLoading(true);

  // Add user message to chat
  addMessage("user", text);

  // Add to conversation history
  conversationHistory.push({ role: "user", content: text });

  // Show typing indicator
  showTypingIndicator();

  try {
    // Send to backend with conversation history for context
    const response = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        history: conversationHistory.slice(-MAX_HISTORY),
      }),
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    const data = await response.json();

    // Remove typing indicator
    removeTypingIndicator();

    // Add AI response to chat
    addMessage("ai", data.reply, data.sources || []);

    // Add to conversation history
    conversationHistory.push({ role: "ai", content: data.reply });

    // Trim history to prevent it from growing too large
    if (conversationHistory.length > MAX_HISTORY) {
      conversationHistory = conversationHistory.slice(-MAX_HISTORY);
    }
  } catch (err) {
    console.error("Chat error:", err);
    removeTypingIndicator();
    addMessage(
      "ai",
      "Sorry, I'm having trouble connecting right now. Please try again in a moment, or visit [belgiumcampus.ac.za](https://www.belgiumcampus.ac.za) directly for course information."
    );
  } finally {
    setLoading(false);
    userInput.focus();
  }
}

// ================================================================
// UI HELPERS
// ================================================================

/**
 * Add a message bubble to the chat area.
 * Supports basic markdown-like formatting: **bold**, bullet points, links.
 */
function addMessage(role, text, sources = []) {
  const messageDiv = document.createElement("div");
  messageDiv.className = `message ${role}`;

  // Avatar
  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = role === "ai" ? "BC" : "You";

  // Content wrapper
  const contentWrapper = document.createElement("div");

  // Message bubble
  const content = document.createElement("div");
  content.className = "message-content";
  content.innerHTML = formatMessage(text);

  contentWrapper.appendChild(content);

  // Source badges (for AI messages with sources)
  if (role === "ai" && sources.length > 0) {
    const sourcesDiv = document.createElement("div");
    sourcesDiv.className = "message-sources";
    sources.forEach((src) => {
      const badge = document.createElement("span");
      badge.className = "source-badge";
      badge.textContent = src;
      sourcesDiv.appendChild(badge);
    });
    contentWrapper.appendChild(sourcesDiv);
  }

  // Timestamp
  const time = document.createElement("div");
  time.className = "message-time";
  time.textContent = new Date().toLocaleTimeString("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
  });
  contentWrapper.appendChild(time);

  messageDiv.appendChild(avatar);
  messageDiv.appendChild(contentWrapper);

  chatArea.appendChild(messageDiv);
  scrollToBottom();
}

/**
 * Convert basic markdown to HTML for chat display.
 * Handles: **bold**, *italic*, bullet points, numbered lists, links, line breaks.
 */
function formatMessage(text) {
  if (!text) return "";

  // Escape HTML to prevent XSS
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Bold: **text** or __text__
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");

  // Italic: *text* or _text_  (only when surrounded by spaces/boundaries, not mid-word)
  html = html.replace(/(^|\s)\*([^*\s][^*]*?)\*(\s|$)/g, "$1<em>$2</em>$3");

  // Links: [text](url)
  html = html.replace(
    /\[(.+?)\]\((.+?)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>'
  );

  // Process line by line for headings, lists, and paragraphs
  const lines = html.split("\n");
  let result = "";
  let inList = false;
  let listType = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Headings: ## or ###
    if (/^###\s+/.test(line)) {
      if (inList) { result += `</${listType}>`; inList = false; }
      result += `<h4>${line.replace(/^###\s+/, "")}</h4>`;
      continue;
    }
    if (/^##\s+/.test(line)) {
      if (inList) { result += `</${listType}>`; inList = false; }
      result += `<h3>${line.replace(/^##\s+/, "")}</h3>`;
      continue;
    }
    if (/^#\s+/.test(line)) {
      if (inList) { result += `</${listType}>`; inList = false; }
      result += `<h3>${line.replace(/^#\s+/, "")}</h3>`;
      continue;
    }

    // Bullet points: - or * or •
    if (/^[-*•]\s+/.test(line)) {
      if (!inList || listType !== "ul") {
        if (inList) result += `</${listType}>`;
        result += "<ul>";
        inList = true;
        listType = "ul";
      }
      result += `<li>${line.replace(/^[-*•]\s+/, "")}</li>`;
      continue;
    }

    // Numbered list: 1. or 1)
    if (/^\d+[.)]\s+/.test(line)) {
      if (!inList || listType !== "ol") {
        if (inList) result += `</${listType}>`;
        result += "<ol>";
        inList = true;
        listType = "ol";
      }
      result += `<li>${line.replace(/^\d+[.)]\s+/, "")}</li>`;
      continue;
    }

    // Close any open list
    if (inList) {
      result += `</${listType}>`;
      inList = false;
    }

    // Empty line = paragraph break
    if (line === "") {
      result += "<br>";
    } else {
      result += `<p>${line}</p>`;
    }
  }

  // Close any remaining open list
  if (inList) {
    result += `</${listType}>`;
  }

  return result;
}

/**
 * Show a typing/thinking indicator.
 */
function showTypingIndicator() {
  const indicator = document.createElement("div");
  indicator.className = "typing-indicator";
  indicator.id = "typingIndicator";

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.style.background = "var(--bc-primary)";
  avatar.style.color = "#111";
  avatar.textContent = "BC";

  const dotsWrapper = document.createElement("div");

  const dots = document.createElement("div");
  dots.className = "typing-dots";
  dots.innerHTML = "<span></span><span></span><span></span>";

  const label = document.createElement("div");
  label.className = "typing-text";
  label.textContent = "BC CourseFinder is thinking...";

  dotsWrapper.appendChild(dots);
  dotsWrapper.appendChild(label);

  indicator.appendChild(avatar);
  indicator.appendChild(dotsWrapper);

  chatArea.appendChild(indicator);
  scrollToBottom();
}

/**
 * Remove the typing indicator.
 */
function removeTypingIndicator() {
  const indicator = document.getElementById("typingIndicator");
  if (indicator) {
    indicator.remove();
  }
}

/**
 * Enable/disable the input and send button.
 */
function setLoading(loading) {
  isLoading = loading;
  sendBtn.disabled = loading;
  userInput.disabled = loading;
  if (!loading) {
    userInput.focus();
  }
}

/**
 * Scroll the chat area to the bottom.
 */
function scrollToBottom() {
  requestAnimationFrame(() => {
    chatArea.scrollTop = chatArea.scrollHeight;
  });
}
