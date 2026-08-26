// sheets.js — bottom-sheet prompts: card play options, payment picker,
// discard picker, Veto windows, target choosers, game over.
// All interaction is tap-based (Safari 12 / touchscreen friendly).

import { COLORS, COLOR_KEYS, ACTIONS, cardName, isRainbowWild } from '../engine/cards.js';
import {
  isZoneComplete, completeZones, bestRentForColor, payableCards, zoneRent
} from '../engine/game.js';
import { el, clear, qs } from './dom.js';
import { cardEl, chipEl } from './cardview.js';

var host = null;

function ensureHost() {
  if (!host) host = qs('#sheet-host');
  return host;
}

export function closeSheet() {
  clear(ensureHost());
  ensureHost().className = '';
}

// opts: {title, sub, content, buttons:[{label, cls, disabled, onTap}], noCancel, onCancel}
export function showSheet(opts) {
  var h = ensureHost();
  clear(h);
  h.className = 'open';

  var backdrop = el('div', {
    class: 'sheet-backdrop',
    onTap: function () {
      if (opts.noCancel) return;
      closeSheet();
      if (opts.onCancel) opts.onCancel();
    }
  });

  var panel = el('div', { class: 'sheet' });
  if (opts.title) panel.appendChild(el('div', { class: 'sheet-title', text: opts.title }));
  if (opts.sub) panel.appendChild(el('div', { class: 'sheet-sub', text: opts.sub }));
  var body = el('div', { class: 'sheet-body' });
  if (opts.content) body.appendChild(opts.content);
  panel.appendChild(body);

  if (opts.buttons && opts.buttons.length) {
    var row = el('div', { class: 'sheet-buttons' });
    opts.buttons.forEach(function (b) {
      var btn = el('button', {
        class: 'btn ' + (b.cls || ''),
        text: b.label,
        onTap: function () { if (!btn.disabled) b.onTap(); }
      });
      if (b.disabled) btn.disabled = true;
      if (b.id) btn.id = b.id;
      row.appendChild(btn);
    });
    panel.appendChild(row);
  }
  if (!opts.noCancel) {
    panel.appendChild(el('div', { class: 'sheet-cancel-row' }, [
      el('button', {
        class: 'btn btn-ghost', text: opts.cancelLabel || 'Cancel',
        onTap: function () { closeSheet(); if (opts.onCancel) opts.onCancel(); }
      })
    ]));
  }
  h.appendChild(backdrop);
  h.appendChild(panel);
  return panel;
}

/* ── helpers ─────────────────────────────────────────────────────── */

function colorDot(color) {
  var d = el('span', { class: 'color-dot' });
  d.style.background = COLORS[color].hex;
  return d;
}

function opponentButton(state, idx, onTap, extraText) {
  var p = state.players[idx];
  return el('button', { class: 'btn btn-row', onTap: onTap }, [
    el('span', { class: 'btn-row-name', text: p.name }),
    el('span', { class: 'btn-row-sub', text: extraText || '' })
  ]);
}

/* ── card play sheet ─────────────────────────────────────────────── */

