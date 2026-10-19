import { deleteEvent, listEvents } from '../api.js';
import { formatCents } from '../money.js';
import { qs, toast } from '../ui.js';
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
      .map(
        (e) => `
      <div class="card" data-id="${e.id}">
        <strong>${e.customerName}</strong> — ${e.eventDate}<br/>
        ${e.eventType} · ${e.jobType} · ${e.decorStyle}<br/>
        Price: ${formatCents(e.priceCents)} | Due: ${formatCents(e.dueCents)}
        <span class="pill ${e.status}">${e.status}</span>
        <button class="open">Open</button>
        <button class="delete">Delete</button>
      </div>`,
      )
      .join('');

    list.querySelectorAll('.card').forEach((card) => {
      const id = card.dataset.id;
      card.querySelector('.open').addEventListener('click', () => renderEventForm(container, id));
      card.querySelector('.delete').addEventListener('click', async () => {
        if (!confirm('Delete this event?')) return;
        await deleteEvent(id);
        toast('Event deleted');
        load();
      });
    });
  }

  qs('#new-event', container).addEventListener('click', () => renderEventForm(container));
  qs('#search', container).addEventListener('input', load);
  qs('#filter-status', container).addEventListener('change', load);

  await load();
}
