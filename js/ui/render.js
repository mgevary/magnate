// render.js — draws the round table from engine state. Every card on the
// table is rendered by the same cardEl() art that draws the hand, just
// smaller, so what you see played is what you hold. Re-renders regions on
// each dispatch (discrete taps — no per-frame work for the old iPad).

import { COLORS, cardName } from '../engine/cards.js';
import { isZoneComplete, zoneRent, bankValue, completeSetColorCount } from '../engine/game.js';
import { el, clear, qs } from './dom.js';
import { cardEl, backEl } from './cardview.js';

// Deterministic "messy pile" jitter from a card id (stable across renders).
function jitter(id, range) {
  var h = 0;
  for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (((h % 1000) / 1000) - 0.5) * 2 * range;
}

/* ── shared pieces ───────────────────────────────────────────────── */

// A zone as overlapping real card faces + a label underneath.
function zoneEl(zone, size, onTapCard) {
  var complete = isZoneComplete(zone);
  var cardsRow = el('div', { class: 'zone-cards zc-' + size });
  var all = zone.cards.slice();
  if (zone.house) all.push(zone.house);
  if (zone.hotel) all.push(zone.hotel);
  all.forEach(function (c) {
    var cv = cardEl(c, size);
    if (onTapCard) cv.addEventListener('click', function () { onTapCard(c, zone); });
    cardsRow.appendChild(cv);
  });
  var label = COLORS[zone.color].label + ' ' + zone.cards.length + '/' + COLORS[zone.color].size + (complete ? ' ★' : '');
  return el('div', { class: 'zone' + (complete ? ' done' : '') }, [
    cardsRow,
    el('div', { class: 'zone-label', text: label })
  ]);
}

// Overlapping money-card fan for a bank.
function bankFan(player, size) {
  var fan = el('div', { class: 'bank-fan zc-' + size });
  player.bank.forEach(function (c) {
    fan.appendChild(cardEl(c, size));
  });
  return fan;
}

/* ── opponent seats ──────────────────────────────────────────────── */

function opponentPanel(state, idx, onTap) {
  var p = state.players[idx];
  var isActive = state.active === idx && state.winner === null;
  var panel = el('div', { class: 'opp' + (isActive ? ' active' : ''), 'data-player': String(idx) });

  panel.appendChild(el('div', { class: 'opp-head' }, [
    el('span', { class: 'opp-name', text: p.name }),
    el('span', { class: 'opp-sets', text: completeSetColorCount(p) + '/3 ★' })
  ]));

  // hand: fanned card backs
  var handFan = el('div', { class: 'opp-handfan' });
  var shown = Math.min(p.hand.length, 8);
  for (var i = 0; i < shown; i++) {
    var b = backEl('tiny');
    b.style.transform = 'rotate(' + ((i - (shown - 1) / 2) * 6) + 'deg)';
    handFan.appendChild(b);
  }
  var statRow = el('div', { class: 'opp-stats' }, [
    handFan,
    el('span', { class: 'opp-handn', text: String(p.hand.length) }),
    el('span', { class: 'opp-bank', text: bankValue(p) + 'M' })
  ]);
  panel.appendChild(statRow);

  // played cards: real mini faces, grouped by set
  var table = el('div', { class: 'opp-table' });
  if (p.bank.length) {
    var bf = bankFan(p, 'mini');
    bf.className += ' opp-bankfan';
    table.appendChild(bf);
  }
  p.sets.forEach(function (z) { table.appendChild(zoneEl(z, 'mini', null)); });
  if (!p.sets.length && !p.bank.length) {
    table.appendChild(el('div', { class: 'opp-empty', text: 'nothing played yet' }));
  }
  panel.appendChild(table);

  panel.addEventListener('click', function () { onTap(idx); });
  return panel;
}

/* ── center: deck + banner + messy discard ───────────────────────── */

function deckPile(state) {
  var stack = el('div', { class: 'deck-stack', id: 'deck-stack' });
  for (var i = 3; i >= 1; i--) {
    var under = backEl('deck-big under');
    under.style.transform = 'translate(' + (i * 2) + 'px,' + (i * 2) + 'px)';
    stack.appendChild(under);
  }
  stack.appendChild(backEl('deck-big'));
  var count = typeof state.deckCount === 'number' ? state.deckCount : state.deck.length;
  stack.appendChild(el('span', { class: 'deck-count', text: String(count) }));
  return el('div', { class: 'pile' }, [stack, el('span', { class: 'pile-label', text: 'DRAW' })]);
}

