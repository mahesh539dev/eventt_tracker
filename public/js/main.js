import { login } from './api.js';
import { qs, toast } from './ui.js';
import { renderEventList } from './views/eventList.js';
import { renderReportView } from './views/reportView.js';

function renderShell() {
  const app = qs('#app');
  app.innerHTML = `
    <nav class="card">
      <button id="nav-events">Events</button>
      <button id="nav-reports">Reports</button>
    </nav>
    <div id="screen"></div>
  `;
  const screen = qs('#screen');
  qs('#nav-events').addEventListener('click', () => renderEventList(screen));
  qs('#nav-reports').addEventListener('click', () => renderReportView(screen));
  renderEventList(screen);
}

async function boot() {
  const app = qs('#app');
  app.innerHTML = `
    <form id="login-form" class="card">
      <h1>Event Decor Tracker</h1>
      <input type="password" id="password" placeholder="Password" required />
      <button type="submit">Log in</button>
    </form>
  `;
  qs('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await login(qs('#password').value);
      renderShell();
    } catch (err) {
      toast(err.message);
    }
  });
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

boot();
