/**
 * MOMENTO SCANNER — Script central (Google Apps Script)
 * -----------------------------------------------------
 * Un seul script pour tous les mariages.
 *  - Le scanner (application web) lit la liste des invités et enregistre les présences.
 *  - L'espace administrateur crée un mariage, le relie à un Google Sheet,
 *    et stocke le logo et la photo de fond.
 *
 * INSTALLATION : voir le guide. En résumé :
 *  1. Remplacez MOT_DE_PASSE_ADMIN ci-dessous.
 *  2. Déployer > Nouveau déploiement > Application Web
 *     Exécuter en tant que : Moi    |    Accès : Tout le monde
 *  3. Copiez l'URL /exec dans le fichier config.js de l'application.
 */

const MOT_DE_PASSE_ADMIN = 'changez-moi';      // <-- À MODIFIER
const DOSSIER_IMAGES = 'Momento Scanner - images';
const TEXTE_PRESENT = 'Présent';

/* Colonnes reconnues dans le Google Sheet (noms comparés sans accents/majuscules/espaces) */
const COLONNES = {
  id:     ['idinvitation', 'id', 'idinvite', 'numeroinvitation'],
  name:   ['nominvite', 'nom', 'invite', 'nomcomplet'],
  table:  ['numerotable', 'table', 'nomtable'],
  qr:     ['qrcode', 'qr', 'lienqr'],
  status: ['statutpresence', 'statut', 'presence'],
  time:   ['heurescan', 'heure'],
  device: ['appareilscan', 'appareil'],
  mode:   ['modeentree', 'mode'],
  code:   ['codesecret', 'code']
};
/* Colonnes créées automatiquement si absentes */
const COLONNES_A_CREER = { status: 'Statut_Presence', time: 'Heure_scan', device: 'Appareil_scan', mode: 'Mode_entree' };