function discardPile(state) {
  var stack = el('div', { class: 'discard-stack', id: 'discard-stack' });
  var top = state.discard.slice(-5);
  if (!top.length) {
    stack.appendChild(el('div', { class: 'card small empty-pile' }));
  }
  top.forEach(function (c) {
    var cv = cardEl(c, 'small messy');
    cv.style.transform = 'translate(' + jitter(c.id, 7) + 'px,' + jitter(c.id + 'y', 5) + 'px) rotate(' + jitter(c.id + 'r', 11) + 'deg)';
    stack.appendChild(cv);
  });
  return el('div', { class: 'pile' }, [stack, el('span', { class: 'pile-label', text: 'DISCARD' })]);
}

/* ── the render ──────────────────────────────────────────────────── */

// handlers: { onHandCard, onTableCard, onEndTurn, onOpponent }
export function render(state, handlers) {
  var humanIdx = 0;
  var me = state.players[humanIdx];
  var myTurn = state.active === humanIdx && state.phase === 'main' && !state.pending && state.winner === null;

  // opponent seats around the top arc
  var opps = clear(qs('#opponents'));
  opps.className = 'seats-' + (state.players.length - 1);
  for (var i = 1; i < state.players.length; i++) {
    opps.appendChild(opponentPanel(state, i, handlers.onOpponent));
  }

  // center of the table
  var center = clear(qs('#center'));
  center.appendChild(deckPile(state));

  var banner = el('div', { class: 'banner' });
  if (state.winner !== null) {
    banner.appendChild(el('div', { class: 'banner-turn', text: state.players[state.winner].name + ' wins!' }));
  } else {
    var activeName = state.active === 0 ? 'Your turn' : state.players[state.active].name + '’s turn';
    banner.appendChild(el('div', { class: 'banner-turn' + (state.active === 0 ? ' you' : ''), text: activeName }));
    var pips = el('div', { class: 'pips' });
    for (var pp = 0; pp < 3; pp++) {
      pips.appendChild(el('span', { class: 'pip' + (pp < state.playsLeft ? ' on' : '') }));
    }
    banner.appendChild(pips);
  }
  var lastLog = '';
  for (var li = state.log.length - 1; li >= 0; li--) {
    if (state.log[li].indexOf('— ') !== 0) { lastLog = state.log[li]; break; }
  }
  banner.appendChild(el('div', { class: 'ticker', text: lastLog }));
  center.appendChild(banner);

  center.appendChild(discardPile(state));

  // my table: zones as small full-art cards + bank fan
  var setsRow = clear(qs('#my-sets'));
  if (!me.sets.length) {
    setsRow.appendChild(el('div', { class: 'empty-hint', text: 'Your properties will appear here' }));
  }
  me.sets.forEach(function (z) {
    setsRow.appendChild(zoneEl(z, 'small', myTurn ? handlers.onTableCard : null));
  });

  var bankRow = clear(qs('#my-bank'));
  bankRow.appendChild(el('span', { class: 'bank-label', text: 'Bank ' + bankValue(me) + 'M' }));
  if (me.bank.length) {
    var bf = bankFan(me, 'mini');
    bankRow.appendChild(bf);
  }

  // hand
  var hand = clear(qs('#hand'));
  me.hand.forEach(function (c) {
    var cv = cardEl(c, '');
    if (myTurn && state.playsLeft > 0) {
      cv.className += ' playable';
      cv.addEventListener('click', function () { handlers.onHandCard(c); });
    } else if (myTurn) {
      cv.className += ' dim';
    }
    hand.appendChild(cv);
  });

  // controls
  var controls = clear(qs('#controls'));
  if (myTurn) {
    controls.appendChild(el('button', {
      class: 'btn btn-primary btn-end', text: 'End turn',
      onTap: handlers.onEndTurn
    }));
  }
}

var toastTimer = null;
export function showToast(text) {
  var t = qs('#toast');
  t.textContent = text;
  t.className = 'show';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.className = ''; }, 1900);
}
