// profile.js — local player profiles with win/loss records per
// difficulty, stored in localStorage, with export/import so a record can
// be saved as a file and restored later. ES2018 / Safari 12.

var KEY = 'magnate-profiles-v1';
export var DIFF_KEYS = ['easy', 'balanced', 'shark'];

function blankRecords() {
  return {
    easy: { w: 0, l: 0 },
    balanced: { w: 0, l: 0 },
    shark: { w: 0, l: 0 }
  };
}

function blankProfile(name) {
  return { name: name, created: new Date().toISOString(), records: blankRecords() };
}

function loadDb() {
  try {
    var raw = localStorage.getItem(KEY);
    if (raw) {
      var db = JSON.parse(raw);
      if (db && db.profiles) return db;
    }
  } catch (e) { /* corrupted — start fresh */ }
  var fresh = { active: 'Player 1', profiles: {} };
  fresh.profiles['Player 1'] = blankProfile('Player 1');
  return fresh;
}

function saveDb(db) {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* storage blocked */ }
}

export function getActive() {
  var db = loadDb();
  if (!db.profiles[db.active]) {
    var names = Object.keys(db.profiles);
    db.active = names.length ? names[0] : 'Player 1';
    if (!db.profiles[db.active]) db.profiles[db.active] = blankProfile(db.active);
    saveDb(db);
  }
  return db.profiles[db.active];
}

export function listProfiles() {
  var db = loadDb();
  return Object.keys(db.profiles).map(function (n) { return db.profiles[n]; });
}

export function setActive(name) {
  var db = loadDb();
  if (db.profiles[name]) { db.active = name; saveDb(db); }
}

export function createProfile(name) {
  name = (name || '').replace(/^\s+|\s+$/g, '').slice(0, 24);
  if (!name) return { ok: false, error: 'Enter a name.' };
  var db = loadDb();
  if (db.profiles[name]) return { ok: false, error: 'That name already exists.' };
  db.profiles[name] = blankProfile(name);
  db.active = name;
  saveDb(db);
  return { ok: true, name: name };
}

export function deleteProfile(name) {
  var db = loadDb();
  if (!db.profiles[name]) return;
  delete db.profiles[name];
  if (db.active === name) {
    var names = Object.keys(db.profiles);
    db.active = names.length ? names[0] : 'Player 1';
    if (!db.profiles[db.active]) db.profiles[db.active] = blankProfile(db.active);
  }
  saveDb(db);
}

export function recordResult(diff, won) {
  if (DIFF_KEYS.indexOf(diff) === -1) return;
  var db = loadDb();
  var p = db.profiles[db.active];
  if (!p) return;
  if (!p.records) p.records = blankRecords();
  if (!p.records[diff]) p.records[diff] = { w: 0, l: 0 };
  if (won) p.records[diff].w++; else p.records[diff].l++;
  saveDb(db);
}

/* ── export / import ─────────────────────────────────────────────── */

export function exportActive() {
  var p = getActive();
  return JSON.stringify({ magnateRecord: 1, exported: new Date().toISOString(), profile: p }, null, 2);
}

// Accepts the exported JSON text; creates/overwrites a profile of the
// same name and makes it active. Returns {ok, name} or {ok:false, error}.
export function importProfile(text) {
  var parsed;
  try { parsed = JSON.parse(text); } catch (e) {
    return { ok: false, error: 'That doesn’t look like a Magnate record file.' };
  }
  if (!parsed || parsed.magnateRecord !== 1 || !parsed.profile || typeof parsed.profile.name !== 'string') {
    return { ok: false, error: 'That doesn’t look like a Magnate record file.' };
  }
  var src = parsed.profile;
  var name = src.name.replace(/^\s+|\s+$/g, '').slice(0, 24);
  if (!name) return { ok: false, error: 'The record has no player name.' };
  var clean = blankProfile(name);
  if (typeof src.created === 'string') clean.created = src.created;
  DIFF_KEYS.forEach(function (d) {
    var r = src.records && src.records[d];
    if (r) {
      clean.records[d].w = Math.max(0, Math.floor(Number(r.w) || 0));
      clean.records[d].l = Math.max(0, Math.floor(Number(r.l) || 0));
    }
  });
  var db = loadDb();
  db.profiles[name] = clean;
  db.active = name;
  saveDb(db);
  return { ok: true, name: name };
}

export function recordSummary(profile) {
  var total = 0, wins = 0;
  DIFF_KEYS.forEach(function (d) {
    var r = (profile.records && profile.records[d]) || { w: 0, l: 0 };
    total += r.w + r.l;
    wins += r.w;
  });
  return { games: total, wins: wins };
}
