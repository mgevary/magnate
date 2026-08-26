// bot.js — heuristic AI opponents for Magnate.
//
// The heuristics adapt the tuning documented in chudopoly's BOT-STRATEGY.md
// (MIT, github.com/8tp/chudopoly) to the official Monopoly Deal card set:
// threat-first decision making, Double-The-Rent combos, a Just Say No
// economy that saves counters for big threats, smart property placement,
// leader targeting, and holdback so bots don't robotically use all 3 plays.
//
// Entry point: botDecide(state, playerIdx) → a dispatchable engine action.
// ES2018 only (Safari 12).

import { COLORS, COLOR_KEYS, isRainbowWild, cardName } from '../engine/cards.js';
import {
  whatsPending, isZoneComplete, completeZones, completeSetColorCount,
  zoneRent, bestRentForColor, payableCards, totalPayable, bankValue
} from '../engine/game.js';

var rng = Math.random;
export function setRng(f) { rng = f; }

export var PERSONALITIES = {
  easy:     { label: 'Easy',   holdback1: 0.25, holdback2: 0.40, jsnSmart: false, threatAware: false, mistake: 0.30 },
  balanced: { label: 'Normal', holdback1: 0.05, holdback2: 0.15, jsnSmart: true,  threatAware: true,  mistake: 0.06 },
  shark:    { label: 'Hard',   holdback1: 0.00, holdback2: 0.06, jsnSmart: true,  threatAware: true,  mistake: 0.00 }
};

function P(state, idx) {
  var key = state.players[idx].personality;
  return PERSONALITIES[key] || PERSONALITIES.balanced;
}

function opponentsOf(state, idx) {
  var out = [];
  for (var i = 0; i < state.players.length; i++) if (i !== idx) out.push(i);
  return out;
}

// "Leader" = most complete-set colours, then most payable wealth.
function leaderAmong(state, idxs) {
  var best = idxs[0], bestScore = -1;
  idxs.forEach(function (i) {
    var p = state.players[i];
    var score = completeSetColorCount(p) * 100 + totalPayable(p);
    if (score > bestScore) { bestScore = score; best = i; }
  });
  return best;
}

function richestAmong(state, idxs) {
  var best = idxs[0], bestVal = -1;
  idxs.forEach(function (i) {
    var v = totalPayable(state.players[i]);
    if (v > bestVal) { bestVal = v; best = i; }
  });
  return best;
}

function threatOpponents(state, idx) {
  return opponentsOf(state, idx).filter(function (i) {
    return completeSetColorCount(state.players[i]) >= 2;
  });
}

function handCards(state, idx, pred) {
  return state.players[idx].hand.filter(pred);
}

function firstHand(state, idx, pred) {
  var m = handCards(state, idx, pred);
  return m.length ? m[0] : null;
}

/* ── property placement scoring (chudopoly Round 3) ──────────────── */

// How far along is this player in `color` (best single zone, 0..1)?
function colorProgress(player, color) {
  var best = 0;
  player.sets.forEach(function (z) {
    if (z.color === color && !isZoneComplete(z)) {
      best = Math.max(best, z.cards.length / COLORS[color].size);
    }
  });
  return best;
}

function ownsIncompleteOfColor(player, color) {
  return player.sets.some(function (z) { return z.color === color && !isZoneComplete(z); });
}

// Score placing `card` as `color` for this player.
function placementScore(player, card, color) {
  var meta = COLORS[color];
  var progress = colorProgress(player, color);
  var score = 3;
  score += progress * 6;                        // building toward completion
  score += (4 - meta.size);                     // smaller sets complete sooner
  if (progress > 0) score += 2;                 // already invested in this colour
  var wouldComplete = false;
  player.sets.forEach(function (z) {
    if (z.color === color && !isZoneComplete(z) && z.cards.length + 1 >= meta.size) wouldComplete = true;
  });
  if (player.sets.length === 0 && meta.size <= 3) score += 1;
  if (wouldComplete) score += 8;
  return score;
}

