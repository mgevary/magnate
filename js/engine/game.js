// game.js — the Magnate rules engine.
//
// Implements the full official Monopoly Deal ruleset, including the
// Hasbro FAQ rulings:
//   - Sly Deal / Forced Deal cannot touch complete sets (either side).
//   - Deal Breaker takes a whole complete set, House/Hotel included.
//   - Double The Rent: rent only, each copy costs a play, two stack to x4.
//   - Two-colour rent charges ALL opponents; any-colour rent charges ONE.
//   - Rainbow wilds have no value and are NEVER given as payment; a player
//     with nothing payable on the table pays nothing ("no change" both ways).
//   - House before Hotel, complete sets only, never on Railroads/Utilities.
//     A House/Hotel orphaned by a broken set goes to its owner's bank.
//     House/Hotel may be paid with, and moved between complete sets freely
//     on your own turn.
//   - Properties and wilds may be rearranged freely on your own turn.
//   - Extra properties of a colour start a second set; zones never exceed
//     set size. Complete sets may not consist of rainbow wilds alone
//     (two-colour wilds alone are fine).
//   - Just Say No cancels an action against you and may be countered by
//     another Just Say No. Playing one as a response never costs a play.
//   - Win: first player holding 3 complete sets in 3 different colours.
//
// The engine is a validating state machine: `dispatch(state, action)`
// mutates the state, appends UI events to state.events, and throws on
// illegal actions. State is plain JSON throughout (safe for localStorage).

import {
  COLORS, ACTIONS, buildDeck, isRainbowWild, isPayable, cardName,
  DEBT_COLLECTOR_AMOUNT, BIRTHDAY_AMOUNT, HOUSE_RENT_BONUS, HOTEL_RENT_BONUS,
  HAND_LIMIT, PLAYS_PER_TURN, DRAW_PER_TURN, DRAW_ON_EMPTY_HAND, SETS_TO_WIN
} from './cards.js';

/* ── small utilities ─────────────────────────────────────────────── */

// Deterministic PRNG (mulberry32) so tests and simulations can replay.
export function makeRng(seed) {
  var s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    var t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(rng() * (i + 1));
    var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr;
}

function fail(msg) { throw new Error(msg); }

function removeById(arr, id) {
  for (var i = 0; i < arr.length; i++) {
    if (arr[i].id === id) return arr.splice(i, 1)[0];
  }
  return null;
}

function findById(arr, id) {
  for (var i = 0; i < arr.length; i++) {
    if (arr[i].id === id) return arr[i];
  }
  return null;
}

/* ── state queries (exported for UI and bots) ────────────────────── */

export function isZoneComplete(zone) {
  var size = COLORS[zone.color].size;
  if (zone.cards.length < size) return false;
  // Hasbro FAQ 942: a set always needs at least one STANDARD property
  // card — any number of wildcards may fill the rest, but wildcards
  // alone (two-colour or rainbow) never complete a set.
  for (var i = 0; i < zone.cards.length; i++) {
    if (zone.cards[i].kind === 'property') return true;
  }
  return false;
}

export function completeZones(player) {
  return player.sets.filter(isZoneComplete);
}

// Number of complete sets in distinct colours.
export function completeSetColorCount(player) {
  var seen = {};
  completeZones(player).forEach(function (z) { seen[z.color] = true; });
  return Object.keys(seen).length;
}

export function zoneRent(zone) {
  var meta = COLORS[zone.color];
  var idx = Math.min(zone.cards.length, meta.size) - 1;
  if (idx < 0) return 0;
  var rent = meta.rent[idx];
  if (isZoneComplete(zone)) {
    if (zone.house) rent += HOUSE_RENT_BONUS;
    if (zone.hotel) rent += HOTEL_RENT_BONUS;
  }
  return rent;
}

export function bestRentForColor(player, color) {
  var best = 0;
  player.sets.forEach(function (z) {
    if (z.color === color) best = Math.max(best, zoneRent(z));
  });
  return best;
}

// Every card the player could legally offer as payment (bank + table).
export function payableCards(player) {
  var out = [];
  player.bank.forEach(function (c) { out.push(c); });
  player.sets.forEach(function (z) {
    z.cards.forEach(function (c) { if (isPayable(c)) out.push(c); });
    if (z.house) out.push(z.house);
    if (z.hotel) out.push(z.hotel);
  });
  return out;
}

