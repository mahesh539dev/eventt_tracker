import { addExpense, createEvent, deleteExpense, getEvent, updateEvent, updateExpense } from '../api.js';
import { formatCents, parseToCents } from '../money.js';
import { qs, toast } from '../ui.js';
import { renderEventList } from './eventList.js';

export async function renderEventForm(container, eventId) {
  const event = eventId ? await getEvent(eventId) : null;

  container.innerHTML = `
    <form id="event-form" class="card">
      <button type="button" id="back">&larr; Back</button>
      <label>Customer name<input name="customerName" required value="${event?.customerName ?? ''}" /></label>
      <label>Phone<input name="customerPhone" value="${event?.customerPhone ?? ''}" /></label>
      <label>Event date<input type="date" name="eventDate" required value="${event?.eventDate ?? ''}" /></label>
      <label>Event type<input name="eventType" required value="${event?.eventType ?? ''}" /></label>
      <label>Decor style
        <select name="decorStyle" required>
          ${['indian_traditional', 'balloon', 'both']
            .map((v) => `<option value="${v}" ${event?.decorStyle === v ? 'selected' : ''}>${v}</option>`)
            .join('')}
        </select>
      </label>
      <label>Job type
        <select name="jobType" required>
          ${['rental', 'service']
            .map((v) => `<option value="${v}" ${event?.jobType === v ? 'selected' : ''}>${v}</option>`)
            .join('')}
        </select>
      </label>
      <label>Price<input name="price" type="number" step="0.01" required value="${event ? event.priceCents / 100 : ''}" /></label>
      <label>Deposit amount<input name="deposit" type="number" step="0.01" value="${event ? event.depositCents / 100 : ''}" /></label>
      <label>Deposit paid on<input type="date" name="depositPaidOn" value="${event?.depositPaidOn ?? ''}" /></label>
      <label>Rest amount<input name="rest" type="number" step="0.01" value="${event ? event.restCents / 100 : ''}" /></label>
      <label>Rest paid on<input type="date" name="restPaidOn" value="${event?.restPaidOn ?? ''}" /></label>
      ${event ? `<p>Due: ${formatCents(event.dueCents)}</p>` : ''}
      ${
        event
          ? `<label>Status
          <select name="status">
            <option value="outstanding" ${event.status === 'outstanding' ? 'selected' : ''}>Outstanding</option>
            <option value="done" ${event.status === 'done' ? 'selected' : ''}>Done</option>
          </select>
          ${event.statusIsManual ? '<button type="button" id="reset-status">Reset to automatic</button>' : '<em>Automatic</em>'}
        </label>`
          : ''
      }
      <label>Notes<textarea name="notes">${event?.notes ?? ''}</textarea></label>
      <button type="submit">${event ? 'Save' : 'Create'}</button>
    </form>
    ${event ? '<div id="expenses" class="card"></div>' : ''}
  `;

  qs('#back', container).addEventListener('click', () => renderEventList(container));

  if (event) {
    renderExpenses(qs('#expenses', container), event);
    const resetBtn = qs('#reset-status', container);
    if (resetBtn) {
      resetBtn.addEventListener('click', async () => {
        await updateEvent(event.id, { resetStatusToAutomatic: true });
        toast('Status reset to automatic');
        renderEventForm(container, event.id);
      });
    }
  }

  qs('#event-form', container).addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const payload = {
      customerName: form.get('customerName'),
      customerPhone: form.get('customerPhone') || null,
      eventDate: form.get('eventDate'),
      eventType: form.get('eventType'),
      decorStyle: form.get('decorStyle'),
      jobType: form.get('jobType'),
      priceCents: parseToCents(form.get('price')),
      depositCents: parseToCents(form.get('deposit') || '0'),
      depositPaidOn: form.get('depositPaidOn') || null,
      restCents: parseToCents(form.get('rest') || '0'),
      restPaidOn: form.get('restPaidOn') || null,
      notes: form.get('notes'),
    };
    if (event) payload.status = form.get('status');
    try {
      if (event) {
        await updateEvent(event.id, payload);
        toast('Event saved');
      } else {
        const created = await createEvent(payload);
        toast('Event created');
        return renderEventForm(container, created.id);
      }
      renderEventForm(container, event.id);
    } catch (err) {
      toast(err.message);
    }
  });
}

function renderExpenses(el, event) {
  el.innerHTML = `
    <h3>Expenses</h3>
    <ul id="expense-list">
      ${event.expenses
        .map(
          (x) => `<li data-id="${x.id}">${x.spentOn} — ${formatCents(x.amountCents)} — ${x.note}
          <button class="delete-expense">x</button></li>`,
        )
        .join('')}
    </ul>
    <p>Total expenses: ${formatCents(event.totalExpensesCents)} | Final amount: ${formatCents(event.finalAmountCents)}</p>
    <form id="expense-form">
      <input name="amount" type="number" step="0.01" placeholder="Amount" required />
      <input name="note" placeholder="Note (e.g. where bought)" />
      <input name="spentOn" type="date" required />
      <button type="submit">Add expense</button>
    </form>
  `;

  el.querySelectorAll('.delete-expense').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.closest('li').dataset.id;
      await deleteExpense(event.id, id);
      const refreshed = await (await import('../api.js')).getEvent(event.id);
      renderExpenses(el, refreshed);
    });
  });

  qs('#expense-form', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    await addExpense(event.id, {
      amountCents: parseToCents(form.get('amount')),
      note: form.get('note') || '',
      spentOn: form.get('spentOn'),
    });
    const refreshed = await (await import('../api.js')).getEvent(event.id);
    renderExpenses(el, refreshed);
  });
}
