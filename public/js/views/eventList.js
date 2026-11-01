import { deleteEvent, listEvents } from '../api.js';
import { formatCents } from '../money.js';
import { esc, qs, toast } from '../ui.js';
import { renderEventForm } from './eventForm.js';

function buildCarousel(events) {
  const total = events.length;
  const done = events.filter((e) => e.status === 'done').length;
  const outstanding = events.filter((e) => e.status === 'outstanding').length;
  const revenue = events.reduce((s, e) => s + e.priceCents, 0);
  const totalDue = events.filter((e) => e.status === 'outstanding').reduce((s, e) => s + e.dueCents, 0);

  const slides = [
    {
      label: 'Total Revenue',
      value: formatCents(revenue),
      sub: `${total} event${total !== 1 ? 's' : ''} · ${done} done`,
      icon: '💰',
    },
    {
      label: 'Outstanding',
      value: formatCents(totalDue),
      sub: `${outstanding} event${outstanding !== 1 ? 's' : ''} pending`,
      icon: '⏳',
    },
    {
      label: 'Completed Jobs',
      value: done.toString(),
      sub: `out of ${total} total`,
      icon: '✅',
    },
  ];

  const trackHtml = slides
    .map(
      (s) => `
      <div class="hero-card">
        <h3>${s.icon} ${s.label}</h3>
        <div class="hero-amount">${s.value}</div>
        <div class="hero-label">${s.sub}</div>
      </div>`,
    )
    .join('');

  const dotsHtml = slides.map((_, i) => `<div class="carousel-dot${i === 0 ? ' active' : ''}" data-dot="${i}"></div>`).join('');

  return `
    <div class="stats-carousel" id="stats-carousel">
      <div class="stats-track" id="stats-track">${trackHtml}</div>
    </div>
    <div class="carousel-dots" id="carousel-dots">${dotsHtml}</div>
  `;
}

function initCarousel(container) {
  const carousel = qs('#stats-carousel', container);
  const track = qs('#stats-track', container);
  const dotsEl = qs('#carousel-dots', container);
  if (!carousel || !track) return;

  const dots = Array.from(dotsEl.querySelectorAll('.carousel-dot'));
  let current = 0;
  let autoTimer = null;

  function go(idx) {
    current = idx;
    track.style.transform = `translateX(-${idx * 100}%)`;
    dots.forEach((d, i) => d.classList.toggle('active', i === idx));
  }

  function next() { go((current + 1) % dots.length); }

  function startAuto() {
    clearInterval(autoTimer);
    autoTimer = setInterval(next, 3000);
  }

  startAuto();
  dots.forEach((d, i) => d.addEventListener('click', () => { go(i); startAuto(); }));

  let startX = 0;
  carousel.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; clearInterval(autoTimer); }, { passive: true });
  carousel.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 40) go(dx < 0 ? Math.min(current + 1, dots.length - 1) : Math.max(current - 1, 0));
    startAuto();
  }, { passive: true });
}

export async function renderEventList(container) {
  container.innerHTML = `
    <div id="carousel-wrap"></div>
    <div class="card" style="padding: 12px 14px;">
      <div class="list-controls">
        <input id="search" placeholder="Search customer…" />
        <select id="filter-status">
          <option value="">All</option>
          <option value="outstanding">Outstanding</option>
          <option value="done">Done</option>
        </select>
      </div>
    </div>
    <div id="list"></div>
  `;

  async function load() {
    const q = qs('#search', container).value;
    const status = qs('#filter-status', container).value;
    const events = await listEvents({ ...(q ? { q } : {}), ...(status ? { status } : {}) });

    qs('#carousel-wrap', container).innerHTML = buildCarousel(events);
    initCarousel(container);

    const list = qs('#list', container);
    if (!events.length) {
      list.innerHTML = `<div class="card" style="text-align:center;padding:32px 16px;color:var(--text-muted)">
        <div style="font-size:2.5rem;margin-bottom:12px">🗓</div>
        <div style="font-weight:600">No events yet</div>
        <div style="font-size:0.88rem;margin-top:4px">Tap + to add your first event</div>
      </div>`;
      return;
    }

    list.innerHTML = events
      .map((e, i) => {
        const isDone = e.status === 'done';
        const moneyHtml = isDone
          ? `<div class="ev-money-item"><div class="ev-money-label">Price</div><div class="ev-money-val">${formatCents(e.priceCents)}</div></div>
             <div class="ev-money-item"><div class="ev-money-label">Profit</div><div class="ev-money-val ${e.profitCents < 0 ? 'neg' : 'pos'}">${formatCents(e.profitCents)}</div></div>`
          : `<div class="ev-money-item"><div class="ev-money-label">Price</div><div class="ev-money-val">${formatCents(e.priceCents)}</div></div>
             <div class="ev-money-item"><div class="ev-money-label">Due</div><div class="ev-money-val">${formatCents(e.dueCents)}</div></div>`;

        return `
        <div class="card card-list-item" data-id="${e.id}" style="animation-delay:${Math.min(i, 8) * 40}ms">
          <div class="ev-head">
            <div>
              <strong>${esc(e.customerName)}</strong>
              <div class="ev-meta">${e.eventDate} · ${esc(e.eventType)}</div>
            </div>
            <span class="pill ${e.status}">${e.status}</span>
          </div>
          <div class="ev-meta" style="margin-bottom:0">${e.jobType} · ${e.decorStyle.replace(/_/g, ' ')}</div>
          <div class="ev-money">${moneyHtml}</div>
          <div class="actions">
            <button class="open">Open</button>
            ${!isDone ? '<button class="delete">Delete</button>' : ''}
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

  qs('#search', container).addEventListener('input', load);
  qs('#filter-status', container).addEventListener('change', load);

  await load();
}
