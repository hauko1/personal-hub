// Pure helpers (no DOM, no network) – covered by tests/index.html

/** Decode GitHub base64 content into bytes. */
export function base64ToBytes(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Encode a UTF-8 string as base64 (for saving files through the API). */
export function textToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** Heuristic: binary if it contains a NUL byte in the first 8 kB. */
export function looksBinary(bytes) {
  const n = Math.min(bytes.length, 8000);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

const IMAGE_TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon', avif: 'image/avif',
};

export function extOf(path) {
  const name = String(path).split('/').pop();
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

export function imageMime(path) {
  return IMAGE_TYPES[extOf(path)] || null;
}

export function isMarkdown(path) {
  return ['md', 'markdown', 'mdown'].includes(extOf(path));
}

/**
 * Resolve a link found inside a file at `fromPath` (e.g. "docs/a.md") against that file's folder.
 * Returns null for absolute URLs, anchors and mailto/tel links (those are left alone).
 */
export function resolveRepoPath(fromPath, href) {
  if (!href || /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) return null;
  const clean = href.split('#')[0].split('?')[0];
  if (!clean) return null;
  const base = clean.startsWith('/') ? [] : String(fromPath).split('/').slice(0, -1);
  for (const part of clean.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') base.pop();
    else base.push(decodeURIComponent(part));
  }
  return base.join('/');
}

/** Encode each path segment for use in an API URL. */
export function encodePath(path) {
  return String(path).split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

/** Parse the app's hash route: "#/r/owner/repo/some/path" etc. */
export function parseRoute(hash) {
  const parts = String(hash || '').replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [page = 'home', ...rest] = parts;
  if (page === 'r' && rest.length >= 2) {
    return { page: 'repo', owner: rest[0], repo: rest[1], path: rest.slice(2).join('/') };
  }
  return { page, rest };
}

export function repoHref(owner, repo, path = '') {
  const segs = ['r', owner, repo, ...String(path).split('/').filter(Boolean)];
  return '#/' + segs.map(encodeURIComponent).join('/');
}

/** "před 3 h", "včera", "12. 11. 2026" – short Czech relative time. */
export function timeAgo(iso, now = Date.now()) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.round((now - t) / 1000);
  if (s < 60) return 'právě teď';
  if (s < 3600) return `před ${Math.floor(s / 60)} min`;
  if (s < 86400) return `před ${Math.floor(s / 3600)} h`;
  if (s < 172800) return 'včera';
  if (s < 30 * 86400) return `před ${Math.floor(s / 86400)} dny`;
  const d = new Date(t);
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Sort a directory listing: folders first, then files, both alphabetically. */
export function sortListing(items) {
  return [...items].sort((a, b) =>
    (a.type === 'dir' ? 0 : 1) - (b.type === 'dir' ? 0 : 1) || a.name.localeCompare(b.name, 'cs'));
}
