import { createGitHub } from './github.js';
import { createDemo } from './demo.js';
import {
  parseRoute, repoHref, resolveRepoPath, isMarkdown, timeAgo, formatSize, sortListing,
} from './util.js';

// ---------- settings (localStorage, may be unavailable) ----------
const store = {
  get(k, d = '') { try { return localStorage.getItem('hub.' + k) ?? d; } catch { return d; } },
  set(k, v) { try { v ? localStorage.setItem('hub.' + k, v) : localStorage.removeItem('hub.' + k); } catch { /* private mode */ } },
};

let api = makeApi();
function makeApi() {
  const t = store.get('token');
  return t ? createGitHub(t) : createDemo();
}

const view = document.getElementById('view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const objectUrls = [];
function blobUrl(bytes, mime) {
  const u = URL.createObjectURL(new Blob([bytes], { type: mime }));
  objectUrls.push(u);
  return u;
}

function mainRepo() {
  const v = api.demo ? 'demo/notes' : store.get('mainRepo');
  const [owner, repo] = v.split('/');
  return owner && repo ? { owner, repo, file: store.get('statusFile', 'STAV.md') } : null;
}

// ---------- markdown ----------
function renderMarkdown(md, ctx) {
  const html = window.DOMPurify.sanitize(window.marked.parse(md, { gfm: true }));
  const box = document.createElement('div');
  box.className = 'md';
  box.innerHTML = html;
  if (ctx) {
    box.querySelectorAll('a[href]').forEach((a) => {
      const p = resolveRepoPath(ctx.path, a.getAttribute('href'));
      if (p !== null) a.setAttribute('href', repoHref(ctx.owner, ctx.repo, p));
      else if (/^https?:/i.test(a.getAttribute('href'))) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    });
    box.querySelectorAll('img[src]').forEach(async (img) => {
      const p = resolveRepoPath(ctx.path, img.getAttribute('src'));
      if (p === null) return;
      img.removeAttribute('src');
      try {
        const f = await api.file(ctx.owner, ctx.repo, p);
        if (f.mime) img.src = blobUrl(f.bytes, f.mime);
      } catch { img.alt = `(obrázek ${p} se nenačetl)`; }
    });
  }
  return box;
}

// ---------- small UI helpers ----------
function setView(...nodes) {
  objectUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
  view.replaceChildren(...nodes);
  window.scrollTo(0, 0);
}
function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function loading() { setView(el('<p class="muted loading">Načítám…</p>')); }
function errorBox(e) {
  return el(`<div class="card error"><strong>Něco se nepovedlo.</strong><p>${esc(e.message || e)}</p>
    ${e.status === 401 ? '<p><a href="#/nastaveni">Otevřít Nastavení</a></p>' : ''}</div>`);
}
function demoBanner() {
  return api.demo
    ? el('<div class="banner">Ukázkový režim s vymyšlenými daty. Svoje repozitáře uvidíš po vložení tokenu v <a href="#/nastaveni">Nastavení</a>.</div>')
    : document.createTextNode('');
}
function markNav(page) {
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('active', a.dataset.page === page));
}

// ---------- pages ----------
async function pageHome() {
  loading();
  const main = mainRepo();
  const parts = [demoBanner()];

  const statusCard = el('<section class="card"><h2>Stav</h2><div class="slot"><p class="muted">Načítám…</p></div></section>');
  parts.push(statusCard);

  const reposCard = el('<section class="card"><h2>Naposledy upravené repozitáře</h2><div class="slot"><p class="muted">Načítám…</p></div></section>');
  const linksCard = el(`<section class="card"><h2>Propojení</h2>
    <ul class="links">
      <li><span class="dot ${api.demo ? 'off' : 'on'}"></span> GitHub ${api.demo ? '– nepřipojeno (ukázka)' : '– připojeno'}</li>
      <li><span class="dot soon"></span> Gmail – připravuje se</li>
      <li><span class="dot soon"></span> Fotky Google – připravuje se</li>
    </ul></section>`);
  const grid = el('<div class="grid2"></div>');
  grid.append(reposCard, linksCard);
  parts.push(grid);
  setView(...parts);

  if (!main) {
    statusCard.querySelector('.slot').replaceChildren(el('<p class="muted">V <a href="#/nastaveni">Nastavení</a> si vyber hlavní repozitář a soubor se stavem (třeba STAV.md).</p>'));
  } else {
    api.file(main.owner, main.repo, main.file).then((f) => {
      const slot = statusCard.querySelector('.slot');
      slot.replaceChildren(renderMarkdown(f.text || '', { ...main, path: main.file }));
      statusCard.querySelector('h2').append(el(`<a class="small" href="${repoHref(main.owner, main.repo, main.file)}">upravit</a>`));
    }).catch((e) => statusCard.querySelector('.slot').replaceChildren(errorBox(e)));
  }

  api.repos().then((repos) => {
    const list = el('<ul class="repo-list"></ul>');
    repos.slice(0, 6).forEach((r) => list.append(repoItem(r)));
    reposCard.querySelector('.slot').replaceChildren(list, el('<p><a href="#/repos">Všechny repozitáře →</a></p>'));
  }).catch((e) => reposCard.querySelector('.slot').replaceChildren(errorBox(e)));
}

