// render.js — draws the table from engine state. Re-renders regions on
// each dispatch (state changes are discrete taps — no per-frame work,
// which keeps the old iPad's compositor happy).

import { COLORS, cardName } from '../engine/cards.js';
import { isZoneComplete, zoneRent, bankValue, completeSetColorCount } from '../engine/game.js';
import { el, clear, qs } from './dom.js';
import { cardEl, chipEl, backEl } from './cardview.js';

function zoneChip(zone, onTap) {
  var meta = COLORS[zone.color];
  var complete = isZoneComplete(zone);
  var chip = el('div', { class: 'zchip' + (complete ? ' done' : '') });
  var stack = el('div', { class: 'zstack' });
  zone.cards.forEach(function (c) { stack.appendChild(chipEl(c)); });
  chip.appendChild(stack);
  var label = zone.cards.length + '/' + meta.size;
  if (zone.house) label += ' ⌂';
  if (zone.hotel) label += '⌂';
  chip.appendChild(el('div', { class: 'zlabel', text: label }));
  chip.style.borderColor = complete ? '#e0b64f' : 'rgba(255,255,255,.25)';
  if (onTap) chip.addEventListener('click', onTap);
  return chip;
}

function opponentPanel(state, idx) {
  var p = state.players[idx];
  var isActive = state.active === idx && state.winner === null;
  var panel = el('div', { class: 'opp' + (isActive ? ' active' : '') });
  panel.appendChild(el('div', { class: 'opp-head' }, [
    el('span', { class: 'opp-name', text: p.name }),
    el('span', { class: 'opp-sets', text: completeSetColorCount(p) + '/3 ★' })
  ]));
  panel.appendChild(el('div', { class: 'opp-stats' }, [
    el('span', { class: 'opp-hand', text: p.hand.length + ' in hand' }),
    el('span', { class: 'opp-bank', text: 'Bank ' + bankValue(p) + 'M' })
  ]));
  var zrow = el('div', { class: 'opp-zones' });
  p.sets.forEach(function (z) { zrow.appendChild(zoneChip(z, null)); });
  panel.appendChild(zrow);
  return panel;
}

// handlers: { onHandCard(card), onTableCard(card, zone), onEndTurn() }
export function render(state, handlers) {
  var humanIdx = 0;
  var me = state.players[humanIdx];
  var myTurn = state.active === humanIdx && state.phase === 'main' && !state.pending && state.winner === null;

  // opponents
  var opps = clear(qs('#opponents'));
  for (var i = 1; i < state.players.length; i++) {
    opps.appendChild(opponentPanel(state, i));
  }

  // midbar
  var mid = clear(qs('#midbar'));
  mid.appendChild(el('div', { class: 'pile' }, [
    backEl('deck-back'),
    el('span', { class: 'pile-label', text: String(state.deck.length) })
  ]));
  var banner = el('div', { class: 'banner' });
  if (state.winner !== null) {
    banner.appendChild(el('div', { class: 'banner-turn', text: state.players[state.winner].name + ' wins!' }));
  } else if (myTurn) {
    banner.appendChild(el('div', { class: 'banner-turn you', text: 'Your turn' }));
    var pips = el('div', { class: 'pips' });
    for (var pp = 0; pp < 3; pp++) {
      pips.appendChild(el('span', { class: 'pip' + (pp < state.playsLeft ? ' on' : '') }));
    }
    banner.appendChild(pips);
  } else {
    banner.appendChild(el('div', { class: 'banner-turn', text: state.players[state.active].name + '’s turn' }));
  }
  var lastLog = '';
  for (var li = state.log.length - 1; li >= 0; li--) {
    if (state.log[li].indexOf('— ') !== 0) { lastLog = state.log[li]; break; }
  }
  banner.appendChild(el('div', { class: 'ticker', text: lastLog }));
  mid.appendChild(banner);

  var discardPile = el('div', { class: 'pile' });
  if (state.discard.length) {
    discardPile.appendChild(cardEl(state.discard[state.discard.length - 1], 'small discard-top'));
  } else {
    discardPile.appendChild(el('div', { class: 'card small empty-pile' }));
  }
  discardPile.appendChild(el('span', { class: 'pile-label', text: 'discard' }));
  mid.appendChild(discardPile);

  // my table
  var setsRow = clear(qs('#my-sets'));
  if (!me.sets.length) {
    setsRow.appendChild(el('div', { class: 'empty-hint', text: 'Your properties will appear here' }));
  }
  me.sets.forEach(function (z) {
    var chip = zoneChip(z, null);
    var zoneCards = el('div', { class: 'zone-cards' });
    z.cards.forEach(function (c) {
      var cv = cardEl(c, 'mini');
      if (myTurn) {
        cv.addEventListener('click', function () { handlers.onTableCard(c, z); });
      }
      zoneCards.appendChild(cv);
    });
    if (z.house) {
      var hv = cardEl(z.house, 'mini');
      if (myTurn) hv.addEventListener('click', function () { handlers.onTableCard(z.house, z); });
      zoneCards.appendChild(hv);
    }
    if (z.hotel) {
      var hov = cardEl(z.hotel, 'mini');
      if (myTurn) hov.addEventListener('click', function () { handlers.onTableCard(z.hotel, z); });
      zoneCards.appendChild(hov);
    }
    var wrap = el('div', { class: 'zone' + (isZoneComplete(z) ? ' done' : '') }, [
      zoneCards,
      el('div', { class: 'zone-label', text: COLORS[z.color].label + ' ' + z.cards.length + '/' + COLORS[z.color].size + (isZoneComplete(z) ? ' ★' : '') })
    ]);
    setsRow.appendChild(wrap);
  });

  // my bank
  var bankRow = clear(qs('#my-bank'));
  bankRow.appendChild(el('span', { class: 'bank-label', text: 'Bank ' + bankValue(me) + 'M' }));
  var bankChips = el('span', { class: 'bank-chips' });
  me.bank.forEach(function (c) {
    bankChips.appendChild(el('span', { class: 'bank-chip', text: c.value }));
  });
  bankRow.appendChild(bankChips);

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
      class: 'btn btn-primary btn-end', text: state.playsLeft > 0 ? 'End turn' : 'End turn (no plays left)',
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