// Build the option list for a tapped hand card and hand chosen engine
// actions to `act(action)`. `state` is the live game state.
export function showPlaySheet(state, card, act) {
  var me = state.players[state.active];
  var content = el('div', { class: 'play-preview' }, [cardEl(card, 'big')]);
  var buttons = [];

  function bankButton() {
    if (card.kind === 'property' || card.kind === 'wild') return;
    buttons.push({
      label: 'Add to bank (' + card.value + 'M)',
      cls: 'btn-secondary',
      onTap: function () { act({ type: 'play', cardId: card.id, mode: 'bank' }); }
    });
  }

  if (card.kind === 'money') {
    buttons.push({
      label: 'Add to bank (' + card.value + 'M)', cls: 'btn-primary',
      onTap: function () { act({ type: 'play', cardId: card.id, mode: 'bank' }); }
    });
  } else if (card.kind === 'property') {
    buttons.push({
      label: 'Play to your properties', cls: 'btn-primary',
      onTap: function () { act({ type: 'play', cardId: card.id, mode: 'property', color: card.color }); }
    });
  } else if (card.kind === 'wild') {
    showWildSheet(state, card, act);
    return;
  } else if (card.kind === 'rent') {
    showRentSheet(state, card, act);
    return;
  } else if (card.kind === 'action') {
    var kind = card.action;
    if (kind === 'passGo') {
      buttons.push({
        label: 'Play — draw 2 cards', cls: 'btn-primary',
        onTap: function () { act({ type: 'play', cardId: card.id, mode: 'action' }); }
      });
    } else if (kind === 'birthday') {
      buttons.push({
        label: 'Play — everyone pays you 2M', cls: 'btn-primary',
        onTap: function () { act({ type: 'play', cardId: card.id, mode: 'action' }); }
      });
    } else if (kind === 'debtCollector') {
      buttons.push({
        label: 'Play — one player pays you 5M', cls: 'btn-primary',
        onTap: function () { chooseOpponent(state, 'Who pays you 5M?', function (idx) {
          act({ type: 'play', cardId: card.id, mode: 'action', victim: idx });
        }); }
      });
    } else if (kind === 'house' || kind === 'hotel') {
      var eligible = completeZones(me).filter(function (z) {
        if (!COLORS[z.color].buildable) return false;
        return kind === 'house' ? !z.house : (z.house && !z.hotel);
      });
      if (eligible.length) {
        buttons.push({
          label: 'Add to a complete set', cls: 'btn-primary',
          onTap: function () { chooseOwnZone(state, eligible, 'Add the ' + ACTIONS[kind].name + ' to which set?', function (z) {
            act({ type: 'play', cardId: card.id, mode: 'action', zoneId: z.id });
          }); }
        });
      } else {
        content.appendChild(el('div', { class: 'sheet-hint', text: kind === 'house' ? 'You need a complete set (not Railroad/Utility) to place a House.' : 'You need a complete set with a House to place a Hotel.' }));
      }
    } else if (kind === 'dealBreaker') {
      var anyTargets = false;
      state.players.forEach(function (p, i) {
        if (i !== state.active && completeZones(p).length) anyTargets = true;
      });
      if (anyTargets) {
        buttons.push({
          label: 'Play — steal a complete set', cls: 'btn-primary',
          onTap: function () { chooseEnemyCompleteSet(state, function (idx, z) {
            act({ type: 'play', cardId: card.id, mode: 'action', victim: idx, zoneId: z.id });
          }); }
        });
      } else {
        content.appendChild(el('div', { class: 'sheet-hint', text: 'No opponent has a complete set yet.' }));
      }
    } else if (kind === 'slyDeal') {
      if (enemyStealableCards(state).length) {
        buttons.push({
          label: 'Play — steal a property', cls: 'btn-primary',
          onTap: function () { chooseEnemyProperty(state, 'Steal which property?', function (idx, c) {
            act({ type: 'play', cardId: card.id, mode: 'action', victim: idx, targetCardId: c.id });
          }); }
        });
      } else {
        content.appendChild(el('div', { class: 'sheet-hint', text: 'No opponent property can be stolen (complete sets are protected).' }));
      }
    } else if (kind === 'forcedDeal') {
      var mine = myTradeableCards(state);
      if (enemyStealableCards(state).length && mine.length) {
        buttons.push({
          label: 'Play — swap properties', cls: 'btn-primary',
          onTap: function () {
            chooseEnemyProperty(state, 'Take which property?', function (idx, theirCard) {
              chooseMyProperty(state, mine, 'Give which of yours?', function (myCard) {
                act({ type: 'play', cardId: card.id, mode: 'action', victim: idx, targetCardId: theirCard.id, giveCardId: myCard.id });
              });
            });
          }
        });
      } else {
        content.appendChild(el('div', { class: 'sheet-hint', text: 'A swap needs a property you can give and one you can take (complete sets are protected).' }));
      }
    } else if (kind === 'justSayNo') {
      content.appendChild(el('div', { class: 'sheet-hint', text: 'Veto is saved in your hand and played automatically as an option when someone attacks you. You can also bank it as 4M.' }));
    } else if (kind === 'doubleRent') {
      content.appendChild(el('div', { class: 'sheet-hint', text: 'Play this together with a rent card (you’ll get the option there), or bank it as 1M.' }));
    }
    bankButton();
  }

  showSheet({ title: cardName(card), content: content, buttons: buttons });
}

