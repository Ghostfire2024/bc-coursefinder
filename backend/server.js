/**
 * ================================================================
 * BC CourseFinder™ - Backend Server
 * ================================================================
 * AI-powered career guidance for South African matric students
 * interested in IT qualifications at Belgium Campus iTversity.
 *
 * Tech: Express + Google Gemini API
 * Data: Local courses.json from web scraper
 * ================================================================
 */

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const Groq = require("groq-sdk");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "bc-coursefinder-secret-fallback";
const USERS_PATH = path.join(__dirname, "users.json");

// ================================================================
// USER STORE HELPERS
// ================================================================
function readUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_PATH, "utf-8")).users;
  } catch {
    return [];
  }
}

function writeUsers(users) {
  fs.writeFileSync(USERS_PATH, JSON.stringify({ users }, null, 2));
}

function verifyToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Not authenticated." });
  }
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

// ================================================================
// MIDDLEWARE
// ================================================================
app.use(cors());
app.use(express.json());

// Serve frontend static files
app.use(express.static(path.join(__dirname, "..", "frontend")));

// ================================================================
// LOAD COURSE DATA FROM JSON FILE
// ================================================================
let courseData = { courses: [] };

try {
  const dataPath = path.join(__dirname, "..", "courses.json");
  const raw = fs.readFileSync(dataPath, "utf-8");
  courseData = JSON.parse(raw);
  console.log(
    `[DATA] Loaded ${courseData.courses.length} courses from courses.json`
  );
} catch (err) {
  console.error("[ERROR] Failed to load courses.json:", err.message);
}

// ================================================================
// GEMINI AI SETUP
// ================================================================
const groq = process.env.GROQ_API_KEY
  ? new Groq({ apiKey: process.env.GROQ_API_KEY })
  : null;

if (groq) console.log("[AI] Groq initialized successfully");
else console.warn("[AI] No GROQ_API_KEY found. Set it in .env file.");

// ================================================================
// SYSTEM PROMPT - Controls AI behaviour strictly
// ================================================================
const SYSTEM_PROMPT = `You are BC CourseFinder™ — a friendly AI that helps South African matric students figure out which IT course at Belgium Campus iTversity is right for them.

Think of yourself as a mate who studied at Belgium Campus and knows everything about their courses. You chat naturally, like you're messaging a friend. You're honest, warm, and genuinely excited to help students find a path they'll love.

YOUR VIBE:
- Talk like a real person. Use contractions — "don't", "you're", "I'd", "it's", "that's", "there's". Avoid stiff formal language.
- React to what the student actually said before diving into info. If they sound unsure, reassure them. If they're excited, match that energy.
- Ask a follow-up question when it helps narrow things down — "What subjects are you doing?" or "Are you more into building apps or more into the security side of things?"
- Keep it short when the question is simple. Go deeper when they need it. Never pad your answer.
- Do NOT start every reply with a heading or a bullet list. Lead with a sentence that actually responds to what they said.
- Only use bullet points when listing 3 or more parallel things that genuinely need a list. Otherwise just talk.
- Never sound like a brochure, a FAQ page, or a formal document.

WHAT YOU HELP WITH:
Only IT courses and careers at Belgium Campus iTversity. If someone asks about something unrelated, say: "Ah, that's a bit outside my lane — I'm only clued up on IT courses at Belgium Campus. Ask me anything about those though!"

ADMISSION RULES (apply these exactly, every time):
1. Math Literacy → qualifies for the Diploma in IT or IT Diploma for Deaf students ONLY. Not for degrees.
2. Pure Maths 50%+ → can apply for BIT or BComp degrees.
3. Pure Maths below 50% → the Maths Bridging Course is their way in. After that they can go for a degree.
4. NQF levels: 6 = Diploma (3 yrs), 7 = BIT (3 yrs) or Advanced Diploma (1 yr), 8 = BComp (4 yrs) or Postgrad Diploma (1 yr), 9 = Master's (2 yrs).

DATA RULES:
- Only use the course info given to you. Never make up credits, stats, or careers.
- If you genuinely don't know something, say so and point them to belgiumcampus.ac.za.
- Always include the course URL when you recommend something specific.
- Use South African English: "programme" not "program", "specialise" not "specialize".

BELGIUM CAMPUS QUICK FACTS:
- IT specialist institution, campuses in Pretoria, Kempton Park, and Stellenbosch.
- Claims a 100% graduate employment rate.
- belgiumcampus.ac.za`;

