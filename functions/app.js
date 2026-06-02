/**
 * ================================================================
 * BC CourseFinder™ - Express App (Firebase Functions)
 * ================================================================
 * Exported as a plain Express app — no app.listen(), no static
 * file serving. Firebase Hosting handles static files; this file
 * only handles /api/* routes.
 * ================================================================
 */

const express = require("express");
const cors    = require("cors");
const path    = require("path");
const fs      = require("fs");

const { GoogleGenerativeAI } = require("@google/generative-ai");
const bcrypt = require("bcryptjs");
const jwt    = require("jsonwebtoken");

const JWT_SECRET  = process.env.JWT_SECRET  || "bc-coursefinder-secret-fallback";
const USERS_PATH  = path.join(__dirname, "users.json");
const COURSES_PATH = path.join(__dirname, "courses.json");

// ================================================================
// USER STORE HELPERS
// ================================================================
function readUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_PATH, "utf-8")).users; }
  catch { return []; }
}
function writeUsers(users) {
  fs.writeFileSync(USERS_PATH, JSON.stringify({ users }, null, 2));
}
function verifyToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer "))
    return res.status(401).json({ error: "Not authenticated." });
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
}

// ================================================================
// EXPRESS APP
// ================================================================
const app = express();
app.use(cors());
app.use(express.json());

// ================================================================
// LOAD COURSE DATA
// ================================================================
let courseData = { courses: [] };
try {
  courseData = JSON.parse(fs.readFileSync(COURSES_PATH, "utf-8"));
  console.log(`[DATA] Loaded ${courseData.courses.length} courses`);
} catch (err) {
  console.error("[ERROR] Failed to load courses.json:", err.message);
}

// ================================================================
// GEMINI AI SETUP
// ================================================================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
let geminiModel = null;

if (GEMINI_API_KEY && GEMINI_API_KEY !== "YOUR_GEMINI_API_KEY_HERE") {
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  geminiModel = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: { temperature: 0.7, maxOutputTokens: 4096, topP: 0.9 },
  });
  console.log("[AI] Gemini initialized");
} else {
  console.warn("[AI] No Gemini API key. Fallback responses only.");
}

// ================================================================
// SYSTEM PROMPT
// ================================================================
const SYSTEM_PROMPT = `You are BC CourseFinder™, an expert IT career advisor for Belgium Campus iTversity. You speak directly to South African matric (Grade 12) students who are figuring out their future. Your tone is warm, honest, and knowledgeable — like a trusted mentor who knows every course inside out.

YOUR SCOPE:
You only advise on IT careers and qualifications offered by Belgium Campus iTversity. If a student asks something outside this scope, say: "I can only assist with IT career guidance based on Belgium Campus programmes. Feel free to ask me about IT courses, careers, or requirements!"

HOW TO RESPOND:
- Write in natural, flowing prose like a knowledgeable mentor speaking directly to the student. Do NOT default to bullet-point lists for every answer — use full sentences and paragraphs as your baseline.
- Use bullet points or numbered lists ONLY when you are presenting 3 or more parallel items that are genuinely clearer in list form (e.g. a list of career titles, a set of entry requirements). A two-item comparison should be written in prose, not a list.
- Use ## headings only when your answer covers multiple distinct sections (e.g. comparing two courses). For single-topic answers, no headings needed.
- Match your depth to the question. A simple "what is X?" gets a clear, conversational explanation in a few sentences. A complex question about subjects, career paths, or comparisons gets a thorough, multi-part answer.
- If a student is following up on something from earlier in the conversation, acknowledge it and build on it — don't start from scratch or repeat what you've already covered.
- When you recommend a course, always include its URL from the data so the student can find out more.
- If a student shares their matric subjects or marks, tell them exactly which courses they qualify for and why — and be honest about what they don't yet qualify for and what the pathway forward looks like.

ADMISSION RULES (apply these precisely):
1. Mathematical Literacy qualifies a student for the Diploma in IT or the IT Diploma for Deaf and Hard of Hearing only — NOT for degree programmes (BIT or BComp).
2. Degree programmes (BIT, BComp, Part-Time BIT) require Pure Mathematics at 50% or above.
3. If a student has Pure Maths below 50%, you MUST recommend the Maths Bridging Course as the pathway forward.
4. NQF 6 = Diploma (3 years), NQF 7 = Bachelor of IT (3 years) or Advanced Diploma (1 year), NQF 8 = Bachelor of Computing (4 years) or Postgrad Diploma (1 year), NQF 9 = Master of IT (2 years).

DATA RULES:
- Only use information from the course data provided with each request. Do not invent facts, statistics, or courses.
- If the data doesn't cover something, say so honestly and suggest the student visit belgiumcampus.ac.za for full details.
- Use South African English (e.g. "programme", "specialise", "organisation").

ABOUT BELGIUM CAMPUS:
- Specialist IT higher education institution with campuses in Pretoria, Kempton Park, and Stellenbosch.
- Claims a 100% graduate employment rate.
- Website: belgiumcampus.ac.za`;

