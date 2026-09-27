import { html, useState, useEffect, useRef, useMemo } from '../vendor/preact-htm.js';
import { uid, store } from './util.js';
import { Icon } from './icons.js';
import { loadImage, saveImage, imageFromClipboard, pickImage } from './media.js';

export function Img({ id, className, style, alt = '' }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let alive = true;
    loadImage(id).then((u) => alive && setSrc(u));
    return () => { alive = false; };
  }, [id]);
  return src
    ? html`<img class=${className} style=${style} src=${src} alt=${alt} draggable="false" />`
    : html`<div class=${`${className || ''} img-loading`} style=${style}>Загрузка…</div>`;
}

const NOTE_COLORS = ['yellow', 'pink', 'green', 'blue', 'purple', 'orange', 'gray'];
const live = (map) => Object.values(map || {}).filter((x) => !x.deleted);
const byOrder = (a, b) => (a.order || 0) - (b.order || 0) || (a.createdAt || 0) - (b.createdAt || 0);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const inline = (s) =>
  esc(s)
    .replace(/!\[([^\]]*)\]\(img:([\w-]+)(?: =(\d+))?\)/g, (m, alt, id, w) => `<span class="doc-img" data-img="${id}"${w ? ` style="width:${w}px"` : ''}><img alt="${alt}" draggable="false"><i class="img-handle"></i></span>`)
    .replace(/!\[([^\]]*)\]\((https:\/\/[^)\s]+)\)/g, '<img class="doc-ext-img" alt="$1" src="$2">')
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

  const addImage = async (file, at) => {
    if (!file) return;
    try {
      const img = await saveImage(file);
      const p = at || center();
      const w = Math.min(420, img.w);
      const h = Math.round((w * img.h) / img.w);
      const n = { id: uid(), board: boardId, kind: 'image', src: img.id, x: Math.round(p.x - w / 2), y: Math.round(p.y - h / 2), w, h, z: maxZ() + 1, createdAt: Date.now() };
      ops.upsertNote(n);
      setSel(n.id);
    } catch (e) {}
  };
  const hover = useRef(false);
  useEffect(() => {
    const onPaste = (e) => {
      if (!hover.current || e.target.closest?.('input,textarea,[contenteditable]')) return;
      const file = imageFromClipboard(e);
      if (file) { e.preventDefault(); addImage(file); return; }
      const text = e.clipboardData?.getData('text/plain');
      if (text && text.trim()) {
        e.preventDefault();
        const c = center();
        const n = { id: uid(), board: boardId, kind: 'sticky', x: Math.round(c.x - 90), y: Math.round(c.y - 80), w: 180, h: 160, color: 'yellow', text: text.trim(), z: maxZ() + 1, createdAt: Date.now() };
        ops.upsertNote(n);
        setSel(n.id);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });
  const onDropFiles = (e) => {
    const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault();
    addImage(file, toWorld(e.clientX, e.clientY));
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
    drag.current = { mode: mode === 'move-grip' ? 'move' : mode, id: n.id, sx: e.clientX, sy: e.clientY, x: n.x, y: n.y, w: n.w, h: n.h, ratio: n.kind === 'image' ? n.h / n.w : 0, moved: false };
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
    else {
      const w = Math.max(60, d.w + dx / view.s);
      setTemp({ id: d.id, x: d.x, y: d.y, w, h: d.ratio ? w * d.ratio : Math.max(40, d.h + dy / view.s) });
    }
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
        <button class="tool" onClick=${async () => addImage(await pickImage())} title="Картинка (или Ctrl+V)">${Icon.image(15)}Картинка</button>
        <span class="spacer"></span>
        <button class="tool icon" onClick=${() => zoom(1 / 1.2)} title="Отдалить">−</button>
        <button class="tool zoom-val" onClick=${() => zoom(0)} title="100%">${Math.round(view.s * 100)}%</button>
        <button class="tool icon" onClick=${() => zoom(1.2)} title="Приблизить">+</button>
        <button class="tool" onClick=${fit} title="Показать всё">Всё</button>
      </div>
      <div class="board-canvas" ref=${canvasRef}
        style=${{ backgroundSize: `${24 * view.s}px ${24 * view.s}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
        onPointerDown=${onCanvasDown} onPointerMove=${onMove} onPointerUp=${onUp} onPointerCancel=${onUp}
        onPointerEnter=${() => { hover.current = true; }} onPointerLeave=${() => { hover.current = false; }}
        onDragOver=${(e) => e.preventDefault()} onDrop=${onDropFiles}
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
                onDblClick=${(e) => { e.stopPropagation(); if (n.kind === 'sticky' || n.kind === 'text') setEditing(n.id); }}>
                ${n.kind === 'image'
                  ? html`<${Img} id=${n.src} className="note-img" />`
                  : n.kind === 'table'
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
        ${notes.length === 0 && html`<div class="board-empty">Двойной клик по полю — новый стикер. Ctrl+V — вставить картинку или текст. Тяни фон, чтобы двигать доску. Ctrl + колесо — масштаб.</div>`}
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

function DocPage({ doc, path, ops, onOpen, onAddChild }) {
  const [edit, setEdit] = useState(!doc.body);
  const [body, setBody] = useState(doc.body || '');
  const [title, setTitle] = useState(doc.title || '');
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);
  const viewRef = useRef(null);
  const taRef = useRef(null);
  const bodyRef = useRef(body);
  bodyRef.current = body;
  const titleRef = useRef(title);
  titleRef.current = title;
  useEffect(() => { setBody(doc.body || ''); setTitle(doc.title || ''); setEdit(!doc.body); }, [doc.id]);
  useEffect(() => { if (!edit) setBody(doc.body || ''); }, [doc.body]);
  const save = (p) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => ops.patchDoc(doc.id, { title: titleRef.current, body: bodyRef.current }), 500);
  };
  const flush = () => { clearTimeout(timer.current); ops.patchDoc(doc.id, { body: bodyRef.current, title: titleRef.current }); };
  const setAndSave = (next) => { setBody(next); bodyRef.current = next; clearTimeout(timer.current); ops.patchDoc(doc.id, { body: next, title: titleRef.current }); };

  const insertImage = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const img = await saveImage(file);
      const tag = `![](img:${img.id} =${Math.min(640, img.w)})`;
      const cur = bodyRef.current;
      const ta = taRef.current;
      if (edit && ta) {
        const s = ta.selectionStart;
        const e = ta.selectionEnd;
        const before = cur.slice(0, s);
        const pre = before && !before.endsWith('\n') ? '\n' : '';
        setAndSave(`${before}${pre}${tag}\n${cur.slice(e)}`);
      } else {
        setAndSave(`${cur}${cur && !cur.endsWith('\n') ? '\n' : ''}${tag}\n`);
      }
    } catch (e) {}
    setBusy(false);
  };

  useEffect(() => {
    const onPaste = (e) => {
      const inThis = viewRef.current?.contains(e.target) || taRef.current === e.target || (!edit && viewRef.current && viewRef.current.matches(':hover'));
      if (!inThis) return;
      const file = imageFromClipboard(e);
      if (file) { e.preventDefault(); insertImage(file); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  useEffect(() => {
    if (edit || !viewRef.current) return;
    viewRef.current.querySelectorAll('.doc-img[data-img]').forEach((el) => {
      const img = el.querySelector('img');
      if (img.src) return;
      loadImage(el.dataset.img).then((u) => { img.src = u; });
    });
  });

  const resizing = useRef(null);
  const onViewDown = (e) => {
    const h = e.target.closest('.img-handle');
    if (!h) return;
    e.preventDefault();
    const box = h.parentElement;
    resizing.current = { box, id: box.dataset.img, sx: e.clientX, w: box.getBoundingClientRect().width, max: viewRef.current.clientWidth };
    h.setPointerCapture(e.pointerId);
  };
  const onViewMove = (e) => {
    const r = resizing.current;
    if (!r) return;
    r.cur = Math.round(Math.min(r.max, Math.max(60, r.w + e.clientX - r.sx)));
    r.box.style.width = `${r.cur}px`;
  };
  const onViewUp = () => {
    const r = resizing.current;
    resizing.current = null;
    if (!r || !r.cur) return;
    const re = new RegExp(`\\(img:${r.id}(?: =\\d+)?\\)`);
    setAndSave(bodyRef.current.replace(re, `(img:${r.id} =${r.cur})`));
  };
  const onPreviewClick = (e) => {
    const cb = e.target.closest('input[type=checkbox][data-line]');
    if (!cb) return;
    const lines = bodyRef.current.split('\n');
    const i = Number(cb.dataset.line);
    lines[i] = lines[i].replace(/\[( |x|X)\]/, (m) => (m === '[ ]' ? '[x]' : '[ ]'));
    setAndSave(lines.join('\n'));
  };
  const rendered = useMemo(() => renderMarkdown(body), [body]);
  const grow = (el) => { if (el) { el.style.height = 'auto'; el.style.height = `${Math.max(320, el.scrollHeight)}px`; } };
  return html`
    <div class="doc">
      ${path.length > 0 && html`
        <nav class="crumbs">
          ${path.map((p) => html`<button class="crumb" onClick=${() => onOpen(p.id)}>${p.title || 'Без названия'}</button><span class="crumb-sep">/</span>`)}
          <span class="crumb cur">${title || 'Без названия'}</span>
        </nav>`}
      <div class="doc-head">
        <input class="doc-title" value=${title} placeholder="Без названия"
          onInput=${(e) => { setTitle(e.target.value); titleRef.current = e.target.value; save({ title: e.target.value, body: bodyRef.current }); }} onBlur=${flush} />
        <button class="ghost-btn small" onClick=${async () => insertImage(await pickImage())} title="Картинка (или Ctrl+V)">${Icon.image(15)}</button>
        <button class="ghost-btn small" onClick=${() => onAddChild(doc.id)} title="Вложенная страница">${Icon.plus(15)} подстраница</button>
        <button class=${edit ? 'primary-btn' : 'ghost-btn'} onClick=${() => { if (edit) flush(); setEdit(!edit); }}>${edit ? 'Готово' : 'Изменить'}</button>
      </div>
      ${busy && html`<p class="muted small">Сжимаю картинку…</p>`}
      ${edit
        ? html`
          <textarea class="doc-edit" ref=${(el) => { taRef.current = el; grow(el); }} value=${body}
            placeholder="Пиши здесь. # Заголовок, - список, - [ ] чекбокс, **жирный**. Ctrl+V — вставить картинку."
            onInput=${(e) => { setBody(e.target.value); bodyRef.current = e.target.value; save({ body: e.target.value, title }); grow(e.target); }}
            onBlur=${flush}></textarea>
          <p class="muted small">Markdown: # заголовки, - списки, - [ ] задачи, **жирный**, *курсив*, \`код\`, > цитата, --- линия. Картинки: Ctrl+V, размер — тяни за уголок в режиме просмотра.</p>`
        : html`<div class="doc-view" ref=${viewRef} tabindex="0"
            onClick=${onPreviewClick} onDblClick=${(e) => { if (!e.target.closest('.doc-img')) setEdit(true); }}
            onPointerDown=${onViewDown} onPointerMove=${onViewMove} onPointerUp=${onViewUp}
            dangerouslySetInnerHTML=${{ __html: rendered || '<p class="muted">Пусто. Нажми «Изменить» или вставь картинку Ctrl+V.</p>' }}></div>`}
    </div>`;
}

function DocTree({ docs, active, onOpen, onAddChild, onMove, onRemove }) {
  const [open, setOpen] = useState(() => {
    try { return JSON.parse(store.get('tt2_doc_open')) || {}; } catch (e) { return {}; }
  });
  const [dropAt, setDropAt] = useState(null);
  useEffect(() => { store.set('tt2_doc_open', JSON.stringify(open)); }, [open]);
  const kids = useMemo(() => {
    const m = {};
    for (const d of docs) (m[d.parent || ''] = m[d.parent || ''] || []).push(d);
    Object.values(m).forEach((l) => l.sort(byOrder));
    return m;
  }, [docs]);
  useEffect(() => {
    const byId = Object.fromEntries(docs.map((d) => [d.id, d]));
    let p = byId[active]?.parent;
    const add = {};
    while (p && byId[p]) { if (!open[p]) add[p] = true; p = byId[p].parent; }
    if (Object.keys(add).length) setOpen((o) => ({ ...o, ...add }));
  }, [active]);

  const zoneOf = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    return y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'inside';
  };
  const node = (d, depth) => {
    const children = kids[d.id] || [];
    const isOpen = open[d.id];
    return html`
      <div key=${d.id}>
        <div class=${`tree-row ${d.id === active ? 'on' : ''} ${dropAt?.id === d.id ? `drop-${dropAt.zone}` : ''}`}
          style=${{ paddingLeft: `${6 + depth * 14}px` }}
          draggable="true"
          onDragStart=${(e) => { e.dataTransfer.setData('text/doc-id', d.id); e.dataTransfer.effectAllowed = 'move'; }}
          onDragOver=${(e) => { e.preventDefault(); setDropAt({ id: d.id, zone: zoneOf(e) }); }}
          onDragLeave=${() => setDropAt(null)}
          onDrop=${(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/doc-id'); const z = zoneOf(e); setDropAt(null); if (id && id !== d.id) { onMove(id, d.id, z); if (z === 'inside') setOpen((o) => ({ ...o, [d.id]: true })); } }}
          onClick=${() => onOpen(d.id)}>
          <button class=${`tree-caret ${children.length ? '' : 'empty'} ${isOpen ? 'open' : ''}`}
            onClick=${(e) => { e.stopPropagation(); setOpen((o) => ({ ...o, [d.id]: !o[d.id] })); }}>${Icon.caret(12)}</button>
          <span class="tree-name">${d.title || 'Без названия'}</span>
          <span class="tree-acts">
            <button title="Вложенная страница" onClick=${(e) => { e.stopPropagation(); setOpen((o) => ({ ...o, [d.id]: true })); onAddChild(d.id); }}>${Icon.plus(13)}</button>
            <button title="Удалить" onClick=${(e) => { e.stopPropagation(); onRemove(d.id); }}>${Icon.trash(13)}</button>
          </span>
        </div>
        ${isOpen && children.map((c) => node(c, depth + 1))}
      </div>`;
  };
  return html`
    <div class="tree"
      onDragOver=${(e) => { if (e.target === e.currentTarget) e.preventDefault(); }}
      onDrop=${(e) => { if (e.target !== e.currentTarget) return; const id = e.dataTransfer.getData('text/doc-id'); if (id) onMove(id, '', 'root'); }}>
      ${(kids[''] || []).map((d) => node(d, 0))}
      <button class="tree-add" onClick=${() => onAddChild('')}>${Icon.plus(14)} Новая страница</button>
    </div>`;
}

export function Workspace({ data, ops }) {
  const [mode, setMode] = useState(() => store.get('tt2_ws_mode') || 'board');
  const [activeBoard, setActiveBoard] = useState(() => store.get('tt2_ws_board') || '');
  const [activeDoc, setActiveDoc] = useState(() => store.get('tt2_ws_doc') || '');
  const [treeOpen, setTreeOpen] = useState(false);
  useEffect(() => { store.set('tt2_ws_mode', mode); }, [mode]);
  useEffect(() => { store.set('tt2_ws_board', activeBoard); }, [activeBoard]);
  useEffect(() => { store.set('tt2_ws_doc', activeDoc); }, [activeDoc]);

  const boards = live(data.boards).sort(byOrder);
  const allDocs = live(data.docs);
  const byId = Object.fromEntries(allDocs.map((d) => [d.id, d]));
  const docs = allDocs.map((d) => (d.parent && !byId[d.parent] ? { ...d, parent: '' } : d));
  const boardList = boards.length ? boards : [{ id: 'main', name: 'Доска', virtual: true }];
  const board = boardList.find((b) => b.id === activeBoard) || boardList[0];
  const firstRoot = docs.filter((d) => !d.parent).sort(byOrder)[0];
  const doc = byId[activeDoc] || firstRoot;
  const notes = live(data.notes).filter((n) => n.board === board.id);

  const path = [];
  for (let p = doc && byId[doc.id]?.parent; p && byId[p] && path.length < 20; p = byId[p].parent) path.unshift(byId[p]);

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
  const addDoc = (parent = '') => {
    const id = uid();
    ops.upsert('docs', { id, parent, title: '', body: '', order: Date.now(), createdAt: Date.now() });
    setActiveDoc(id);
    setTreeOpen(false);
  };
  const isDescendant = (id, of) => {
    for (let p = byId[id]?.parent; p; p = byId[p]?.parent) if (p === of) return true;
    return false;
  };
  const moveDoc = (id, target, zone) => {
    if (zone === 'root') { ops.patch('docs', id, { parent: '', order: Date.now() }); return; }
    if (zone === 'inside') {
      if (isDescendant(target, id)) return;
      ops.patch('docs', id, { parent: target, order: Date.now() });
      return;
    }
    const t = byId[target];
    const parent = t.parent || '';
    if (parent && (parent === id || isDescendant(parent, id))) return;
    const sibs = docs.filter((d) => (d.parent || '') === parent && d.id !== id).sort(byOrder);
    const idx = sibs.findIndex((d) => d.id === target);
    const prev = zone === 'before' ? sibs[idx - 1] : t;
    const next = zone === 'before' ? t : sibs[idx + 1];
    const a = prev ? prev.order || 0 : (next.order || 0) - 1000;
    const b = next ? next.order || 0 : (prev.order || 0) + 1000;
    ops.patch('docs', id, { parent, order: (a + b) / 2 });
  };
  const removeDoc = (id) => {
    const ids = [id, ...allDocs.filter((d) => isDescendant(d.id, id)).map((d) => d.id)];
    if (ids.length > 1 && !confirm(`Удалить страницу и ${ids.length - 1} вложенных?`)) return;
    ops.removeMany('docs', ids, ids.length > 1 ? 'Страницы удалены' : 'Страница удалена');
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
          : html`<button class="ghost-btn small tree-toggle" onClick=${() => setTreeOpen(!treeOpen)}>${Icon.page(14)} Страницы (${docs.length})</button>`}
      </div>
      ${mode === 'board'
        ? html`<${Board} boardId=${board.id} notes=${notes} ops=${boardOps} />`
        : html`
          <div class=${`docs-layout ${treeOpen ? 'tree-shown' : ''}`}>
            <aside class="docs-side">
              <${DocTree} docs=${docs} active=${doc?.id}
                onOpen=${(id) => { setActiveDoc(id); setTreeOpen(false); }}
                onAddChild=${addDoc} onMove=${moveDoc} onRemove=${removeDoc} />
            </aside>
            <div class="docs-main">
              ${doc
                ? html`<${DocPage} key=${doc.id} doc=${doc} path=${path} onOpen=${setActiveDoc} onAddChild=${addDoc}
                    ops=${{ patchDoc: (id, p) => ops.patch('docs', id, p) }} />`
                : html`<div class="ws-empty"><p class="muted">Страницы как в вики: конспекты, планы, ссылки. Можно вкладывать страницы друг в друга.</p><button class="primary-btn" onClick=${() => addDoc('')}>Создать страницу</button></div>`}
            </div>
          </div>`}
    </section>`;
}
