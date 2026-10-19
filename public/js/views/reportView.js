import { getReport } from '../api.js';
import { currentMonthStr } from '../dates.js';
import { formatCents } from '../money.js';
import { qs } from '../ui.js';

export async function renderReportView(container) {
  container.innerHTML = `
    <div class="card">
      <label><input type="radio" name="mode" value="month" checked /> Month</label>
      <input type="month" id="month" value="${currentMonthStr()}" />
      <label><input type="radio" name="mode" value="range" /> Custom range</label>
      <input type="date" id="from" disabled />
      <input type="date" id="to" disabled />
    </div>
    <div id="report"></div>
  `;

  function setMode(mode) {
    qs('#month', container).disabled = mode !== 'month';
    qs('#from', container).disabled = mode !== 'range';
    qs('#to', container).disabled = mode !== 'range';
  }

  container.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', (e) => { setMode(e.target.value); load(); }));
  qs('#month', container).addEventListener('change', load);
  qs('#from', container).addEventListener('change', load);
  qs('#to', container).addEventListener('change', load);

  async function load() {
    const mode = container.querySelector('input[name="mode"]:checked').value;
    const query = mode === 'month' ? { month: qs('#month', container).value } : { from: qs('#from', container).value, to: qs('#to', container).value };
    if (mode === 'range' && (!query.from || !query.to)) return;
    const report = await getReport(query);
    renderReport(qs('#report', container), report);
  }

  function renderReport(el, report) {
    const row = (label, b) => `
      <tr><td>${label}</td><td>${formatCents(b.revenueCents)}</td><td>${formatCents(b.collectedCents)}</td><td>${formatCents(b.expensesCents)}</td><td>${formatCents(b.profitCents)}</td></tr>`;

    el.innerHTML = `
      <div class="card">
        <h3>Totals</h3>
        <p>Revenue: ${formatCents(report.totals.revenueCents)}</p>
        <p>Collected: ${formatCents(report.totals.collectedCents)}</p>
        <p>Expenses: ${formatCents(report.totals.expensesCents)}</p>
        <p>Profit: ${formatCents(report.totals.profitCents)}</p>
        <p>Outstanding: ${formatCents(report.totals.outstandingCents)}</p>
      </div>
      <div class="card">
        <h3>By job type</h3>
        <table>
          <tr><th></th><th>Revenue</th><th>Collected</th><th>Expenses</th><th>Profit</th></tr>
          ${Object.entries(report.byJobType).map(([k, b]) => row(k, b)).join('')}
        </table>
      </div>
      <div class="card">
        <h3>By event type</h3>
        <table>
          <tr><th></th><th>Revenue</th><th>Collected</th><th>Expenses</th><th>Profit</th></tr>
          ${Object.entries(report.byEventType).map(([k, b]) => row(k, b)).join('')}
        </table>
      </div>
      <div class="card">
        <h3>Events (${report.events.length})</h3>
        <ul>
          ${report.events.map((e) => `<li>${e.eventDate} — ${e.customerName} — ${formatCents(e.priceCents)} — <span class="pill ${e.status}">${e.status}</span></li>`).join('')}
        </ul>
      </div>
    `;
  }

  await load();
}
