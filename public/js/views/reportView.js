import { getReport } from '../api.js';
import { currentMonthStr } from '../dates.js';
import { formatCents } from '../money.js';
import { esc, qs } from '../ui.js';

const CAT_ICONS = { transport: '🚗', materials: '🧱', labour: '👷', utilities: '💡', marketing: '📣', other: '📦' };

export async function renderReportView(container) {
  container.innerHTML = `
    <div class="card">
      <h3>📊 Reports</h3>
      <div class="report-mode-bar">
        <label><input type="radio" name="mode" value="month" checked /> Month</label>
        <input type="month" id="month" value="${currentMonthStr()}" style="width:auto;margin:0" />
        <label><input type="radio" name="mode" value="range" /> Range</label>
        <input type="date" id="from" disabled style="width:auto;margin:0" />
        <input type="date" id="to" disabled style="width:auto;margin:0" />
      </div>
    </div>
    <div id="report"></div>
  `;

  function setMode(mode) {
    qs('#month', container).disabled = mode !== 'month';
    qs('#from', container).disabled = mode !== 'range';
    qs('#to', container).disabled = mode !== 'range';
  }

  container.querySelectorAll('input[name="mode"]').forEach((r) =>
    r.addEventListener('change', (e) => { setMode(e.target.value); load(); }),
  );
  qs('#month', container).addEventListener('change', load);
  qs('#from', container).addEventListener('change', load);
  qs('#to', container).addEventListener('change', load);

  async function load() {
    const mode = container.querySelector('input[name="mode"]:checked').value;
    const query =
      mode === 'month'
        ? { month: qs('#month', container).value }
        : { from: qs('#from', container).value, to: qs('#to', container).value };
    if (mode === 'range' && (!query.from || !query.to)) return;
    qs('#report', container).innerHTML = `<div class="card" style="text-align:center;padding:28px;color:var(--text-muted)">Loading report…</div>`;
    try {
      const report = await getReport(query);
      renderReport(qs('#report', container), report);
    } catch (err) {
      qs('#report', container).innerHTML = `<div class="card" style="color:var(--danger)">${esc(err.message)}</div>`;
    }
  }

  function breakdownRows(obj) {
    return Object.entries(obj)
      .map(([k, b]) => `
        <li class="breakdown-row">
          <div class="breakdown-row-head">
            <span class="breakdown-row-name">${esc(k)}</span>
          </div>
          <div class="breakdown-cols">
            <div class="breakdown-col">
              <div class="breakdown-col-label">Revenue</div>
              <div class="breakdown-col-val">${formatCents(b.revenueCents)}</div>
            </div>
            <div class="breakdown-col">
              <div class="breakdown-col-label">Collected</div>
              <div class="breakdown-col-val">${formatCents(b.collectedCents)}</div>
            </div>
            <div class="breakdown-col">
              <div class="breakdown-col-label">Expenses</div>
              <div class="breakdown-col-val">${formatCents(b.expensesCents)}</div>
            </div>
            <div class="breakdown-col">
              <div class="breakdown-col-label">Profit</div>
              <div class="breakdown-col-val ${b.profitCents >= 0 ? 'pos' : 'neg'}" style="font-weight:800">${formatCents(b.profitCents)}</div>
            </div>
          </div>
        </li>`)
      .join('');
  }

  function renderReport(el, report) {
    const t = report.totals;
    const profitClass = t.profitCents >= 0 ? 'pos' : 'neg';

    el.innerHTML = `
      <div class="stat-grid">
        <div class="stat-tile accent">
          <div class="stat-label">💰 Revenue</div>
          <div class="stat-val">${formatCents(t.revenueCents)}</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">✅ Collected</div>
          <div class="stat-val">${formatCents(t.collectedCents)}</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">⏳ Outstanding</div>
          <div class="stat-val">${formatCents(t.outstandingCents)}</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">💸 Expenses</div>
          <div class="stat-val">${formatCents(t.expensesCents)}</div>
        </div>
      </div>

      <div class="card" style="border: 2px solid ${t.profitCents >= 0 ? 'var(--ok-fg)' : 'var(--danger)'}20">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <div class="stat-label" style="margin-bottom:4px">Net Profit</div>
            <div style="font-size:2rem;font-weight:800;letter-spacing:-0.03em" class="${profitClass}">${formatCents(t.profitCents)}</div>
          </div>
          <div style="font-size:3rem">${t.profitCents >= 0 ? '🎉' : '📉'}</div>
        </div>
      </div>

      ${Object.keys(report.byJobType).length ? `
      <div class="card">
        <h3>By job type</h3>
        <ul class="breakdown-list">${breakdownRows(report.byJobType)}</ul>
      </div>` : ''}

      ${Object.keys(report.byEventType).length ? `
      <div class="card">
        <h3>By event type</h3>
        <ul class="breakdown-list">${breakdownRows(report.byEventType)}</ul>
      </div>` : ''}

      ${report.events.length ? `
      <div class="card">
        <h3>Events (${report.events.length})</h3>
        <ul>
          ${report.events.map((e) => `
            <li>
              <div style="flex:1;min-width:0">
                <div style="font-weight:700;font-size:0.95rem">${esc(e.customerName)}</div>
                <div style="font-size:0.8rem;color:var(--text-muted)">${e.eventDate} · ${esc(e.eventType)}</div>
              </div>
              <div style="text-align:right">
                <div style="font-weight:700">${formatCents(e.priceCents)}</div>
                <span class="pill ${e.status}" style="font-size:0.65rem">${e.status}</span>
              </div>
            </li>`).join('')}
        </ul>
      </div>` : ''}

      ${report.globalExpenses && report.globalExpenses.length ? `
      <div class="card">
        <h3>General expenses (${report.globalExpenses.length})</h3>
        ${report.globalExpenses.map((x) => `
          <div class="ge-report-row">
            <span class="pill done" style="font-size:0.68rem;padding:2px 8px">${CAT_ICONS[x.category] || ''} ${esc(x.category)}</span>
            <span style="font-weight:700">${formatCents(x.amountCents)}</span>
            <span style="color:var(--text-muted);font-size:0.82rem">${x.spentOn}</span>
            ${x.note ? `<span style="color:var(--text-muted);font-size:0.82rem">${esc(x.note)}</span>` : ''}
            ${x.eventName ? `<span class="expense-event-badge">🗓 ${esc(x.eventName)}</span>` : ''}
          </div>`).join('')}
        <div style="font-weight:700;padding-top:10px;border-top:1px solid var(--border);margin-top:4px">
          Total: ${formatCents(report.globalExpensesCents)}
        </div>
      </div>` : ''}
    `;
  }

  await load();
}
