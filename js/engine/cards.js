// cards.js — card and deck definitions for Magnate.
//
// The census mirrors the official 106-card Monopoly Deal deck exactly
// (counts, values, rent ladders, set sizes). Street names and the game
// title are original. Syntax note for the whole codebase: this app runs
// unbundled on Safari 12 (iPad Air 1, iOS 12.5.7) — ES2018 only. No
// optional chaining, no nullish coalescing, no class fields.

export var COLORS = {
  brown:     { key: 'brown',     label: 'Brown',      size: 2, rent: [1, 2],       value: 1, hex: '#7a4a21', ink: '#fff', buildable: true },
  lightblue: { key: 'lightblue', label: 'Light Blue', size: 3, rent: [1, 2, 3],    value: 1, hex: '#9fd6e8', ink: '#123', buildable: true },
  magenta:   { key: 'magenta',   label: 'Magenta',    size: 3, rent: [1, 2, 4],    value: 2, hex: '#c2418f', ink: '#fff', buildable: true },
  orange:    { key: 'orange',    label: 'Orange',     size: 3, rent: [1, 3, 5],    value: 2, hex: '#e58a2c', ink: '#fff', buildable: true },
  red:       { key: 'red',       label: 'Red',        size: 3, rent: [2, 3, 6],    value: 3, hex: '#c33a32', ink: '#fff', buildable: true },
  yellow:    { key: 'yellow',    label: 'Yellow',     size: 3, rent: [2, 4, 6],    value: 3, hex: '#e8c53a', ink: '#5a4500', buildable: true },
  green:     { key: 'green',     label: 'Green',      size: 3, rent: [2, 4, 7],    value: 4, hex: '#2e8b47', ink: '#fff', buildable: true },
  darkblue:  { key: 'darkblue',  label: 'Dark Blue',  size: 2, rent: [3, 8],       value: 4, hex: '#27479e', ink: '#fff', buildable: true },
  railroad:  { key: 'railroad',  label: 'Railroad',   size: 4, rent: [1, 2, 3, 4], value: 2, hex: '#3a3a3a', ink: '#fff', buildable: false },
  utility:   { key: 'utility',   label: 'Utility',    size: 2, rent: [1, 2],       value: 2, hex: '#98b58a', ink: '#213018', buildable: false }
};

export var COLOR_KEYS = Object.keys(COLORS);

var STREETS = {
  brown:     ['Tannery Row', 'Cobble Court'],
  lightblue: ['Seabreeze Avenue', 'Harborview Walk', 'Lighthouse Lane'],
  magenta:   ['Orchid Plaza', 'Velvet Parade', 'Rosewater Boulevard'],
  orange:    ['Foundry Street', 'Clockwork Avenue', 'Marmalade Row'],
  red:       ['Ember Boulevard', 'Cinder Street', 'Lantern Square'],
  yellow:    ['Goldenrod Avenue', 'Sunfield Street', 'Amber Heights'],
  green:     ['Ivygate Gardens', 'Fernbrook Drive', 'Willowmere Park'],
  darkblue:  ['Regent Crown Way', 'Sapphire Promenade'],
  railroad:  ['Northline Railway', 'Eastport Railway', 'Southgate Railway', 'Westbridge Railway'],
  utility:   ['City Waterworks', 'Grand Electric Co.']
};

// Card mechanics mirror the classic game exactly; the six distinctive
// card names are original to Magnate (see the in-game rules for the
// mapping familiar players will want).
export var ACTIONS = {
  dealBreaker:  { key: 'dealBreaker',  name: 'Takeover',        value: 5, count: 2,  text: 'Steal a complete set from any player, including any House or Hotel on it.' },
  justSayNo:    { key: 'justSayNo',    name: 'Veto',            value: 4, count: 3,  text: 'Cancel an action card played against you. Can itself be cancelled by another Veto.' },
  passGo:       { key: 'passGo',       name: 'Windfall',        value: 1, count: 10, text: 'Draw 2 extra cards.' },
  forcedDeal:   { key: 'forcedDeal',   name: 'Hard Bargain',    value: 3, count: 3,  text: 'Swap one of your properties for one of another player’s. Neither may come from a complete set.' },
  slyDeal:      { key: 'slyDeal',      name: 'Land Grab',       value: 3, count: 3,  text: 'Steal a property from any player. It may not come from a complete set.' },
  debtCollector:{ key: 'debtCollector',name: 'Debt Collector',  value: 3, count: 3,  text: 'One player of your choice pays you 5M.' },
  birthday:     { key: 'birthday',     name: 'Pass the Hat',    value: 2, count: 3,  text: 'Every player pays you 2M.' },
  house:        { key: 'house',        name: 'House',           value: 3, count: 3,  text: 'Add to a complete set to add 3M to its rent. Not on Railroads or Utilities.' },
  hotel:        { key: 'hotel',        name: 'Hotel',           value: 4, count: 2,  text: 'Add to a complete set that has a House to add 4M more to its rent.' },
  doubleRent:   { key: 'doubleRent',   name: 'Double The Rent', value: 1, count: 2,  text: 'Play with a rent card to double the rent. Counts as one of your 3 plays.' }
};

