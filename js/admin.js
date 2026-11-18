/* Momento Scanner — espace administrateur */
(function () {
  'use strict';
  const M = window.Momento;
  const $ = function (id) { return document.getElementById(id); };
  const A = { pw: sessionStorage.getItem('momento_admin_pw') || '', events: [], current: null, images: {}, imgShown: {} };

  /* ---------- Connexion ---------- */
  if (M.isDemo) $('loginHint').innerHTML = 'Mode démo (aucun script relié) : mot de passe <b>demo</b>.';
  $('loginForm').onsubmit = async function (e) {
    e.preventDefault();
    $('loginErr').textContent = '';
    try {
      await M.api.post({ action: 'admin_login', password: $('pw').value });
      A.pw = $('pw').value;
      sessionStorage.setItem('momento_admin_pw', A.pw);
      showDash();
    } catch (err) { $('loginErr').textContent = err.server ? err.message : 'Connexion impossible : ' + err.message; }
  };
  function call(body) { body.password = A.pw; return M.api.post(body); }

  /* ---------- Liste ---------- */
  function scannerLink(id) { return new URL('index.html?e=' + encodeURIComponent(id), location.href).href; }

  async function showDash() {
    $('login').hidden = true; $('edit').hidden = true; $('dash').hidden = false;
    $('list').innerHTML = '<div class="empty-list">Chargement…</div>';
    try {
      const r = await call({ action: 'admin_list' });
      A.events = r.events;
      renderList();
    } catch (err) {
      if (/mot de passe/i.test(err.message)) { sessionStorage.removeItem('momento_admin_pw'); location.reload(); }
      $('list').innerHTML = '<div class="empty-list">Erreur : ' + M.esc(err.message) + '</div>';
    }
  }
  function renderList() {
    if (!A.events.length) {
      $('list').innerHTML = '<div class="empty-list">Aucun mariage pour l\'instant.<br>Cliquez sur « + Nouveau mariage » pour créer le premier lien de scanner.</div>';
      return;
    }
    $('list').innerHTML = A.events.map(function (e) {
      const link = scannerLink(e.id);
      return '<div class="evt glass"><h3>' + M.esc(e.name) + '</h3><div class="d">' + M.esc(M.formatDate(e.date, 'long') || 'Date non définie') +
        (e.requireSecret ? ' · 🔒 code secret' : '') + '</div><div class="link">' + M.esc(link) + '</div><div class="btns">' +
        '<button class="btn-sec" data-copy="' + M.esc(link) + '">Copier le lien</button>' +
        '<a class="btn-sec" href="' + M.esc(link) + '" target="_blank">Ouvrir</a>' +
        '<button class="btn-pri" data-edit="' + M.esc(e.id) + '">Modifier</button></div></div>';
    }).join('');
  }
  $('list').addEventListener('click', function (e) {
    const c = e.target.closest('[data-copy]'), ed = e.target.closest('[data-edit]');
    if (c) copy(c.dataset.copy);
    if (ed) openEdit(ed.dataset.edit);
  });
  $('btnNew').onclick = function () { openEdit(null); };
  $('btnBack').onclick = showDash;

  /* ---------- Formulaire ---------- */
  const form = $('form');
  Object.keys(M.POLICES).forEach(function (k) { form.dateFont.add(new Option(M.POLICES[k].label, k)); });
  Object.keys(M.FORMATS).forEach(function (k) { form.dateFormat.add(new Option(M.FORMATS[k], k)); });

  async function openEdit(id) {
    $('dash').hidden = true; $('edit').hidden = false; $('result').hidden = true;
    window.scrollTo(0, 0);
    A.current = null; A.images = {}; A.imgShown = { logo: '', background: '' };
    form.reset();
    form.tab.value = 'Invites'; form.dateFont.value = 'script'; form.dateFormat.value = 'long';
    form.dateColor.value = '#f3d9b8'; form.accent.value = '#c9925f';
    $('editTitle').textContent = id ? 'Chargement…' : 'Nouveau mariage';
    $('btnDelete').hidden = !id; $('btnSecrets').hidden = !id; $('secretsInfo').textContent = '';
    if (id) {
      try {
        const r = await call({ action: 'admin_get', id: id });
        const e = r.event; A.current = e;
        ['name', 'sheetUrl', 'tab', 'date', 'dateFont', 'dateFormat', 'dateColor', 'accent'].forEach(function (k) { if (e[k]) form[k].value = e[k]; });
        form.requireSecret.checked = !!e.requireSecret;
        A.imgShown = { logo: r.images.logo || '', background: r.images.background || '' };
        $('editTitle').textContent = e.name;
        showResultLink(e.id);
      } catch (err) { toast(err.message, true); }
    }
    renderImages(); preview();
  }

  form.addEventListener('input', preview);
  function preview() {
    const evt = { date: form.date.value || '2026-12-12', dateFont: form.dateFont.value, dateFormat: form.dateFormat.value, dateColor: form.dateColor.value };
    M.applyDateStyle($('pvDate'), evt);
    document.documentElement.style.setProperty('--accent', form.accent.value);
    $('pvBg').style.backgroundImage = A.imgShown.background ? 'url("' + A.imgShown.background + '")' : '';
    $('pvLogo').hidden = !A.imgShown.logo; if (A.imgShown.logo) $('pvLogo').src = A.imgShown.logo;
  }

  /* ---------- Images (redimensionnées dans le navigateur) ---------- */
  document.querySelectorAll('input[data-img]').forEach(function (inp) {
    inp.addEventListener('change', async function () {
      const f = inp.files[0]; if (!f) return;
      const kind = inp.dataset.img;
      try {
        const url = await resize(f, kind === 'logo' ? 600 : 1400, kind === 'logo' ? 'image/png' : 'image/jpeg');
        A.images[kind] = url; A.imgShown[kind] = url;
        renderImages(); preview();
      } catch (e) { toast('Image illisible', true); }
      inp.value = '';
    });
  });
  function resize(file, max, type) {
    return new Promise(function (res, rej) {
      const img = new Image();
      img.onload = function () {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        res(c.toDataURL(type, 0.82));
      };
      img.onerror = rej;
      img.src = URL.createObjectURL(file);
    });
  }
  function renderImages() {
    [['logo', 'logoBox'], ['background', 'bgBox']].forEach(function (p) {
      const box = $(p[1]), url = A.imgShown[p[0]];
      box.style.backgroundImage = url ? 'url("' + url + '")' : '';
      box.innerHTML = url ? '<button type="button" class="rm" data-rm="' + p[0] + '">Retirer</button>' : 'Choisir une image';
    });
  }
  document.addEventListener('click', function (e) {
    const rm = e.target.closest('[data-rm]');
    if (!rm) return;
    e.preventDefault();
    A.images[rm.dataset.rm] = null; A.imgShown[rm.dataset.rm] = '';
    renderImages(); preview();
  });

  /* ---------- Enregistrer ---------- */
  form.onsubmit = async function (e) {
    e.preventDefault();
    const btn = $('btnSave'); btn.disabled = true; btn.textContent = 'Vérification du Google Sheet…';
    const data = {};
    ['name', 'sheetUrl', 'tab', 'date', 'dateFont', 'dateFormat', 'dateColor', 'accent'].forEach(function (k) { data[k] = form[k].value.trim(); });
    data.requireSecret = form.requireSecret.checked;
    if (A.current) data.id = A.current.id;
    try {
      const r = await call({ action: 'admin_save', event: data, images: A.images });
      A.current = r.event; A.images = {};
      $('editTitle').textContent = r.event.name;
      $('btnDelete').hidden = false; $('btnSecrets').hidden = false;
      showResultLink(r.event.id, r);
      toast('Mariage enregistré');
    } catch (err) {
      toast(err.message, true);
    } finally { btn.disabled = false; btn.textContent = 'Enregistrer'; }
  };

  function showResultLink(id, r) {
    const link = scannerLink(id);
    const box = $('result');
    box.hidden = false;
    box.innerHTML = (r ? '<b>✓ Google Sheet relié :</b> ' + r.guestCount + ' invités trouvés, ' + r.presentCount + ' déjà présents' +
      (r.secretsCount ? ', ' + r.secretsCount + ' codes secrets' : '') + '.<br>' : '') +
      '<b>Lien du scanner à envoyer aux hôtesses :</b><div class="link">' + M.esc(link) + '</div>' +
      '<button type="button" class="btn-sec" data-copy="' + M.esc(link) + '">Copier le lien</button> ' +
      '<a class="btn-sec" style="display:inline-block;text-decoration:none;color:inherit" href="' + M.esc(link) + '" target="_blank">Ouvrir le scanner</a>' +
      '<img width="170" height="170" alt="QR du lien" src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=0&data=' + encodeURIComponent(link) + '">' +
      '<div class="help" style="margin-top:6px">Les hôtesses peuvent scanner ce QR pour ouvrir le scanner sur leur téléphone.</div>';
    box.querySelector('[data-copy]').onclick = function () { copy(link); };
  }

  /* ---------- Codes secrets ---------- */
  $('btnSecrets').onclick = async function () {
    if (!A.current) return;
    if (!window.confirm('Générer un code secret pour chaque invité et mettre à jour les liens de la colonne QR_Code ?\n\n' +
      'Les QR codes changent : à faire AVANT d\'envoyer les invitations. Les invités ayant déjà un code le gardent.')) return;
    const b = $('btnSecrets'); b.disabled = true;
    try {
      const r = await call({ action: 'admin_secrets', id: A.current.id });
      form.requireSecret.checked = true;
      $('secretsInfo').innerHTML = '✓ ' + r.created + ' nouveaux codes créés (' + r.total + ' invités). La colonne QR_Code contient maintenant les nouveaux liens, et l\'option « Exiger le code secret » est activée.';
    } catch (err) { toast(err.message, true); }
    b.disabled = false;
  };

  $('btnDelete').onclick = async function () {
    if (!A.current || !window.confirm('Supprimer « ' + A.current.name + ' » ? Le lien du scanner ne fonctionnera plus. Le Google Sheet n\'est pas modifié.')) return;
    try { await call({ action: 'admin_delete', id: A.current.id }); toast('Mariage supprimé'); showDash(); }
    catch (err) { toast(err.message, true); }
  };

  /* ---------- Outils ---------- */
  function copy(t) {
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { toast('Lien copié'); }, function () {
      window.prompt('Copiez le lien :', t);
    });
  }
  function toast(msg, err) {
    const t = document.createElement('div');
    t.className = 'toast' + (err ? ' err' : '');
    t.textContent = msg;
    $('toasts').appendChild(t);
    setTimeout(function () { t.remove(); }, err ? 6000 : 3000);
  }

  if (A.pw) showDash();
})();