/* ======================= POINTS D'ENTRÉE ======================= */

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    switch (p.action) {
      case 'data':   return json_(getData_(p.e));
      case 'images': return json_(getImages_(p.e));
      case 'ping':   return json_({ ok: true, time: new Date().toISOString() });
      default:       return json_({ ok: true, service: 'Momento Scanner' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents || '{}'); } catch (x) {}
  try {
    if (body.action === 'checkin') return json_(checkin_(body));
    if (String(body.action || '').indexOf('admin_') === 0) {
      if (!isAdmin_(body.password)) return json_({ ok: false, error: 'Mot de passe incorrect' });
      switch (body.action) {
        case 'admin_login':   return json_({ ok: true });
        case 'admin_list':    return json_({ ok: true, events: listEvents_() });
        case 'admin_get':     return json_({ ok: true, event: getEvent_(body.id), images: getImages_(body.id) });
        case 'admin_save':    return json_(saveEvent_(body.event, body.images || {}));
        case 'admin_delete':  return json_(deleteEvent_(body.id));
        case 'admin_secrets': return json_(generateSecrets_(body.id));
      }
    }
    return json_({ ok: false, error: 'Action inconnue' });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

/* ======================= SCANNER ======================= */

function getData_(eventId) {
  const evt = getEvent_(eventId);
  const g = openGuestSheet_(evt, false);
  return { ok: true, event: publicEvent_(evt), guests: readGuests_(g), serverTime: new Date().toISOString() };
}

function getImages_(eventId) {
  const evt = getEvent_(eventId);
  return { ok: true, updatedAt: evt.updatedAt, logo: fileToDataUrl_(evt.logoFileId), background: fileToDataUrl_(evt.bgFileId) };
}

/**
 * Enregistre une ou plusieurs présences. Le premier scan gagne toujours :
 * si l'invité est déjà marqué présent, on renvoie l'heure et l'appareil d'origine.
 */
function checkin_(body) {
  const evt = getEvent_(body.e);
  const items = body.items || [];
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const g = openGuestSheet_(evt, true);
    const n = g.lastRow - g.headerRow;
    const width = g.sheet.getLastColumn();
    const values = n > 0 ? g.sheet.getRange(g.headerRow + 1, 1, n, width).getDisplayValues() : [];
    const rowById = {};
    values.forEach(function (r, i) {
      const id = normId_(r[g.cols.id - 1]);
      if (id) rowById[id] = i;
    });
    const results = items.map(function (it) {
      const id = normId_(it.id);
      if (!(id in rowById)) return { id: id, result: 'unknown', ref: it.ref };
      const i = rowById[id];
      const r = values[i];
      if (isPresent_(r[g.cols.status - 1])) {
        return { id: id, result: 'already', ref: it.ref,
                 time: r[g.cols.time - 1], device: r[g.cols.device - 1], mode: r[g.cols.mode - 1] };
      }
      const row = g.headerRow + 1 + i;
      const time = String(it.time || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HH:mm:ss'));
      const device = String(it.device || '?').slice(0, 40);
      const mode = it.mode === 'manuel' ? 'Manuel' : 'Scan';
      setText_(g.sheet, row, g.cols.status, TEXTE_PRESENT);
      setText_(g.sheet, row, g.cols.time, time);
      setText_(g.sheet, row, g.cols.device, device);
      setText_(g.sheet, row, g.cols.mode, mode);
      r[g.cols.status - 1] = TEXTE_PRESENT; r[g.cols.time - 1] = time;
      r[g.cols.device - 1] = device;        r[g.cols.mode - 1] = mode;
      return { id: id, result: 'ok', ref: it.ref, time: time, device: device, mode: mode };
    });
    SpreadsheetApp.flush();
    return { ok: true, results: results };
  } finally {
    lock.releaseLock();
  }
}

function setText_(sheet, row, col, val) {
  const r = sheet.getRange(row, col);
  try { r.setNumberFormat('@'); } catch (e) {}   // colonnes typées (Tableaux Google Sheets) : on ignore
  r.setValue(val);
}

/** "Présent", "present", "PRÉSENTE"… = présent. Une cellule vide ou "Absent" = pas encore arrivé. */
function isPresent_(v) {
  return normKey_(v).indexOf('present') === 0;
}

function readGuests_(g) {
  const n = g.lastRow - g.headerRow;
  if (n <= 0) return [];
  const width = g.sheet.getLastColumn();
  const values = g.sheet.getRange(g.headerRow + 1, 1, n, width).getDisplayValues();
  const c = g.cols;
  const out = [];
  values.forEach(function (r) {
    const id = normId_(r[c.id - 1]);
    if (!id) return;
    const code = c.code ? String(r[c.code - 1]).trim().toUpperCase() : '';
    out.push({
      id: id,
      name: c.name ? String(r[c.name - 1]).trim() : '',
      table: c.table ? String(r[c.table - 1]).trim() : '',
      present: c.status ? isPresent_(r[c.status - 1]) : false,
      time: c.time ? r[c.time - 1] : '',
      device: c.device ? r[c.device - 1] : '',
      mode: c.mode ? r[c.mode - 1] : '',
      // Le code secret n'est jamais envoyé en clair : seulement une empreinte.
      h: code ? secretHash_(id, code) : ''
    });
  });
  return out;
}

function secretHash_(id, code) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, id + '.' + code, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('').slice(0, 16);
}

/* ======================= GOOGLE SHEET ======================= */

function openGuestSheet_(evt, createMissing) {
  const ss = SpreadsheetApp.openById(evt.sheetId);
  let sheet = evt.tab ? ss.getSheetByName(evt.tab) : null;
  if (!sheet) sheet = ss.getSheets()[0];
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const top = sheet.getRange(1, 1, Math.min(10, Math.max(sheet.getLastRow(), 1)), lastCol).getDisplayValues();
  let headerRow = -1, cols = null;
  for (let i = 0; i < top.length; i++) {
    const m = mapHeaders_(top[i]);
    if (m.id) { headerRow = i + 1; cols = m; break; }
  }
  if (headerRow < 0) throw new Error('Colonne "ID_Invitation" introuvable dans l\'onglet "' + sheet.getName() + '"');
  if (createMissing) {
    let next = sheet.getLastColumn() + 1;
    Object.keys(COLONNES_A_CREER).forEach(function (k) {
      if (!cols[k]) {
        if (next > sheet.getMaxColumns()) sheet.insertColumnAfter(sheet.getMaxColumns());
        sheet.getRange(headerRow, next).setValue(COLONNES_A_CREER[k]);
        cols[k] = next++;
      }
    });
  }
  return { sheet: sheet, headerRow: headerRow, cols: cols, lastRow: sheet.getLastRow(), spreadsheet: ss };
}

function mapHeaders_(row) {
  const m = {};
  row.forEach(function (h, i) {
    const k = normKey_(h);
    if (!k) return;
    Object.keys(COLONNES).forEach(function (field) {
      if (!m[field] && COLONNES[field].indexOf(k) >= 0) m[field] = i + 1;
    });
  });
  return m;
}

/** Génère un code secret par invité (s'il n'en a pas) et met à jour les liens QR. */
function generateSecrets_(eventId) {
  const evt = getEvent_(eventId);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const g = openGuestSheet_(evt, true);
    const sh = g.sheet;
    if (!g.cols.code) {
      const col = sh.getLastColumn() + 1;
      if (col > sh.getMaxColumns()) sh.insertColumnAfter(sh.getMaxColumns());
      sh.getRange(g.headerRow, col).setValue('Code_secret');
      g.cols.code = col;
    }
    const n = g.lastRow - g.headerRow;
    if (n <= 0) return { ok: true, created: 0 };
    const ids = sh.getRange(g.headerRow + 1, g.cols.id, n, 1).getDisplayValues();
    const codes = sh.getRange(g.headerRow + 1, g.cols.code, n, 1).getDisplayValues();
    const qrs = g.cols.qr ? sh.getRange(g.headerRow + 1, g.cols.qr, n, 1).getDisplayValues() : null;
    let created = 0;
    for (let i = 0; i < n; i++) {
      const id = normId_(ids[i][0]);
      if (!id) continue;
      let code = String(codes[i][0]).trim().toUpperCase();
      if (!code) { code = randomCode_(6); codes[i][0] = code; created++; }
      if (qrs) qrs[i][0] = qrUrl_(qrs[i][0], id + '.' + code);
    }
    sh.getRange(g.headerRow + 1, g.cols.code, n, 1).setNumberFormat('@').setValues(codes);
    if (qrs) sh.getRange(g.headerRow + 1, g.cols.qr, n, 1).setValues(qrs);
    evt.requireSecret = true;
    evt.updatedAt = new Date().toISOString();
    PropertiesService.getScriptProperties().setProperty('evt_' + evt.id, JSON.stringify(evt));
    return { ok: true, created: created, total: n };
  } finally {
    lock.releaseLock();
  }
}

