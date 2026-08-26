// cardview.js — code-drawn card faces (no image assets).
// Cards are DOM + inline SVG; colours come from engine metadata.

import { COLORS, COLOR_KEYS, ACTIONS } from '../engine/cards.js';
import { el } from './dom.js';

var MONEY_TINTS = {
  1: '#8a9199', 2: '#c98ea8', 3: '#4fa08a', 4: '#8f7fc0', 5: '#d08a4e', 10: '#c9a13b'
};

function svg(markup) {
  var span = document.createElement('span');
  span.className = 'icon-wrap';
  span.innerHTML = '<svg viewBox="0 0 24 24" class="icon" aria-hidden="true">' + markup + '</svg>';
  return span;
}

var ICONS = {
  dealBreaker: '<path d="M4 10h7v10H4z" fill="currentColor"/><path d="M13 4h7v10h-7z" fill="currentColor" opacity=".55"/><path d="M9 3l6 18" stroke="currentColor" stroke-width="2" fill="none"/>',
  justSayNo: '<path d="M7.8 3h8.4L21 7.8v8.4L16.2 21H7.8L3 16.2V7.8z" fill="currentColor"/><rect x="6.5" y="10.6" width="11" height="2.8" rx="1.4" fill="#fff"/>',
  passGo: '<rect x="4" y="6" width="10" height="14" rx="1.5" fill="currentColor" opacity=".55"/><rect x="9" y="4" width="10" height="14" rx="1.5" fill="currentColor"/><path d="M14 8v6M11 11h6" stroke="#fff" stroke-width="2"/>',
  forcedDeal: '<path d="M4 8h12l-3-3m3 3-3 3" stroke="currentColor" stroke-width="2" fill="none"/><path d="M20 16H8l3-3m-3 3 3 3" stroke="currentColor" stroke-width="2" fill="none"/>',
  slyDeal: '<rect x="4" y="9" width="9" height="12" rx="1.5" fill="currentColor" opacity=".55"/><path d="M20 4l-7 7m0-6.5V11h6.5" stroke="currentColor" stroke-width="2" fill="none"/>',
  debtCollector: '<ellipse cx="12" cy="7" rx="7" ry="3" fill="currentColor"/><path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7" fill="currentColor" opacity=".7"/><path d="M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" fill="currentColor" opacity=".45"/>',
  birthday: '<path d="M4 14c0-2 3.6-3.5 8-3.5s8 1.5 8 3.5" stroke="currentColor" stroke-width="2" fill="none"/><path d="M3 14h18v3H3z" fill="currentColor"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" stroke="currentColor" stroke-width="2" fill="none"/>',
  house: '<path d="M12 4l8 7h-2.5v8h-11v-8H4z" fill="currentColor"/>',
  hotel: '<rect x="5" y="7" width="14" height="14" fill="currentColor"/><path d="M8 4h8v3H8z" fill="currentColor"/><g fill="#fff"><rect x="8" y="10" width="2.4" height="2.4"/><rect x="13.6" y="10" width="2.4" height="2.4"/><rect x="8" y="15" width="2.4" height="2.4"/><rect x="13.6" y="15" width="2.4" height="2.4"/></g>',
  doubleRent: ''
};

function skylineSvg(ink) {
  return '<svg viewBox="0 0 100 34" class="skyline" preserveAspectRatio="none" aria-hidden="true">' +
    '<g fill="' + ink + '" opacity=".85">' +
    '<rect x="4" y="16" width="12" height="18"/><rect x="18" y="8" width="10" height="26"/>' +
    '<rect x="30" y="20" width="14" height="14"/><rect x="46" y="12" width="9" height="22"/>' +
    '<rect x="57" y="4" width="12" height="30"/><rect x="71" y="18" width="10" height="16"/>' +
    '<rect x="83" y="10" width="12" height="24"/>' +
    '<rect x="20" y="11" width="2" height="2" fill="#fff" opacity=".8"/><rect x="24" y="11" width="2" height="2" fill="#fff" opacity=".8"/>' +
    '<rect x="59" y="8" width="2" height="2" fill="#fff" opacity=".8"/><rect x="63" y="8" width="2" height="2" fill="#fff" opacity=".8"/>' +
    '<rect x="59" y="13" width="2" height="2" fill="#fff" opacity=".8"/><rect x="85" y="14" width="2" height="2" fill="#fff" opacity=".8"/>' +
    '</g></svg>';
}