export function totalPayable(player) {
  return payableCards(player).reduce(function (s, c) { return s + c.value; }, 0);
}

export function bankValue(player) {
  return player.bank.reduce(function (s, c) { return s + c.value; }, 0);
}

// Where does a card currently live on this player's table? → zone or null.
function zoneOfCard(player, cardId) {
  for (var i = 0; i < player.sets.length; i++) {
    var z = player.sets[i];
    if (findById(z.cards, cardId)) return z;
    if (z.house && z.house.id === cardId) return z;
    if (z.hotel && z.hotel.id === cardId) return z;
  }
  return null;
}

function playerHasJsn(player) {
  return player.hand.some(function (c) { return c.kind === 'action' && c.action === 'justSayNo'; });
}

/* ── events + log ────────────────────────────────────────────────── */

function emit(state, ev) { state.events.push(ev); }

// Verb agreement when the human seat is named "You" ("You pays" → "You pay").
var YOU_VERBS = {
  plays: 'play', pays: 'pay', banks: 'bank', charges: 'charge', adds: 'add',
  takes: 'take', steals: 'steal', swaps: 'swap', discards: 'discard',
  moves: 'move', rearranges: 'rearrange', sends: 'send', passes: 'pass',
  has: 'have'
};

function log(state, msg) {
  if (msg.indexOf('You ') === 0) {
    var rest = msg.slice(4);
    var space = rest.indexOf(' ');
    var verb = space === -1 ? rest : rest.slice(0, space);
    if (YOU_VERBS[verb]) msg = 'You ' + YOU_VERBS[verb] + rest.slice(verb.length);
  }
  state.log.push(msg);
  if (state.log.length > 200) state.log.shift();
}

function pname(state, idx) { return state.players[idx].name; }

/* ── setup ───────────────────────────────────────────────────────── */

export function newGame(config) {
  var seed = (config && typeof config.seed === 'number') ? config.seed : Math.floor(Math.random() * 0xFFFFFFFF);
  var rng = makeRng(seed);
  var names = config.players; // [{name, isBot, personality}]
  if (!names || names.length < 2 || names.length > 5) fail('2-5 players required');

  var deck = shuffle(buildDeck(), rng);
  var players = names.map(function (p, i) {
    return {
      id: i, name: p.name, isBot: !!p.isBot,
      personality: p.personality || 'balanced',
      hand: [], bank: [], sets: []
    };
  });

  var state = {
    seed: seed,
    players: players,
    deck: deck,
    discard: [],
    active: 0,
    playsLeft: PLAYS_PER_TURN,
    phase: 'main',
    pending: null,
    winner: null,
    armed: null,
    turnCount: 1,
    zoneSeq: 0,
    events: [],
    log: []
  };

  for (var r = 0; r < 5; r++) {
    players.forEach(function (p) { p.hand.push(state.deck.pop()); });
  }
  startTurn(state);
  return state;
}

function drawCards(state, playerIdx, n) {
  var p = state.players[playerIdx];
  var drawn = 0;
  for (var i = 0; i < n; i++) {
    if (state.deck.length === 0) {
      if (state.discard.length === 0) break; // nothing left anywhere
      var rng = makeRng(state.seed + state.turnCount);
      state.deck = shuffle(state.discard.splice(0), rng);
      log(state, 'The discard pile is shuffled into a new draw pile.');
    }
    p.hand.push(state.deck.pop());
    drawn++;
  }
  if (drawn > 0) emit(state, { type: 'draw', player: playerIdx, count: drawn });
  return drawn;
}

function startTurn(state) {
  var p = state.players[state.active];
  // An off-turn completion converts to the win here, on their own turn.
  if (completeSetColorCount(p) >= SETS_TO_WIN) {
    declareWin(state, state.active);
    return;
  }
  var n = p.hand.length === 0 ? DRAW_ON_EMPTY_HAND : DRAW_PER_TURN;
  emit(state, { type: 'turn', player: state.active });
  log(state, '— ' + p.name + '’s turn —');
  drawCards(state, state.active, n);
  state.playsLeft = PLAYS_PER_TURN;
  state.phase = 'main';
}

function advanceTurn(state) {
  state.active = (state.active + 1) % state.players.length;
  state.turnCount++;
  startTurn(state);
}

/* ── win check ───────────────────────────────────────────────────── */

