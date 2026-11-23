import {
  base64ToBytes, textToBase64, looksBinary, extOf, imageMime, isMarkdown,
  resolveRepoPath, encodePath, parseRoute, repoHref, timeAgo, formatSize, sortListing,
} from '../util.js';
import { createDemo } from '../demo.js';

const out = document.getElementById('out');
let passed = 0; let failed = 0;
function report(ok, name, detail = '') {
  ok ? passed++ : failed++;
  const li = document.createElement('li');
  li.className = ok ? 'ok' : 'fail';
  li.textContent = `${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`;
  out.append(li);
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual); const e = JSON.stringify(expected);
  report(a === e, name, a === e ? '' : `got ${a}, expected ${e}`);
}

// base64 round trip with Czech characters and emoji
const sample = 'Žluťoučký kůň úpěl ďábelské ódy 😀\nřádek 2';
eq('base64 round trip keeps UTF-8', new TextDecoder().decode(base64ToBytes(textToBase64(sample))), sample);
eq('base64 ignores newlines from the API', new TextDecoder().decode(base64ToBytes('YWhv\nag==')), 'ahoj');
const big = 'x'.repeat(100000) + 'é';
eq('base64 handles long text', new TextDecoder().decode(base64ToBytes(textToBase64(big))).length, big.length);

eq('text is not binary', looksBinary(new TextEncoder().encode('hello')), false);
eq('NUL byte means binary', looksBinary(new Uint8Array([72, 0, 73])), true);

eq('extension', extOf('docs/Banner.SVG'), 'svg');
eq('no extension', extOf('Makefile'), '');
eq('dotfile has no extension', extOf('.gitignore'), '');
eq('image mime png', imageMime('a/b.png'), 'image/png');
eq('not an image', imageMime('a/b.md'), null);
eq('markdown detection', [isMarkdown('README.md'), isMarkdown('x.txt')], [true, false]);

eq('relative link in same folder', resolveRepoPath('docs/a.md', 'b.md'), 'docs/b.md');
eq('relative link up a folder', resolveRepoPath('notes/x.md', '../STAV.md'), 'STAV.md');
eq('./ prefix', resolveRepoPath('README.md', './docs/img.png'), 'docs/img.png');
eq('root-absolute link', resolveRepoPath('a/b/c.md', '/top.md'), 'top.md');
eq('anchor and query are stripped', resolveRepoPath('a.md', 'b.md?x=1#part'), 'b.md');
eq('encoded spaces are decoded', resolveRepoPath('a.md', 'my%20file.md'), 'my file.md');
eq('external links left alone', [resolveRepoPath('a.md', 'https://x.cz'), resolveRepoPath('a.md', 'mailto:a@b.c'), resolveRepoPath('a.md', '#top')], [null, null, null]);

eq('encodePath', encodePath('složka/a b.md'), 'slo%C5%BEka/a%20b.md');
eq('route home', parseRoute(''), { page: 'home', rest: [] });
eq('route repo root', parseRoute('#/r/hauko1/app'), { page: 'repo', owner: 'hauko1', repo: 'app', path: '' });
eq('route repo path with unicode', parseRoute(repoHref('o', 'r', 'zdraví/maily.md')), { page: 'repo', owner: 'o', repo: 'r', path: 'zdraví/maily.md' });
eq('route settings', parseRoute('#/nastaveni').page, 'nastaveni');

const now = Date.parse('2026-11-23T12:00:00Z');
eq('timeAgo minutes', timeAgo('2026-11-23T11:55:00Z', now), 'před 5 min');
eq('timeAgo hours', timeAgo('2026-11-23T09:00:00Z', now), 'před 3 h');
eq('timeAgo yesterday', timeAgo('2026-11-22T10:00:00Z', now), 'včera');
eq('timeAgo invalid', timeAgo('nonsense', now), '');
eq('formatSize', [formatSize(512), formatSize(2048), formatSize(3 * 1048576)], ['512 B', '2.0 kB', '3.0 MB']);

eq('folders first, then files, alphabetically',
  sortListing([{ name: 'b.md', type: 'file' }, { name: 'z', type: 'dir' }, { name: 'a.md', type: 'file' }, { name: 'c', type: 'dir' }]).map((i) => i.name),
  ['c', 'z', 'a.md', 'b.md']);

// demo provider behaves like the GitHub client
const demo = createDemo();
const repos = await demo.repos();
eq('demo has repos', repos.length > 0, true);
const root = await demo.list('demo', 'notes', '');
eq('demo root lists folders and files', root.map((i) => `${i.type}:${i.name}`).sort(), ['dir:skripty', 'dir:ukoly', 'file:README.md', 'file:STAV.md']);
eq('demo file path returns null from list', await demo.list('demo', 'notes', 'STAV.md'), null);
const stav = await demo.file('demo', 'notes', 'STAV.md');
eq('demo file has text', stav.text.startsWith('# STAV'), true);
const logo = await demo.file('demo', 'website', 'logo.svg');
eq('svg is treated as image', [logo.mime, logo.text], ['image/svg+xml', null]);
await demo.save('demo', 'notes', 'STAV.md', 'changed', 'demo', 'msg');
eq('demo save changes the file', (await demo.file('demo', 'notes', 'STAV.md')).text, 'changed');
let missing = false;
try { await demo.file('demo', 'notes', 'nope.md'); } catch (e) { missing = e.status === 404; }
eq('missing file gives 404', missing, true);

document.getElementById('summary').textContent = `${passed} passed, ${failed} failed`;
document.getElementById('summary').className = failed ? 'fail' : 'ok';
document.title = failed ? `FAIL ${failed}` : `OK ${passed}`;
