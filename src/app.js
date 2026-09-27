import { html, render, useState, useEffect, useRef, useMemo, useCallback } from '../vendor/preact-htm.js';
import {
  DOW_SHORT, DOW_FULL, MONTHS_NOM, dateKey, parseKey, todayKey, addDays, weekStart, weekDays, formatDay, formatRange,
  nowHM, toMin, fromMin, formatDur, formatClock, uid, store,
} from './util.js';
import {
  emptyData, normalize, merge, sameData, makeClass, sortClasses, sessionMin, dayWorkMin, findRunning, liveTasks, sortTasks,
} from './data.js';
import {
  loadConfig, saveConfig, syncOnce, createGist, findGist, makeSetupLink, consumeSetupLink, decrypt, PinError,
} from './sync.js';
import { parseSchedule, CLASS_TYPES, typeShort } from './schedule.js';
import { Icon } from './icons.js';
import { Workspace } from './workspace.js';
import { configureMedia, flushUploads, retryMissing } from './media.js';

const VERSION = '4.6.0';

const TASK_COLORS = [
  ['', 'Без цвета'],
  ['red', 'Красный'],
  ['orange', 'Оранжевый'],
  ['yellow', 'Жёлтый'],
  ['green', 'Зелёный'],
  ['blue', 'Синий'],
  ['purple', 'Фиолетовый'],
];

const ACCENTS = [
  ['indigo', 'Индиго'],
  ['blue', 'Синий'],
  ['teal', 'Бирюзовый'],
  ['green', 'Зелёный'],
  ['orange', 'Оранжевый'],
  ['pink', 'Розовый'],
];

const applyLook = (s) => {
  const root = document.documentElement;
  root.dataset.accent = s.accent || 'indigo';
  root.dataset.density = s.density || 'normal';
};
const DATA_KEY = 'tt2_data';
const THEME_KEY = 'tt2_theme';
const DAY_START = 7 * 60;
const DAY_END = 23 * 60;

const loadLocal = () => {
  try {
    const raw = store.get(DATA_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) {}
  return emptyData();
};

const applyTheme = (t) => {
  const root = document.documentElement;
  if (t === 'light' || t === 'dark') root.dataset.theme = t;
  else delete root.dataset.theme;
};

const URL_RE = /(https?:\/\/[^\s]+)/g;
const linkify = (text) =>
  String(text).split(URL_RE).map((part, i) =>
    i % 2 ? html`<a href=${part} target="_blank" rel="noopener" onClick=${(e) => e.stopPropagation()}>${part.replace(/^https?:\/\//, '').slice(0, 40)}${part.length > 48 ? '…' : ''}</a>` : part,
  );

const dayLabel = (key, today) => {
  if (key === today) return 'Сегодня';
  if (key === addDays(today, 1)) return 'Завтра';
  if (key === addDays(today, -1)) return 'Вчера';
  return DOW_FULL[parseKey(key).getDay()];
};

function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return html`
    <div class="overlay" onMouseDown=${(e) => e.target === e.currentTarget && onClose()}>
      <div class=${`sheet ${wide ? 'wide' : ''}`} role="dialog" aria-label=${title}>
        <div class="sheet-head">
          <h2>${title}</h2>
          <button class="icon-btn" onClick=${onClose} aria-label="Закрыть">${Icon.x()}</button>
        </div>
        <div class="sheet-body">${children}</div>
      </div>
    </div>`;
}

function Timeline({ classes, sessions, isToday, now }) {
  const range = DAY_END - DAY_START;
  const seg = (s, e) => {
    let a = toMin(s);
    let b = e ? toMin(e) : null;
    if (a == null) return null;
    if (b == null) b = isToday ? new Date(now).getHours() * 60 + new Date(now).getMinutes() : a;
    if (b < a) b = DAY_END;
    a = Math.max(DAY_START, a);
    b = Math.min(DAY_END, b);
    if (b <= a) return null;
    return { left: `${((a - DAY_START) / range) * 100}%`, width: `${((b - a) / range) * 100}%` };
  };
  const nowDate = new Date(now);
  const nowMin = nowDate.getHours() * 60 + nowDate.getMinutes();
  return html`
    <div class="timeline" aria-hidden="true">
      ${[9, 12, 15, 18, 21].map((h) => html`<i class="tick" style=${{ left: `${((h * 60 - DAY_START) / range) * 100}%` }}><span>${h}</span></i>`)}
      <div class="lane lane-class">
        ${classes.map((c) => { const st = seg(c.start, c.end); return st && html`<b style=${st}></b>`; })}
      </div>
      <div class="lane lane-work">
        ${sessions.map((s) => { const st = seg(s.start, s.end); return st && html`<b class=${s.end ? '' : 'live'} style=${st}></b>`; })}
      </div>
      ${isToday && nowMin > DAY_START && nowMin < DAY_END && html`<i class="now" style=${{ left: `${((nowMin - DAY_START) / range) * 100}%` }}></i>`}
    </div>`;
}

