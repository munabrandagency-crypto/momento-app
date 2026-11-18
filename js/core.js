/* Momento Scanner — fonctions partagées (stockage, API, mode démo, recherche, dates) */
(function () {
  'use strict';
  const CFG = window.MOMENTO_CONFIG || {};
  const M = (window.Momento = {});

  /* ---------------- Stockage local (IndexedDB) ---------------- */
  let dbP = null;
  function db() {
    if (!dbP) dbP = new Promise(function (res, rej) {
      const r = indexedDB.open('momento-scanner', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
    return dbP;
  }
  M.store = {
    get: async function (k) {
      try {
        const d = await db();
        return await new Promise(function (res) {
          const q = d.transaction('kv').objectStore('kv').get(k);
          q.onsuccess = function () { res(q.result); };
          q.onerror = function () { res(undefined); };
        });
      } catch (e) { return undefined; }
    },
    set: async function (k, v) {
      try {
        const d = await db();
        await new Promise(function (res) {
          const t = d.transaction('kv', 'readwrite');
          t.objectStore('kv').put(v, k);
          t.oncomplete = res; t.onerror = res;
        });
      } catch (e) {}
    }
  };
  M.ls = {
    get: function (k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  /* ---------------- Outils ---------------- */
  M.norm = function (s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  };
  M.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  M.nowTime = function () {
    const d = new Date();
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map(function (n) { return String(n).padStart(2, '0'); }).join(':');
  };
  M.sha16 = async function (text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('').slice(0, 16);
  };
  M.randomCode = function (len, alphabet) {
    const a = alphabet || 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const r = crypto.getRandomValues(new Uint32Array(len));
    let s = ''; for (let i = 0; i < len; i++) s += a[r[i] % a.length];
    return s;
  };

  /* Lit le contenu d'un QR : "FAINV-001", "FAINV-001.K7Q2XP" ou un lien contenant data=... */
  M.parseQr = function (raw) {
    let t = String(raw || '').trim();
    const m = t.match(/[?&]data=([^&]+)/);
    if (m) { try { t = decodeURIComponent(m[1]); } catch (e) { t = m[1]; } }
    t = t.trim().toUpperCase();
    const dot = t.lastIndexOf('.');
    if (dot > 0) return { id: t.slice(0, dot), code: t.slice(dot + 1), raw: raw };
    return { id: t, code: '', raw: raw };
  };

  /* ---------------- Dates ---------------- */
  const POLICES = {
    script:    { family: "'Great Vibes', cursive", size: 1.55, label: 'Manuscrite élégante' },
    serif:     { family: "'Playfair Display', serif", size: 1.0, label: 'Classique (Playfair)' },
    garamond:  { family: "'Cormorant Garamond', serif", size: 1.12, label: 'Raffinée (Garamond)' },
    moderne:   { family: "'Montserrat', sans-serif", size: 0.8, label: 'Moderne', upper: true }
  };
  M.POLICES = POLICES;
  M.FORMATS = { long: 'Samedi 12 décembre 2026', court: '12 décembre 2026', numerique: '12 · 12 · 2026' };
  M.formatDate = function (iso, fmt) {
    if (!iso) return '';
    const p = String(iso).split('-').map(Number);
    if (p.length < 3 || !p[0]) return String(iso);
    const d = new Date(p[0], p[1] - 1, p[2]);
    if (fmt === 'numerique') return [p[2], p[1], p[0]].map(function (n, i) { return i < 2 ? String(n).padStart(2, '0') : n; }).join(' · ');
    const o = fmt === 'court' ? { day: 'numeric', month: 'long', year: 'numeric' }
                              : { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
    const s = d.toLocaleDateString('fr-FR', o);
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  M.applyDateStyle = function (el, evt) {
    const p = POLICES[evt.dateFont] || POLICES.script;
    el.textContent = M.formatDate(evt.date, evt.dateFormat || 'long');
    el.style.fontFamily = p.family;
    el.style.fontSize = p.size + 'em';
    el.style.color = evt.dateColor || '';
    el.style.textTransform = p.upper ? 'uppercase' : 'none';
    el.style.letterSpacing = p.upper ? '0.18em' : '0';
    el.hidden = !evt.date;
  };

  /* ---------------- Recherche intelligente ---------------- */
  function dl(a, b) { // distance de Damerau-Levenshtein (restreinte)
    const n = a.length, m = b.length;
    if (!n) return m; if (!m) return n;
    const d = [];
    for (let i = 0; i <= n; i++) { d[i] = [i]; }
    for (let j = 0; j <= m; j++) d[0][j] = j;
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        const c = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[n][m];
  }
  function tokenScore(q, t) {
    if (t === q) return 1;
    if (t.startsWith(q)) return 0.92;
    if (q.length >= 3 && t.includes(q)) return 0.8;
    if (q.length < 4) return 0;
    const allowed = q.length <= 5 ? 1 : 2;
    const d = Math.min(dl(q, t), dl(q, t.slice(0, q.length)));
    return d <= allowed ? 0.72 - 0.1 * d : 0;
  }
  M.indexGuest = function (g) {
    const name = M.norm(g.name), table = M.norm(g.table), id = M.norm(g.id);
    const digits = (g.id.match(/\d+/g) || []).map(function (x) { return String(parseInt(x, 10)); });
    g._s = {
      tokens: (name + ' ' + table + ' ' + id).split(' ').filter(Boolean),
      nameTokens: name.split(' ').filter(Boolean),
      joined: name.replace(/ /g, ''), digits: digits
    };
    return g;
  };
  M.search = function (guests, query, limit) {
    const q = M.norm(query);
    if (!q) return [];
    const qt = q.split(' ');
    const qJoined = q.replace(/ /g, '');
    const out = [];
    for (let i = 0; i < guests.length; i++) {
      const g = guests[i], s = g._s || M.indexGuest(g)._s;
      let total = 0, ok = true;
      for (let k = 0; k < qt.length; k++) {
        const w = qt[k];
        let best = 0;
        if (/^\d+$/.test(w) && s.digits.indexOf(String(parseInt(w, 10))) >= 0) best = 1;
        for (let j = 0; j < s.tokens.length && best < 1; j++) best = Math.max(best, tokenScore(w, s.tokens[j]));
        if (best < 0.5 && w.length >= 3 && s.joined.includes(w)) best = 0.75;
        if (best < 0.5) { ok = false; break; }
        total += best;
      }
      if (!ok && qJoined.length >= 4 && s.joined.includes(qJoined)) { ok = true; total = 0.85 * qt.length; }
      if (ok) out.push({ g: g, score: total / qt.length });
    }
    out.sort(function (a, b) { return b.score - a.score || a.g.name.localeCompare(b.g.name); });
    return out.slice(0, limit || 25).map(function (x) { return x.g; });
  };

  /* ---------------- API (script central) ---------------- */
  M.isDemo = !CFG.API_URL || /[?&]demo=1/.test(location.search);

  async function timed(url, opts, ms) {
    const ctl = new AbortController();
    const t = setTimeout(function () { ctl.abort(); }, ms || 20000);
    try {
      const r = await fetch(url, Object.assign({ signal: ctl.signal, redirect: 'follow' }, opts));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j && j.ok === false) { const e = new Error(j.error || 'Erreur'); e.server = true; throw e; }
      return j;
    } finally { clearTimeout(t); }
  }
  M.api = {
    get: function (params) {
      if (M.isDemo) return Demo.get(params);
      const qs = Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
      return timed(CFG.API_URL + '?' + qs + '&_=' + Date.now(), { cache: 'no-store' });
    },
    post: function (body) {
      if (M.isDemo) return Demo.post(body);
      return timed(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) }, 45000);
    }
  };

  /* ---------------- Mode démo (aucun Google Sheet nécessaire) ---------------- */
  const DEMO_NOMS = [
    ["Jean-Paul MBALLA", "PURETE"], ["Marie MBALLA", "PURETE"], ["Simon MBALLA", "PURETE"], ["Max MBALLA", "PURETE"],
    ["Willy MBALLA", "PURETE"], ["Vladimir MBALLA", "PURETE"], ["Ma'a ESSOMBA", "PURETE"], ["Ngo Marie Claire", "PURETE"],
    ["Zita NJOYA", "ROYAUTE"], ["Nadège FOTSO", "ROYAUTE"], ["Laetitia BIYONG", "ROYAUTE"], ["Gaëlle KAMGA", "ROYAUTE"],
    ["Arnold TCHAMBA", "ROYAUTE"], ["Lionnel", "ROYAUTE"], ["Conrad", "ROYAUTE"], ["Francis NDONGO", "ROYAUTE"],
    ["Laurie TAGNE", "ROYAUTE"], ["Synthia WAMBA", "ROYAUTE"], ["Louise AGUEDIA", "ABNEGATION"], ["Michel TEKAM", "ABNEGATION"],
    ["Mathias DJOMO", "ABNEGATION"], ["Pious DJOMO", "ABNEGATION"], ["Anasse MOUNDE", "ABNEGATION"], ["David Mo'o NGUEMA", "ABNEGATION"],
    ["Anastasie", "ABNEGATION"], ["Louis TSALA", "ABNEGATION"], ["Yannick FOUDA", "FERTILITE"], ["Hervé NANA", "FERTILITE"],
    ["Jeanne DJOMO", "FERTILITE"], ["Nicole NANA", "FERTILITE"], ["Sonia NANA", "FERTILITE"], ["Maïva NANA", "FERTILITE"],
    ["Lucaille OWONA", "FERTILITE"], ["Papa KRIBI", "GRANDEUR"]
  ];
  function demoDb() {
    let d = M.ls.get('momento_demo_db', null);
    if (!d) {
      d = { events: {}, sheets: {} };
      d.events.demo = {
        id: 'demo', name: 'Mariage Démo', sheetUrl: 'https://docs.google.com/spreadsheets/d/DEMO_SHEET_ID_0000000000/edit',
        sheetId: 'DEMO_SHEET_ID_0000000000', tab: 'Invites', date: '2026-12-12', dateFont: 'script', dateFormat: 'long',
        dateColor: '#F3D9B8', accent: '#C9925F', requireSecret: false, logo: 'demo', background: 'demo',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      };
      d.sheets.DEMO_SHEET_ID_0000000000 = DEMO_NOMS.map(function (x, i) {
        return { id: 'FAINV-' + String(i + 1).padStart(3, '0'), name: x[0], table: x[1], status: '', time: '', device: '', mode: '', code: '' };
      });
      // Deux invités déjà arrivés, pour voir l'alerte "déjà scanné"
      Object.assign(d.sheets.DEMO_SHEET_ID_0000000000[0], { status: 'Présent', time: '17:58:12', device: 'Entrée-1', mode: 'Scan' });
      Object.assign(d.sheets.DEMO_SHEET_ID_0000000000[13], { status: 'Présent', time: '18:03:47', device: 'Entrée-3', mode: 'Scan' });
      M.ls.set('momento_demo_db', d);
    }
    return d;
  }
  function demoImage(kind) {
    if (kind === 'background') return 'assets/demo-fond.jpg';
    return 'assets/demo-logo-mariage.png';
  }
  async function demoGuests(d, evt) {
    const rows = d.sheets[evt.sheetId] || [];
    const out = [];
    for (const r of rows) {
      out.push({ id: r.id, name: r.name, table: r.table, present: !!r.status, time: r.time, device: r.device, mode: r.mode,
                 h: r.code ? await M.sha16(r.id + '.' + r.code) : '' });
    }
    return out;
  }
  function pub(e) {
    return { id: e.id, name: e.name, date: e.date, dateFont: e.dateFont, dateFormat: e.dateFormat, dateColor: e.dateColor,
             accent: e.accent, requireSecret: !!e.requireSecret, hasLogo: !!e.logo, hasBackground: !!e.background, updatedAt: e.updatedAt };
  }
  const wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  const Demo = {
    get: async function (p) {
      await wait(250);
      if (M.demoOffline) throw new Error('Hors ligne (simulation)');
      const d = demoDb(), e = d.events[p.e];
      if (!e) throw Object.assign(new Error('Mariage introuvable. Vérifiez le lien du scanner.'), { server: true });
      if (p.action === 'data') return { ok: true, event: pub(e), guests: await demoGuests(d, e) };
      if (p.action === 'images') return { ok: true, updatedAt: e.updatedAt,
        logo: e.logo === 'demo' ? demoImage('logo') : (e.logo || ''), background: e.background === 'demo' ? demoImage('background') : (e.background || '') };
      return { ok: true };
    },
    post: async function (b) {
      await wait(300);
      if (M.demoOffline) throw new Error('Hors ligne (simulation)');
      const d = demoDb();
      if (b.action === 'checkin') {
        const e = d.events[b.e], rows = d.sheets[e.sheetId];
        const results = b.items.map(function (it) {
          const r = rows.find(function (x) { return x.id === it.id; });
          if (!r) return { id: it.id, result: 'unknown', ref: it.ref };
          if (r.status) return { id: it.id, result: 'already', ref: it.ref, time: r.time, device: r.device, mode: r.mode };
          Object.assign(r, { status: 'Présent', time: it.time, device: it.device, mode: it.mode === 'manuel' ? 'Manuel' : 'Scan' });
          return { id: it.id, result: 'ok', ref: it.ref, time: r.time, device: r.device, mode: r.mode };
        });
        M.ls.set('momento_demo_db', d);
        return { ok: true, results: results };
      }
      if (b.action.indexOf('admin_') === 0 && b.password !== 'demo') throw Object.assign(new Error('Mot de passe incorrect (mode démo : « demo »)'), { server: true });
      if (b.action === 'admin_login') return { ok: true };
      if (b.action === 'admin_list') return { ok: true, events: Object.values(d.events) };
      if (b.action === 'admin_get') {
        const e = d.events[b.id];
        return { ok: true, event: e, images: await Demo.get({ action: 'images', e: b.id }) };
      }
      if (b.action === 'admin_save') {
        const x = b.event, im = b.images || {};
        const m = String(x.sheetUrl || '').match(/\/d\/([a-zA-Z0-9-_]{20,})/);
        if (!m) throw Object.assign(new Error('Lien Google Sheet invalide'), { server: true });
        let e = (x.id && d.events[x.id]) || { id: M.randomCode(10, 'abcdefghijkmnpqrstuvwxyz23456789'), createdAt: new Date().toISOString() };
        Object.assign(e, { name: x.name, tab: x.tab || 'Invites', date: x.date, dateFont: x.dateFont, dateFormat: x.dateFormat,
          dateColor: x.dateColor, accent: x.accent, requireSecret: !!x.requireSecret, sheetId: m[1], sheetUrl: x.sheetUrl, updatedAt: new Date().toISOString() });
        if (im.logo !== undefined) e.logo = im.logo || '';
        if (im.background !== undefined) e.background = im.background || '';
        if (!d.sheets[e.sheetId]) d.sheets[e.sheetId] = JSON.parse(JSON.stringify(d.sheets.DEMO_SHEET_ID_0000000000)).map(function (r) {
          return Object.assign(r, { status: '', time: '', device: '', mode: '' });
        });
        d.events[e.id] = e;
        M.ls.set('momento_demo_db', d);
        const rows = d.sheets[e.sheetId];
        return { ok: true, event: e, guestCount: rows.length, presentCount: rows.filter(function (r) { return r.status; }).length,
                 secretsCount: rows.filter(function (r) { return r.code; }).length };
      }
      if (b.action === 'admin_delete') { delete d.events[b.id]; M.ls.set('momento_demo_db', d); return { ok: true }; }
      if (b.action === 'admin_secrets') {
        const e = d.events[b.id], rows = d.sheets[e.sheetId]; let created = 0;
        rows.forEach(function (r) { if (!r.code) { r.code = M.randomCode(6); created++; } });
        e.requireSecret = true; e.updatedAt = new Date().toISOString();
        M.ls.set('momento_demo_db', d);
        return { ok: true, created: created, total: rows.length };
      }
      return { ok: false, error: 'Action inconnue' };
    }
  };
  M.demoDb = demoDb;
})();