function qrUrl_(existing, data) {
  const enc = encodeURIComponent(data);
  existing = String(existing || '');
  if (/[?&]data=/.test(existing)) return existing.replace(/([?&]data=)[^&]*/, '$1' + enc);
  return 'https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=' + enc + '&format=png&.png';
}

function randomCode_(len) {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += a.charAt(Math.floor(Math.random() * a.length));
  return s;
}

/* ======================= ÉVÉNEMENTS (ADMIN) ======================= */

function getEvent_(id) {
  if (!id) throw new Error('Lien de scanner incomplet (identifiant de mariage manquant)');
  const raw = PropertiesService.getScriptProperties().getProperty('evt_' + id);
  if (!raw) throw new Error('Mariage introuvable. Vérifiez le lien du scanner.');
  return JSON.parse(raw);
}

function publicEvent_(evt) {
  return {
    id: evt.id, name: evt.name, date: evt.date, dateFont: evt.dateFont, dateFormat: evt.dateFormat,
    dateColor: evt.dateColor, accent: evt.accent, requireSecret: !!evt.requireSecret,
    hasLogo: !!evt.logoFileId, hasBackground: !!evt.bgFileId, updatedAt: evt.updatedAt
  };
}

function listEvents_() {
  const props = PropertiesService.getScriptProperties().getProperties();
  return Object.keys(props).filter(function (k) { return k.indexOf('evt_') === 0; })
    .map(function (k) { return JSON.parse(props[k]); })
    .sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
}