function declareWin(state, idx) {
  state.winner = idx;
  state.phase = 'over';
  state.pending = null;
  emit(state, { type: 'win', player: idx });
  log(state, '★ ' + pname(state, idx) + ' wins with ' + SETS_TO_WIN + ' complete sets!');
}

// Official 2008 rulebook: "If you realize you've won during someone
// else's turn, you must wait until it's your turn to say it!" — so only
// the ACTIVE player wins immediately; an off-turn completion (e.g. via a
// Hard Bargain hand-over) is announced and converts at the start of that
// player's next turn, giving opponents one last window to break the set.
function checkWin(state) {
  if (state.winner !== null) return;
  if (completeSetColorCount(state.players[state.active]) >= SETS_TO_WIN) {
    declareWin(state, state.active);
    return;
  }
  for (var i = 0; i < state.players.length; i++) {
    if (i === state.active) continue;
    var has3 = completeSetColorCount(state.players[i]) >= SETS_TO_WIN;
    if (has3 && state.armed !== i) {
      state.armed = i;
      log(state, '⚠ ' + pname(state, i) + ' holds ' + SETS_TO_WIN + ' complete sets — they win at the start of their next turn unless a set is broken!');
    } else if (!has3 && state.armed === i) {
      state.armed = null;
      log(state, pname(state, i) + ' no longer holds ' + SETS_TO_WIN + ' complete sets.');
    }
  }
}

/* ── placement helpers ───────────────────────────────────────────── */

function newZone(state, player, color) {
  var z = { id: 'z' + (state.zoneSeq++), color: color, cards: [], house: null, hotel: null };
  player.sets.push(z);
  return z;
}

// Remove empty zones; bank any House/Hotel left on a no-longer-complete set.
function cleanupZones(state, playerIdx) {
  var player = state.players[playerIdx];
  player.sets = player.sets.filter(function (z) { return z.cards.length > 0; });
  player.sets.forEach(function (z) {
    if ((z.house || z.hotel) && !isZoneComplete(z)) {
      if (z.hotel) {
        player.bank.push(z.hotel);
        log(state, 'A Hotel from ' + player.name + '’s broken set moves to their bank.');
        z.hotel = null;
      }
      if (z.house) {
        player.bank.push(z.house);
        log(state, 'A House from ' + player.name + '’s broken set moves to their bank.');
        z.house = null;
      }
    }
  });
}

// Place a property/wild into a player's area. `color` must already be set
// on the card for wilds. Fills a non-full zone of that colour, else starts
// a new one. Zones never exceed set size.
function autoPlace(state, playerIdx, card) {
  var player = state.players[playerIdx];
  var color = card.color;
  if (!color) color = (card.kind === 'wild' && card.colors !== 'all') ? card.colors[0] : 'brown';
  card.color = color;
  var size = COLORS[color].size;
  for (var i = 0; i < player.sets.length; i++) {
    var z = player.sets[i];
    if (z.color === color && z.cards.length < size) { z.cards.push(card); return z; }
  }
  var nz = newZone(state, player, color);
  nz.cards.push(card);
  return nz;
}

// Pure validation of a placement choice — called BEFORE any state is
// mutated so a rejected play never costs a card or a play.
function validatePlacement(state, playerIdx, card, color, zoneId) {
  if (card.kind === 'wild') {
    if (!color) fail('choose a colour for the wildcard');
    if (card.colors !== 'all' && card.colors.indexOf(color) === -1) fail('wildcard cannot be that colour');
  } else {
    if (color && color !== card.color) fail('property colour is fixed');
    color = card.color;
  }
  if (zoneId) {
    var z = findById(state.players[playerIdx].sets, zoneId);
    if (!z) fail('no such set');
    if (z.color !== color) fail('set is a different colour');
    if (z.cards.length >= COLORS[color].size) fail('that set is already full');
  }
}

// Place into a specific zone (or new zone) with validation. Used for the
// acting player's own explicit choices.
function placeIntoZone(state, playerIdx, card, color, zoneId) {
  var player = state.players[playerIdx];
  if (card.kind === 'property') {
    if (color && color !== card.color) fail('property colour is fixed');
    color = card.color;
  } else { // wild
    if (!color) fail('choose a colour for the wildcard');
    if (card.colors !== 'all' && card.colors.indexOf(color) === -1) fail('wildcard cannot be that colour');
  }
  card.color = color;
  var size = COLORS[color].size;
  if (zoneId) {
    var z = findById(player.sets, zoneId);
    if (!z) fail('no such set');
    if (z.color !== color) fail('set is a different colour');
    if (z.cards.length >= size) fail('that set is already full');
    z.cards.push(card);
    return z;
  }
  // No zone given: fill first open zone of the colour, else start fresh.
  return autoPlace(state, playerIdx, card);
}

