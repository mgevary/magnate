// main.js — app driver: screens, the game loop, bot scheduling,
// persistence. ES2018 / Safari 12.

import { newGame, dispatch, whatsPending } from './engine/game.js';
import { botDecide } from './ai/bot.js';
import { render, showToast } from './ui/render.js';
import { el, clear, qs } from './ui/dom.js';
import {
  showPlaySheet, showVetoSheet, showPaymentSheet, showDiscardSheet,
  showRearrangeSheet, showGameOverSheet, showOpponentSheet, showSheet, closeSheet
} from './ui/sheets.js';
import { animateEvents } from './ui/fx.js';
import {
  DIFF_KEYS, getActive, listProfiles, setActive, createProfile, deleteProfile,
  recordResult, exportActive, importProfile, recordSummary
} from './profile.js';
import { PERSONALITIES } from './ai/bot.js';
import {
  net, probeLan, connect, createRoom, joinRoom, startGame as netStart,
  rematch as netRematch, sendAction, refreshRooms, leaveRoom, disconnect
} from './net.js';
import { createHost, createJoiner, encodeSignal, decodeSignal, loadScript } from './p2p.js';
import { RULES_HTML } from './ui/rules.js';

var SAVE_KEY = 'magnate-save-v1';
var BOT_DELAY = 850;

var App = { state: null, botTimer: null, mode: 'solo' };

// Debug/testing hook (also handy over Web Inspector on the iPad).
window.MAGNATE = {
  getState: function () { return App.state; },
  act: function (action) { humanAct(action); },
  setBotDelay: function (ms) { BOT_DELAY = ms; },
  newGame: function (opps, diff) { startNew(opps || 2, diff || 'balanced'); },
  // Let the bot brain take one action for the human seat (testing only).
  auto: function () {
    var w = whatsPending(App.state);
    var mine = w ? w.player === 0 : (App.state.active === 0 && App.state.phase === 'main');
    if (!mine) return false;
    var a = botDecide(App.state, 0);
    humanAct(a || { type: 'endTurn' });
    return true;
  },
  // Network testing hooks
  netOpen: function (code) { openWifi(code || null); },
  netCreate: function (bots, diff) { createRoom(bots || 0, diff || 'balanced'); },
  netJoin: function (code) { joinRoom(code); },
  netStartGame: function () { netStart(); },
  netInfo: function () { return { room: net.room, rooms: net.rooms, connected: net.connected, mode: App.mode }; },
  netAuto: function () {
    if (App.mode !== 'net' || !App.state || App.state.winner !== null) return false;
    var w = whatsPending(App.state);
    var mine = w ? w.player === 0 : (App.state.active === 0 && App.state.phase === 'main');
    if (!mine) return false;
    var a = botDecide(App.state, 0);
    netAct(a || { type: 'endTurn' });
    return true;
  },
  // Device-to-device testing hooks (bypass the QR/camera exchange only)
  p2pHostCreate: function (bots, diff) {
    return loadScript('js/vendor/pako.js').then(function () {
      var host = createHost({ name: getActive().name, bots: bots || 0, diff: diff || 'balanced' });
      App.p2pHost = host;
      attachHost(host);
      return host.makeOffer();
    });
  },
  p2pHostAccept: function (answerCode) { return App.p2pHost.acceptAnswer(answerCode); },
  p2pHostStart: function () { App.p2pHost.start(); },
  p2pJoinDirect: function (offerCode) {
    return loadScript('js/vendor/pako.js').then(function () {
      return createJoiner(offerCode, getActive().name);
    }).then(function (res) {
      App.p2pJoiner = res.joiner;
      attachJoiner(res.joiner);
      return res.answerCode;
    });
  }
};

var BOT_NAMES = {
  easy: ['Penny', 'Louie', 'Daisy'],
  balanced: ['Victor', 'Greta', 'Sal'],
  shark: ['Vanderbilt', 'Astor', 'Rockford']
};

/* ── persistence ─────────────────────────────────────────────────── */

function save() {
  try {
    if (App.state && App.state.winner === null) {
      localStorage.setItem(SAVE_KEY, JSON.stringify(App.state));
    } else {
      localStorage.removeItem(SAVE_KEY);
    }
  } catch (e) { /* storage full/blocked — play on without saves */ }
}

function loadSave() {
  try {
    var raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    var s = JSON.parse(raw);
    if (s && s.players && s.winner === null) return s;
  } catch (e) { /* corrupted save */ }
  return null;
}

/* ── screens ─────────────────────────────────────────────────────── */

function showScreen(id) {
  ['screen-home', 'screen-game', 'screen-rules'].forEach(function (s) {
    qs('#' + s).style.display = s === id ? '' : 'none';
  });
}

function goHome() {
  stopBots();
  closeSheet();
  buildHome();
  showScreen('screen-home');
}

