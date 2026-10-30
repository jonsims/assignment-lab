// The Assignment Lab: the web server for a workshop on assignments and AI.
//
// Phones answer a short form at /match. The host screen at /groups sorts everyone into small groups
// and seats each group at a table. Each table then sends one assignment, its parts, and who does each
// part at /idea, and /toolkit shows every table's list on the projector.
//
// Plain Node 18 or newer, no packages. The QR codes come from a vendored copy of node-qrcode.
// Run `node start.js`, which starts this server and a free Cloudflare link for phones.
// Room size, kinds of assignment, and the wording people see come from settings.json.

'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('./vendor/qrcode/core/qrcode');
const QRSvg = require('./vendor/qrcode/renderer/svg-tag');

const PUBLIC = path.join(__dirname, 'public');
const LEVELS_MATCH = 3; // 0 not at all, 1 would like to use AI, 2 using AI now
const MAX_MATCH = 1000;
const MAX_IDEAS = 500;

const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, n);
const int = (v, lo, hi, dflt) => (Number.isInteger(v) && v >= lo && v <= hi ? v : dflt);

// Reads settings.json and fills in anything left out, so a typo in one field never stops the lab.
// A file that is not valid JSON stops the start with a message that says where the mistake is.
function loadSettings(file) {
  let s;
  try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    throw new Error(`settings.json has a mistake in it, so the lab did not start.\n${e.message}`);
  }
  const room = s.room || {};
  const dep = s.department || {};
  const ids = new Set();
  const assign = (Array.isArray(s.assignments) ? s.assignments : []).slice(0, 16).map((a, i) => {
    const name = clean(a && a.name, 60);
    let id = clean(a && a.id, 20).toLowerCase().replace(/[^a-z0-9]+/g, '') || name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'kind' + (i + 1);
    while (ids.has(id)) id += 'x';
    ids.add(id);
    return { id, name, hint: clean(a && a.hint, 90), icon: clean(a && a.icon, 20) };
  }).filter((a) => a.name);
  if (assign.length < 2) throw new Error('settings.json needs at least two kinds of assignment under "assignments".');
  const levels = (Array.isArray(s.toolkitChoices) ? s.toolkitChoices : []).map((x) => clean(x, 40)).filter(Boolean);
  const hostName = clean(s.hostName, 40);
  return {
    title: clean(s.title, 60) || 'The Assignment Lab',
    host: hostName || 'The host',
    hostMid: hostName || 'the host',
    port: int(s.port, 1024, 65535, 3063),
    room: {
      tables: int(room.tables, 1, 40, 12),
      seats: int(room.seatsPerTable, 2, 20, 8),
      perRow: int(room.tablesPerRow, 1, 8, 3),
      stagger: !!room.staggerRows,
    },
    groupSize: s.groupSize === 4 ? 4 : 3,
    divs: dep.ask ? (Array.isArray(dep.choices) ? dep.choices : []).map((d) => clean(d, 60)).filter(Boolean).slice(0, 40) : [],
    divLabel: clean(dep.label, 60) || 'Your department',
    divHint: clean(dep.hint, 160),
    levels: levels.length === 3 ? levels : ['Only the student', 'Student + AI', 'Agentic AI with Supervision'],
    assign,
  };
}

