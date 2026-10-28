// =============================================================
//  MediCore — dashboard SPA
//  NOTE: several render paths use innerHTML on server data without
//  escaping. Combined with the server storing note/message bodies
//  verbatim, that is the stored-XSS sink (SECURITY.md → Vuln #2).
// =============================================================

const api = async (url, opts = {}) => {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...opts,
  });
  if (res.status === 401) { window.location.href = '/'; throw new Error('unauthenticated'); }
  return res.json();
};

const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };
const content = document.getElementById('content');
const AVA_COLORS = ['#0ea5a4', '#6366f1', '#db2777', '#d97706', '#0891b2', '#7c3aed', '#059669'];
const avaColor = (s) => AVA_COLORS[(s || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0) % AVA_COLORS.length];
const initials = (name) => (name || '?').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

let ME = null;

// ---- bootstrap -----------------------------------------------
(async function init() {
  try {
    ME = await api('/api/me');
  } catch { return; }
  document.getElementById('userName').textContent = ME.full_name;
  document.getElementById('userRole').textContent = ME.role;
  document.getElementById('userAvatar').textContent = initials(ME.full_name);
  document.getElementById('userAvatar').style.background = avaColor(ME.full_name);

  // wire nav
  document.querySelectorAll('.nav-item').forEach((n) => {
    n.addEventListener('click', () => switchView(n.dataset.view));
  });
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' });
    try { localStorage.removeItem('medicore_user'); } catch {}
    window.location.href = '/';
  });
  document.getElementById('menuToggle')?.addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });
  const gs = document.getElementById('globalSearch');
  gs.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { switchView('patients'); setTimeout(() => runPatientSearch(gs.value), 50); }
  });

  switchView('dashboard');
})();

function switchView(view) {
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.view === view));
  document.getElementById('sidebar').classList.remove('open');
  ({ dashboard: viewDashboard, patients: viewPatients, records: viewRecords, messages: viewMessages, appointments: viewAppointments, admin: viewAdmin }[view] || viewDashboard)();
}

// ---- Dashboard -----------------------------------------------
async function viewDashboard() {
  content.innerHTML = '<div class="loading">Loading dashboard…</div>';
  const [stats, patients, messages] = await Promise.all([
    api('/api/stats'), api('/api/patients'), api('/api/messages'),
  ]);
  const maxDept = Math.max(1, ...stats.byDept.map((d) => d.c));

  content.innerHTML = `
    <div class="page-head">
      <div><h1>Good day, ${ME.full_name.split(' ').slice(-1)}</h1><p>Here's what's happening across your care teams today.</p></div>
      <button class="btn btn-primary btn-sm" id="newPatientBtn">+ New patient</button>
    </div>
    <div class="stat-grid">
      ${statCard('teal', 'Total patients', stats.total, iconUsers)}
      ${statCard('indigo', 'Active', stats.active, iconPulse)}
      ${statCard('red', 'Critical', stats.critical, iconAlert)}
      ${statCard('amber', 'Clinical notes', stats.notes, iconNote)}
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><h3>Recent patients</h3><span class="sub">${patients.length} total</span></div>
        <div class="mini-list" id="recentList"></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Patients by department</h3></div>
        <div class="bars">
          ${stats.byDept.map((d) => `
            <div class="bar-row">
              <div class="bar-top"><span class="name">${esc(d.dept)}</span><span class="val">${d.c}</span></div>
              <div class="bar-track"><div class="bar-fill" style="width:${(d.c / maxDept) * 100}%"></div></div>
            </div>`).join('')}
        </div>
      </div>
    </div>
    <div class="card" style="margin-top:18px">
      <div class="card-head"><h3>Team message board</h3></div>
      <div id="msgPreview"></div>
    </div>
  `;

  const recent = document.getElementById('recentList');
  patients.slice(0, 5).forEach((p) => {
    const item = el(`<div class="mini-item" style="cursor:pointer">
      <div class="mini-ava" style="background:${avaColor(p.full_name)}">${initials(p.full_name)}</div>
      <div class="mini-body">
        <div class="t">${esc(p.full_name)} &nbsp;<span class="pill ${p.status}">${p.status}</span></div>
        <div class="s">${esc(p.mrn)} · ${esc(p.diagnosis)}</div>
      </div></div>`);
    item.addEventListener('click', () => openPatient(p.id));
    recent.appendChild(item);
  });

  // message board preview — rendered with innerHTML (XSS sink)
  const mp = document.getElementById('msgPreview');
  messages.slice(0, 3).forEach((m) => {
    mp.insertAdjacentHTML('beforeend', `<div class="msg">
      <div class="mini-ava" style="background:${avaColor(m.author)}">${initials(m.author)}</div>
      <div class="m-body"><div class="m-head"><strong>${m.author}</strong> · ${fmt(m.created_at)}</div>
      <div class="m-text">${m.body}</div></div></div>`);
  });

  document.getElementById('newPatientBtn').addEventListener('click', () => alert('Patient intake is disabled in the demo.'));
}

