/* ===== סטנדרט 14 — לוגיקת האתר =====
 * אין צורך לערוך קובץ זה כדי לעדכן תוכן.
 * כל התוכן נמצא בתיקייה data/ (ראו README.md).
 */
(() => {
  'use strict';

  const TABS = ['announcements', 'team', 'schedule', 'tasks', 'links'];
  const view = document.getElementById('view');
  const teamSelect = document.getElementById('team-select');
  const state = { site: null, team: null, teamId: null, cache: {} };

  // ---------- Helpers ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  // Escape text and turn URLs into links
  const rich = (s) => esc(s).replace(
    /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g,
    '<a href="$1" target="_blank" rel="noopener">$1</a>'
  );

  const safeUrl = (u) => {
    const s = String(u ?? '').trim();
    if (/^(https?:|mailto:|tel:)/i.test(s)) return s;
    if (/^[\w./-]+$/.test(s) && !s.startsWith('//')) return s; // relative file in repo
    return '#';
  };

  async function getJSON(path, fallback) {
    if (path in state.cache) return state.cache[path];
    try {
      const res = await fetch(path, { cache: 'no-cache' });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      state.cache[path] = data;
      return data;
    } catch (e) {
      if (fallback !== undefined) return fallback;
      throw new Error(`לא הצלחתי לטעון את ${path}`);
    }
  }

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } }
  };

  // Parse "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM" as local Israel time
  function parseDate(s) {
    if (!s) return null;
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if (!m) return null;
    const hasTime = m[4] !== undefined;
    const d = new Date(+m[1], +m[2] - 1, +m[3], hasTime ? +m[4] : 23, hasTime ? +m[5] : 59);
    d.hasTime = hasTime;
    return d;
  }

  const fmtDate = (d, withTime) => {
    const opts = { weekday: 'short', day: 'numeric', month: 'numeric' };
    if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleString('he-IL', opts);
  };

  function relDays(d) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const day = new Date(d); day.setHours(0, 0, 0, 0);
    return Math.round((day - today) / 86400000);
  }

  function dueBadge(d, done) {
    if (done) return '<span class="badge ok">✓ הושלם</span>';
    const now = new Date();
    if (d < now) return '<span class="badge danger">באיחור</span>';
    const n = relDays(d);
    if (n === 0) return '<span class="badge danger">היום</span>';
    if (n === 1) return '<span class="badge warn">מחר</span>';
    if (n <= 3) return `<span class="badge warn">עוד ${n} ימים</span>`;
    return `<span class="badge">עוד ${n} ימים</span>`;
  }

  // Israeli number -> wa.me format (9725XXXXXXXX)
  function waNumber(phone) {
    let p = String(phone ?? '').replace(/[^\d+]/g, '');
    if (p.startsWith('+')) p = p.slice(1);
    else if (p.startsWith('00')) p = p.slice(2);
    else if (p.startsWith('0')) p = '972' + p.slice(1);
    return p;
  }

  const initials = (name) => String(name ?? '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('');

  const ICON = {
    whatsapp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3a.5.5 0 0 0 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.3.8 3.2.7a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .1-1.3c0-.1-.2-.2-.5-.3z"/></svg>',
    phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.2 11.4 11.4 0 0 0 3.6.6 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1 11.4 11.4 0 0 0 .6 3.6 1 1 0 0 1-.3 1z"/></svg>',
    chevron: '<svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z"/></svg>',
    file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm-1 7V3.5L18.5 9z"/></svg>'
  };

  const title = (h, meta = '') => `<div class="view-title"><h2>${esc(h)}</h2>${meta ? `<span class="meta">${meta}</span>` : ''}</div>`;
  const teamPath = (file) => `data/teams/${state.teamId}/${file}`;

  // ---------- Views ----------
  async function renderAnnouncements() {
    const [globalList, teamList] = await Promise.all([
      getJSON('data/announcements.json', []),
      getJSON(teamPath('announcements.json'), [])
    ]);
    const all = [
      ...globalList.map((a) => ({ ...a, scope: state.site.globalLabel || 'כללי' })),
      ...teamList.map((a) => ({ ...a, scope: null }))
    ].filter((a) => !a.expires || parseDate(a.expires) >= new Date());

    all.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || String(b.date).localeCompare(String(a.date)));

    if (!all.length) return title('הודעות') + '<p class="empty">אין הודעות כרגע</p>';

    const levels = { important: ['warn', 'חשוב'], urgent: ['danger', 'דחוף'] };
    const items = all.map((a) => {
      const d = parseDate(a.date);
      const isNew = d && relDays(d) >= -1;
      const lvl = levels[a.level];
      const badges = [
        a.pinned ? '<span class="badge accent">📌 נעוץ</span>' : '',
        lvl ? `<span class="badge ${lvl[0]}">${lvl[1]}</span>` : '',
        isNew ? '<span class="badge info">חדש</span>' : '',
        a.scope ? `<span class="badge">${esc(a.scope)}</span>` : ''
      ].join('');
      return `<article class="card announcement ${esc(a.level || '')} ${a.pinned ? 'pinned' : ''}">
        <header><div class="badges">${badges}</div><h3>${esc(a.title)}</h3></header>
        ${a.body ? `<div class="body">${rich(a.body)}</div>` : ''}
        <footer>${d ? fmtDate(d, d.hasTime) : ''}${a.author ? ` · ${esc(a.author)}` : ''}</footer>
      </article>`;
    }).join('');
    return title('הודעות', `${all.length} הודעות`) + items;
  }

  async function renderTeam() {
    const data = await getJSON(teamPath('members.json'), { groups: [] });
    const groups = data.groups || [];
    const memberHtml = (m) => {
      const wa = m.phone ? waNumber(m.phone) : '';
      const waText = data.whatsappMessage ? `?text=${encodeURIComponent(data.whatsappMessage)}` : '';
      return `<div class="card member">
        <div class="avatar">${m.photo ? `<img src="${esc(safeUrl(m.photo))}" alt="" loading="lazy">` : esc(initials(m.name))}</div>
        <div class="info">
          <div class="name">${esc(m.name)}</div>
          ${m.role ? `<div class="role">${esc(m.role)}</div>` : ''}
        </div>
        <div class="actions">
          ${wa ? `<a class="btn whatsapp" href="https://wa.me/${esc(wa)}${waText}" target="_blank" rel="noopener" aria-label="וואטסאפ ל${esc(m.name)}">${ICON.whatsapp}<span>וואטסאפ</span></a>` : ''}
          ${m.phone && m.showCall !== false ? `<a class="btn" href="tel:${esc(String(m.phone).replace(/[^\d+]/g, ''))}" aria-label="חיוג ל${esc(m.name)}">${ICON.phone}</a>` : ''}
        </div>
      </div>`;
    };
    const total = groups.reduce((n, g) => n + (g.members || []).length, 0);
    if (!total) return title('הצוות') + '<p class="empty">עוד לא הוזנו חברי צוות</p>';
    return title('הצוות', `${total} אנשים`) + groups.map((g) =>
      `${g.title ? `<div class="section-label">${esc(g.title)}</div>` : ''}${(g.members || []).map(memberHtml).join('')}`
    ).join('');
  }

  async function renderSchedule() {
    const data = await getJSON(teamPath('schedule.json'), {});
    const cal = data.googleCalendar || {};
    const images = data.images || [];
    const ids = [].concat(cal.calendarIds || cal.calendarId || []);

    let calUrl = cal.embedUrl || '';
    if (!calUrl && ids.length) {
      const p = new URLSearchParams({ ctz: 'Asia/Jerusalem', hl: 'iw', mode: 'AGENDA', showPrint: '0', showTitle: '0' });
      ids.forEach((id) => p.append('src', id));
      calUrl = `https://calendar.google.com/calendar/embed?${p}`;
    }

    const hasCal = !!calUrl, hasImg = images.length > 0;
    if (!hasCal && !hasImg) return title('לו״ז') + '<p class="empty">הלו״ז יעלה בקרוב</p>';

    const modes = { AGENDA: 'רשימה', WEEK: 'שבוע', MONTH: 'חודש' };
    const savedMode = store.get('s14:calMode', 'AGENDA');
    const withMode = (m) => calUrl.includes('mode=') ? calUrl.replace(/mode=[A-Z]+/, `mode=${m}`) : `${calUrl}&mode=${m}`;

    const sources = [];
    if (hasCal) sources.push(['cal', 'יומן']);
    if (hasImg) sources.push(['img', images.length > 1 ? 'תמונות' : 'תמונה']);
    const savedSrc = store.get('s14:schedSrc', data.defaultView === 'images' ? 'img' : sources[0][0]);
    const src = sources.some((s) => s[0] === savedSrc) ? savedSrc : sources[0][0];

    const srcSwitch = sources.length > 1 ? `<div class="segmented" data-role="src">${sources.map(([k, l]) =>
      `<button type="button" data-src="${k}" aria-pressed="${k === src}">${l}</button>`).join('')}</div>` : '';

    const calHtml = hasCal ? `<div data-pane="cal" ${src !== 'cal' ? 'hidden' : ''}>
        <div class="segmented" data-role="mode">${Object.entries(modes).map(([k, l]) =>
          `<button type="button" data-mode="${k}" aria-pressed="${k === savedMode}">${l}</button>`).join('')}</div>
        <iframe class="calendar-frame" src="${esc(withMode(savedMode))}" title="לו״ז" loading="lazy"></iframe>
        ${cal.publicUrl ? `<p class="note"><a href="${esc(safeUrl(cal.publicUrl))}" target="_blank" rel="noopener">הוספת היומן ל-Google Calendar שלי</a></p>` : ''}
      </div>` : '';

    const imgHtml = hasImg ? `<div data-pane="img" ${src !== 'img' ? 'hidden' : ''} class="stack">${images.map((im) =>
      `<figure class="card schedule-image" style="margin:0">
        <a href="${esc(safeUrl(im.src))}" target="_blank" rel="noopener"><img src="${esc(safeUrl(im.src))}" alt="${esc(im.caption || 'לו״ז')}" loading="lazy"></a>
        ${im.caption ? `<figcaption>${esc(im.caption)}</figcaption>` : ''}
      </figure>`).join('')}</div>` : '';

    const updated = data.updated ? `עודכן ${fmtDate(parseDate(data.updated), false)}` : '';
    return title('לו״ז', updated) + (data.note ? `<div class="card">${rich(data.note)}</div>` : '') + srcSwitch + calHtml + imgHtml;
  }

  function bindSchedule() {
    view.querySelectorAll('[data-role="src"] button').forEach((b) => b.addEventListener('click', () => {
      store.set('s14:schedSrc', b.dataset.src);
      view.querySelectorAll('[data-role="src"] button').forEach((x) => x.setAttribute('aria-pressed', x === b));
      view.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.src; });
    }));
    view.querySelectorAll('[data-role="mode"] button').forEach((b) => b.addEventListener('click', () => {
      store.set('s14:calMode', b.dataset.mode);
      view.querySelectorAll('[data-role="mode"] button').forEach((x) => x.setAttribute('aria-pressed', x === b));
      const f = view.querySelector('.calendar-frame');
      f.src = f.src.replace(/mode=[A-Z]+/, `mode=${b.dataset.mode}`);
    }));
  }

  // --- Tasks ---
  const taskKey = (id) => `s14:${state.teamId}:task:${id}`;
  const taskState = (t) => store.get(taskKey(t.id), []);
  const isDone = (t) => {
    const items = t.checklist || [];
    const s = taskState(t);
    if (!items.length) return s.includes('__done');
    return items.every((_, i) => s.includes(i));
  };

  async function renderTasks() {
    const tasks = (await getJSON(teamPath('tasks.json'), [])).filter((t) => t && t.id);
    if (!tasks.length) return title('מטלות') + '<p class="empty">אין מטלות כרגע 🎉</p>';

    tasks.sort((a, b) => {
      const da = parseDate(a.due), db = parseDate(b.due);
      return (isDone(a) - isDone(b)) || ((da ? da.getTime() : Infinity) - (db ? db.getTime() : Infinity));
    });

    const filter = store.get('s14:taskFilter', 'open');
    const openCount = tasks.filter((t) => !isDone(t)).length;
    const chips = [['open', `פתוחות (${openCount})`], ['done', `הושלמו (${tasks.length - openCount})`], ['all', 'הכל']]
      .map(([k, l]) => `<button type="button" class="chip" data-filter="${k}" aria-pressed="${k === filter}">${l}</button>`).join('');

    const items = tasks.map((t) => {
      const due = parseDate(t.due);
      const list = t.checklist || [];
      const s = taskState(t);
      const done = isDone(t);
      const doneCount = list.length ? list.filter((_, i) => s.includes(i)).length : (done ? 1 : 0);
      const pct = list.length ? Math.round(100 * doneCount / list.length) : (done ? 100 : 0);
      const checklist = list.length
        ? list.map((c, i) => `<li><label><input type="checkbox" data-task="${esc(t.id)}" data-idx="${i}" ${s.includes(i) ? 'checked' : ''}><span>${esc(c)}</span></label></li>`).join('')
        : `<li><label><input type="checkbox" data-task="${esc(t.id)}" data-idx="__done" ${done ? 'checked' : ''}><span>סיימתי את המטלה</span></label></li>`;
      const materials = (t.materials || []).map((m) =>
        `<li><a href="${esc(safeUrl(m.url))}" target="_blank" rel="noopener">${ICON.file}<span>${esc(m.title || m.url)}</span></a></li>`).join('');

      return `<details class="card task ${done ? 'done' : ''}" data-status="${done ? 'done' : 'open'}" data-id="${esc(t.id)}">
        <summary>
          <div class="task-head">
            <div>
              <h3>${esc(t.title)}</h3>
              <div class="due">${due ? `תג״ב: ${fmtDate(due, due.hasTime)}` : 'ללא תג״ב'}</div>
            </div>
            <div style="display:flex;align-items:center;gap:6px">${due || done ? dueBadge(due || new Date(8.64e15), done) : ''}${ICON.chevron}</div>
          </div>
          <div class="progress" aria-label="התקדמות ${pct}%"><div style="width:${pct}%"></div></div>
        </summary>
        <div class="task-body">
          ${t.description ? `<p class="desc">${rich(t.description)}</p>` : ''}
          <h4>צ׳ק ליסט${list.length ? ` · <span data-count>${doneCount}/${list.length}</span>` : ''}</h4>
          <ul class="checklist">${checklist}</ul>
          ${materials ? `<h4>חומר לימודי</h4><ul class="materials">${materials}</ul>` : ''}
        </div>
      </details>`;
    }).join('');

    return title('מטלות') + `<div class="filters">${chips}</div><div id="task-list">${items}</div>` +
      '<p class="note">הסימונים בצ׳ק ליסט נשמרים רק במכשיר שלך</p>';
  }

  function applyTaskFilter() {
    const f = store.get('s14:taskFilter', 'open');
    view.querySelectorAll('.task').forEach((el) => { el.hidden = f !== 'all' && el.dataset.status !== f; });
    const list = view.querySelector('#task-list');
    if (list && ![...list.children].some((c) => !c.hidden)) {
      if (!view.querySelector('#task-empty')) list.insertAdjacentHTML('afterend', `<p id="task-empty" class="empty">${f === 'open' ? 'כל המטלות הושלמו 💪' : 'אין מטלות להצגה'}</p>`);
    } else view.querySelector('#task-empty')?.remove();
  }

  function bindTasks() {
    applyTaskFilter();
    view.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => {
      store.set('s14:taskFilter', b.dataset.filter);
      view.querySelectorAll('[data-filter]').forEach((x) => x.setAttribute('aria-pressed', x === b));
      applyTaskFilter();
    }));
    view.querySelectorAll('.checklist input').forEach((cb) => cb.addEventListener('change', async () => {
      const id = cb.dataset.task;
      const idx = cb.dataset.idx === '__done' ? '__done' : +cb.dataset.idx;
      const s = new Set(store.get(taskKey(id), []));
      cb.checked ? s.add(idx) : s.delete(idx);
      store.set(taskKey(id), [...s]);
      // Re-render but keep this task open
      const openIds = [...view.querySelectorAll('.task[open]')].map((d) => d.dataset.id);
      await route();
      openIds.forEach((oid) => view.querySelector(`.task[data-id="${CSS.escape(oid)}"]`)?.setAttribute('open', ''));
      const el = view.querySelector(`.task[data-id="${CSS.escape(id)}"]`);
      if (el && el.hidden) { el.hidden = false; view.querySelector('#task-empty')?.remove(); } // keep visible until next filter change
    }));
  }

  async function renderLinks() {
    const [globalLinks, teamLinks] = await Promise.all([
      getJSON('data/links.json', { groups: [] }),
      getJSON(teamPath('links.json'), { groups: [] })
    ]);
    const groups = [...(teamLinks.groups || []), ...(globalLinks.groups || [])].filter((g) => (g.links || []).length);
    if (!groups.length) return title('קישורים שימושיים') + '<p class="empty">אין קישורים עדיין</p>';
    return title('קישורים שימושיים') + groups.map((g) =>
      `<div class="section-label">${esc(g.title || '')}</div><div class="links-grid">${g.links.map((l) =>
        `<a class="link-item" href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener">
          <span class="emoji" aria-hidden="true">${esc(l.icon || '🔗')}</span>
          <div><div class="t">${esc(l.title)}</div>${l.description ? `<div class="d">${esc(l.description)}</div>` : ''}</div>
        </a>`).join('')}</div>`).join('');
  }

  const RENDER = {
    announcements: [renderAnnouncements],
    team: [renderTeam],
    schedule: [renderSchedule, bindSchedule],
    tasks: [renderTasks, bindTasks],
    links: [renderLinks]
  };

  // ---------- Router ----------
  async function route() {
    const tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'announcements';
    document.querySelectorAll('.tabbar a').forEach((a) => {
      a.toggleAttribute('aria-current', a.dataset.tab === tab);
      if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    });
    const [render, bind] = RENDER[tab];
    try {
      view.innerHTML = await render();
      bind && bind();
    } catch (e) {
      view.innerHTML = `<div class="error">שגיאה בטעינת התוכן: ${esc(e.message)}</div>`;
    }
  }

  async function init() {
    try {
      state.site = await getJSON('data/site.json');
    } catch (e) {
      view.innerHTML = `<div class="error">${esc(e.message)}</div>`;
      return;
    }
    const site = state.site;
    const teams = site.teams || [];
    const params = new URLSearchParams(location.search);
    const wanted = params.get('team') || store.get('s14:team', null) || site.defaultTeam;
    const team = teams.find((t) => t.id === wanted) || teams.find((t) => t.id === site.defaultTeam) || teams[0];
    if (!team) { view.innerHTML = '<div class="error">לא הוגדרו צוותים ב-data/site.json</div>'; return; }

    state.team = team;
    state.teamId = team.id;
    store.set('s14:team', team.id);

    document.getElementById('site-name').textContent = site.siteName || 'סטנדרט 14';
    document.getElementById('team-name').textContent = [team.name, site.unitName].filter(Boolean).join(' · ');
    document.title = `${site.siteName || 'סטנדרט 14'} · ${team.name}`;

    if (teams.length > 1) {
      teamSelect.hidden = false;
      teamSelect.innerHTML = teams.map((t) => `<option value="${esc(t.id)}" ${t.id === team.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
      teamSelect.addEventListener('change', () => {
        store.set('s14:team', teamSelect.value);
        const u = new URL(location.href);
        u.searchParams.set('team', teamSelect.value);
        location.href = u.toString();
      });
    }

    window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });
    route();
  }

  init();
})();
