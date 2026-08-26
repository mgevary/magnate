// view.js — per-seat views of a game state for network play.
//
// The whole client UI is written from the perspective of "I am player 0".
// For multiplayer the server sends each client a ROTATED copy of the
// state in which that client sits at index 0, with every player index
// remapped and every other player's hand replaced by hidden stubs. The
// client then renders with the exact same code as solo play, and the
// server remaps incoming action indices back to real seats.
// ES2018 / runs in Node (server) — no DOM.

export function rotateIdx(idx, seat, n) {
  if (typeof idx !== 'number' || idx === null) return idx;
  return ((idx - seat) + n) % n;
}

export function unrotateIdx(idx, seat, n) {
  if (typeof idx !== 'number' || idx === null) return idx;
  return (idx + seat) % n;
}

// Deep-copy the state as seen from `seat`. Hides other hands and the
// deck/discard contents (top discard cards stay visible for the pile).
export function viewFor(state, seat) {
  var n = state.players.length;
  var v = JSON.parse(JSON.stringify({
    seed: 0, // never leak the shuffle seed to clients
    players: state.players,
    deck: [],
    discard: state.discard.slice(-6),
    active: state.active,
    playsLeft: state.playsLeft,
    phase: state.phase,
    pending: state.pending,
    winner: state.winner,
    armed: state.armed,
    turnCount: state.turnCount,
    zoneSeq: state.zoneSeq,
    events: state.events,
    log: state.log.slice(-30)
  }));

  v.deckCount = state.deck.length;
  // rotate players so `seat` is index 0
  var rotated = [];
  for (var i = 0; i < n; i++) {
    rotated.push(v.players[(seat + i) % n]);
  }
  v.players = rotated;

  // hide other hands (length-preserving stubs so counts render)
  for (var p = 1; p < n; p++) {
    v.players[p].hand = v.players[p].hand.map(function (c, ci) {
      return { id: 'hidden-' + p + '-' + ci, kind: 'hidden', value: 0 };
    });
  }

  function r(idx) { return rotateIdx(idx, seat, n); }
  v.active = r(v.active);
  v.winner = v.winner === null ? null : r(v.winner);
  v.armed = v.armed === null || v.armed === undefined ? null : r(v.armed);
  if (v.pending) {
    v.pending.source = r(v.pending.source);
    v.pending.claims.forEach(function (c) {
      c.victim = r(c.victim);
      c.waitingOn = r(c.waitingOn);
    });
  }
  v.events.forEach(function (ev) {
    ['player', 'from', 'to', 'victim'].forEach(function (k) {
      if (typeof ev[k] === 'number') ev[k] = r(ev[k]);
    });
  });
  return v;
}

// Remap the player indices inside a client-sent action back to real
// seats. The client believes it is player 0.
export function actionFromSeat(action, seat, n) {
  var a = JSON.parse(JSON.stringify(action));
  function un(idx) { return unrotateIdx(idx, seat, n); }
  if (typeof a.player === 'number') a.player = un(a.player);
  if (typeof a.victim === 'number') a.victim = un(a.victim);
  if (typeof a.target === 'number') a.target = un(a.target);
  return a;
}
