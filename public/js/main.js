import { login, logout } from './api.js';
import { qs, toast } from './ui.js';

async function boot() {
  const app = qs('#app');
  app.innerHTML = `
    <form id="login-form">
      <h1>Event Decor Tracker</h1>
      <input type="password" id="password" placeholder="Password" required />
      <button type="submit">Log in</button>
    </form>
  `;
  qs('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await login(qs('#password').value);
      location.reload();
    } catch (err) {
      toast(err.message);
    }
  });
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

boot();
