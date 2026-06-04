# BC CourseFinder™ — Technology Stack

A complete reference of every technology used in this project, what it does, and why it was chosen.

---

## Frontend

### HTML5 / CSS3 / Vanilla JavaScript
**How:** The entire user interface is built with plain HTML, CSS, and JavaScript — no frontend framework.
**Why:** The app is a single-page chat interface with a landing page and auth forms. A framework like React would add unnecessary complexity and build steps. Vanilla JS keeps the project lightweight, fast to load, and easy to deploy as static files.

---

### CSS Custom Properties (Variables)
**How:** A `:root` block in `style.css` defines all colours (`--bc-primary`, `--bc-dark`, etc.) and reused values. Every component references these variables.
**Why:** Makes the entire colour scheme changeable in one place. When the theme was updated from pink/navy to black/white/yellow, only the `:root` values needed to change — no hunting through hundreds of lines of CSS.

---

### QRCode.js
**How:** Loaded via CDN on the landing page. When the user clicks the QR Code button in the nav, a QR code is generated client-side pointing to the live site URL (`window.location.origin`).
**Why:** Lets anyone share or print the site URL as a scannable QR code without any backend involvement. Used CDN to avoid adding a build step.
- **Source:** `https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js`

---

## Backend

### Node.js
**How:** The runtime that executes all server-side JavaScript. Powers both the local development server (`backend/server.js`) and the Vercel serverless function (`api/index.js`).
**Why:** JavaScript on both frontend and backend means one language across the whole project. Node.js has a vast ecosystem (npm) and is natively supported by Vercel.

---

### Express.js `v4`
**How:** Web framework that handles HTTP routing. Defines all API endpoints (`/api/chat`, `/api/register`, `/api/login`, `/api/me`, `/api/data`, `/api/health`) and serves static frontend files in local development.
**Why:** The most widely used Node.js web framework. Minimal, flexible, and works perfectly as a Vercel serverless function by exporting the app object.
- **Package:** `express`

---

### Groq SDK + Llama 3.3-70B
**How:** The AI engine behind the chatbot. Every user message is sent to Groq's API using the `groq-sdk` package. The full system prompt, relevant course data, and conversation history are packaged into an OpenAI-compatible chat completions request.
**Why:** Groq provides extremely fast inference (tokens per second far above competitors) on powerful open-source models. The free tier offers 14,400 requests/day — significantly more generous than alternatives. Llama 3.3-70B is a state-of-the-art 70-billion parameter model that produces natural, intelligent responses.
- **Package:** `groq-sdk`
- **Model:** `llama-3.3-70b-versatile`
- **API:** [console.groq.com](https://console.groq.com)

---

### bcryptjs
**How:** Used in the `/api/register` route to hash passwords before storing them in Supabase (`bcrypt.hash(password, 10)`). Used in `/api/login` to compare the entered password against the stored hash (`bcrypt.compare`).
**Why:** Passwords must never be stored in plain text. bcrypt is the industry standard for password hashing — it is intentionally slow (work factor of 10 salt rounds) to resist brute-force attacks. `bcryptjs` is a pure JavaScript implementation that works in all Node.js environments without native bindings.
- **Package:** `bcryptjs`

---

### JSON Web Tokens (JWT)
**How:** After a successful register or login, the server signs a JWT containing the user's `id`, `email`, and `name` using a secret key (`JWT_SECRET`). The token is stored in the browser's `localStorage`. Every protected request (e.g. `/api/me`) sends the token in the `Authorization: Bearer <token>` header, which the server verifies.
**Why:** JWTs allow stateless authentication — the server doesn't need to store sessions. This is ideal for serverless functions which have no shared memory between invocations.
- **Package:** `jsonwebtoken`

---

### dotenv
**How:** Loaded at the top of `backend/server.js` via `require("dotenv").config()`. Reads the `backend/.env` file and injects variables (`GROQ_API_KEY`, `SUPABASE_URL`, etc.) into `process.env`.
**Why:** Keeps secrets out of source code. The `.env` file is listed in `.gitignore` so credentials are never committed to GitHub.
- **Package:** `dotenv`

---

### CORS (cors)
**How:** Applied as Express middleware (`app.use(cors())`). Adds the necessary HTTP headers to allow the frontend to call the API from a different origin during development.
**Why:** Browsers block cross-origin requests by default. CORS middleware allows the frontend (served on one port) to communicate with the backend API (served on another port) during local development.
- **Package:** `cors`

---

## Database

### Supabase (PostgreSQL)
**How:** A hosted PostgreSQL database used to store registered user accounts. The `@supabase/supabase-js` client is initialised with the project URL and a `service_role` key. The `users` table stores `id`, `name`, `email`, `password_hash`, and `created_at`. Registration inserts a new row; login queries by email.
**Why:** The previous approach stored users in a `users.json` file which was wiped every time Vercel's serverless function cold-started (~15 minutes of inactivity). Supabase provides a free-tier PostgreSQL database that persists data permanently. It has a generous free tier (500MB storage, unlimited API requests) and a clean JavaScript SDK.
- **Package:** `@supabase/supabase-js`
- **Free tier:** [supabase.com](https://supabase.com)

**Table schema:**
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Hosting & Deployment

### Vercel
**How:** The entire application is deployed on Vercel. Static frontend files (`frontend/`) are served by Vercel's CDN. All `/api/*` requests are rewritten to a Node.js serverless function (`api/index.js`) via `vercel.json` routing rules.
**Why:** Vercel is free, supports Node.js serverless functions, has no outbound network restrictions (unlike Firebase's free tier), deploys automatically on every GitHub push, and includes a global CDN for fast static file delivery.
- **Config:** `vercel.json`
- **Free tier:** [vercel.com](https://vercel.com)

---

### GitHub
**How:** The project repository is hosted at `github.com/Ghostfire2024/bc-coursefinder`. Every change is committed and pushed to the `main` branch, which triggers an automatic Vercel redeploy.
**Why:** Version control, deployment automation, and code backup. The `.gitignore` file ensures secrets (`.env` files, `node_modules`, `users.json`) are never committed.

---

## Development Tools

### npm (Node Package Manager)
**How:** Manages all third-party packages. Dependencies are listed in `package.json`. Running `npm install` downloads everything listed.
**Why:** The standard package manager for Node.js. All packages used are publicly available on the npm registry.

---

## Summary Table

| Technology | Category | Purpose |
|---|---|---|
| HTML5 / CSS3 / JS | Frontend | UI and interactivity |
| CSS Custom Properties | Frontend | Theming system |
| QRCode.js | Frontend | QR code generation |
| Node.js | Runtime | Server-side JavaScript execution |
| Express.js | Backend | HTTP routing and API |
| Groq + Llama 3.3-70B | AI | Conversational career guidance |
| bcryptjs | Security | Password hashing |
| jsonwebtoken | Security | Stateless authentication |
| dotenv | Config | Environment variable management |
| cors | Backend | Cross-origin request handling |
| Supabase (PostgreSQL) | Database | Persistent user account storage |
| Vercel | Hosting | Static files + serverless API |
| GitHub | Version Control | Source code and CI/CD |
| npm | Tooling | Package management |
