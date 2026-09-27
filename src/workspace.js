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
  let codeStart = 0;
  const closeList = () => { if (list) { out.push(list === 'ol' ? '</ol>' : '</ul>'); list = null; } };
  const indent = (sp) => (sp ? ` style="margin-left:${Math.floor(sp.length / 2) * 22}px"` : '');
  lines.forEach((line, i) => {
    if (code !== null) {
      if (/^```/.test(line)) { out.push(`<pre data-l="${codeStart}"><code>${esc(code.join('\n'))}</code></pre>`); code = null; } else code.push(line);
      return;
    }
    if (/^```/.test(line)) { closeList(); code = []; codeStart = i; return; }
    let m;
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) { closeList(); const h = m[1].length + 1; out.push(`<h${h} data-l="${i}">${inline(m[2])}</h${h}>`); return; }
    if (/^---+\s*$/.test(line)) { closeList(); out.push(`<hr data-l="${i}">`); return; }
    if ((m = line.match(/^>\s?(.*)$/))) { closeList(); out.push(`<blockquote data-l="${i}">${inline(m[1])}</blockquote>`); return; }
    if ((m = line.match(/^(\s*)[-*]\s+\[( |x|X)\]\s*(.*)$/))) {
      if (list !== 'checks') { closeList(); out.push('<ul class="checks">'); list = 'checks'; }
      const on = m[2] !== ' ';
      out.push(`<li class="${on ? 'on' : ''}" data-l="${i}"${indent(m[1])}><input type="checkbox" data-line="${i}" ${on ? 'checked' : ''}><span>${inline(m[3])}</span></li>`);
      return;
    }
    if ((m = line.match(/^(\s*)[-*]\s+(.*)$/))) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li data-l="${i}"${indent(m[1])}>${inline(m[2])}</li>`);
      return;
    }
    if ((m = line.match(/^(\s*)\d+[.)]\s+(.*)$/))) {
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li data-l="${i}"${indent(m[1])}>${inline(m[2])}</li>`);
      return;
    }
    closeList();
    out.push(line.trim() ? `<p data-l="${i}">${inline(line)}</p>` : `<div class="gap-line" data-l="${i}"></div>`);
  });
  if (code !== null) out.push(`<pre data-l="${codeStart}"><code>${esc(code.join('\n'))}</code></pre>`);
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

function LiveText({ value, onChange, className, placeholder, autoFocus, onDone, onKeyDown, dataCell, onFocus }) {
  const [local, setLocal] = useState(value || '');
  const focused = useRef(false);
  const ref = useRef(null);
  useEffect(() => { if (!focused.current) setLocal(value || ''); }, [value]);
  useEffect(() => {
    if (autoFocus && ref.current) {
      ref.current.focus();
      const len = ref.current.value.length;
      ref.current.setSelectionRange(len, len);
    }
  }, [autoFocus]);
  const Tag = dataCell ? 'input' : 'textarea';
  return html`<${Tag} ref=${ref} class=${className} value=${local} placeholder=${placeholder} data-cell=${dataCell}
    onFocus=${() => { focused.current = true; onFocus && onFocus(); }}
    onBlur=${() => { focused.current = false; if (local !== (value || '')) onChange(local); onDone && onDone(); }}
    onInput=${(e) => { setLocal(e.target.value); onChange(e.target.value); }}
    onKeyDown=${(e) => { if (e.key === 'Escape') e.target.blur(); onKeyDown && onKeyDown(e); }} />`;
}

