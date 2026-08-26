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

// Centre-table showcase: when another player plays a card, show its full
// face large over the felt for a beat before it flies on.
var splashTimer = null;
export function splash(card) {
  var layer = qs('#fx-layer');
  if (!layer) return;
  var old = document.getElementById('play-splash');
  if (old && old.parentNode) old.parentNode.removeChild(old);
  if (splashTimer) { clearTimeout(splashTimer); splashTimer = null; }

  var node = el('div', { class: 'play-splash', id: 'play-splash' });
  node.appendChild(cardEl(card, 'big'));
  layer.appendChild(node);
  // double rAF so the transition from the initial state actually runs
  var raf = window.requestAnimationFrame
    ? function (f) { window.requestAnimationFrame(f); }
    : function (f) { setTimeout(f, 16); };
  raf(function () { raf(function () { node.className = 'play-splash on'; }); });
  splashTimer = setTimeout(function () {
    node.className = 'play-splash';
    setTimeout(function () {
      if (node.parentNode) node.parentNode.removeChild(node);
    }, 260);
  }, 950);
}

// Consume state.events and turn them into flights. Called right after a
// render so source/target rects are current.
export function animateEvents(state) {
  var events = state.events || [];
  state.events = [];
  var delay = 0;
  events.forEach(function (ev) {
    if (ev.card && typeof ev.player === 'number' && ev.player !== 0 &&
        (ev.type === 'action' || ev.type === 'rent' || ev.type === 'property' ||
         ev.type === 'bank' || ev.type === 'build' || ev.type === 'jsn')) {
      splash(ev.card);
    }
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