/* ── pending (interrupt) machinery ───────────────────────────────── */

// A "demand" asks victims for money (rent / birthday / debt collector).
// A "take" moves specific cards (sly deal / forced deal / deal breaker).
// Every claim opens with a Just Say No window that alternates between the
// victim and the source until someone declines; an odd number of JSNs
// cancels the claim.

function openDemand(state, action, source, victims, amount, detail) {
  state.pending = {
    kind: 'demand', action: action, source: source, amount: amount,
    detail: detail || null,
    claims: victims.map(function (v) {
      return { victim: v, amount: amount, stage: 'jsn', jsnCount: 0, waitingOn: v };
    }),
    current: 0
  };
  normalizePending(state);
}

function openTake(state, action, source, victim, detail) {
  state.pending = {
    kind: 'take', action: action, source: source, amount: 0, detail: detail,
    claims: [{ victim: victim, stage: 'jsn', jsnCount: 0, waitingOn: victim }],
    current: 0
  };
  normalizePending(state);
}

function currentClaim(state) {
  var p = state.pending;
  if (!p) return null;
  return p.claims[p.current] || null;
}

// Skip stages that need no input: JSN windows where the waiting player has
// no JSN card, and payments where the victim has nothing payable.
function normalizePending(state) {
  var guard = 0;
  while (state.pending && guard++ < 100) {
    var p = state.pending;
    var claim = currentClaim(state);
    if (!claim) { state.pending = null; break; }
    if (claim.stage === 'jsn') {
      var waiting = state.players[claim.waitingOn];
      if (!playerHasJsn(waiting)) { settleJsn(state, false); continue; }
      break; // real decision needed
    }
    if (claim.stage === 'pay') {
      var victim = state.players[claim.victim];
      if (payableCards(victim).length === 0) {
        log(state, victim.name + ' has nothing to pay with — the debt is written off.');
        claim.stage = 'done';
        continue;
      }
      break; // real decision needed
    }
    if (claim.stage === 'done') {
      p.current++;
      if (p.current >= p.claims.length) state.pending = null;
      continue;
    }
    break;
  }
}

// The waiting player declines (or cannot) / plays a Just Say No.
function settleJsn(state, use) {
  var p = state.pending;
  var claim = currentClaim(state);
  var waitingIdx = claim.waitingOn;
  var waiting = state.players[waitingIdx];

  if (use) {
    var jsn = null;
    for (var i = 0; i < waiting.hand.length; i++) {
      var c = waiting.hand[i];
      if (c.kind === 'action' && c.action === 'justSayNo') { jsn = c; break; }
    }
    if (!jsn) fail('no Just Say No Thanks in hand');
    removeById(waiting.hand, jsn.id);
    state.discard.push(jsn);
    claim.jsnCount++;
    emit(state, { type: 'jsn', player: waitingIdx, card: jsn });
    log(state, waiting.name + ' says No Thanks!');
    claim.waitingOn = (waitingIdx === claim.victim) ? p.source : claim.victim;
    return; // window passes to the other side
  }

  // Declined: the JSN exchange is over for this claim.
  if (claim.jsnCount % 2 === 1) {
    log(state, actionLabel(p.action) + ' against ' + pname(state, claim.victim) + ' is cancelled.');
    claim.stage = 'done';
    return;
  }
  // Action stands → execute it for this claim.
  if (p.kind === 'demand') {
    claim.stage = 'pay';
  } else {
    executeTake(state);
    claim.stage = 'done';
  }
}

function actionLabel(action) {
  if (action === 'rent') return 'the rent demand';
  if (ACTIONS[action]) return ACTIONS[action].name;
  return action;
}

