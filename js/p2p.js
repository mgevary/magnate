// p2p.js — serverless device-to-device multiplayer over WebRTC data
// channels. No server anywhere: signalling travels by QR code (the host
// shows an invite QR; the joiner's answer comes back as a QR the host
// scans). Works on any shared IP network — home WiFi or a phone's
// Personal Hotspot — with no internet access needed.
//
// The HOST device is the referee: it runs the same authoritative engine
// as solo/LAN play and sends each peer a per-seat view with hidden
// hands (js/engine/view.js). ES2018 / Safari 12 (WebRTC is Safari 11+).

import { newGame, dispatch, whatsPending } from './engine/game.js';
import { botDecide } from './ai/bot.js';
import { viewFor, actionFromSeat } from './engine/view.js';

var BOT_MS = 900;

/* ── lazy vendor loading ─────────────────────────────────────────── */

var loaded = {};
export function loadScript(src) {
  if (loaded[src]) return loaded[src];
  loaded[src] = new Promise(function (resolve, reject) {
    var s = document.createElement('script');
    s.src = src;
    s.onload = function () { resolve(); };
    s.onerror = function () { delete loaded[src]; reject(new Error('failed to load ' + src)); };
    document.head.appendChild(s);
  });
  return loaded[src];
}

/* ── signal codes: deflate(JSON) → base64url ─────────────────────── */

function b64urlFromBytes(bytes) {
  var bin = '';
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesFromB64url(str) {
  var b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  var bin = atob(b64);
  var out = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodeSignal(obj) {
  var json = JSON.stringify(obj);
  var packed = window.pako.deflateRaw(json, { level: 9 });
  return b64urlFromBytes(packed);
}

export function decodeSignal(code) {
  var json = window.pako.inflateRaw(bytesFromB64url(code), { to: 'string' });
  return JSON.parse(json);
}

/* ── WebRTC helpers ──────────────────────────────────────────────── */

function makePc() {
  var RTC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
  if (!RTC) throw new Error('This browser has no WebRTC support.');
  return new RTC({ iceServers: [] }); // LAN/hotspot only — fully serverless
}

// Non-trickle: wait until candidate gathering finishes (or times out)
// so the whole connection description fits in one QR code.
function waitIce(pc) {
  return new Promise(function (resolve) {
    if (pc.iceGatheringState === 'complete') { resolve(); return; }
    var done = false;
    function finish() { if (!done) { done = true; resolve(); } }
    pc.addEventListener('icegatheringstatechange', function () {
      if (pc.iceGatheringState === 'complete') finish();
    });
    setTimeout(finish, 3500);
  });
}

/* ── host session ────────────────────────────────────────────────── */

var BOT_NAMES = { easy: ['Penny', 'Louie', 'Daisy'], balanced: ['Victor', 'Greta', 'Sal'], shark: ['Vanderbilt', 'Astor', 'Rockford'] };

export function createHost(cfg) {
  var host = {
    cfg: cfg, // {name, bots, diff}
    peers: [],        // {pc, channel, name, open}
    pendingPc: null,
    state: null,
    botTimer: null,
    onPeersChanged: null,
    onState: null,    // called with the REAL state (host is seat 0)
    onError: null
  };

  function notifyPeers() { if (host.onPeersChanged) host.onPeersChanged(); }

  function peerSeat(peer) { return 1 + host.peers.indexOf(peer); }

  function sendTo(peer, msg) {
    if (peer.channel && peer.channel.readyState === 'open') {
      peer.channel.send(JSON.stringify(msg));
    }
  }

  function broadcast() {
    host.peers.forEach(function (peer) {
      if (peer.open) sendTo(peer, { t: 'state', view: viewFor(host.state, peerSeat(peer)) });
    });
    if (host.onState) host.onState(host.state); // local render consumes events
  }

  function pendingSeat() {
    var w = whatsPending(host.state);
    return w ? w.player : host.state.active;
  }

  function isBotSeat(seat) {
    return host.state.players[seat] && host.state.players[seat].isBot;
  }

  function scheduleBots() {
    if (host.botTimer) { clearTimeout(host.botTimer); host.botTimer = null; }
    if (!host.state || host.state.winner !== null) return;
    var seat = pendingSeat();
    if (!isBotSeat(seat)) return;
    host.botTimer = setTimeout(function () {
      host.botTimer = null;
      if (!host.state || host.state.winner !== null) return;
      var a = botDecide(host.state, seat);
      try { dispatch(host.state, a || { type: 'endTurn' }); }
      catch (e) { try { dispatch(host.state, { type: 'endTurn' }); } catch (e2) { } }
      broadcast();
      scheduleBots();
    }, BOT_MS);
  }

  function handlePeerMsg(peer, msg) {
    if (msg.t === 'hi') {
      peer.name = String(msg.name || 'Guest').slice(0, 24);
      peer.open = true;
      sendTo(peer, { t: 'hi-ok', seat: peerSeat(peer) });
      notifyPeers();
      return;
    }
    if (msg.t === 'action') {
      if (!host.state || host.state.winner !== null) return;
      var seat = peerSeat(peer);
      if (pendingSeat() !== seat) { sendTo(peer, { t: 'err', msg: 'Not your move.' }); return; }
      var real = actionFromSeat(msg.action || {}, seat, host.state.players.length);
      try { dispatch(host.state, real); }
      catch (e) {
        sendTo(peer, { t: 'err', msg: e.message });
        sendTo(peer, { t: 'state', view: viewFor(host.state, seat) });
        return;
      }
      broadcast();
      scheduleBots();
    }
  }

  // One invite per joiner: create the connection + code for the NEXT player.
  host.makeOffer = function () {
    var pc = makePc();
    var channel = pc.createDataChannel('magnate');
    var peer = { pc: pc, channel: channel, name: 'Guest', open: false };
    host.pendingPc = peer;
    channel.onmessage = function (e) {
      var msg; try { msg = JSON.parse(e.data); } catch (err) { return; }
      handlePeerMsg(peer, msg);
    };
    channel.onclose = function () {
      peer.open = false;
      notifyPeers();
      if (host.onError) host.onError((peer.name || 'A player') + ' disconnected.');
    };
    return pc.createOffer().then(function (offer) {
      return pc.setLocalDescription(offer);
    }).then(function () {
      return waitIce(pc);
    }).then(function () {
      return encodeSignal({ v: 1, t: 'o', sdp: pc.localDescription.sdp });
    });
  };

  host.acceptAnswer = function (code) {
    var msg = decodeSignal(code);
    if (!msg || msg.t !== 'a' || !msg.sdp) throw new Error('That code isn’t a player answer.');
    var peer = host.pendingPc;
    if (!peer) throw new Error('Generate an invite first.');
    return peer.pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp }).then(function () {
      host.peers.push(peer);
      host.pendingPc = null;
      return new Promise(function (resolve, reject) {
        var t = setTimeout(function () { reject(new Error('Connection timed out — same WiFi/hotspot?')); }, 12000);
        var iv = setInterval(function () {
          if (peer.open) { clearTimeout(t); clearInterval(iv); resolve(); }
        }, 150);
      });
    });
  };

  host.seatNames = function () {
    var names = [host.cfg.name];
    host.peers.forEach(function (p) { names.push(p.name + (p.open ? '' : ' (connecting…)')); });
    for (var b = 0; b < host.cfg.bots; b++) names.push(BOT_NAMES[host.cfg.diff][b] + ' (bot)');
    return names;
  };

  host.start = function () {
    var players = [{ name: host.cfg.name, isBot: false }];
    host.peers.forEach(function (p) { players.push({ name: p.name, isBot: false }); });
    for (var b = 0; b < host.cfg.bots; b++) {
      players.push({ name: BOT_NAMES[host.cfg.diff][b], isBot: true, personality: host.cfg.diff });
    }
    if (players.length < 2) throw new Error('Need at least one other player or bot.');
    if (players.length > 5) players.length = 5;
    host.state = newGame({ players: players });
    broadcast();
    scheduleBots();
  };

  host.localAction = function (action) {
    if (!host.state) return;
    if (pendingSeat() !== 0) { if (host.onError) host.onError('Not your move.'); return; }
    try { dispatch(host.state, action); }
    catch (e) { if (host.onError) host.onError(e.message); return; }
    broadcast();
    scheduleBots();
  };

  host.rematch = function () {
    if (host.state && host.state.winner === null) return;
    host.start();
  };

  host.destroy = function () {
    if (host.botTimer) clearTimeout(host.botTimer);
    host.peers.forEach(function (p) { try { p.pc.close(); } catch (e) { } });
    if (host.pendingPc) { try { host.pendingPc.pc.close(); } catch (e) { } }
    host.peers = [];
  };

  return host;
}