function diffLabel(key) {
  return PERSONALITIES[key] ? PERSONALITIES[key].label : key;
}

function recordLineFor(profile, diff) {
  var r = (profile.records && profile.records[diff]) || { w: 0, l: 0 };
  return r.w + 'W – ' + r.l + 'L';
}

function profileCard() {
  var prof = getActive();
  var sum = recordSummary(prof);
  var card = el('div', { class: 'profile-card' });
  card.appendChild(el('div', { class: 'profile-name', text: prof.name }));
  var recs = DIFF_KEYS.map(function (d) {
    return diffLabel(d) + ' ' + recordLineFor(prof, d);
  }).join('   ·   ');
  card.appendChild(el('div', { class: 'profile-recs', text: sum.games ? recs : 'No games recorded yet' }));
  card.appendChild(el('button', {
    class: 'btn btn-ghost profile-btn', text: 'Players & records ▸',
    onTap: showUsersSheet
  }));
  return card;
}

function buildHome() {
  var saved = loadSave();
  var box = clear(qs('#home-menu'));

  box.appendChild(profileCard());

  if (saved) {
    box.appendChild(el('button', {
      class: 'btn btn-primary btn-big', text: 'Continue game',
      onTap: function () { App.state = saved; startLoop(); }
    }));
  }

  var chosen = { opps: 2, diff: 'balanced' };

  box.appendChild(el('div', { class: 'home-label', text: 'Opponents' }));
  var segO = el('div', { class: 'seg' });
  [1, 2, 3].forEach(function (n) {
    segO.appendChild(el('button', {
      class: 'seg-btn' + (n === chosen.opps ? ' on' : ''), text: String(n),
      onTap: function (e) {
        chosen.opps = n;
        Array.prototype.forEach.call(segO.children, function (c, i) {
          c.className = 'seg-btn' + (i === n - 1 ? ' on' : '');
        });
      }
    }));
  });
  box.appendChild(segO);

  box.appendChild(el('div', { class: 'home-label', text: 'Difficulty' }));
  var diffs = [['easy', 'Easy'], ['balanced', 'Normal'], ['shark', 'Hard']];
  var segD = el('div', { class: 'seg' });
  diffs.forEach(function (d, di) {
    segD.appendChild(el('button', {
      class: 'seg-btn' + (d[0] === chosen.diff ? ' on' : ''), text: d[1],
      onTap: function () {
        chosen.diff = d[0];
        Array.prototype.forEach.call(segD.children, function (c, i) {
          c.className = 'seg-btn' + (i === di ? ' on' : '');
        });
      }
    }));
  });
  box.appendChild(segD);

  box.appendChild(el('button', {
    class: 'btn btn-primary btn-big', text: 'New game',
    onTap: function () { startNew(chosen.opps, chosen.diff); }
  }));
  box.appendChild(el('button', {
    class: 'btn btn-secondary btn-big', text: 'Play on WiFi (multiplayer)',
    onTap: function () { openWifi(null); }
  }));
  box.appendChild(el('button', {
    class: 'btn btn-secondary btn-big', text: 'Device-to-device (no server)',
    onTap: function () { showP2pSheet(); }
  }));
  box.appendChild(el('button', {
    class: 'btn btn-secondary btn-big', text: 'How to play',
    onTap: function () { showRules(); }
  }));
}

/* ── WiFi multiplayer ────────────────────────────────────────────── */

function openWifi(joinCode) {
  probeLan(function (info) {
    if (!info) {
      showSheet({
        title: 'Play on WiFi',
        sub: 'This copy isn’t being served by the Magnate WiFi server.',
        content: el('div', { class: 'sheet-hint', html:
          'To play multiplayer at home:<br><br>' +
          '1. On the Mac, run <b>npm run lan</b> in the magnate folder.<br>' +
          '2. It prints an address like <b>http://192.168.x.x:8330</b>.<br>' +
          '3. Open that address on every device on the same WiFi.<br><br>' +
          'The server referees the game — it never plays.' }),
        buttons: []
      });
      return;
    }
    connect(getActive().name, function () {
      wireNetHandlers();
      if (joinCode) { joinRoom(joinCode); return; } // room sheet appears on server reply
      showWifiLobby();
    });
  });
}

function wireNetHandlers() {
  net.onError = function (msg) { showToast(msg); };
  net.onDrop = function () {
    if (App.mode === 'net') {
      showToast('Connection lost — trying to rejoin…');
      setTimeout(function () {
        connect(getActive().name, function () { wireNetHandlers(); });
      }, 1500);
    }
  };
  net.onRoom = function (room) { showRoomSheet(room); };
  net.onState = function (view) {
    App.mode = 'net';
    App.sendActionFn = sendAction;
    App.isHost = !!(net.room && net.room.host);
    App.rematchFn = netRematch;
    App.leaveFn = leaveNetGame;
    App.state = view;
    closeSheet();
    showScreen('screen-game');
    netLoop();
  };
}

