import { createGitHub } from './github.js';
import { createDemo } from './demo.js';
import {
  parseRoute, repoHref, resolveRepoPath, isMarkdown, timeAgo, formatSize, sortListing,
} from './util.js';
import { classifyRepos, parseNicknames, parseRepoList, displayName, pool } from './shared.js';

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

// ---------- spaces: Soukromé (personal) / Společné (shared) ----------
let spacesPromise = null;
function resetSpaces() { spacesPromise = null; }

/** Loads repos once and splits them; shared = someone else has access (or listed in Settings). */
function loadSpaces() {
  if (spacesPromise) return spacesPromise;
  spacesPromise = (async () => {
    const [me, repos] = await Promise.all([api.user(), api.repos()]);
    const nicknames = parseNicknames(store.get('nicknames'));
    const extra = parseRepoList(store.get('sharedRepos'));
    const owned = repos.filter((r) => r.owner.login.toLowerCase() === me.login.toLowerCase());
    const access = await pool(owned, 6, async (r) => {
      const [collabs, invites] = await Promise.all([
        api.collaborators(r.owner.login, r.name).catch(() => []),
        api.invitations(r.owner.login, r.name).catch(() => []),
      ]);
      return [...collabs, ...invites.filter((i) => i.invitee).map((i) => ({ ...i.invitee, pending: true }))];
    });
    const byRepo = new Map(owned.map((r, i) => [r.full_name.toLowerCase(), access[i]]));
    return { me: me.login, nicknames, ...classifyRepos(repos, me.login, byRepo, extra, nicknames) };
  })();
  spacesPromise.catch(() => { spacesPromise = null; });
  return spacesPromise;
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
const SUBNAV = {
  soukrome: [['home', '#/', 'Přehled'], ['repos', '#/repos', 'Repozitáře'], ['posta', '#/posta', 'Pošta', 'soon'], ['fotky', '#/fotky', 'Fotky', 'soon']],
  spolecne: [['spolecne', '#/spolecne', 'Lidé'], ['spolecne-repos', '#/spolecne/repos', 'Repozitáře']],
};
function markNav(space, page) {
  document.querySelectorAll('.spaces a').forEach((a) => {
    const on = a.dataset.space === space && page !== 'nastaveni';
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.querySelector('.settings-link')?.classList.toggle('active', page === 'nastaveni');
  const sub = document.getElementById('subnav');
  if (!sub) return;
  if (page === 'nastaveni') { sub.replaceChildren(); return; }
  sub.replaceChildren(...SUBNAV[space].map(([id, href, label, cls]) => {
    const a = el(`<a href="${href}" class="${cls || ''}">${esc(label)}</a>`);
    if (id === page) { a.classList.add('active'); a.setAttribute('aria-current', 'page'); }
    return a;
  }));
}
function avatar(p) {
  let src = '';
  try { if (p.avatar_url) { const u = new URL(p.avatar_url); u.searchParams.set('s', '80'); src = u.href; } } catch { /* bad url */ }
  return src
    ? `<img class="avatar" src="${esc(src)}" alt="" width="40" height="40">`
    : `<span class="avatar initials" aria-hidden="true">${esc(String(p.name || p.login).slice(0, 1).toUpperCase())}</span>`;
}

// ---------- pages ----------
async function pageHome() {
  loading();
  const main = mainRepo();
  const parts = [demoBanner()];

  const statusCard = el('<section class="card"><h2>Stav</h2><div class="slot"><p class="muted">Načítám…</p></div></section>');
  parts.push(statusCard);

  const reposCard = el('<section class="card"><h2>Naposledy upravené soukromé repozitáře</h2><div class="slot"><p class="muted">Načítám…</p></div></section>');
  const linksCard = el(`<section class="card"><h2>Propojení</h2>
    <ul class="links">
      <li><span class="dot ${api.demo ? 'off' : 'on'}"></span> GitHub ${api.demo ? '– nepřipojeno (ukázka)' : '– připojeno'}</li>
      <li><span class="dot soon"></span> Gmail – připravuje se</li>
      <li><span class="dot soon"></span> Fotky Google – připravuje se</li>
    </ul>
    <p class="shared-sum muted small"></p></section>`);
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

  loadSpaces().then((s) => {
    const list = el('<ul class="repo-list"></ul>');
    s.personal.slice(0, 6).forEach((r) => list.append(repoItem(r)));
    reposCard.querySelector('.slot').replaceChildren(
      s.personal.length ? list : el('<p class="muted">Žádné soukromé repozitáře.</p>'),
      el('<p><a href="#/repos">Všechny soukromé repozitáře →</a></p>'));
    linksCard.querySelector('.shared-sum').replaceChildren(el(
      `<a href="#/spolecne">Společné: ${s.shared.length} ${plural(s.shared.length, 'repozitář', 'repozitáře', 'repozitářů')}, ${s.people.length} ${plural(s.people.length, 'člověk', 'lidé', 'lidí')} →</a>`));
  }).catch((e) => reposCard.querySelector('.slot').replaceChildren(errorBox(e)));
}

function plural(n, one, few, many) { return n === 1 ? one : n >= 2 && n <= 4 ? few : many; }

function repoItem(r, { nicknames = new Map(), showPeople = true } = {}) {
  const who = showPeople && r.people?.length
    ? `<span class="with">s: ${r.people.map((l) => esc(displayName(l, nicknames))).join(', ')}</span>` : '';
  return el(`<li><a href="${repoHref(r.owner.login, r.name)}">
      <span class="name">${esc(r.name)}</span>
      <span class="tag ${r.private ? 'priv' : ''}">${r.private ? 'soukromé' : 'veřejné'}</span>
      ${who}
      <span class="desc">${esc(r.description || '')}</span>
      <span class="meta">${r.people ? esc(r.owner.login) + ' · ' : ''}${esc(r.language || '')}${r.language ? ' · ' : ''}${esc(timeAgo(r.pushed_at))}</span>
    </a></li>`);
}

async function pageRepos(space) {
  loading();
  try {
    const s = await loadSpaces();
    const shared = space === 'spolecne';
    const repos = shared ? s.shared : s.personal;
    const input = el('<input type="search" class="filter" placeholder="Hledat repozitář…" aria-label="Hledat repozitář">');
    const list = el('<ul class="repo-list"></ul>');
    const draw = () => {
      const q = input.value.toLowerCase();
      const hit = (r) => (r.full_name + ' ' + (r.description || '') + ' ' + (r.people || []).map((l) => displayName(l, s.nicknames)).join(' ')).toLowerCase().includes(q);
      list.replaceChildren(...repos.filter(hit).map((r) => repoItem(r, { nicknames: s.nicknames })));
    };
    input.addEventListener('input', draw);
    draw();
    const card = el(`<section class="card"><h2>${shared ? 'Společné' : 'Soukromé'} repozitáře <span class="muted">(${repos.length})</span></h2></section>`);
    if (!repos.length) {
      card.append(el(shared
        ? '<p class="muted">Zatím s nikým žádný repozitář nesdílíš. <a href="#/spolecne">Jak někoho přidat</a></p>'
        : '<p class="muted">Žádné soukromé repozitáře.</p>'));
    } else card.append(input, list);
    setView(demoBanner(), card);
  } catch (e) { setView(errorBox(e)); }
}

async function pageShared() {
  loading();
  try {
    const s = await loadSpaces();
    const parts = [demoBanner()];
    if (!s.people.length) {
      parts.push(el('<section class="card"><h2>Společné</h2><p>Zatím s nikým žádný repozitář nesdílíš.</p></section>'));
    } else {
      const grid = el('<div class="people"></div>');
      for (const p of s.people) {
        const card = el(`<section class="card person">
          <div class="person-head">${avatar(p)}
            <div><h2>${esc(p.name)}</h2>
              <p class="muted small">@${esc(p.login)}${p.pending ? ' · <span class="tag pend">pozvánka zatím nepřijatá</span>' : ''}</p></div>
          </div>
          <ul class="repo-list"></ul></section>`);
        const ul = card.querySelector('ul');
        p.repos.forEach((r) => ul.append(repoItem(r, { showPeople: false })));
        grid.append(card);
      }
      parts.push(grid);
    }
    parts.push(el(`<section class="card"><h2>Přidat dalšího člověka</h2>
      <ol class="steps">
        <li>Na GitHubu otevři repozitář → <em>Settings</em> → <em>Collaborators</em> → <em>Add people</em> a pozvi ho.</li>
        <li>Objeví se tady sám. Dokud pozvánku nepřijme, uvidíš ho jen s tokenem, který má navíc <em>Administration – Read</em>.</li>
        <li>Přezdívku mu dáš v <a href="#/nastaveni">Nastavení</a> (třeba <code>jeho-login = Přezdívka</code>). Tam můžeš i ručně přidat repozitář, který se má počítat mezi společné.</li>
      </ol></section>`));
    setView(...parts);
  } catch (e) { setView(errorBox(e)); }
}

let currentSpace = 'soukrome';
function crumbs(owner, repo, path, space = currentSpace) {
  const nav = el('<nav class="crumbs" aria-label="Cesta"></nav>');
  const back = space === 'spolecne' ? ['#/spolecne/repos', 'společné repozitáře'] : ['#/repos', 'repozitáře'];
  nav.append(el(`<a href="${back[0]}">${back[1]}</a>`), document.createTextNode(' / '), el(`<a href="${repoHref(owner, repo)}">${esc(repo)}</a>`));
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
      <h3>Společné</h3>
      <label>Přezdívky lidí
        <textarea name="nicknames" rows="3" spellcheck="false" placeholder="jeho-login = Přezdívka">${esc(store.get('nicknames'))}</textarea>
        <span class="muted small hint">Jeden na řádek: GitHub login = jak ho chceš vidět. Zůstane jen v tomhle prohlížeči.</span>
      </label>
      <label>Další společné repozitáře
        <textarea name="sharedRepos" rows="2" spellcheck="false" placeholder="vlastnik/nazev-repozitare">${esc(store.get('sharedRepos'))}</textarea>
        <span class="muted small hint">Jeden na řádek. Repozitáře, které sdílíš s ostatními, se poznají samy. Sem patří jen ty, které se mají počítat mezi společné navíc.</span>
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
    store.set('nicknames', form.nicknames.value.trim());
    store.set('sharedRepos', form.sharedRepos.value.trim());
    api = makeApi();
    resetSpaces();
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
    resetSpaces();
    pageSettings();
  });
  setView(card);
}

function pageSoon(what) {
  setView(el(`<section class="card"><h2>${esc(what)}</h2>
    <p>Připravuje se. Nejdřív je hotové propojení s GitHubem, další služby přibydou postupně.</p></section>`));
}

// ---------- router ----------
const PERSONAL_PAGES = ['home', 'repos', 'posta', 'fotky'];
async function spaceOfRepo(owner, repo) {
  try {
    const s = await loadSpaces();
    const full = `${owner}/${repo}`.toLowerCase();
    return s.shared.some((r) => r.full_name.toLowerCase() === full) ? 'spolecne' : 'soukrome';
  } catch { return currentSpace; }
}

async function route() {
  const r = parseRoute(location.hash);
  let page = r.page;
  let space = store.get('space', 'soukrome') === 'spolecne' ? 'spolecne' : 'soukrome';
  if (page === 'spolecne') { space = 'spolecne'; page = r.rest[0] === 'repos' ? 'spolecne-repos' : 'spolecne'; }
  else if (PERSONAL_PAGES.includes(page)) space = 'soukrome';
  else if (page === 'repo') { loading(); space = await spaceOfRepo(r.owner, r.repo); }
  currentSpace = space;
  if (page !== 'nastaveni') store.set('space', space);
  markNav(space, page === 'repo' ? (space === 'spolecne' ? 'spolecne-repos' : 'repos') : page);
  try {
    if (page === 'home') await pageHome();
    else if (page === 'repos') await pageRepos('soukrome');
    else if (page === 'spolecne') await pageShared();
    else if (page === 'spolecne-repos') await pageRepos('spolecne');
    else if (page === 'repo') await pageRepo(r);
    else if (page === 'nastaveni') pageSettings();
    else if (page === 'posta') pageSoon('Pošta');
    else if (page === 'fotky') pageSoon('Fotky');
    else setView(el('<section class="card"><p>Tahle stránka neexistuje. <a href="#/">Domů</a></p></section>'));
  } catch (e) { setView(errorBox(e)); }
}

window.addEventListener('hashchange', route);
route();
