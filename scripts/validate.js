// בדיקה שכל קבצי ה-JSON תקינים לפני העלאה לאוויר
const fs = require('fs');
const path = require('path');

let errors = 0;
const fail = (file, msg) => { errors++; console.error(`::error file=${file}::${msg}`); };

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}

const files = walk('data').filter((f) => f.endsWith('.json'));
const parsed = {};
for (const f of files) {
  try { parsed[f] = JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch (e) { fail(f, `JSON לא תקין: ${e.message} (בדקו פסיקים ומרכאות)`); }
}

const site = parsed[path.join('data', 'site.json')];
if (site) {
  if (!Array.isArray(site.teams) || !site.teams.length) fail('data/site.json', 'חסרה רשימת teams');
  for (const t of site.teams || []) {
    if (!fs.existsSync(path.join('data', 'teams', t.id))) fail('data/site.json', `אין תיקייה data/teams/${t.id}`);
  }
}

const dateRe = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?$/;
for (const [f, data] of Object.entries(parsed)) {
  if (f.endsWith('tasks.json')) {
    const ids = new Set();
    (data || []).forEach((t, i) => {
      if (!t.id) fail(f, `למטלה מספר ${i + 1} חסר id`);
      if (ids.has(t.id)) fail(f, `id כפול: ${t.id}`);
      ids.add(t.id);
      if (t.due && !dateRe.test(t.due)) fail(f, `תאריך לא תקין במטלה ${t.id}: ${t.due} (פורמט: 2026-11-20 או 2026-11-20T18:00)`);
    });
  }
  if (f.endsWith('announcements.json')) {
    (data || []).forEach((a, i) => {
      if (a.date && !dateRe.test(a.date)) fail(f, `תאריך לא תקין בהודעה ${i + 1}: ${a.date}`);
    });
  }
}

if (errors) { console.error(`נמצאו ${errors} שגיאות`); process.exit(1); }
console.log(`✓ ${files.length} קבצים תקינים`);