function showWifiLobby() {
  refreshRooms();
  var content = el('div', {});
  var listBox = el('div', {});
  content.appendChild(el('div', { class: 'group-label', text: 'Open rooms' }));
  content.appendChild(listBox);

  function renderRooms(roomsArr) {
    clear(listBox);
    if (!roomsArr.length) {
      listBox.appendChild(el('div', { class: 'sheet-hint', text: 'No rooms yet — create one below.' }));
    }
    roomsArr.forEach(function (r) {
      if (r.started) return;
      listBox.appendChild(el('button', {
        class: 'btn btn-row', onTap: function () { joinRoom(r.code); }
      }, [
        el('span', { class: 'btn-row-name', text: r.code + ' — ' + r.names.join(', ') }),
        el('span', { class: 'btn-row-sub', text: (r.humans + r.bots) + '/5' })
      ]));
    });
  }
  renderRooms(net.rooms);
  net.onRooms = renderRooms;

  var codeInput = el('input', { class: 'text-input', type: 'text', maxlength: '4', placeholder: 'CODE', autocapitalize: 'characters' });
  content.appendChild(el('div', { class: 'group-label', text: 'Join by code' }));
  content.appendChild(el('div', { class: 'profile-row' }, [
    codeInput,
    el('button', { class: 'btn btn-secondary', text: 'Join', onTap: function () { joinRoom(codeInput.value); } })
  ]));

  var chosen = { bots: 0, diff: 'balanced' };
  content.appendChild(el('div', { class: 'group-label', text: 'Create a room — bot seats' }));
  var segB = el('div', { class: 'seg' });
  [0, 1, 2, 3].forEach(function (nBots, bi) {
    segB.appendChild(el('button', {
      class: 'seg-btn' + (nBots === chosen.bots ? ' on' : ''), text: String(nBots),
      onTap: function () {
        chosen.bots = nBots;
        Array.prototype.forEach.call(segB.children, function (c, i) { c.className = 'seg-btn' + (i === bi ? ' on' : ''); });
      }
    }));
  });
  content.appendChild(segB);
  var segD = el('div', { class: 'seg' });
  [['easy', 'Easy'], ['balanced', 'Normal'], ['shark', 'Hard']].forEach(function (d, di) {
    segD.appendChild(el('button', {
      class: 'seg-btn' + (d[0] === chosen.diff ? ' on' : ''), text: d[1],
      onTap: function () {
        chosen.diff = d[0];
        Array.prototype.forEach.call(segD.children, function (c, i) { c.className = 'seg-btn' + (i === di ? ' on' : ''); });
      }
    }));
  });
  content.appendChild(segD);

  showSheet({
    title: 'Play on WiFi',
    sub: 'Playing as ' + getActive().name,
    content: content,
    buttons: [{ label: 'Create room', cls: 'btn-primary', onTap: function () { createRoom(chosen.bots, chosen.diff); } }],
    onCancel: function () { net.onRooms = null; disconnect(); }
  });
}

function showRoomSheet(room) {
  if (room.started) return; // state message will take over
  var content = el('div', {});

  content.appendChild(el('div', { class: 'room-code', text: room.code }));
  content.appendChild(el('div', { class: 'sheet-hint', text: 'Others on this WiFi can scan to join:' }));

  // QR of the join URL (vendored generator; typeNumber 0 = auto)
  try {
    var qr = window.qrcode(0, 'M');
    qr.addData(room.joinUrl);
    qr.make();
    var qrBox = el('div', { class: 'qr-box' });
    qrBox.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 2 });
    content.appendChild(qrBox);
  } catch (e) { /* QR lib missing — code entry still works */ }
  content.appendChild(el('div', { class: 'sheet-hint', text: room.joinUrl }));

  content.appendChild(el('div', { class: 'group-label', text: 'Seats' }));
  room.seats.forEach(function (s, i) {
    content.appendChild(el('div', { class: 'record-row' }, [
      el('span', { class: 'record-diff', text: s.name + (s.isBot ? ' (bot)' : '') + (i === room.youSeat ? ' — you' : '') }),
      el('span', { class: 'record-wl', text: s.isBot ? 'ready' : (s.connected ? 'ready' : 'away') })
    ]));
  });

  var buttons = [];
  if (room.host) {
    buttons.push({
      label: room.seats.length >= 2 ? 'Start game' : 'Waiting for players…',
      cls: 'btn-primary',
      disabled: room.seats.length < 2,
      onTap: function () { netStart(); }
    });
  } else {
    content.appendChild(el('div', { class: 'sheet-hint', text: 'Waiting for ' + room.seats[0].name + ' to start the game…' }));
  }
  showSheet({
    title: 'Room ' + room.code,
    content: content,
    buttons: buttons,
    cancelLabel: 'Leave room',
    onCancel: function () { leaveRoom(); showWifiLobby(); }
  });
}