// ---- Patients ------------------------------------------------
async function viewPatients() {
  content.innerHTML = `
    <div class="page-head">
      <div><h1>Patients</h1><p>Browse and search the patient directory.</p></div>
    </div>
    <div class="card">
      <div class="card-head">
        <div class="inline-form" style="margin:0">
          <input id="patSearch" placeholder="Search by name, MRN or diagnosis…" style="min-width:280px" />
          <button class="btn btn-ghost btn-sm" id="patSearchBtn">Search</button>
        </div>
        <span class="sub" id="patCount"></span>
      </div>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Patient</th><th>MRN</th><th>DOB</th><th>Diagnosis</th><th>Status</th></tr></thead>
        <tbody id="patBody"><tr><td colspan="5" class="empty">Loading…</td></tr></tbody>
      </table></div>
    </div>`;
  document.getElementById('patSearchBtn').addEventListener('click', () => runPatientSearch(document.getElementById('patSearch').value));
  document.getElementById('patSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') runPatientSearch(e.target.value); });
  runPatientSearch('');
}

async function runPatientSearch(q) {
  const body = document.getElementById('patBody');
  if (!body) return;
  const patients = await api('/api/patients' + (q ? '?q=' + encodeURIComponent(q) : ''));
  document.getElementById('patCount').textContent = `${patients.length} patient${patients.length === 1 ? '' : 's'}`;
  if (!patients.length) { body.innerHTML = '<tr><td colspan="5" class="empty">No patients match your search.</td></tr>'; return; }
  body.innerHTML = '';
  patients.forEach((p) => {
    const tr = el(`<tr>
      <td><div class="name-cell"><span class="mini-ava" style="background:${avaColor(p.full_name)}">${initials(p.full_name)}</span><div><div style="font-weight:600">${esc(p.full_name)}</div><div class="s" style="font-size:12px;color:var(--text-mute)">${esc(p.gender || '')} · ${esc(p.blood_type || '—')}</div></div></div></td>
      <td class="mono">${esc(p.mrn)}</td>
      <td>${esc(p.dob || '—')}</td>
      <td>${esc(p.diagnosis || '—')}</td>
      <td><span class="pill ${p.status}">${p.status}</span></td>
    </tr>`);
    tr.addEventListener('click', () => openPatient(p.id));
    body.appendChild(tr);
  });
}

