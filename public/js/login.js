// MediCore — login page logic
const form = document.getElementById('loginForm');
const errBox = document.getElementById('loginError');
const btn = document.getElementById('loginBtn');

// Show/hide password
const pw = document.getElementById('password');
document.getElementById('togglePw').addEventListener('click', (e) => {
  const on = pw.type === 'password';
  pw.type = on ? 'text' : 'password';
  e.target.textContent = on ? 'Hide' : 'Show';
});

// Demo credential chips
document.querySelectorAll('.chip').forEach((c) => {
  c.addEventListener('click', () => {
    document.getElementById('username').value = c.dataset.u;
    pw.value = c.dataset.p;
  });
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errBox.hidden = true;
  btn.disabled = true;
  btn.querySelector('span').textContent = 'Signing in…';

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('username').value,
        password: pw.value,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');

    // token is also stored client-side (cookie set by server)
    try { localStorage.setItem('medicore_user', JSON.stringify(data.user)); } catch {}
    window.location.href = '/app.html';
  } catch (err) {
    errBox.textContent = err.message;
    errBox.hidden = false;
  } finally {
    btn.disabled = false;
    btn.querySelector('span').textContent = 'Sign in';
  }
});
