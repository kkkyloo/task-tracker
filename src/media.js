import { uid } from './util.js';
import { encrypt, decrypt } from './sync.js';

const DB = 'tt2_media';
const mem = new Map();
const waiters = new Map();
let ctx = { cfg: null, getGist: () => '', setGist: () => {} };
let fetching = null;
let uploading = false;

const idb = () => new Promise((res, rej) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => {
    r.result.createObjectStore('img');
    r.result.createObjectStore('pending');
  };
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});

const tx = async (store, mode, fn) => {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
    t.onerror = () => rej(t.error);
  });
};

const idbGet = (store, key) => tx(store, 'readonly', (s) => s.get(key)).catch(() => null);
const idbPut = (store, key, val) => tx(store, 'readwrite', (s) => s.put(val, key)).catch(() => {});
const idbDel = (store, key) => tx(store, 'readwrite', (s) => s.delete(key)).catch(() => {});
const idbKeys = (store) => tx(store, 'readonly', (s) => s.getAllKeys()).catch(() => []);

export const configureMedia = (c) => { ctx = { ...ctx, ...c }; };

const notify = (id, url) => {
  mem.set(id, url);
  (waiters.get(id) || []).forEach((fn) => fn(url));
  waiters.delete(id);
};

const api = async (path, opts = {}) => {
  const res = await fetch(`https://api.github.com${path}`, {
    cache: 'no-store',
    ...opts,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${ctx.cfg.token}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return res.json();
};

const pullAll = async () => {
  const gistId = ctx.getGist();
  if (!gistId || !ctx.cfg?.token) return;
  const gist = await api(`/gists/${gistId}`);
  for (const [name, f] of Object.entries(gist.files || {})) {
    const id = name.replace(/\.json$/, '');
    if (mem.has(id)) continue;
    let text = f.content;
    if (f.truncated && f.raw_url) text = await (await fetch(f.raw_url, { cache: 'no-store' })).text();
    try {
      const url = await decrypt(JSON.parse(text), ctx.cfg.pass);
      await idbPut('img', id, url);
      notify(id, url);
    } catch (e) {}
  }
};

export const retryMissing = () => {
  if (waiters.size && !fetching) fetching = pullAll().catch(() => {}).finally(() => { fetching = null; });
};

export const loadImage =(id) => new Promise(async (resolve) => {
  if (mem.has(id)) return resolve(mem.get(id));
  waiters.set(id, [...(waiters.get(id) || []), resolve]);
  const cached = await idbGet('img', id);
  if (cached) return notify(id, cached);
  if (!fetching) fetching = pullAll().catch(() => {}).finally(() => { fetching = null; });
});

const compress = (file) => new Promise((resolve, reject) => {
  const img = new Image();
  const src = URL.createObjectURL(file);
  img.onload = () => {
    const max = 1600;
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * k);
    const h = Math.round(img.naturalHeight * k);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(src);
    let url = c.toDataURL('image/webp', 0.82);
    if (!url.startsWith('data:image/webp')) url = c.toDataURL('image/jpeg', 0.82);
    resolve({ url, w, h });
  };
  img.onerror = () => { URL.revokeObjectURL(src); reject(new Error('Не картинка')); };
  img.src = src;
});

export const saveImage = async (file) => {
  const { url, w, h } = await compress(file);
  const id = `img-${uid()}`;
  await idbPut('img', id, url);
  await idbPut('pending', id, 1);
  notify(id, url);
  flushUploads();
  return { id, w, h };
};

export const flushUploads = async () => {
  if (uploading || !ctx.cfg?.token || !ctx.cfg?.pass) return;
  const ids = await idbKeys('pending');
  if (!ids.length) return;
  uploading = true;
  try {
    const files = {};
    for (const id of ids.slice(0, 8)) {
      const url = mem.get(id) || (await idbGet('img', id));
      if (url) files[`${id}.json`] = { content: JSON.stringify(await encrypt(url, ctx.cfg.pass)) };
    }
    let gistId = ctx.getGist();
    if (!gistId) {
      const g = await api('/gists', { method: 'POST', body: JSON.stringify({ description: '', public: false, files }) });
      gistId = g.id;
      ctx.setGist(gistId);
    } else {
      await api(`/gists/${gistId}`, { method: 'PATCH', body: JSON.stringify({ files }) });
    }
    for (const name of Object.keys(files)) await idbDel('pending', name.replace(/\.json$/, ''));
  } catch (e) {
  } finally {
    uploading = false;
  }
  if ((await idbKeys('pending')).length) setTimeout(flushUploads, 3000);
};

export const imageFromClipboard = (e) => {
  const items = [...(e.clipboardData?.items || [])];
  const it = items.find((x) => x.kind === 'file' && x.type.startsWith('image/'));
  return it ? it.getAsFile() : null;
};

export const pickImage = () => new Promise((resolve) => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = () => resolve(input.files?.[0] || null);
  input.click();
});