/* ── joiner session ──────────────────────────────────────────────── */

export function createJoiner(offerCode, name) {
  var msg = decodeSignal(offerCode);
  if (!msg || msg.t !== 'o' || !msg.sdp) return Promise.reject(new Error('That code isn’t a game invite.'));

  var joiner = {
    channel: null, pc: null, seat: null,
    onState: null, onError: null, onOpen: null, onClose: null,
    send: function (action) {
      if (joiner.channel && joiner.channel.readyState === 'open') {
        joiner.channel.send(JSON.stringify({ t: 'action', action: action }));
      }
    },
    destroy: function () { try { joiner.pc.close(); } catch (e) { } }
  };

  var pc = makePc();
  joiner.pc = pc;
  pc.ondatachannel = function (e) {
    var ch = e.channel;
    joiner.channel = ch;
    ch.onopen = function () {
      ch.send(JSON.stringify({ t: 'hi', name: name }));
      if (joiner.onOpen) joiner.onOpen();
    };
    ch.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (err) { return; }
      if (m.t === 'state') { if (joiner.onState) joiner.onState(m.view); return; }
      if (m.t === 'hi-ok') { joiner.seat = m.seat; return; }
      if (m.t === 'err') { if (joiner.onError) joiner.onError(m.msg); return; }
    };
    ch.onclose = function () { if (joiner.onClose) joiner.onClose(); };
  };

  return pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp }).then(function () {
    return pc.createAnswer();
  }).then(function (answer) {
    return pc.setLocalDescription(answer);
  }).then(function () {
    return waitIce(pc);
  }).then(function () {
    return { joiner: joiner, answerCode: encodeSignal({ v: 1, t: 'a', sdp: pc.localDescription.sdp }) };
  });
}