function executeTake(state) {
  var p = state.pending;
  var claim = currentClaim(state);
  var source = state.players[p.source];
  var victim = state.players[claim.victim];
  var d = p.detail;

  if (p.action === 'dealBreaker') {
    var zi = -1;
    for (var i = 0; i < victim.sets.length; i++) {
      if (victim.sets[i].id === d.zoneId) { zi = i; break; }
    }
    if (zi === -1) return; // set vanished (shouldn't happen)
    var zone = victim.sets.splice(zi, 1)[0];
    source.sets.push(zone);
    emit(state, { type: 'dealBreaker', from: claim.victim, to: p.source, zone: zone.id });
    log(state, source.name + ' takes ' + victim.name + '’s ' + COLORS[zone.color].label + ' set with a Deal Breakerer!');
    cleanupZones(state, claim.victim);
    return;
  }

  if (p.action === 'slyDeal') {
    var sz = zoneOfCard(victim, d.cardId);
    if (!sz) return;
    var card = removeById(sz.cards, d.cardId);
    if (!card) return;
    cleanupZones(state, claim.victim);
    autoPlace(state, p.source, card);
    emit(state, { type: 'steal', from: claim.victim, to: p.source, card: card });
    log(state, source.name + ' steals ' + cardName(card) + ' from ' + victim.name + ' with an Extra Sly Deal.');
    return;
  }

  if (p.action === 'forcedDeal') {
    var tz = zoneOfCard(victim, d.cardId);
    var gz = zoneOfCard(source, d.giveCardId);
    if (!tz || !gz) return;
    var took = removeById(tz.cards, d.cardId);
    var gave = removeById(gz.cards, d.giveCardId);
    if (!took || !gave) return;
    cleanupZones(state, claim.victim);
    cleanupZones(state, p.source);
    autoPlace(state, p.source, took);
    autoPlace(state, claim.victim, gave);
    emit(state, { type: 'swap', from: claim.victim, to: p.source, took: took, gave: gave });
    log(state, source.name + ' swaps ' + cardName(gave) + ' for ' + victim.name + '’s ' + cardName(took) + ' (Politely Forced Deal).');
    return;
  }
}

/* ── the dispatcher ──────────────────────────────────────────────── */

export function whatsPending(state) {
  if (state.phase === 'over') return null;
  var claim = currentClaim(state);
  if (claim) {
    if (claim.stage === 'jsn') {
      return { player: claim.waitingOn, type: 'jsn', pending: state.pending, claim: claim };
    }
    if (claim.stage === 'pay') {
      return { player: claim.victim, type: 'pay', amount: claim.amount, pending: state.pending, claim: claim };
    }
  }
  if (state.phase === 'discard') {
    return { player: state.active, type: 'discard', count: state.players[state.active].hand.length - HAND_LIMIT };
  }
  return null;
}

export function dispatch(state, action) {
  state.events = [];
  if (state.phase === 'over') fail('game is over');

  var t = action.type;
  if (t === 'respondJsn') return doRespondJsn(state, action);
  if (t === 'submitPayment') return doSubmitPayment(state, action);

  if (state.pending) fail('waiting on a response');

  if (t === 'play') { doPlay(state, action); }
  else if (t === 'rearrange') { doRearrange(state, action); }
  else if (t === 'moveBuilding') { doMoveBuilding(state, action); }
  else if (t === 'endTurn') { doEndTurn(state); }
  else if (t === 'discard') { doDiscard(state, action); }
  else fail('unknown action ' + t);

  checkWin(state);
  return state;
}

function requireActive(state) {
  if (state.phase !== 'main') fail('not in main phase');
  return state.players[state.active];
}

function spendPlay(state, n) {
  if (state.playsLeft < n) fail('not enough plays left');
  state.playsLeft -= n;
}

/* ── play a card from hand ───────────────────────────────────────── */