function createLab({ settingsFile = path.join(__dirname, 'settings.json'), dataFile, quiet = false, demo = false } = {}) {
  const S = loadSettings(settingsFile);
  const ASSIGN_IDS = new Set(S.assign.map((a) => a.id));
  const log = (...a) => { if (!quiet) console.log('[lab]', ...a); };
  let BASE_URL = `http://localhost:${S.port}`;

  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  let state = { match: [], groups: null, ideas: [] };
  try {
    state = { ...state, ...JSON.parse(fs.readFileSync(dataFile, 'utf8')) };
    log(`the data file holds ${state.match.length} answers and ${state.ideas.length} toolkit lists`);
  } catch (e) { /* first run */ }

  // Saves within 300 ms of a change, so a burst of answers never keeps putting the write off.
  let saveTimer = null;
  function save() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        const tmp = dataFile + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(state));
        fs.renameSync(tmp, dataFile);
      } catch (e) { console.error('[lab] save failed:', e.message); }
    }, 300);
  }

  function send(res, code, body, type = 'application/json', extra = {}) {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...extra });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
  }

  function readJson(req, limit) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > limit) { reject(new Error('too big')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); }
      });
      req.on('error', reject);
    });
  }

  // The host is whoever sits at the computer that runs the lab. A phone reaches the lab through the
  // Cloudflare link or the Wi-Fi, so its requests either come from another address or carry the
  // headers Cloudflare adds. The Host check also stops a web page from reaching the lab under another name.
  const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
  const FORWARDED = ['cf-connecting-ip', 'cf-ray', 'cf-visitor', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded'];
  function isHost(req) {
    if (!LOOPBACK.has(req.socket.remoteAddress)) return false;
    if (FORWARDED.some((h) => req.headers[h] !== undefined)) return false;
    const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  }
  // A change from the host screen also carries a header that another website cannot add without asking
  // first, so a page open in another tab can't press the host's buttons.
  function hostWrite(req) {
    if (!isHost(req) || req.headers['x-lab-host'] !== '1') return false;
    const o = req.headers.origin;
    return !o || /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(o);
  }
  const notHost = (res) => send(res, 403, { error: 'Only the computer that runs the lab can do this.' });

  // A few sends a minute per phone is plenty. This stops a stuck button from flooding the screen.
  const buckets = new Map();
  function allowed(key, max, windowMs) {
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || now > b.reset) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b); }
    b.n += 1;
    return b.n <= max;
  }
  const sweep = setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k); }, 60000);
  sweep.unref();
  // The phone's network address. Cloudflare's own header counts only when the request came through the
  // tunnel on this computer, because a phone on the Wi-Fi could send that header itself.
  const ipOf = (req) => (LOOPBACK.has(req.socket.remoteAddress) && req.headers['cf-connecting-ip']) || req.socket.remoteAddress;
  const who = (req, device) => `${device}:${ipOf(req)}`;
  // A phone can make up a new id for every send, so each network address also gets a limit on new
  // answers. A whole room can share one campus address, so the limit sits well above a room's size.
  const tooMany = (res) => send(res, 429, { error: 'Too many answers came from this network in the last few minutes. Wait a minute and try again.' });

  // QR codes are drawn from the current link on each request, so a new Cloudflare link needs no restart.
  const qrCache = new Map();
  function qrSvg(target) {
    const text = `${BASE_URL}/${target}`;
    if (!qrCache.has(text)) {
      const q = QRCode.create(text, { errorCorrectionLevel: 'M' });
      qrCache.set(text, QRSvg.render(q, { margin: 2, color: { dark: '#1a1f1cff', light: '#ffffffff' } }));
    }
    return qrCache.get(text);
  }

  const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
  const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // Pages get the title and the host's name filled in.
  function servePage(res, file) {
    fs.readFile(path.join(PUBLIC, file), 'utf8', (err, html) => {
      if (err) return send(res, 404, 'Not found', 'text/plain');
      send(res, 200, html.replaceAll('{{TITLE}}', escHtml(S.title)).replaceAll('{{HOST}}', escHtml(S.host)).replaceAll('{{host}}', escHtml(S.hostMid)), 'text/html; charset=utf-8');
    });
  }

  function serveStatic(res, p) {
    let rel;
    try { rel = decodeURIComponent(p); } catch (e) { return send(res, 404, 'Not found', 'text/plain'); }
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC + path.sep)) return send(res, 404, 'Not found', 'text/plain');
    const type = TYPES[path.extname(file).toLowerCase()];
    if (!type || type.startsWith('text/html')) return send(res, 404, 'Not found', 'text/plain');
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, 'Not found', 'text/plain');
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
      res.end(buf);
    });
  }

  // The group a phone sits in, if the host has made groups and this phone answered the match form.
  function groupOf(device) {
    if (!device || !state.groups) return null;
    const mine = state.match.find((m) => m.device === device);
    if (!mine) return null;
    const g = state.groups.list.find((x) => x.members.includes(mine.id));
    return g ? { n: g.n, kind: g.topic, table: g.table || 0 } : null;
  }

  // One answer per phone: a second send from the same phone replaces the first and keeps its id,
  // so a person who changes their answers keeps their place in a group.
  function cleanAnswer(b) {
    const rows = {};
    if (b.rows && typeof b.rows === 'object') {
      for (const [id, r] of Object.entries(b.rows)) {
        if (!ASSIGN_IDS.has(id) || !r || typeof r !== 'object') continue;
        const lvl = int(r.lvl, 0, LEVELS_MATCH - 1, 0);
        rows[id] = { lvl, help: lvl === 2 && !!r.help };
      }
    }
    const star = typeof b.star === 'string' && Object.prototype.hasOwnProperty.call(rows, b.star) ? b.star : '';
    return { name: clean(b.name, 40), div: S.divs.includes(b.div) ? b.div : '', rows, star };
  }

  function groupsWithNames() {
    if (!state.groups) return null;
    const by = new Map(state.match.map((m) => [m.id, m]));
    return { at: state.groups.at, list: state.groups.list.map((g) => ({ n: g.n, topic: g.topic, table: g.table || 0,
      members: g.members.filter((id) => by.has(id)).map((id) => ({ id, name: by.get(id).name, div: by.get(id).div, row: by.get(id).rows[g.topic] || null })) })) };
  }

  // CSV for the host's downloads. A cell that starts with = + - or @ gets a ' in front, so a spreadsheet
  // shows it as text instead of running it as a formula.
  function csv(rows) {
    const cell = (v) => {
      let s = String(v == null ? '' : v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
  }
  const kindName = (id) => (S.assign.find((a) => a.id === id) || {}).name || '';
  const when = (t) => new Date(t).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

  const PAGES = { '/match': 'match.html', '/groups': 'groups.html', '/idea': 'idea.html', '/toolkit': 'toolkit.html' };

  async function handle(req, res) {
    if (req.method === 'POST' && !isHost(req) && !allowed('ip' + ipOf(req), 300, 60000)) return tooMany(res);
    const url = new URL(String(req.url || '/').replace(/^\/+/, '/'), 'http://x');
    const p = url.pathname;
    const GET = req.method === 'GET' || req.method === 'HEAD';

    // "/match/" becomes "/match", so the pages' relative links (assets/, api/) keep working.
    if (GET && p.length > 1 && p.endsWith('/') && PAGES[p.replace(/\/+$/, '')]) {
      res.writeHead(301, { location: '../' + p.replace(/\/+$/, '').split('/').pop() + url.search });
      return res.end();
    }
    // The home page holds the host's buttons, so a phone that opens the bare link goes to the form.
    if (GET && (p === '/' || p === '/index.html')) {
      if (!isHost(req)) { res.writeHead(302, { location: 'match' }); return res.end(); }
      return servePage(res, 'index.html');
    }
    if (GET && PAGES[p]) return servePage(res, PAGES[p]);

    const qr = /^\/qr\/(match|idea)\.svg$/.exec(p);
    if (GET && qr) return send(res, 200, qrSvg(qr[1]), 'image/svg+xml');

    if (GET && p === '/api/config') {
      return send(res, 200, { title: S.title, host: S.host, hostMid: S.hostMid, base: BASE_URL, address: BASE_URL.replace(/^https?:\/\//i, ''),
        assign: S.assign, divs: S.divs, divLabel: S.divLabel, divHint: S.divHint, levels: S.levels, room: S.room, groupSize: S.groupSize, canHost: isHost(req), demo });
    }

    // The match. Everyone's answers are open to the room, because the projector shows them.
    if (GET && p === '/api/match') {
      return send(res, 200, { answers: state.match.map(({ device, ...a }) => a), groups: state.groups, now: Date.now() });
    }

    if (GET && p === '/api/match/mine') {
      const device = clean(req.headers['x-lab-device'], 40);
      const mine = device && state.match.find((m) => m.device === device);
      if (!mine) return send(res, 200, { answer: null, group: null });
      const g = groupsWithNames();
      const group = g && g.list.find((x) => x.members.some((m) => m.id === mine.id));
      const { device: _d, ...answer } = mine;
      return send(res, 200, { answer, group: group || null, grouped: !!g });
    }

    if (req.method === 'POST' && p === '/api/match') {
      const device = clean(req.headers['x-lab-device'], 40);
      if (!device) return send(res, 400, { error: 'Reload this page, then send your answers again.' });
      if (!allowed('m' + who(req, device), 10, 60000)) return send(res, 429, { error: 'This phone sent its answers too many times in one minute. Wait a minute and try again.' });
      const b = await readJson(req, 16384).catch(() => null);
      if (!b) return send(res, 400, { error: 'Your answers did not go through. Try again.' });
      const a = cleanAnswer(b);
      if (!a.name) return send(res, 400, { error: 'Write your name before you send your answers.' });
      if (!Object.keys(a.rows).length) return send(res, 400, { error: 'Tick at least one kind of assignment before you send your answers.' });
      const old = state.match.find((m) => m.device === device);
      if (old) Object.assign(old, a, { at: Date.now() });
      else {
        if (!allowed('new-m' + ipOf(req), 100, 300000)) return tooMany(res);
        if (state.match.length >= MAX_MATCH) return send(res, 503, { error: `The list of answers is full. Tell ${S.hostMid}.` });
        state.match.push({ id: crypto.randomBytes(6).toString('hex'), device, ...a, at: Date.now() });
      }
      save();
      return send(res, 200, { ok: true, id: (old || state.match[state.match.length - 1]).id });
    }

    // The host screen sorts the groups in the browser and saves them here, so each phone can show its own.
    // A list of null clears the groups.
    if (req.method === 'POST' && p === '/api/match/groups') {
      if (!hostWrite(req)) return notHost(res);
      const b = await readJson(req, 65536).catch(() => ({}));
      if (b.list === null) { state.groups = null; save(); return send(res, 200, { ok: true }); }
      const ids = new Set(state.match.map((m) => m.id));
      const list = (Array.isArray(b.list) ? b.list : []).slice(0, 100).map((g, i) => ({
        n: i + 1, topic: ASSIGN_IDS.has(g && g.topic) ? g.topic : '', table: int(g && g.table, 1, S.room.tables, 0),
        members: (Array.isArray(g && g.members) ? g.members : []).filter((id) => ids.has(id)).slice(0, 8) }));
      state.groups = { at: Date.now(), list };
      save();
      return send(res, 200, { ok: true, groups: state.groups });
    }

    if (req.method === 'POST' && p === '/api/match/reset') {
      if (!hostWrite(req)) return notHost(res);
      const n = state.match.length;
      state.match = [];
      state.groups = null;
      save();
      log(`deleted ${n} answers and the groups`);
      return send(res, 200, { ok: true, cleared: n });
    }

    if (GET && p === '/api/ideas') {
      return send(res, 200, { ideas: state.ideas.filter((x) => !x.hidden).map(({ device, key, ...x }) => x), now: Date.now() });
    }

    // A table's list for the toolkit: one assignment, its parts, and who does each part
    // (0, 1, or 2, in the order of toolkitChoices in settings.json).
    if (req.method === 'POST' && p === '/api/ideas') {
      const device = clean(req.headers['x-lab-device'], 40);
      if (!device) return send(res, 400, { error: 'Reload this page, then send your answers again.' });
      if (!allowed('i' + who(req, device), 8, 60000)) return send(res, 429, { error: 'This phone sent too many lists in one minute. Wait a minute and try again.' });
      const b = await readJson(req, 16384).catch(() => null);
      if (!b) return send(res, 400, { error: 'Your answers did not go through. Try again.' });
      const assignment = clean(b.assignment, 120);
      const elements = (Array.isArray(b.elements) ? b.elements : []).slice(0, 12)
        .map((e) => ({ name: clean(e && e.name, 80), level: int(e && e.level, 0, 2, -1) }))
        .filter((e) => e.name);
      if (!assignment) return send(res, 400, { error: 'Name the assignment before you send it.' });
      if (!elements.length) return send(res, 400, { error: 'List at least one part before you send it.' });
      if (elements.some((e) => e.level < 0)) return send(res, 400, { error: 'Pick who does each part before you send it.' });
      // A phone that lost the answer to its first send sends again with the same key, and the server
      // keeps the first copy instead of adding a second.
      const key = clean(b.key, 40);
      const dup = key && state.ideas.find((x) => x.device === device && x.key === key);
      if (dup) return send(res, 200, { ok: true, id: dup.id });
      if (!allowed('new-i' + ipOf(req), 60, 300000)) return tooMany(res);
      if (state.ideas.length >= MAX_IDEAS) return send(res, 503, { error: `The toolkit is full. Tell ${S.hostMid}.` });
      const g = groupOf(device);
      const id = crypto.randomBytes(6).toString('hex');
      state.ideas.push({ id, device, key, assignment, elements, group: g ? g.n : 0, table: g ? g.table : 0, kind: g ? g.kind : '', at: Date.now() });
      save();
      return send(res, 200, { ok: true, id });
    }

    // The host can take one list off the toolkit screen, for example a test entry.
    if (req.method === 'POST' && p === '/api/ideas/hide') {
      if (!hostWrite(req)) return notHost(res);
      const b = await readJson(req, 1024).catch(() => ({}));
      const x = state.ideas.find((i) => i.id === b.id);
      if (!x) return send(res, 404, { error: 'That list is gone.' });
      x.hidden = true;
      save();
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST' && p === '/api/ideas/reset') {
      if (!hostWrite(req)) return notHost(res);
      const n = state.ideas.length;
      state.ideas = [];
      save();
      log(`deleted ${n} toolkit lists`);
      return send(res, 200, { ok: true, cleared: n });
    }

    // Deletes every answer, group, and toolkit list. For use before a new session.
    if (req.method === 'POST' && p === '/api/reset-all') {
      if (!hostWrite(req)) return notHost(res);
      const n = { answers: state.match.length, lists: state.ideas.length };
      state = { match: [], groups: null, ideas: [] };
      save();
      log(`deleted everything: ${n.answers} answers and ${n.lists} toolkit lists`);
      return send(res, 200, { ok: true, cleared: n });
    }

    const exp = /^\/api\/export\/(toolkit|groups)\.csv$/.exec(p);
    if (GET && exp) {
      if (!isHost(req)) return notHost(res);
      let rows;
      if (exp[1] === 'toolkit') {
        rows = [['Table', 'Group', 'Kind of assignment', 'Assignment', 'Part', 'Who does it', 'Sent']];
        for (const x of state.ideas.filter((i) => !i.hidden)) {
          for (const e of x.elements) rows.push([x.table || '', x.group || '', kindName(x.kind), x.assignment, e.name, S.levels[e.level] || '', when(x.at)]);
        }
      } else {
        rows = [['Group', 'Table', 'Kind of assignment', 'Name', S.divLabel, 'AI on this kind', 'Can help']];
        const g = groupsWithNames();
        const placed = new Set();
        const LV = ['Not at all', 'Would like to use AI', 'Using AI now'];
        for (const grp of g ? g.list : []) {
          for (const m of grp.members) {
            placed.add(m.id);
            rows.push([grp.n, grp.table || '', kindName(grp.topic), m.name, m.div, m.row ? LV[m.row.lvl] : 'Does not give this one', m.row && m.row.help ? 'Yes' : '']);
          }
        }
        for (const m of state.match.filter((x) => !placed.has(x.id))) rows.push(['', '', '', m.name, m.div, 'Not in a group', '']);
      }
      const name = `${S.title} ${exp[1]} ${new Date().toISOString().slice(0, 10)}.csv`.replace(/[^\w .-]+/g, '');
      return send(res, 200, csv(rows), 'text/csv; charset=utf-8', { 'content-disposition': `attachment; filename="${name}"` });
    }

    if (p === '/healthz') return send(res, 200, { ok: true, answers: state.match.length, lists: state.ideas.length });

    if (GET && p.startsWith('/assets/')) return serveStatic(res, p);

    send(res, 404, { error: 'Not found' });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error('[lab]', e);
      if (!res.headersSent) send(res, 500, { error: 'That did not go through. Try again.' });
    });
  });

  return {
    settings: S,
    server,
    listen(port, host) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => { server.off('error', reject); resolve(server.address().port); });
      });
    },
    setBase(url) { BASE_URL = String(url).replace(/\/+$/, ''); },
    getBase() { return BASE_URL; },
    close() { clearInterval(sweep); return new Promise((r) => server.close(() => r())); },
  };
}

module.exports = { createLab, loadSettings };

// `node server.js` runs the server alone, with no Cloudflare link. Most people use `node start.js`.
if (require.main === module) {
  const lab = createLab({ dataFile: path.join(__dirname, 'data', 'state.json') });
  const port = Number(process.env.PORT) || lab.settings.port;
  if (process.env.BASE_URL) lab.setBase(process.env.BASE_URL);
  else lab.setBase(`http://localhost:${port}`);
  lab.listen(port, process.env.HOST || '127.0.0.1').then((p) => console.log(`[lab] listening on port ${p}. The QR codes point at ${lab.getBase()}.`));
}
