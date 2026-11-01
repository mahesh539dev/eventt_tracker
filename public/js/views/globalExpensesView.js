import { addGlobalExpense, deleteGlobalExpense, listEvents, listGlobalExpenses } from '../api.js';
import { formatCents, parseToCents } from '../money.js';
import { esc, qs, toast } from '../ui.js';

const CATEGORIES = ['transport', 'materials', 'labour', 'utilities', 'marketing', 'other'];

const CAT_ICONS = { transport: '🚗', materials: '🧱', labour: '👷', utilities: '💡', marketing: '📣', other: '📦' };

export async function renderGlobalExpensesView(container) {
  container.innerHTML = `
    <div class="card">
      <h3>💸 Expenses</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <label style="flex:1;min-width:120px;margin:0">From<input type="date" id="ge-from" /></label>
        <label style="flex:1;min-width:120px;margin:0">To<input type="date" id="ge-to" /></label>
      </div>
    </div>
    <div id="ge-summary" class="stat-grid"></div>
    <div class="card">
      <h3>All expenses</h3>
      <div id="ge-list"><p style="color:var(--text-muted);font-size:0.9rem">Loading…</p></div>
      <p id="ge-total" style="font-weight:700;margin:8px 0 0"></p>
    </div>
    <div class="card">
      <h3>➕ Add expense</h3>
      <form id="ge-form">
        <label>Category
          <select name="category">
            ${CATEGORIES.map((c) => `<option value="${c}">${CAT_ICONS[c] || ''} ${c}</option>`).join('')}
          </select>
        </label>
        <label>Amount<input name="amount" type="number" step="0.01" placeholder="0.00" required /></label>
        <label>Date<input name="spentOn" type="date" required /></label>
        <label>Note<input name="note" placeholder="Optional description" /></label>
        <label>For event (optional)
          <select name="eventId" id="ge-event-select">
            <option value="">— None (general expense) —</option>
          </select>
        </label>
        <button type="submit">Add expense</button>
      </form>
    </div>
  `;

  async function loadEventOptions() {
    try {
      const events = await listEvents({});
      const sel = qs('#ge-event-select', container);
      events.forEach((e) => {
        const opt = document.createElement('option');
        opt.value = e.id;
        opt.textContent = `${e.customerName} · ${e.eventDate} · ${e.eventType}`;
        sel.appendChild(opt);
      });
    } catch { /* non-critical */ }
  }

  async function load() {
    const from = qs('#ge-from', container).value || undefined;
    const to = qs('#ge-to', container).value || undefined;
    try {
      const items = await listGlobalExpenses(from || to ? { ...(from && { from }), ...(to && { to }) } : {});
      renderSummary(items);
      renderList(items);
    } catch (err) {
      toast(err.message);
    }
  }

  function renderSummary(items) {
    const total = items.reduce((s, x) => s + x.amountCents, 0);
    const byCat = {};
    items.forEach((x) => { byCat[x.category] = (byCat[x.category] || 0) + x.amountCents; });
    const topCat = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];

    qs('#ge-summary', container).innerHTML = `
      <div class="stat-tile accent">
        <div class="stat-label">Total Spent</div>
        <div class="stat-val">${formatCents(total)}</div>
      </div>
      <div class="stat-tile">
        <div class="stat-label">Top Category</div>
        <div class="stat-val" style="font-size:1rem">${topCat ? (CAT_ICONS[topCat[0]] || '') + ' ' + topCat[0] : '—'}</div>
      </div>
    `;
  }

  function renderList(items) {
    const list = qs('#ge-list', container);
    const total = qs('#ge-total', container);
    if (!items.length) {
      list.innerHTML = `<div style="text-align:center;padding:20px 0;color:var(--text-muted)">
        <div style="font-size:2rem;margin-bottom:8px">📭</div>
        <div style="font-size:0.9rem">No expenses yet</div>
      </div>`;
      total.textContent = '';
      return;
    }
    const sum = items.reduce((s, x) => s + x.amountCents, 0);
    list.innerHTML = `
      <ul id="expense-list">
        ${items
          .map(
            (x) => `<li data-id="${x.id}" style="flex-direction:column;align-items:stretch;gap:4px">
              <div style="display:flex;align-items:center;gap:8px">
                <span class="pill done" style="font-size:0.7rem;padding:2px 10px">${CAT_ICONS[x.category] || ''} ${esc(x.category)}</span>
                <span style="font-weight:700;margin-left:auto">${formatCents(x.amountCents)}</span>
                <button class="delete-expense" data-id="${x.id}" title="Delete">✕</button>
              </div>
              <div style="font-size:0.82rem;color:var(--text-muted);display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                <span>📅 ${x.spentOn}</span>
                ${x.note ? `<span>· ${esc(x.note)}</span>` : ''}
                ${x.eventName ? `<span class="expense-event-badge">🗓 ${esc(x.eventName)}</span>` : ''}
              </div>
            </li>`,
          )
          .join('')}
      </ul>
    `;
    total.textContent = `Total: ${formatCents(sum)}`;

    list.querySelectorAll('.delete-expense').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const id = e.target.dataset.id;
        try {
          await deleteGlobalExpense(id);
          toast('Expense deleted');
          await load();
        } catch (err) {
          toast(err.message);
        }
      });
    });
  }

  qs('#ge-from', container).addEventListener('change', load);
  qs('#ge-to', container).addEventListener('change', load);

  qs('#ge-form', container).addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const eventId = form.get('eventId') || null;
    try {
      await addGlobalExpense({
        amountCents: parseToCents(form.get('amount')),
        category: form.get('category'),
        note: form.get('note') || '',
        spentOn: form.get('spentOn'),
        eventId,
      });
      toast('Expense added');
      e.target.reset();
      await load();
    } catch (err) {
      toast(err.message);
    }
  });

  await Promise.all([loadEventOptions(), load()]);
}