function showWildSheet(state, card, act) {
  var me = state.players[state.active];
  var content = el('div', { class: 'play-preview' }, [cardEl(card, 'big')]);
  var options = card.colors === 'all' ? COLOR_KEYS.slice() : card.colors.slice();
  // owned colours first
  options.sort(function (a, b) {
    var oa = me.sets.some(function (z) { return z.color === a && !isZoneComplete(z); }) ? 0 : 1;
    var ob = me.sets.some(function (z) { return z.color === b && !isZoneComplete(z); }) ? 0 : 1;
    return oa - ob;
  });
  var grid = el('div', { class: 'color-grid' });
  options.forEach(function (color) {
    var meta = COLORS[color];
    var btn = el('button', { class: 'btn color-btn', onTap: function () {
      act({ type: 'play', cardId: card.id, mode: 'property', color: color });
    } }, [colorDot(color), el('span', { text: meta.label })]);
    btn.style.borderColor = meta.hex;
    grid.appendChild(btn);
  });
  content.appendChild(el('div', { class: 'sheet-hint', text: 'Play as which colour?' }));
  content.appendChild(grid);
  showSheet({ title: cardName(card), content: content, buttons: [] });
}

function showRentSheet(state, card, act) {
  var me = state.players[state.active];
  var dtrs = me.hand.filter(function (c) { return c.kind === 'action' && c.action === 'doubleRent'; });
  var colors = (card.colors === 'all' ? COLOR_KEYS : card.colors).filter(function (color) {
    return bestRentForColor(me, color) > 0;
  });

  var content = el('div', { class: 'play-preview' }, [cardEl(card, 'big')]);
  if (!colors.length) {
    content.appendChild(el('div', { class: 'sheet-hint', text: 'You have no properties this rent card can charge for. You can bank it instead.' }));
    showSheet({
      title: cardName(card), content: content,
      buttons: [{ label: 'Add to bank (' + card.value + 'M)', cls: 'btn-secondary', onTap: function () {
        act({ type: 'play', cardId: card.id, mode: 'bank' });
      } }]
    });
    return;
  }

  var chosen = { doubles: 0 };
  var maxDoubles = Math.min(dtrs.length, state.playsLeft - 1);

  function amountFor(color) {
    return bestRentForColor(me, color) * Math.pow(2, chosen.doubles);
  }

  var colorList = el('div', { class: 'color-grid' });
  function rebuildColors() {
    clear(colorList);
    colors.forEach(function (color) {
      var btn = el('button', { class: 'btn color-btn', onTap: function () { pickColor(color); } }, [
        colorDot(color),
        el('span', { text: COLORS[color].label + ' — ' + amountFor(color) + 'M' })
      ]);
      btn.style.borderColor = COLORS[color].hex;
      colorList.appendChild(btn);
    });
  }

  function pickColor(color) {
    var doubles = dtrs.slice(0, chosen.doubles).map(function (c) { return c.id; });
    if (card.colors === 'all') {
      chooseOpponent(state, 'Charge whom ' + amountFor(color) + 'M?', function (idx) {
        act({ type: 'play', cardId: card.id, mode: 'rent', color: color, target: idx, doubles: doubles });
      });
    } else {
      act({ type: 'play', cardId: card.id, mode: 'rent', color: color, doubles: doubles });
    }
  }

  if (maxDoubles > 0) {
    var toggleRow = el('div', { class: 'dtr-row' });
    var label = el('span', { class: 'sheet-hint', text: 'Double The Rent (' + maxDoubles + ' available):' });
    toggleRow.appendChild(label);
    var opts = [];
    for (var i = 0; i <= maxDoubles; i++) opts.push(i);
    var seg = el('div', { class: 'seg' });
    opts.forEach(function (n) {
      var b = el('button', { class: 'seg-btn' + (n === 0 ? ' on' : ''), text: n === 0 ? 'No' : '×' + Math.pow(2, n), onTap: function () {
        chosen.doubles = n;
        Array.prototype.forEach.call(seg.children, function (ch, j) {
          ch.className = 'seg-btn' + (j === n ? ' on' : '');
        });
        rebuildColors();
      } });
      seg.appendChild(b);
    });
    toggleRow.appendChild(seg);
    content.appendChild(toggleRow);
  }

  content.appendChild(el('div', { class: 'sheet-hint', text: card.colors === 'all' ? 'Charge ONE player. Pick a colour:' : 'ALL opponents pay. Pick a colour:' }));
  rebuildColors();
  content.appendChild(colorList);
  showSheet({ title: cardName(card), content: content, buttons: [] });
}