/* ── device-to-device (serverless WebRTC) ────────────────────────── */

function qrEl(text) {
  var box = el('div', { class: 'qr-box qr-dense' });
  try {
    var qr = window.qrcode(0, 'L');
    qr.addData(text);
    qr.make();
    box.innerHTML = qr.createSvgTag({ cellSize: 3, margin: 2 });
  } catch (e) {
    box.appendChild(el('div', { class: 'sheet-hint', text: 'Code too large for QR — use copy/paste below.' }));
  }
  return box;
}

function loadP2pLibs(cb) {
  loadScript('js/vendor/pako.js').then(function () { cb(null); })
    .catch(function (e) { cb(e); });
}

function showP2pSheet() {
  var content = el('div', {});
  content.appendChild(el('div', { class: 'sheet-hint', html:
    'Direct device-to-device play — <b>no server, no internet</b>. Both devices just need to be on the same WiFi network or one phone’s Personal Hotspot.<br><br>' +
    '<b>To join a game:</b> scan the host’s QR with your camera app.' }));
  showSheet({
    title: 'Device-to-device',
    content: content,
    buttons: [{
      label: 'Host a game', cls: 'btn-primary',
      onTap: function () { showP2pHostConfig(); }
    }]
  });
}

function showP2pHostConfig() {
  var chosen = { bots: 0, diff: 'balanced' };
  var content = el('div', {});
  content.appendChild(el('div', { class: 'group-label', text: 'Bot seats' }));
  var segB = el('div', { class: 'seg' });
  [0, 1, 2, 3].forEach(function (nBots, bi) {
    segB.appendChild(el('button', {
      class: 'seg-btn' + (nBots === chosen.bots ? ' on' : ''), text: String(nBots),
      onTap: function () {
        chosen.bots = nBots;
        Array.prototype.forEach.call(segB.children, function (c, i) { c.className = 'seg-btn' + (i === bi ? ' on' : ''); });
      }
    }));
  });
  content.appendChild(segB);
  var segD = el('div', { class: 'seg' });
  [['easy', 'Easy'], ['balanced', 'Normal'], ['shark', 'Hard']].forEach(function (d, di) {
    segD.appendChild(el('button', {
      class: 'seg-btn' + (d[0] === chosen.diff ? ' on' : ''), text: d[1],
      onTap: function () {
        chosen.diff = d[0];
        Array.prototype.forEach.call(segD.children, function (c, i) { c.className = 'seg-btn' + (i === di ? ' on' : ''); });
      }
    }));
  });
  content.appendChild(segD);
  showSheet({
    title: 'Host a game',
    content: content,
    buttons: [{
      label: 'Create invite', cls: 'btn-primary',
      onTap: function () {
        loadP2pLibs(function (err) {
          if (err) { showToast('Could not load connection code library.'); return; }
          startP2pHost(chosen.bots, chosen.diff);
        });
      }
    }]
  });
}

function attachHost(host) {
  App.mode = 'net';
  App.isHost = true;
  App.sendActionFn = function (a) { host.localAction(a); };
  App.rematchFn = function () { host.rematch(); };
  App.leaveFn = function () { host.destroy(); App.p2pHost = null; App.mode = 'solo'; App.state = null; goHome(); };
  host.onState = function (state) {
    App.state = state;
    closeSheet();
    showScreen('screen-game');
    netLoop();
  };
  host.onError = function (msg) { showToast(msg); };
}

function attachJoiner(joiner) {
  App.mode = 'net';
  App.isHost = false;
  App.sendActionFn = function (a) { joiner.send(a); };
  App.rematchFn = null;
  App.leaveFn = function () { joiner.destroy(); App.p2pJoiner = null; App.mode = 'solo'; App.state = null; goHome(); };
  joiner.onState = function (view) {
    App.state = view;
    closeSheet();
    showScreen('screen-game');
    netLoop();
  };
  joiner.onError = function (msg) { showToast(msg); };
  joiner.onClose = function () {
    if (App.mode === 'net') {
      showSheet({
        title: 'Connection lost',
        sub: 'The host went away.',
        noCancel: true,
        buttons: [{ label: 'Home', cls: 'btn-primary', onTap: function () { closeSheet(); App.leaveFn(); } }]
      });
    }
  };
}

function startP2pHost(bots, diff) {
  var host = createHost({ name: getActive().name, bots: bots, diff: diff });
  App.p2pHost = host;
  attachHost(host);
  showP2pHostLobby(host);
}

