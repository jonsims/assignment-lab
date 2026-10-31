#!/usr/bin/env node
// Starts the Assignment Lab: the web server on this computer, and a free Cloudflare link so phones on
// any network can reach it. Prints both links, saves them in data/links.json, and opens the host screen.
//
//   node start.js            start, with a Cloudflare link for phones
//   node start.js --wifi     start without Cloudflare; phones must be on the same Wi-Fi as this computer
//   node start.js --demo     start with 40 sample people and five toolkit lists, kept apart from real answers
//   node start.js --no-open  start without opening the browser
//   node start.js --port N   use port N instead of the one in settings.json
//
// The Cloudflare link needs the free cloudflared program (see the README). It needs no account.

'use strict';
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const major = Number(process.versions.node.split('.')[0]);
if (major < 18) {
  console.error(`The Assignment Lab needs Node 18 or newer, and this computer has Node ${process.versions.node}. Install the LTS version from https://nodejs.org and try again.`);
  process.exit(1);
}

const { createLab, loadSettings } = require('./server');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const WIFI = has('--wifi') || has('--local');
const DEMO = has('--demo');
const OPEN = !has('--no-open');
const portArg = args.includes('--port') ? Number(args[args.indexOf('--port') + 1]) : 0;

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const SETTINGS = path.join(ROOT, 'settings.json');
fs.mkdirSync(DATA, { recursive: true });

let S;
try { S = loadSettings(SETTINGS); } catch (e) { console.error(e.message); process.exit(1); }

// A bad request must never stop the room's pages.
process.on('uncaughtException', (e) => console.error('[lab] uncaught', e));

/* ------------------------------------------------------------------ demo */

// Sample people with made-up names, so a host can try every screen before the real session.
function writeDemo(file) {
  let a = 20261030;
  const rnd = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const first = ['Ada', 'Ben', 'Carla', 'Dev', 'Elena', 'Farid', 'Grace', 'Hiro', 'Imani', 'Jonas', 'Kira', 'Luis', 'Maya', 'Nikhil', 'Olga', 'Pablo', 'Quinn', 'Rosa', 'Samir', 'Tess'];
  const last = ['Abbott', 'Brennan', 'Castillo', 'Duarte', 'Eriksen', 'Fofana', 'Gupta', 'Hale', 'Ibarra', 'Jensen', 'Kowalski', 'Lindqvist', 'Moreau', 'Nakamura', 'Okafor', 'Petrov', 'Quintero', 'Reyes', 'Sato', 'Turner'];
  const ids = S.assign.map((x) => x.id);
  const match = [];
  for (let i = 0; i < 40; i++) {
    const rows = {};
    const n = 2 + Math.floor(rnd() * 3);
    while (Object.keys(rows).length < Math.min(n, ids.length)) {
      const k = pick(ids);
      const lvl = Math.floor(rnd() * 3);
      rows[k] = { lvl, help: lvl === 2 && rnd() < 0.5 };
    }
    const ticked = Object.keys(rows);
    match.push({ id: 'demo' + String(i).padStart(4, '0') + 'aa', device: 'demo-' + i, name: first[i % 20] + ' ' + last[(i * 7 + 3 + Math.floor(i / 20) * 5) % 20],
      div: S.divs.length ? pick(S.divs) : '', rows, star: rnd() < 0.4 ? pick(ticked) : '', at: Date.now() - (40 - i) * 20000 });
  }
  const lists = [
    ['teampres', 'Final team pitch', [['Market research', 1], ['Slide design', 1], ['Financial model', 2], ['Live delivery', 0], ['Answering questions', 0]]],
    ['writing', 'Policy memo', [['Picking the question', 0], ['Finding sources', 1], ['First draft', 1], ['Checking every citation', 2], ['Final argument', 0]]],
    ['reflect', 'Weekly learning journal', [['Choosing a moment to write about', 0], ['Writing the entry', 0], ['Feedback on the entry', 1]]],
    ['problems', 'Pricing model in a spreadsheet', [['Setting up the data', 2], ['Building the formulas', 1], ['Explaining the result', 0]]],
    ['case', 'Written case analysis', [['Reading the case', 0], ['Listing the options', 1], ['Testing each option against the numbers', 2], ['The recommendation', 0]]],
  ];
  const ideas = lists.map(([kind, assignment, parts], i) => ({ id: 'demolist' + i + 'aaa', device: 'demo-list-' + i, key: '', assignment,
    elements: parts.map(([name, level]) => ({ name, level })), group: 0, table: 0, kind: ids.includes(kind) ? kind : '', at: Date.now() - (5 - i) * 60000 }));
  fs.writeFileSync(file, JSON.stringify({ match, groups: null, ideas }));
}

