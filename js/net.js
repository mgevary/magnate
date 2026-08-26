// net.js — WebSocket client for LAN multiplayer. Talks to the room
// server (scripts/lan-server.mjs) on the same origin. ES2018 / Safari 12.

var TOKEN_KEY = 'magnate-net-token';

function token() {
  try {
    var t = localStorage.getItem(TOKEN_KEY);
    if (!t) {
      t = 't' + Math.floor(Math.random() * 1e9) + '-' + Date.now();
      localStorage.setItem(TOKEN_KEY, t);
    }
    return t;
  } catch (e) { return 'anon-' + Math.floor(Math.random() * 1e9); }
}

export var net = {
  ws: null,
  connected: false,
  room: null,       // last {t:'room'} payload
  rooms: [],        // lobby room list
  onRoom: null,     // function(room)
  onState: null,    // function(view)
  onError: null,    // function(msg)
  onRooms: null,    // function(rooms)
  onDrop: null      // function() — socket closed
};

// Is this page served by the LAN server? (On GitHub Pages this 404s.)
export function probeLan(cb) {
  var done = false;
  var timer = setTimeout(function () { if (!done) { done = true; cb(null); } }, 2500);
  fetch('lan/info', { cache: 'no-store' }).then(function (res) {
    if (!res.ok) throw new Error('no lan');
    return res.json();
  }).then(function (info) {
    if (!done) { done = true; clearTimeout(timer); cb(info && info.lan ? info : null); }
  }).catch(function () {
    if (!done) { done = true; clearTimeout(timer); cb(null); }
  });
}

export function connect(name, onReady) {
  if (net.ws && net.ws.readyState === 1) { onReady(); return; }
  var proto = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
  var ws = new WebSocket(proto + window.location.host + '/ws');
  net.ws = ws;
  ws.onopen = function () {
    net.connected = true;
    sendMsg({ t: 'hello', name: name, token: token() });
  };
  ws.onmessage = function (e) {
    var msg;
    try { msg = JSON.parse(e.data); } catch (err) { return; }
    if (msg.t === 'welcome') { net.rooms = msg.rooms || []; onReady(); return; }
    if (msg.t === 'rooms') { net.rooms = msg.rooms || []; if (net.onRooms) net.onRooms(net.rooms); return; }
    if (msg.t === 'room') { net.room = msg; if (net.onRoom) net.onRoom(msg); return; }
    if (msg.t === 'state') { if (net.onState) net.onState(msg.view); return; }
    if (msg.t === 'error') { if (net.onError) net.onError(msg.msg); return; }
  };
  ws.onclose = function () {
    net.connected = false;
    if (net.onDrop) net.onDrop();
  };
  ws.onerror = function () { /* close follows */ };
}

function sendMsg(msg) {
  if (net.ws && net.ws.readyState === 1) net.ws.send(JSON.stringify(msg));
}

export function createRoom(bots, diff) { sendMsg({ t: 'create', bots: bots, diff: diff }); }
export function joinRoom(code) { sendMsg({ t: 'join', code: code }); }
export function startGame() { sendMsg({ t: 'start' }); }
export function rematch() { sendMsg({ t: 'rematch' }); }
export function sendAction(action) { sendMsg({ t: 'action', action: action }); }
export function refreshRooms() { sendMsg({ t: 'rooms' }); }
export function leaveRoom() {
  sendMsg({ t: 'leave' });
  net.room = null;
}
export function disconnect() {
  if (net.ws) { try { net.ws.close(); } catch (e) { } }
  net.ws = null;
  net.room = null;
  net.connected = false;
}
