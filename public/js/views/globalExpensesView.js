import { addGlobalExpense, deleteGlobalExpense, listGlobalExpenses } from '../api.js';
import { formatCents, parseToCents } from '../money.js';
import { esc, qs, toast } from '../ui.js';

const CATEGORIES = ['transport', 'materials', 'labour', 'utilities', 'marketing', 'other'];

export async function renderGlobalExpensesView(container) {
  container.innerHTML = `
    <div class="card">
      <h3>Global Expenses</h3>
      <div id="ge-filters" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:var(--gap)">
        <label style="flex:1;min-width:120px">From<input type="date" id="ge-from" /></label>
        <label style="flex:1;min-width:120px">To<input type="date" id="ge-to" /></label>
      </div>
      <div id="ge-list"><p style="color:var(--text-muted);font-size:0.9rem">Loading…</p></div>
      <p id="ge-total" style="font-weight:700;margin:0 0 var(--gap)"></p>
    </div>
    <div class="card">
      <h3>Add expense</h3>
      <form id="ge-form">
        <label>Category
          <select name="category">
            ${CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join('')}
          </select>
        </label>
        <label>Amount<input name="amount" type="number" step="0.01" placeholder="0.00" required /></label>
        <label>Date<input name="spentOn" type="date" required /></label>
        <label>Note<input name="note" placeholder="Optional description" /></label>
        <button type="submit">Add expense</button>
      </form>
    </div>
  `;

  async function load() {
    const from = qs('#ge-from', container).value || undefined;
    const to = qs('#ge-to', container).value || undefined;
    try {
      const items = await listGlobalExpenses(from || to ? { ...(from && { from }), ...(to && { to }) } : {});
      renderList(items);
    } catch (err) {
      toast(err.message);
    }
  }

  function renderList(items) {
    const list = qs('#ge-list', container);
    const total = qs('#ge-total', container);
    if (!items.length) {
      list.innerHTML = '<p style="color:var(--text-muted);font-size:0.9rem">No expenses yet.</p>';
      total.textContent = '';
      return;
    }
    const sum = items.reduce((s, x) => s + x.amountCents, 0);
    list.innerHTML = `
      <ul id="expense-list">
        ${items
          .map(
            (x) => `<li data-id="${x.id}">
              <span class="pill done" style="font-size:0.72rem;padding:2px 8px">${esc(x.category)}</span>
              ${x.spentOn} — ${formatCents(x.amountCents)}${x.note ? ` — ${esc(x.note)}` : ''}
              <button class="delete-expense" data-id="${x.id}">x</button>
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
    try {
      await addGlobalExpense({
        amountCents: parseToCents(form.get('amount')),
        category: form.get('category'),
        note: form.get('note') || '',
        spentOn: form.get('spentOn'),
      });
      toast('Expense added');
      e.target.reset();
      await load();
    } catch (err) {
      toast(err.message);
    }
  });

  await load();
}