function Board({ boardId, notes, ops }) {
  const viewKey = `tt2_view_${boardId}`;
  const [view, setView] = useState(() => {
    try { return JSON.parse(store.get(viewKey)) || null; } catch (e) { return null; }
  });
  const [sel, setSel] = useState(null);
  const [editing, setEditing] = useState(null);
  const [temp, setTemp] = useState(null);
  const [active, setActive] = useState(false);
  const [full, setFull] = useState(false);
  const [cellFocus, setCellFocus] = useState(null);
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const drag = useRef(null);
  const pointers = useRef(new Map());
  const v = view || { x: 40, y: 40, s: 1 };

  useEffect(() => { if (view) store.set(viewKey, JSON.stringify(view)); }, [view]);
  useEffect(() => {
    setSel(null);
    setEditing(null);
    try { setView(JSON.parse(store.get(viewKey)) || null); } catch (e) { setView(null); }
  }, [boardId]);
  useEffect(() => { if (!view && notes.length && canvasRef.current) fit(); }, [boardId, notes.length > 0]);
  useEffect(() => {
    const off = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) { setActive(false); setSel(null); setEditing(null); } };
    document.addEventListener('pointerdown', off);
    return () => document.removeEventListener('pointerdown', off);
  }, []);
  useEffect(() => {
    document.body.classList.toggle('no-scroll', full);
    return () => document.body.classList.remove('no-scroll');
  }, [full]);

  const toWorld = (cx, cy) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: (cx - r.left - v.x) / v.s, y: (cy - r.top - v.y) / v.s };
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
      ? { ...base, x: Math.round(p.x - 90), y: Math.round(p.y - 80), w: 180, h: 160, color: 'yellow', text: '' }
      : kind === 'text'
        ? { ...base, x: Math.round(p.x - 120), y: Math.round(p.y - 24), w: 260, h: 48, text: '' }
        : { ...base, x: Math.round(p.x - 180), y: Math.round(p.y - 70), w: 390, h: 140, cells: [['Колонка 1', 'Колонка 2', 'Колонка 3'], ['', '', ''], ['', '', '']] };
    ops.upsertNote(n);
    setSel(n.id);
    setActive(true);
    if (kind === 'table') focusCell(n.id, 1, 0);
    else setEditing(n.id);
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
      if (!(hover.current || active) || e.target.closest?.('input,textarea,[contenteditable]')) return;
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

  const isBg = (t) => t === canvasRef.current || t.classList.contains('board-layer');
  const onCanvasDown = (e) => {
    setActive(true);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      drag.current = { mode: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, v0: v };
      setTemp(null);
      return;
    }
    if (!isBg(e.target)) return;
    if (document.activeElement && wrapRef.current.contains(document.activeElement)) document.activeElement.blur();
    setSel(null);
    setEditing(null);
    drag.current = { mode: 'pan', sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y };
    try { canvasRef.current.setPointerCapture(e.pointerId); } catch (err) {}
  };
  const onNoteDown = (e, n, mode = 'move') => {
    if (pointers.current.size >= 1 && e.pointerType === 'touch' && mode === 'move' && drag.current?.mode === 'pan') return;
    if (editing === n.id && mode === 'move') return;
    if (mode === 'move' && e.target.closest('input,textarea,button')) { setSel(n.id); return; }
    e.stopPropagation();
    setActive(true);
    const wasSel = sel === n.id;
    setSel(n.id);
    if (editing && editing !== n.id) setEditing(null);
    drag.current = { mode: mode === 'move-grip' ? 'move' : mode, id: n.id, sx: e.clientX, sy: e.clientY, x: n.x, y: n.y, w: n.w, h: n.h, ratio: n.kind === 'image' ? n.h / n.w : 0, moved: false, wasSel, kind: n.kind };
    try { canvasRef.current.setPointerCapture(e.pointerId); } catch (err) {}
  };
  const onMove = (e) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = drag.current;
    if (!d) return;
    if (d.mode === 'pinch') {
      if (pointers.current.size < 2) return;
      const [a, b] = [...pointers.current.values()];
      const r = canvasRef.current.getBoundingClientRect();
      const s = clampScale(d.v0.s * (Math.hypot(a.x - b.x, a.y - b.y) / d.dist));
      const mx = (a.x + b.x) / 2 - r.left;
      const my = (a.y + b.y) / 2 - r.top;
      const ox = d.mid.x - r.left;
      const oy = d.mid.y - r.top;
      setView({ s, x: mx - ((ox - d.v0.x) * s) / d.v0.s, y: my - ((oy - d.v0.y) * s) / d.v0.s });
      return;
    }
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (d.mode === 'pan') { setView({ ...v, x: d.vx + dx, y: d.vy + dy }); return; }
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (!d.moved) return;
    if (d.mode === 'move') setTemp({ id: d.id, x: d.x + dx / v.s, y: d.y + dy / v.s, w: d.w, h: d.h });
    else {
      const w = Math.max(60, d.w + dx / v.s);
      setTemp({ id: d.id, x: d.x, y: d.y, w, h: d.ratio ? w * d.ratio : Math.max(40, d.h + dy / v.s) });
    }
  };
  const onUp = (e) => {
    pointers.current.delete(e.pointerId);
    const d = drag.current;
    if (d?.mode === 'pinch') { if (pointers.current.size < 2) drag.current = null; return; }
    drag.current = null;
    if (d && d.mode !== 'pan' && temp && d.moved) {
      ops.patchNote(d.id, { x: Math.round(temp.x), y: Math.round(temp.y), w: Math.round(temp.w), h: Math.round(temp.h), z: maxZ() + 1 });
    } else if (d && d.mode === 'move' && !d.moved && d.wasSel && (d.kind === 'sticky' || d.kind === 'text')) {
      setEditing(d.id);
    }
    setTemp(null);
  };
  const onWheel = (e) => {
    if (!(active || full) && !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const r = canvasRef.current.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      setView((cur) => {
        const c = cur || v;
        const s = clampScale(c.s * Math.exp(-e.deltaY * 0.0025));
        return { s, x: px - ((px - c.x) * s) / c.s, y: py - ((py - c.y) * s) / c.s };
      });
    } else {
      setView((cur) => { const c = cur || v; return { ...c, x: c.x - e.deltaX, y: c.y - e.deltaY }; });
    }
  };
  useEffect(() => {
    const el = canvasRef.current;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const duplicate = (n) => {
    const copy = { ...n, id: uid(), x: n.x + 24, y: n.y + 24, z: maxZ() + 1, cells: n.cells && n.cells.map((r) => [...r]) };
    ops.upsertNote(copy);
    setSel(copy.id);
  };
  useEffect(() => {
    const onKey = (e) => {
      if (full && e.key === 'Escape' && !sel && !editing) { setFull(false); return; }
      if (!sel || editing || e.target.closest?.('input,textarea')) return;
      const n = notes.find((x) => x.id === sel);
      if (!n) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); ops.removeNote(sel); setSel(null); }
      else if (e.key === 'Escape') setSel(null);
      else if (e.key === 'Enter' && (n.kind === 'sticky' || n.kind === 'text')) { e.preventDefault(); setEditing(n.id); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(n); }
      else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        ops.patchNote(n.id, { x: n.x + dx, y: n.y + dy });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel, editing, notes, full]);

  const zoom = (f) => {
    const r = canvasRef.current.getBoundingClientRect();
    const px = r.width / 2;
    const py = r.height / 2;
    const s = f ? clampScale(v.s * f) : 1;
    setView({ s, x: px - ((px - v.x) * s) / v.s, y: py - ((py - v.y) * s) / v.s });
  };
  function fit() {
    if (!notes.length) { setView({ x: 40, y: 40, s: 1 }); return; }
    const r = canvasRef.current.getBoundingClientRect();
    const minX = Math.min(...notes.map((n) => n.x));
    const minY = Math.min(...notes.map((n) => n.y));
    const maxX = Math.max(...notes.map((n) => n.x + n.w));
    const maxY = Math.max(...notes.map((n) => n.y + n.h));
    const s = clampScale(Math.min((r.width - 80) / Math.max(1, maxX - minX), (r.height - 80) / Math.max(1, maxY - minY), 1.2));
    setView({ s, x: (r.width - (maxX - minX) * s) / 2 - minX * s, y: (r.height - (maxY - minY) * s) / 2 - minY * s });
  }

  const cellsRef = useRef({});
  const getCells = (n) => cellsRef.current[n.id] || n.cells;
  const setCell = (n, ri, ci, val) => {
    const cells = getCells(n).map((row) => [...row]);
    cells[ri][ci] = val;
    cellsRef.current[n.id] = cells;
    ops.patchNote(n.id, { cells });
  };
  useEffect(() => { cellsRef.current = {}; }, [notes]);
  function focusCell(id, r, c, tries = 0) {
    const el = wrapRef.current?.querySelector(`[data-cell="${id}:${r}:${c}"]`);
    if (el) { el.focus(); el.select(); return; }
    if (tries < 10) setTimeout(() => focusCell(id, r, c, tries + 1), 16);
  }
  const tableOp = (n, op, at) => {
    let cells = getCells(n).map((row) => [...row]);
    const rows = cells.length;
    const cols = cells[0].length;
    if (op === 'row+') cells.splice(at ?? rows, 0, cells[0].map(() => ''));
    if (op === 'row-' && rows > 1) cells.splice(at ?? rows - 1, 1);
    if (op === 'col+') cells = cells.map((r) => { const x = [...r]; x.splice(at ?? cols, 0, ''); return x; });
    if (op === 'col-' && cols > 1) cells = cells.map((r) => { const x = [...r]; x.splice(at ?? cols - 1, 1); return x; });
    cellsRef.current[n.id] = cells;
    ops.patchNote(n.id, { cells, w: Math.max(160, n.w + (cells[0].length - cols) * 120) });
    return cells;
  };
  const onCellKey = (e, n, ri, ci) => {
    const cells = getCells(n);
    const rows = cells.length;
    const cols = cells[0].length;
    if (e.key === 'Tab') {
      e.preventDefault();
      let r = ri;
      let c = ci + (e.shiftKey ? -1 : 1);
      if (c >= cols) { c = 0; r += 1; }
      if (c < 0) { c = cols - 1; r -= 1; }
      if (r < 0) return;
      if (r >= rows) tableOp(n, 'row+');
      focusCell(n.id, r, c);
    } else if (e.key === 'Enter' || (e.key === 'ArrowDown')) {
      e.preventDefault();
      if (ri + 1 >= rows) { if (e.key === 'Enter') tableOp(n, 'row+'); else return; }
      focusCell(n.id, ri + 1, ci);
    } else if (e.key === 'ArrowUp' && ri > 0) {
      e.preventDefault();
      focusCell(n.id, ri - 1, ci);
    }
  };

  const sorted = [...notes].sort((a, b) => (a.z || 0) - (b.z || 0));
  const selNote = notes.find((n) => n.id === sel);
  const cf = cellFocus && cellFocus.id === selNote?.id ? cellFocus : null;

  return html`
    <div class=${`board-wrap ${full ? 'board-full' : ''} ${active ? 'active' : ''}`} ref=${wrapRef}>
      <div class="board-tools">
        <button class="tool" onClick=${() => add('sticky')} title="Стикер (двойной клик по полю)"><span class="tool-sticky"></span><span class="tool-label">Стикер</span></button>
        <button class="tool" onClick=${() => add('text')} title="Текст"><b class="tool-t">T</b><span class="tool-label">Текст</span></button>
        <button class="tool" onClick=${() => add('table')} title="Таблица"><span class="tool-table"></span><span class="tool-label">Таблица</span></button>
        <button class="tool" onClick=${async () => addImage(await pickImage())} title="Картинка (или Ctrl+V)">${Icon.image(15)}<span class="tool-label">Картинка</span></button>
        <span class="spacer"></span>
        <button class="tool icon" onClick=${() => zoom(1 / 1.2)} title="Отдалить">−</button>
        <button class="tool zoom-val" onClick=${() => zoom(0)} title="Масштаб 100%">${Math.round(v.s * 100)}%</button>
        <button class="tool icon" onClick=${() => zoom(1.2)} title="Приблизить">+</button>
        <button class="tool" onClick=${fit} title="Показать всё">Всё</button>
        <button class="tool icon" onClick=${() => setFull(!full)} title=${full ? 'Свернуть (Esc)' : 'На весь экран'}>${full ? Icon.shrink(15) : Icon.expand(15)}</button>
      </div>
      <div class="board-canvas" ref=${canvasRef}
        style=${{ backgroundSize: `${24 * v.s}px ${24 * v.s}px`, backgroundPosition: `${v.x}px ${v.y}px` }}
        onPointerDown=${onCanvasDown} onPointerMove=${onMove} onPointerUp=${onUp} onPointerCancel=${onUp}
        onPointerEnter=${() => { hover.current = true; }} onPointerLeave=${() => { hover.current = false; }}
        onDragOver=${(e) => e.preventDefault()} onDrop=${onDropFiles}
        onDblClick=${(e) => { if (isBg(e.target)) add('sticky', toWorld(e.clientX, e.clientY)); }}>
        <div class="board-layer" style=${{ transform: `translate(${v.x}px, ${v.y}px) scale(${v.s})` }}>
          ${sorted.map((n0) => {
            const t = temp && temp.id === n0.id ? temp : null;
            const n = t ? { ...n0, ...t } : n0;
            const isSel = sel === n.id;
            const isEdit = editing === n.id;
            const autoH = n.kind === 'table' || n.kind === 'text';
            return html`
              <div key=${n.id} class=${`note note-${n.kind} ${n.kind === 'sticky' ? `nc-${n.color || 'yellow'}` : ''} ${isSel ? 'sel' : ''} ${isEdit ? 'editing' : ''}`}
                style=${{ left: `${n.x}px`, top: `${n.y}px`, width: `${n.w}px`, height: autoH ? 'auto' : `${n.h}px`, minHeight: n.kind === 'text' ? '40px' : undefined, zIndex: n.z || 0 }}
                onPointerDown=${(e) => onNoteDown(e, n0)}
                onDblClick=${(e) => { e.stopPropagation(); if (n.kind === 'sticky' || n.kind === 'text') setEditing(n.id); }}>
                ${n.kind === 'image'
                  ? html`<${Img} id=${n.src} className="note-img" />`
                  : n.kind === 'table'
                  ? html`
                    <div class="table-grip" onPointerDown=${(e) => onNoteDown(e, n0, 'move-grip')} title="Перетащить">⋮⋮</div>
                    <div class="table-grid" style=${{ gridTemplateColumns: `repeat(${n.cells[0].length}, minmax(0, 1fr))` }}>
                      ${n.cells.map((row, ri) => row.map((c, ci) => html`
                        <${LiveText} key=${`${ri}:${ci}`} dataCell=${`${n.id}:${ri}:${ci}`} className=${`cell ${ri === 0 ? 'head' : ''}`} value=${c}
                          onChange=${(val) => setCell(n0, ri, ci, val)}
                          onFocus=${() => { setSel(n.id); setCellFocus({ id: n.id, r: ri, c: ci }); }}
                          onKeyDown=${(e) => onCellKey(e, n0, ri, ci)} />`))}
                    </div>
                    ${isSel && html`
                      <button class="tbl-add tbl-add-col" title="Добавить столбец" onPointerDown=${(e) => e.stopPropagation()} onClick=${() => tableOp(n0, 'col+')}>+</button>
                      <button class="tbl-add tbl-add-row" title="Добавить строку" onPointerDown=${(e) => e.stopPropagation()} onClick=${() => tableOp(n0, 'row+')}>+</button>`}`
                  : isEdit
                    ? html`<${LiveText} className="note-edit" autoFocus value=${n.text} placeholder=${n.kind === 'text' ? 'Текст' : 'Напиши…'}
                        onChange=${(val) => ops.patchNote(n.id, { text: val })} onDone=${() => setEditing(null)} />`
                    : html`<div class="note-text">${n.text || html`<span class="muted">${n.kind === 'text' ? 'Текст' : 'Клик ещё раз — написать'}</span>`}</div>`}
                ${isSel && !isEdit && html`<div class=${`note-resize ${autoH ? 'w-only' : ''}`} onPointerDown=${(e) => onNoteDown(e, n0, 'resize')}></div>`}
              </div>`;
          })}
        </div>
        ${notes.length === 0 && html`<div class="board-empty">Двойной клик по полю — стикер · Ctrl+V — картинка или текст · тяни фон — двигать · Ctrl+колесо или щипок — масштаб</div>`}
        ${selNote && !temp && html`
          <div class="note-menu" onPointerDown=${(e) => e.stopPropagation()}>
            ${selNote.kind === 'sticky' && NOTE_COLORS.map((c) => html`<button class=${`dotc nc-${c} ${selNote.color === c ? 'on' : ''}`} onClick=${() => ops.patchNote(selNote.id, { color: c })} aria-label=${c}></button>`)}
            ${selNote.kind === 'sticky' && html`<span class="menu-sep"></span>`}
            ${selNote.kind === 'table' && html`
              <button class="tool" onClick=${() => tableOp(selNote, 'row+', cf ? cf.r + 1 : undefined)} title="Строка ниже">+ строка</button>
              <button class="tool" onClick=${() => tableOp(selNote, 'col+', cf ? cf.c + 1 : undefined)} title="Столбец правее">+ столбец</button>
              <button class="tool" onClick=${() => { tableOp(selNote, 'row-', cf ? cf.r : undefined); setCellFocus(null); }} title=${cf ? 'Удалить строку с курсором' : 'Удалить последнюю строку'}>− строка</button>
              <button class="tool" onClick=${() => { tableOp(selNote, 'col-', cf ? cf.c : undefined); setCellFocus(null); }} title=${cf ? 'Удалить столбец с курсором' : 'Удалить последний столбец'}>− столбец</button>
              <span class="menu-sep"></span>`}
            ${(selNote.kind === 'sticky' || selNote.kind === 'text') && html`<button class="tool" onClick=${() => setEditing(selNote.id)} title="Редактировать (Enter)">Изменить</button>`}
            <button class="tool" onClick=${() => ops.patchNote(selNote.id, { z: maxZ() + 1 })} title="На передний план">${Icon.up(15)}</button>
            <button class="tool" onClick=${() => duplicate(selNote)} title="Дублировать (Ctrl+D)">${Icon.copy(15)}</button>
            <button class="tool danger" onClick=${() => { ops.removeNote(selNote.id); setSel(null); }} title="Удалить (Delete)">${Icon.trash(15)}</button>
          </div>`}
        ${!active && !full && notes.length > 0 && html`<div class="board-hint">Кликни по доске, чтобы двигать её колесом мыши</div>`}
      </div>
    </div>`;
}