function showP2pHostLobby(host) {
  host.makeOffer().then(function (offerCode) {
    var joinUrl = window.location.origin + window.location.pathname + '#p2p=' + offerCode;
    var content = el('div', {});
    content.appendChild(el('div', { class: 'group-label', text: 'Players' }));
    host.seatNames().forEach(function (n, i) {
      content.appendChild(el('div', { class: 'record-row' }, [
        el('span', { class: 'record-diff', text: n + (i === 0 ? ' — you (host)' : '') }),
        el('span', { class: 'record-wl', text: 'ready' })
      ]));
    });
    content.appendChild(el('div', { class: 'group-label', text: 'Invite the next player' }));
    content.appendChild(el('div', { class: 'sheet-hint', text: '1. They scan this with their camera app:' }));
    content.appendChild(qrEl(joinUrl));
    content.appendChild(el('div', { class: 'sheet-hint', text: '2. Their screen will show an answer QR — tap below to scan it with this device’s camera.' }));

    var pasteTa = el('textarea', { class: 'text-area', placeholder: 'No camera? Paste their answer code here instead.' });

    function acceptCode(code) {
      code = String(code || '').replace(/\s+/g, '');
      var m2 = /p2p-ans=([A-Za-z0-9_-]+)/.exec(code);
      if (m2) code = m2[1];
      try {
        host.acceptAnswer(code).then(function () {
          showToast('Player connected!');
          showP2pHostLobby(host); // fresh invite for the next player
        }).catch(function (e) { showToast(e.message); });
      } catch (e) { showToast(e.message); }
    }

    content.appendChild(pasteTa);

    var canStart = host.peers.length + host.cfg.bots >= 1;
    showSheet({
      title: 'Device-to-device game',
      content: content,
      buttons: [
        {
          label: 'Scan answer with camera', cls: 'btn-secondary',
          onTap: function () { openScanner(acceptCode, function () { showP2pHostLobby(host); }); }
        },
        {
          label: 'Use pasted answer', cls: 'btn-secondary',
          onTap: function () { if (pasteTa.value) acceptCode(pasteTa.value); }
        },
        {
          label: canStart ? 'Start game' : 'Start game (add a player or bot first)',
          cls: 'btn-primary', disabled: !canStart,
          onTap: function () {
            try { host.start(); } catch (e) { showToast(e.message); }
          }
        }
      ],
      cancelLabel: 'Cancel game',
      onCancel: function () { App.leaveFn(); }
    });
  }).catch(function (e) {
    showToast('Could not create invite: ' + e.message);
  });
}

function startP2pJoin(offerCode) {
  loadP2pLibs(function (err) {
    if (err) { showToast('Could not load connection code library.'); return; }
    createJoiner(offerCode, getActive().name).then(function (res) {
      App.p2pJoiner = res.joiner;
      attachJoiner(res.joiner);
      var content = el('div', {});
      content.appendChild(el('div', { class: 'sheet-hint', text: 'Show this answer QR to the host — they scan it with their camera to let you in.' }));
      content.appendChild(qrEl('p2p-ans=' + res.answerCode));
      var ta = el('textarea', { class: 'text-area', readonly: 'readonly' });
      ta.value = res.answerCode;
      ta.addEventListener('click', function () { ta.select(); });
      content.appendChild(el('div', { class: 'sheet-hint', text: '…or send them this code:' }));
      content.appendChild(ta);
      var panel = showSheet({
        title: 'Almost in!',
        content: content,
        buttons: [],
        cancelLabel: 'Cancel',
        onCancel: function () { App.leaveFn(); }
      });
      res.joiner.onOpen = function () {
        var body = panel.querySelector('.sheet-body');
        if (body) {
          clear(body);
          body.appendChild(el('div', { class: 'sheet-hint', text: '✔ Connected — waiting for the host to start the game…' }));
        }
      };
    }).catch(function (e) {
      showSheet({
        title: 'Couldn’t join',
        sub: e.message,
        buttons: [{ label: 'OK', cls: 'btn-primary', onTap: closeSheet }]
      });
    });
  });
}

