export const DOW_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
export const DOW_FULL = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
export const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

export const pad = (n) => String(n).padStart(2, '0');

export const dateKey = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;

export const parseKey = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const todayKey = () => dateKey(new Date());

export const addDays = (key, n) => {
  const dt = parseKey(key);
  dt.setDate(dt.getDate() + n);
  return dateKey(dt);
};

export const weekStart = (key) => {
  const dt = parseKey(key);
  const shift = (dt.getDay() + 6) % 7;
  dt.setDate(dt.getDate() - shift);
  return dateKey(dt);
};

export const weekDays = (startKey) => Array.from({ length: 7 }, (_, i) => addDays(startKey, i));

export const formatDay = (key) => {
  const dt = parseKey(key);
  return `${dt.getDate()} ${MONTHS_GEN[dt.getMonth()]}`;
};

export const formatRange = (fromKey, toKey) => {
  const a = parseKey(fromKey);
  const b = parseKey(toKey);
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ${MONTHS_GEN[b.getMonth()]}`;
  return `${a.getDate()} ${MONTHS_SHORT[a.getMonth()]} – ${b.getDate()} ${MONTHS_SHORT[b.getMonth()]}`;
};

export const nowHM = () => {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const toMin = (hm) => {
  if (!hm || !/^\d{1,2}:\d{2}$/.test(hm)) return null;
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
};

export const fromMin = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;

export const normalizeHM = (raw) => {
  if (raw == null) return '';
  const s = String(raw).trim();
  if (!s) return '';
  let h;
  let m;
  const sep = s.match(/^(\d{1,2})\s*[:.,\s-]\s*(\d{1,2})$/);
  if (sep) {
    h = +sep[1];
    m = +sep[2];
  } else {
    const d = s.replace(/\D/g, '');
    if (!d) return '';
    if (d.length <= 2) { h = +d; m = 0; }
    else if (d.length === 3) { h = +d.slice(0, 1); m = +d.slice(1); }
    else { h = +d.slice(0, 2); m = +d.slice(2, 4); }
  }
  if (h === 24) h = 0;
  h = Math.min(23, Math.max(0, h));
  m = Math.min(59, Math.max(0, m));
  return `${pad(h)}:${pad(m)}`;
};

export const spanMin = (start, end) => {
  const s = toMin(start);
  const e = toMin(end);
  if (s == null || e == null) return 0;
  return e >= s ? e - s : e + 1440 - s;
};

export const formatDur = (min, { zero = '0ч' } = {}) => {
  const total = Math.round(Math.abs(min));
  if (!total) return zero;
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m}м`;
  return m ? `${h}ч ${m}м` : `${h}ч`;
};

export const formatClock = (ms) => {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${pad(m)}:${pad(s)}`;
};

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const store = {
  get(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  },
  set(key, val) {
    try { localStorage.setItem(key, val); } catch (e) {}
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch (e) {}
  },
};