/* ── target choosers ─────────────────────────────────────────────── */

function chooseOpponent(state, title, cb) {
  var content = el('div', {});
  state.players.forEach(function (p, i) {
    if (i === state.active) return;
    var wealth = payableCards(p).reduce(function (s, c) { return s + c.value; }, 0);
    content.appendChild(opponentButton(state, i, function () { cb(i); }, wealth + 'M on the table'));
  });
  showSheet({ title: title, content: content, buttons: [] });
}

function chooseOwnZone(state, zones, title, cb) {
  var content = el('div', {});
  zones.forEach(function (z) {
    content.appendChild(el('button', { class: 'btn btn-row', onTap: function () { cb(z); } }, [
      colorDot(z.color),
      el('span', { class: 'btn-row-name', text: COLORS[z.color].label + ' set (rent ' + zoneRent(z) + 'M)' })
    ]));
  });
  showSheet({ title: title, content: content, buttons: [] });
}

function chooseEnemyCompleteSet(state, cb) {
  var content = el('div', {});
  state.players.forEach(function (p, i) {
    if (i === state.active) return;
    completeZones(p).forEach(function (z) {
      var extra = (z.house ? ' +House' : '') + (z.hotel ? ' +Hotel' : '');
      content.appendChild(el('button', { class: 'btn btn-row', onTap: function () { cb(i, z); } }, [
        colorDot(z.color),
        el('span', { class: 'btn-row-name', text: p.name + ' — ' + COLORS[z.color].label + extra })
      ]));
    });
  });
  showSheet({ title: 'Steal which complete set?', content: content, buttons: [] });
}

function enemyStealableCards(state) {
  var out = [];
  state.players.forEach(function (p, i) {
    if (i === state.active) return;
    p.sets.forEach(function (z) {
      if (isZoneComplete(z)) return;
      z.cards.forEach(function (c) { out.push({ player: i, card: c, zone: z }); });
    });
  });
  return out;
}

function myTradeableCards(state) {
  var me = state.players[state.active];
  var out = [];
  me.sets.forEach(function (z) {
    if (isZoneComplete(z)) return;
    z.cards.forEach(function (c) { out.push(c); });
  });
  return out;
}

function chooseEnemyProperty(state, title, cb) {
  var content = el('div', {});
  var groups = {};
  enemyStealableCards(state).forEach(function (item) {
    if (!groups[item.player]) groups[item.player] = [];
    groups[item.player].push(item);
  });
  Object.keys(groups).forEach(function (pi) {
    var idx = Number(pi);
    content.appendChild(el('div', { class: 'group-label', text: state.players[idx].name }));
    var row = el('div', { class: 'pick-cards' });
    groups[pi].forEach(function (item) {
      var wrap = el('div', { class: 'pick-card', onTap: function () { cb(idx, item.card); } }, [cardEl(item.card, 'small')]);
      row.appendChild(wrap);
    });
    content.appendChild(row);
  });
  showSheet({ title: title, content: content, buttons: [] });
}

function chooseMyProperty(state, cards, title, cb) {
  var content = el('div', {});
  var row = el('div', { class: 'pick-cards' });
  cards.forEach(function (c) {
    row.appendChild(el('div', { class: 'pick-card', onTap: function () { cb(c); } }, [cardEl(c, 'small')]));
  });
  content.appendChild(row);
  showSheet({ title: title, content: content, buttons: [] });
}

/* ── Veto window ─────────────────────────────────────────────────── */