// ---- Patient drawer ------------------------------------------
async function openPatient(id) {
  const overlay = document.getElementById('drawerOverlay');
  const drawer = document.getElementById('patientDrawer');
  overlay.hidden = false; drawer.hidden = false;
  drawer.innerHTML = '<div class="loading">Loading chart…</div>';
  overlay.onclick = closeDrawer;

  const [p, notes] = await Promise.all([api('/api/patients/' + id), api('/api/patients/' + id + '/notes')]);

  drawer.innerHTML = `
    <div class="drawer-head">
      <div class="who">
        <div class="big-ava" style="background:${avaColor(p.full_name)}">${initials(p.full_name)}</div>
        <div><h2>${esc(p.full_name)}</h2><div class="mrn">${esc(p.mrn)} · <span class="pill ${p.status}">${p.status}</span></div></div>
      </div>
      <button class="icon-btn" id="closeDrawer" aria-label="Close">✕</button>
    </div>
    <div class="drawer-body">
      <div>
        <div class="section-title">Demographics</div>
        <div class="detail-grid">
          ${detail('Date of birth', p.dob)}${detail('Gender', p.gender)}
          ${detail('Blood type', p.blood_type)}${detail('Phone', p.phone)}
          ${detail('Insurance ID', p.insurance_id)}${detail('SSN', p.ssn)}
          ${detail('Address', p.address)}${detail('Diagnosis', p.diagnosis)}
        </div>
      </div>
      <div>
        <div class="section-title">Clinical notes (${notes.length})</div>
        <div id="notesWrap"></div>
        <form class="note-form" id="noteForm">
          <input id="noteBody" placeholder="Add a clinical note…" autocomplete="off" />
          <button class="btn btn-primary btn-sm" type="submit">Add</button>
        </form>
      </div>
    </div>`;

  document.getElementById('closeDrawer').addEventListener('click', closeDrawer);
  renderNotes(notes);

  document.getElementById('noteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('noteBody');
    if (!input.value.trim()) return;
    await api('/api/patients/' + id + '/notes', { method: 'POST', body: JSON.stringify({ body: input.value }) });
    input.value = '';
    renderNotes(await api('/api/patients/' + id + '/notes'));
  });
}

function renderNotes(notes) {
  const wrap = document.getElementById('notesWrap');
  if (!wrap) return;
  if (!notes.length) { wrap.innerHTML = '<div class="empty" style="padding:16px">No notes yet.</div>'; return; }
  // VULN #2 — note body injected as raw HTML.
  wrap.innerHTML = notes.map((n) => `
    <div class="note">
      <div class="n-head"><strong>${n.author}</strong><span>${fmt(n.created_at)}</span></div>
      <div class="n-body">${n.body}</div>
    </div>`).join('');
}

function closeDrawer() {
  document.getElementById('drawerOverlay').hidden = true;
  document.getElementById('patientDrawer').hidden = true;
}

// ---- Records -------------------------------------------------
async function viewRecords() {
  content.innerHTML = `
    <div class="page-head"><div><h1>Records &amp; files</h1><p>Lab results, imaging and clinical documents.</p></div></div>
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><h3>Available documents</h3></div>
        <div id="recList"></div>
      </div>
      <div class="card card-pad">
        <div class="section-title">Document viewer</div>
        <div class="inline-form">
          <input id="fileInput" placeholder="filename (e.g. ecg_100294.txt)" />
          <button class="btn btn-ghost btn-sm" id="openFileBtn">Open</button>
        </div>
        <div class="code-out" id="fileOut">Select a document to preview its contents.</div>
      </div>
    </div>`;

  const records = await api('/api/records');
  const list = document.getElementById('recList');
  if (!records.length) list.innerHTML = '<div class="empty">No records.</div>';
  records.forEach((r) => {
    const row = el(`<div class="file-row">
      <div class="file-ico">${iconFile}</div>
      <div class="file-meta"><div class="t">${esc(r.title)}</div><div class="s">${esc(r.kind)} · ${esc(r.filename)}</div></div>
      <button class="btn btn-ghost btn-sm">Open</button></div>`);
    row.querySelector('button').addEventListener('click', () => loadFile(r.filename));
    list.appendChild(row);
  });

  document.getElementById('openFileBtn').addEventListener('click', () => loadFile(document.getElementById('fileInput').value));
}

async function loadFile(file) {
  document.getElementById('fileInput').value = file;
  const out = document.getElementById('fileOut');
  out.textContent = 'Loading…';
  // VULN #7 — filename passed straight to the server download endpoint.
  const res = await fetch('/api/records/download?file=' + encodeURIComponent(file), { credentials: 'include' });
  const text = await res.text();
  out.textContent = text;
}