function bestWildColor(player, card) {
  var options = card.colors === 'all' ? COLOR_KEYS : card.colors;
  var best = options[0], bestScore = -1;
  options.forEach(function (color) {
    var s = placementScore(player, card, color);
    if (card.colors === 'all' && !ownsIncompleteOfColor(player, color)) s -= 4; // rainbow: only extend, don't scatter
    if (s > bestScore) { bestScore = s; best = color; }
  });
  return best;
}

/* ── payment selection (exact small knapsack) ────────────────────── */

// Strategic cost of surrendering a card, beyond its face value.
function surrenderCost(player, card, inZone) {
  var v = card.value;
  if (card.kind === 'money') return v;
  if (card.kind === 'property' || card.kind === 'wild') {
    var cost = v * 2 + 2;
    if (inZone && isZoneComplete(inZone)) cost += 8;       // breaking a complete set hurts
    else if (inZone) cost += colorProgress(player, inZone.color) * 4;
    if (card.kind === 'wild') cost += 2;                   // wilds are flexible, keep them
    return cost;
  }
  if (card.kind === 'action') {
    if (card.action === 'justSayNo') return v + 4;         // banked JSN is just money, but…
    return v + 0.5;
  }
  return v + 1;
}

export function choosePayment(state, idx, amount) {
  var player = state.players[idx];
  var avail = [];
  player.bank.forEach(function (c) { avail.push({ card: c, cost: surrenderCost(player, c, null) }); });
  player.sets.forEach(function (z) {
    z.cards.forEach(function (c) {
      if (!isRainbowWild(c)) avail.push({ card: c, cost: surrenderCost(player, c, z) });
    });
    if (z.house) avail.push({ card: z.house, cost: z.house.value + 3 });
    if (z.hotel) avail.push({ card: z.hotel, cost: z.hotel.value + 3 });
  });

  var totalAvail = avail.reduce(function (s, a) { return s + a.card.value; }, 0);
  if (totalAvail <= amount) {
    return avail.map(function (a) { return a.card.id; }); // hand it all over
  }

  // 0/1 knapsack over totals: minimise strategic cost for any total ≥ amount,
  // tie-breaking toward the smallest total (no change is given).
  var maxTotal = Math.min(totalAvail, amount + 12);
  var INF = 1e9;
  var dp = [];   // dp[t] = min cost to surrender exactly total t
  var pick = []; // pick[t] = list of avail indices
  for (var t = 0; t <= maxTotal; t++) { dp.push(t === 0 ? 0 : INF); pick.push(null); }
  pick[0] = [];
  for (var i = 0; i < avail.length; i++) {
    var v = avail[i].card.value, c = avail[i].cost;
    if (v <= 0) continue;
    for (var t2 = maxTotal - v; t2 >= 0; t2--) {
      if (dp[t2] < INF && dp[t2] + c < dp[t2 + v]) {
        dp[t2 + v] = dp[t2] + c;
        pick[t2 + v] = pick[t2].concat([i]);
      }
    }
  }
  var bestT = -1, bestCost = INF;
  for (var t3 = amount; t3 <= maxTotal; t3++) {
    if (dp[t3] < bestCost) { bestCost = dp[t3]; bestT = t3; }
  }
  if (bestT === -1) {
    // shouldn't happen (totalAvail > amount) — fall back to greedy
    var sorted = avail.slice().sort(function (a, b) { return a.cost - b.cost; });
    var ids = [], sum = 0;
    for (var g = 0; g < sorted.length && sum < amount; g++) {
      ids.push(sorted[g].card.id); sum += sorted[g].card.value;
    }
    return ids;
  }
  return pick[bestT].map(function (i2) { return avail[i2].card.id; });
}

/* ── Just Say No economy (chudopoly Round 2) ─────────────────────── */