export function showVetoSheet(state, w, act) {
  var pending = w.pending;
  var claim = w.claim;
  var meIdx = w.player;
  var iAmVictim = claim.waitingOn === claim.victim;
  var srcName = state.players[pending.source].name;
  var vicName = state.players[claim.victim].name;

  var what;
  if (pending.action === 'rent') what = srcName + ' charges you ' + claim.amount + 'M rent';
  else if (pending.action === 'birthday') what = srcName + ' passes the hat — you owe 2M';
  else if (pending.action === 'debtCollector') what = srcName + ' sends the Debt Collector — you owe 5M';
  else if (pending.action === 'dealBreaker') what = srcName + ' plays Takeover on your complete set';
  else if (pending.action === 'slyDeal') what = srcName + ' plays Land Grab on your property';
  else if (pending.action === 'forcedDeal') what = srcName + ' forces a property swap (Hard Bargain)';
  else what = srcName + ' plays an action against you';

  var title, sub;
  if (iAmVictim) {
    title = what + '!';
    sub = claim.jsnCount > 0 ? 'Your Veto was countered. Veto again?' : 'You have a Veto card. Cancel it?';
  } else {
    title = vicName + ' played Veto against you!';
    sub = 'Counter with your own Veto to push your action through?';
  }

  showSheet({
    title: title, sub: sub, noCancel: true,
    buttons: [
      {
        label: iAmVictim ? 'Play Veto — cancel it' : 'Counter with Veto', cls: 'btn-primary',
        onTap: function () { act({ type: 'respondJsn', player: meIdx, use: true }); }
      },
      {
        label: iAmVictim ? 'Allow it' : 'Let it stand', cls: 'btn-secondary',
        onTap: function () { act({ type: 'respondJsn', player: meIdx, use: false }); }
      }
    ]
  });
}

/* ── payment picker ──────────────────────────────────────────────── */

export function showPaymentSheet(state, w, act) {
  var meIdx = w.player;
  var me = state.players[meIdx];
  var toName = state.players[w.pending.source].name;
  var amount = w.amount;
  var all = payableCards(me);
  var totalAvail = all.reduce(function (s, c) { return s + c.value; }, 0);
  var mustPayAll = totalAvail <= amount;

  var selected = {};
  var content = el('div', {});
  var totalLine = el('div', { class: 'pay-total' });

  function selTotal() {
    var t = 0;
    all.forEach(function (c) { if (selected[c.id]) t += c.value; });
    return t;
  }
  function selCount() {
    return Object.keys(selected).filter(function (k) { return selected[k]; }).length;
  }
  var confirmBtn;
  function refresh() {
    var t = selTotal();
    var ok = mustPayAll ? selCount() === all.length : t >= amount;
    totalLine.textContent = 'Selected: ' + t + 'M of ' + amount + 'M owed' +
      (mustPayAll ? ' — you must hand over everything (' + totalAvail + 'M)' : '');
    if (confirmBtn) confirmBtn.disabled = !ok;
  }

  function cardToggle(c, labelPrefix) {
    var wrap = el('div', { class: 'pay-item', onTap: function () {
      selected[c.id] = !selected[c.id];
      wrap.className = 'pay-item' + (selected[c.id] ? ' sel' : '');
      refresh();
    } }, [cardEl(c, 'small')]);
    if (labelPrefix) wrap.appendChild(el('div', { class: 'pay-item-label', text: labelPrefix }));
    if (mustPayAll) {
      selected[c.id] = true;
      wrap.className = 'pay-item sel';
    }
    return wrap;
  }

  if (me.bank.length) {
    content.appendChild(el('div', { class: 'group-label', text: 'Your bank' }));
    var bankRow = el('div', { class: 'pick-cards' });
    me.bank.forEach(function (c) { bankRow.appendChild(cardToggle(c)); });
    content.appendChild(bankRow);
  }
  var tableCards = [];
  me.sets.forEach(function (z) {
    z.cards.forEach(function (c) { if (!isRainbowWild(c)) tableCards.push(c); });
    if (z.house) tableCards.push(z.house);
    if (z.hotel) tableCards.push(z.hotel);
  });
  if (tableCards.length) {
    content.appendChild(el('div', { class: 'group-label', text: 'Your properties (go to ' + toName + '’s collection)' }));
    var tRow = el('div', { class: 'pick-cards' });
    tableCards.forEach(function (c) { tRow.appendChild(cardToggle(c)); });
    content.appendChild(tRow);
  }
  content.appendChild(totalLine);

  var panel = showSheet({
    title: 'Pay ' + toName + ' ' + amount + 'M',
    sub: 'No change is given. Tap cards to select.',
    content: content, noCancel: true,
    buttons: [{
      label: 'Pay', cls: 'btn-primary', id: 'pay-confirm',
      onTap: function () {
        var ids = all.filter(function (c) { return selected[c.id]; }).map(function (c) { return c.id; });
        act({ type: 'submitPayment', player: meIdx, cardIds: ids });
      }
    }]
  });
  confirmBtn = panel.querySelector('#pay-confirm');
  refresh();
}

