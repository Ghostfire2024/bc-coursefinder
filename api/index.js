/**
 * BC CourseFinder™ — Vercel Serverless Function
 * All /api/* requests are routed here by vercel.json.
 * Users are stored in /tmp (ephemeral per cold-start on Vercel).
 */

const express = require("express");
const cors    = require("cors");
const path    = require("path");
const fs      = require("fs");

const { GoogleGenerativeAI } = require("@google/generative-ai");
const bcrypt = require("bcryptjs");
const jwt    = require("jsonwebtoken");

const JWT_SECRET   = process.env.JWT_SECRET || "bc-coursefinder-secret-fallback";
// Vercel functions have a read-only filesystem except /tmp
const USERS_PATH   = "/tmp/users.json";
const COURSES_PATH = path.join(__dirname, "courses.json");

// ================================================================
// USER STORE
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
  try { req.user = jwt.verify(auth.slice(7), JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: "Invalid or expired token." }); }
}

// ================================================================
// EXPRESS APP
// ================================================================
const app = express();
app.use(cors());
app.use(express.json());

// ================================================================
// COURSE DATA
// ================================================================
let courseData = { courses: [] };
try {
  courseData = JSON.parse(fs.readFileSync(COURSES_PATH, "utf-8"));
  console.log(`[DATA] Loaded ${courseData.courses.length} courses`);
} catch (err) {
  console.error("[ERROR] courses.json:", err.message);
}

// ================================================================
// GEMINI
// ================================================================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
let geminiModel = null;
if (GEMINI_API_KEY && GEMINI_API_KEY !== "YOUR_GEMINI_API_KEY_HERE") {
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  geminiModel = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: { temperature: 0.85, maxOutputTokens: 4096, topP: 0.95 },
  });
}

// ================================================================
// SYSTEM PROMPT
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
// KEYWORD ENGINE
// ================================================================
const SUBJECT_KW = {
  mathematics: ["math","maths","mathematics","pure math","pure maths"],
  "mathematical literacy": ["math lit","maths lit","math literacy","maths literacy","mathematical literacy"],
  english: ["english","eng"],
  "physical sciences": ["physical science","physical sciences","physics","science"],
  "life sciences": ["life science","life sciences","biology"],
  "information technology": ["information technology","it subject","it at school"],
  accounting: ["accounting","acc"],
};
const TOPIC_KW = ["career","job","work","employ","salary","earn","course","qualification","degree","diploma","certificate","study","learn","requirement","admission","apply","register","nqf","credit","saqa","duration","year","campus","belgium","pretoria","kempton","stellenbosch","software","developer","programming","programmer","coding","cyber","security","network","data","database","web","app","cloud","devops","it","information technology","computing","computer","tech","bridging","maths","math","matric","grade 12","nsc","aps","subject","skill","compare","difference","vs","between","deaf","hearing","part-time","part time","postgraduate","master","bachelor","advanced","specialise","specialize","field","industry"];
const GENERIC = ["what","how","which","can","do","is","are","the","a","i","my","me","you","help","tell","about","need","want","know"];

