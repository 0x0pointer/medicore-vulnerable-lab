/*
 * MediCore — Database seeder
 * -------------------------------------------------------------------------
 * Creates a fresh SQLite database with sample (FAKE) users, patients,
 * clinical notes and lab records. All data here is synthetic and generated
 * for a training lab — it does not describe real people.
 *
 * SECURITY NOTE (intentional): passwords are stored as unsalted MD5 hashes.
 * See SECURITY.md → Vulnerability #6 (Weak Cryptography).
 */
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'medicore.db');

// INTENTIONALLY WEAK: unsalted MD5 — see Vulnerability #6
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  DROP TABLE IF EXISTS users;
  DROP TABLE IF EXISTS patients;
  DROP TABLE IF EXISTS notes;
  DROP TABLE IF EXISTS records;
  DROP TABLE IF EXISTS messages;

  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,          -- MD5 hash (intentionally weak)
    full_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'clinician',
    email TEXT,
    ssn TEXT,                        -- sensitive: intentionally exposed by the API
    department TEXT
  );

  CREATE TABLE patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mrn TEXT UNIQUE NOT NULL,        -- medical record number
    full_name TEXT NOT NULL,
    dob TEXT,
    gender TEXT,
    ssn TEXT,                        -- sensitive
    phone TEXT,
    address TEXT,
    insurance_id TEXT,
    blood_type TEXT,
    primary_clinician_id INTEGER,    -- owner; access control SHOULD check this
    diagnosis TEXT,
    status TEXT DEFAULT 'active',
    avatar TEXT
  );

  CREATE TABLE notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    author TEXT NOT NULL,
    body TEXT NOT NULL,              -- rendered unsanitized on the client (stored XSS)
    created_at TEXT NOT NULL
  );

  CREATE TABLE records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    kind TEXT NOT NULL,
    filename TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    clinician TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    reason TEXT,
    location TEXT,
    status TEXT DEFAULT 'scheduled',
    created_at TEXT NOT NULL
  );
`);

const users = [
  ['admin',    'admin123',   'Dr. Alice Reed',     'admin',     'a.reed@medicore.test',   '512-88-1420', 'Administration'],
  ['jcarter',  'password1',  'Dr. James Carter',   'clinician', 'j.carter@medicore.test', '601-22-7781', 'Cardiology'],
  ['mpatel',   'spring2024', 'Dr. Meena Patel',    'clinician', 'm.patel@medicore.test',  '430-19-3356', 'Oncology'],
  ['nwong',    'letmein',    'Nurse Nina Wong',    'nurse',     'n.wong@medicore.test',   '288-77-9012', 'Emergency'],
  ['billing',  'invoices',   'Tom Hill (Billing)', 'billing',   't.hill@medicore.test',   '905-34-2201', 'Finance'],
];

const insUser = db.prepare(
  `INSERT INTO users (username, password, full_name, role, email, ssn, department)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);
for (const [u, p, name, role, email, ssn, dept] of users) {
  insUser.run(u, md5(p), name, role, email, ssn, dept);
}