export var DEBT_COLLECTOR_AMOUNT = 5;
export var BIRTHDAY_AMOUNT = 2;
export var HOUSE_RENT_BONUS = 3;
export var HOTEL_RENT_BONUS = 4;
export var HAND_LIMIT = 7;
export var PLAYS_PER_TURN = 3;
export var DRAW_PER_TURN = 2;
export var DRAW_ON_EMPTY_HAND = 5;
export var SETS_TO_WIN = 3;

// Money cards: value x quantity, 20 cards / 57M total.
var MONEY = [[10, 1], [5, 2], [4, 3], [3, 3], [2, 5], [1, 6]];

// Two-colour property wildcards: [colorA, colorB, value, quantity]
var WILDS = [
  ['darkblue', 'green', 4, 1],
  ['green', 'railroad', 4, 1],
  ['utility', 'railroad', 2, 1],
  ['lightblue', 'brown', 1, 1],
  ['lightblue', 'railroad', 4, 1],
  ['magenta', 'orange', 2, 2],
  ['red', 'yellow', 3, 2]
];
var RAINBOW_WILD_COUNT = 2;

// Two-colour rent cards: [colorA, colorB], all worth 1M, 2 of each.
var RENTS = [
  ['green', 'darkblue'],
  ['brown', 'lightblue'],
  ['magenta', 'orange'],
  ['railroad', 'utility'],
  ['red', 'yellow']
];
var WILD_RENT_COUNT = 3;
var WILD_RENT_VALUE = 3;

export function buildDeck() {
  var deck = [];
  var id = 0;
  function push(card) {
    card.id = 'c' + (id++);
    deck.push(card);
  }

  MONEY.forEach(function (mv) {
    for (var i = 0; i < mv[1]; i++) push({ kind: 'money', value: mv[0] });
  });

  COLOR_KEYS.forEach(function (color) {
    STREETS[color].forEach(function (street) {
      push({ kind: 'property', color: color, name: street, value: COLORS[color].value });
    });
  });

  WILDS.forEach(function (w) {
    for (var i = 0; i < w[3]; i++) {
      push({ kind: 'wild', colors: [w[0], w[1]], value: w[2] });
    }
  });
  for (var r = 0; r < RAINBOW_WILD_COUNT; r++) {
    push({ kind: 'wild', colors: 'all', value: 0 });
  }

  RENTS.forEach(function (pair) {
    for (var i = 0; i < 2; i++) {
      push({ kind: 'rent', colors: [pair[0], pair[1]], value: 1 });
    }
  });
  for (var wr = 0; wr < WILD_RENT_COUNT; wr++) {
    push({ kind: 'rent', colors: 'all', value: WILD_RENT_VALUE });
  }

  Object.keys(ACTIONS).forEach(function (key) {
    var a = ACTIONS[key];
    for (var i = 0; i < a.count; i++) {
      push({ kind: 'action', action: key, value: a.value });
    }
  });

  return deck;
}

export function isRainbowWild(card) {
  return card.kind === 'wild' && card.colors === 'all';
}

// True when a card sitting on the table may be offered as payment.
// Official rule: the two rainbow wilds have no cash value and can never
// be used to pay. Everything else (money, properties, two-colour wilds,
// House/Hotel, banked action cards) is payable.
export function isPayable(card) {
  return !isRainbowWild(card);
}

export function cardName(card) {
  if (card.kind === 'money') return card.value + 'M';
  if (card.kind === 'property') return card.name;
  if (card.kind === 'wild') {
    if (card.colors === 'all') return 'Property Wild (any colour)';
    return 'Property Wild (' + COLORS[card.colors[0]].label + ' / ' + COLORS[card.colors[1]].label + ')';
  }
  if (card.kind === 'rent') {
    if (card.colors === 'all') return 'Rent (any colour)';
    return 'Rent (' + COLORS[card.colors[0]].label + ' / ' + COLORS[card.colors[1]].label + ')';
  }
  return ACTIONS[card.action].name;
}