/* camera QR scanner (host side) */
function openScanner(onCode, onCancel) {
  loadScript('js/vendor/jsqr.js').then(function () {
    var video = document.createElement('video');
    video.setAttribute('playsinline', 'true');
    video.setAttribute('muted', 'true');
    video.setAttribute('autoplay', 'true');
    video.className = 'scan-video';
    var content = el('div', { class: 'scan-wrap' }, [video]);
    var stream = null, timer = null, closed = false;

    function stop() {
      closed = true;
      if (timer) clearInterval(timer);
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    }

    showSheet({
      title: 'Scan the answer QR',
      content: content,
      buttons: [],
      cancelLabel: 'Cancel',
      onCancel: function () { stop(); if (onCancel) onCancel(); }
    });

    var gum = navigator.mediaDevices && navigator.mediaDevices.getUserMedia
      ? navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      : Promise.reject(new Error('no camera API'));

    gum.then(function (s) {
      if (closed) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
      stream = s;
      video.srcObject = s;
      video.play();
      var canvas = document.createElement('canvas');
      var ctx = canvas.getContext('2d');
      timer = setInterval(function () {
        if (!video.videoWidth) return;
        var w = 400, h = Math.round(400 * video.videoHeight / video.videoWidth);
        canvas.width = w; canvas.height = h;
        ctx.drawImage(video, 0, 0, w, h);
        var img = ctx.getImageData(0, 0, w, h);
        var found = window.jsQR(img.data, w, h);
        if (found && found.data) {
          stop();
          closeSheet();
          onCode(found.data);
        }
      }, 280);
    }).catch(function () {
      stop();
      closeSheet();
      showSheet({
        title: 'Camera unavailable',
        sub: 'Use the paste box instead: have the joiner copy their answer code and send it to you (Messages/AirDrop), then paste it.',
        buttons: [{ label: 'OK', cls: 'btn-primary', onTap: function () { closeSheet(); if (onCancel) onCancel(); } }]
      });
    });
  }).catch(function () { showToast('Could not load the QR scanner.'); });
}

var netHandlers = {
  onHandCard: function (card) { showPlaySheet(App.state, card, netAct); },
  onTableCard: function (card, zone) { showRearrangeSheet(App.state, card, zone, netAct); },
  onEndTurn: function () { netAct({ type: 'endTurn' }); },
  onOpponent: function (idx) { showOpponentSheet(App.state, idx); }
};

function netAct(action) {
  closeSheet();
  // whichever transport is live (LAN server, p2p host, p2p joiner)
  if (App.sendActionFn) App.sendActionFn(action);
}

function netLoop() {
  var state = App.state;
  render(state, netHandlers);
  animateEvents(state);

  var logNow = state.log.length ? state.log[state.log.length - 1] : '';
  if (logNow && logNow !== App.lastNetLog && logNow.indexOf('— ') !== 0 && logNow.indexOf('You ') !== 0) {
    showToast(logNow);
  }
  App.lastNetLog = logNow;

  if (state.winner !== null) {
    var winner = state.players[state.winner];
    showSheet({
      title: state.winner === 0 ? '🏆 You win!' : winner.name + ' wins',
      sub: 'Multiplayer game complete.',
      noCancel: true,
      buttons: (App.isHost && App.rematchFn ? [{ label: 'Rematch', cls: 'btn-primary', onTap: function () { closeSheet(); App.rematchFn(); } }] : []).concat([
        { label: 'Leave', cls: 'btn-secondary', onTap: function () { closeSheet(); if (App.leaveFn) App.leaveFn(); } }
      ])
    });
    return;
  }

  var w = whatsPending(state);
  if (w && w.player === 0) {
    if (w.type === 'jsn') { showVetoSheet(state, w, netAct); return; }
    if (w.type === 'pay') { showPaymentSheet(state, w, netAct); return; }
    if (w.type === 'discard') { showDiscardSheet(state, w, netAct); return; }
  }
}

function leaveNetGame() {
  leaveRoom();
  disconnect();
  App.mode = 'solo';
  App.state = null;
  goHome();
}

function showRules() {
  qs('#rules-body').innerHTML = RULES_HTML;
  showScreen('screen-rules');
}

/* ── player profiles & records ───────────────────────────────────── */

function showUsersSheet() {
  var active = getActive();
  var content = el('div', {});

  // active player's record table
  content.appendChild(el('div', { class: 'group-label', text: 'Record — ' + active.name }));
  var table = el('div', { class: 'record-table' });
  DIFF_KEYS.forEach(function (d) {
    table.appendChild(el('div', { class: 'record-row' }, [
      el('span', { class: 'record-diff', text: 'vs ' + diffLabel(d) }),
      el('span', { class: 'record-wl', text: recordLineFor(active, d) })
    ]));
  });
  content.appendChild(table);

  // other profiles
  var others = listProfiles().filter(function (p) { return p.name !== active.name; });
  if (others.length) {
    content.appendChild(el('div', { class: 'group-label', text: 'Switch player' }));
    others.forEach(function (p) {
      var sum = recordSummary(p);
      var row = el('div', { class: 'profile-row' });
      row.appendChild(el('button', {
        class: 'btn btn-row profile-row-btn',
        onTap: function () { setActive(p.name); buildHome(); showUsersSheet(); }
      }, [
        el('span', { class: 'btn-row-name', text: p.name }),
        el('span', { class: 'btn-row-sub', text: sum.wins + ' wins / ' + sum.games + ' games' })
      ]));
      row.appendChild(el('button', {
        class: 'btn btn-ghost profile-del', text: '✕',
        onTap: function () {
          showSheet({
            title: 'Delete ' + p.name + '?',
            sub: 'Their record is gone unless you exported it.',
            buttons: [
              { label: 'Delete', cls: 'btn-secondary', onTap: function () { deleteProfile(p.name); buildHome(); showUsersSheet(); } },
              { label: 'Keep', cls: 'btn-primary', onTap: showUsersSheet }
            ],
            noCancel: true
          });
        }
      }));
      content.appendChild(row);
    });
  }

  // new profile
  content.appendChild(el('div', { class: 'group-label', text: 'New player' }));
  var nameInput = el('input', { class: 'text-input', type: 'text', maxlength: '24', placeholder: 'Name' });
  var newRow = el('div', { class: 'profile-row' }, [
    nameInput,
    el('button', {
      class: 'btn btn-secondary', text: 'Create',
      onTap: function () {
        var res = createProfile(nameInput.value);
        if (!res.ok) { showToast(res.error); return; }
        buildHome();
        showUsersSheet();
      }
    })
  ]);
  content.appendChild(newRow);

  showSheet({
    title: 'Players & records',
    content: content,
    buttons: [
      { label: 'Save record to a file…', cls: 'btn-secondary', onTap: showExportSheet },
      { label: 'Restore record from a file…', cls: 'btn-secondary', onTap: showImportSheet }
    ],
    cancelLabel: 'Done'
  });
}

