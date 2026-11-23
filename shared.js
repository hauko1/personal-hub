// Splitting repos into the "Soukromé" (personal) and "Společné" (shared) spaces.
// Pure logic (no DOM, no network) – covered by tests/index.html.

/** Non-empty lines of a settings textarea, without comments (# …). */
export function parseLines(text) {
  return String(text || '')
    .split('\n')
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter(Boolean);
}

/** "login = Přezdívka" lines → Map(lowercased login → nickname). */
export function parseNicknames(text) {
  const map = new Map();
  for (const line of parseLines(text)) {
    const i = line.indexOf('=');
    if (i < 1) continue;
    const login = line.slice(0, i).trim().replace(/^@/, '').toLowerCase();
    const nick = line.slice(i + 1).trim();
    if (login && nick) map.set(login, nick);
  }
  return map;
}

/** "owner/name" lines → Set of lowercased full names (anything else is ignored). */
export function parseRepoList(text) {
  const set = new Set();
  for (const line of parseLines(text)) {
    const m = line.replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/, '').match(/^([\w.-]+)\/([\w.-]+)$/);
    if (m) set.add(`${m[1]}/${m[2]}`.toLowerCase());
  }
  return set;
}

/**
 * Split repos into personal and shared ones and group the shared ones by person.
 *
 * A repo is shared when someone else owns it, when it has collaborators (or pending
 * invitations) other than me, or when it is listed in `extraShared`.
 *
 * @param repos          repos from the API (each with owner.login, full_name, …)
 * @param me             my login
 * @param collaborators  Map(lowercased full_name → [{ login, avatar_url, pending }])
 * @param extraShared    Set of lowercased full names to treat as shared
 * @param nicknames      Map(lowercased login → nickname)
 * @returns { personal, shared, people } – people sorted by display name, each
 *          { login, name, avatar_url, pending, repos }
 */
export function classifyRepos(repos, me, collaborators = new Map(), extraShared = new Set(), nicknames = new Map()) {
  const meLc = String(me || '').toLowerCase();
  const personal = [];
  const shared = [];
  const people = new Map();

  const addPerson = (u, repo, pending = false) => {
    const key = String(u.login).toLowerCase();
    if (!key || key === meLc) return;
    let p = people.get(key);
    if (!p) {
      p = { login: u.login, name: nicknames.get(key) || u.login, avatar_url: u.avatar_url || '', pending: true, repos: [] };
      people.set(key, p);
    }
    if (!pending) p.pending = false;
    if (!p.avatar_url && u.avatar_url) p.avatar_url = u.avatar_url;
    if (!p.repos.includes(repo)) p.repos.push(repo);
  };

  for (const r of repos) {
    const full = String(r.full_name || `${r.owner.login}/${r.name}`).toLowerCase();
    const others = (collaborators.get(full) || []).filter((c) => String(c.login).toLowerCase() !== meLc);
    const ownedByOther = String(r.owner.login).toLowerCase() !== meLc;
    const isShared = ownedByOther || others.length > 0 || extraShared.has(full);
    if (!isShared) { personal.push(r); continue; }
    const withPeople = { ...r, people: [] };
    if (ownedByOther) { addPerson(r.owner, withPeople); withPeople.people.push(r.owner.login); }
    for (const c of others) {
      addPerson(c, withPeople, !!c.pending);
      if (!withPeople.people.includes(c.login)) withPeople.people.push(c.login);
    }
    shared.push(withPeople);
  }

  const list = [...people.values()].sort((a, b) => a.name.localeCompare(b.name, 'cs'));
  return { personal, shared, people: list };
}

/** Display name for a login, using nicknames when set. */
export function displayName(login, nicknames = new Map()) {
  return nicknames.get(String(login).toLowerCase()) || login;
}

/** Run async `fn` over `items` with at most `limit` running at once; keeps order. */
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
