/* ===== סטנדרט 14 — ממשק ניהול =====
 * כל שמירה יוצרת commit במאגר ב-GitHub דרך ה-API,
 * ו-GitHub Actions מעלה את האתר המעודכן תוך כדקה-שתיים.
 */
(() => {
  'use strict';

  const view = document.getElementById('view');
  const nav = document.getElementById('admin-nav');
  const sheet = document.getElementById('sheet');
  const toastEl = document.getElementById('toast');
  const teamSelect = document.getElementById('team-select');

  const app = { site: null, teamId: null, section: null, gh: null };

  // ---------- Helpers ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const LS = {
    get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
  };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const pad = (n) => String(n).padStart(2, '0');
  const nowLocal = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const today = () => nowLocal().slice(0, 10);
  const uid = (prefix) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const fmt = (s) => {
    if (!s) return '';
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
    if (!m) return s;
    const d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
    return d.toLocaleString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric', ...(m[4] ? { hour: '2-digit', minute: '2-digit' } : {}) });
  };
  const teamPath = (f) => `data/teams/${app.teamId}/${f}`;
  const teamName = (id = app.teamId) => (app.site.teams.find((t) => t.id === id) || {}).name || id;
  const multiTeam = () => (app.site.teams || []).length > 1;
  const siteUrl = () => {
    const base = location.origin + location.pathname.replace(/admin\.html$/, '');
    return multiTeam() ? `${base}?team=${encodeURIComponent(app.teamId)}` : base;
  };

  let toastTimer;
  function toast(msg, isErr = false, ms = 3500) {
    toastEl.textContent = msg;
    toastEl.classList.toggle('err', isErr);
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
  }
  const SAVED = 'נשמר ✓ האתר יתעדכן תוך כדקה-שתיים';

  // ---------- Base64 (UTF-8 safe) ----------
  function bytesToB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  const textToB64 = (t) => bytesToB64(new TextEncoder().encode(t));
  const b64ToText = (b) => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

  // ---------- GitHub client ----------
  class GitHub {
    constructor({ owner, repo, branch }, token) {
      Object.assign(this, { owner, repo, branch: branch || 'main', token, shas: {} });
    }
    async req(method, path, body) {
      const url = `https://api.github.com/repos/${this.owner}/${this.repo}${path ? '/' + path : ''}`;
      const res = await fetch(url, {
        method,
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined
      });
      if (!res.ok) {
        let detail = '';
        try { detail = (await res.json()).message || ''; } catch { /* ignore */ }
        const e = new Error(ghError(res.status, detail));
        e.status = res.status;
        throw e;
      }
      return res.status === 204 ? null : res.json();
    }
    enc(p) { return p.split('/').map(encodeURIComponent).join('/'); }
    async readJSON(path, fallback) {
      try {
        const r = await this.req('GET', `contents/${this.enc(path)}?ref=${encodeURIComponent(this.branch)}`);
        this.shas[path] = r.sha;
        return JSON.parse(b64ToText(r.content));
      } catch (e) {
        if (e.status === 404 && fallback !== undefined) { delete this.shas[path]; return clone(fallback); }
        throw e;
      }
    }
    async writeJSON(path, data, message) {
      const r = await this.req('PUT', `contents/${this.enc(path)}`, {
        message,
        branch: this.branch,
        content: textToB64(JSON.stringify(data, null, 2) + '\n'),
        ...(this.shas[path] ? { sha: this.shas[path] } : {})
      });
      this.shas[path] = r.content.sha;
    }
    async putBase64(path, b64, message) {
      await this.req('PUT', `contents/${this.enc(path)}`, { message, branch: this.branch, content: b64 });
    }
    async deleteFile(path, message) {
      const r = await this.req('GET', `contents/${this.enc(path)}?ref=${encodeURIComponent(this.branch)}`);
      await this.req('DELETE', `contents/${this.enc(path)}`, { message, branch: this.branch, sha: r.sha });
    }
    rawUrl(path) { return `https://raw.githubusercontent.com/${this.owner}/${this.repo}/${this.branch}/${path}`; }
  }

  function ghError(status, detail) {
    if (status === 401) return 'מפתח הגישה לא תקין או שפג תוקפו';
    if (status === 403) return /rate limit/i.test(detail) ? 'יותר מדי בקשות, נסו שוב בעוד כמה דקות' : 'אין למפתח הרשאת כתיבה למאגר';
    if (status === 404) return 'לא נמצא (בדקו שלמפתח יש גישה למאגר)';
    if (status === 409 || status === 422) return 'הקובץ עודכן במקביל ממקום אחר. טענו מחדש ונסו שוב';
    return `שגיאה ${status}${detail ? `: ${detail}` : ''}`;
  }

  // Load a file, remember its sha, and save back with conflict handling
  async function save(path, data, message) {
    try {
      await app.gh.writeJSON(path, data, message);
      toast(SAVED);
      return true;
    } catch (e) {
      toast(e.message, true, 6000);
      if (e.status === 409 || e.status === 422) renderSection();
      return false;
    }
  }

  // ---------- Uploads ----------
  const MAX_UPLOAD = 20 * 1024 * 1024;
  function fileExt(name, fallback = 'bin') {
    const m = String(name).toLowerCase().match(/\.([a-z0-9]{1,5})$/);
    return m ? m[1] : fallback;
  }
  async function imageToJpegB64(file, max = 1800) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
      return bytesToB64(new Uint8Array(await blob.arrayBuffer()));
    } finally { URL.revokeObjectURL(url); }
  }
  async function uploadFile(file, folder, { asImage = false } = {}) {
    if (file.size > MAX_UPLOAD && !asImage) throw new Error('הקובץ גדול מ-20MB. העלו אותו ל-Google Drive והוסיפו קישור');
    const stamp = new Date().toISOString().slice(0, 10) + '-' + Math.random().toString(36).slice(2, 7);
    let b64, ext;
    if (asImage || /^image\/(jpeg|png|webp|heic|heif)$/.test(file.type)) {
      try { b64 = await imageToJpegB64(file); ext = 'jpg'; } catch { /* fall back to raw */ }
    }
    if (!b64) { b64 = bytesToB64(new Uint8Array(await file.arrayBuffer())); ext = fileExt(file.name); }
    const path = `files/${app.teamId}/${folder}/${stamp}.${ext}`;
    await app.gh.putBase64(path, b64, `ניהול: העלאת קובץ ${file.name}`);
    return path;
  }
  const pickFile = (accept) => new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    if (accept) inp.accept = accept;
    inp.onchange = () => resolve(inp.files[0] || null);
    inp.click();
  });

  // ---------- Form sheet ----------
  function fieldHtml(f, v) {
    const name = `name="${esc(f.key)}"`;
    const req = f.required ? 'required' : '';
    const ph = f.placeholder ? `placeholder="${esc(f.placeholder)}"` : '';
    const help = f.help ? `<small>${esc(f.help)}</small>` : '';
    const ltr = f.ltr ? 'dir="ltr"' : '';
    let input;
    switch (f.type) {
      case 'textarea':
        input = `<textarea ${name} ${req} ${ph} rows="${f.rows || 4}">${esc(v ?? '')}</textarea>`; break;
      case 'lines':
        input = `<textarea ${name} ${req} ${ph} rows="${f.rows || 5}">${esc((v || []).join('\n'))}</textarea>`; break;
      case 'select':
        input = `<select ${name}>${f.options.map(([val, label]) => `<option value="${esc(val)}" ${String(v ?? '') === val ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>`; break;
      case 'checkbox':
        return `<label class="field check"><input type="checkbox" ${name} ${v ? 'checked' : ''}><span>${esc(f.label)}</span></label>`;
      case 'combo': {
        const dl = `dl_${f.key}`;
        input = `<input type="text" ${name} ${req} ${ph} list="${dl}" value="${esc(v ?? '')}" autocomplete="off"><datalist id="${dl}">${(f.options || []).map((o) => `<option value="${esc(o)}">`).join('')}</datalist>`; break;
      }
      case 'materials':
        return `<div class="field"><span>${esc(f.label)}</span><div class="rep" data-rep="${esc(f.key)}">${(v || []).map(repRow).join('')}</div>
          <div class="rep-actions"><button type="button" class="btn" data-rep-add="${esc(f.key)}">+ קישור</button><button type="button" class="btn" data-rep-upload="${esc(f.key)}">📎 העלאת קובץ</button></div>${help}</div>`;
      default: {
        const type = { date: 'date', datetime: 'datetime-local', tel: 'tel' }[f.type] || 'text';
        const im = f.type === 'url' ? 'inputmode="url" autocapitalize="off" autocorrect="off"' : '';
        input = `<input type="${type}" ${name} ${req} ${ph} ${ltr} ${im} value="${esc(v ?? '')}">`;
      }
    }
    return `<label class="field"><span>${esc(f.label)}${f.required ? ' *' : ''}</span>${input}${help}</label>`;
  }
  const repRow = (m = {}) => `<div class="rep-row"><div class="rep-inputs">
      <input data-k="title" placeholder="שם החומר" value="${esc(m.title || '')}">
      <input data-k="url" placeholder="קישור (https://…)" dir="ltr" inputmode="url" autocapitalize="off" value="${esc(m.url || '')}">
    </div><button type="button" class="icon-btn" data-rep-rm aria-label="הסרה">✕</button></div>`;

  function readForm(form, fields) {
    const out = {};
    for (const f of fields) {
      if (f.type === 'materials') {
        out[f.key] = [...form.querySelectorAll(`[data-rep="${f.key}"] .rep-row`)].map((r) => ({
          title: r.querySelector('[data-k="title"]').value.trim(),
          url: r.querySelector('[data-k="url"]').value.trim()
        })).filter((m) => m.url);
        continue;
      }
      const el = form.elements[f.key];
      if (!el) continue;
      if (f.type === 'checkbox') out[f.key] = el.checked;
      else if (f.type === 'lines') out[f.key] = el.value.split('\n').map((s) => s.trim()).filter(Boolean);
      else out[f.key] = el.value.trim();
    }
    return out;
  }

  function closeSheet() { if (sheet.open) sheet.close(); sheet.innerHTML = ''; }
  sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); }); // tap on backdrop
  sheet.addEventListener('cancel', () => { sheet.innerHTML = ''; });

  function openSheet(titleText, bodyHtml) {
    sheet.innerHTML = `<div class="sheet-head"><h3>${esc(titleText)}</h3><button type="button" class="icon-btn" data-close aria-label="סגירה">✕</button></div><div class="sheet-body">${bodyHtml}</div>`;
    sheet.querySelector('[data-close]').onclick = closeSheet;
    if (!sheet.open) sheet.showModal();
    sheet.scrollTop = 0;
    return sheet.querySelector('.sheet-body');
  }

  /** Opens a form in the bottom sheet. onSubmit(values) returns true to close. */
  function openForm({ title, fields, values = {}, submitLabel = 'שמירה', onSubmit, onDelete, deleteLabel = 'מחיקה' }) {
    const body = openSheet(title, `<form class="form" novalidate>
      ${fields.map((f) => fieldHtml(f, values[f.key])).join('')}
      <div class="form-actions">
        <button type="submit" class="btn primary">${esc(submitLabel)}</button>
        ${onDelete ? `<button type="button" class="btn danger" data-del>${esc(deleteLabel)}</button>` : ''}
      </div></form>`);
    const form = body.querySelector('form');

    form.addEventListener('click', async (e) => {
      const add = e.target.closest('[data-rep-add]');
      const up = e.target.closest('[data-rep-upload]');
      const rm = e.target.closest('[data-rep-rm]');
      if (add) form.querySelector(`[data-rep="${add.dataset.repAdd}"]`).insertAdjacentHTML('beforeend', repRow());
      if (rm) rm.closest('.rep-row').remove();
      if (up) {
        const file = await pickFile();
        if (!file) return;
        up.disabled = true; up.textContent = 'מעלה…';
        try {
          const path = await uploadFile(file, 'materials');
          form.querySelector(`[data-rep="${up.dataset.repUpload}"]`).insertAdjacentHTML('beforeend',
            repRow({ title: file.name.replace(/\.[^.]+$/, ''), url: path }));
          toast('הקובץ הועלה ✓ אל תשכחו ללחוץ "שמירה"');
        } catch (err) { toast(err.message, true, 6000); }
        up.disabled = false; up.textContent = '📎 העלאת קובץ';
      }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const btn = form.querySelector('[type="submit"]');
      btn.disabled = true; btn.textContent = 'שומר…';
      const ok = await onSubmit(readForm(form, fields));
      if (ok) closeSheet();
      else { btn.disabled = false; btn.textContent = submitLabel; }
    });

    form.querySelector('[data-del]')?.addEventListener('click', async (e) => {
      if (!confirm('למחוק? אי אפשר לבטל את הפעולה.')) return;
      e.target.disabled = true; e.target.textContent = 'מוחק…';
      if (await onDelete()) closeSheet();
      else { e.target.disabled = false; e.target.textContent = deleteLabel; }
    });
  }

  // ---------- Generic list editors ----------
  const blockHead = (title, sub) => `<div class="block-head"><div><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div></div>`;

  /** Flat array editor (announcements, tasks) */
  async function flatEditor(container, cfg) {
    container.innerHTML = '<p class="loading">טוען…</p>';
    let list;
    try { list = await app.gh.readJSON(cfg.path, []); }
    catch (e) { container.innerHTML = `<div class="error">${esc(e.message)}</div>`; return; }

    const draw = () => {
      const sorted = list.map((item, i) => ({ item, i })).sort((a, b) => cfg.sort(a.item, b.item));
      container.innerHTML = blockHead(cfg.title, cfg.subtitle) +
        `<button type="button" class="btn add-btn" data-add>+ ${esc(cfg.addLabel)}</button><div style="height:10px"></div>` +
        (sorted.length ? sorted.map(({ item, i }) => `<div class="card row" data-i="${i}" role="button" tabindex="0">
            <div class="grow">${cfg.renderItem(item)}</div>
            ${cfg.extraTools ? `<div class="row-tools">${cfg.extraTools(item)}</div>` : ''}
          </div>`).join('') : `<p class="empty">${esc(cfg.emptyText)}</p>`);

      container.querySelector('[data-add]').onclick = () => edit(null);
      container.querySelectorAll('.row').forEach((r) => {
        r.onclick = (e) => { if (!e.target.closest('.row-tools')) edit(+r.dataset.i); };
      });
      cfg.bindExtra?.(container, list);
    };

    const edit = (i) => {
      const isNew = i === null;
      const old = isNew ? null : list[i];
      openForm({
        title: isNew ? cfg.addLabel : `עריכת ${cfg.noun}`,
        fields: cfg.fields(),
        values: isNew ? cfg.defaults() : cfg.toForm(old),
        submitLabel: isNew ? (cfg.publishLabel || 'שמירה') : 'שמירת שינויים',
        onSubmit: async (v) => {
          const next = clone(list);
          const item = cfg.fromForm(v, old);
          if (isNew) next.push(item); else next[i] = item;
          const ok = await save(cfg.path, next, `ניהול: ${isNew ? 'הוספת' : 'עדכון'} ${cfg.noun} – ${item.title || ''}`);
          if (ok) { list = next; draw(); if (isNew && cfg.afterCreate) setTimeout(() => cfg.afterCreate(item), 50); }
          return ok;
        },
        onDelete: isNew ? null : async () => {
          const next = list.filter((_, j) => j !== i);
          const ok = await save(cfg.path, next, `ניהול: מחיקת ${cfg.noun} – ${old.title || ''}`);
          if (ok) { list = next; draw(); }
          return ok;
        }
      });
    };
    draw();
  }

  /** Grouped editor (members, links): { groups: [{ title, [itemsKey]: [] }] } */
  async function groupedEditor(container, cfg) {
    container.innerHTML = '<p class="loading">טוען…</p>';
    let data;
    try { data = await app.gh.readJSON(cfg.path, { groups: [] }); }
    catch (e) { container.innerHTML = `<div class="error">${esc(e.message)}</div>`; return; }
    data.groups = data.groups || [];
    const K = cfg.itemsKey;

    const draw = () => {
      const total = data.groups.reduce((n, g) => n + (g[K] || []).length, 0);
      container.innerHTML = blockHead(cfg.title, cfg.subtitle) +
        `<button type="button" class="btn add-btn" data-add>+ ${esc(cfg.addLabel)}</button>` +
        (total ? data.groups.map((g, gi) => (g[K] || []).length ? `
          <div class="group-label"><span>${esc(g.title || 'ללא קבוצה')}</span>
            <span><button type="button" class="link-btn" data-gup="${gi}" ${gi === 0 ? 'hidden' : ''}>↑ הזזה</button>
            <button type="button" class="link-btn" data-rename="${gi}">שינוי שם</button></span></div>
          ${g[K].map((it, ii) => `<div class="card row" data-g="${gi}" data-i="${ii}" role="button" tabindex="0">
            <div class="grow">${cfg.renderItem(it)}</div>
            <div class="row-tools">
              <button type="button" class="icon-btn" data-up aria-label="למעלה" ${ii === 0 ? 'disabled' : ''}>↑</button>
              <button type="button" class="icon-btn" data-down aria-label="למטה" ${ii === g[K].length - 1 ? 'disabled' : ''}>↓</button>
            </div></div>`).join('')}` : '').join('') : `<p class="empty">${esc(cfg.emptyText)}</p>`);

      container.querySelector('[data-add]').onclick = () => edit(null, null);
      container.querySelectorAll('.row').forEach((r) => {
        const gi = +r.dataset.g, ii = +r.dataset.i;
        r.onclick = (e) => {
          if (e.target.closest('[data-up]')) return move(gi, ii, -1);
          if (e.target.closest('[data-down]')) return move(gi, ii, 1);
          if (!e.target.closest('.row-tools')) edit(gi, ii);
        };
      });
      container.querySelectorAll('[data-rename]').forEach((b) => b.onclick = async () => {
        const gi = +b.dataset.rename;
        const name = prompt('שם חדש לקבוצה:', data.groups[gi].title || '');
        if (name === null || !name.trim()) return;
        const next = clone(data);
        next.groups[gi].title = name.trim();
        if (await save(cfg.path, next, `ניהול: שינוי שם קבוצה – ${name.trim()}`)) { data = next; draw(); }
      });
      container.querySelectorAll('[data-gup]').forEach((b) => b.onclick = async () => {
        const gi = +b.dataset.gup;
        const next = clone(data);
        [next.groups[gi - 1], next.groups[gi]] = [next.groups[gi], next.groups[gi - 1]];
        if (await save(cfg.path, next, 'ניהול: שינוי סדר קבוצות')) { data = next; draw(); }
      });
    };

    const move = async (gi, ii, dir) => {
      const next = clone(data);
      const arr = next.groups[gi][K];
      const j = ii + dir;
      if (j < 0 || j >= arr.length) return;
      [arr[ii], arr[j]] = [arr[j], arr[ii]];
      if (await save(cfg.path, next, `ניהול: שינוי סדר ${cfg.nounPlural}`)) { data = next; draw(); }
    };

    const edit = (gi, ii) => {
      const isNew = gi === null;
      const item = isNew ? {} : data.groups[gi][K][ii];
      const groupTitles = data.groups.map((g) => g.title).filter(Boolean);
      const values = { ...cfg.toForm(item), group: isNew ? (groupTitles[groupTitles.length - 1] || cfg.defaultGroup) : data.groups[gi].title };
      openForm({
        title: isNew ? cfg.addLabel : `עריכת ${cfg.noun}`,
        fields: [...cfg.fields(), { key: 'group', label: 'קבוצה', type: 'combo', options: groupTitles, required: true, help: 'אפשר לבחור קבוצה קיימת או להקליד שם חדש' }],
        values,
        onSubmit: async (v) => {
          const next = clone(data);
          const newItem = cfg.fromForm(v, item);
          const target = v.group || cfg.defaultGroup;
          if (!isNew && next.groups[gi].title === target) {
            next.groups[gi][K][ii] = newItem;
          } else {
            if (!isNew) next.groups[gi][K].splice(ii, 1);
            let g = next.groups.find((x) => x.title === target);
            if (!g) { g = { title: target, [K]: [] }; next.groups.push(g); }
            (g[K] = g[K] || []).push(newItem);
          }
          next.groups = next.groups.filter((g) => (g[K] || []).length);
          const ok = await save(cfg.path, next, `ניהול: ${isNew ? 'הוספת' : 'עדכון'} ${cfg.noun} – ${newItem.name || newItem.title || ''}`);
          if (ok) { data = next; draw(); }
          return ok;
        },
        onDelete: isNew ? null : async () => {
          const next = clone(data);
          next.groups[gi][K].splice(ii, 1);
          next.groups = next.groups.filter((g) => (g[K] || []).length);
          const ok = await save(cfg.path, next, `ניהול: מחיקת ${cfg.noun} – ${item.name || item.title || ''}`);
          if (ok) { data = next; draw(); }
          return ok;
        }
      });
    };
    draw();
  }

  // ---------- Sections ----------
  const LEVELS = [['', 'רגילה'], ['important', 'חשובה (כתום)'], ['urgent', 'דחופה (אדום)']];
  const levelBadge = (l) => l === 'urgent' ? '<span class="badge danger">דחוף</span>' : l === 'important' ? '<span class="badge warn">חשוב</span>' : '';

  function shareToWhatsApp(a) {
    const text = `*${a.title}*${a.body ? `\n${a.body}` : ''}\n\n${siteUrl()}`;
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  }
  function offerShare(a) {
    const body = openSheet('ההודעה פורסמה ✓', `
      <p>ההודעה תופיע באתר תוך כדקה-שתיים. רוצים לשלוח אותה גם לקבוצת הוואטסאפ?</p>
      <div class="form-actions">
        <a class="btn whatsapp" style="flex:1;min-height:48px" href="${esc(shareToWhatsApp(a))}" target="_blank" rel="noopener">שליחה בוואטסאפ</a>
        <button type="button" class="btn" data-close2>לא עכשיו</button>
      </div>`);
    body.querySelector('[data-close2]').onclick = closeSheet;
    body.querySelector('.whatsapp').addEventListener('click', () => setTimeout(closeSheet, 300));
  }

  function announcementCfg(path, title, subtitle) {
    return {
      path, title, subtitle,
      noun: 'הודעה',
      addLabel: 'הודעה חדשה',
      publishLabel: 'פרסום',
      emptyText: 'אין הודעות',
      sort: (a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || String(b.date).localeCompare(String(a.date)),
      fields: () => [
        { key: 'title', label: 'כותרת', required: true },
        { key: 'body', label: 'תוכן', type: 'textarea', rows: 5, help: 'קישורים יהפכו ללחיצים אוטומטית' },
        { key: 'level', label: 'דחיפות', type: 'select', options: LEVELS },
        { key: 'pinned', label: '📌 לנעוץ בראש הרשימה', type: 'checkbox' },
        { key: 'expires', label: 'להסיר אוטומטית אחרי תאריך', type: 'date', help: 'לא חובה' },
        { key: 'author', label: 'חתימה', placeholder: 'למשל: מפקד הצוות' }
      ],
      defaults: () => ({ author: LS.get('s14admin:author', '') }),
      toForm: (a) => ({ ...a }),
      fromForm: (v, old) => {
        if (v.author) LS.set('s14admin:author', v.author);
        const a = { id: old?.id || uid('msg'), date: old?.date || nowLocal(), title: v.title };
        if (v.body) a.body = v.body;
        if (v.level) a.level = v.level;
        if (v.pinned) a.pinned = true;
        if (v.expires) a.expires = v.expires;
        if (v.author) a.author = v.author;
        return a;
      },
      renderItem: (a) => {
        const expired = a.expires && a.expires < today();
        return `<div class="t">${a.pinned ? '📌 ' : ''}${esc(a.title)}</div>
          <div class="m">${levelBadge(a.level)}${expired ? '<span class="badge">פג תוקף (מוסתר)</span>' : ''}<span>${esc(fmt(a.date))}</span></div>`;
      },
      extraTools: (a) => `<a class="icon-btn" href="${esc(shareToWhatsApp(a))}" target="_blank" rel="noopener" aria-label="שליחה בוואטסאפ" style="text-decoration:none">💬</a>`,
      afterCreate: offerShare
    };
  }

  async function secAnnouncements(root) {
    root.innerHTML = '<div class="block" id="b1"></div><div class="block" id="b2"></div>';
    await flatEditor(root.querySelector('#b1'), announcementCfg(teamPath('announcements.json'), `הודעות ${teamName()}`, multiTeam() ? 'מופיעות רק לצוות הזה' : ''));
    if (multiTeam()) await flatEditor(root.querySelector('#b2'), announcementCfg('data/announcements.json', 'הודעות לכל הצוותים', 'מופיעות אצל כל הצוותים'));
    else root.querySelector('#b2').remove();
  }

  async function secTasks(root) {
    await flatEditor(root, {
      path: teamPath('tasks.json'),
      title: 'מטלות',
      noun: 'מטלה',
      addLabel: 'מטלה חדשה',
      emptyText: 'אין מטלות',
      sort: (a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')),
      fields: () => [
        { key: 'title', label: 'שם המטלה', required: true },
        { key: 'due', label: 'תג״ב (תאריך גמר ביצוע)', type: 'datetime', help: 'אם השעה לא חשובה, השאירו 23:59' },
        { key: 'description', label: 'תיאור', type: 'textarea', rows: 4 },
        { key: 'checklist', label: 'צ׳ק ליסט', type: 'lines', rows: 5, help: 'כל שורה = סעיף אחד' },
        { key: 'materials', label: 'חומר לימודי', type: 'materials', help: 'קישור ל-Drive/אתר, או העלאת קובץ (PDF, תמונה…)' }
      ],
      defaults: () => ({}),
      toForm: (t) => ({ ...t, due: t.due ? (t.due.length === 10 ? `${t.due}T23:59` : t.due) : '' }),
      fromForm: (v, old) => {
        const t = { id: old?.id || uid('task'), title: v.title };
        if (v.due) t.due = v.due.endsWith('T23:59') ? v.due.slice(0, 10) : v.due;
        if (v.description) t.description = v.description;
        if (v.checklist.length) t.checklist = v.checklist;
        if (v.materials.length) t.materials = v.materials.map((m) => ({ title: m.title || m.url, url: m.url }));
        return t;
      },
      renderItem: (t) => {
        const late = t.due && t.due.slice(0, 10) < today();
        return `<div class="t">${esc(t.title)}</div>
          <div class="m">${t.due ? `<span class="badge ${late ? '' : 'info'}">תג״ב ${esc(fmt(t.due))}</span>` : '<span class="badge">ללא תג״ב</span>'}
          ${(t.checklist || []).length ? `<span>${t.checklist.length} סעיפים</span>` : ''}
          ${(t.materials || []).length ? `<span>📎 ${t.materials.length}</span>` : ''}</div>`;
      }
    });
  }

  async function secMembers(root) {
    await groupedEditor(root, {
      path: teamPath('members.json'),
      itemsKey: 'members',
      title: `חברי ${teamName()}`,
      noun: 'חבר צוות',
      nounPlural: 'חברי צוות',
      addLabel: 'הוספת חבר צוות',
      defaultGroup: 'צוערים',
      emptyText: 'עוד לא הוזנו חברי צוות',
      fields: () => [
        { key: 'name', label: 'שם', required: true },
        { key: 'role', label: 'תפקיד', placeholder: 'למשל: מפקד צוות, צוער, רס״פ' },
        { key: 'phone', label: 'טלפון (לוואטסאפ)', type: 'tel', ltr: true, placeholder: '050-1234567' }
      ],
      toForm: (m) => ({ ...m }),
      fromForm: (v, old) => {
        const m = { ...old, name: v.name };
        v.role ? m.role = v.role : delete m.role;
        v.phone ? m.phone = v.phone : delete m.phone;
        return m;
      },
      renderItem: (m) => `<div class="t">${esc(m.name)}</div><div class="m">${esc(m.role || '')}${m.phone ? ` <span dir="ltr">${esc(m.phone)}</span>` : ''}</div>`
    });
  }

  function linksCfg(path, title, subtitle) {
    return {
      path, title, subtitle,
      itemsKey: 'links',
      noun: 'קישור',
      nounPlural: 'קישורים',
      addLabel: 'קישור חדש',
      defaultGroup: 'שימושי',
      emptyText: 'אין קישורים',
      fields: () => [
        { key: 'title', label: 'שם', required: true },
        { key: 'url', label: 'כתובת', type: 'url', ltr: true, required: true, placeholder: 'https://' },
        { key: 'icon', label: 'אימוג׳י', placeholder: '🔗', help: 'לא חובה' },
        { key: 'description', label: 'תיאור קצר', help: 'לא חובה' }
      ],
      toForm: (l) => ({ ...l }),
      fromForm: (v) => {
        const l = { title: v.title, url: /^[a-z]+:/i.test(v.url) || v.url.startsWith('files/') ? v.url : `https://${v.url}` };
        if (v.icon) l.icon = v.icon;
        if (v.description) l.description = v.description;
        return l;
      },
      renderItem: (l) => `<div class="t">${esc(l.icon || '🔗')} ${esc(l.title)}</div><div class="m" dir="ltr" style="justify-content:flex-end">${esc(l.url)}</div>`
    };
  }

  async function secLinks(root) {
    root.innerHTML = '<div class="block" id="b1"></div><div class="block" id="b2"></div>';
    await groupedEditor(root.querySelector('#b1'), linksCfg(teamPath('links.json'), multiTeam() ? `קישורים ל${teamName()}` : 'קישורים', ''));
    if (multiTeam()) await groupedEditor(root.querySelector('#b2'), linksCfg('data/links.json', 'קישורים לכל הצוותים', 'מופיעים אצל כל הצוותים'));
    else root.querySelector('#b2').remove();
  }

  async function secSchedule(root) {
    root.innerHTML = '<p class="loading">טוען…</p>';
    const path = teamPath('schedule.json');
    let data;
    try { data = await app.gh.readJSON(path, { images: [] }); }
    catch (e) { root.innerHTML = `<div class="error">${esc(e.message)}</div>`; return; }
    data.images = data.images || [];
    data.googleCalendar = data.googleCalendar || {};

    const commit = async (next, msg) => {
      next.updated = today();
      if (await save(path, next, msg)) { data = next; draw(); return true; }
      return false;
    };

    const draw = () => {
      const cal = data.googleCalendar;
      const thumb = (src) => /^https?:/.test(src) ? src : app.gh.rawUrl(src);
      root.innerHTML = `
        <div class="block">
          ${blockHead('צילום / תמונה של הלו״ז', 'מצלמים את הלו״ז ומעלים. אפשר כמה תמונות')}
          <button type="button" class="btn add-btn" data-upload>📷 העלאת תמונה</button><div style="height:10px"></div>
          ${data.images.length ? data.images.map((im, i) => `<div class="card row" data-i="${i}">
              <img class="thumb" src="${esc(thumb(im.src))}" alt="" loading="lazy">
              <div class="grow"><div class="t">${esc(im.caption || 'ללא כיתוב')}</div></div>
              <div class="row-tools">
                <button type="button" class="icon-btn" data-up ${i === 0 ? 'disabled' : ''} aria-label="למעלה">↑</button>
                <button type="button" class="icon-btn" data-edit aria-label="עריכה">✏️</button>
              </div></div>`).join('') : '<p class="empty">אין תמונות</p>'}
        </div>
        <div class="block">
          ${blockHead('יומן Google', cal.calendarId || cal.embedUrl ? 'מחובר ✓' : 'לא מחובר')}
          <div class="card"><form class="form" id="cal-form">
            ${fieldHtml({ key: 'calendarId', label: 'מזהה היומן (Calendar ID)', type: 'url', ltr: true, placeholder: 'xxxx@group.calendar.google.com',
              help: 'ביומן גוגל (במחשב או במצב "אתר למחשב"): הגדרות היומן ← הרשאות גישה ← "פרסום לציבור". ואז ב"שילוב היומן" מעתיקים את מזהה היומן' }, [].concat(cal.calendarIds || cal.calendarId || []).join(', '))}
            ${fieldHtml({ key: 'publicUrl', label: 'קישור להוספת היומן (לא חובה)', type: 'url', ltr: true, help: 'מאפשר לצוערים להוסיף את היומן ל-Google Calendar שלהם' }, cal.publicUrl)}
            ${fieldHtml({ key: 'defaultView', label: 'מה מוצג קודם', type: 'select', options: [['', 'יומן'], ['images', 'תמונה']] }, data.defaultView || '')}
            ${fieldHtml({ key: 'note', label: 'הערה מעל הלו״ז (לא חובה)', type: 'textarea', rows: 2 }, data.note)}
            <div class="form-actions"><button type="submit" class="btn primary">שמירה</button></div>
          </form></div>
        </div>`;

      root.querySelector('[data-upload]').onclick = async (e) => {
        const file = await pickFile('image/*');
        if (!file) return;
        const btn = e.target; btn.disabled = true; btn.textContent = 'מעלה…';
        try {
          const src = await uploadFile(file, 'schedule', { asImage: true });
          const caption = prompt('כיתוב לתמונה (לא חובה):', `לו״ז ${fmt(today())}`) || '';
          const next = clone(data);
          next.images.unshift({ src, ...(caption ? { caption } : {}) });
          next.defaultView = next.defaultView || (next.googleCalendar.calendarId ? '' : 'images');
          if (await commit(next, 'ניהול: העלאת תמונת לו״ז')) return;
        } catch (err) { toast(err.message, true, 6000); }
        btn.disabled = false; btn.textContent = '📷 העלאת תמונה';
      };
      root.querySelectorAll('.row').forEach((r) => {
        const i = +r.dataset.i;
        r.querySelector('[data-up]').onclick = () => {
          const next = clone(data);
          [next.images[i - 1], next.images[i]] = [next.images[i], next.images[i - 1]];
          commit(next, 'ניהול: שינוי סדר תמונות לו״ז');
        };
        r.querySelector('[data-edit]').onclick = () => openForm({
          title: 'עריכת תמונה',
          fields: [{ key: 'caption', label: 'כיתוב' }],
          values: data.images[i],
          onSubmit: (v) => {
            const next = clone(data);
            v.caption ? next.images[i].caption = v.caption : delete next.images[i].caption;
            return commit(next, 'ניהול: עדכון כיתוב לו״ז');
          },
          onDelete: async () => {
            const next = clone(data);
            const [removed] = next.images.splice(i, 1);
            const ok = await commit(next, 'ניהול: מחיקת תמונת לו״ז');
            if (ok && removed.src.startsWith(`files/${app.teamId}/`)) {
              app.gh.deleteFile(removed.src, 'ניהול: מחיקת קובץ תמונה').catch(() => {});
            }
            return ok;
          }
        });
      });
      root.querySelector('#cal-form').onsubmit = async (e) => {
        e.preventDefault();
        const f = e.target;
        const btn = f.querySelector('[type="submit"]'); btn.disabled = true; btn.textContent = 'שומר…';
        const ids = f.elements.calendarId.value.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
          .map((s) => { // accept a full embed/share link too
            try { const u = new URL(s); return u.searchParams.get('src') || u.searchParams.get('cid') || s; } catch { return s; }
          });
        const next = clone(data);
        next.googleCalendar = {};
        if (ids.length === 1) next.googleCalendar.calendarId = ids[0];
        if (ids.length > 1) next.googleCalendar.calendarIds = ids;
        if (f.elements.publicUrl.value.trim()) next.googleCalendar.publicUrl = f.elements.publicUrl.value.trim();
        f.elements.defaultView.value ? next.defaultView = f.elements.defaultView.value : delete next.defaultView;
        f.elements.note.value.trim() ? next.note = f.elements.note.value.trim() : delete next.note;
        if (!(await commit(next, 'ניהול: עדכון הגדרות יומן'))) { btn.disabled = false; btn.textContent = 'שמירה'; }
      };
    };
    draw();
  }

  async function secSettings(root) {
    root.innerHTML = '<p class="loading">טוען…</p>';
    let site;
    try { site = await app.gh.readJSON('data/site.json'); }
    catch (e) { root.innerHTML = `<div class="error">${esc(e.message)}</div>`; return; }

    const commitSite = async (next, msg) => {
      if (await save('data/site.json', next, msg)) { site = next; app.site = { ...app.site, ...next }; fillTeamSelect(); draw(); return true; }
      return false;
    };

    const draw = () => {
      root.innerHTML = `
        <div class="block">${blockHead('כללי')}
          <div class="card"><form class="form" id="site-form">
            ${fieldHtml({ key: 'siteName', label: 'שם האתר', required: true }, site.siteName)}
            ${fieldHtml({ key: 'unitName', label: 'יחידה (מופיע מתחת לשם הצוות)' }, site.unitName)}
            ${fieldHtml({ key: 'globalLabel', label: 'תווית להודעות של כל הצוותים', placeholder: 'כללי / פלוגה / גדוד' }, site.globalLabel)}
            <div class="form-actions"><button type="submit" class="btn primary">שמירה</button></div>
          </form></div>
        </div>
        <div class="block">${blockHead('צוותים', 'אפשר להוסיף צוותים נוספים. לכל צוות תוכן נפרד')}
          ${site.teams.map((t, i) => `<div class="card row" data-i="${i}" role="button" tabindex="0">
            <div class="grow"><div class="t">${esc(t.name)}</div><div class="m"><span dir="ltr">${esc(t.id)}</span>${t.id === site.defaultTeam ? '<span class="badge ok">ברירת מחדל</span>' : ''}</div></div>
          </div>`).join('')}
          <button type="button" class="btn add-btn" data-add>+ צוות חדש</button>
        </div>
        <div class="block">${blockHead('חשבון')}
          <div class="card"><p style="margin:0 0 10px">מחובר/ת בתור <b>${esc(app.user || '')}</b></p>
          <button type="button" class="btn danger" data-logout>התנתקות מהמכשיר הזה</button></div>
        </div>`;

      root.querySelector('#site-form').onsubmit = async (e) => {
        e.preventDefault();
        const f = e.target;
        const next = clone(site);
        ['siteName', 'unitName', 'globalLabel'].forEach((k) => { const v = f.elements[k].value.trim(); v ? next[k] = v : delete next[k]; });
        await commitSite(next, 'ניהול: עדכון הגדרות אתר');
      };
      root.querySelector('[data-logout]').onclick = () => { if (confirm('להתנתק?')) { LS.del('s14admin:token'); location.reload(); } };

      root.querySelectorAll('.row').forEach((r) => r.onclick = () => {
        const i = +r.dataset.i;
        const t = site.teams[i];
        openForm({
          title: 'עריכת צוות',
          fields: [{ key: 'name', label: 'שם הצוות', required: true }, { key: 'isDefault', label: 'צוות ברירת מחדל (נפתח ראשון)', type: 'checkbox' }],
          values: { name: t.name, isDefault: t.id === site.defaultTeam },
          onSubmit: (v) => {
            const next = clone(site);
            next.teams[i].name = v.name;
            if (v.isDefault) next.defaultTeam = t.id;
            return commitSite(next, `ניהול: עדכון צוות – ${v.name}`);
          }
        });
      });

      root.querySelector('[data-add]').onclick = () => openForm({
        title: 'צוות חדש',
        fields: [
          { key: 'name', label: 'שם הצוות', required: true, placeholder: 'צוות 15' },
          { key: 'id', label: 'מזהה באנגלית (יופיע בקישור)', ltr: true, required: true, placeholder: 'team-15', help: 'אותיות באנגלית קטנות, ספרות ומקף בלבד. אי אפשר לשנות אחר כך' }
        ],
        submitLabel: 'יצירת צוות',
        onSubmit: async (v) => {
          const id = v.id.toLowerCase();
          if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) { toast('מזהה לא תקין: רק a-z, 0-9 ומקף', true); return false; }
          if (site.teams.some((t) => t.id === id)) { toast('כבר קיים צוות עם המזהה הזה', true); return false; }
          try {
            const files = {
              'announcements.json': [], 'tasks.json': [],
              'members.json': { whatsappMessage: 'היי, ', groups: [] },
              'links.json': { groups: [] },
              'schedule.json': { googleCalendar: {}, images: [] }
            };
            for (const [f, content] of Object.entries(files)) {
              await app.gh.putBase64(`data/teams/${id}/${f}`, textToB64(JSON.stringify(content, null, 2) + '\n'), `ניהול: יצירת צוות ${v.name}`);
            }
          } catch (e) { toast(e.message, true, 6000); return false; }
          const next = clone(site);
          next.teams.push({ id, name: v.name });
          return commitSite(next, `ניהול: הוספת צוות – ${v.name}`);
        }
      });
    };
    draw();
  }

  const SECTIONS = { announcements: secAnnouncements, tasks: secTasks, schedule: secSchedule, members: secMembers, links: secLinks, settings: secSettings };

  async function renderSection() {
    const sec = SECTIONS[app.section] ? app.section : 'announcements';
    app.section = sec;
    LS.set('s14admin:section', sec);
    nav.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.sec === sec));
    view.innerHTML = '';
    await SECTIONS[sec](view);
  }

  function fillTeamSelect() {
    const teams = app.site.teams || [];
    teamSelect.hidden = teams.length < 2;
    teamSelect.innerHTML = teams.map((t) => `<option value="${esc(t.id)}" ${t.id === app.teamId ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
  }

  // ---------- Login ----------
  function tokenLink() {
    const { owner } = app.site.github;
    const p = new URLSearchParams({
      name: `${app.site.siteName || 'Standard14'} admin`,
      description: 'עדכון תוכן באתר',
      target_name: owner,
      expires_in: '366',
      contents: 'write'
    });
    return `https://github.com/settings/personal-access-tokens/new?${p}`;
  }

  function renderLogin(errMsg) {
    nav.hidden = true;
    const { owner, repo } = app.site.github;
    view.innerHTML = `<div class="login">
      <div class="card">
        <h2>כניסה לניהול</h2>
        <p>מדביקים את מפתח הגישה (Token) מ-GitHub. צריך לעשות את זה רק פעם אחת בכל מכשיר.</p>
        ${errMsg ? `<div class="error" style="margin-bottom:12px">${esc(errMsg)}</div>` : ''}
        <form class="form" id="login">
          ${fieldHtml({ key: 'token', label: 'מפתח גישה', ltr: true, required: true, placeholder: 'github_pat_…' }, '')}
          ${fieldHtml({ key: 'author', label: 'השם שלך', placeholder: 'יופיע כחתימה על הודעות', help: 'לא חובה' }, LS.get('s14admin:author', ''))}
          <div class="form-actions"><button type="submit" class="btn primary">כניסה</button></div>
        </form>
        <details class="help">
          <summary>איך משיגים מפתח גישה?</summary>
          <ol>
            <li>צריך משתמש GitHub עם הרשאה למאגר <code dir="ltr">${esc(owner)}/${esc(repo)}</code> (בעל המאגר מוסיף אתכם ב-Settings ← Collaborators).</li>
            <li><a href="${esc(tokenLink())}" target="_blank" rel="noopener">לחצו כאן ליצירת מפתח</a> (נפתח ב-GitHub).</li>
            <li>ב-<b>Repository access</b>: לבחור <b>Only select repositories</b> ← <code dir="ltr">${esc(repo)}</code>.</li>
            <li>ב-<b>Permissions</b>: להוסיף <b>Contents</b> ← <b>Read and write</b>.</li>
            <li>ללחוץ <b>Generate token</b>, להעתיק ולהדביק כאן.</li>
          </ol>
          <p style="margin-top:10px">המפתח נשמר רק בטלפון הזה ומאפשר לערוך רק את המאגר הזה. לא לשתף אותו.</p>
        </details>
      </div></div>`;
    view.querySelector('input[name="token"]').type = 'password';
    view.querySelector('#login').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const token = f.elements.token.value.trim();
      if (f.elements.author.value.trim()) LS.set('s14admin:author', f.elements.author.value.trim());
      const btn = f.querySelector('[type="submit"]'); btn.disabled = true; btn.textContent = 'בודק…';
      const ok = await tryLogin(token);
      if (!ok) { btn.disabled = false; btn.textContent = 'כניסה'; }
    };
  }

  async function tryLogin(token) {
    const gh = new GitHub(app.site.github, token);
    try {
      const repoInfo = await gh.req('GET', '');
      if (!repoInfo.permissions?.push) throw new Error('למפתח אין הרשאת כתיבה למאגר');
      let user = '';
      try {
        const r = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${token}` } });
        if (r.ok) user = (await r.json()).login;
      } catch { /* ignore */ }
      LS.set('s14admin:token', token);
      app.gh = gh;
      app.user = LS.get('s14admin:author', '') || user;
      document.getElementById('who').textContent = app.user ? `שלום ${app.user}` : (app.site.siteName || 'סטנדרט 14');
      startAdmin();
      return true;
    } catch (e) {
      if (!(e instanceof TypeError)) LS.del('s14admin:token'); // keep the key when offline
      renderLogin(e instanceof TypeError ? 'אין חיבור לאינטרנט' : e.message);
      return false;
    }
  }

  function startAdmin() {
    nav.hidden = false;
    fillTeamSelect();
    nav.querySelectorAll('button').forEach((b) => b.onclick = () => { app.section = b.dataset.sec; renderSection(); window.scrollTo(0, 0); });
    teamSelect.onchange = () => { app.teamId = teamSelect.value; LS.set('s14admin:team', app.teamId); renderSection(); };
    renderSection();
  }

  async function init() {
    try {
      const res = await fetch('data/site.json', { cache: 'no-cache' });
      app.site = await res.json();
    } catch {
      view.innerHTML = '<div class="error">לא הצלחתי לטעון את data/site.json</div>';
      return;
    }
    // Defaults for repo location (owner.github.io/repo)
    const guessOwner = location.hostname.endsWith('.github.io') ? location.hostname.split('.')[0] : '';
    const guessRepo = location.pathname.split('/').filter(Boolean)[0] || '';
    app.site.github = { owner: guessOwner, repo: guessRepo, branch: 'main', ...(app.site.github || {}) };

    const teams = app.site.teams || [];
    const saved = LS.get('s14admin:team');
    app.teamId = (teams.find((t) => t.id === saved) || teams.find((t) => t.id === app.site.defaultTeam) || teams[0] || {}).id;
    app.section = LS.get('s14admin:section', 'announcements');

    const token = LS.get('s14admin:token');
    if (token) {
      view.innerHTML = '<p class="loading">מתחבר…</p>';
      await tryLogin(token);
    } else renderLogin();
  }

  init();
})();