/* ── discard picker ──────────────────────────────────────────────── */

export function showDiscardSheet(state, w, act) {
  var me = state.players[state.active];
  var need = w.count;
  var selected = {};
  var content = el('div', {});
  var line = el('div', { class: 'pay-total' });
  var confirmBtn;

  function refresh() {
    var n = Object.keys(selected).filter(function (k) { return selected[k]; }).length;
    line.textContent = 'Selected ' + n + ' of ' + need + ' to discard';
    if (confirmBtn) confirmBtn.disabled = n !== need;
  }

  var row = el('div', { class: 'pick-cards' });
  me.hand.forEach(function (c) {
    var wrap = el('div', { class: 'pay-item', onTap: function () {
      selected[c.id] = !selected[c.id];
      wrap.className = 'pay-item' + (selected[c.id] ? ' sel' : '');
      refresh();
    } }, [cardEl(c, 'small')]);
    row.appendChild(wrap);
  });
  content.appendChild(row);
  content.appendChild(line);

  var panel = showSheet({
    title: 'Hand limit is 7 — discard ' + need,
    content: content, noCancel: true,
    buttons: [{
      label: 'Discard', cls: 'btn-primary', id: 'discard-confirm',
      onTap: function () {
        var ids = Object.keys(selected).filter(function (k) { return selected[k]; });
        act({ type: 'discard', cardIds: ids });
      }
    }]
  });
  confirmBtn = panel.querySelector('#discard-confirm');
  refresh();
}

/* ── rearrange sheet (own table card tapped) ─────────────────────── */

export function showRearrangeSheet(state, card, zone, act) {
  var me = state.players[state.active];
  var content = el('div', { class: 'play-preview' }, [cardEl(card, 'big')]);
  var buttons = [];

  if (card.kind === 'wild') {
    var options = card.colors === 'all' ? COLOR_KEYS.slice() : card.colors.slice();
    var grid = el('div', { class: 'color-grid' });
    options.forEach(function (color) {
      if (color === zone.color) return;
      var btn = el('button', { class: 'btn color-btn', onTap: function () {
        act({ type: 'rearrange', cardId: card.id, color: color });
      } }, [colorDot(color), el('span', { text: 'Move to ' + COLORS[color].label })]);
      btn.style.borderColor = COLORS[color].hex;
      grid.appendChild(btn);
    });
    content.appendChild(el('div', { class: 'sheet-hint', text: 'Rearranging is free on your turn.' }));
    content.appendChild(grid);
  } else if (card.kind === 'action') {
    // house/hotel move
    var targets = completeZones(me).filter(function (z) {
      if (z.id === zone.id || !COLORS[z.color].buildable) return false;
      return card.action === 'house' ? !z.house : (z.house && !z.hotel);
    });
    targets.forEach(function (z) {
      buttons.push({
        label: 'Move to ' + COLORS[z.color].label + ' set', cls: 'btn-secondary',
        onTap: function () { act({ type: 'moveBuilding', cardId: card.id, zoneId: z.id }); }
      });
    });
    if (!targets.length) {
      content.appendChild(el('div', { class: 'sheet-hint', text: 'No other complete set can take this right now.' }));
    }
  } else {
    content.appendChild(el('div', { class: 'sheet-hint', text: 'This property stays in its ' + COLORS[zone.color].label + ' set.' }));
  }

  showSheet({ title: cardName(card), content: content, buttons: buttons });
}

/* ── game over ───────────────────────────────────────────────────── */

export function showGameOverSheet(state, onNew, onHome) {
  var winner = state.players[state.winner];
  showSheet({
    title: winner.id === 0 ? '🏆 You win!' : winner.name + ' wins',
    sub: 'First to three complete sets in different colours.',
    noCancel: true,
    buttons: [
      { label: 'Play again', cls: 'btn-primary', onTap: onNew },
      { label: 'Home', cls: 'btn-secondary', onTap: onHome }
    ]
  });
}