// ================================================================
// KEYWORD MATCHING & FILTERING ENGINE
// ================================================================

// South African matric subject keywords for detection
const SUBJECT_KEYWORDS = {
  mathematics: [
    "math",
    "maths",
    "mathematics",
    "pure math",
    "pure maths",
  ],
  "mathematical literacy": [
    "math lit",
    "maths lit",
    "math literacy",
    "maths literacy",
    "mathematical literacy",
  ],
  english: ["english", "eng"],
  "physical sciences": [
    "physical science",
    "physical sciences",
    "physics",
    "science",
  ],
  "life sciences": ["life science", "life sciences", "biology"],
  "information technology": ["information technology", "it subject", "it at school"],
  accounting: ["accounting", "acc"],
};

// IT career / topic keywords for relevance filtering
const TOPIC_KEYWORDS = [
  "career",
  "job",
  "work",
  "employ",
  "salary",
  "earn",
  "course",
  "qualification",
  "degree",
  "diploma",
  "certificate",
  "study",
  "learn",
  "requirement",
  "admission",
  "apply",
  "register",
  "nqf",
  "credit",
  "saqa",
  "duration",
  "year",
  "campus",
  "belgium",
  "pretoria",
  "kempton",
  "stellenbosch",
  "software",
  "developer",
  "programming",
  "programmer",
  "coding",
  "cyber",
  "security",
  "network",
  "data",
  "database",
  "web",
  "app",
  "cloud",
  "devops",
  "it",
  "information technology",
  "computing",
  "computer",
  "tech",
  "bridging",
  "maths",
  "math",
  "matric",
  "grade 12",
  "nsc",
  "aps",
  "subject",
  "skill",
  "compare",
  "difference",
  "vs",
  "between",
  "deaf",
  "hearing",
  "part-time",
  "part time",
  "postgraduate",
  "master",
  "bachelor",
  "advanced",
  "specialise",
  "specialize",
  "field",
  "industry",
];

// Words that are too generic to count as on-topic on their own
const GENERIC_WORDS = [
  "what", "how", "which", "can", "do", "is", "are", "the", "a", "i",
  "my", "me", "you", "help", "tell", "about", "need", "want", "know",
];

/**
 * Check if a user message is related to IT careers / Belgium Campus.
 * Returns true if the message is on-topic.
 */
function isOnTopic(message) {
  const lower = message.toLowerCase();

  // Short messages are likely follow-ups to an ongoing conversation
  if (message.length < 10) return true;

  // Count meaningful (non-generic) topic keyword matches
  const matchedKeywords = TOPIC_KEYWORDS.filter((kw) => lower.includes(kw));
  const meaningfulMatches = matchedKeywords.filter(
    (kw) => !GENERIC_WORDS.includes(kw)
  );

  // Need at least 1 meaningful IT/career keyword to be on-topic
  return meaningfulMatches.length >= 1;
}

/**
 * Detect which matric subjects are mentioned in the user message.
 */
function detectSubjects(message) {
  const lower = message.toLowerCase();
  const found = [];
  for (const [subject, keywords] of Object.entries(SUBJECT_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      found.push(subject);
    }
  }
  return found;
}

/**
 * Filter courses relevant to the user's question.
 * Uses keyword matching across course names, careers, skills, and descriptions.
 * Returns an array of courses sorted by relevance score.
 */
function filterRelevantCourses(message) {
  const lower = message.toLowerCase();
  const words = lower
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .map((w) => w.replace(/[^a-z]/g, ""));

  // Score each course by keyword matches
  const scored = courseData.courses.map((course) => {
    let score = 0;
    const courseText = [
      course.name,
      course.description,
      ...course.careers,
      ...course.skills,
      ...course.requirements,
    ]
      .join(" ")
      .toLowerCase();

    // Match individual words from the query against course data
    for (const word of words) {
      if (courseText.includes(word)) {
        score += 1;
      }
    }

    // Bonus for exact phrase matches
    if (courseText.includes(lower.replace(/[?!.]/g, "").trim())) {
      score += 5;
    }

    // Bonus for course name match
    if (course.name.toLowerCase().includes(lower)) {
      score += 10;
    }

    // Subject-based matching
    const subjects = detectSubjects(message);
    if (subjects.includes("mathematical literacy")) {
      // Math lit students can do diplomas and bridging
      if (
        course.name.toLowerCase().includes("diploma") ||
        course.name.toLowerCase().includes("bridging")
      ) {
        score += 3;
      }
    }
    if (subjects.includes("mathematics")) {
      // Pure maths opens all courses
      score += 2;
    }

    // Career-specific queries
    const careerKeywords = [
      "developer",
      "engineer",
      "analyst",
      "security",
      "architect",
      "admin",
      "consultant",
      "manager",
      "researcher",
      "lecturer",
      "cto",
      "ciso",
    ];
    for (const ck of careerKeywords) {
      if (lower.includes(ck) && courseText.includes(ck)) {
        score += 3;
      }
    }

    // Comparison queries - boost all courses to show multiple
    if (
      lower.includes("compare") ||
      lower.includes("difference") ||
      lower.includes(" vs ")
    ) {
      score += 1;
    }

    return { course, score };
  });

  // Return courses with score > 0, sorted by relevance
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.course);
}

