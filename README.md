# MediCore — Vulnerable Healthcare Portal (Security Lab)

> ⚠️ **This application is intentionally insecure.** It exists for security
> training, secure-code-review practice, CTF-style exercises, and testing
> SAST/DAST/dependency scanners — in the same spirit as
> [DVWA](https://github.com/digininja/DVWA),
> [WebGoat](https://owasp.org/www-project-webgoat/), and
> [OWASP Juice Shop](https://owasp.org/www-project-juice-shop/).
> **Do not deploy it, do not expose it to the internet, and do not put real
> data in it.** All sample data is synthetic.

MediCore is a mock clinical workspace — patient charts, labs, care-team
messaging and an admin console — wrapped around a deliberately vulnerable
Node.js/Express + SQLite backend. It ships with **10 planted vulnerabilities**
(see [`SECURITY.md`](./SECURITY.md)) and a polished UI so the exploits feel
real.

![stack](https://img.shields.io/badge/stack-Node%20%2B%20Express%20%2B%20SQLite-0ea5a4)
![purpose](https://img.shields.io/badge/purpose-security%20training-6366f1)
![status](https://img.shields.io/badge/⚠-intentionally%20vulnerable-dc2626)

---

## Quick start

```bash
git clone https://github.com/0x0pointer/medicore-vulnerable-lab.git
cd medicore-vulnerable-lab

npm install      # express, better-sqlite3, jsonwebtoken, cookie-parser
npm run seed     # create + populate db/medicore.db with synthetic data
npm start        # → http://localhost:3000
```

Or in one step: `npm run dev` (seeds then starts).

Open **http://localhost:3000** and sign in with a demo account.

### Demo accounts

| Username  | Password     | Role      | Department     |
|-----------|--------------|-----------|----------------|
| `admin`   | `admin123`   | admin     | Administration |
| `jcarter` | `password1`  | clinician | Cardiology     |
| `mpatel`  | `spring2024` | clinician | Oncology       |
| `nwong`   | `letmein`    | nurse     | Emergency      |
| `billing` | `invoices`   | billing   | Finance        |

---

## What's inside

```
medicore-vulnerable-lab/
├── server.js            # Express API — every "VULN #n" block is a planted bug
├── db/
│   └── seed.js          # creates db/medicore.db with synthetic users/patients
├── patient_records/     # sample lab/imaging files (path-traversal targets)
├── public/
│   ├── index.html       # login (split-screen branded UI)
│   ├── app.html         # dashboard SPA shell
│   ├── css/styles.css   # design system (teal/slate clinical theme)
│   └── js/
│       ├── login.js
│       └── app.js       # dashboard, patients, records, messages, admin
├── SECURITY.md          # the 10 vulnerabilities + how to exploit each
└── README.md
```

## The UI

- **Login** — split-screen marketing panel + credential form with
  show/hide password and one-click demo-account chips.
- **Dashboard** — stat cards, "patients by department" bar chart, recent
  patients, and the team message board.
- **Patients** — searchable directory with a slide-in chart **drawer**
  (demographics, clinical notes, add-note form).
- **Records** — document list + an inline file viewer.
- **Messages** — team broadcast board.
- **Admin** — user table + a "network diagnostics" tool.

Fully responsive (sidebar collapses to a drawer on mobile), built with
vanilla JS and a hand-rolled CSS design system — no build step.

## The vulnerabilities (summary)

| #  | Vulnerability                         | OWASP / CWE        | Where |
|----|---------------------------------------|--------------------|-------|
| 1  | SQL Injection (login + search)        | A03 / CWE-89       | `POST /api/login`, `GET /api/patients?q=` |
| 2  | Stored XSS (notes + messages)         | A03 / CWE-79       | notes & message board |
| 3  | IDOR / Broken Access Control          | A01 / CWE-639      | `GET /api/patients/:id` |
| 4  | Broken auth — weak hard-coded JWT key | A07 / CWE-798      | `JWT_SECRET` in `server.js` |
| 5  | Sensitive data exposure (PII/hashes)  | A01 / CWE-200      | `/api/me`, `/api/patients`, `/api/admin/users` |
| 6  | Weak cryptography (unsalted MD5)      | A02 / CWE-327      | `db/seed.js`, `server.js` |
| 7  | Path traversal (file download)        | A01 / CWE-22       | `GET /api/records/download?file=` |
| 8  | OS command injection                  | A03 / CWE-78       | `POST /api/admin/network-check` |
| 9  | Missing function-level access control | A01 / CWE-862      | `/api/admin/*` |
| 10 | Security misconfig (CORS/headers/errs)| A05 / CWE-16/942   | global middleware & error handler |

Full write-ups, payloads and reproduction steps are in
[`SECURITY.md`](./SECURITY.md).

## Suggested uses

- **Code review drills** — find all 10 reading `server.js` before peeking.
- **Scanner benchmarking** — point Aikido / Semgrep / CodeQL / Burp /
  OWASP ZAP at it and compare what each catches.
- **Fix-the-bug workshops** — branch, remediate one finding, prove the
  exploit no longer works.

## License

MIT — see `package.json`. Provided as-is for educational use only.
