import { deleteEvent, listEvents } from '../api.js';
import { formatCents } from '../money.js';
import { esc, qs, toast } from '../ui.js';
import { renderEventForm } from './eventForm.js';

export async function renderEventList(container) {
  container.innerHTML = `
    <div class="card">
      <button id="new-event">+ New Event</button>
      <input id="search" placeholder="Search customer…" />
      <select id="filter-status">
        <option value="">All statuses</option>
        <option value="outstanding">Outstanding</option>
        <option value="done">Done</option>
      </select>
    </div>
    <div id="list"></div>
  `;

  async function load() {
    const q = qs('#search', container).value;
    const status = qs('#filter-status', container).value;
    const events = await listEvents({ ...(q ? { q } : {}), ...(status ? { status } : {}) });
    const list = qs('#list', container);
    list.innerHTML = events
      .map((e) => {
        const isDone = e.status === 'done';
        const secondary = isDone
          ? `<span class="profit ${e.profitCents < 0 ? 'neg' : 'pos'}">Profit <b>${formatCents(e.profitCents)}</b></span>`
          : `<span>Due <b>${formatCents(e.dueCents)}</b></span>`;
        return `
      <div class="card" data-id="${e.id}">
        <div class="ev-head">
          <strong>${esc(e.customerName)}</strong>
          <span class="pill ${e.status}">${e.status}</span>
        </div>
        <div class="ev-meta">${e.eventDate} · ${esc(e.eventType)} · ${e.jobType} · ${e.decorStyle}</div>
        <div class="ev-money">
          <span>Price <b>${formatCents(e.priceCents)}</b></span>
          ${secondary}
        </div>
        <div class="actions">
          <button class="open">Open</button>
          ${isDone ? '' : '<button class="delete">Delete</button>'}
        </div>
      </div>`;
      })
      .join('');

    list.querySelectorAll('.card').forEach((card) => {
      const id = card.dataset.id;
      card.querySelector('.open').addEventListener('click', () => renderEventForm(container, id));
      const deleteBtn = card.querySelector('.delete');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
          if (!confirm('Delete this event?')) return;
          try {
            await deleteEvent(id);
            toast('Event deleted');
            load();
          } catch (err) {
            toast(err.message);
          }
        });
      }
    });
  }

  qs('#new-event', container).addEventListener('click', () => renderEventForm(container));
  qs('#search', container).addEventListener('input', load);
  qs('#filter-status', container).addEventListener('change', load);

  await load();
}