/**
 * Format course data into a concise text block for the Gemini prompt.
 * Only includes fields that have data.
 */
function formatCoursesForPrompt(courses) {
  if (courses.length === 0) {
    // If no specific match, send all courses as context
    courses = courseData.courses;
  }

  return courses
    .map((c, i) => {
      let text = `\n--- Course ${i + 1}: ${c.name} ---`;
      if (c.description) text += `\nDescription: ${c.description}`;
      if (c.duration) text += `\nDuration: ${c.duration}`;
      if (c.nqf_level) text += `\nNQF Level: ${c.nqf_level}`;
      if (c.credits) text += `\nCredits: ${c.credits}`;
      if (c.saqa_id) text += `\nSAQA ID: ${c.saqa_id}`;
      if (c.requirements?.length)
        text += `\nRequirements: ${c.requirements.join(", ")}`;
      if (c.careers?.length) text += `\nCareers: ${c.careers.join(", ")}`;
      if (c.skills?.length) text += `\nSkills: ${c.skills.join(", ")}`;
      if (c.url) text += `\nMore info: ${c.url}`;
      return text;
    })
    .join("\n");
}

// ================================================================
// FALLBACK RESPONSE (when Gemini is unavailable)
// ================================================================
const GREETING_RE = /^(hello|hi|hey|howzit|sup|yo|good morning|good afternoon|good evening|hola|greetings|what'?s up|wassup|hiya|heya)[\s!?.]*$/i;

function generateFallbackResponse(message, relevantCourses) {
  const lower = message.toLowerCase();

  if (lower.includes("math lit") || lower.includes("mathematical literacy") || lower.includes("maths lit"))
    return `So with Maths Literacy you've still got a solid option — the **Diploma in IT** (3 years) covers programming, networking, web dev, all of that. If you're aiming for a degree down the line, the **Maths Bridging Course** is the route there. Want me to break down what each one involves?`;

  if (lower.includes("difference") || lower.includes("compare") || (lower.includes("diploma") && lower.includes("degree")))
    return `Good question! The short version: the **Diploma in IT** (NQF 6, 3 years) is more hands-on and practical — you can even get in with Maths Literacy. The **Bachelor of IT** (NQF 7, 3 years) goes deeper and opens more doors career-wise, but you need Pure Maths at 50%+. The **Bachelor of Computing** (NQF 8, 4 years) is the top one — think software engineering, data science, AI. Which of these sounds like it fits you better?`;

  if (relevantCourses.length > 0) {
    let r = `Here are a few programmes worth looking at:\n\n`;
    relevantCourses.slice(0, 3).forEach((c) => {
      r += `**${c.name}**${c.duration ? ` (${c.duration})` : ""}\n`;
    });
    return r + `\nWant more detail on any of these? Just ask.`;
  }

  return `Hey! I'm here to help you find the right IT course at Belgium Campus. What do you want to know — entry requirements, career options, how the courses compare? Fire away.`;
}

// ================================================================
// API ROUTES
// ================================================================

/**
 * POST /api/chat - Main chat endpoint
 * Receives: { message: string, history: [{role, content}] }
 * Returns: { reply: string, sources: string[] }
 */
app.post("/api/chat", async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    // Validate input
    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return res.status(400).json({ error: "Message is required." });
    }

    const userMessage = message.trim();
    console.log(`[CHAT] User: "${userMessage}"`);

    // Always send to Gemini — let the system prompt handle rules and tone
    const relevantCourses = filterRelevantCourses(userMessage);
    const sources = relevantCourses.slice(0, 5).map((c) => c.name);

    if (!groq) {
      return res.json({ reply: "I'm having trouble connecting right now. Try again in a moment!", sources });
    }

    // Only inject course data when something specific was asked
    const courseContext = relevantCourses.length > 0
      ? `\n\nAVAILABLE COURSE DATA:\n${formatCoursesForPrompt(relevantCourses)}`
      : "";
    const recentHistory = history.slice(-10);
    const conversationContext = recentHistory.length
      ? "\n\nRECENT CONVERSATION:\n" + recentHistory.map((h) => `${h.role === "user" ? "Student" : "Assistant"}: ${h.content}`).join("\n")
      : "";

    console.log("[CHAT] Sending to Groq...");
    const systemContent = `${SYSTEM_PROMPT}${courseContext}\n\nReply like you're chatting with a friend — casual, warm, real. Never list your own capabilities unprompted. If they just greeted you, greet them back in one sentence and ask one natural question.`;

    const messages = [
      { role: "system", content: systemContent },
      ...recentHistory.map((h) => ({
        role: h.role === "user" ? "user" : "assistant",
        content: h.content,
      })),
      { role: "user", content: userMessage },
    ];

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages,
      temperature: 0.85,
      max_tokens: 4096,
      top_p: 0.95,
    });

    return res.json({ reply: completion.choices[0].message.content, sources });
  } catch (err) {
    console.error("[ERROR] Chat endpoint failed:", err.message);
    return res.json({ reply: "Something went wrong on my end — try sending that again!", sources: [], fallback: true });
  }
});

