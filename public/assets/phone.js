// Shared by the two phone pages, /match and /idea: the phone's id, storage that never throws,
// fetch with a time limit, and the keyboard's Go key.
(function () {
  // Storage that falls back from localStorage to sessionStorage and never throws, because Safari
  // with all cookies blocked throws on any use of either one.
  const boxes = ['localStorage', 'sessionStorage'];
  window.labStore = {
    get(k) { for (const s of boxes) { try { const v = window[s].getItem(k); if (v !== null) return v; } catch (e) {} } return null; },
    set(k, v) { for (const s of boxes) { try { window[s].setItem(k, v); return true; } catch (e) {} } return false; },
    del(k) { for (const s of boxes) { try { window[s].removeItem(k); } catch (e) {} } },
  };

  // One id per phone, shared by both pages. A phone that blocks storage keeps its id in the address
  // after the #, so a reload (Safari reloads tabs it threw away in the background) still finds its answers.
  const fresh = Math.random().toString(36).slice(2, 14);
  let id = labStore.get('lab-device');
  if (!id && labStore.set('lab-device', fresh) && labStore.get('lab-device') === fresh) id = fresh;
  if (!id) {
    const m = /[#&]d=([a-z0-9]{6,20})/.exec(location.hash);
    id = m ? m[1] : fresh;
    if (!m) { try { history.replaceState(history.state, '', location.pathname + location.search + '#d=' + id); } catch (e) {} }
  }
  window.labDevice = id;

  // A form keeps a draft on the phone until it is sent, because Safari can throw a background page
  // away and reload it later. A draft older than 12 hours belongs to another event and is left out.
  window.labDraft = (name) => ({
    save(v) { labStore.set(name, JSON.stringify({ ...v, at: Date.now() })); },
    load() {
      try { const d = JSON.parse(labStore.get(name) || 'null'); return d && Date.now() - d.at < 12 * 3600 * 1000 ? d : null; } catch (e) { return null; }
    },
    clear() { labStore.del(name); },
  });

  // A stuck network gives up after 15 seconds, so the person hears about it and can press Send again.
  window.labFetch = (url, opts = {}) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15000);
    return fetch(url, { ...opts, signal: ctl.signal }).finally(() => clearTimeout(t));
  };

  // The Go key on a phone keyboard moves to the next text box, and in the last box it closes the
  // keyboard so the Send button shows. Only the Send button sends.
  window.labKeys = (form) => form.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.target.tagName !== 'INPUT' || e.target.type !== 'text') return;
    e.preventDefault();
    const all = [...form.querySelectorAll('input[type=text]')];
    const next = all[all.indexOf(e.target) + 1];
    if (next) next.focus(); else e.target.blur();
  });
})();
