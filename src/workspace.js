import { html, useState, useEffect, useRef, useMemo } from '../vendor/preact-htm.js';
import { uid, store } from './util.js';
import { Icon } from './icons.js';

const NOTE_COLORS = ['yellow', 'pink', 'green', 'blue', 'purple', 'orange', 'gray'];
const live = (map) => Object.values(map || {}).filter((x) => !x.deleted);
const byOrder = (a, b) => (a.order || 0) - (b.order || 0) || (a.createdAt || 0) - (b.createdAt || 0);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');

export const renderMarkdown = (src) => {
  const lines = String(src || '').split('\n');
  const out = [];
  let list = null;
  let code = null;
  const closeList = () => { if (list) { out.push(list === 'ol' ? '</ol>' : '</ul>'); list = null; } };
  lines.forEach((line, i) => {
    if (code !== null) {
      if (/^```/.test(line)) { out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); code = null; } else code.push(line);
      return;
    }
    if (/^```/.test(line)) { closeList(); code = []; return; }
    let m;
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) { closeList(); out.push(`<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`); return; }
    if (/^---+\s*$/.test(line)) { closeList(); out.push('<hr>'); return; }
    if ((m = line.match(/^>\s?(.*)$/))) { closeList(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); return; }
    if ((m = line.match(/^\s*[-*]\s+\[( |x|X)\]\s*(.*)$/))) {
      if (list !== 'checks') { closeList(); out.push('<ul class="checks">'); list = 'checks'; }
      const on = m[1] !== ' ';
      out.push(`<li class="${on ? 'on' : ''}"><input type="checkbox" data-line="${i}" ${on ? 'checked' : ''}><span>${inline(m[2])}</span></li>`);
      return;
    }
    if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(m[1])}</li>`);
      return;
    }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(m[1])}</li>`);
      return;
    }
    closeList();
    out.push(line.trim() ? `<p>${inline(line)}</p>` : '<div class="gap-line"></div>');
  });
  if (code !== null) out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
  closeList();
  return out.join('');
};

function Tabs({ items, active, onSelect, onAdd, onRename, onRemove, addLabel }) {
  return html`
    <div class="ws-tabs" role="tablist">
      ${items.map((it) => html`
        <div class=${`ws-tab ${it.id === active ? 'on' : ''}`} role="tab" aria-selected=${it.id === active}
          onClick=${() => onSelect(it.id)}
          onDblClick=${() => { const n = prompt('Название', it.name); if (n && n.trim()) onRename(it.id, n.trim()); }}>
          <span class="ws-tab-name">${it.name || 'Без названия'}</span>
          ${it.id === active && html`<button class="ws-tab-x" title="Удалить" onClick=${(e) => { e.stopPropagation(); onRemove(it.id); }}>${Icon.x(13)}</button>`}
        </div>`)}
      <button class="ws-tab add" onClick=${onAdd} title=${addLabel}>${Icon.plus(15)}</button>
    </div>`;
}

const clampScale = (s) => Math.min(2.5, Math.max(0.25, s));