function repoItem(r) {
  return el(`<li><a href="${repoHref(r.owner.login, r.name)}">
      <span class="name">${esc(r.name)}</span>
      <span class="tag ${r.private ? 'priv' : ''}">${r.private ? 'soukromé' : 'veřejné'}</span>
      <span class="desc">${esc(r.description || '')}</span>
      <span class="meta">${esc(r.language || '')} · ${esc(timeAgo(r.pushed_at))}</span>
    </a></li>`);
}

async function pageRepos() {
  loading();
  try {
    const repos = await api.repos();
    const input = el('<input type="search" class="filter" placeholder="Hledat repozitář…" aria-label="Hledat repozitář">');
    const list = el('<ul class="repo-list"></ul>');
    const draw = () => {
      const q = input.value.toLowerCase();
      list.replaceChildren(...repos.filter((r) => (r.name + ' ' + (r.description || '')).toLowerCase().includes(q)).map(repoItem));
    };
    input.addEventListener('input', draw);
    draw();
    const card = el(`<section class="card"><h2>Repozitáře <span class="muted">(${repos.length})</span></h2></section>`);
    card.append(input, list);
    setView(demoBanner(), card);
  } catch (e) { setView(errorBox(e)); }
}

function crumbs(owner, repo, path) {
  const nav = el('<nav class="crumbs" aria-label="Cesta"></nav>');
  nav.append(el(`<a href="#/repos">repozitáře</a>`), document.createTextNode(' / '), el(`<a href="${repoHref(owner, repo)}">${esc(repo)}</a>`));
  let acc = '';
  path.split('/').filter(Boolean).forEach((seg) => {
    acc += (acc ? '/' : '') + seg;
    nav.append(document.createTextNode(' / '), el(`<a href="${repoHref(owner, repo, acc)}">${esc(seg)}</a>`));
  });
  return nav;
}

async function pageRepo({ owner, repo, path }) {
  loading();
  try {
    const items = await api.list(owner, repo, path);
    if (items === null) return pageFile(owner, repo, path);
    const card = el('<section class="card"></section>');
    const list = el('<ul class="files"></ul>');
    sortListing(items).forEach((it) => list.append(el(`<li><a href="${repoHref(owner, repo, it.path)}">
      <span class="ico">${it.type === 'dir' ? '📁' : '📄'}</span><span>${esc(it.name)}</span>
      <span class="meta">${it.type === 'file' && it.size != null ? formatSize(it.size) : ''}</span></a></li>`)));
    card.append(list);
    const nodes = [demoBanner(), crumbs(owner, repo, path), card];
    const readme = items.find((i) => i.type === 'file' && /^readme\.(md|markdown)$/i.test(i.name));
    setView(...nodes);
    if (readme) {
      const f = await api.file(owner, repo, readme.path);
      const rc = el(`<section class="card"><h2>${esc(readme.name)}</h2></section>`);
      rc.append(renderMarkdown(f.text || '', { owner, repo, path: readme.path }));
      view.append(rc);
    }
  } catch (e) { setView(crumbs(owner, repo, path), errorBox(e)); }
}

async function pageFile(owner, repo, path) {
  const f = await api.file(owner, repo, path);
  const card = el(`<section class="card"><div class="file-head"><h2>${esc(path.split('/').pop())}</h2>
     <span class="meta">${formatSize(f.size)}</span></div></section>`);
  if (f.mime) {
    card.append(el(`<img class="preview" alt="${esc(path)}" src="${blobUrl(f.bytes, f.mime)}">`));
  } else if (f.text === null) {
    card.append(el('<p class="muted">Binární soubor, náhled není k dispozici.</p>'));
  } else {
    const body = isMarkdown(path)
      ? renderMarkdown(f.text, { owner, repo, path })
      : (() => { const pre = el('<pre class="code"></pre>'); pre.textContent = f.text; return pre; })();
    const edit = el('<button type="button" class="btn">Upravit</button>');
    edit.addEventListener('click', () => editor(owner, repo, path, f, card, body, edit));
    card.querySelector('.file-head').append(edit);
    card.append(body);
  }
  setView(demoBanner(), crumbs(owner, repo, path), card);
}

