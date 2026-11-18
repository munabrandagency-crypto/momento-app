/* Momento Scanner — application de scan */
(function () {
  'use strict';
  const M = window.Momento, CFG = window.MOMENTO_CONFIG || {};
  const $ = function (id) { return document.getElementById(id); };
  const RETOUR = (CFG.RETOUR_AUTO_S || 15) * 1000;

  const S = {
    eventId: '', event: null, guests: [], byId: new Map(), images: {}, queue: [],
    device: M.ls.get('momento_device', ''), online: navigator.onLine, syncing: false,
    view: 'home', scanning: false, busy: false, cooldown: { id: '', until: 0 }, stream: null, detector: null, returnTimer: null,
    origin: 'home'
  };

  /* ===================== Démarrage ===================== */
  async function init() {
    const params = new URLSearchParams(location.search);
    S.eventId = params.get('e') || M.ls.get('momento_last_event', '') || (M.isDemo ? 'demo' : '');
    const splashMin = new Promise(function (r) { setTimeout(r, 1700); });

    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
    if (!S.eventId) {
      await splashMin; hideSplash();
      return fatal('Aucun mariage sélectionné', 'Ouvrez le lien de scanner fourni par l\'administrateur Momento.');
    }
    M.ls.set('momento_last_event', S.eventId);

    const cached = await M.store.get('evt_' + S.eventId);
    S.images = (await M.store.get('img_' + S.eventId)) || {};
    S.queue = (await M.store.get('queue_' + S.eventId)) || [];
    if (cached) applyData(cached, true);

    let firstError = null;
    const firstLoad = fetchData().catch(function (e) { firstError = e; });
    if (!cached) await Promise.race([firstLoad, new Promise(function (r) { setTimeout(r, 12000); })]);

    await splashMin;
    hideSplash();
    if (!S.event) {
      if (firstError && firstError.server) return fatal('Lien de scanner invalide', firstError.message);
      return fatal('Connexion nécessaire', 'À la toute première ouverture, le scanner doit télécharger la liste des invités. Connectez-vous à internet puis touchez « Réessayer ». Ensuite, il fonctionnera même hors-ligne.', true);
    }
    showHome();
    if (!S.device) askDevice(true);
    setInterval(sync, CFG.SYNC_INTERVAL_MS || 8000);
    if (M.isDemo) { const t = document.createElement('div'); t.className = 'demo-tag'; t.textContent = 'MODE DÉMO'; document.body.appendChild(t); }
  }

  function hideSplash() {
    $('splash').classList.add('out');
    setTimeout(function () { $('splash').hidden = true; }, 700);
  }

  function fatal(title, msg, retry) {
    const d = document.createElement('div');
    d.className = 'fatal';
    d.innerHTML = '<div class="box glass"><img src="assets/momento-logo.png" width="90" style="border-radius:50%"><h2 style="font-family:Playfair Display,serif">' +
      M.esc(title) + '</h2><p style="color:var(--cream-dim);line-height:1.5">' + M.esc(msg) + '</p>' +
      (retry ? '<button class="btn-main" onclick="location.reload()">Réessayer</button>' : '') + '</div>';
    document.body.appendChild(d);
  }

  /* ===================== Données & synchronisation ===================== */
  async function fetchData() {
    const d = await M.api.get({ action: 'data', e: S.eventId });
    setOnline(true);
    applyData(d, false);
    await M.store.set('evt_' + S.eventId, { event: d.event, guests: d.guests });
    if (d.event.updatedAt !== S.images.updatedAt) fetchImages();
    return d;
  }

  async function fetchImages() {
    try {
      const im = await M.api.get({ action: 'images', e: S.eventId });
      S.images = { logo: im.logo || '', background: im.background || '', updatedAt: im.updatedAt };
      await M.store.set('img_' + S.eventId, S.images);
      applyTheme();
    } catch (e) {}
  }

  function applyData(d, fromCache) {
    S.event = d.event;
    const local = S.byId;
    S.guests = d.guests.map(function (g) { return M.indexGuest(Object.assign({}, g)); });
    S.byId = new Map(S.guests.map(function (g) { return [g.id, g]; }));
    // Les enregistrements faits sur cet appareil et pas encore envoyés restent visibles
    S.queue.forEach(function (q) {
      const g = S.byId.get(q.id);
      if (g && !g.present) Object.assign(g, { present: true, time: q.time, device: q.device, mode: q.mode === 'manuel' ? 'Manuel' : 'Scan', pending: true });
    });
    if (!fromCache && local.size) local.forEach(function (old, id) {
      const g = S.byId.get(id);
      if (g && !g.present && old.present && old.pending) Object.assign(g, { present: true, time: old.time, device: old.device, mode: old.mode, pending: true });
    });
    applyTheme();
    refreshCounts();
    if ($('q') && $('q').value) renderResults();
  }

  async function sync(manual) {
    if (S.syncing || !S.eventId) return;
    S.syncing = true;
    try {
      if (S.queue.length) await flushQueue();
      await fetchData();
      if (manual === true) toast('Liste à jour : ' + countPresent() + ' présents sur ' + S.guests.length);
    } catch (e) {
      if (e.server) toast(e.message, true); else setOnline(false);
      if (manual === true && !e.server) toast('Pas de connexion. Les présences seront envoyées dès le retour du réseau.', true);
    } finally {
      S.syncing = false;
    }
  }

  async function flushQueue() {
    const batch = S.queue.slice(0, 50);
    const r = await M.api.post({ action: 'checkin', e: S.eventId, items: batch });
    const done = new Set();
    r.results.forEach(function (x) {
      done.add(x.ref);
      const q = batch.find(function (b) { return b.ref === x.ref; });
      const g = S.byId.get(x.id);
      if (x.result === 'already' && q && (x.device !== q.device || x.time !== q.time)) {
        toast('⚠ Doublon : ' + (g ? g.name : x.id) + ' avait déjà été enregistré par ' + (x.device || '?') + ' à ' + (x.time || '?') + '.', true);
        if (g) Object.assign(g, { present: true, time: x.time, device: x.device, mode: x.mode, pending: false });
      } else if (x.result === 'unknown') {
        toast('Invité ' + x.id + ' introuvable dans le Google Sheet.', true);
      } else if (g) {
        g.pending = false;
      }
    });
    S.queue = S.queue.filter(function (q) { return !done.has(q.ref); });
    await M.store.set('queue_' + S.eventId, S.queue);
    setOnline(true);
    refreshCounts();
  }

  function checkinLocal(g, mode) {
    const item = { ref: M.randomCode(8), id: g.id, time: M.nowTime(), device: S.device || 'Appareil', mode: mode };
    Object.assign(g, { present: true, time: item.time, device: item.device, mode: mode === 'manuel' ? 'Manuel' : 'Scan', pending: true });
    S.queue.push(item);
    M.store.set('queue_' + S.eventId, S.queue);
    M.store.set('evt_' + S.eventId, { event: S.event, guests: S.guests.map(strip) });
    refreshCounts();
    setTimeout(sync, 10);
  }
  function strip(g) { const c = Object.assign({}, g); delete c._s; return c; }

  function setOnline(v) { S.online = v; refreshCounts(); }
  function countPresent() { return S.guests.filter(function (g) { return g.present; }).length; }

  /* ===================== Affichage ===================== */
  function applyTheme() {
    const e = S.event; if (!e) return;
    document.documentElement.style.setProperty('--accent', e.accent || '#c9925f');
    $('evtName').textContent = e.name || 'Momento';
    document.title = (e.name || 'Momento') + ' · Scanner';
    M.applyDateStyle($('evtDate'), e);
    $('bg').style.backgroundImage = S.images.background ? 'url("' + S.images.background + '")' : '';
    if (S.images.logo) { $('homeLogo').src = S.images.logo; $('homeLogo').hidden = false; } else $('homeLogo').hidden = true;
  }

  function refreshCounts() {
    if (!$('count')) return;
    $('count').textContent = countPresent() + ' / ' + S.guests.length;
    const on = S.online && navigator.onLine;
    $('netDot').classList.toggle('off', !on);
    $('netTxt').textContent = (on ? 'En ligne' : 'Hors ligne') + (S.queue.length ? ' · ' + S.queue.length + ' en attente' : '');
    $('devName').textContent = S.device || 'Nommer cet appareil';
  }

  function showHome() {
    S.view = 'home';
    $('home').hidden = false;
    $('scanner').hidden = true;
    $('sheet').hidden = true;
  }

  function toast(msg, err) {
    const t = document.createElement('div');
    t.className = 'toast' + (err ? ' err' : '');
    t.textContent = msg;
    $('toasts').appendChild(t);
    setTimeout(function () { t.remove(); }, err ? 6500 : 3500);
  }

  /* ===================== Recherche ===================== */
  function renderResults() {
    const q = $('q').value;
    $('qClear').hidden = !q;
    $('home').classList.toggle('searching', !!q.trim());
    const box = $('results');
    if (!q.trim()) { box.innerHTML = ''; return; }
    const res = M.search(S.guests, q, 30);
    if (!res.length) { box.innerHTML = '<div class="empty glass">Aucun invité trouvé pour « ' + M.esc(q) + ' »</div>'; return; }
    box.innerHTML = res.map(function (g) {
      return '<button class="res glass" data-id="' + M.esc(g.id) + '"><div class="who"><div class="n">' + M.esc(g.name) +
        '</div><div class="s">' + M.esc(g.table || '—') + ' · ' + M.esc(g.id) + '</div></div>' +
        (g.present ? '<span class="badge ok">Présent ' + M.esc(String(g.time).slice(0, 5)) + '</span>' : '<span class="badge wait">À accueillir</span>') + '</button>';
    }).join('');
  }

  function pickGuest(id) {
    const g = S.byId.get(id); if (!g) return;
    $('q').blur();
    S.origin = 'home';
    if (g.present) return showAlert('already', g);
    showConfirm(g);
  }

  /* ===================== Fiche invité / alertes ===================== */
  function cardHeader() {
    const logo = S.images.logo ? '<img class="wlogo" src="' + S.images.logo + '" alt="">' : '';
    return logo + '<div class="date" id="cardDate"></div>';
  }
  function openSheet(html, alertType) {
    clearTimeout(S.returnTimer);
    const w = $('sheet');
    w.innerHTML = '<div class="bg" style="background-image:' + (S.images.background ? 'url(&quot;' + S.images.background + '&quot;)' : 'none') + '"></div>' + html;
    w.hidden = false;
    const cd = $('cardDate'); if (cd && S.event) M.applyDateStyle(cd, S.event);
    if (alertType) { const f = document.createElement('div'); f.className = 'flash-red'; w.appendChild(f); }
  }

  function guestBlock(g) {
    return '<div class="inv">Invitation N° <b>' + M.esc(g.id) + '</b></div>' +
      '<div class="name">' + M.esc(g.name) + '</div>' +
      '<div class="table-box"><small>Table</small><strong>' + M.esc(g.table || '—') + '</strong></div>';
  }

  function showCard(g) {
    openSheet('<div class="card glass">' + cardHeader() + guestBlock(g) +
      '<div class="meta"><span class="check">✓</span> Enregistré à ' + M.esc(g.time) + ' · ' + M.esc(g.device) + (g.mode === 'Manuel' ? ' · Manuel' : '') + '</div>' +
      '<button class="btn-main" id="btnDone">Enregistré<span class="prog" id="prog"></span></button></div>');
    feedback('ok');
    const p = $('prog');
    requestAnimationFrame(function () {
      p.style.transition = 'transform ' + RETOUR + 'ms linear';
      requestAnimationFrame(function () { p.style.transform = 'scaleX(0)'; });
    });
    $('btnDone').onclick = closeSheet;
    S.returnTimer = setTimeout(closeSheet, RETOUR);
  }

  function showConfirm(g) {
    openSheet('<div class="card glass">' + cardHeader() + guestBlock(g) +
      '<div class="meta">Pas encore enregistré</div>' +
      '<button class="btn-main" id="btnMark">Marquer présent</button>' +
      '<button class="btn-ghost" id="btnCancel">Annuler</button></div>');
    $('btnMark').onclick = function () {
      if (g.present) return showAlert('already', g);
      checkinLocal(g, 'manuel');
      showCard(g);
    };
    $('btnCancel').onclick = function () { $('sheet').hidden = true; };
  }

  function showAlert(type, g, raw) {
    let html;
    if (type === 'already') {
      const who = g.device && g.device === S.device ? 'cet appareil (' + M.esc(g.device) + ')' : M.esc(g.device || 'un autre appareil');
      html = '<div class="card glass alert"><div class="ico">!</div><h2>Déjà scanné</h2>' + guestBlock(g) +
        '<div class="first">Premier passage à <b>' + M.esc(g.time || '?') + '</b><br>par <b>' + who + '</b>' +
        (g.mode ? ' · ' + M.esc(g.mode) : '') + '</div><button class="btn-main" id="btnOk">OK</button></div>';
    } else if (type === 'invalid') {
      html = '<div class="card glass alert"><div class="ico">✕</div><h2>QR code non valide</h2>' +
        '<div class="first">Ce QR code ne porte pas le bon code de sécurité : il peut s\'agir d\'un QR modifié ou d\'une ancienne version.<br>' +
        'Vérifiez l\'identité de la personne et utilisez la recherche par nom.</div>' +
        '<button class="btn-main" id="btnOk">OK</button><button class="btn-ghost" id="btnFind">Rechercher un nom</button></div>';
    } else {
      html = '<div class="card glass alert warn"><div class="ico">?</div><h2>Code inconnu</h2>' +
        '<div class="first">Ce QR code ne correspond à aucun invité de ce mariage.<br><small>' + M.esc(String(raw || '').slice(0, 80)) + '</small></div>' +
        '<button class="btn-main" id="btnOk">OK</button><button class="btn-ghost" id="btnFind">Rechercher un nom</button></div>';
    }
    openSheet(html, true);
    feedback('error');
    $('btnOk').onclick = closeSheet;
    if ($('btnFind')) $('btnFind').onclick = function () { $('sheet').hidden = true; goSearch(); };
  }

  function closeSheet() {
    clearTimeout(S.returnTimer);
    $('sheet').hidden = true;
    if (S.view === 'scanner') resumeScan();
    else if ($('q').value) { $('q').value = ''; renderResults(); }
  }

  /* ===================== Scanner caméra ===================== */
  async function openScanner() {
    S.view = 'scanner';
    $('scanner').hidden = false;
    $('camError').hidden = true;
    try {
      if (!S.stream) {
        S.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      }
      const v = $('video');
      v.srcObject = S.stream;
      await v.play();
      const track = S.stream.getVideoTracks()[0];
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      $('torch').hidden = !caps.torch;
      if (!S.detector && 'BarcodeDetector' in window) {
        try {
          const f = await window.BarcodeDetector.getSupportedFormats();
          if (f.indexOf('qr_code') >= 0) S.detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        } catch (e) {}
      }
      resumeScan();
    } catch (e) {
      const ce = $('camError');
      ce.hidden = false;
      ce.innerHTML = '<div class="glass" style="padding:24px"><h3>Caméra indisponible</h3><p style="color:var(--cream-dim)">' +
        (location.protocol !== 'https:' && location.hostname !== 'localhost' ? 'Le scanner doit être ouvert en https.' : 'Autorisez l\'accès à la caméra dans les réglages du navigateur, puis réessayez.') +
        '</p><button class="btn-main" id="camRetry">Réessayer</button></div>';
      $('camRetry').onclick = function () { S.stream = null; openScanner(); };
    }
  }

  function closeScanner() {
    S.scanning = false;
    S.view = 'home';
    if (S.stream) { S.stream.getTracks().forEach(function (t) { t.stop(); }); S.stream = null; }
    showHome();
  }

  function resumeScan() {
    // Le QR qu'on vient de traiter est peut-être encore devant la caméra : on l'ignore quelques secondes
    if (S.cooldown.id) S.cooldown.until = Date.now() + 3500;
    S.scanning = true;
    S.busy = false;
    loop();
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  async function loop() {
    if (!S.scanning || S.view !== 'scanner') return;
    const v = $('video');
    if (!S.busy && v.readyState >= 2 && v.videoWidth) {
      S.busy = true;
      try {
        let text = null;
        if (S.detector) {
          const codes = await S.detector.detect(v);
          if (codes.length) text = codes[0].rawValue;
        } else if (window.jsQR) {
          const scale = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
          const w = Math.round(v.videoWidth * scale), h = Math.round(v.videoHeight * scale);
          canvas.width = w; canvas.height = h;
          ctx.drawImage(v, 0, 0, w, h);
          const r = window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
          if (r && r.data) text = r.data;
        }
        if (text && S.scanning) await onCode(text);
      } catch (e) {}
      S.busy = false;
    }
    if (S.scanning) setTimeout(loop, S.detector ? 60 : 90);
  }

  async function onCode(text) {
    const p = M.parseQr(text);
    const key = p.id + '.' + p.code;
    if (key === S.cooldown.id && Date.now() < S.cooldown.until) return;   // même QR encore devant la caméra
    S.scanning = false;
    S.cooldown = { id: key, until: Date.now() + 4000 };
    const g = S.byId.get(p.id);
    if (!g) return showAlert('unknown', null, text);
    if (S.event.requireSecret && g.h) {
      const h = p.code ? await M.sha16(g.id + '.' + p.code) : '';
      if (h !== g.h) return showAlert('invalid', g);
    }
    if (g.present) return showAlert('already', g);
    checkinLocal(g, 'scan');
    showCard(g);
  }

  async function toggleTorch() {
    try {
      const t = S.stream.getVideoTracks()[0];
      S.torch = !S.torch;
      await t.applyConstraints({ advanced: [{ torch: S.torch }] });
    } catch (e) {}
  }

  function goSearch() {
    if (S.view === 'scanner') closeScanner();
    showHome();
    setTimeout(function () { $('q').focus(); }, 50);
  }

  /* ===================== Son & vibration ===================== */
  let actx = null;
  function beep(freq, dur, at) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = freq; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, actx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.35, actx.currentTime + at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + at + dur);
      o.connect(g); g.connect(actx.destination);
      o.start(actx.currentTime + at); o.stop(actx.currentTime + at + dur + 0.02);
    } catch (e) {}
  }
  function feedback(kind) {
    if (kind === 'ok') { beep(1046, 0.12, 0); beep(1568, 0.16, 0.1); if (navigator.vibrate) navigator.vibrate(60); }
    else { beep(220, 0.2, 0); beep(196, 0.28, 0.24); if (navigator.vibrate) navigator.vibrate([120, 80, 120]); }
  }

  /* ===================== Nom de l'appareil ===================== */
  function askDevice(first) {
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = '<div class="box glass"><h3>Nom de cet appareil</h3><p>' +
      (first ? 'Il apparaîtra dans le Google Sheet et dans les alertes « déjà scanné ». ' : '') +
      'Exemple : Entrée-1, Entrée-2, Hôtesse Marie…</p><input id="devInput" maxlength="30" value="' + M.esc(S.device || 'Entrée-1') + '">' +
      '<button class="btn-main" id="devSave">Enregistrer</button></div>';
    document.body.appendChild(m);
    const inp = $('devInput'); inp.select();
    $('devSave').onclick = function () {
      const v = inp.value.trim(); if (!v) return;
      S.device = v; M.ls.set('momento_device', v); refreshCounts(); m.remove();
    };
  }

  /* ===================== Événements UI ===================== */
  $('btnScan').onclick = openScanner;
  $('scanClose').onclick = closeScanner;
  $('scanSearch').onclick = goSearch;
  $('torch').onclick = toggleTorch;
  $('btnSync').onclick = function () { sync(true); };
  $('btnDevice').onclick = function () { askDevice(false); };
  $('q').addEventListener('input', renderResults);
  $('qClear').onclick = function (e) { e.preventDefault(); $('q').value = ''; renderResults(); $('q').focus(); };
  $('results').addEventListener('click', function (e) {
    const b = e.target.closest('.res'); if (b) pickGuest(b.dataset.id);
  });
  window.addEventListener('online', function () { sync(); });
  window.addEventListener('offline', function () { setOnline(false); });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && S.view === 'scanner') { S.scanning = false; if (S.stream) { S.stream.getTracks().forEach(function (t) { t.stop(); }); S.stream = null; } }
    else if (!document.hidden && S.view === 'scanner' && $('sheet').hidden) openScanner();
    if (!document.hidden) sync();
  });

  // Accès pour les tests
  window.__momento = { S: S, onCode: onCode, sync: sync };
  init();
})();