/* --------------------------------------------------------------- helpers */

function findCloudflared() {
  const local = path.join(ROOT, 'bin', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  for (const cmd of [local, 'cloudflared']) {
    if (cmd === local && !fs.existsSync(local)) continue;
    try {
      const r = spawnSync(cmd, ['--version'], { encoding: 'utf8', timeout: 15000 });
      if (r.status === 0) return cmd;
    } catch (e) { /* not here */ }
  }
  return null;
}

function wifiAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) if (n.family === 'IPv4' && !n.internal && !n.address.startsWith('169.254.')) return n.address;
  }
  return null;
}

function openBrowser(url) {
  if (!OPEN) return;
  try {
    const p = process.platform === 'darwin' ? spawn('open', [url], { stdio: 'ignore', detached: true })
      : process.platform === 'win32' ? spawn('cmd', ['/c', 'start', '""', url], { stdio: 'ignore', detached: true })
      : spawn('xdg-open', [url], { stdio: 'ignore', detached: true });
    p.on('error', () => {});
    p.unref();
  } catch (e) { /* the link is printed anyway */ }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// A new Cloudflare link can take a few seconds before phones reach it.
async function reachable(url) {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(url + '/healthz', { signal: AbortSignal.timeout(5000) });
      if (r.ok) return true;
    } catch (e) { /* not yet */ }
    await wait(2000);
  }
  return false;
}

// A Mac lets the lab listen on 127.0.0.1 while another program already listens on the same port for
// every address, so the port looks free. The lab skips any port where something already answers.
function portAnswers(port) {
  const knock = (host) => new Promise((resolve) => {
    const s = net.connect({ port, host });
    s.setTimeout(500);
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('timeout', () => { s.destroy(); resolve(false); });
    s.once('error', () => resolve(false));
  });
  return Promise.all([knock('127.0.0.1'), knock('::1')]).then((r) => r.includes(true));
}

function saveLinks(links) {
  fs.writeFileSync(path.join(DATA, 'links.json'), JSON.stringify({ ...links, demo: DEMO, pid: process.pid, startedAt: new Date().toISOString() }, null, 2));
}

/* ---------------------------------------------------------------- tunnel */