function showExportSheet() {
  var prof = getActive();
  var json = exportActive();
  var content = el('div', {});
  var canDownload = 'download' in document.createElement('a');

  content.appendChild(el('div', {
    class: 'sheet-hint',
    text: canDownload
      ? 'Download the file, or copy the text below — either restores this record later.'
      : 'This iPad’s Safari can’t save files directly: tap the text below (it selects itself), Copy, and paste it somewhere safe — Notes, an email to yourself, or a file in the Files app. Restoring accepts the pasted text or the file.'
  }));
  var ta = el('textarea', { class: 'text-area', readonly: 'readonly' });
  ta.value = json;
  ta.addEventListener('click', function () { ta.select(); });
  content.appendChild(ta);

  var buttons = [];
  if (canDownload) {
    buttons.push({
      label: 'Download magnate-record-' + prof.name + '.json',
      cls: 'btn-primary',
      onTap: function () {
        try {
          var blob = new Blob([json], { type: 'application/json' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = 'magnate-record-' + prof.name + '.json';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        } catch (e) { showToast('Could not create the file — copy the text instead.'); }
      }
    });
  }
  showSheet({ title: 'Save ' + prof.name + '’s record', content: content, buttons: buttons, cancelLabel: 'Done', onCancel: showUsersSheet });
}

function showImportSheet() {
  var content = el('div', {});
  content.appendChild(el('div', { class: 'sheet-hint', text: 'Choose a saved record file, or paste the record text:' }));

  var file = el('input', { class: 'file-input', type: 'file', accept: '.json,.txt,application/json,text/plain' });
  var ta = el('textarea', { class: 'text-area', placeholder: '…or paste the record text here' });
  file.addEventListener('change', function () {
    if (!file.files || !file.files[0]) return;
    var reader = new FileReader();
    reader.onload = function () { ta.value = String(reader.result || ''); };
    reader.readAsText(file.files[0]);
  });
  content.appendChild(file);
  content.appendChild(ta);

  showSheet({
    title: 'Restore a record',
    sub: 'A record of the same player name is replaced.',
    content: content,
    buttons: [{
      label: 'Restore', cls: 'btn-primary',
      onTap: function () {
        var res = importProfile(ta.value);
        if (!res.ok) { showToast(res.error); return; }
        showToast('Restored ' + res.name + '’s record.');
        buildHome();
        showUsersSheet();
      }
    }],
    cancelLabel: 'Back',
    onCancel: showUsersSheet
  });
}

/* ── game lifecycle ──────────────────────────────────────────────── */

function startNew(oppCount, diff) {
  var names = BOT_NAMES[diff].slice(0, oppCount);
  var players = [{ name: 'You', isBot: false }];
  names.forEach(function (n) {
    players.push({ name: n, isBot: true, personality: diff });
  });
  App.state = newGame({ players: players });
  startLoop();
}

function startLoop() {
  showScreen('screen-game');
  closeSheet();
  loop();
}

function stopBots() {
  if (App.botTimer) { clearTimeout(App.botTimer); App.botTimer = null; }
}

/* ── the loop ────────────────────────────────────────────────────── */

var handlers = {
  onHandCard: function (card) {
    showPlaySheet(App.state, card, humanAct);
  },
  onTableCard: function (card, zone) {
    showRearrangeSheet(App.state, card, zone, humanAct);
  },
  onEndTurn: function () {
    humanAct({ type: 'endTurn' });
  },
  onOpponent: function (idx) {
    showOpponentSheet(App.state, idx);
  }
};

function humanAct(action) {
  closeSheet();
  try {
    dispatch(App.state, action);
  } catch (e) {
    showToast(e.message);
  }
  loop();
}

function loop() {
  var state = App.state;
  save();
  render(state, handlers);
  animateEvents(state);

  if (state.winner !== null) {
    stopBots();
    var diff = state.players[1] ? state.players[1].personality : 'balanced';
    if (!state.resultRecorded) {
      state.resultRecorded = true;
      recordResult(diff, state.winner === 0);
    }
    var prof = getActive();
    var line = prof.name + ' vs ' + diffLabel(diff) + ': ' + recordLineFor(prof, diff);
    showGameOverSheet(state, line,
      function () { closeSheet(); goHomeNew(); },
      function () { closeSheet(); goHome(); });
    return;
  }

  var w = whatsPending(state);
  var actor = w ? w.player : state.active;

  if (state.players[actor].isBot) {
    stopBots();
    App.botTimer = setTimeout(function () { botStep(actor); }, botDelayFor(state, w));
    return;
  }

  // Human input needed.
  if (!w) return; // main phase: hand/table taps + End turn are live
  if (w.type === 'jsn') { showVetoSheet(state, w, humanAct); return; }
  if (w.type === 'pay') { showPaymentSheet(state, w, humanAct); return; }
  if (w.type === 'discard') { showDiscardSheet(state, w, humanAct); return; }
}

function botDelayFor(state, w) {
  if (w && w.type === 'jsn') return 550;
  if (w && w.type === 'pay') return 700;
  return BOT_DELAY;
}

function goHomeNew() {
  // restart with the same lineup
  var state = App.state;
  var players = state.players.map(function (p) {
    return { name: p.name, isBot: p.isBot, personality: p.personality };
  });
  App.state = newGame({ players: players });
  startLoop();
}

function botStep(idx) {
  var state = App.state;
  var logBefore = state.log.length;
  var action = botDecide(state, idx);
  try {
    if (!action) {
      // Should not happen; keep the game moving.
      dispatch(state, { type: 'endTurn' });
    } else {
      dispatch(state, action);
    }
  } catch (e) {
    // A bot slipped on a rule — recover by ending its turn if possible.
    try { dispatch(state, { type: 'endTurn' }); } catch (e2) { showToast('Game error: ' + e.message); }
  }
  var fresh = state.log.slice(logBefore);
  if (fresh.length) {
    var interesting = fresh.filter(function (m) { return m.indexOf('— ') !== 0; });
    if (interesting.length) showToast(interesting[interesting.length - 1]);
  }
  loop();
}

/* ── boot ────────────────────────────────────────────────────────── */

// iOS Safari's 100% height includes the area behind its collapsing
// toolbars; track the real visible height instead so the hand is never
// hidden behind browser chrome.
function setVh() {
  try {
    document.documentElement.style.setProperty('--vh', window.innerHeight + 'px');
  } catch (e) { }
}

function boot() {
  setVh();
  window.addEventListener('resize', setVh);
  window.addEventListener('orientationchange', function () {
    setVh();
    setTimeout(setVh, 350); // Safari reports stale sizes right after rotate
  });
  qs('#rules-back').addEventListener('click', function () {
    if (App.state && App.state.winner === null) {
      showScreen('screen-game');
      loop(); // resume (bots may have been paused while reading)
    } else {
      showScreen('screen-home');
    }
  });
  qs('#game-rules-btn').addEventListener('click', function () { stopBots(); showRules(); });
  qs('#game-home-btn').addEventListener('click', function () {
    var isNet = App.mode === 'net';
    showSheet({
      title: 'Leave the game?',
      sub: isNet ? 'You can rejoin from this device while the room is open.' : 'Your game is saved — you can continue later.',
      buttons: [
        { label: 'Leave', cls: 'btn-secondary', onTap: function () { closeSheet(); if (isNet) leaveNetGame(); else goHome(); } },
        { label: 'Keep playing', cls: 'btn-primary', onTap: function () { closeSheet(); if (isNet) netLoop(); else loop(); } }
      ],
      noCancel: true
    });
  });

  // Deep link from a scanned room QR: http://<server>/#join=CODE
  var m = /join=([A-Za-z]{4})/.exec(window.location.hash || '');
  if (m) {
    try { window.history.replaceState(null, '', window.location.pathname); } catch (e) { window.location.hash = ''; }
    goHome();
    openWifi(m[1].toUpperCase());
    return;
  }
  // Deep link from a device-to-device invite QR: /#p2p=<code>
  var mp = /p2p=([A-Za-z0-9_-]+)/.exec(window.location.hash || '');
  if (mp) {
    try { window.history.replaceState(null, '', window.location.pathname); } catch (e) { window.location.hash = ''; }
    goHome();
    startP2pJoin(mp[1]);
    return;
  }
  goHome();
}

boot();
