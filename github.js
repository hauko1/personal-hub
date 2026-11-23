// GitHub REST API client. The token stays in this browser (localStorage) and is only sent to api.github.com.
import { base64ToBytes, encodePath, looksBinary, imageMime, textToBase64 } from './util.js';

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function createGitHub(token) {
  async function call(path, { method = 'GET', body, raw = false } = {}) {
    const res = await fetch(API + path, {
      method,
      headers: {
        Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).message || msg; } catch { /* ignore */ }
      if (res.status === 401) msg = 'Token je neplatný nebo vypršel. Vlož nový v Nastavení.';
      if (res.status === 403 && /rate limit/i.test(msg)) msg = 'GitHub dočasně omezil počet dotazů. Zkus to za chvíli.';
      if (res.status === 404) msg = 'Nenalezeno (nebo k tomu token nemá přístup).';
      throw new GitHubError(res.status, msg);
    }
    if (raw) return new Uint8Array(await res.arrayBuffer());
    return res.status === 204 ? null : res.json();
  }

  return {
    demo: false,
    user: () => call('/user'),

    async repos() {
      const all = [];
      for (let page = 1; page <= 10; page++) {
        const batch = await call(`/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`);
        all.push(...batch);
        if (batch.length < 100) break;
      }
      return all;
    },

    /** People with access to a repo I own (needs push access; token: Metadata – Read). */
    collaborators: (owner, repo) => call(`/repos/${owner}/${repo}/collaborators?affiliation=direct&per_page=100`),

    /** Invitations not accepted yet (token: Administration – Read; without it this fails and is skipped). */
    invitations: (owner, repo) => call(`/repos/${owner}/${repo}/invitations?per_page=100`),

    async list(owner, repo, path) {
      const data = await call(`/repos/${owner}/${repo}/contents/${encodePath(path)}`);
      return Array.isArray(data) ? data : null; // null = it's a file
    },

    /** Returns { sha, size, bytes, text|null, mime|null } */
    async file(owner, repo, path) {
      const meta = await call(`/repos/${owner}/${repo}/contents/${encodePath(path)}`);
      if (Array.isArray(meta)) throw new GitHubError(400, 'Tohle je složka.');
      const bytes = meta.encoding === 'base64' && meta.content
        ? base64ToBytes(meta.content)
        : await call(`/repos/${owner}/${repo}/contents/${encodePath(path)}`, { raw: true });
      const mime = imageMime(path);
      const text = mime || looksBinary(bytes) ? null : new TextDecoder('utf-8').decode(bytes);
      return { sha: meta.sha, size: meta.size, bytes, text, mime, htmlUrl: meta.html_url };
    },

    async save(owner, repo, path, text, sha, message) {
      return call(`/repos/${owner}/${repo}/contents/${encodePath(path)}`, {
        method: 'PUT',
        body: { message, content: textToBase64(text), sha },
      });
    },
  };
}