function Board({ boardId, notes, ops }) {
  const viewKey = `tt2_view_${boardId}`;
  const [view, setView] = useState(() => {
    try { return JSON.parse(store.get(viewKey)) || { x: 40, y: 40, s: 1 }; } catch (e) { return { x: 40, y: 40, s: 1 }; }
  });
  const [sel, setSel] = useState(null);
  const [editing, setEditing] = useState(null);
  const [temp, setTemp] = useState(null);
  const canvasRef = useRef(null);
  const drag = useRef(null);

  useEffect(() => { store.set(viewKey, JSON.stringify(view)); }, [view]);
  useEffect(() => { setSel(null); setEditing(null); }, [boardId]);

  const toWorld = (cx, cy) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: (cx - r.left - view.x) / view.s, y: (cy - r.top - view.y) / view.s };
  };
  const center = () => {
    const r = canvasRef.current.getBoundingClientRect();
    return toWorld(r.left + r.width / 2, r.top + r.height / 2);
  };
  const maxZ = () => notes.reduce((a, n) => Math.max(a, n.z || 0), 0);

  const add = (kind, at) => {
    const c = center();
    const k = notes.length % 6;
    const p = at || { x: c.x + k * 28 - 70, y: c.y + k * 28 - 70 };
    const base = { id: uid(), board: boardId, kind, z: maxZ() + 1, createdAt: Date.now() };
    const n = kind === 'sticky'
      ? { ...base, x: p.x - 90, y: p.y - 80, w: 180, h: 160, color: 'yellow', text: '' }
      : kind === 'text'
        ? { ...base, x: p.x - 120, y: p.y - 24, w: 240, h: 60, text: '' }
        : { ...base, x: p.x - 180, y: p.y - 70, w: 360, h: 150, cells: [['', '', ''], ['', '', ''], ['', '', '']] };
    ops.upsertNote(n);
    setSel(n.id);
    if (kind !== 'table') setEditing(n.id);
  };

  const onCanvasDown = (e) => {
    if (e.target !== canvasRef.current && !e.target.classList.contains('board-layer')) return;
    setSel(null);
    setEditing(null);
    drag.current = { mode: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    canvasRef.current.setPointerCapture(e.pointerId);
  };
  const onNoteDown = (e, n, mode = 'move') => {
    if (editing === n.id && mode === 'move') return;
    if (e.target.closest('input,textarea,button,.cell') && mode === 'move') { setSel(n.id); return; }
    e.stopPropagation();
    setSel(n.id);
    if (editing && editing !== n.id) setEditing(null);
    drag.current = { mode: mode === 'move-grip' ? 'move' : mode, id: n.id, sx: e.clientX, sy: e.clientY, x: n.x, y: n.y, w: n.w, h: n.h, moved: false };
    canvasRef.current.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (d.mode === 'pan') { setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy })); return; }
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.mode === 'move') setTemp({ id: d.id, x: d.x + dx / view.s, y: d.y + dy / view.s, w: d.w, h: d.h });
    else setTemp({ id: d.id, x: d.x, y: d.y, w: Math.max(80, d.w + dx / view.s), h: Math.max(40, d.h + dy / view.s) });
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && d.mode !== 'pan' && temp && d.moved) {
      ops.patchNote(d.id, { x: Math.round(temp.x), y: Math.round(temp.y), w: Math.round(temp.w), h: Math.round(temp.h), z: maxZ() + 1 });
    }
    setTemp(null);
  };
  const onWheel = (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const r = canvasRef.current.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    setView((v) => {
      const s = clampScale(v.s * Math.exp(-e.deltaY * 0.002));
      return { s, x: px - ((px - v.x) * s) / v.s, y: py - ((py - v.y) * s) / v.s };
    });
  };
  useEffect(() => {
    const el = canvasRef.current;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });
  useEffect(() => {
    const onKey = (e) => {
      if (!sel || editing || e.target.closest?.('input,textarea')) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { ops.removeNote(sel); setSel(null); }
      if (e.key === 'Escape') setSel(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel, editing]);

  const zoom = (f) => {
    const r = canvasRef.current.getBoundingClientRect();
    const px = r.width / 2;
    const py = r.height / 2;
    setView((v) => {
      const s = f ? clampScale(v.s * f) : 1;
      return { s, x: px - ((px - v.x) * s) / v.s, y: py - ((py - v.y) * s) / v.s };
    });
  };
  const fit = () => {
    if (!notes.length) { setView({ x: 40, y: 40, s: 1 }); return; }
    const r = canvasRef.current.getBoundingClientRect();
    const minX = Math.min(...notes.map((n) => n.x));
    const minY = Math.min(...notes.map((n) => n.y));
    const maxX = Math.max(...notes.map((n) => n.x + n.w));
    const maxY = Math.max(...notes.map((n) => n.y + n.h));
    const s = clampScale(Math.min((r.width - 80) / (maxX - minX), (r.height - 80) / (maxY - minY), 1.2));
    setView({ s, x: (r.width - (maxX - minX) * s) / 2 - minX * s, y: (r.height - (maxY - minY) * s) / 2 - minY * s });
  };

  const setCell = (n, ri, ci, val) => {
    const cells = n.cells.map((row) => [...row]);
    cells[ri][ci] = val;
    ops.patchNote(n.id, { cells });
  };
  const tableOp = (n, op) => {
    let cells = n.cells.map((row) => [...row]);
    if (op === 'row+') cells.push(cells[0].map(() => ''));
    if (op === 'row-' && cells.length > 1) cells.pop();
    if (op === 'col+') cells = cells.map((r) => [...r, '']);
    if (op === 'col-' && cells[0].length > 1) cells = cells.map((r) => r.slice(0, -1));
    const rowsDelta = cells.length - n.cells.length;
    const colsDelta = cells[0].length - n.cells[0].length;
    ops.patchNote(n.id, { cells, h: n.h + rowsDelta * 36, w: n.w + colsDelta * 110 });
  };

  const sorted = [...notes].sort((a, b) => (a.z || 0) - (b.z || 0));
  const selNote = notes.find((n) => n.id === sel);

  return html`
    <div class="board-wrap">
      <div class="board-tools">
        <button class="tool" onClick=${() => add('sticky')} title="Стикер"><span class="tool-sticky"></span>Стикер</button>
        <button class="tool" onClick=${() => add('text')} title="Текст"><b class="tool-t">T</b>Текст</button>
        <button class="tool" onClick=${() => add('table')} title="Таблица"><span class="tool-table"></span>Таблица</button>
        <span class="spacer"></span>
        <button class="tool icon" onClick=${() => zoom(1 / 1.2)} title="Отдалить">−</button>
        <button class="tool zoom-val" onClick=${() => zoom(0)} title="100%">${Math.round(view.s * 100)}%</button>
        <button class="tool icon" onClick=${() => zoom(1.2)} title="Приблизить">+</button>
        <button class="tool" onClick=${fit} title="Показать всё">Всё</button>
      </div>
      <div class="board-canvas" ref=${canvasRef}
        style=${{ backgroundSize: `${24 * view.s}px ${24 * view.s}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
        onPointerDown=${onCanvasDown} onPointerMove=${onMove} onPointerUp=${onUp} onPointerCancel=${onUp}
        onDblClick=${(e) => { if (e.target === canvasRef.current || e.target.classList.contains('board-layer')) add('sticky', toWorld(e.clientX, e.clientY)); }}>
        <div class="board-layer" style=${{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}>
          ${sorted.map((n0) => {
            const t = temp && temp.id === n0.id ? temp : null;
            const n = t ? { ...n0, ...t } : n0;
            const isSel = sel === n.id;
            const isEdit = editing === n.id;
            return html`
              <div key=${n.id} class=${`note note-${n.kind} ${n.kind === 'sticky' ? `nc-${n.color || 'yellow'}` : ''} ${isSel ? 'sel' : ''}`}
                style=${{ left: `${n.x}px`, top: `${n.y}px`, width: `${n.w}px`, height: `${n.h}px`, zIndex: n.z || 0 }}
                onPointerDown=${(e) => onNoteDown(e, n0)}
                onDblClick=${(e) => { e.stopPropagation(); if (n.kind !== 'table') setEditing(n.id); }}>
                ${n.kind === 'table'
                  ? html`
                    <div class="table-grip" onPointerDown=${(e) => onNoteDown(e, n0, 'move-grip')}>⋮⋮</div>
                    <div class="table-grid" style=${{ gridTemplateColumns: `repeat(${n.cells[0].length}, minmax(0, 1fr))` }}>
                      ${n.cells.map((row, ri) => row.map((c, ci) => html`
                        <input class=${`cell ${ri === 0 ? 'head' : ''}`} value=${c} onChange=${(e) => setCell(n0, ri, ci, e.target.value)} onFocus=${() => setSel(n.id)} />`))}
                    </div>`
                  : isEdit
                    ? html`<textarea class="note-edit" autofocus value=${n.text}
                        ref=${(el) => el && document.activeElement !== el && el.focus()}
                        onInput=${(e) => ops.patchNote(n.id, { text: e.target.value })}
                        onBlur=${() => setEditing(null)}
                        onKeyDown=${(e) => { if (e.key === 'Escape') e.target.blur(); }}></textarea>`
                    : html`<div class="note-text">${n.text || html`<span class="muted">${n.kind === 'text' ? 'Текст' : 'Двойной клик — написать'}</span>`}</div>`}
                ${isSel && html`<div class="note-resize" onPointerDown=${(e) => onNoteDown(e, n0, 'resize')}></div>`}
              </div>`;
          })}
        </div>
        ${notes.length === 0 && html`<div class="board-empty">Двойной клик по полю — новый стикер. Тяни фон, чтобы двигать доску. Ctrl + колесо — масштаб.</div>`}
        ${selNote && html`
          <div class="note-menu" onPointerDown=${(e) => e.stopPropagation()}>
            ${selNote.kind === 'sticky' && NOTE_COLORS.map((c) => html`<button class=${`dotc nc-${c} ${selNote.color === c ? 'on' : ''}`} onClick=${() => ops.patchNote(selNote.id, { color: c })} aria-label=${c}></button>`)}
            ${selNote.kind === 'table' && html`
              <button class="tool" onClick=${() => tableOp(selNote, 'row+')}>+ строка</button>
              <button class="tool" onClick=${() => tableOp(selNote, 'row-')}>− строка</button>
              <button class="tool" onClick=${() => tableOp(selNote, 'col+')}>+ столбец</button>
              <button class="tool" onClick=${() => tableOp(selNote, 'col-')}>− столбец</button>`}
            <button class="tool" onClick=${() => { ops.upsertNote({ ...selNote, id: uid(), x: selNote.x + 24, y: selNote.y + 24, z: maxZ() + 1, cells: selNote.cells && selNote.cells.map((r) => [...r]) }); }} title="Дублировать">${Icon.copy(15)}</button>
            <button class="tool danger" onClick=${() => { ops.removeNote(selNote.id); setSel(null); }} title="Удалить">${Icon.trash(15)}</button>
          </div>`}
      </div>
    </div>`;
}

function DocPage({ doc, ops }) {
  const [edit, setEdit] = useState(!doc.body);
  const [body, setBody] = useState(doc.body || '');
  const [title, setTitle] = useState(doc.title || '');
  const timer = useRef(null);
  useEffect(() => { setBody(doc.body || ''); setTitle(doc.title || ''); setEdit(!doc.body); }, [doc.id]);
  useEffect(() => { if (!edit) setBody(doc.body || ''); }, [doc.body]);
  const save = (p) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => ops.patchDoc(doc.id, p), 500);
  };
  const flush = () => { clearTimeout(timer.current); ops.patchDoc(doc.id, { body, title }); };
  const onPreviewClick = (e) => {
    const cb = e.target.closest('input[type=checkbox][data-line]');
    if (!cb) return;
    const lines = body.split('\n');
    const i = Number(cb.dataset.line);
    lines[i] = lines[i].replace(/\[( |x|X)\]/, (m) => (m === '[ ]' ? '[x]' : '[ ]'));
    const next = lines.join('\n');
    setBody(next);
    ops.patchDoc(doc.id, { body: next });
  };
  const html_ = useMemo(() => renderMarkdown(body), [body]);
  return html`
    <div class="doc">
      <div class="doc-head">
        <input class="doc-title" value=${title} placeholder="Без названия"
          onInput=${(e) => { setTitle(e.target.value); save({ title: e.target.value, body }); }} onBlur=${flush} />
        <button class=${edit ? 'primary-btn' : 'ghost-btn'} onClick=${() => { if (edit) flush(); setEdit(!edit); }}>${edit ? 'Готово' : 'Изменить'}</button>
      </div>
      ${edit
        ? html`
          <textarea class="doc-edit" value=${body} placeholder="Пиши здесь. # Заголовок, - список, - [ ] чекбокс, **жирный**, ссылки — как есть."
            ref=${(el) => { if (el) { el.style.height = 'auto'; el.style.height = `${Math.max(320, el.scrollHeight)}px`; } }}
            onInput=${(e) => { setBody(e.target.value); save({ body: e.target.value, title }); e.target.style.height = 'auto'; e.target.style.height = `${Math.max(320, e.target.scrollHeight)}px`; }}
            onBlur=${flush}></textarea>
          <p class="muted small">Markdown: # заголовки, - списки, - [ ] задачи, **жирный**, *курсив*, \`код\`, > цитата, --- линия.</p>`
        : html`<div class="doc-view" onClick=${onPreviewClick} onDblClick=${() => setEdit(true)} dangerouslySetInnerHTML=${{ __html: html_ || '<p class="muted">Пусто. Нажми «Изменить».</p>' }}></div>`}
    </div>`;
}

export function Workspace({ data, ops }) {
  const [mode, setMode] = useState(() => store.get('tt2_ws_mode') || 'board');
  const [activeBoard, setActiveBoard] = useState(() => store.get('tt2_ws_board') || '');
  const [activeDoc, setActiveDoc] = useState(() => store.get('tt2_ws_doc') || '');
  useEffect(() => { store.set('tt2_ws_mode', mode); }, [mode]);
  useEffect(() => { store.set('tt2_ws_board', activeBoard); }, [activeBoard]);
  useEffect(() => { store.set('tt2_ws_doc', activeDoc); }, [activeDoc]);

  const boards = live(data.boards).sort(byOrder);
  const docs = live(data.docs).sort(byOrder);
  const boardList = boards.length ? boards : [{ id: 'main', name: 'Доска', virtual: true }];
  const board = boardList.find((b) => b.id === activeBoard) || boardList[0];
  const doc = docs.find((d) => d.id === activeDoc) || docs[0];
  const notes = live(data.notes).filter((n) => n.board === board.id);

  const ensureBoard = () => { if (board.virtual) ops.upsert('boards', { id: 'main', name: 'Доска', order: 0, createdAt: Date.now() }); };
  const boardOps = {
    upsertNote: (n) => { ensureBoard(); ops.upsert('notes', n); },
    patchNote: (id, p) => ops.patch('notes', id, p),
    removeNote: (id) => ops.remove('notes', id, 'Элемент удалён'),
  };
  const addBoard = () => {
    const name = prompt('Название доски', `Доска ${boardList.length + 1}`);
    if (!name) return;
    ensureBoard();
    const id = uid();
    ops.upsert('boards', { id, name: name.trim(), order: Date.now(), createdAt: Date.now() });
    setActiveBoard(id);
  };
  const addDoc = () => {
    const id = uid();
    ops.upsert('docs', { id, title: '', body: '', order: Date.now(), createdAt: Date.now() });
    setActiveDoc(id);
  };

  return html`
    <section class="workspace card">
      <div class="ws-head">
        <div class="seg">
          <button class=${mode === 'board' ? 'on' : ''} onClick=${() => setMode('board')}>Доска</button>
          <button class=${mode === 'docs' ? 'on' : ''} onClick=${() => setMode('docs')}>Документы</button>
        </div>
        ${mode === 'board'
          ? html`<${Tabs} items=${boardList} active=${board.id} onSelect=${setActiveBoard} onAdd=${addBoard} addLabel="Новая доска"
              onRename=${(id, name) => { if (board.virtual) ops.upsert('boards', { id, name, order: 0, createdAt: Date.now() }); else ops.patch('boards', id, { name }); }}
              onRemove=${(id) => { if (!board.virtual && confirm('Удалить доску со всем содержимым?')) ops.remove('boards', id, 'Доска удалена'); }} />`
          : html`<${Tabs} items=${docs.map((d) => ({ id: d.id, name: d.title }))} active=${doc?.id} onSelect=${setActiveDoc} onAdd=${addDoc} addLabel="Новая страница"
              onRename=${(id, title) => ops.patch('docs', id, { title })}
              onRemove=${(id) => ops.remove('docs', id, 'Страница удалена')} />`}
      </div>
      ${mode === 'board'
        ? html`<${Board} boardId=${board.id} notes=${notes} ops=${boardOps} />`
        : doc
          ? html`<${DocPage} key=${doc.id} doc=${doc} ops=${{ patchDoc: (id, p) => ops.patch('docs', id, p) }} />`
          : html`<div class="ws-empty"><p class="muted">Здесь страницы как в вики: конспекты, планы, ссылки.</p><button class="primary-btn" onClick=${addDoc}>Создать страницу</button></div>`}
    </section>`;
}