const LIST_RE = /^(\s*)([-*] \[[ xX]\] |[-*] |(\d+)[.)] )/;

function DocPage({ doc, path, ops, onOpen, onAddChild }) {
  const [edit, setEdit] = useState(!doc.body);
  const [body, setBody] = useState(doc.body || '');
  const [title, setTitle] = useState(doc.title || '');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(true);
  const timer = useRef(null);
  const rootRef = useRef(null);
  const viewRef = useRef(null);
  const taRef = useRef(null);
  const caretLine = useRef(null);
  const bodyRef = useRef(body);
  bodyRef.current = body;
  const titleRef = useRef(title);
  titleRef.current = title;

  useEffect(() => { setBody(doc.body || ''); setTitle(doc.title || ''); setEdit(!doc.body); }, [doc.id]);
  useEffect(() => { if (!edit) setBody(doc.body || ''); }, [doc.body]);
  useEffect(() => () => { clearTimeout(timer.current); }, []);

  const commit = () => { clearTimeout(timer.current); ops.patchDoc(doc.id, { title: titleRef.current, body: bodyRef.current }); setSaved(true); };
  const save = () => {
    setSaved(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(commit, 500);
  };
  const setAndSave = (next, caret) => {
    setBody(next);
    bodyRef.current = next;
    commit();
    if (caret != null) requestAnimationFrame(() => { const ta = taRef.current; if (ta) { ta.focus(); ta.setSelectionRange(caret[0], caret[1]); grow(ta); } });
  };
  const grow = (el) => { if (el) { el.style.height = 'auto'; el.style.height = `${Math.max(280, el.scrollHeight + 4)}px`; } };

  useEffect(() => {
    if (!edit) return;
    const ta = taRef.current;
    if (!ta) return;
    grow(ta);
    if (caretLine.current != null) {
      const lines = bodyRef.current.split('\n');
      const pos = lines.slice(0, caretLine.current).reduce((a, l) => a + l.length + 1, 0) + (lines[caretLine.current] || '').length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
      caretLine.current = null;
    }
  }, [edit]);

  const wrap = (before, after = before, ph = 'текст') => {
    const ta = taRef.current;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const cur = bodyRef.current;
    const sel = cur.slice(s, e) || ph;
    setAndSave(cur.slice(0, s) + before + sel + after + cur.slice(e), [s + before.length, s + before.length + sel.length]);
  };
  const linePrefix = (prefix) => {
    const ta = taRef.current;
    const cur = bodyRef.current;
    const s = cur.lastIndexOf('\n', ta.selectionStart - 1) + 1;
    let e = cur.indexOf('\n', ta.selectionEnd);
    if (e < 0) e = cur.length;
    const lines = cur.slice(s, e).split('\n');
    const all = lines.every((l) => l.startsWith(prefix));
    const fixed = lines.map((l) => {
      const clean = l.replace(/^(#{1,3} |> |[-*] \[[ xX]\] |[-*] |\d+[.)] )/, '');
      return all ? l.slice(prefix.length) : prefix + clean;
    }).join('\n');
    setAndSave(cur.slice(0, s) + fixed + cur.slice(e), [s, s + fixed.length]);
  };
  const insertBlock = (text) => {
    const ta = taRef.current;
    const cur = bodyRef.current;
    const s = ta ? ta.selectionStart : cur.length;
    const before = cur.slice(0, s);
    const pre = before && !before.endsWith('\n') ? '\n' : '';
    const next = `${before}${pre}${text}\n${cur.slice(s)}`;
    const pos = before.length + pre.length + text.length + 1;
    setAndSave(next, [pos, pos]);
  };
  const addLink = () => {
    const url = prompt('Ссылка', 'https://');
    if (!url || url === 'https://') return;
    wrap('[', `](${url})`, 'ссылка');
  };

  const insertImage = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const img = await saveImage(file);
      const tag = `![](img:${img.id} =${Math.min(640, img.w)})`;
      if (edit && taRef.current) insertBlock(tag);
      else {
        const cur = bodyRef.current;
        setAndSave(`${cur}${cur && !cur.endsWith('\n') ? '\n' : ''}${tag}\n`);
      }
    } catch (e) {}
    setBusy(false);
  };

  useEffect(() => {
    const onPaste = (e) => {
      const inThis = rootRef.current?.contains(e.target) || (!edit && viewRef.current && viewRef.current.matches(':hover'));
      if (!inThis || e.target.classList?.contains('doc-title')) return;
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

  const onKeyDown = (e) => {
    const ta = e.target;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); wrap('**'); return; }
    if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); wrap('*'); return; }
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); addLink(); return; }
    if (e.key === 'Escape') { e.preventDefault(); commit(); setEdit(false); return; }
    const cur = bodyRef.current;
    const s = ta.selectionStart;
    const lineStart = cur.lastIndexOf('\n', s - 1) + 1;
    const line = cur.slice(lineStart, s);
    if (e.key === 'Enter' && !e.shiftKey && s === ta.selectionEnd) {
      const m = line.match(LIST_RE);
      if (!m) return;
      e.preventDefault();
      if (line.trim() === m[0].trim()) { setAndSave(cur.slice(0, lineStart) + cur.slice(s), [lineStart, lineStart]); return; }
      let marker = m[2];
      if (m[3]) marker = `${Number(m[3]) + 1}${m[2].slice(m[3].length)}`;
      if (/\[[xX]\]/.test(marker)) marker = marker.replace(/\[[xX]\]/, '[ ]');
      const ins = `\n${m[1]}${marker}`;
      setAndSave(cur.slice(0, s) + ins + cur.slice(s), [s + ins.length, s + ins.length]);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const full = cur.slice(lineStart);
      if (e.shiftKey) {
        const n = full.startsWith('  ') ? 2 : full.startsWith(' ') ? 1 : 0;
        if (n) setAndSave(cur.slice(0, lineStart) + cur.slice(lineStart + n), [Math.max(lineStart, s - n), Math.max(lineStart, s - n)]);
      } else {
        setAndSave(`${cur.slice(0, lineStart)}  ${cur.slice(lineStart)}`, [s + 2, s + 2]);
      }
    }
  };

  const resizing = useRef(null);
  const onViewDown = (e) => {
    const h = e.target.closest('.img-handle');
    if (!h) return;
    e.preventDefault();
    const box = h.parentElement;
    resizing.current = { box, id: box.dataset.img, sx: e.clientX, w: box.getBoundingClientRect().width, max: viewRef.current.clientWidth };
    try { h.setPointerCapture(e.pointerId); } catch (err) {}
  };
  const onViewMove = (e) => {
    const r = resizing.current;
    if (!r) return;
    r.cur = Math.round(Math.min(r.max, Math.max(60, r.w + e.clientX - r.sx)));
    r.box.style.width = `${r.cur}px`;
  };
  const onViewUp = () => {
    const r = resizing.current;
    if (!r) return;
    setTimeout(() => { resizing.current = null; }, 0);
    if (!r.cur) return;
    r.done = true;
    const re = new RegExp(`\\(img:${r.id}(?: =\\d+)?\\)`);
    setAndSave(bodyRef.current.replace(re, `(img:${r.id} =${r.cur})`));
  };
  const onViewClick = (e) => {
    if (resizing.current) return;
    const cb = e.target.closest('input[type=checkbox][data-line]');
    if (cb) {
      const lines = bodyRef.current.split('\n');
      const i = Number(cb.dataset.line);
      lines[i] = lines[i].replace(/\[( |x|X)\]/, (m) => (m === '[ ]' ? '[x]' : '[ ]'));
      setAndSave(lines.join('\n'));
      return;
    }
    if (e.target.closest('a,.doc-img,img')) return;
    if (window.getSelection && String(window.getSelection()).length) return;
    const blk = e.target.closest('[data-l]');
    caretLine.current = blk ? Number(blk.dataset.l) : bodyRef.current.split('\n').length - 1;
    setEdit(true);
  };
  const onTaBlur = (e) => {
    commit();
    const to = e.relatedTarget;
    if (to && rootRef.current?.contains(to)) return;
    if (bodyRef.current.trim()) setEdit(false);
  };

  const rendered = useMemo(() => renderMarkdown(body), [body]);
  const tb = (icon, title, fn) => html`<button class="md-btn" title=${title} onMouseDown=${(e) => e.preventDefault()} onClick=${fn}>${icon}</button>`;
  const words = body.trim() ? body.trim().split(/\s+/).length : 0;

  return html`
    <div class="doc" ref=${rootRef}>
      <div class="doc-top">
        <nav class="crumbs">
          ${path.map((p) => html`<button class="crumb" onClick=${() => onOpen(p.id)}>${p.title || 'Без названия'}</button><span class="crumb-sep">/</span>`)}
          <span class="crumb cur">${title || 'Без названия'}</span>
        </nav>
        <span class="doc-status muted small">${busy ? 'Сжимаю картинку…' : saved ? 'Сохранено' : 'Сохраняю…'} · ${words} сл.</span>
      </div>
      <div class="doc-head">
        <input class="doc-title" value=${title} placeholder="Без названия"
          onInput=${(e) => { setTitle(e.target.value); titleRef.current = e.target.value; save(); }}
          onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); caretLine.current = 0; if (edit) taRef.current?.focus(); else setEdit(true); } }}
          onBlur=${commit} />
      </div>
      <div class="md-bar">
        ${edit
          ? html`
            ${tb(html`<b>H1</b>`, 'Заголовок', () => linePrefix('# '))}
            ${tb(html`<b>H2</b>`, 'Подзаголовок', () => linePrefix('## '))}
            ${tb(html`<b>H3</b>`, 'Малый заголовок', () => linePrefix('### '))}
            <span class="md-sep"></span>
            ${tb(Icon.bold(16), 'Жирный (Ctrl+B)', () => wrap('**'))}
            ${tb(Icon.italic(16), 'Курсив (Ctrl+I)', () => wrap('*'))}
            ${tb(html`<s>S</s>`, 'Зачёркнутый', () => wrap('~~'))}
            ${tb(Icon.code(16), 'Код', () => wrap('`'))}
            ${tb(Icon.link(16), 'Ссылка (Ctrl+K)', addLink)}
            <span class="md-sep"></span>
            ${tb(Icon.list(16), 'Список', () => linePrefix('- '))}
            ${tb(html`<b>1.</b>`, 'Нумерованный список', () => linePrefix('1. '))}
            ${tb(Icon.checklist(16), 'Чек-лист', () => linePrefix('- [ ] '))}
            ${tb(Icon.quote(16), 'Цитата', () => linePrefix('> '))}
            ${tb(Icon.hr(16), 'Разделитель', () => insertBlock('---'))}
            ${tb(Icon.image(16), 'Картинка (Ctrl+V)', async () => insertImage(await pickImage()))}`
          : html`<span class="muted small">Клик по тексту — редактировать. Ctrl+V — вставить картинку.</span>`}
        <span class="spacer"></span>
        <button class="md-btn wide" onMouseDown=${(e) => e.preventDefault()} onClick=${() => onAddChild(doc.id)} title="Вложенная страница">${Icon.plus(15)} Подстраница</button>
        <button class="md-btn wide on" onMouseDown=${(e) => e.preventDefault()} onClick=${() => { commit(); setEdit(!edit); }}>${edit ? html`${Icon.eye(15)} Просмотр` : html`${Icon.pen(15)} Редактировать`}</button>
      </div>
      ${edit
        ? html`<textarea class="doc-edit" ref=${taRef} value=${body}
            placeholder="Начни писать… # заголовок, - список, - [ ] задача. Enter продолжает список, Tab — вложенность."
            onInput=${(e) => { setBody(e.target.value); bodyRef.current = e.target.value; save(); grow(e.target); }}
            onKeyDown=${onKeyDown} onBlur=${onTaBlur}></textarea>`
        : html`<div class="doc-view" ref=${viewRef}
            onClick=${onViewClick}
            onPointerDown=${onViewDown} onPointerMove=${onViewMove} onPointerUp=${onViewUp}
            dangerouslySetInnerHTML=${{ __html: rendered || '<p class="muted" data-l="0">Пусто — кликни, чтобы начать писать.</p>' }}></div>`}
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