function jsnThreatLevel(state, idx, pending, claim) {
  var action = pending.action;
  if (action === 'dealBreaker') return 10;
  if (action === 'slyDeal' || action === 'forcedDeal') {
    // How much does losing that card hurt?
    var me = state.players[idx];
    var level = 3;
    me.sets.forEach(function (z) {
      var has = z.cards.some(function (c) { return c.id === pending.detail.cardId; });
      if (has) {
        var need = COLORS[z.color].size - z.cards.length;
        if (need <= 1) level = 7;                 // one away from completing
        else level = 4;
      }
    });
    return level;
  }
  // money demands
  var amount = claim.amount;
  var level2 = amount >= 8 ? 8 : amount >= 4 ? 6 : 2;
  if (bankValue(state.players[idx]) < amount) level2 += 2; // would eat properties
  return level2;
}

function decideJsn(state, idx) {
  var pending = state.pending;
  var claim = pending.claims[pending.current];
  var p = P(state, idx);
  var jsnCount = handCards(state, idx, function (c) {
    return c.kind === 'action' && c.action === 'justSayNo';
  }).length;
  if (jsnCount === 0) return { type: 'respondJsn', player: idx, use: false };

  var iAmVictim = claim.waitingOn === claim.victim;
  if (!p.jsnSmart) {
    // Easy: blocks Deal Breakers usually, otherwise coin-flippy.
    var chance = pending.action === 'dealBreaker' ? 0.8 : 0.3;
    return { type: 'respondJsn', player: idx, use: rng() < chance };
  }

  if (!iAmVictim) {
    // Counter-JSN to force MY action through: only for the big stuff.
    var worth = pending.action === 'dealBreaker' || (pending.kind === 'demand' && claim.amount >= 6);
    return { type: 'respondJsn', player: idx, use: worth };
  }

  var level = jsnThreatLevel(state, idx, pending, claim);
  var threshold = jsnCount >= 2 ? 4 : 6;   // spend spares more freely
  if (pending.kind === 'demand' && payableCards(state.players[idx]).length === 0) {
    return { type: 'respondJsn', player: idx, use: false }; // nothing to lose
  }
  return { type: 'respondJsn', player: idx, use: level >= threshold };
}

/* ── discard selection ───────────────────────────────────────────── */

function keepScore(state, idx, card) {
  var me = state.players[idx];
  if (card.kind === 'action') {
    if (card.action === 'justSayNo') return 10;
    if (card.action === 'dealBreaker') return 9;
    if (card.action === 'doubleRent') return 7;
    if (card.action === 'slyDeal' || card.action === 'forcedDeal') return 6.5;
    if (card.action === 'debtCollector' || card.action === 'birthday') return 6;
    if (card.action === 'house') return completeZones(me).length ? 7 : 4;
    if (card.action === 'hotel') return 3.5;
    if (card.action === 'passGo') return 4;
  }
  if (card.kind === 'property') return 5 + colorProgress(me, card.color) * 4 + card.value * 0.3;
  if (card.kind === 'wild') return card.colors === 'all' ? 8 : 6.5;
  if (card.kind === 'rent') return card.colors === 'all' ? 6 : 4.5;
  if (card.kind === 'money') return 2 + card.value * 0.4;
  return 3;
}

function chooseDiscards(state, idx, count) {
  var scored = state.players[idx].hand.map(function (c) {
    return { id: c.id, s: keepScore(state, idx, c) + rng() * 0.5 };
  });
  scored.sort(function (a, b) { return a.s - b.s; });
  return scored.slice(0, count).map(function (x) { return x.id; });
}

/* ── main-turn play selection ────────────────────────────────────── */

