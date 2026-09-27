import { normalizeHM, uid } from './util.js';

const TYPE_PREFIX = [
  [/^лаб/, 'лабораторная'],
  [/^лек/, 'лекция'],
  [/^пр/, 'практика'],
  [/^сем/, 'семинар'],
  [/^экз/, 'экзамен'],
  [/^(зач|дифф)/, 'зачёт'],
];

export const CLASS_TYPES = ['лекция', 'практика', 'лабораторная', 'семинар', 'зачёт', 'экзамен'];

export const typeShort = (t) =>
  ({ 'лекция': 'Лек', 'практика': 'Пр', 'лабораторная': 'Лаб', 'семинар': 'Сем', 'зачёт': 'Зач', 'зачет': 'Зач', 'экзамен': 'Экз' })[t] || t;

export const parseSchedule = (raw) => {
  const lines = String(raw || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const byDate = {};
  let date = null;
  let item = null;

  const flush = () => {
    if (date && item && item.subject) (byDate[date] = byDate[date] || []).push(item);
    item = null;
  };

  for (const line of lines) {
    const dm = line.match(/^(?:[А-Яа-яё]+,?\s*)?(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
    if (dm) {
      flush();
      date = `${dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`;
      continue;
    }
    if (/^(понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)$/i.test(line)) {
      flush();
      continue;
    }
    const tm = line.match(/^(\d{1,2}:\d{2})\s*(?:—|–|-|до|\s)\s*(\d{1,2}:\d{2})$/);
    if (tm) {
      flush();
      item = { id: uid(), start: normalizeHM(tm[1]), end: normalizeHM(tm[2]), subject: '', type: 'лекция', room: '', teacher: '' };
      continue;
    }
    if (!item) continue;
    if (/^\d+-е\s+занятие$/i.test(line)) continue;

    const isTeacherOrRoom =
      /(?:Аудитория|Ауд\.?|Кабинет|Каб\.?):/i.test(line) ||
      /^(?:ст\.?\s*пр\.?|доц\.?|проф\.?|зав\.?\s*к\.?|преп\.?|асс\.?)/i.test(line) ||
      /@/.test(line);
    if (isTeacherOrRoom) {
      let rest = line;
      const rm = rest.match(/(?:Аудитория|Ауд\.?|Кабинет|Каб\.?):\s*(.+)$/i);
      if (rm) {
        item.room = rm[1].trim();
        rest = rest.replace(rm[0], '');
      }
      rest = rest
        .replace(/\(\s*\[?[\w.%+-]+@[\w.-]+\.[a-z]{2,}\]?(?:\([^)]*\))?\s*\)/gi, '')
        .replace(/\[?[\w.%+-]+@[\w.-]+\.[a-z]{2,}\]?(?:\([^)]*\))?/gi, '')
        .replace(/[,;\s]+$/, '')
        .trim();
      if (rest) item.teacher = rest;
      continue;
    }
    const typed = line.match(/^(лаб\.?|лек\.?|пр\.?|сем\.?|экз\.?|зач\.?|дифф\.?\s*зач\.?)\s+(.+)$/i);
    if (typed) {
      const p = typed[1].toLowerCase();
      const found = TYPE_PREFIX.find(([re]) => re.test(p));
      if (found) item.type = found[1];
      item.subject = typed[2].trim();
      continue;
    }
    if (!item.subject) item.subject = line;
  }
  flush();
  return byDate;
};