function doPlay(state, action) {
  var me = requireActive(state);
  var card = findById(me.hand, action.cardId);
  if (!card) fail('card not in hand');

  // mode: 'bank' | 'property' | 'action' | 'rent'
  var mode = action.mode;

  if (mode === 'bank') {
    if (card.kind === 'property' || card.kind === 'wild') fail('properties cannot be banked');
    spendPlay(state, 1);
    removeById(me.hand, card.id);
    me.bank.push(card);
    emit(state, { type: 'bank', player: state.active, card: card });
    log(state, me.name + ' banks ' + cardName(card) + ' (' + card.value + 'M).');
    return;
  }

  if (mode === 'property') {
    if (card.kind !== 'property' && card.kind !== 'wild') fail('not a property');
    validatePlacement(state, state.active, card, action.color, action.zoneId);
    spendPlay(state, 1);
    removeById(me.hand, card.id);
    var zone = placeIntoZone(state, state.active, card, action.color, action.zoneId);
    emit(state, { type: 'property', player: state.active, card: card, zone: zone.id });
    log(state, me.name + ' plays ' + cardName(card) + (card.kind === 'wild' ? ' as ' + COLORS[zone.color].label : '') + '.');
    return;
  }

  if (mode === 'rent') {
    if (card.kind !== 'rent') fail('not a rent card');
    var color = action.color;
    if (!color) fail('choose a rent colour');
    if (card.colors !== 'all' && card.colors.indexOf(color) === -1) fail('rent card does not cover that colour');
    var base = bestRentForColor(me, color);
    if (base <= 0) fail('you own no ' + COLORS[color].label + ' properties');

    var doubles = action.doubles || [];
    var dtrCards = doubles.map(function (id) {
      var c = findById(me.hand, id);
      if (!c || c.kind !== 'action' || c.action !== 'doubleRent') fail('invalid Double The Rent');
      return c;
    });

    var victims;
    if (card.colors === 'all') {
      if (typeof action.target !== 'number') fail('choose a player to charge');
      if (action.target === state.active) fail('cannot charge yourself');
      if (!state.players[action.target]) fail('no such player');
      victims = [action.target];
    } else {
      victims = [];
      for (var i = 1; i < state.players.length; i++) {
        victims.push((state.active + i) % state.players.length);
      }
    }
    spendPlay(state, 1 + dtrCards.length);

    removeById(me.hand, card.id);
    state.discard.push(card);
    dtrCards.forEach(function (c) { removeById(me.hand, c.id); state.discard.push(c); });

    var amount = base * Math.pow(2, dtrCards.length);
    emit(state, { type: 'rent', player: state.active, card: card, color: color, amount: amount, doubles: dtrCards.length });
    log(state, me.name + ' charges ' + amount + 'M rent on ' + COLORS[color].label +
      (dtrCards.length ? ' (Double The Rent ×' + dtrCards.length + ')' : '') + '.');
    openDemand(state, 'rent', state.active, victims, amount, { color: color });
    return;
  }

  if (mode === 'action') {
    if (card.kind !== 'action') fail('not an action card');
    var kind = card.action;

    if (kind === 'justSayNo') fail('Just Say No Thanks is played as a response, or banked');
    if (kind === 'doubleRent') fail('Double The Rent is played with a rent card, or banked');

    if (kind === 'passGo') {
      spendPlay(state, 1);
      removeById(me.hand, card.id);
      state.discard.push(card);
      emit(state, { type: 'action', player: state.active, card: card });
      log(state, me.name + ' passes Go (twice!) and draws 2.');
      drawCards(state, state.active, 2);
      return;
    }

    if (kind === 'house' || kind === 'hotel') {
      var z = findById(me.sets, action.zoneId);
      if (!z) fail('choose a set');
      if (!isZoneComplete(z)) fail('set must be complete');
      if (!COLORS[z.color].buildable) fail('cannot build on ' + COLORS[z.color].label);
      if (kind === 'house') {
        if (z.house) fail('set already has a House');
      } else {
        if (!z.house) fail('a Hotel needs a House first');
        if (z.hotel) fail('set already has a Hotel');
      }
      spendPlay(state, 1);
      removeById(me.hand, card.id);
      if (kind === 'house') z.house = card; else z.hotel = card;
      emit(state, { type: 'build', player: state.active, card: card, zone: z.id });
      log(state, me.name + ' adds a ' + ACTIONS[kind].name + ' to their ' + COLORS[z.color].label + ' set.');
      return;
    }

    if (kind === 'birthday') {
      spendPlay(state, 1);
      removeById(me.hand, card.id);
      state.discard.push(card);
      var vs = [];
      for (var b = 1; b < state.players.length; b++) vs.push((state.active + b) % state.players.length);
      emit(state, { type: 'action', player: state.active, card: card });
      log(state, me.name + ' declares it’s their birthday (again) — everyone owes 2M.');
      openDemand(state, 'birthday', state.active, vs, BIRTHDAY_AMOUNT, null);
      return;
    }

    if (kind === 'debtCollector') {
      var v = action.victim;
      if (typeof v !== 'number' || v === state.active || !state.players[v]) fail('choose a player');
      spendPlay(state, 1);
      removeById(me.hand, card.id);
      state.discard.push(card);
      emit(state, { type: 'action', player: state.active, card: card, victim: v });
      log(state, me.name + ' sends the Grumpy Debt Collector to ' + pname(state, v) + ' — 5M owed.');
      openDemand(state, 'debtCollector', state.active, [v], DEBT_COLLECTOR_AMOUNT, null);
      return;
    }

    if (kind === 'dealBreaker') {
      var vic = state.players[action.victim];
      if (!vic || action.victim === state.active) fail('choose a player');
      var zz = findById(vic.sets, action.zoneId);
      if (!zz) fail('choose a set');
      if (!isZoneComplete(zz)) fail('Deal Breakerer only takes complete sets');
      spendPlay(state, 1);
      removeById(me.hand, card.id);
      state.discard.push(card);
      emit(state, { type: 'action', player: state.active, card: card, victim: action.victim });
      log(state, me.name + ' plays Deal Breakerer on ' + vic.name + '’s ' + COLORS[zz.color].label + ' set!');
      openTake(state, 'dealBreaker', state.active, action.victim, { zoneId: action.zoneId });
      return;
    }

    if (kind === 'slyDeal') {
      var sv = state.players[action.victim];
      if (!sv || action.victim === state.active) fail('choose a player');
      var szn = zoneOfCard(sv, action.targetCardId);
      if (!szn || !findById(szn.cards, action.targetCardId)) fail('choose a property');
      if (isZoneComplete(szn)) fail('cannot steal from a complete set');
      spendPlay(state, 1);
      removeById(me.hand, card.id);
      state.discard.push(card);
      emit(state, { type: 'action', player: state.active, card: card, victim: action.victim });
      log(state, me.name + ' plays Extra Sly Deal on ' + sv.name + '.');
      openTake(state, 'slyDeal', state.active, action.victim, { cardId: action.targetCardId });
      return;
    }

    if (kind === 'forcedDeal') {
      var fv = state.players[action.victim];
      if (!fv || action.victim === state.active) fail('choose a player');
      var tzn = zoneOfCard(fv, action.targetCardId);
      if (!tzn || !findById(tzn.cards, action.targetCardId)) fail('choose a property to take');
      if (isZoneComplete(tzn)) fail('cannot take from a complete set');
      var gzn = zoneOfCard(me, action.giveCardId);
      if (!gzn || !findById(gzn.cards, action.giveCardId)) fail('choose a property to give');
      if (isZoneComplete(gzn)) fail('cannot give from a complete set');
      spendPlay(state, 1);
      removeById(me.hand, card.id);
      state.discard.push(card);
      emit(state, { type: 'action', player: state.active, card: card, victim: action.victim });
      log(state, me.name + ' plays Politely Forced Deal on ' + fv.name + '.');
      openTake(state, 'forcedDeal', state.active, action.victim, { cardId: action.targetCardId, giveCardId: action.giveCardId });
      return;
    }

    fail('unhandled action ' + kind);
  }

  fail('unknown play mode');
}