// cloudflared gets an empty settings file of its own, so a Cloudflare setup this computer already has
// is never touched. The quick link comes from trycloudflare.com and needs no account.
let tunnel = null, stopping = false, restarts = 0;
function startTunnel(cmd, port) {
  const conf = path.join(DATA, 'cloudflared-quick.yml');
  fs.writeFileSync(conf, '# Left empty on purpose. The Assignment Lab uses a quick link with no account.\nno-autoupdate: true\n');
  return new Promise((resolve) => {
    const child = spawn(cmd, ['tunnel', '--config', conf, '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    tunnel = child;
    let found = false, log = '';
    const timer = setTimeout(() => { if (!found) { found = true; resolve({ url: null, log }); } }, 45000);
    const read = (d) => {
      log = (log + d).slice(-4000);
      const m = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/.exec(String(d));
      if (m && !found) { found = true; clearTimeout(timer); resolve({ url: m[0], log }); }
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.on('error', (e) => { if (!found) { found = true; clearTimeout(timer); resolve({ url: null, log: e.message }); } });
    child.on('exit', (code) => {
      if (!found) { found = true; clearTimeout(timer); resolve({ url: null, log }); return; }
      if (stopping || tunnel !== child) return;
      console.error(`\n[lab] The Cloudflare link stopped (code ${code}).`);
      onTunnelLost();
    });
  });
}

let lab, port, cfCmd;
async function onTunnelLost() {
  if (restarts >= 3) {
    console.error('[lab] The Cloudflare link stopped three times, so the lab stopped trying. Phones on the same Wi-Fi can still use the Wi-Fi link if there is one. Restart the lab to try again.');
    return;
  }
  restarts++;
  await wait(2000);
  const { url } = await startTunnel(cfCmd, port);
  if (!url) { console.error('[lab] The lab could not get a new Cloudflare link.'); return; }
  lab.setBase(url);
  await reachable(url);
  saveLinks({ host: `http://localhost:${port}/`, phones: `${url}/match`, toolkit: `${url}/idea`, mode: 'cloudflare' });
  console.log(`\n  THE LINK FOR PHONES CHANGED. The new link is ${url}/match`);
  console.log('  Reload the Find your group and toolkit screens so they show the new QR codes.\n');
}

/* ------------------------------------------------------------------ main */

(async () => {
  const dataFile = path.join(DATA, DEMO ? 'demo.json' : 'state.json');
  if (DEMO) writeDemo(dataFile);
  lab = createLab({ settingsFile: SETTINGS, dataFile, demo: DEMO });

  cfCmd = WIFI ? null : findCloudflared();
  const mode = WIFI || !cfCmd ? 'wifi' : 'cloudflare';
  // With the Cloudflare link, the server listens only on this computer. On Wi-Fi it listens on the network.
  const bindHost = mode === 'cloudflare' ? '127.0.0.1' : '0.0.0.0';
  const want = portArg || S.port;
  for (let p = want; p < want + 20 && !port; p++) {
    if (await portAnswers(p)) continue;
    try { port = await lab.listen(p, bindHost); } catch (e) { if (e.code !== 'EADDRINUSE') throw e; }
  }
  if (!port) { console.error(`Ports ${want} to ${want + 19} are all busy. Start the lab with --port and another number, such as --port 4100.`); process.exit(1); }

  const host = `http://localhost:${port}/`;
  let phones = null;
  if (mode === 'cloudflare') {
    console.log('[lab] Getting a Cloudflare link for phones. This takes up to a minute.');
    const { url, log } = await startTunnel(cfCmd, port);
    if (url) {
      lab.setBase(url);
      if (!(await reachable(url))) console.log('[lab] The Cloudflare link is slow to answer. It usually works within another minute.');
      phones = url;
    } else {
      console.error('[lab] Cloudflare did not give the lab a link. Its last message was:\n' + log.split('\n').slice(-6).join('\n'));
    }
  }
  if (!phones) {
    const ip = wifiAddress();
    if (mode === 'cloudflare') {
      // The server listens only on this computer, so phones can't use the Wi-Fi either.
      lab.setBase(`http://localhost:${port}`);
      console.error('[lab] Phones can\'t reach the lab yet. Stop it with Ctrl+C, then start it again, or start it with --wifi.');
    } else if (ip) {
      phones = `http://${ip}:${port}`;
      lab.setBase(phones);
    }
  }

  saveLinks({ host, phones: phones ? `${phones}/match` : null, toolkit: phones ? `${phones}/idea` : null, mode: phones ? mode : 'this computer only' });

  console.log('');
  console.log(`  ${S.title} is running${DEMO ? ' with sample people' : ''}.`);
  console.log('');
  console.log(`  Host screen, on this computer:  ${host}`);
  if (phones) console.log(`  Link for phones:                ${phones}/match`);
  console.log('');
  if (mode === 'wifi' && !WIFI) {
    console.log('  cloudflared is not installed, so only phones on the same Wi-Fi as this computer can join.');
    console.log('  Many campus networks block that. To get a link that works on any network, install cloudflared');
    console.log('  (the README says how) and start the lab again.');
    console.log('');
  } else if (mode === 'wifi') {
    console.log('  Only phones on the same Wi-Fi as this computer can join.');
    console.log('');
  }
  console.log('  Keep this window open during the session. Press Ctrl+C to stop the lab.');
  console.log('');
  openBrowser(host);
})().catch((e) => { console.error('[lab] The lab did not start:', e.message); process.exit(1); });

function stop() {
  if (stopping) return;
  stopping = true;
  console.log('\n[lab] Stopping the lab. The answers stay in the data folder.');
  try { if (tunnel) tunnel.kill(); } catch (e) {}
  try { fs.rmSync(path.join(DATA, 'links.json'), { force: true }); } catch (e) {}
  const done = () => process.exit(0);
  if (lab) lab.close().then(done); else done();
  setTimeout(done, 3000).unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