function isOnTopic(msg) {
  if (msg.length < 10) return true;
  const l = msg.toLowerCase();
  return TOPIC_KW.filter((k) => l.includes(k) && !GENERIC.includes(k)).length >= 1;
}
function detectSubjects(msg) {
  const l = msg.toLowerCase();
  return Object.entries(SUBJECT_KW).filter(([,kws]) => kws.some((k) => l.includes(k))).map(([s]) => s);
}
function filterCourses(msg) {
  const l = msg.toLowerCase();
  const words = l.split(/\s+/).filter((w) => w.length > 2).map((w) => w.replace(/[^a-z]/g,""));
  const subs = detectSubjects(msg);
  return courseData.courses.map((c) => {
    let s = 0;
    const ct = [c.name,c.description,...c.careers,...c.skills,...c.requirements].join(" ").toLowerCase();
    for (const w of words) if (ct.includes(w)) s++;
    if (ct.includes(l.replace(/[?!.]/g,"").trim())) s += 5;
    if (c.name.toLowerCase().includes(l)) s += 10;
    if (subs.includes("mathematical literacy") && (c.name.toLowerCase().includes("diploma")||c.name.toLowerCase().includes("bridging"))) s += 3;
    if (subs.includes("mathematics")) s += 2;
    for (const ck of ["developer","engineer","analyst","security","architect","admin","consultant","manager","researcher","lecturer","cto","ciso"])
      if (l.includes(ck) && ct.includes(ck)) s += 3;
    if (l.includes("compare")||l.includes("difference")||l.includes(" vs ")) s++;
    return { c, s };
  }).filter((x) => x.s > 0).sort((a,b) => b.s - a.s).map((x) => x.c);
}
function formatCourses(courses) {
  if (!courses.length) courses = courseData.courses;
  return courses.map((c,i) => {
    let t = `\n--- Course ${i+1}: ${c.name} ---`;
    if (c.description)      t += `\nDescription: ${c.description}`;
    if (c.duration)         t += `\nDuration: ${c.duration}`;
    if (c.nqf_level)        t += `\nNQF Level: ${c.nqf_level}`;
    if (c.credits)          t += `\nCredits: ${c.credits}`;
    if (c.saqa_id)          t += `\nSAQA ID: ${c.saqa_id}`;
    if (c.requirements?.length) t += `\nRequirements: ${c.requirements.join(", ")}`;
    if (c.careers?.length)  t += `\nCareers: ${c.careers.join(", ")}`;
    if (c.skills?.length)   t += `\nSkills: ${c.skills.join(", ")}`;
    if (c.url)              t += `\nMore info: ${c.url}`;
    return t;
  }).join("\n");
}
const GREETING_RE = /^(hello|hi|hey|howzit|sup|yo|good morning|good afternoon|good evening|hola|greetings|what'?s up|wassup|hiya|heya)[\s!?.]*$/i;

function fallback(msg, courses) {
  const l = msg.toLowerCase();
  if (l.includes("math lit") || l.includes("mathematical literacy") || l.includes("maths lit"))
    return `So with Maths Literacy you've still got a solid option — the **Diploma in IT** (3 years) covers programming, networking, web dev, all of that. If you're aiming for a degree down the line, the **Maths Bridging Course** is the route there. Want me to break down what each one involves?`;
  if (courses.length)
    return `Here are a few programmes that might be relevant:\n\n` + courses.slice(0,3).map((c) => `**${c.name}**${c.duration ? ` (${c.duration})` : ""}`).join("\n") + `\n\nWant more detail on any of these — requirements, careers, what it's actually like? Just ask.`;
  return `Hey! I'm here to help you find the right IT course at Belgium Campus. What do you want to know — entry requirements, career options, how the courses compare? Fire away.`;
}

// ================================================================
// ROUTES
// ================================================================

app.post("/api/chat", async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: "Message is required." });
    const msg = message.trim();

    // Handle greetings directly — no need to hit Gemini
    if (GREETING_RE.test(msg)) {
      const greetings = [
        "Hey! 😊 So what are you trying to figure out — which course to study, what the entry requirements are, or what kind of IT career you'd enjoy?",
        "Hi there! Good to have you here. Are you exploring courses for next year, or trying to figure out which IT path suits you?",
        "Hey! What's on your mind — course requirements, career options, or something else?",
      ];
      return res.json({ reply: greetings[Math.floor(msg.length % greetings.length)], sources: [] });
    }

    if (!isOnTopic(msg)) return res.json({ reply: "Ah, that's a bit outside my lane — I'm only clued up on IT courses at Belgium Campus. Ask me anything about those though! 😊", sources: [] });

    const courses = filterCourses(msg);
    const sources = courses.slice(0,5).map((c) => c.name);
    if (!geminiModel) return res.json({ reply: fallback(msg, courses), sources });

    const ctx = formatCourses(courses);
    const hist = history.slice(-10).map((h) => `${h.role==="user"?"Student":"Assistant"}: ${h.content}`).join("\n");
    const prompt = `${SYSTEM_PROMPT}\n\nAVAILABLE COURSE DATA:\n${ctx}${hist ? `\n\nRECENT CONVERSATION:\n${hist}` : ""}\n\nSTUDENT'S QUESTION: ${msg}\n\nReply like you're chatting with a friend — casual, warm, real. Use the course data above only. If this is a follow-up, pick up naturally from where things left off. Include URLs for any courses you recommend.`;

    const result = await geminiModel.generateContent(prompt);
    return res.json({ reply: result.response.text(), sources });
  } catch (err) {
    console.error("[CHAT]", err.message);
    const courses = filterCourses(req.body?.message || "");
    return res.json({ reply: fallback(req.body?.message||"", courses), sources: [], fallback: true });
  }
});

app.get("/api/data",   (req, res) => res.json(courseData));
app.get("/api/health", (req, res) => res.json({ status: "ok", courses: courseData.courses.length, gemini: !!geminiModel }));

app.post("/api/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name||!email||!password) return res.status(400).json({ error: "All fields are required." });
    if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });
    const users = readUsers();
    if (users.find((u) => u.email.toLowerCase()===email.toLowerCase())) return res.status(409).json({ error: "An account with that email already exists." });
    const passwordHash = await bcrypt.hash(password, 10);
    const user = { id: Date.now().toString(), name: name.trim(), email: email.toLowerCase().trim(), passwordHash, createdAt: new Date().toISOString() };
    users.push(user);
    writeUsers(users);
    const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: "7d" });
    res.status(201).json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    res.status(500).json({ error: "Registration failed. Please try again." });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email||!password) return res.status(400).json({ error: "Email and password are required." });
    const users = readUsers();
    const user = users.find((u) => u.email.toLowerCase()===email.toLowerCase());
    if (!user||!(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: "Incorrect email or password." });
    const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    res.status(500).json({ error: "Login failed. Please try again." });
  }
});

app.get("/api/me", verifyToken, (req, res) => res.json({ user: req.user }));

module.exports = app;
