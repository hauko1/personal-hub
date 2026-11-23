// Demo data so the app can be tried (and screenshotted) without a token. Everything here is made up.
import { imageMime } from './util.js';

const now = Date.now();
const ago = (h) => new Date(now - h * 3600e3).toISOString();

const FILES = {
  'demo/notes': {
    'README.md': '# Poznámky\n\nUkázkové repo. Hlavní přehled je v [STAV.md](STAV.md).\n',
    'STAV.md': `# STAV – co se právě řeší

> Ukázková data. Po vložení tokenu tu bude tvůj vlastní soubor.

## 1. Nový notebook
| Obchod | Cena | Stav |
|---|---|---|
| Obchod A | 18 990 Kč | čeká na odpověď |
| Obchod B | 17 450 Kč | **objednáno** |

**Další kroky**
- Zkontrolovat doručení.
- Odepsat na reklamaci starého notebooku.

## 2. Škola
- [x] Odevzdat projekt z IT
- [ ] Domluvit konzultaci z matiky
`,
    'ukoly/projekt.md': '# Projekt z IT\n\nSkript, který stáhne počasí a pošle ho do chatu.\n\n```python\nprint("ahoj")\n```\n',
    'skripty/zaloha.sh': '#!/bin/bash\n# Zálohuje složku Dokumenty\nrsync -a ~/Dokumenty /mnt/zaloha/\n',
  },
  'demo/website': {
    'README.md': '# Website\n\nUkázkový web.\n\n![logo](logo.svg)\n',
    'index.html': '<!doctype html>\n<title>Web</title>\n<h1>Ahoj</h1>\n',
    'logo.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" rx="8" fill="#4f7cff"/><text x="60" y="26" font-size="16" text-anchor="middle" fill="#fff" font-family="sans-serif">logo</text></svg>',
  },
};

const REPOS = [
  { name: 'notes', private: true, description: 'Poznámky a stav rozpracovaných věcí', pushed_at: ago(2), language: 'Markdown' },
  { name: 'website', private: false, description: 'Osobní web', pushed_at: ago(30), language: 'HTML' },
  { name: 'game-mod', private: false, description: 'Mod do hry', pushed_at: ago(24 * 9), language: 'Python' },
].map((r) => ({ ...r, owner: { login: 'demo' }, full_name: `demo/${r.name}`, html_url: '#', default_branch: 'main' }));

function entries(key, path) {
  const files = FILES[key] || {};
  const prefix = path ? path + '/' : '';
  const seen = new Map();
  for (const [p, content] of Object.entries(files)) {
    if (!p.startsWith(prefix)) continue;
    const rest = p.slice(prefix.length);
    const [head, ...tail] = rest.split('/');
    if (tail.length) seen.set(head, { name: head, path: prefix + head, type: 'dir' });
    else seen.set(head, { name: head, path: p, type: 'file', size: new TextEncoder().encode(content).length });
  }
  return [...seen.values()];
}

export function createDemo() {
  return {
    demo: true,
    user: async () => ({ login: 'demo', name: 'Ukázkový účet' }),
    repos: async () => REPOS,
    async list(owner, repo, path) {
      const key = `${owner}/${repo}`;
      if (FILES[key]?.[path] !== undefined) return null;
      const items = entries(key, path);
      if (!items.length && path) throw Object.assign(new Error('Nenalezeno.'), { status: 404 });
      return items;
    },
    async file(owner, repo, path) {
      const text = FILES[`${owner}/${repo}`]?.[path];
      if (text === undefined) throw Object.assign(new Error('Nenalezeno.'), { status: 404 });
      const bytes = new TextEncoder().encode(text);
      const mime = imageMime(path);
      return { sha: 'demo', size: bytes.length, bytes, text: mime ? null : text, mime, htmlUrl: '#' };
    },
    async save(owner, repo, path, text) {
      FILES[`${owner}/${repo}`][path] = text;
      return { content: { sha: 'demo' } };
    },
  };
}