// ================================================================
// AUTH ROUTES
// ================================================================

/**
 * POST /api/register
 * Body: { name, email, password }
 */
app.post("/api/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password)
      return res.status(400).json({ error: "All fields are required." });

    if (password.length < 6)
      return res.status(400).json({ error: "Password must be at least 6 characters." });

    const users = readUsers();
    if (users.find((u) => u.email.toLowerCase() === email.toLowerCase()))
      return res.status(409).json({ error: "An account with that email already exists." });

    const passwordHash = await bcrypt.hash(password, 10);
    const newUser = {
      id: Date.now().toString(),
      name: name.trim(),
      email: email.toLowerCase().trim(),
      passwordHash,
      createdAt: new Date().toISOString(),
    };

    users.push(newUser);
    writeUsers(users);

    const token = jwt.sign({ id: newUser.id, email: newUser.email, name: newUser.name }, JWT_SECRET, { expiresIn: "7d" });
    console.log(`[AUTH] New user registered: ${newUser.email}`);
    res.status(201).json({ token, user: { id: newUser.id, name: newUser.name, email: newUser.email } });
  } catch (err) {
    console.error("[AUTH] Register error:", err.message);
    res.status(500).json({ error: "Registration failed. Please try again." });
  }
});

/**
 * POST /api/login
 * Body: { email, password }
 */
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ error: "Email and password are required." });

    const users = readUsers();
    const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (!user)
      return res.status(401).json({ error: "Incorrect email or password." });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match)
      return res.status(401).json({ error: "Incorrect email or password." });

    const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: "7d" });
    console.log(`[AUTH] User logged in: ${user.email}`);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    console.error("[AUTH] Login error:", err.message);
    res.status(500).json({ error: "Login failed. Please try again." });
  }
});

/**
 * GET /api/me — verify token and return current user
 */
app.get("/api/me", verifyToken, (req, res) => {
  res.json({ user: req.user });
});

/**
 * GET /api/data - Returns all available courses
 */
app.get("/api/data", (req, res) => {
  res.json(courseData);
});

/**
 * GET /api/health - Health check endpoint
 */
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    courses: courseData.courses.length,
    groq: !!groq,
    timestamp: new Date().toISOString(),
  });
});

// /chat route serves the chat app
app.get("/chat", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "chat.html"));
});

// Catch-all: serve the landing page
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "index.html"));
});

// ================================================================
// START SERVER
// ================================================================
app.listen(PORT, () => {
  console.log("============================================");
  console.log("  BC CourseFinder™ Server");
  console.log("============================================");
  console.log(`  URL:     http://localhost:${PORT}`);
  console.log(`  Courses: ${courseData.courses.length} loaded`);
  console.log(`  Gemini:  ${geminiModel ? "Connected" : "Not configured"}`);
  console.log("============================================");
});
