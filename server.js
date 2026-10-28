/*
 * ===========================================================================
 *  MediCore Health Portal — INTENTIONALLY VULNERABLE training application
 * ===========================================================================
 *
 *  ⚠  DO NOT DEPLOY THIS. It is a security lab, in the spirit of DVWA /
 *     WebGoat / OWASP Juice Shop. Every "VULN #n" block below is a bug on
 *     purpose. See SECURITY.md for the catalogue and how to exploit each one.
 *
 *  Run:  npm install && npm run seed && npm start   →  http://localhost:3000
 * ===========================================================================
 */
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'db', 'medicore.db');
const RECORDS_DIR = path.join(__dirname, 'patient_records');

if (!fs.existsSync(DB_PATH)) {
  console.error('\n  Database not found. Run  `npm run seed`  first.\n');
  process.exit(1);
}
const db = new Database(DB_PATH);

/* -----------------------------------------------------------------------
 * VULN #4 — Broken Authentication: hard-coded, trivially-weak JWT secret
 *           committed to source control. Anyone who reads the repo can
 *           forge a valid admin session token.                 (CWE-798)
 * --------------------------------------------------------------------- */
const JWT_SECRET = 'secret'; // <-- please never do this

// VULN #6 — Weak Cryptography: unsalted MD5 for passwords.      (CWE-327)
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

/* -----------------------------------------------------------------------
 * VULN #10 — Security Misconfiguration:
 *   - Reflected-origin CORS with credentials (any site can read the API
 *     on behalf of a logged-in user).
 *   - X-Powered-By left enabled (tech fingerprinting).
 *   - No security headers (no CSP / HSTS / X-Frame-Options / nosniff).
 *                                                       (CWE-942 / CWE-16)
 * --------------------------------------------------------------------- */
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ---- Auth helpers --------------------------------------------------------

function issueToken(user) {
  // Session data is trusted straight from a token signed with a weak secret.
  return jwt.sign(
    { uid: user.id, username: user.username, role: user.role, name: user.full_name },
    JWT_SECRET
  );
}

// Populates req.user when a (forgeable) token is present. Does NOT enforce.
function authOptional(req, _res, next) {
  const token = req.cookies.session || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (token) {
    try { req.user = jwt.verify(token, JWT_SECRET); } catch { /* ignore */ }
  }
  next();
}

function requireLogin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

app.use(authOptional);

// =========================================================================
//  AUTH
// =========================================================================

/* -----------------------------------------------------------------------
 * VULN #1 — SQL Injection: credentials are concatenated straight into the
 *           query. `username = admin' --` logs in as admin with no
 *           password; `' OR '1'='1' --` returns the first account.
 *                                                                (CWE-89)
 * --------------------------------------------------------------------- */
app.post('/api/login', (req, res) => {
  const { username = '', password = '' } = req.body;
  const sql =
    `SELECT * FROM users WHERE username = '${username}' AND password = '${md5(password)}'`;
  try {
    const user = db.prepare(sql).get();
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const token = issueToken(user);
    // Cookie is not HttpOnly and not Secure → readable by JS, sent over http.
    res.cookie('session', token, { httpOnly: false, sameSite: 'lax' });
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    // VULN #10 — verbose errors: the raw SQL error (and your injection’s
    //            syntax feedback) is handed back to the attacker.
    res.status(500).json({ error: err.message, sql });
  }
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('session');
  res.json({ ok: true });
});

/* -----------------------------------------------------------------------
 * VULN #5 — Sensitive Data Exposure: /api/me returns the MD5 password hash
 *           and SSN of the current user.                       (CWE-200)
 * --------------------------------------------------------------------- */
app.get('/api/me', requireLogin, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.uid);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user); // full row: password hash, ssn, everything
});

function publicUser(u) {
  return { id: u.id, username: u.username, full_name: u.full_name, role: u.role, department: u.department };
}

// =========================================================================
//  DASHBOARD / PATIENTS
// =========================================================================

app.get('/api/stats', requireLogin, (req, res) => {
  const total = db.prepare('SELECT COUNT(*) c FROM patients').get().c;
  const critical = db.prepare("SELECT COUNT(*) c FROM patients WHERE status = 'critical'").get().c;
  const active = db.prepare("SELECT COUNT(*) c FROM patients WHERE status = 'active'").get().c;
  const notes = db.prepare('SELECT COUNT(*) c FROM notes').get().c;
  const byDept = db.prepare(
    "SELECT COALESCE(department,'Unassigned') dept, COUNT(*) c FROM patients p LEFT JOIN users u ON u.id = p.primary_clinician_id GROUP BY dept"
  ).all();
  res.json({ total, critical, active, notes, byDept });
});

/* -----------------------------------------------------------------------
 * Patient list. The `q` search parameter is ALSO concatenated into SQL,
 * a second SQL-injection sink (see VULN #1).  Returns SSN + insurance in
 * the list payload (VULN #5, excessive data exposure).
 * --------------------------------------------------------------------- */