// ================================================================
// KEYWORD ENGINE
// ================================================================
const SUBJECT_KEYWORDS = {
  mathematics: ["math", "maths", "mathematics", "pure math", "pure maths"],
  "mathematical literacy": ["math lit", "maths lit", "math literacy", "maths literacy", "mathematical literacy"],
  english: ["english", "eng"],
  "physical sciences": ["physical science", "physical sciences", "physics", "science"],
  "life sciences": ["life science", "life sciences", "biology"],
  "information technology": ["information technology", "it subject", "it at school"],
  accounting: ["accounting", "acc"],
};

const TOPIC_KEYWORDS = [
  "career","job","work","employ","salary","earn","course","qualification","degree","diploma",
  "certificate","study","learn","requirement","admission","apply","register","nqf","credit",
  "saqa","duration","year","campus","belgium","pretoria","kempton","stellenbosch","software",
  "developer","programming","programmer","coding","cyber","security","network","data","database",
  "web","app","cloud","devops","it","information technology","computing","computer","tech",
  "bridging","maths","math","matric","grade 12","nsc","aps","subject","skill","compare",
  "difference","vs","between","deaf","hearing","part-time","part time","postgraduate","master",
  "bachelor","advanced","specialise","specialize","field","industry",
];
const GENERIC_WORDS = ["what","how","which","can","do","is","are","the","a","i","my","me","you","help","tell","about","need","want","know"];

function isOnTopic(message) {
  if (message.length < 10) return true;
  const lower = message.toLowerCase();
  const matches = TOPIC_KEYWORDS.filter((kw) => lower.includes(kw) && !GENERIC_WORDS.includes(kw));
  return matches.length >= 1;
}

function detectSubjects(message) {
  const lower = message.toLowerCase();
  return Object.entries(SUBJECT_KEYWORDS)
    .filter(([, kws]) => kws.some((kw) => lower.includes(kw)))
    .map(([subject]) => subject);
}

function filterRelevantCourses(message) {
  const lower = message.toLowerCase();
  const words = lower.split(/\s+/).filter((w) => w.length > 2).map((w) => w.replace(/[^a-z]/g, ""));
  const subjects = detectSubjects(message);

  const scored = courseData.courses.map((course) => {
    let score = 0;
    const courseText = [course.name, course.description, ...course.careers, ...course.skills, ...course.requirements].join(" ").toLowerCase();

    for (const word of words) if (courseText.includes(word)) score++;
    if (courseText.includes(lower.replace(/[?!.]/g, "").trim())) score += 5;
    if (course.name.toLowerCase().includes(lower)) score += 10;

    if (subjects.includes("mathematical literacy") &&
        (course.name.toLowerCase().includes("diploma") || course.name.toLowerCase().includes("bridging"))) score += 3;
    if (subjects.includes("mathematics")) score += 2;

    const careerKws = ["developer","engineer","analyst","security","architect","admin","consultant","manager","researcher","lecturer","cto","ciso"];
    for (const ck of careerKws) if (lower.includes(ck) && courseText.includes(ck)) score += 3;
    if (lower.includes("compare") || lower.includes("difference") || lower.includes(" vs ")) score++;

    return { course, score };
  });

  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).map((s) => s.course);
}

function formatCoursesForPrompt(courses) {
  if (courses.length === 0) courses = courseData.courses;
  return courses.map((c, i) => {
    let text = `\n--- Course ${i + 1}: ${c.name} ---`;
    if (c.description)       text += `\nDescription: ${c.description}`;
    if (c.duration)          text += `\nDuration: ${c.duration}`;
    if (c.nqf_level)         text += `\nNQF Level: ${c.nqf_level}`;
    if (c.credits)           text += `\nCredits: ${c.credits}`;
    if (c.saqa_id)           text += `\nSAQA ID: ${c.saqa_id}`;
    if (c.requirements?.length) text += `\nRequirements: ${c.requirements.join(", ")}`;
    if (c.careers?.length)   text += `\nCareers: ${c.careers.join(", ")}`;
    if (c.skills?.length)    text += `\nSkills: ${c.skills.join(", ")}`;
    if (c.url)               text += `\nMore info: ${c.url}`;
    return text;
  }).join("\n");
}

