import { addExpense, createEvent, deleteEvent, deleteExpense, getEvent, listPhotos, uploadPhoto, deletePhoto, updateEvent, updateExpense } from '../api.js';
import { formatCents, parseToCents } from '../money.js';
import { esc, qs, toast } from '../ui.js';
import { renderEventList } from './eventList.js';

const DECOR_LABELS = { indian_traditional: '🪔 Indian Traditional', balloon: '🎈 Balloon', both: '✨ Both' };
const JOB_LABELS = { rental: '📦 Rental', service: '🛠 Service' };

export async function renderEventForm(container, eventId) {
  const event = eventId ? await getEvent(eventId) : null;

  container.innerHTML = `
    <div class="card">
      <button type="button" id="back">← Back</button>
      <h2 style="margin-bottom:0">${event ? esc(event.customerName) : 'New Event'}</h2>
      ${event ? `<div style="color:var(--text-muted);font-size:0.88rem;margin-top:2px">${event.eventDate} · ${esc(event.eventType)}</div>` : ''}
    </div>

    <form id="event-form">
      <div class="card">
        <h3>👤 Customer</h3>
        <label>Customer name<input name="customerName" required value="${esc(event?.customerName ?? '')}" placeholder="Full name" /></label>
        <label>Phone<input name="customerPhone" value="${esc(event?.customerPhone ?? '')}" placeholder="+1 000 000 0000" /></label>
      </div>

      <div class="card">
        <h3>🗓 Event details</h3>
        <label>Event date<input type="date" name="eventDate" required value="${event?.eventDate ?? ''}" /></label>
        <label>Event type<input name="eventType" required value="${esc(event?.eventType ?? '')}" placeholder="e.g. Wedding, Birthday" /></label>
        <label>Decor style
          <select name="decorStyle" required>
            ${['indian_traditional', 'balloon', 'both']
              .map((v) => `<option value="${v}" ${event?.decorStyle === v ? 'selected' : ''}>${DECOR_LABELS[v] || v}</option>`)
              .join('')}
          </select>
        </label>
        <label>Job type
          <select name="jobType" required>
            ${['rental', 'service']
              .map((v) => `<option value="${v}" ${event?.jobType === v ? 'selected' : ''}>${JOB_LABELS[v] || v}</option>`)
              .join('')}
          </select>
        </label>
        <label>Address<input name="address" value="${esc(event?.address ?? '')}" placeholder="Venue address" /></label>
        <label>Timings<input name="timings" value="${esc(event?.timings ?? '')}" placeholder="e.g. 6pm–10pm" /></label>
      </div>

      <div class="card">
        <h3>💰 Financials</h3>
        <label>Price<input name="price" type="number" step="0.01" required value="${event ? event.priceCents / 100 : ''}" placeholder="0.00" /></label>
        <label>Deposit amount<input name="deposit" type="number" step="0.01" value="${event ? event.depositCents / 100 : ''}" placeholder="0.00" /></label>
        <label>Deposit paid on<input type="date" name="depositPaidOn" value="${event?.depositPaidOn ?? ''}" /></label>
        <label>Rest amount<input name="rest" type="number" step="0.01" value="${event ? event.restCents / 100 : ''}" placeholder="0.00" /></label>
        <label>Due paid on<input type="date" name="duePaidOn" value="${event?.duePaidOn ?? ''}" /></label>
        ${event ? `
        <div style="background:var(--surface-2);border-radius:var(--radius-sm);padding:12px;display:flex;justify-content:space-between;align-items:center">
          <span style="color:var(--text-muted);font-size:0.9rem">Amount due</span>
          <strong style="font-size:1.1rem">${formatCents(event.dueCents)}</strong>
        </div>` : ''}
        ${event ? `
        <label style="margin-top:var(--gap-sm)">Status
          <select name="status">
            <option value="outstanding" ${event.status === 'outstanding' ? 'selected' : ''}>⏳ Outstanding</option>
            <option value="done" ${event.status === 'done' ? 'selected' : ''}>✅ Done</option>
          </select>
          ${event.statusIsManual
            ? '<button type="button" id="reset-status" style="margin-top:6px;font-size:0.82rem;padding:6px 12px">Reset to automatic</button>'
            : '<div style="font-size:0.78rem;color:var(--text-muted);margin-top:4px">🤖 Automatic status</div>'}
        </label>` : ''}
      </div>

      <div class="card">
        <h3>📝 Notes</h3>
        <label>Notes<textarea name="notes" placeholder="Any additional notes…">${esc(event?.notes ?? '')}</textarea></label>
      </div>

      <div class="card">
        <button type="submit" style="margin-bottom:8px">${event ? '💾 Save changes' : '✨ Create event'}</button>
        ${event ? '<button type="button" id="delete-event" class="danger">🗑 Delete event</button>' : ''}
      </div>
    </form>

    ${event ? '<div id="expenses" class="card"></div>' : ''}
    ${event ? '<div id="photos-section"></div>' : ''}
  `;

  qs('#back', container).addEventListener('click', () => renderEventList(container));

  if (event) {
    renderExpenses(qs('#expenses', container), event);
    renderPhotos(qs('#photos-section', container), event.id);

    qs('#delete-event', container)?.addEventListener('click', async () => {
      if (!confirm('Delete this event? This cannot be undone.')) return;
      try {
        await deleteEvent(event.id);
        toast('Event deleted');
        renderEventList(container);
      } catch (err) {
        toast(err.message);
      }
    });

    const resetBtn = qs('#reset-status', container);
    if (resetBtn) {
      resetBtn.addEventListener('click', async () => {
        try {
          await updateEvent(event.id, { resetStatusToAutomatic: true });
          toast('Status reset to automatic');
          renderEventForm(container, event.id);
        } catch (err) {
          toast(err.message);
        }
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
      duePaidOn: form.get('duePaidOn') || null,
      address: form.get('address') || null,
      timings: form.get('timings') || null,
      notes: form.get('notes'),
    };
    if (event) {
      const newStatus = form.get('status');
      if (newStatus !== event.status) payload.status = newStatus;
    }
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
    <h3>💸 Event expenses</h3>
    <ul id="expense-list">
      ${event.expenses.length === 0
        ? '<li style="color:var(--text-muted);font-size:0.9rem;border:none;padding:8px 0">No expenses yet</li>'
        : event.expenses
            .map(
              (x) => `<li data-id="${x.id}">
                <div style="flex:1;min-width:0">
                  <div style="font-weight:600">${formatCents(x.amountCents)}</div>
                  <div style="font-size:0.8rem;color:var(--text-muted)">${x.spentOn}${x.note ? ' · ' + esc(x.note) : ''}</div>
                </div>
                <button class="delete-expense" title="Delete">✕</button>
              </li>`,
            )
            .join('')}
    </ul>
    <div style="display:flex;justify-content:space-between;padding:8px 0 12px;font-size:0.9rem;color:var(--text-muted)">
      <span>Total expenses</span>
      <strong style="color:var(--text)">${formatCents(event.totalExpensesCents)}</strong>
    </div>
    <div style="display:flex;justify-content:space-between;padding:8px 0 12px;font-size:0.9rem;border-top:1px solid var(--border)">
      <span style="color:var(--text-muted)">Final amount</span>
      <strong>${formatCents(event.finalAmountCents)}</strong>
    </div>
    <h3 style="margin-top:var(--gap)">➕ Add expense</h3>
    <form id="expense-form">
      <div class="expense-form-row">
        <input name="amount" type="number" step="0.01" placeholder="Amount" required />
        <input name="spentOn" type="date" required />
      </div>
      <input name="note" placeholder="Note (e.g. where bought)" style="margin-top:4px" />
      <button type="submit">Add</button>
    </form>
  `;

  el.querySelectorAll('.delete-expense').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.closest('li').dataset.id;
      try {
        await deleteExpense(event.id, id);
        const refreshed = await (await import('../api.js')).getEvent(event.id);
        renderExpenses(el, refreshed);
      } catch (err) {
        toast(err.message);
      }
    });
  });

  qs('#expense-form', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    try {
      await addExpense(event.id, {
        amountCents: parseToCents(form.get('amount')),
        note: form.get('note') || '',
        spentOn: form.get('spentOn'),
      });
      const refreshed = await (await import('../api.js')).getEvent(event.id);
      renderExpenses(el, refreshed);
      e.target.reset();
    } catch (err) {
      toast(err.message);
    }
  });
}

async function renderPhotos(el, eventId) {
  el.className = 'card';
  el.innerHTML = `
    <h3>📸 Photos</h3>
    <div id="photo-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:var(--gap)"></div>
    <label style="display:block;cursor:pointer;margin:0">
      <input type="file" id="photo-file" accept="image/*" multiple style="display:none" />
      <div style="display:flex;align-items:center;justify-content:center;gap:8px;padding:12px;border:2px dashed var(--border-strong);border-radius:var(--radius-sm);color:var(--brand);font-weight:600;font-size:0.9rem;transition:background 0.15s ease">
        📎 Add photos
      </div>
    </label>
    <div id="photo-status" style="font-size:0.82rem;color:var(--text-muted);margin-top:6px;text-align:center"></div>
  `;

  async function load() {
    try {
      const photos = await listPhotos(eventId);
      const grid = qs('#photo-grid', el);
      if (!photos.length) {
        grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:16px 0;color:var(--text-muted);font-size:0.85rem">No photos yet</div>`;
        return;
      }
      grid.innerHTML = photos.map((p) => `
        <div style="position:relative;aspect-ratio:1;border-radius:10px;overflow:hidden;background:var(--surface-2);border:1px solid var(--border)">
          <img src="/api/photos/${p.id}" alt="${esc(p.filename)}"
            style="width:100%;height:100%;object-fit:cover;display:block;cursor:pointer" loading="lazy" />
          <button class="del-photo" data-id="${p.id}"
            style="position:absolute;top:4px;right:4px;width:24px;height:24px;border-radius:50%;padding:0;font-size:0.72rem;line-height:1;background:rgba(0,0,0,0.6);color:#fff;border:none;box-shadow:none;display:flex;align-items:center;justify-content:center;margin:0;cursor:pointer">✕</button>
        </div>`).join('');

      grid.querySelectorAll('img').forEach((img) => {
        img.addEventListener('click', () => openLightbox(img.src, img.alt));
      });
      grid.querySelectorAll('.del-photo').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm('Delete this photo?')) return;
          try { await deletePhoto(btn.dataset.id); toast('Photo deleted'); load(); }
          catch (err) { toast(err.message); }
        });
      });
    } catch (err) { toast(err.message); }
  }

  qs('#photo-file', el).addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    const status = qs('#photo-status', el);
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      status.textContent = `Uploading ${i + 1} of ${files.length}…`;
      try {
        const dataBase64 = await toBase64(file);
        await uploadPhoto(eventId, { filename: file.name, mimeType: file.type, dataBase64 });
      } catch (err) { toast(`${file.name}: ${err.message}`); }
    }
    status.textContent = '';
    e.target.value = '';
    load();
  });

  await load();
}

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function openLightbox(src, alt) {
  const lb = document.createElement('div');
  lb.style.cssText = 'position:fixed;inset:0;z-index:500;background:rgba(0,0,0,0.92);display:flex;align-items:center;justify-content:center;padding:16px';
  lb.innerHTML = `
    <img src="${src}" alt="${esc(alt)}" style="max-width:100%;max-height:90dvh;border-radius:12px;object-fit:contain" />
    <button style="position:absolute;top:16px;right:16px;background:rgba(255,255,255,0.15);color:#fff;border:none;border-radius:50%;width:44px;height:44px;font-size:1.3rem;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;margin:0;box-shadow:none">✕</button>
  `;
  lb.addEventListener('click', (e) => { if (e.target === lb || e.target.tagName === 'BUTTON') lb.remove(); });
  document.body.appendChild(lb);
}