function TaskRow({ task, onToggle, onOpen, onDelete, today, showDate, action }) {
  const onDragStart = (e) => {
    e.dataTransfer.setData('text/task-id', task.id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const overdue = !task.done && task.date && task.date < today;
  return html`
    <li class=${`task ${task.done ? 'done' : ''} ${task.deadline ? 'deadline' : ''} ${task.color ? `tc tc-${task.color}` : ''}`} draggable="true" onDragStart=${onDragStart}>
      <button class="check" onClick=${() => onToggle(task)} aria-label=${task.done ? 'Вернуть' : 'Готово'}>${task.done && Icon.check(14)}</button>
      <div class="task-main" onClick=${() => onOpen(task)}>
        <span class="task-text">${linkify(task.text)}</span>
        ${(task.deadline || showDate) && html`
          <span class="task-meta">
            ${task.deadline && html`<span class="chip chip-red">${Icon.flag(12)} дедлайн</span>`}
            ${showDate && task.date && html`<span class=${`chip ${overdue ? 'chip-red-soft' : ''}`}>${DOW_SHORT[parseKey(task.date).getDay()]}, ${formatDay(task.date)}</span>`}
          </span>`}
      </div>
      ${action}
      <button class="task-del" onClick=${(e) => { e.stopPropagation(); onDelete(task.id); }} title="Удалить" aria-label="Удалить задачу">${Icon.trash(15)}</button>
    </li>`;
}

function AddTask({ onAdd, placeholder = 'Добавить задачу' }) {
  const [text, setText] = useState('');
  const submit = (e) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    onAdd(t);
    setText('');
  };
  return html`
    <form class="add-task" onSubmit=${submit}>
      <span class="add-plus">${Icon.plus(16)}</span>
      <input value=${text} onInput=${(e) => setText(e.target.value)} placeholder=${placeholder} enterkeyhint="done" />
    </form>`;
}

function DayCard({ date, today, now, data, actions, onOpenTask, onOpenWork, onOpenClass }) {
  const [over, setOver] = useState(false);
  const [open, setOpen] = useState(false);
  const d = parseKey(date);
  const classes = sortClasses(data.classes[date]?.items || []);
  const work = data.work[date];
  const sessions = work?.sessions || [];
  const workMin = dayWorkMin(work, now);
  const running = sessions.some((s) => !s.end);
  const tasks = sortTasks(liveTasks(data).filter((t) => t.date === date));
  const isToday = date === today;
  const isPast = date < today;
  const weekend = d.getDay() === 0 || d.getDay() === 6;

  const onDrop = (e) => {
    e.preventDefault();
    setOver(false);
    const id = e.dataTransfer.getData('text/task-id');
    if (id) actions.patchTask(id, { date });
  };

  return html`
    <article
      id=${`day-${date}`}
      class=${`day ${isToday ? 'today' : ''} ${isPast ? 'past' : ''} ${open ? 'open' : ''} ${weekend ? 'weekend' : ''} ${over ? 'drop' : ''}`}
      onDragOver=${(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave=${() => setOver(false)}
      onDrop=${onDrop}
    >
      <header class="day-head">
        <button class="day-title" onClick=${() => setOpen(!open)}>
          <span class="day-dow">${dayLabel(date, today)}</span>
          <span class="day-date">${formatDay(date)}</span>
          ${isPast && (classes.length + tasks.length > 0) && html`<span class="day-more">${open ? 'свернуть' : `${tasks.length ? tasks.length + ' зад.' : ''}${tasks.length && classes.length ? ' · ' : ''}${classes.length ? classes.length + (classes.length === 1 ? ' пара' : classes.length < 5 ? ' пары' : ' пар') : ''}`}</span>`}
        </button>
        <button class=${`work-pill ${workMin ? 'has' : ''} ${running ? 'live' : ''}`} onClick=${() => onOpenWork(date)} title="Рабочее время">
          ${Icon.briefcase(14)} ${workMin ? formatDur(workMin) : running ? 'идёт' : 'часы'}
        </button>
      </header>
      ${data.settings.showTimeline !== false && (classes.length > 0 || sessions.length > 0) && html`<${Timeline} classes=${classes} sessions=${sessions} isToday=${isToday} now=${now} />`}
      ${classes.length > 0 && html`
        <ul class="classes">
          ${classes.map((c) => html`
            <li class=${`cls type-${c.type}`} onClick=${() => onOpenClass(date, c)}>
              <span class="cls-time">${c.start}<br />${c.end}</span>
              <div class="cls-body">
                <div class="cls-subj"><span class="cls-type">${typeShort(c.type)}</span>${c.subject}</div>
                ${(c.room || c.teacher) && html`<div class="cls-meta">${[c.room && `ауд. ${c.room}`, c.teacher].filter(Boolean).join(' · ')}</div>`}
              </div>
            </li>`)}
        </ul>`}
      ${tasks.length > 0 && html`
        <ul class="tasks">
          ${tasks.map((t) => html`<${TaskRow} key=${t.id} task=${t} today=${today} onToggle=${actions.toggleTask} onOpen=${onOpenTask} onDelete=${actions.deleteTask} />`)}
        </ul>`}
      <div class="day-foot">
        <${AddTask} onAdd=${(text) => actions.addTask(text, date)} />
        <button class="ghost-btn small" onClick=${() => onOpenClass(date, null)} title="Добавить пару">+ пара</button>
      </div>
    </article>`;
}

function TimerCard({ data, now, today, actions, onOpenWork }) {
  const running = findRunning(data);
  const todayMin = dayWorkMin(data.work[today], now);
  const todaySessions = data.work[today]?.sessions || [];
  const liveMs = running?.session.startedAt ? now - running.session.startedAt : 0;
  return html`
    <section class=${`card timer ${running ? 'running' : ''}`}>
      <div class="timer-top">
        <div>
          <div class="label">Работа сегодня</div>
          <div class="timer-total">${formatDur(todayMin)}</div>
        </div>
        ${running && html`
          <div class="timer-live">
            <span class="live-clock"><span class="dot"></span>${formatClock(liveMs)}</span>
            <div class="label">с ${running.session.start}${running.date !== today ? `, ${DOW_SHORT[parseKey(running.date).getDay()]} ${formatDay(running.date)}` : ''}</div>
          </div>`}
      </div>
      <button class=${`big-btn ${running ? 'stop' : 'start'}`} onClick=${running ? actions.stopTimer : actions.startTimer}>
        ${running ? Icon.stop(18) : Icon.play(18)}
        ${running ? 'Остановить' : todaySessions.length ? 'Продолжить работу' : 'Начать работу'}
      </button>
      ${todaySessions.length > 0 && html`
        <div class="sessions-inline">
          ${todaySessions.map((s) => html`<span class=${`sess ${s.end ? '' : 'live'}`}>${s.start}–${s.end || '…'}</span>`)}
        </div>`}
      <button class="link-btn" onClick=${() => onOpenWork(today)}>Поправить время вручную</button>
    </section>`;
}

function WeekStats({ data, days, now, today, onOpenWork }) {
  const target = Number(data.settings.weeklyTarget) || 40;
  const perDay = days.map((d) => dayWorkMin(data.work[d], now));
  const total = perDay.reduce((a, b) => a + b, 0);
  const targetMin = target * 60;
  const left = targetMin - total;
  const pct = Math.min(100, (total / targetMin) * 100);
  const isCurrent = days.includes(today);
  const workdaysLeft = isCurrent ? days.filter((d) => d >= today && parseKey(d).getDay() % 6 !== 0).length : 0;
  const maxDay = Math.max(600, ...perDay);
  const month = parseKey(days.includes(today) ? today : days[0]);
  const monthPrefix = dateKey(month).slice(0, 7);
  const monthTotal = Object.entries(data.work)
    .filter(([d]) => d.startsWith(monthPrefix))
    .reduce((a, [, w]) => a + dayWorkMin(w, now), 0);

  return html`
    <section class="card stats">
      <div class="stats-head">
        <div>
          <div class="label">Работа за неделю</div>
          <div class="stats-total">${formatDur(total)} <span class="muted">/ ${target}ч</span></div>
        </div>
        <div class=${`stats-left ${left <= 0 ? 'ok' : ''}`}>
          ${left > 0 ? html`осталось <b>${formatDur(left)}</b>` : html`норма ✓ <b>${left < 0 ? '+' + formatDur(-left) : ''}</b>`}
          ${left > 0 && workdaysLeft > 0 && html`<div class="muted small">≈ ${formatDur(Math.ceil(left / workdaysLeft))} в день · ${workdaysLeft} будн.</div>`}
        </div>
      </div>
      <div class="progress"><i style=${{ width: `${pct}%` }}></i></div>
      <div class="bars">
        ${days.map((d, i) => html`
          <button class=${`bar ${d === today ? 'today' : ''}`} onClick=${() => onOpenWork(d)} title=${`${DOW_FULL[parseKey(d).getDay()]}: ${formatDur(perDay[i])}`}>
            <span class="bar-val">${perDay[i] ? (perDay[i] / 60).toFixed(perDay[i] % 60 ? 1 : 0) : ''}</span>
            <span class="bar-track"><i style=${{ height: `${(perDay[i] / maxDay) * 100}%` }}></i></span>
            <span class="bar-dow">${DOW_SHORT[parseKey(d).getDay()]}</span>
          </button>`)}
      </div>
      <div class="muted small">${MONTHS_NOM[month.getMonth()]}: ${formatDur(monthTotal)}</div>
    </section>`;
}

function Backlog({ data, today, actions, onOpenTask }) {
  const [showAll, setShowAll] = useState(false);
  const all = liveTasks(data);
  const overdue = sortTasks(all.filter((t) => !t.done && t.date && t.date < today)).sort((a, b) => b.date.localeCompare(a.date));
  const inbox = sortTasks(all.filter((t) => !t.date));
  const shown = showAll ? overdue : overdue.slice(0, 5);
  const toToday = (t) => html`<button class="ghost-btn small" onClick=${() => actions.patchTask(t.id, { date: today })}>на сегодня</button>`;
  return html`
    ${overdue.length > 0 && html`
      <section class="card backlog overdue">
        <div class="card-title red">${Icon.alert(16)} Просрочено <span class="count">${overdue.length}</span></div>
        <ul class="tasks">
          ${shown.map((t) => html`<${TaskRow} key=${t.id} task=${t} today=${today} showDate onToggle=${actions.toggleTask} onOpen=${onOpenTask} onDelete=${actions.deleteTask} action=${toToday(t)} />`)}
        </ul>
        <div class="row gap">
          ${overdue.length > 5 && html`<button class="link-btn" onClick=${() => setShowAll(!showAll)}>${showAll ? 'Свернуть' : `Показать все (${overdue.length})`}</button>`}
          <span class="spacer"></span>
          <button class="link-btn muted" onClick=${() => actions.bulkOverdue(overdue, 'inbox')}>все в «Без даты»</button>
          <button class="link-btn muted" onClick=${() => actions.bulkOverdue(overdue, 'done')}>все сделаны</button>
        </div>
      </section>`}
    <section class="card backlog inbox">
      <div class="card-title">${Icon.inbox(16)} Без даты ${inbox.length > 0 && html`<span class="count">${inbox.length}</span>`}</div>
      ${inbox.length > 0 && html`
        <ul class="tasks">
          ${inbox.map((t) => html`<${TaskRow} key=${t.id} task=${t} today=${today} onToggle=${actions.toggleTask} onOpen=${onOpenTask} onDelete=${actions.deleteTask} />`)}
        </ul>`}
      <${AddTask} onAdd=${(text) => actions.addTask(text, '')} placeholder="Когда-нибудь сделать…" />
    </section>`;
}

function TaskModal({ task, today, actions, onClose }) {
  const [text, setText] = useState(task.text);
  const [date, setDate] = useState(task.date || '');
  const [deadline, setDeadline] = useState(!!task.deadline);
  const [color, setColor] = useState(task.color || '');
  const save = () => {
    const t = text.trim();
    if (!t) return;
    actions.patchTask(task.id, { text: t, date, deadline, color });
    onClose();
  };
  const quick = [
    ['Сегодня', today],
    ['Завтра', addDays(today, 1)],
    ['След. неделя', addDays(weekStart(today), 7)],
    ['Без даты', ''],
  ];
  return html`
    <${Modal} title="Задача" onClose=${onClose}>
      <textarea class="field" rows="3" value=${text} onInput=${(e) => setText(e.target.value)}
        onKeyDown=${(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save(); }}></textarea>
      <label class="field-label">Дата</label>
      <div class="row gap wrap">
        <input class="field date" type="date" value=${date} onInput=${(e) => setDate(e.target.value)} />
        ${quick.map(([l, v]) => html`<button class=${`chip-btn ${date === v ? 'on' : ''}`} onClick=${() => setDate(v)}>${l}</button>`)}
      </div>
      <label class="toggle">
        <input type="checkbox" checked=${deadline} onChange=${(e) => setDeadline(e.target.checked)} />
        <span>Дедлайн (сдача, зачёт, экзамен) — выделять красным</span>
      </label>
      <label class="field-label">Цвет</label>
      <div class="row gap wrap">
        ${TASK_COLORS.map(([v, l]) => html`<button class=${`swatch tc-${v || 'none'} ${color === v ? 'on' : ''}`} title=${l} aria-label=${l} onClick=${() => setColor(v)}></button>`)}
      </div>
      <div class="sheet-actions">
        <button class="danger-btn" onClick=${() => { actions.deleteTask(task.id); onClose(); }}>${Icon.trash(16)} Удалить</button>
        <span class="spacer"></span>
        <button class="primary-btn" onClick=${save}>Сохранить</button>
      </div>
    <//>`;
}

function WorkModal({ date, data, now, today, actions, onClose }) {
  const work = data.work[date] || { sessions: [], manualMin: 0 };
  const sessions = work.sessions || [];
  const total = dayWorkMin(work, now);
  const setSessions = (next) => actions.setWork(date, { ...work, sessions: next });
  const patch = (id, p) => setSessions(sessions.map((s) => (s.id === id ? { ...s, ...p, ...(p.end ? { startedAt: undefined } : {}) } : s)));
  const addSession = () => {
    const last = [...sessions].reverse().find((s) => s.end);
    const start = last?.end || '09:00';
    const end = date === today && toMin(nowHM()) > toMin(start) ? nowHM() : fromMin(Math.min(1439, toMin(start) + 60));
    setSessions([...sessions, { id: uid(), start, end }]);
  };
  const preset = () => {
    if (sessions.length && !confirm('Заменить отрезки дня на 09:00–13:00 и 14:00–18:00?')) return;
    setSessions([{ id: uid(), start: '09:00', end: '13:00' }, { id: uid(), start: '14:00', end: '18:00' }]);
  };
  const manualH = work.manualMin ? +(work.manualMin / 60).toFixed(2) : '';
  return html`
    <${Modal} title=${`Работа · ${DOW_SHORT[parseKey(date).getDay()]}, ${formatDay(date)}`} onClose=${onClose}>
      <div class="work-total">${formatDur(total)}</div>
      ${sessions.length === 0 && html`<p class="muted">Отрезков нет. Добавь вручную или запусти таймер.</p>`}
      <ul class="sessions">
        ${sessions.map((s) => html`
          <li class="session-row" key=${s.id}>
            <input class="field time" type="time" value=${s.start} onChange=${(e) => e.target.value && patch(s.id, { start: e.target.value })} />
            <span class="muted">—</span>
            ${s.end
              ? html`<input class="field time" type="time" value=${s.end} onChange=${(e) => e.target.value && patch(s.id, { end: e.target.value })} />`
              : html`<button class="chip-btn on" onClick=${() => patch(s.id, { end: nowHM() })}>идёт · стоп</button>`}
            <span class="session-dur">${formatDur(sessionMin(s, now))}</span>
            <button class="icon-btn" onClick=${() => setSessions(sessions.filter((x) => x.id !== s.id))} aria-label="Удалить отрезок">${Icon.x(16)}</button>
          </li>`)}
      </ul>
      <div class="row gap wrap">
        <button class="ghost-btn" onClick=${addSession}>${Icon.plus(16)} Отрезок</button>
        <button class="ghost-btn" onClick=${preset}>9–18 с обедом</button>
      </div>
      <label class="field-label">Плюс часы без отрезков</label>
      <div class="row gap">
        <input class="field num" type="number" min="0" step="0.25" inputmode="decimal" placeholder="0" value=${manualH}
          onChange=${(e) => actions.setWork(date, { ...work, manualMin: Math.max(0, Math.round((parseFloat(e.target.value.replace(',', '.')) || 0) * 60)) })} />
        <span class="muted">ч</span>
      </div>
      <div class="sheet-actions">
        ${(sessions.length > 0 || work.manualMin > 0) && html`<button class="danger-btn" onClick=${() => { if (confirm('Очистить рабочее время за этот день?')) actions.setWork(date, { sessions: [], manualMin: 0 }); }}>${Icon.trash(16)} Очистить</button>`}
        <span class="spacer"></span>
        <button class="primary-btn" onClick=${onClose}>Готово</button>
      </div>
    <//>`;
}

function ClassModal({ date, cls, data, actions, onClose }) {
  const [f, setF] = useState(cls || { id: '', start: '', end: '', subject: '', type: 'лекция', room: '', teacher: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const items = data.classes[date]?.items || [];
  const save = () => {
    if (!f.subject.trim()) return;
    const item = makeClass({ ...f, subject: f.subject.trim(), room: f.room.trim(), teacher: f.teacher.trim() });
    actions.setClasses(date, cls ? items.map((c) => (c.id === cls.id ? item : c)) : [...items, item]);
    onClose();
  };
  const pairs = [['08:30', '10:00'], ['10:15', '11:45'], ['12:00', '13:30'], ['14:00', '15:30'], ['15:45', '17:15'], ['17:30', '19:00'], ['19:15', '20:45']];
  return html`
    <${Modal} title=${`${cls ? 'Пара' : 'Новая пара'} · ${DOW_SHORT[parseKey(date).getDay()]}, ${formatDay(date)}`} onClose=${onClose}>
      <input class="field" placeholder="Предмет" value=${f.subject} onInput=${set('subject')} />
      <label class="field-label">Время</label>
      <div class="row gap">
        <input class="field time" type="time" value=${f.start} onInput=${set('start')} />
        <span class="muted">—</span>
        <input class="field time" type="time" value=${f.end} onInput=${set('end')} />
      </div>
      <div class="row gap wrap">
        ${pairs.map(([s, e], i) => html`<button class=${`chip-btn ${f.start === s ? 'on' : ''}`} onClick=${() => setF({ ...f, start: s, end: e })}>${i + 1}: ${s}</button>`)}
      </div>
      <label class="field-label">Тип</label>
      <div class="row gap wrap">
        ${CLASS_TYPES.map((t) => html`<button class=${`chip-btn ${f.type === t ? 'on' : ''}`} onClick=${() => setF({ ...f, type: t })}>${t}</button>`)}
      </div>
      <div class="row gap">
        <input class="field" placeholder="Аудитория" value=${f.room} onInput=${set('room')} />
        <input class="field" placeholder="Преподаватель" value=${f.teacher} onInput=${set('teacher')} />
      </div>
      <div class="sheet-actions">
        ${cls && html`<button class="danger-btn" onClick=${() => { actions.setClasses(date, items.filter((c) => c.id !== cls.id)); onClose(); }}>${Icon.trash(16)} Удалить</button>`}
        <span class="spacer"></span>
        <button class="primary-btn" onClick=${save}>Сохранить</button>
      </div>
    <//>`;
}

function ScheduleModal({ actions, onClose }) {
  const [raw, setRaw] = useState('');
  const parsed = useMemo(() => parseSchedule(raw), [raw]);
  const dates = Object.keys(parsed).sort();
  const count = dates.reduce((a, d) => a + parsed[d].length, 0);
  const apply = () => {
    actions.importSchedule(parsed);
    onClose();
  };
  return html`
    <${Modal} title="Вставить расписание" onClose=${onClose} wide>
      <p class="muted small">Открой расписание в личном кабинете, выдели всё (Ctrl+A), скопируй и вставь сюда. Нужны строки с датой (01.09.2026) и временем пары (08:30 10:00). Дни из вставки заменят то, что было на эти даты.</p>
      <textarea class="field mono" rows="8" placeholder="Вставь текст расписания…" value=${raw} onInput=${(e) => setRaw(e.target.value)}></textarea>
      ${raw.trim() && html`
        <div class="preview">
          ${count === 0 ? html`<p class="muted">Пар не найдено.</p>` : html`
            <p><b>${count}</b> пар за <b>${dates.length}</b> дн.: ${formatRange(dates[0], dates[dates.length - 1])}</p>
            <ul class="preview-list">
              ${dates.slice(0, 14).map((d) => html`<li><b>${DOW_SHORT[parseKey(d).getDay()]} ${formatDay(d)}</b> — ${parsed[d].map((c) => `${c.start} ${typeShort(c.type)} ${c.subject}`).join('; ')}</li>`)}
              ${dates.length > 14 && html`<li class="muted">…и ещё ${dates.length - 14} дн.</li>`}
            </ul>`}
        </div>`}
      <div class="sheet-actions">
        <span class="spacer"></span>
        <button class="primary-btn" disabled=${!count} onClick=${apply}>Сохранить ${count ? `(${count})` : ''}</button>
      </div>
    <//>`;
}

function QR({ text }) {
  const markup = useMemo(() => {
    if (!window.qrcode) return '';
    const qr = window.qrcode(0, 'L');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [text]);
  return html`<div class="qr" dangerouslySetInnerHTML=${{ __html: markup }}></div>`;
}

function SettingsModal({ data, cfg, sync, theme, actions, onClose, onOpenSchedule }) {
  const [gistId, setGistId] = useState(cfg.gistId);
  const [token, setToken] = useState(cfg.token);
  const [pass, setPass] = useState(cfg.pass);
  const [showLink, setShowLink] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const link = showLink ? makeSetupLink(cfg) : '';

  const saveSync = async () => {
    setBusy(true);
    await actions.setConfig({ gistId: gistId.trim(), token: token.trim(), pass });
    setBusy(false);
  };
  const create = async () => {
    if (!token.trim() || !pass) { actions.toast('Нужны токен и PIN'); return; }
    setBusy(true);
    try {
      const id = await createGist(token.trim(), data, pass);
      setGistId(id);
      await actions.setConfig({ gistId: id, token: token.trim(), pass });
      actions.toast('Gist создан');
    } catch (e) {
      actions.toast(e.message);
    }
    setBusy(false);
  };
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tracker-${todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importJson = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      let obj = JSON.parse((await file.text()).replace(/^﻿/, ''));
      if (obj.encrypted) obj = await decrypt(obj, cfg.pass || prompt('PIN от этого файла') || '');
      actions.importData(normalize(obj));
    } catch (err) {
      actions.toast(err instanceof PinError ? 'Неверный PIN' : 'Не удалось прочитать файл');
    }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); actions.toast('Ссылка скопирована'); } catch (e) { actions.toast('Не удалось скопировать'); }
  };

  return html`
    <${Modal} title="Настройки" onClose=${onClose} wide>
      <section class="set-block">
        <h3>Синхронизация</h3>
        <p class=${`sync-line s-${sync.status}`}><span class="dot"></span>${sync.label}${sync.error && html` — ${sync.error}`}</p>
        <label class="field-label">Gist ID</label>
        <input class="field mono" value=${gistId} onInput=${(e) => setGistId(e.target.value)} placeholder="найдётся сам по токену" />
        <label class="field-label">GitHub токен (доступ gist)</label>
        <input class="field mono" type="password" autocomplete="off" value=${token} onInput=${(e) => setToken(e.target.value)} placeholder="ghp_… или github_pat_…" />
        <p class="muted small">Без токена задачи не открываются. Токен создаётся на <a href="https://github.com/settings/tokens/new?scopes=gist" target="_blank" rel="noopener">github.com/settings/tokens</a> с галкой «gist».</p>
        <label class="field-label">PIN шифрования</label>
        <input class="field" type="password" autocomplete="off" value=${pass} onInput=${(e) => setPass(e.target.value)} placeholder="тот же, что был раньше" />
        <div class="row gap wrap">
          <button class="primary-btn" disabled=${busy} onClick=${saveSync}>Сохранить и синхронизировать</button>
          ${!gistId.trim() && html`<button class="ghost-btn" disabled=${busy} onClick=${create}>Создать новый Gist</button>`}
        </div>
        ${cfg.gistId && cfg.token && html`
          <div class="connect">
            <button class="ghost-btn" onClick=${() => setShowLink(!showLink)}>${showLink ? 'Скрыть' : 'Подключить телефон или ноутбук'}</button>
            ${showLink && html`
              <p class="muted small">Отсканируй QR камерой телефона или открой ссылку на другом устройстве — токен и PIN подставятся сами. Никому не пересылай: в ссылке ключи доступа.</p>
              <${QR} text=${link} />
              <button class="ghost-btn" onClick=${copy}>${Icon.copy(16)} Скопировать ссылку</button>`}
          </div>`}
      </section>
      <section class="set-block">
        <h3>Работа</h3>
        <label class="field-label">Норма часов в неделю</label>
        <input class="field num" type="number" min="1" max="100" value=${data.settings.weeklyTarget}
          onChange=${(e) => actions.setSettings({ weeklyTarget: Math.max(1, Number(e.target.value) || 40) })} />
      </section>
      <section class="set-block">
        <h3>Учёба</h3>
        <button class="ghost-btn" onClick=${onOpenSchedule}>${Icon.cal(16)} Вставить расписание из личного кабинета</button>
      </section>
      <section class="set-block">
        <h3>Внешний вид</h3>
        <label class="field-label">Тема</label>
        <div class="row gap wrap">
          ${[['auto', 'Как в системе'], ['light', 'Светлая'], ['dark', 'Тёмная']].map(([v, l]) => html`
            <button class=${`chip-btn ${theme === v ? 'on' : ''}`} onClick=${() => actions.setTheme(v)}>${l}</button>`)}
        </div>
        <label class="field-label">Акцентный цвет</label>
        <div class="row gap wrap">
          ${ACCENTS.map(([v, l]) => html`<button class=${`swatch ac-${v} ${data.settings.accent === v ? 'on' : ''}`} title=${l} aria-label=${l} onClick=${() => actions.setSettings({ accent: v })}></button>`)}
        </div>
        <label class="field-label">Плотность</label>
        <div class="row gap wrap">
          ${[['normal', 'Обычная'], ['compact', 'Компактная'], ['roomy', 'Просторная']].map(([v, l]) => html`
            <button class=${`chip-btn ${data.settings.density === v ? 'on' : ''}`} onClick=${() => actions.setSettings({ density: v })}>${l}</button>`)}
        </div>
        <label class="toggle">
          <input type="checkbox" checked=${data.settings.showTimeline !== false} onChange=${(e) => actions.setSettings({ showTimeline: e.target.checked })} />
          <span>Полоска дня (пары и работа по времени)</span>
        </label>
        <label class="toggle">
          <input type="checkbox" checked=${!!data.settings.hideWeekends} onChange=${(e) => actions.setSettings({ hideWeekends: e.target.checked })} />
          <span>Скрывать пустые выходные</span>
        </label>
      </section>
      <section class="set-block">
        <h3>Данные</h3>
        <div class="row gap wrap">
          <button class="ghost-btn" onClick=${exportJson}>Скачать копию (JSON)</button>
          <button class="ghost-btn" onClick=${() => fileRef.current.click()}>Загрузить из файла</button>
          <input ref=${fileRef} type="file" accept=".json,application/json" hidden onChange=${importJson} />
        </div>
        <p class="muted small">Загрузка из файла сливает данные с текущими, ничего не удаляя. Подходит и старый формат tasks.json.</p>
      </section>
      <p class="muted small center">v${VERSION}</p>
    <//>`;
}

function LockScreen({ cfg, status, error, onSubmit }) {
  const needToken = status === 'setup' || !cfg.token;
  const [token, setToken] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if ((needToken && !token.trim() && !cfg.token) || !pin) return;
    setBusy(true);
    await onSubmit({ ...(token.trim() ? { token: token.trim() } : {}), pass: pin });
    setBusy(false);
  };
  return html`
    <div class="lock">
      <form class="sheet lock-card" onSubmit=${submit}>
        <h2>${needToken ? 'Подключи устройство' : 'Данные зашифрованы'}</h2>
        <p class="muted">${needToken
          ? 'Без токена GitHub задачи не показываются. Проще всего: на уже подключённом устройстве открой ⚙ → «Подключить телефон или ноутбук» и отсканируй QR.'
          : 'Введи PIN, которым защищены задачи в облаке.'}</p>
        ${needToken && html`
          <input class="field mono" type="password" autocomplete="off" value=${token} onInput=${(e) => setToken(e.target.value)} placeholder=${cfg.token ? 'новый токен (старый не подошёл)' : 'GitHub токен ghp_…'} />
          <a class="small" href="https://github.com/settings/tokens/new?scopes=gist" target="_blank" rel="noopener">Создать токен с доступом gist</a>`}
        <input class="field center" type="password" inputmode="numeric" autocomplete="current-password" value=${pin} onInput=${(e) => setPin(e.target.value)} placeholder="PIN" />
        ${error && html`<p class="error">${error}</p>`}
        <button class="primary-btn" type="submit" disabled=${busy}>${busy ? 'Проверяю…' : 'Открыть'}</button>
      </form>
    </div>`;
}