// ---- Messages ------------------------------------------------
async function viewMessages() {
  content.innerHTML = `
    <div class="page-head"><div><h1>Messages</h1><p>Broadcast board for the care team.</p></div></div>
    <div class="card">
      <div class="card-pad" style="border-bottom:1px solid var(--border)">
        <form class="msg-form inline-form" id="msgForm" style="margin:0">
          <input id="msgBody" placeholder="Post a message to the team…" autocomplete="off" />
          <button class="btn btn-primary btn-sm" type="submit">Post</button>
        </form>
      </div>
      <div id="msgList"></div>
    </div>`;
  await renderMessages();
  document.getElementById('msgForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('msgBody');
    if (!input.value.trim()) return;
    await api('/api/messages', { method: 'POST', body: JSON.stringify({ body: input.value }) });
    input.value = '';
    await renderMessages();
  });
}

async function renderMessages() {
  const list = document.getElementById('msgList');
  const msgs = await api('/api/messages');
  if (!msgs.length) { list.innerHTML = '<div class="empty">No messages yet.</div>'; return; }
  // VULN #2 — message body rendered as raw HTML.
  list.innerHTML = msgs.map((m) => `
    <div class="msg">
      <div class="mini-ava" style="background:${avaColor(m.author)}">${initials(m.author)}</div>
      <div class="m-body"><div class="m-head"><strong>${m.author}</strong> · ${fmt(m.created_at)}</div>
      <div class="m-text">${m.body}</div></div>
    </div>`).join('');
}

// ---- Appointments --------------------------------------------
async function viewAppointments() {
  content.innerHTML = `
    <div class="page-head">
      <div><h1>Appointments</h1><p>Upcoming visits and telehealth sessions.</p></div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><h3>Schedule</h3><span class="sub" id="apCount"></span></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>When</th><th>Patient</th><th>Reason</th><th>Location</th><th>Status</th><th></th></tr></thead>
          <tbody id="apBody"><tr><td colspan="6" class="empty">Loading…</td></tr></tbody>
        </table></div>
      </div>
      <div class="card card-pad">
        <div class="section-title">Book appointment</div>
        <form id="apForm" style="display:grid;gap:8px">
          <input id="apPatient" type="number" placeholder="Patient id (e.g. 1)" value="1" />
          <input id="apWhen" type="datetime-local" />
          <input id="apReason" placeholder="Reason for visit" />
          <select id="apLocation" style="padding:10px 12px;border:1px solid var(--border-strong);border-radius:10px;font-size:14px">
            <option>Clinic</option><option>Telehealth</option><option>Day Unit</option>
          </select>
          <button class="btn btn-primary btn-sm" type="submit">Book</button>
        </form>
      </div>
    </div>`;

  await renderAppointments();

  document.getElementById('apForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const when = document.getElementById('apWhen').value;
    if (!when) return;
    await api('/api/appointments', {
      method: 'POST',
      body: JSON.stringify({
        patient_id: Number(document.getElementById('apPatient').value),
        starts_at: new Date(when).toISOString(),
        reason: document.getElementById('apReason').value,
        location: document.getElementById('apLocation').value,
      }),
    });
    document.getElementById('apForm').reset();
    document.getElementById('apPatient').value = '1';
    await renderAppointments();
  });
}

