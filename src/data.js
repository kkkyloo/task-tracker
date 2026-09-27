import { toMin, fromMin, spanMin, normalizeHM, uid } from './util.js';

export const emptyData = () => ({
  v: 2,
  tasks: {},
  classes: {},
  work: {},
  settings: { weeklyTarget: 40, accent: 'indigo', density: 'normal', hideWeekends: false, showTimeline: true, updatedAt: 0 },
});

export const normalize = (raw) => {
  const d = emptyData();
  if (!raw || typeof raw !== 'object') return d;
  if (raw.v !== 2) return migrateLegacy(raw);
  d.tasks = raw.tasks && typeof raw.tasks === 'object' ? raw.tasks : {};
  d.classes = raw.classes && typeof raw.classes === 'object' ? raw.classes : {};
  d.work = raw.work && typeof raw.work === 'object' ? raw.work : {};
  d.settings = { ...d.settings, ...Object.fromEntries(Object.entries(raw.settings || {}).filter(([k]) => k in d.settings)) };
  return d;
};

const parsePairTime = (time) => {
  const m = String(time || '').match(/(\d{1,2}:\d{2})\D+(\d{1,2}:\d{2})/);
  return m ? { start: normalizeHM(m[1]), end: normalizeHM(m[2]) } : { start: '', end: '' };
};

export const makeClass = (c) => {
  const t = c.start && c.end ? { start: c.start, end: c.end } : parsePairTime(c.time);
  return {
    id: String(c.id || uid()),
    start: t.start,
    end: t.end,
    subject: c.subject || '',
    type: c.type === 'зачет' ? 'зачёт' : c.type || 'лекция',
    room: c.room || '',
    teacher: c.teacher || '',
  };
};

export const sortClasses = (items) => [...items].sort((a, b) => (toMin(a.start) ?? 9999) - (toMin(b.start) ?? 9999));

const splitByBreaks = (start, end, breaks) => {
  const s = toMin(start);
  let e = toMin(end);
  if (s == null || e == null) return [];
  if (e < s) e += 1440;
  const cuts = (breaks || [])
    .map((b) => {
      let bs = toMin(b.start);
      let be = toMin(b.end);
      if (bs == null || be == null) return null;
      if (bs < s) bs += 1440;
      if (be < bs) be += 1440;
      return [Math.max(bs, s), Math.min(be, e)];
    })
    .filter((b) => b && b[1] > b[0])
    .sort((a, b) => a[0] - b[0]);
  const out = [];
  let cur = s;
  for (const [bs, be] of cuts) {
    if (bs > cur) out.push([cur, bs]);
    cur = Math.max(cur, be);
  }
  if (e > cur) out.push([cur, e]);
  return out.map(([a, b]) => ({ id: uid(), start: fromMin(a % 1440), end: fromMin(b % 1440) }));
};

export const migrateLegacy = (old) => {
  const d = emptyData();
  for (const t of old.tasks || []) {
    if (t.type === 'work') continue;
    const id = String(t.id);
    const created = Number(t.id) > 1e12 ? Number(t.id) : 1;
    d.tasks[id] = {
      id,
      text: String(t.text || '').trim(),
      date: t.date || '',
      done: !!t.isDone,
      deadline: t.color === 'red' || !!t.isUrgent,
      color: ['orange', 'green', 'blue'].includes(t.color) ? t.color : '',
      createdAt: created,
      updatedAt: 1,
    };
  }
  for (const [date, w] of Object.entries(old.work || {})) {
    let start = w.start;
    let end = w.end;
    if ((!start || !end) && w.range) {
      const m = String(w.range).match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
      if (m) { start = m[1]; end = m[2]; }
    }
    const sessions = start && end ? splitByBreaks(normalizeHM(start), normalizeHM(end), w.breaks) : [];
    const hours = parseFloat(w.hours);
    const manualMin = !sessions.length && hours > 0 ? Math.round(hours * 60) : 0;
    if (sessions.length || manualMin) d.work[date] = { sessions, manualMin, updatedAt: 1 };
  }
  for (const [date, list] of Object.entries(old.classes || {})) {
    if (Array.isArray(list) && list.length) {
      d.classes[date] = { items: sortClasses(list.map(makeClass)), updatedAt: 1 };
    }
  }
  return d;
};

const mergeMap = (a = {}, b = {}) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (!out[k] || (v.updatedAt || 0) > (out[k].updatedAt || 0)) out[k] = v;
  }
  return out;
};

export const merge = (a, b) => ({
  v: 2,
  tasks: mergeMap(a.tasks, b.tasks),
  classes: mergeMap(a.classes, b.classes),
  work: mergeMap(a.work, b.work),
  settings: (b.settings?.updatedAt || 0) > (a.settings?.updatedAt || 0) ? b.settings : a.settings,
});

const stable = (v) => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
};

export const sameData = (a, b) => stable(a) === stable(b);

export const sessionMin = (s, now = Date.now()) => {
  if (s.end) return spanMin(s.start, s.end);
  if (s.startedAt) return Math.max(0, Math.floor((now - s.startedAt) / 60000));
  return 0;
};

export const dayWorkMin = (w, now) => {
  if (!w) return 0;
  return (w.sessions || []).reduce((acc, s) => acc + sessionMin(s, now), 0) + (Number(w.manualMin) || 0);
};

export const findRunning = (data) => {
  for (const [date, w] of Object.entries(data.work)) {
    const s = (w.sessions || []).find((x) => !x.end);
    if (s) return { date, session: s };
  }
  return null;
};

export const liveTasks = (data) => Object.values(data.tasks).filter((t) => !t.deleted);

export const sortTasks = (list) =>
  [...list].sort((a, b) => Number(a.done) - Number(b.done) || Number(b.deadline) - Number(a.deadline) || (a.createdAt || 0) - (b.createdAt || 0));