const patients = [
  ['MRN-100294', 'Grace Thornton',  '1958-03-12', 'F', '221-54-9087', '+1-555-0142', '48 Birch Lane, Portland, OR',   'AET-55210', 'O+',  2, 'Atrial fibrillation',      'active'],
  ['MRN-100318', 'Hector Alvarez',  '1971-11-02', 'M', '318-29-7741', '+1-555-0199', '9 Cedar Court, Austin, TX',     'BCB-11942', 'A-',  2, 'Type 2 diabetes',          'active'],
  ['MRN-100455', 'Priya Nair',      '1989-06-27', 'F', '409-61-2238', '+1-555-0170', '1200 Oak Ridge, Denver, CO',    'UHC-78203', 'B+',  3, 'Stage II breast carcinoma','active'],
  ['MRN-100512', 'Daniel Okafor',   '2001-01-19', 'M', '550-02-6619', '+1-555-0133', '77 Maple Ave, Seattle, WA',     'KAI-30118', 'AB+', 4, 'Acute appendicitis',       'active'],
  ['MRN-100603', 'Sofia Rossi',     '1965-09-08', 'F', '660-45-1183', '+1-555-0188', '14 Elm Street, Boston, MA',     'AET-99014', 'O-',  3, 'Hypertension',             'active'],
  ['MRN-100677', 'William Chen',    '1943-12-30', 'M', '712-88-4420', '+1-555-0155', '305 Pine Hill, Chicago, IL',    'MED-44102', 'A+',  2, 'Chronic kidney disease',   'critical'],
  ['MRN-100741', 'Amara Johnson',   '1996-04-14', 'F', '803-17-9955', '+1-555-0121', '62 Spruce Way, Atlanta, GA',    'UHC-20557', 'B-',  4, 'Asthma exacerbation',      'active'],
  ['MRN-100809', 'Lucas Meyer',     '1979-07-23', 'M', '914-73-0082', '+1-555-0166', '8 Walnut Blvd, Phoenix, AZ',    'BCB-61230', 'O+',  3, 'Post-op recovery (ACL)',   'discharged'],
];

const insPatient = db.prepare(
  `INSERT INTO patients (mrn, full_name, dob, gender, ssn, phone, address, insurance_id, blood_type, primary_clinician_id, diagnosis, status)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
for (const row of patients) insPatient.run(...row);

const now = () => new Date().toISOString();
const insNote = db.prepare(
  `INSERT INTO notes (patient_id, author, body, created_at) VALUES (?, ?, ?, ?)`
);
insNote.run(1, 'Dr. James Carter', 'Patient reports intermittent palpitations. Started on rate control. Follow up in 2 weeks.', now());
insNote.run(1, 'Nurse Nina Wong',  'BP 148/92 at intake. Patient anxious but cooperative.', now());
insNote.run(3, 'Dr. Meena Patel',  'Completed cycle 2 of chemotherapy. Tolerating well, mild nausea managed with ondansetron.', now());
insNote.run(6, 'Dr. James Carter', 'eGFR trending down. Nephrology consult requested. Monitor potassium closely.', now());

const insRecord = db.prepare(
  `INSERT INTO records (patient_id, title, kind, filename, created_at) VALUES (?, ?, ?, ?, ?)`
);
insRecord.run(1, 'ECG — 12 lead',          'imaging',  'ecg_100294.txt',      now());
insRecord.run(1, 'Lipid panel',            'lab',      'lipids_100294.txt',   now());
insRecord.run(3, 'Pathology report',       'lab',      'pathology_100455.txt', now());
insRecord.run(6, 'Metabolic panel',        'lab',      'cmp_100677.txt',      now());

const insMsg = db.prepare(
  `INSERT INTO messages (author, body, created_at) VALUES (?, ?, ?)`
);
insMsg.run('Dr. Alice Reed', 'Reminder: quarterly compliance training is due Friday.', now());
insMsg.run('Tom Hill (Billing)', 'Insurance pre-auth for MRN-100455 is pending.', now());

const soon = (days, hour) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return d.toISOString(); };
const insAppt = db.prepare(
  `INSERT INTO appointments (patient_id, clinician, starts_at, reason, location, status, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);
insAppt.run(1, 'Dr. James Carter', soon(1, 9),  'AF follow-up',          'Cardiology Clinic, Rm 2', 'scheduled', now());
insAppt.run(2, 'Dr. James Carter', soon(2, 11), 'Diabetes review',       'Telehealth',              'scheduled', now());
insAppt.run(3, 'Dr. Meena Patel',  soon(3, 14), 'Chemo cycle 3',         'Oncology Day Unit',       'scheduled', now());
insAppt.run(6, 'Dr. James Carter', soon(5, 10), 'Nephrology coordination','Telehealth',             'scheduled', now());

db.close();
console.log('✔ Seeded database at', DB_PATH);
console.log('  Users: admin/admin123, jcarter/password1, mpatel/spring2024, nwong/letmein, billing/invoices');