function rainbowGradient() {
  var stops = ['brown', 'red', 'orange', 'yellow', 'green', 'lightblue', 'darkblue', 'magenta'];
  var parts = stops.map(function (c, i) {
    return COLORS[c].hex + ' ' + Math.round(i * 100 / (stops.length - 1)) + '%';
  });
  return 'linear-gradient(90deg,' + parts.join(',') + ')';
}

function valueBadge(card) {
  return el('span', { class: 'val-badge', text: card.value + 'M' });
}

function rentLadder(color) {
  var meta = COLORS[color];
  var rows = meta.rent.map(function (m, i) {
    return el('div', { class: 'rrow' }, [
      el('span', { class: 'rrow-n', text: String(i + 1) }),
      el('span', { class: 'rrow-m', text: m + 'M' })
    ]);
  });
  return el('div', { class: 'rent-ladder' }, rows);
}

export function cardEl(card, cls) {
  var root = el('div', { class: 'card ' + (cls || ''), 'data-card-id': card.id });

  if (card.kind === 'money') {
    root.className += ' c-money';
    root.style.setProperty('--tint', MONEY_TINTS[card.value] || '#999');
    root.appendChild(el('div', { class: 'money-oval' }, [
      el('span', { class: 'money-val', text: String(card.value) }),
      el('span', { class: 'money-m', text: 'M' })
    ]));
    root.appendChild(el('div', { class: 'money-word', text: 'MONEY' }));
    return root;
  }

  if (card.kind === 'property') {
    var meta = COLORS[card.color];
    root.className += ' c-prop';
    root.style.setProperty('--cc', meta.hex);
    root.style.setProperty('--ci', meta.ink);
    root.appendChild(el('div', { class: 'prop-band', text: card.name }));
    var art = el('div', { class: 'prop-art' });
    art.innerHTML = skylineSvg(meta.hex);
    root.appendChild(art);
    root.appendChild(rentLadder(card.color));
    root.appendChild(el('div', { class: 'prop-color-label', text: meta.label }));
    root.appendChild(valueBadge(card));
    return root;
  }

  if (card.kind === 'wild') {
    root.className += ' c-wild';
    if (card.colors === 'all') {
      var band = el('div', { class: 'prop-band wild-band', text: 'WILD — ANY COLOUR' });
      band.style.background = rainbowGradient();
      band.style.color = '#fff';
      band.style.textShadow = '0 1px 2px rgba(0,0,0,.6)';
      root.appendChild(band);
      root.appendChild(el('div', { class: 'wild-body' }, [
        el('div', { class: 'wild-big', text: 'WILD' }),
        el('div', { class: 'wild-note', text: 'Counts as any colour. No cash value — never used to pay. Cannot complete a set alone.' })
      ]));
      root.appendChild(el('span', { class: 'val-badge val-zero', text: '0' }));
      return root;
    }
    var a = COLORS[card.colors[0]], b = COLORS[card.colors[1]];
    var band2 = el('div', { class: 'prop-band wild-band', text: 'WILD' });
    band2.style.background = 'linear-gradient(90deg,' + a.hex + ' 0%,' + a.hex + ' 50%,' + b.hex + ' 50%,' + b.hex + ' 100%)';
    band2.style.color = '#fff';
    band2.style.textShadow = '0 1px 2px rgba(0,0,0,.5)';
    root.appendChild(band2);
    root.appendChild(el('div', { class: 'wild-two' }, [
      el('div', { class: 'wild-half', style: 'border-color:' + a.hex }, [
        el('div', { class: 'wild-half-name', text: a.label, style: 'color:' + a.hex }),
        rentLadder(card.colors[0])
      ]),
      el('div', { class: 'wild-half', style: 'border-color:' + b.hex }, [
        el('div', { class: 'wild-half-name', text: b.label, style: 'color:' + b.hex }),
        rentLadder(card.colors[1])
      ])
    ]));
    root.appendChild(valueBadge(card));
    return root;
  }

  if (card.kind === 'rent') {
    root.className += ' c-rent';
    var rband = el('div', { class: 'prop-band', text: 'RENT, PLEASE' });
    if (card.colors === 'all') {
      rband.style.background = rainbowGradient();
      rband.style.color = '#fff';
      rband.style.textShadow = '0 1px 2px rgba(0,0,0,.6)';
    } else {
      var ca = COLORS[card.colors[0]], cb = COLORS[card.colors[1]];
      rband.style.background = 'linear-gradient(90deg,' + ca.hex + ' 0%,' + ca.hex + ' 50%,' + cb.hex + ' 50%,' + cb.hex + ' 100%)';
      rband.style.color = '#fff';
      rband.style.textShadow = '0 1px 2px rgba(0,0,0,.5)';
    }
    root.appendChild(rband);
    var circle = el('div', { class: 'rent-circle' });
    if (card.colors === 'all') {
      circle.style.background = rainbowGradient();
      circle.appendChild(el('span', { text: 'ANY' }));
    } else {
      circle.style.background = 'linear-gradient(135deg,' + COLORS[card.colors[0]].hex + ' 0%,' + COLORS[card.colors[0]].hex + ' 50%,' + COLORS[card.colors[1]].hex + ' 50%,' + COLORS[card.colors[1]].hex + ' 100%)';
    }
    root.appendChild(el('div', { class: 'rent-mid' }, [circle]));
    root.appendChild(el('div', {
      class: 'act-text',
      text: card.colors === 'all'
        ? 'Charge ONE player rent for one of your colours.'
        : 'ALL players pay you rent for your ' + COLORS[card.colors[0]].label + ' or ' + COLORS[card.colors[1]].label + ' properties.'
    }));
    root.appendChild(valueBadge(card));
    return root;
  }

  // action card
  var info = ACTIONS[card.action];
  root.className += ' c-action a-' + card.action;
  root.appendChild(el('div', { class: 'act-band', text: 'ACTION' }));
  root.appendChild(el('div', { class: 'act-name', text: info.name }));
  var iconBox = el('div', { class: 'act-icon' });
  if (card.action === 'doubleRent') {
    iconBox.appendChild(el('span', { class: 'x2', text: '×2' }));
  } else {
    iconBox.appendChild(svg(ICONS[card.action]));
  }
  root.appendChild(iconBox);
  root.appendChild(el('div', { class: 'act-text', text: info.text }));
  root.appendChild(valueBadge(card));
  return root;
}