function enumeratePlays(state, idx) {
  var me = state.players[idx];
  var p = P(state, idx);
  var opps = opponentsOf(state, idx);
  var threats = p.threatAware ? threatOpponents(state, idx) : [];
  var plays = [];
  var myComplete = completeSetColorCount(me);

  me.hand.forEach(function (card) {
    if (card.kind === 'money') {
      var bankNeed = bankValue(me) < 4 ? 2.5 : 1;
      plays.push({
        score: 2 + card.value * 0.35 * bankNeed,
        action: { type: 'play', cardId: card.id, mode: 'bank' }
      });
      return;
    }

    if (card.kind === 'property') {
      plays.push({
        score: placementScore(me, card, card.color),
        action: { type: 'play', cardId: card.id, mode: 'property', color: card.color }
      });
      return;
    }

    if (card.kind === 'wild') {
      var color = bestWildColor(me, card);
      plays.push({
        score: placementScore(me, card, color) + 0.5,
        action: { type: 'play', cardId: card.id, mode: 'property', color: color }
      });
      return;
    }

    if (card.kind === 'rent') {
      var colors = card.colors === 'all' ? COLOR_KEYS : card.colors;
      colors.forEach(function (color) {
        var base = bestRentForColor(me, color);
        if (base <= 0) return;
        var dtrs = handCards(state, idx, function (c) {
          return c.kind === 'action' && c.action === 'doubleRent';
        });
        var usable = Math.min(dtrs.length, state.playsLeft - 1);
        var mult = Math.pow(2, usable);
        var target = null, expected;
        if (card.colors === 'all') {
          target = leaderAmong(state, opps.filter(function (o) { return totalPayable(state.players[o]) > 0; }).length
            ? opps.filter(function (o) { return totalPayable(state.players[o]) > 0; }) : opps);
          expected = Math.min(base * mult, totalPayable(state.players[target]));
        } else {
          expected = opps.reduce(function (s, o) {
            return s + Math.min(base * mult, totalPayable(state.players[o]));
          }, 0);
        }
        if (expected <= 0) return;
        var a = { type: 'play', cardId: card.id, mode: 'rent', color: color };
        if (usable > 0 && base >= 2) a.doubles = dtrs.slice(0, usable).map(function (c) { return c.id; });
        else a.doubles = [];
        if (card.colors === 'all') a.target = target;
        var comboBonus = a.doubles.length ? 2 : 0;
        plays.push({ score: 3 + expected * 0.8 + comboBonus, action: a });
      });
      return;
    }

    // action cards
    var kind = card.action;

    if (kind === 'passGo') {
      plays.push({ score: 6 + (me.hand.length <= 3 ? 2 : 0), action: { type: 'play', cardId: card.id, mode: 'action' } });
      return;
    }

    if (kind === 'house' || kind === 'hotel') {
      var zones = completeZones(me).filter(function (z) {
        if (!COLORS[z.color].buildable) return false;
        if (kind === 'house') return !z.house;
        return z.house && !z.hotel;
      });
      if (zones.length) {
        plays.push({
          score: 7,
          action: { type: 'play', cardId: card.id, mode: 'action', zoneId: zones[0].id }
        });
      } else if (me.hand.length >= 6) {
        plays.push({ score: 2 + card.value * 0.3, action: { type: 'play', cardId: card.id, mode: 'bank' } });
      }
      return;
    }

    if (kind === 'dealBreaker') {
      opps.forEach(function (o) {
        var zones2 = completeZones(state.players[o]);
        zones2.forEach(function (z) {
          var worth = 10 + zoneRent(z) + (threats.indexOf(o) !== -1 ? 6 : 0) + (myComplete >= 2 ? 8 : 0);
          plays.push({
            score: worth,
            action: { type: 'play', cardId: card.id, mode: 'action', victim: o, zoneId: z.id }
          });
        });
      });
      return;
    }

    if (kind === 'slyDeal') {
      opps.forEach(function (o) {
        var opp = state.players[o];
        opp.sets.forEach(function (z) {
          if (isZoneComplete(z)) return;
          z.cards.forEach(function (c) {
            var gain = placementScore(me, c, z.color) * 0.6 + c.value * 0.4 +
              (COLORS[z.color].size - z.cards.length === 0 ? 2 : 0) +
              (threats.indexOf(o) !== -1 ? 3 : 0) +
              colorProgress(opp, z.color) * 3;   // deny their progress
            plays.push({
              score: 4 + gain,
              action: { type: 'play', cardId: card.id, mode: 'action', victim: o, targetCardId: c.id }
            });
          });
        });
      });
      return;
    }

    if (kind === 'forcedDeal') {
      // give my least useful non-complete property, take their best.
      var give = null, giveScore = 1e9;
      me.sets.forEach(function (z) {
        if (isZoneComplete(z)) return;
        z.cards.forEach(function (c) {
          var s = placementScore(me, c, z.color) + c.value;
          if (s < giveScore) { giveScore = s; give = c; }
        });
      });
      if (!give) return;
      opps.forEach(function (o) {
        var opp = state.players[o];
        opp.sets.forEach(function (z) {
          if (isZoneComplete(z)) return;
          z.cards.forEach(function (c) {
            var gain = placementScore(me, c, z.color) * 0.6 + c.value * 0.4 +
              (threats.indexOf(o) !== -1 ? 2 : 0) + colorProgress(opp, z.color) * 2 - 2;
            plays.push({
              score: 3 + gain,
              action: { type: 'play', cardId: card.id, mode: 'action', victim: o, targetCardId: c.id, giveCardId: give.id }
            });
          });
        });
      });
      return;
    }

    if (kind === 'debtCollector') {
      var rich = richestAmong(state, opps);
      var take = Math.min(5, totalPayable(state.players[rich]));
      if (take > 0) {
        plays.push({
          score: 3 + take * 0.9 + (threats.indexOf(rich) !== -1 ? 2 : 0),
          action: { type: 'play', cardId: card.id, mode: 'action', victim: rich }
        });
      }
      return;
    }

    if (kind === 'birthday') {
      var expect = opps.reduce(function (s, o) {
        return s + Math.min(2, totalPayable(state.players[o]));
      }, 0);
      if (expect > 0) {
        plays.push({ score: 3 + expect * 0.9, action: { type: 'play', cardId: card.id, mode: 'action' } });
      }
      return;
    }

    if (kind === 'justSayNo' || kind === 'doubleRent') {
      // Hold these; bank only if hand is bloated with spares.
      var spares = handCards(state, idx, function (c) {
        return c.kind === 'action' && c.action === kind;
      }).length;
      if (spares >= 3 && me.hand.length >= 7) {
        plays.push({ score: 1.5, action: { type: 'play', cardId: card.id, mode: 'bank' } });
      }
      return;
    }
  });

  return plays;
}

