// main.js — app driver: screens, the game loop, bot scheduling,
// persistence. ES2018 / Safari 12.

import { newGame, dispatch, whatsPending } from './engine/game.js';
import { botDecide } from './ai/bot.js';
import { render, showToast } from './ui/render.js';
import { el, clear, qs } from './ui/dom.js';
import {
  showPlaySheet, showVetoSheet, showPaymentSheet, showDiscardSheet,
  showRearrangeSheet, showGameOverSheet, showSheet, closeSheet
} from './ui/sheets.js';
import { RULES_HTML } from './ui/rules.js';

var SAVE_KEY = 'magnate-save-v1';
var BOT_DELAY = 850;

var App = { state: null, botTimer: null };

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

function buildHome() {
  var saved = loadSave();
  var box = clear(qs('#home-menu'));

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
    class: 'btn btn-secondary btn-big', text: 'How to play',
    onTap: function () { showRules(); }
  }));
}

function showRules() {
  qs('#rules-body').innerHTML = RULES_HTML;
  showScreen('screen-rules');
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

  if (state.winner !== null) {
    stopBots();
    showGameOverSheet(state,
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

function boot() {
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
    showSheet({
      title: 'Leave the game?',
      sub: 'Your game is saved — you can continue later.',
      buttons: [
        { label: 'Leave', cls: 'btn-secondary', onTap: function () { closeSheet(); goHome(); } },
        { label: 'Keep playing', cls: 'btn-primary', onTap: function () { closeSheet(); loop(); } }
      ],
      noCancel: true
    });
  });
  goHome();
}

boot();