app.get('/api/patients', requireLogin, (req, res) => {
  const q = req.query.q;
  try {
    let rows;
    if (q) {
      rows = db.prepare(
        `SELECT * FROM patients WHERE full_name LIKE '%${q}%' OR mrn LIKE '%${q}%' OR diagnosis LIKE '%${q}%'`
      ).all();
    } else {
      rows = db.prepare('SELECT * FROM patients ORDER BY id').all();
    }
    res.json(rows); // includes ssn, insurance_id, address, phone
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* -----------------------------------------------------------------------
 * VULN #3 — IDOR / Broken Access Control: any authenticated user can read
 *           ANY patient by id. There is no check that the patient belongs
 *           to the requesting clinician (primary_clinician_id is ignored).
 *           Walk the ids 1..N to dump every record.            (CWE-639)
 * --------------------------------------------------------------------- */
app.get('/api/patients/:id', requireLogin, (req, res) => {
  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
  if (!patient) return res.status(404).json({ error: 'Patient not found' });
  res.json(patient);
});

app.get('/api/patients/:id/notes', requireLogin, (req, res) => {
  const notes = db.prepare('SELECT * FROM notes WHERE patient_id = ? ORDER BY id DESC').all(req.params.id);
  res.json(notes);
});

/* -----------------------------------------------------------------------
 * VULN #2 — Stored XSS: the note body is persisted verbatim and later
 *           rendered with innerHTML on the client (see public/js/app.js).
 *           `<img src=x onerror=alert(document.cookie)>` fires for every
 *           clinician who opens the chart.                      (CWE-79)
 * --------------------------------------------------------------------- */
app.post('/api/patients/:id/notes', requireLogin, (req, res) => {
  const { body = '' } = req.body;
  const author = req.user.name || 'Unknown';
  const info = db.prepare(
    'INSERT INTO notes (patient_id, author, body, created_at) VALUES (?, ?, ?, ?)'
  ).run(req.params.id, author, body, new Date().toISOString());
  res.json({ id: info.lastInsertRowid, author, body, created_at: new Date().toISOString() });
});

// Broadcast message board — also rendered unsanitized (second stored-XSS sink)
app.get('/api/messages', requireLogin, (req, res) => {
  res.json(db.prepare('SELECT * FROM messages ORDER BY id DESC').all());
});
app.post('/api/messages', requireLogin, (req, res) => {
  const { body = '' } = req.body;
  const author = req.user.name || 'Unknown';
  const info = db.prepare('INSERT INTO messages (author, body, created_at) VALUES (?, ?, ?)')
    .run(author, body, new Date().toISOString());
  res.json({ id: info.lastInsertRowid, author, body, created_at: new Date().toISOString() });
});

// =========================================================================
//  RECORDS / FILES
// =========================================================================

app.get('/api/records', requireLogin, (req, res) => {
  const pid = req.query.patient_id;
  const rows = pid
    ? db.prepare('SELECT * FROM records WHERE patient_id = ? ORDER BY id DESC').all(pid)
    : db.prepare('SELECT * FROM records ORDER BY id DESC').all();
  res.json(rows);
});

/* -----------------------------------------------------------------------
 * VULN #7 — Path Traversal: the `file` parameter is joined onto the
 *           records directory with no validation, so
 *           `?file=../server.js` or `?file=../../../../etc/passwd`
 *           reads arbitrary files off the host.                (CWE-22)
 * --------------------------------------------------------------------- */
app.get('/api/records/download', requireLogin, (req, res) => {
  const file = req.query.file || '';
  const target = path.join(RECORDS_DIR, file); // no normalization / no base check
  fs.readFile(target, 'utf8', (err, data) => {
    if (err) return res.status(404).json({ error: 'File not found', path: target });
    res.type('text/plain').send(data);
  });
});

// =========================================================================
//  ADMIN
// =========================================================================

/* -----------------------------------------------------------------------
 * VULN #9 — Missing Function-Level Access Control: these "admin" routes
 *           only check that you are logged in, never that role == admin.
 *           A nurse or billing user (or a forged token) can list every
 *           account and change anyone's role.                  (CWE-862)
 * --------------------------------------------------------------------- */
app.get('/api/admin/users', requireLogin, (req, res) => {
  // VULN #5 again: returns password hashes + SSNs for every user.
  res.json(db.prepare('SELECT * FROM users ORDER BY id').all());
});

app.post('/api/admin/users/:id/role', requireLogin, (req, res) => {
  const { role } = req.body;
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  res.json({ ok: true, id: req.params.id, role });
});

/* -----------------------------------------------------------------------
 * VULN #8 — OS Command Injection: the "network diagnostics" tool passes
 *           the host field straight into a shell.
 *           host = `127.0.0.1; cat /etc/passwd`  →  RCE.       (CWE-78)
 * --------------------------------------------------------------------- */
app.post('/api/admin/network-check', requireLogin, (req, res) => {
  const host = req.body.host || '127.0.0.1';
  exec(`ping -c 1 ${host}`, { timeout: 5000 }, (err, stdout, stderr) => {
    res.json({ command: `ping -c 1 ${host}`, output: stdout || stderr, error: err ? err.message : null });
  });
});

// =========================================================================

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'medicore' }));

/* VULN #10 (cont.) — global error handler leaks stack traces. */
app.use((err, _req, res, _next) => {
  res.status(500).json({ error: err.message, stack: err.stack });
});

app.listen(PORT, () => {
  console.log(`\n  MediCore (VULNERABLE lab) running → http://localhost:${PORT}`);
  console.log('  ⚠  Intentionally insecure. Do not expose to the internet.\n');
});