function saveEvent_(data, images) {
  if (!data || !data.name) throw new Error('Le nom du mariage est obligatoire');
  const sheetId = extractSheetId_(data.sheetUrl || data.sheetId || '');
  if (!sheetId) throw new Error('Lien Google Sheet invalide');
  const props = PropertiesService.getScriptProperties();
  let evt = {};
  if (data.id && props.getProperty('evt_' + data.id)) evt = JSON.parse(props.getProperty('evt_' + data.id));
  else evt = { id: randomCode_(10).toLowerCase(), createdAt: new Date().toISOString() };

  ['name', 'tab', 'date', 'dateFont', 'dateFormat', 'dateColor', 'accent'].forEach(function (k) {
    if (data[k] !== undefined) evt[k] = String(data[k]);
  });
  evt.requireSecret = !!data.requireSecret;
  evt.sheetId = sheetId;
  evt.sheetUrl = 'https://docs.google.com/spreadsheets/d/' + sheetId + '/edit';

  // Vérifie l'accès au sheet et crée les colonnes manquantes
  const g = openGuestSheet_(evt, true);
  evt.tab = g.sheet.getName();
  const guests = readGuests_(g);

  if (images.logo === null) { trashFile_(evt.logoFileId); evt.logoFileId = ''; }
  else if (images.logo) { trashFile_(evt.logoFileId); evt.logoFileId = saveImage_(images.logo, evt.id + '-logo'); }
  if (images.background === null) { trashFile_(evt.bgFileId); evt.bgFileId = ''; }
  else if (images.background) { trashFile_(evt.bgFileId); evt.bgFileId = saveImage_(images.background, evt.id + '-fond'); }

  evt.updatedAt = new Date().toISOString();
  props.setProperty('evt_' + evt.id, JSON.stringify(evt));
  return {
    ok: true, event: evt, guestCount: guests.length,
    secretsCount: guests.filter(function (x) { return x.h; }).length,
    presentCount: guests.filter(function (x) { return x.present; }).length
  };
}

function deleteEvent_(id) {
  const evt = getEvent_(id);
  trashFile_(evt.logoFileId); trashFile_(evt.bgFileId);
  PropertiesService.getScriptProperties().deleteProperty('evt_' + id);
  return { ok: true };
}

function extractSheetId_(s) {
  s = String(s).trim();
  const m = s.match(/\/d\/([a-zA-Z0-9-_]{20,})/);
  if (m) return m[1];
  return /^[a-zA-Z0-9-_]{20,}$/.test(s) ? s : '';
}

/* ======================= IMAGES (Google Drive) ======================= */

function imageFolder_() {
  const it = DriveApp.getFoldersByName(DOSSIER_IMAGES);
  return it.hasNext() ? it.next() : DriveApp.createFolder(DOSSIER_IMAGES);
}

function saveImage_(dataUrl, name) {
  const m = String(dataUrl).match(/^data:(image\/[a-z+]+);base64,(.+)$/);
  if (!m) throw new Error('Image invalide');
  const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], name);
  return imageFolder_().createFile(blob).getId();
}

function fileToDataUrl_(fileId) {
  if (!fileId) return '';
  try {
    const blob = DriveApp.getFileById(fileId).getBlob();
    return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
  } catch (e) { return ''; }
}

function trashFile_(fileId) {
  if (!fileId) return;
  try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) {}
}

/* ======================= OUTILS ======================= */

function isAdmin_(pw) {
  const stored = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD') || MOT_DE_PASSE_ADMIN;
  return pw && String(pw) === stored;
}

function normKey_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normId_(s) {
  return String(s || '').trim().toUpperCase();
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** À lancer une fois depuis l'éditeur pour autoriser l'accès à Sheets et Drive. */
function autoriser() {
  imageFolder_();
  try { SpreadsheetApp.openById('x'); } catch (e) {} // déclenche la demande d'accès à Google Sheets
  Logger.log('Autorisations OK. Vous pouvez maintenant déployer l\'application Web.');
}