/* ── free rearranging on your own turn ───────────────────────────── */

function doRearrange(state, action) {
  var me = requireActive(state);
  var z = zoneOfCard(me, action.cardId);
  if (!z) fail('card not on your table');
  var card = findById(z.cards, action.cardId);
  if (!card) fail('houses move with moveBuilding');
  removeById(z.cards, card.id);
  cleanupZones(state, state.active);
  try {
    card.color = null;
    placeIntoZone(state, state.active, card, action.color, action.zoneId);
  } catch (e) {
    // put it back where it was so an invalid move never loses the card
    card.color = z.color;
    autoPlace(state, state.active, card);
    throw e;
  }
  emit(state, { type: 'rearrange', player: state.active, card: card });
  log(state, me.name + ' rearranges ' + cardName(card) + '.');
}

function doMoveBuilding(state, action) {
  var me = requireActive(state);
  var from = null, card = null;
  me.sets.forEach(function (z) {
    if (z.house && z.house.id === action.cardId) { from = z; card = z.house; }
    if (z.hotel && z.hotel.id === action.cardId) { from = z; card = z.hotel; }
  });
  if (!from) fail('building not found');
  var to = findById(me.sets, action.zoneId);
  if (!to) fail('choose a set');
  if (!isZoneComplete(to)) fail('target set must be complete');
  if (!COLORS[to.color].buildable) fail('cannot build on ' + COLORS[to.color].label);
  if (card.action === 'house') {
    if (to.house) fail('target already has a House');
    if (from.hotel) fail('move the Hotel off first');
    from.house = null; to.house = card;
  } else {
    if (!to.house) fail('target needs a House first');
    if (to.hotel) fail('target already has a Hotel');
    from.hotel = null; to.hotel = card;
  }
  emit(state, { type: 'rearrange', player: state.active, card: card });
  log(state, me.name + ' moves a ' + ACTIONS[card.action].name + ' to their ' + COLORS[to.color].label + ' set.');
}

