import { checkAuth, login, logout } from './api.js';
import { qs, toast } from './ui.js';
import { renderEventList } from './views/eventList.js';
import { renderGlobalExpensesView } from './views/globalExpensesView.js';
import { renderReportView } from './views/reportView.js';

let activeTab = 'events';

function setActiveTab(name) {
  activeTab = name;
  document.querySelectorAll('.tab-btn[data-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === name);
  });
}

async function switchScreen(name, screen) {
  setActiveTab(name);
  screen.innerHTML = '';
  screen.classList.remove('screen-enter');
  void screen.offsetWidth;
  screen.classList.add('screen-enter');
  if (name === 'events') await renderEventList(screen);
  else if (name === 'expenses') await renderGlobalExpensesView(screen);
  else if (name === 'reports') await renderReportView(screen);
}

function renderShell() {
  const app = qs('#app');
  app.innerHTML = `
    <div id="screen"></div>
    <nav class="tab-bar">
      <button class="tab-btn active" data-tab="events">
        <span class="tab-icon">🗓</span>Events
      </button>
      <button class="tab-btn" data-tab="expenses">
        <span class="tab-icon">💸</span>Expenses
      </button>
      <button class="tab-btn" data-tab="reports">
        <span class="tab-icon">📊</span>Reports
      </button>
      <button class="tab-btn tab-logout" id="nav-logout">
        <span class="tab-icon">🚪</span>Out
      </button>
    </nav>
  `;

  const screen = qs('#screen');
  document.querySelectorAll('.tab-btn[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchScreen(btn.dataset.tab, screen));
  });

  qs('#nav-logout').addEventListener('click', async () => {
    try { await logout(); } catch { /* ignore */ }
    boot();
  });

  switchScreen('events', screen);
}

async function boot() {
  const app = qs('#app');
  app.innerHTML = `
    <form id="login-form" class="card">
      <h1>Event Decor Tracker</h1>
      <p class="login-subtitle">Manage your events & finances</p>
      <label>Password<input type="password" id="password" placeholder="Enter password" required /></label>
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

async function init() {
  try {
    await checkAuth();
    renderShell();
  } catch {
    boot();
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

init();