function generateFallbackResponse(message, courses) {
  const lower = message.toLowerCase();
  if (lower.includes("math lit") || lower.includes("mathematical literacy") || lower.includes("maths lit"))
    return `With Mathematical Literacy you can apply for the **Diploma in IT** (3 years) or the **Maths Bridging Course** to work toward a degree. Visit belgiumcampus.ac.za for full details.`;
  if (courses.length > 0) {
    let r = `Here are relevant Belgium Campus programmes:\n\n`;
    courses.slice(0, 3).forEach((c) => { r += `**${c.name}**${c.duration ? ` (${c.duration})` : ""}\n`; });
    return r + `\nVisit belgiumcampus.ac.za for full information.`;
  }
  return `Ask me about IT courses, career paths, or admission requirements at Belgium Campus iTversity!`;
}

// ================================================================
// API ROUTES  — all under /api/
// ================================================================

// POST /api/chat
app.post("/api/chat", async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message || typeof message !== "string" || !message.trim())
      return res.status(400).json({ error: "Message is required." });

    const userMessage = message.trim();
    console.log(`[CHAT] "${userMessage}"`);

    if (!isOnTopic(userMessage))
      return res.json({ reply: "I can only assist with IT career guidance based on Belgium Campus programmes. Feel free to ask me about IT courses, careers, or requirements! 😊", sources: [] });

    const relevantCourses = filterRelevantCourses(userMessage);
    const sources = relevantCourses.slice(0, 5).map((c) => c.name);

    if (!geminiModel)
      return res.json({ reply: generateFallbackResponse(userMessage, relevantCourses), sources });

    const courseContext = formatCoursesForPrompt(relevantCourses);
    const recentHistory = history.slice(-10);
    const conversationContext = recentHistory.length
      ? "\n\nRECENT CONVERSATION:\n" + recentHistory.map((h) => `${h.role === "user" ? "Student" : "Assistant"}: ${h.content}`).join("\n")
      : "";

    const fullPrompt = `${SYSTEM_PROMPT}\n\nAVAILABLE COURSE DATA:\n${courseContext}${conversationContext}\n\nSTUDENT'S QUESTION: ${userMessage}\n\nRespond using ONLY the course data above. Be as detailed as the question needs. If this is a follow-up, refer back to what was already discussed and continue naturally. Always include course URLs when recommending a specific programme.`;

    const result = await geminiModel.generateContent(fullPrompt);
    return res.json({ reply: result.response.text(), sources });
  } catch (err) {
    console.error("[ERROR] /api/chat:", err.message);
    const courses = filterRelevantCourses(req.body?.message || "");
    return res.json({ reply: generateFallbackResponse(req.body?.message || "", courses), sources: [], fallback: true });
  }
});

// GET /api/data
app.get("/api/data", (req, res) => res.json(courseData));

// GET /api/health
app.get("/api/health", (req, res) =>
  res.json({ status: "ok", courses: courseData.courses.length, gemini: !!geminiModel })
);

// POST /api/register
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
    const newUser = { id: Date.now().toString(), name: name.trim(), email: email.toLowerCase().trim(), passwordHash, createdAt: new Date().toISOString() };
    users.push(newUser);
    writeUsers(users);

    const token = jwt.sign({ id: newUser.id, email: newUser.email, name: newUser.name }, JWT_SECRET, { expiresIn: "7d" });
    console.log(`[AUTH] Registered: ${newUser.email}`);
    res.status(201).json({ token, user: { id: newUser.id, name: newUser.name, email: newUser.email } });
  } catch (err) {
    console.error("[AUTH] Register:", err.message);
    res.status(500).json({ error: "Registration failed. Please try again." });
  }
});

// POST /api/login
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "Email and password are required." });

    const users = readUsers();
    const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (!user || !(await bcrypt.compare(password, user.passwordHash)))
      return res.status(401).json({ error: "Incorrect email or password." });

    const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: "7d" });
    console.log(`[AUTH] Login: ${user.email}`);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    console.error("[AUTH] Login:", err.message);
    res.status(500).json({ error: "Login failed. Please try again." });
  }
});

// GET /api/me
app.get("/api/me", verifyToken, (req, res) => res.json({ user: req.user }));

module.exports = app;