/* ── end of turn / discard ───────────────────────────────────────── */

function doEndTurn(state) {
  var me = requireActive(state);
  if (me.hand.length > HAND_LIMIT) {
    state.phase = 'discard';
    emit(state, { type: 'needDiscard', player: state.active, count: me.hand.length - HAND_LIMIT });
    log(state, me.name + ' must discard down to ' + HAND_LIMIT + ' cards.');
    return;
  }
  advanceTurn(state);
}

function doDiscard(state, action) {
  if (state.phase !== 'discard') fail('not discarding');
  var me = state.players[state.active];
  var ids = action.cardIds || [];
  if (me.hand.length - ids.length !== HAND_LIMIT) fail('discard exactly down to ' + HAND_LIMIT);
  ids.forEach(function (id) {
    var c = removeById(me.hand, id);
    if (!c) fail('card not in hand');
    state.discard.push(c);
  });
  emit(state, { type: 'discard', player: state.active, count: ids.length });
  log(state, me.name + ' discards ' + ids.length + ' card' + (ids.length === 1 ? '' : 's') + '.');
  advanceTurn(state);
}

/* ── responses ───────────────────────────────────────────────────── */

function doRespondJsn(state, action) {
  var claim = currentClaim(state);
  if (!claim || claim.stage !== 'jsn') fail('no Just Say No Thanks window open');
  if (action.player !== claim.waitingOn) fail('not your response');
  settleJsn(state, !!action.use);
  normalizePending(state);
  checkWin(state);
  return state;
}

function doSubmitPayment(state, action) {
  var claim = currentClaim(state);
  if (!claim || claim.stage !== 'pay') fail('no payment due');
  if (action.player !== claim.victim) fail('not your payment');
  var p = state.pending;
  var victim = state.players[claim.victim];
  var source = state.players[p.source];

  var ids = action.cardIds || [];
  var seen = {};
  var cards = ids.map(function (id) {
    if (seen[id]) fail('duplicate card');
    seen[id] = true;
    var inBank = findById(victim.bank, id);
    if (inBank) return inBank;
    var z = zoneOfCard(victim, id);
    if (z) {
      if (z.house && z.house.id === id) return z.house;
      if (z.hotel && z.hotel.id === id) return z.hotel;
      var c = findById(z.cards, id);
      if (c) {
        if (!isPayable(c)) fail('rainbow wilds cannot be used to pay');
        return c;
      }
    }
    fail('card not available to pay with');
  });

  var total = cards.reduce(function (s, c) { return s + c.value; }, 0);
  if (total < claim.amount) {
    // Short payment is only legal when it is everything you have.
    var all = payableCards(victim);
    if (cards.length !== all.length) fail('payment is short of ' + claim.amount + 'M');
  }

  // Transfer.
  cards.forEach(function (c) {
    var fromBank = removeById(victim.bank, c.id);
    if (!fromBank) {
      // remove from table
      victim.sets.forEach(function (z) {
        if (z.house && z.house.id === c.id) z.house = null;
        if (z.hotel && z.hotel.id === c.id) z.hotel = null;
        removeById(z.cards, c.id);
      });
    }
    if (c.kind === 'property' || c.kind === 'wild') {
      autoPlace(state, p.source, c);
    } else {
      source.bank.push(c);
    }
  });
  cleanupZones(state, claim.victim);

  emit(state, { type: 'pay', from: claim.victim, to: p.source, cards: cards, amount: total });
  log(state, victim.name + ' pays ' + source.name + ' ' + total + 'M' +
    (total < claim.amount ? ' (all they have)' : '') + '.');
  claim.stage = 'done';
  normalizePending(state);
  checkWin(state);
  return state;
}