async function renderAppointments() {
  const body = document.getElementById('apBody');
  const [appts, patients] = await Promise.all([api('/api/appointments'), api('/api/patients')]);
  const names = Object.fromEntries(patients.map((p) => [p.id, p.full_name]));
  document.getElementById('apCount').textContent = `${appts.length} visit${appts.length === 1 ? '' : 's'}`;
  if (!appts.length) { body.innerHTML = '<tr><td colspan="6" class="empty">No appointments.</td></tr>'; return; }
  body.innerHTML = '';
  appts.forEach((a) => {
    const telehealth = (a.location || '').toLowerCase() === 'telehealth';
    // telehealth "join" goes through the server redirect endpoint
    const joinHref = `/api/appointments/${a.id}/join?next=` +
      encodeURIComponent('https://meet.medicore.test/room/' + a.id);
    const tr = el(`<tr>
      <td>${esc(fmt(a.starts_at))}</td>
      <td>${esc(names[a.patient_id] || ('Patient #' + a.patient_id))}</td>
      <td>${esc(a.reason || '—')}</td>
      <td>${esc(a.location || '—')}</td>
      <td><span class="pill ${a.status === 'cancelled' ? 'discharged' : 'active'}">${esc(a.status)}</span></td>
      <td style="text-align:right;white-space:nowrap">
        ${telehealth && a.status !== 'cancelled' ? `<a class="btn btn-ghost btn-sm" href="${joinHref}" target="_blank" rel="noopener">Join</a>` : ''}
        ${a.status !== 'cancelled' ? `<button class="btn btn-ghost btn-sm js-cancel" data-id="${a.id}">Cancel</button>` : ''}
      </td>
    </tr>`);
    const cancelBtn = tr.querySelector('.js-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      await api('/api/appointments/' + cancelBtn.dataset.id + '/cancel', { method: 'POST' });
      await renderAppointments();
    });
    body.appendChild(tr);
  });
}

// ---- Admin ---------------------------------------------------
async function viewAdmin() {
  content.innerHTML = `
    <div class="page-head"><div><h1>Administration</h1><p>User management and system diagnostics.</p></div></div>
    <div class="tool-grid">
      <div class="card">
        <div class="card-head"><h3>User accounts</h3></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Department</th></tr></thead>
          <tbody id="userBody"><tr><td colspan="4" class="empty">Loading…</td></tr></tbody>
        </table></div>
      </div>
      <div class="card card-pad">
        <div class="section-title">Network diagnostics</div>
        <p style="font-size:13px;color:var(--text-soft);margin:0 0 6px">Ping a host to verify connectivity.</p>
        <form class="inline-form" id="pingForm">
          <input id="pingHost" placeholder="127.0.0.1" value="127.0.0.1" />
          <button class="btn btn-ghost btn-sm" type="submit">Run</button>
        </form>
        <div class="code-out" id="pingOut">Output will appear here.</div>
      </div>
    </div>`;

  // VULN #9 — admin data loaded regardless of role.
  const users = await api('/api/admin/users');
  const body = document.getElementById('userBody');
  body.innerHTML = '';
  users.forEach((u) => {
    body.appendChild(el(`<tr>
      <td><div class="name-cell"><span class="mini-ava" style="background:${avaColor(u.full_name)}">${initials(u.full_name)}</span><span style="font-weight:600">${esc(u.full_name)}</span></div></td>
      <td class="mono">${esc(u.username)}</td>
      <td style="text-transform:capitalize">${esc(u.role)}</td>
      <td>${esc(u.department || '—')}</td>
    </tr>`));
  });

  document.getElementById('pingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = document.getElementById('pingOut');
    out.textContent = 'Running…';
    const r = await api('/api/admin/network-check', { method: 'POST', body: JSON.stringify({ host: document.getElementById('pingHost').value }) });
    out.textContent = '$ ' + r.command + '\n\n' + (r.output || r.error || '');
  });
}

// ---- helpers / icons -----------------------------------------
function statCard(tone, label, val, icon) {
  return `<div class="card stat-card"><div class="stat-ico ${tone}">${icon}</div><div><div class="stat-val">${val}</div><div class="stat-label">${label}</div></div></div>`;
}
function detail(label, val) { return `<div><div class="d-label">${label}</div><div class="d-val">${esc(val || '—')}</div></div>`; }
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function fmt(iso) { try { return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return iso; } }

const iconUsers = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c0-3 2.8-5 5.5-5s5.5 2 5.5 5"/><path d="M16 7.5a3 3 0 0 1 0 5.5M18 19c0-2-1-3.3-2.5-4.3"/></svg>';
const iconPulse = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h4l2-6 4 12 2-6h6"/></svg>';
const iconAlert = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3 2 20h20z"/><path d="M12 10v5M12 17.5v.5"/></svg>';
const iconNote = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 15h4"/></svg>';
const iconFile = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></svg>';
