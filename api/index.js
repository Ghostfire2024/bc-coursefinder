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
    generationConfig: { temperature: 0.7, maxOutputTokens: 4096, topP: 0.9 },
  });
}

// ================================================================
// SYSTEM PROMPT
// ================================================================
const SYSTEM_PROMPT = `You are BC CourseFinder™, an expert IT career advisor for Belgium Campus iTversity. You speak directly to South African matric (Grade 12) students who are figuring out their future. Your tone is warm, honest, and knowledgeable — like a trusted mentor who knows every course inside out.

YOUR SCOPE:
You only advise on IT careers and qualifications offered by Belgium Campus iTversity. If a student asks something outside this scope, say: "I can only assist with IT career guidance based on Belgium Campus programmes. Feel free to ask me about IT courses, careers, or requirements!"

HOW TO RESPOND:
- Write in natural, flowing prose like a knowledgeable mentor speaking directly to the student. Do NOT default to bullet-point lists for every answer.
- Use bullet points or numbered lists ONLY when presenting 3 or more parallel items that are genuinely clearer in list form.
- Use ## headings only when your answer covers multiple distinct sections.
- Match your depth to the question.
- If a student is following up, acknowledge it and build on it naturally.
- Always include the course URL when recommending a programme.
- If a student shares their matric subjects or marks, explain exactly which courses they qualify for and why.

ADMISSION RULES:
1. Mathematical Literacy qualifies for Diploma in IT or IT Diploma for Deaf and Hard of Hearing only — NOT degrees (BIT or BComp).
2. Degrees (BIT, BComp, Part-Time BIT) require Pure Mathematics at 50% or above.
3. Pure Maths below 50% → recommend the Maths Bridging Course.
4. NQF 6 = Diploma (3 yrs), NQF 7 = BIT (3 yrs) or Adv Diploma (1 yr), NQF 8 = BComp (4 yrs) or Postgrad Diploma (1 yr), NQF 9 = MIT (2 yrs).

DATA RULES:
- Only use the course data provided. Do not invent facts or courses.
- Use South African English (e.g. "programme", "specialise").

ABOUT BELGIUM CAMPUS:
- Specialist IT HEI with campuses in Pretoria, Kempton Park, and Stellenbosch.
- 100% graduate employment rate claimed.
- Website: belgiumcampus.ac.za`;

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
function fallback(msg, courses) {
  const l = msg.toLowerCase();
  if (l.includes("math lit")||l.includes("mathematical literacy")||l.includes("maths lit"))
    return `With Mathematical Literacy you can apply for the **Diploma in IT** (3 years) or the **Maths Bridging Course**. Visit belgiumcampus.ac.za for full details.`;
  if (courses.length) {
    return `Here are relevant programmes:\n\n` + courses.slice(0,3).map((c) => `**${c.name}**${c.duration?` (${c.duration})`:""}`).join("\n") + `\n\nVisit belgiumcampus.ac.za for more.`;
  }
  return `Ask me about IT courses, careers, or requirements at Belgium Campus iTversity!`;
}

// ================================================================
// ROUTES
// ================================================================

app.post("/api/chat", async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: "Message is required." });
    const msg = message.trim();
    if (!isOnTopic(msg)) return res.json({ reply: "I can only assist with IT career guidance based on Belgium Campus programmes. Feel free to ask me about IT courses, careers, or requirements! 😊", sources: [] });

    const courses = filterCourses(msg);
    const sources = courses.slice(0,5).map((c) => c.name);
    if (!geminiModel) return res.json({ reply: fallback(msg, courses), sources });

    const ctx = formatCourses(courses);
    const hist = history.slice(-10).map((h) => `${h.role==="user"?"Student":"Assistant"}: ${h.content}`).join("\n");
    const prompt = `${SYSTEM_PROMPT}\n\nAVAILABLE COURSE DATA:\n${ctx}${hist ? `\n\nRECENT CONVERSATION:\n${hist}` : ""}\n\nSTUDENT'S QUESTION: ${msg}\n\nRespond using ONLY the course data above. Be as detailed as the question needs. If this is a follow-up, continue naturally. Always include course URLs when recommending a programme.`;

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