export function backEl(cls) {
  return el('div', { class: 'card c-back ' + (cls || '') }, [
    el('div', { class: 'back-ring' }, [el('span', { text: 'M' })])
  ]);
}

// Small chip for table zones and pickers.
export function chipEl(card) {
  var chip = el('span', { class: 'chip', 'data-card-id': card.id });
  if (card.kind === 'property') {
    chip.style.background = COLORS[card.color].hex;
    chip.title = card.name;
  } else if (card.kind === 'wild') {
    if (card.colors === 'all') {
      chip.style.background = rainbowGradient();
      chip.className += ' chip-wild';
    } else {
      chip.style.background = 'linear-gradient(135deg,' + COLORS[card.colors[0]].hex + ' 0%,' + COLORS[card.colors[0]].hex + ' 50%,' + COLORS[card.colors[1]].hex + ' 50%,' + COLORS[card.colors[1]].hex + ' 100%)';
      chip.className += ' chip-wild';
    }
    chip.appendChild(el('span', { class: 'chip-w', text: 'W' }));
  } else if (card.kind === 'action' && (card.action === 'house' || card.action === 'hotel')) {
    chip.className += ' chip-bld';
    chip.appendChild(el('span', { text: card.action === 'house' ? 'H' : 'HO' }));
  }
  return chip;
}