function editor(owner, repo, path, f, card, body, editBtn) {
  const form = el(`<form class="editor">
      <textarea spellcheck="false" aria-label="Obsah souboru"></textarea>
      <div class="row">
        <input name="msg" aria-label="Popis změny" placeholder="Popis změny (nepovinné)">
        <button type="button" class="btn ghost" data-act="cancel">Zrušit</button>
        <button type="submit" class="btn primary">Uložit</button>
      </div>
      <p class="muted small status"></p>
    </form>`);
  const ta = form.querySelector('textarea');
  ta.value = f.text;
  ta.rows = Math.min(30, Math.max(8, f.text.split('\n').length + 2));
  body.replaceWith(form);
  editBtn.hidden = true;
  form.querySelector('[data-act=cancel]').addEventListener('click', () => { form.replaceWith(body); editBtn.hidden = false; });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const status = form.querySelector('.status');
    status.textContent = 'Ukládám…';
    try {
      const msg = form.msg.value.trim() || `Úprava ${path.split('/').pop()}`;
      await api.save(owner, repo, path, ta.value, f.sha, msg);
      status.textContent = 'Uloženo.';
      route();
    } catch (e) {
      status.textContent = e.status === 409 || e.status === 422
        ? 'Soubor se mezitím změnil jinde. Obnov stránku a uprav ho znovu.'
        : (e.status === 403 || e.status === 404 ? 'Token nemá právo zapisovat (potřebuje Contents: Read and write).' : e.message);
    }
  });
}

function pageSettings() {
  const hasToken = !!store.get('token');
  const card = el(`<section class="card"><h2>Nastavení</h2>
    <form class="settings">
      <label>GitHub token
        <input name="token" type="password" autocomplete="off" placeholder="${hasToken ? 'uložený – vlož nový pro změnu' : 'github_pat_…'}">
      </label>
      <p class="muted small">Token zůstane jen v tomhle prohlížeči a posílá se jen na api.github.com.
        Jak ho vytvořit: <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com → Fine-grained token</a>,
        Repository access: <em>All repositories</em>, Permissions: <em>Contents – Read and write</em>.</p>
      <label>Hlavní repozitář (vlastník/název)
        <input name="mainRepo" placeholder="např. tvuj-nick/poznamky" value="${esc(store.get('mainRepo'))}">
      </label>
      <label>Soubor se stavem
        <input name="statusFile" value="${esc(store.get('statusFile', 'STAV.md'))}">
      </label>
      <div class="row">
        <button class="btn primary" type="submit">Uložit a ověřit</button>
        ${hasToken ? '<button class="btn ghost" type="button" data-act="logout">Odpojit GitHub</button>' : ''}
      </div>
      <p class="status small"></p>
    </form></section>`);
  const form = card.querySelector('form');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const status = form.querySelector('.status');
    const tok = form.token.value.trim();
    if (tok) store.set('token', tok);
    store.set('mainRepo', form.mainRepo.value.trim());
    store.set('statusFile', form.statusFile.value.trim() || 'STAV.md');
    api = makeApi();
    form.token.value = '';
    status.textContent = 'Ověřuji…';
    try {
      const u = await api.user();
      status.textContent = api.demo ? 'Uloženo (bez tokenu běží ukázkový režim).' : `Připojeno jako ${u.login}.`;
    } catch (e) { status.textContent = e.message; }
  });
  form.querySelector('[data-act=logout]')?.addEventListener('click', () => {
    store.set('token', '');
    api = makeApi();
    pageSettings();
  });
  setView(card);
}

function pageSoon(what) {
  setView(el(`<section class="card"><h2>${esc(what)}</h2>
    <p>Připravuje se. Nejdřív je hotové propojení s GitHubem, další služby přibydou postupně.</p></section>`));
}

// ---------- router ----------
async function route() {
  const r = parseRoute(location.hash);
  markNav(r.page === 'repo' ? 'repos' : r.page);
  try {
    if (r.page === 'home') await pageHome();
    else if (r.page === 'repos') await pageRepos();
    else if (r.page === 'repo') await pageRepo(r);
    else if (r.page === 'nastaveni') pageSettings();
    else if (r.page === 'posta') pageSoon('Pošta');
    else if (r.page === 'fotky') pageSoon('Fotky');
    else setView(el('<section class="card"><p>Tahle stránka neexistuje. <a href="#/">Domů</a></p></section>'));
  } catch (e) { setView(errorBox(e)); }
}

window.addEventListener('hashchange', route);
route();
