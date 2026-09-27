import { store } from './util.js';
import { normalize, merge, sameData, emptyData } from './data.js';

export const FILE_V2 = 'tracker-v2.json';
export const FILE_LEGACY = 'tasks.json';

const KEY_GIST = 'tracker_gist_id';
const KEY_TOKEN = 'tracker_gh_token';
const KEY_PASS = 'tracker_master_pass';
export const loadConfig = () => ({
  gistId: (store.get(KEY_GIST) || '').trim(),
  token: (store.get(KEY_TOKEN) || '').trim(),
  pass: store.get(KEY_PASS) || '',
});

export const saveConfig = ({ gistId, token, pass }) => {
  if (gistId !== undefined) (gistId ? store.set(KEY_GIST, gistId.trim()) : store.remove(KEY_GIST));
  if (token !== undefined) (token ? store.set(KEY_TOKEN, token.trim()) : store.remove(KEY_TOKEN));
  if (pass !== undefined) (pass ? store.set(KEY_PASS, pass) : store.remove(KEY_PASS));
};

const b64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));

const keyCache = new Map();
let sessionSalt = null;

const deriveKey = async (pass, saltB64) => {
  const id = `${saltB64}|${pass}`;
  if (keyCache.has(id)) return keyCache.get(id);
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: unb64(saltB64), iterations: 100000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  keyCache.set(id, key);
  return key;
};

export const encrypt = async (obj, pass) => {
  if (!sessionSalt) sessionSalt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pass, sessionSalt);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return { encrypted: true, version: 2, salt: sessionSalt, iv: b64(iv), ciphertext: b64(ct) };
};

export class PinError extends Error {}

export const decrypt = async (container, pass) => {
  if (!container || !container.encrypted) return container;
  if (!pass) throw new PinError('Нужен PIN');
  try {
    const key = await deriveKey(pass, container.salt);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(container.iv) }, key, unb64(container.ciphertext));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch (e) {
    throw new PinError('Неверный PIN');
  }
};

const api = async (path, token, opts = {}) => {
  const headers = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`https://api.github.com${path}`, { cache: 'no-store', ...opts, headers });
  if (!res.ok) {
    let msg = `GitHub ${res.status}`;
    if (res.status === 401) msg = 'Токен GitHub неверный или истёк';
    else if (res.status === 404) msg = 'Gist не найден — проверь ID и доступ токена';
    else if (res.status === 403) msg = 'GitHub ограничил запросы — нужен токен';
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res.json();
};

const fileContent = async (file) => {
  if (!file) return null;
  let text = file.content;
  if (file.truncated && file.raw_url) text = await (await fetch(file.raw_url, { cache: 'no-store' })).text();
  if (!text) return null;
  return JSON.parse(text.replace(/^﻿/, ''));
};

export const pull = async (cfg) => {
  const gist = await api(`/gists/${cfg.gistId}`, cfg.token);
  const files = gist.files || {};
  const v2 = await fileContent(files[FILE_V2]);
  if (v2) return { data: normalize(await decrypt(v2, cfg.pass)), hasV2: true };
  const legacy = await fileContent(files[FILE_LEGACY]);
  if (legacy) return { data: normalize(await decrypt(legacy, cfg.pass)), hasV2: false, migrated: true };
  return { data: emptyData(), hasV2: false };
};

export const push = async (cfg, data) => {
  const container = cfg.pass ? await encrypt(data, cfg.pass) : data;
  await api(`/gists/${cfg.gistId}`, cfg.token, {
    method: 'PATCH',
    body: JSON.stringify({ files: { [FILE_V2]: { content: JSON.stringify(container) } } }),
  });
};

export const createGist = async (token, data, pass) => {
  const container = pass ? await encrypt(data, pass) : data;
  const gist = await api('/gists', token, {
    method: 'POST',
    body: JSON.stringify({
      description: '',
      public: false,
      files: { [FILE_V2]: { content: JSON.stringify(container) } },
    }),
  });
  return gist.id;
};

export const findGist = async (token) => {
  for (let page = 1; page <= 5; page++) {
    const list = await api(`/gists?per_page=100&page=${page}`, token);
    const hit = list.find((g) => g.files && g.files[FILE_V2]) || list.find((g) => g.files && g.files[FILE_LEGACY]);
    if (hit) return hit.id;
    if (list.length < 100) break;
  }
  return '';
};

export const syncOnce = async (cfg, local) => {
  const remote = await pull(cfg);
  const merged = merge(local, remote.data);
  let pushed = false;
  if (cfg.token && (!remote.hasV2 || !sameData(merged, remote.data))) {
    await push(cfg, merged);
    pushed = true;
  }
  return { merged, pushed, migrated: !!remote.migrated };
};

export const makeSetupLink = (cfg) => {
  const payload = btoa(unescape(encodeURIComponent(JSON.stringify({ g: cfg.gistId, t: cfg.token, p: cfg.pass }))));
  return `${location.origin}${location.pathname}#setup=${encodeURIComponent(payload)}`;
};

export const consumeSetupLink = () => {
  const hash = location.hash || '';
  const m = hash.match(/^#(setup|sync)=(.+)$/);
  if (!m) return false;
  try {
    const obj = JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(m[2])))));
    saveConfig({
      gistId: obj.g ?? obj.gistId ?? '',
      token: obj.t ?? obj.token ?? '',
      pass: obj.p ?? obj.pass ?? '',
    });
    return true;
  } catch (e) {
    return false;
  } finally {
    history.replaceState(null, '', location.pathname);
  }
};