const SYNC_LABELS = {
  syncing: 'Синхронизация…',
  ok: 'Синхронизировано',
  offline: 'Нет сети — сохранено локально',
  error: 'Ошибка синхронизации',
  pin: 'Нужен PIN',
  setup: 'Нужен токен',
};

const LOCKED = ['setup', 'pin'];

const initialStatus = (c) => {
  if (!c.token) return 'setup';
  if (!c.pass) return 'pin';
  return 'syncing';
};

function App() {
  const [data, setData] = useState(loadLocal);
  const dataRef = useRef(data);
  const [cfg, setCfg] = useState(loadConfig);
  const cfgRef = useRef(cfg);
  const [sync, setSync] = useState({ status: initialStatus(cfg), error: '' });
  const [now, setNow] = useState(Date.now());
  const [today, setToday] = useState(todayKey());
  const [week, setWeek] = useState(weekStart(todayKey()));
  const [modal, setModal] = useState(null);
  const [toast, setToastMsg] = useState(null);
  const [theme, setThemeState] = useState(store.get(THEME_KEY) || 'auto');
  const syncRef = useRef({ running: false, again: false, timer: null });
  const toastTimer = useRef(null);

  const showToast = useCallback((msg, undo) => {
    setToastMsg({ msg, undo, key: Date.now() });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), undo ? 10000 : 2600);
  }, []);

  const commit = useCallback((next) => {
    dataRef.current = next;
    setData(next);
    store.set(DATA_KEY, JSON.stringify(next));
  }, []);

  const runSync = useCallback(async () => {
    const s = syncRef.current;
    const c = cfgRef.current;
    if (!c.token || !c.pass) { setSync((p) => ({ status: c.token ? 'pin' : 'setup', error: LOCKED.includes(p.status) ? p.error : '' })); return; }
    if (s.running) { s.again = true; return; }
    s.running = true;
    setSync((p) => ({ ...p, status: 'syncing' }));
    try {
      if (!c.gistId) {
        const found = await findGist(c.token);
        const gistId = found || (await createGist(c.token, dataRef.current, c.pass));
        saveConfig({ gistId });
        cfgRef.current = { ...c, gistId };
        setCfg(cfgRef.current);
      }
      const cur = cfgRef.current;
      const { merged, migrated } = await syncOnce(cur, dataRef.current);
      const latest = merge(dataRef.current, merged);
      if (!sameData(latest, dataRef.current)) commit(latest);
      if (!sameData(latest, merged)) s.again = true;
      if (migrated) showToast('Старые данные перенесены');
      setSync({ status: 'ok', error: '' });
      flushUploads();
      retryMissing();
    } catch (e) {
      if (e instanceof PinError) setSync({ status: 'pin', error: 'Неверный PIN' });
      else if (e.status === 401 || e.status === 404) setSync({ status: 'setup', error: e.message });
      else if (e instanceof TypeError || !navigator.onLine) setSync({ status: 'offline', error: '' });
      else setSync({ status: 'error', error: e.message });
    } finally {
      s.running = false;
      if (s.again) { s.again = false; scheduleSync(1200); }
    }
  }, [commit, showToast]);

  const scheduleSync = useCallback((ms = 800) => {
    const s = syncRef.current;
    clearTimeout(s.timer);
    s.timer = setTimeout(runSync, ms);
  }, [runSync]);

  const change = useCallback((fn) => {
    const next = fn(dataRef.current);
    commit(next);
    scheduleSync();
  }, [commit, scheduleSync]);

  useEffect(() => {
    if (consumeSetupLink()) {
      const c = loadConfig();
      cfgRef.current = c;
      setCfg(c);
      showToast('Устройство подключено');
    }
    runSync();
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') runSync();
    }, 20000);
    const onVis = () => document.visibilityState === 'visible' && runSync();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', runSync);
    return () => {
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', runSync);
    };
  }, []);

  const running = findRunning(data);
  useEffect(() => {
    const tick = setInterval(() => {
      setNow(Date.now());
      const t = todayKey();
      setToday((prev) => {
        if (prev !== t) setWeek((w) => (w === weekStart(prev) ? weekStart(t) : w));
        return t;
      });
    }, running ? 1000 : 30000);
    return () => clearInterval(tick);
  }, [!!running]);

  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => { applyLook(data.settings); }, [data.settings.accent, data.settings.density]);
  useEffect(() => {
    configureMedia({
      cfg,
      getGist: () => dataRef.current.settings.mediaGist || '',
      setGist: (id) => change((d) => ({ ...d, settings: { ...d.settings, mediaGist: id, updatedAt: Date.now() } })),
    });
  }, [cfg]);

  const stamp = () => Date.now();

  const removeItem = (coll, id, msg) => {
    const prev = dataRef.current[coll][id];
    if (!prev || prev.deleted) return;
    change((d) => ({ ...d, [coll]: { ...d[coll], [id]: { id, deleted: true, updatedAt: stamp() } } }));
    showToast(msg, () => {
      change((d) => ({ ...d, [coll]: { ...d[coll], [id]: { ...prev, updatedAt: stamp() } } }));
      setToastMsg(null);
    });
  };

  const actions = useMemo(() => ({
    toast: showToast,
    addTask: (text, date) => change((d) => {
      const id = uid();
      const deadline = /^!\s*/.test(text);
      const t = { id, text: text.replace(/^!\s*/, ''), date, done: false, deadline, createdAt: stamp(), updatedAt: stamp() };
      return { ...d, tasks: { ...d.tasks, [id]: t } };
    }),
    patchTask: (id, p) => change((d) => (d.tasks[id] ? { ...d, tasks: { ...d.tasks, [id]: { ...d.tasks[id], ...p, updatedAt: stamp() } } } : d)),
    toggleTask: (t) => change((d) => ({ ...d, tasks: { ...d.tasks, [t.id]: { ...d.tasks[t.id], done: !t.done, updatedAt: stamp() } } })),
    deleteTask: (id) => removeItem('tasks', id, 'Задача удалена'),
    upsert: (coll, item) => change((d) => ({ ...d, [coll]: { ...d[coll], [item.id]: { ...item, updatedAt: stamp() } } })),
    patch: (coll, id, p) => change((d) => (d[coll][id] ? { ...d, [coll]: { ...d[coll], [id]: { ...d[coll][id], ...p, updatedAt: stamp() } } } : d)),
    remove: (coll, id, msg) => removeItem(coll, id, msg),
    removeMany: (coll, ids, msg) => {
      const prev = ids.map((id) => dataRef.current[coll][id]).filter((x) => x && !x.deleted);
      if (!prev.length) return;
      change((d) => {
        const m = { ...d[coll] };
        for (const x of prev) m[x.id] = { id: x.id, deleted: true, updatedAt: stamp() };
        return { ...d, [coll]: m };
      });
      showToast(msg, () => {
        change((d) => {
          const m = { ...d[coll] };
          for (const x of prev) m[x.id] = { ...x, updatedAt: stamp() };
          return { ...d, [coll]: m };
        });
        setToastMsg(null);
      });
    },
    bulkOverdue: (list, mode) => {
      if (!confirm(mode === 'done' ? `Отметить ${list.length} просроченных задач сделанными?` : `Убрать дату у ${list.length} задач?`)) return;
      change((d) => {
        const tasks = { ...d.tasks };
        for (const t of list) tasks[t.id] = { ...tasks[t.id], ...(mode === 'done' ? { done: true } : { date: '' }), updatedAt: stamp() };
        return { ...d, tasks };
      });
    },
    setWork: (date, w) => change((d) => {
      const sessions = [...(w.sessions || [])].sort((a, b) => (toMin(a.start) ?? 0) - (toMin(b.start) ?? 0));
      return { ...d, work: { ...d.work, [date]: { sessions, manualMin: w.manualMin || 0, updatedAt: stamp() } } };
    }),
    startTimer: () => change((d) => {
      if (findRunning(d)) return d;
      const t = todayKey();
      const w = d.work[t] || { sessions: [], manualMin: 0 };
      const s = { id: uid(), start: nowHM(), end: null, startedAt: stamp() };
      return { ...d, work: { ...d.work, [t]: { ...w, sessions: [...(w.sessions || []), s], updatedAt: stamp() } } };
    }),
    stopTimer: () => change((d) => {
      const r = findRunning(d);
      if (!r) return d;
      let end = nowHM();
      const hours = (Date.now() - (r.session.startedAt || Date.now())) / 3600000;
      if (hours >= 14) {
        const answer = prompt(`Таймер шёл ${Math.floor(hours)} ч — забыл выключить? Во сколько закончил (чч:мм)?`, end);
        if (answer === null) return d;
        if (/^\d{1,2}:\d{2}$/.test(answer.trim())) end = answer.trim().padStart(5, '0');
      }
      const w = d.work[r.date];
      const sessions = w.sessions.map((s) => (s.id === r.session.id ? { id: s.id, start: s.start, end } : s));
      return { ...d, work: { ...d.work, [r.date]: { ...w, sessions, updatedAt: stamp() } } };
    }),
    setClasses: (date, items) => change((d) => ({ ...d, classes: { ...d.classes, [date]: { items: sortClasses(items), updatedAt: stamp() } } })),
    importSchedule: (parsed) => {
      change((d) => {
        const classes = { ...d.classes };
        for (const [date, items] of Object.entries(parsed)) classes[date] = { items: sortClasses(items.map(makeClass)), updatedAt: stamp() };
        return { ...d, classes };
      });
      const first = Object.keys(parsed).sort()[0];
      if (first) setWeek(weekStart(first < todayKey() ? todayKey() : first));
      showToast('Расписание сохранено');
    },
    setSettings: (p) => change((d) => ({ ...d, settings: { ...d.settings, ...p, updatedAt: stamp() } })),
    importData: (obj) => {
      change((d) => merge(d, obj));
      showToast('Данные загружены');
    },
    setConfig: async (c) => {
      saveConfig(c);
      const next = loadConfig();
      cfgRef.current = next;
      setCfg(next);
      await runSync();
    },
    setTheme: (t) => {
      store.set(THEME_KEY, t);
      setThemeState(t);
    },
  }), [change, runSync, showToast]);

  const days = weekDays(week);
  const isCurrentWeek = days.includes(today);
  const weekClassCount = days.reduce((a, d) => a + (data.classes[d]?.items?.length || 0), 0);
  const visibleDays = data.settings.hideWeekends
    ? days.filter((d) => {
      if (parseKey(d).getDay() % 6 !== 0 || d === today) return true;
      return (data.classes[d]?.items?.length || 0) + dayWorkMin(data.work[d], now) > 0 || liveTasks(data).some((t) => t.date === d);
    })
    : days;
  const openTask = (t) => setModal({ kind: 'task', task: t });
  const openWork = (date) => setModal({ kind: 'work', date });
  const openClass = (date, cls) => setModal({ kind: 'class', date, cls });
  const close = () => setModal(null);
  const syncInfo = { ...sync, label: SYNC_LABELS[sync.status] };

  const goToday = () => {
    setWeek(weekStart(todayKey()));
    requestAnimationFrame(() => document.getElementById(`day-${todayKey()}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  if (LOCKED.includes(sync.status)) {
    return html`<${LockScreen} key=${sync.status} cfg=${cfg} status=${sync.status} error=${sync.error} onSubmit=${actions.setConfig} />`;
  }

  return html`
    <header class="topbar">
      <div class="brand">Учёба<span class="muted"> + работа</span></div>
      <nav class="week-nav">
        <button class="icon-btn" onClick=${() => setWeek(addDays(week, -7))} aria-label="Прошлая неделя">${Icon.left()}</button>
        <button class="week-label" onClick=${goToday}>${formatRange(days[0], days[6])}</button>
        <button class="icon-btn" onClick=${() => setWeek(addDays(week, 7))} aria-label="Следующая неделя">${Icon.right()}</button>
        ${!isCurrentWeek && html`<button class="chip-btn" onClick=${goToday}>Сегодня</button>`}
      </nav>
      <div class="top-actions">
        <button class=${`sync-dot s-${sync.status}`} title=${syncInfo.label + (sync.error ? ': ' + sync.error : '')} onClick=${() => (sync.status === 'error' ? setModal({ kind: 'settings' }) : runSync())}>
          <span class="dot"></span><span class="sync-text">${syncInfo.label}</span>
        </button>
        <button class="icon-btn" onClick=${() => setModal({ kind: 'settings' })} aria-label="Настройки">${Icon.gear()}</button>
      </div>
    </header>

    <main class="layout">
      <aside class="side">
        <${TimerCard} data=${data} now=${now} today=${today} actions=${actions} onOpenWork=${openWork} />
        <${WeekStats} data=${data} days=${days} now=${now} today=${today} onOpenWork=${openWork} />
        <${Backlog} data=${data} today=${today} actions=${actions} onOpenTask=${openTask} />
      </aside>
      <section class="days">
        ${weekClassCount === 0 && html`
          <div class="card hint wide-hint">
            <span>На этой неделе нет пар.</span>
            <button class="ghost-btn small" onClick=${() => setModal({ kind: 'schedule' })}>${Icon.cal(14)} Вставить расписание</button>
          </div>`}
        ${visibleDays.map((d) => html`<${DayCard} key=${d} date=${d} today=${today} now=${now} data=${data} actions=${actions} onOpenTask=${openTask} onOpenWork=${openWork} onOpenClass=${openClass} />`)}
      </section>
    </main>
    <div class="ws-outer"><${Workspace} data=${data} ops=${actions} /></div>

    ${modal?.kind === 'task' && data.tasks[modal.task.id] && html`<${TaskModal} task=${data.tasks[modal.task.id]} today=${today} actions=${actions} onClose=${close} />`}
    ${modal?.kind === 'work' && html`<${WorkModal} date=${modal.date} data=${data} now=${now} today=${today} actions=${actions} onClose=${close} />`}
    ${modal?.kind === 'class' && html`<${ClassModal} date=${modal.date} cls=${modal.cls} data=${data} actions=${actions} onClose=${close} />`}
    ${modal?.kind === 'schedule' && html`<${ScheduleModal} actions=${actions} onClose=${close} />`}
    ${modal?.kind === 'settings' && html`<${SettingsModal} data=${data} cfg=${cfg} sync=${syncInfo} theme=${theme} actions=${actions} onClose=${close} onOpenSchedule=${() => setModal({ kind: 'schedule' })} />`}
    ${toast && html`
      <div class="toast" key=${toast.key}>
        <span>${toast.msg}</span>
        ${toast.undo && html`<button class="toast-undo" onClick=${toast.undo}>Отменить</button><i class="toast-bar"></i>`}
      </div>`}
  `;
}

applyTheme(store.get(THEME_KEY) || 'auto');
render(html`<${App} />`, document.getElementById('app'));

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
