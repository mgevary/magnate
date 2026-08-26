// fx.js — lightweight card-flight animations (transform/opacity only,
// friendly to the iPad Air 1's compositor). Cards fly from the deck to
// seats on draws, from seats to the discard pile on plays, and between
// seats on payments.

import { el, qs } from './dom.js';
import { cardEl, backEl } from './cardview.js';

export function fly(fromRect, toRect, contentEl, delay) {
  var layer = qs('#fx-layer');
  if (!layer || !fromRect || !toRect) return;
  var node = el('div', { class: 'fly' });
  node.appendChild(contentEl);
  node.style.left = fromRect.left + (fromRect.width / 2) - 36 + 'px';
  node.style.top = fromRect.top + (fromRect.height / 2) - 50 + 'px';
  layer.appendChild(node);
  var dx = (toRect.left + toRect.width / 2) - (fromRect.left + fromRect.width / 2);
  var dy = (toRect.top + toRect.height / 2) - (fromRect.top + fromRect.height / 2);
  setTimeout(function () {
    node.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(.65)';
    node.style.opacity = '0';
  }, 30 + (delay || 0));
  setTimeout(function () {
    if (node.parentNode) node.parentNode.removeChild(node);
  }, 650 + (delay || 0));
}

function rectOf(sel) {
  var n = qs(sel);
  return n ? n.getBoundingClientRect() : null;
}

function seatRect(playerIdx) {
  if (playerIdx === 0) return rectOf('#hand');
  var n = document.querySelector('.opp[data-player="' + playerIdx + '"]');
  return n ? n.getBoundingClientRect() : null;
}

// Consume state.events and turn them into flights. Called right after a
// render so source/target rects are current.
export function animateEvents(state) {
  var events = state.events || [];
  state.events = [];
  var delay = 0;
  events.forEach(function (ev) {
    if (ev.type === 'draw') {
      var n = Math.min(ev.count, 5);
      for (var i = 0; i < n; i++) {
        fly(rectOf('#deck-stack'), seatRect(ev.player), backEl('small'), delay);
        delay += 90;
      }
    } else if ((ev.type === 'action' || ev.type === 'rent') && ev.player !== 0 && ev.card) {
      fly(seatRect(ev.player), rectOf('#discard-stack'), cardEl(ev.card, 'small'), delay);
      delay += 130;
    } else if (ev.type === 'pay') {
      fly(seatRect(ev.from), seatRect(ev.to), backEl('small'), delay);
      delay += 130;
    } else if (ev.type === 'jsn' && ev.player !== 0 && ev.card) {
      fly(seatRect(ev.player), rectOf('#discard-stack'), cardEl(ev.card, 'small'), delay);
      delay += 130;
    }
  });
}