function decideMainPlay(state, idx) {
  var p = P(state, idx);
  var me = state.players[idx];
  var used = 3 - state.playsLeft;

  if (state.playsLeft <= 0) return { type: 'endTurn' };

  // Holdback (chudopoly Round 4): sometimes stop early with a small hand.
  if (me.hand.length <= 7) {
    if (used === 1 && rng() < p.holdback1) return { type: 'endTurn' };
    if (used === 2 && rng() < p.holdback2) return { type: 'endTurn' };
  }

  var plays = enumeratePlays(state, idx);
  if (!plays.length) return { type: 'endTurn' };
  plays.sort(function (a, b) { return b.score - a.score; });

  var pickIdx = 0;
  if (plays.length > 1 && rng() < p.mistake) pickIdx = 1;
  var chosen = plays[pickIdx];
  if (chosen.score < 2.2 && used > 0) return { type: 'endTurn' }; // nothing worthwhile
  return chosen.action;
}

/* ── entry point ─────────────────────────────────────────────────── */

export function botDecide(state, idx) {
  var w = whatsPending(state);
  if (w) {
    if (w.player !== idx) return null; // not this bot's decision
    if (w.type === 'jsn') return decideJsn(state, idx);
    if (w.type === 'pay') {
      return { type: 'submitPayment', player: idx, cardIds: choosePayment(state, idx, w.amount) };
    }
    if (w.type === 'discard') {
      return { type: 'discard', cardIds: chooseDiscards(state, idx, w.count) };
    }
    return null;
  }
  if (state.active !== idx || state.phase !== 'main') return null;
  return decideMainPlay(state, idx);
}
