const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname)));

const PORT = process.env.PORT || 3000;

/* ===== CONSTANTS ===== */
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_VALUES = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14 };
const SMALL_BLIND = 10;
const BIG_BLIND = 20;
const STARTING_CHIPS = 1000;
const AI_THINK_MIN_MS = 1500;
const AI_THINK_MAX_MS = 3000;

/* ===== ROOM MANAGEMENT ===== */
const rooms = new Map();

function generateCode() {
    let code;
    do { code = Math.random().toString(36).substring(2, 8).toUpperCase(); } while (rooms.has(code));
    return code;
}

function createRoom(hostSocketId, hostName, totalSeats, numAI) {
    const code = generateCode();
    const humanSeats = totalSeats - numAI;
    const slots = [];

    // Slot 0: host
    slots.push({ socketId: hostSocketId, name: hostName, seat: 0, isAI: false });

    // Remaining human slots (empty, waiting to be joined)
    for (let i = 1; i < humanSeats; i++) {
        slots.push({ socketId: null, name: null, seat: i, isAI: false });
    }

    // AI slots
    for (let i = humanSeats; i < totalSeats; i++) {
        slots.push({ socketId: null, name: `AI ${i - humanSeats + 1}`, seat: i, isAI: true });
    }

    const room = {
        code,
        hostSocketId,
        totalSeats,
        numAI,
        humanSeats,
        slots,
        gs: null,
        phase: 'lobby', // 'lobby' | 'playing'
        turnToken: 0
    };
    rooms.set(code, room);
    return room;
}

function joinRoom(socketId, name, code) {
    const room = rooms.get(code);
    if (!room) return 'Room not found';
    if (room.phase !== 'lobby') return 'Game already in progress';
    const emptySlot = room.slots.find(s => !s.isAI && !s.socketId);
    if (!emptySlot) return 'Room is full';
    emptySlot.socketId = socketId;
    emptySlot.name = name;
    return null;
}

function getRoomBySocket(socketId) {
    for (const r of rooms.values()) {
        if (r.slots.some(s => s.socketId === socketId)) return r;
    }
    return null;
}

function getSeatBySocket(room, socketId) {
    return room.slots.find(s => s.socketId === socketId)?.seat ?? -1;
}

function getSlotBySocket(room, socketId) {
    return room.slots.find((s) => s.socketId === socketId) || null;
}

function lobbyInfo(room, viewerSocketId = null) {
    const viewerSeat = viewerSocketId ? getSeatBySocket(room, viewerSocketId) : -1;
    return {
        code: room.code,
        totalSeats: room.totalSeats,
        numAI: room.numAI,
        viewerSeat,
        slots: room.slots.map(s => ({
            seat: s.seat,
            name: s.name,
            isAI: s.isAI,
            filled: s.isAI || !!s.socketId
        }))
    };
}

function emitLobby(room) {
    room.slots.forEach(s => {
        if (!s.isAI && s.socketId) {
            const sock = io.sockets.sockets.get(s.socketId);
            if (sock) sock.emit('lobbyUpdate', {
                ...lobbyInfo(room, s.socketId),
                isHost: s.socketId === room.hostSocketId
            });
        }
    });
}

/* ===== DECK ===== */
function createDeck() {
    const d = [];
    for (const suit of SUITS) for (const rank of RANKS) d.push({ rank, suit });
    return d;
}

function shuffle(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

/* ===== HAND EVALUATION ===== */
function evaluateHand(cards) {
    if (cards.length < 5) return { rank: 0, values: [], name: 'High Card' };
    const combos = getCombinations(cards, 5);
    let best = { rank: -1, values: [], name: 'High Card' };
    for (const c of combos) {
        const h = evaluateFiveCards(c);
        if (h.rank > best.rank || (h.rank === best.rank && compareValues(h.values, best.values) > 0)) best = h;
    }
    return best;
}

function getCombinations(arr, size) {
    const out = [];
    function walk(start, picked) {
        if (picked.length === size) { out.push([...picked]); return; }
        for (let i = start; i < arr.length; i++) { picked.push(arr[i]); walk(i + 1, picked); picked.pop(); }
    }
    walk(0, []);
    return out;
}

function getStraightHigh(ranksDesc) {
    const u = [...new Set(ranksDesc)].sort((a, b) => b - a);
    if (u.length < 5) return null;
    for (let i = 0; i <= u.length - 5; i++) {
        const w = u.slice(i, i + 5);
        if (w[0] - w[4] === 4) return w[0];
    }
    if ([14, 5, 4, 3, 2].every(r => u.includes(r))) return 5;
    return null;
}

function evaluateFiveCards(cards) {
    const suits = cards.map(c => c.suit);
    const ranks = cards.map(c => RANK_VALUES[c.rank]).sort((a, b) => b - a);
    const rc = {};
    ranks.forEach(r => rc[r] = (rc[r] || 0) + 1);
    const uniq = Object.keys(rc).map(Number).sort((a, b) => b - a);
    const counts = Object.values(rc).sort((a, b) => b - a);
    const isFlush = suits.every(s => s === suits[0]);
    const sh = getStraightHigh(uniq);
    const isStraight = sh !== null;

    if (isFlush && isStraight && sh === 14 && uniq.includes(10)) return { rank: 9, values: [14], name: 'Royal Flush' };
    if (isFlush && isStraight) return { rank: 8, values: [sh], name: 'Straight Flush' };
    if (counts[0] === 4) return { rank: 7, values: [uniq.find(r => rc[r] === 4), uniq.find(r => rc[r] === 1)], name: 'Four of a Kind' };
    if (counts[0] === 3 && counts[1] === 2) return { rank: 6, values: [uniq.find(r => rc[r] === 3), uniq.find(r => rc[r] === 2)], name: 'Full House' };
    if (isFlush) return { rank: 5, values: ranks, name: 'Flush' };
    if (isStraight) return { rank: 4, values: [sh], name: 'Straight' };
    if (counts[0] === 3) return { rank: 3, values: [uniq.find(r => rc[r] === 3), ...uniq.filter(r => rc[r] === 1)], name: 'Three of a Kind' };
    if (counts[0] === 2 && counts[1] === 2) {
        const pairs = uniq.filter(r => rc[r] === 2).sort((a, b) => b - a);
        return { rank: 2, values: [...pairs, uniq.find(r => rc[r] === 1)], name: 'Two Pair' };
    }
    if (counts[0] === 2) return { rank: 1, values: [uniq.find(r => rc[r] === 2), ...uniq.filter(r => rc[r] === 1)], name: 'One Pair' };
    return { rank: 0, values: ranks, name: 'High Card' };
}

function compareValues(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const av = a[i] || 0, bv = b[i] || 0;
        if (av > bv) return 1;
        if (av < bv) return -1;
    }
    return 0;
}

/* ===== AI LOGIC ===== */
function evaluatePreflopStrength(a, b) {
    const r1 = RANK_VALUES[a.rank], r2 = RANK_VALUES[b.rank];
    const high = Math.max(r1, r2), low = Math.min(r1, r2);
    const suited = a.suit === b.suit, pair = r1 === r2, gap = high - low;
    let score = 0;
    if (pair) {
        score = 0.48 + (high / 14) * 0.48;
    } else {
        score = 0.18 + (high / 14) * 0.35 + (low / 14) * 0.15;
        if (suited) score += 0.08;
        if (gap === 1) score += 0.07;
        else if (gap === 2) score += 0.04;
        else if (gap >= 4) score -= 0.06;
        if (high >= 12 && low >= 10) score += 0.06;
    }
    return Math.max(0.05, Math.min(0.99, score));
}

function estimateDrawStrength(player, board) {
    if (board.length < 3) return 0;
    const cards = [...player.hand, ...board];
    const sc = {};
    for (const c of cards) sc[c.suit] = (sc[c.suit] || 0) + 1;
    const flushDraw = Object.values(sc).some(n => n === 4);
    const ranks = [...new Set(cards.map(c => RANK_VALUES[c.rank]))].sort((a, b) => a - b);
    if (ranks.includes(14)) ranks.unshift(1);
    let oe = false, gs_draw = false;
    for (let i = 0; i <= ranks.length - 4; i++) {
        const seg = ranks.slice(i, i + 4), span = seg[3] - seg[0];
        if (span === 3) oe = true;
        if (span === 4) gs_draw = true;
    }
    let draw = 0;
    if (flushDraw) draw += board.length === 3 ? 0.36 : 0.2;
    if (oe) draw += board.length === 3 ? 0.31 : 0.17;
    else if (gs_draw) draw += board.length === 3 ? 0.17 : 0.09;
    return Math.min(0.45, draw);
}

function getPostflopStrength(player, gs) {
    const hand = evaluateHand([...player.hand, ...gs.communityCards]);
    const byRank = [0.08, 0.32, 0.52, 0.67, 0.79, 0.86, 0.93, 0.97, 0.99, 1];
    return byRank[hand.rank] || 0.08;
}

function makeAIDecision(player, gs) {
    const toCall = Math.max(0, gs.currentBet - player.currentBet);
    const canCheck = toCall === 0;
    const potAfterCall = gs.pot + toCall;
    const potOdds = toCall > 0 ? toCall / Math.max(1, potAfterCall) : 0;

    let handStrength = 0, drawStrength = 0;
    if (gs.phase === 'preflop') {
        handStrength = evaluatePreflopStrength(player.hand[0], player.hand[1]);
    } else {
        handStrength = getPostflopStrength(player, gs);
        drawStrength = estimateDrawStrength(player, gs.communityCards);
    }

    const eq = Math.min(0.99, handStrength + drawStrength * 0.6);
    const stackP = toCall / Math.max(1, player.chips);
    const strongTh = gs.phase === 'preflop' ? 0.72 : 0.78;
    const medTh = gs.phase === 'preflop' ? 0.64 : 0.68;

    if (!canCheck) {
        if (stackP > 0.55 && eq < 0.55) return { action: 'fold' };
        if (eq + 0.05 < potOdds) {
            if (toCall <= BIG_BLIND && Math.random() < 0.25) return { action: 'call' };
            return { action: 'fold' };
        }
    }

    const legalMin = gs.currentBet + gs.minRaise;
    const maxTo = player.currentBet + player.chips;
    const canRaise = maxTo > gs.currentBet;

    if (canRaise) {
        if (eq >= strongTh && Math.random() < 0.72) {
            const target = Math.max(legalMin, Math.floor(gs.currentBet + gs.pot * 0.6));
            return { action: 'raise', amount: Math.min(maxTo, target) };
        }
        if (eq >= medTh && canCheck && Math.random() < 0.28) {
            const target = Math.max(legalMin, Math.floor(gs.currentBet + Math.max(BIG_BLIND, gs.pot * 0.35)));
            return { action: 'raise', amount: Math.min(maxTo, target) };
        }
    }

    if (canCheck) return { action: 'check' };
    return { action: 'call' };
}

/* ===== GAME HELPERS ===== */
function createGamePlayer(seat, name, isAI) {
    return {
        id: seat, name, isAI,
        chips: STARTING_CHIPS,
        hand: [], currentBet: 0,
        folded: false, allIn: false,
        actedThisStreet: false, eliminated: false,
        streetAction: ''
    };
}

function alivePlayers(gs) { return gs.players.filter(p => !p.eliminated); }
function inHandPlayers(gs) { return alivePlayers(gs).filter(p => !p.folded); }
function actionablePlayers(gs) { return inHandPlayers(gs).filter(p => !p.allIn && p.chips > 0); }

function nextAliveIdx(gs, from) {
    const n = gs.players.length;
    for (let s = 1; s <= n; s++) {
        const idx = (from + s) % n;
        if (!gs.players[idx].eliminated) return idx;
    }
    return from;
}

function findNextActionable(gs, from) {
    const n = gs.players.length;
    for (let s = 1; s <= n; s++) {
        const idx = (from + s) % n;
        const p = gs.players[idx];
        if (!p.eliminated && !p.folded && !p.allIn && p.chips > 0) return idx;
    }
    return -1;
}

function buildActionQueue(gs, startIdx) {
    if (startIdx < 0) return [];
    const q = [startIdx];
    let idx = findNextActionable(gs, startIdx);
    while (idx !== -1 && idx !== startIdx) {
        q.push(idx);
        idx = findNextActionable(gs, idx);
        if (q.length > gs.players.length + 1) break;
    }
    return q;
}

function buildReopenQueue(gs, raiserIdx) {
    const q = [];
    let idx = findNextActionable(gs, raiserIdx);
    while (idx !== -1 && idx !== raiserIdx) {
        q.push(idx);
        idx = findNextActionable(gs, idx);
        if (q.length > gs.players.length + 1) break;
    }
    return q;
}

function postBlind(room, idx, amount, label) {
    const gs = room.gs;
    const p = gs.players[idx];
    if (p.eliminated) return;
    const paid = Math.min(amount, p.chips);
    p.chips -= paid;
    p.currentBet += paid;
    p.allIn = p.chips === 0;
    gs.pot += paid;
    emitLog(room, `${p.name} posts ${label}: $${paid}`);
}

function emitLog(room, msg) {
    io.to(room.code).emit('log', msg);
}

/* ===== STATE BROADCASTING ===== */
function buildClientState(room, forSeat) {
    const gs = room.gs;
    return {
        phase: gs.phase,
        pot: gs.pot,
        currentBet: gs.currentBet,
        minRaise: gs.minRaise,
        communityCards: gs.communityCards,
        dealerPosition: gs.dealerPosition,
        smallBlindPosition: gs.smallBlindPosition,
        bigBlindPosition: gs.bigBlindPosition,
        currentPlayerIndex: gs.currentPlayerIndex,
        mySeat: forSeat,
        numPlayers: gs.players.length,
        players: gs.players.map((p, i) => {
            const isOwn = i === forSeat;
            const reveal = isOwn || gs.phase === 'showdown' || gs.phase === 'complete';
            return {
                id: i,
                name: p.name,
                isAI: p.isAI,
                chips: p.chips,
                currentBet: p.currentBet,
                folded: p.folded,
                allIn: p.allIn,
                eliminated: p.eliminated,
                streetAction: p.streetAction,
                hand: reveal ? p.hand : (p.hand.length > 0 ? Array(p.hand.length).fill(null) : [])
            };
        })
    };
}

function emitState(room) {
    room.slots.forEach(s => {
        if (!s.isAI && s.socketId) {
            const sock = io.sockets.sockets.get(s.socketId);
            if (!sock) return;
            sock.emit('stateUpdate', buildClientState(room, s.seat));
        }
    });
}

/* ===== GAME FLOW ===== */
function startGameInRoom(room) {
    room.phase = 'playing';
    room.gs = {
        players: room.slots.map(s => createGamePlayer(s.seat, s.name, s.isAI)),
        deck: [],
        communityCards: [],
        pot: 0,
        currentBet: 0,
        minRaise: BIG_BLIND,
        dealerPosition: -1,
        smallBlindPosition: -1,
        bigBlindPosition: -1,
        currentPlayerIndex: -1,
        phase: 'idle',
        playersToAct: []
    };
    io.to(room.code).emit('gameStarted', { numPlayers: room.totalSeats });
    startNewRound(room);
}

function startNewRound(room) {
    room.turnToken++;
    const gs = room.gs;

    const alive = alivePlayers(gs);
    if (alive.length === 1) {
        emitLog(room, `🏆 Game Over! ${alive[0].name} wins the table!`);
        gs.phase = 'complete';
        emitState(room);
        return;
    }

    gs.deck = shuffle(createDeck());
    gs.communityCards = [];
    gs.pot = 0;
    gs.phase = 'preflop';
    gs.minRaise = BIG_BLIND;

    for (const p of gs.players) {
        p.hand = [];
        p.currentBet = 0;
        p.folded = p.eliminated;
        p.allIn = false;
        p.actedThisStreet = false;
        p.streetAction = '';
    }

    gs.dealerPosition = nextAliveIdx(gs, gs.dealerPosition);

    let sbPos, bbPos;
    if (alive.length === 2) {
        sbPos = gs.dealerPosition;
        bbPos = nextAliveIdx(gs, gs.dealerPosition);
    } else {
        sbPos = nextAliveIdx(gs, gs.dealerPosition);
        bbPos = nextAliveIdx(gs, sbPos);
    }
    gs.smallBlindPosition = sbPos;
    gs.bigBlindPosition = bbPos;

    postBlind(room, sbPos, SMALL_BLIND, 'small blind');
    postBlind(room, bbPos, BIG_BLIND, 'big blind');
    gs.currentBet = Math.max(gs.players[sbPos].currentBet, gs.players[bbPos].currentBet);

    for (const p of alivePlayers(gs)) {
        p.hand = [gs.deck.pop(), gs.deck.pop()];
    }

    const preflopStart = findNextActionable(gs, bbPos);
    gs.playersToAct = buildActionQueue(gs, preflopStart);
    gs.currentPlayerIndex = gs.playersToAct[0] ?? -1;

    emitLog(room, '--- New Round ---');
    emitLog(room, `Dealer: ${gs.players[gs.dealerPosition].name}`);
    emitState(room);
    runTurnLoop(room);
}

function advancePhase(room) {
    room.turnToken++;
    const gs = room.gs;

    for (const p of gs.players) {
        p.currentBet = 0;
        p.actedThisStreet = false;
        p.streetAction = '';
    }
    gs.currentBet = 0;
    gs.minRaise = BIG_BLIND;

    if (gs.phase === 'preflop') {
        gs.phase = 'flop';
        for (let i = 0; i < 3; i++) gs.communityCards.push(gs.deck.pop());
        emitLog(room, '--- Flop ---');
    } else if (gs.phase === 'flop') {
        gs.phase = 'turn';
        gs.communityCards.push(gs.deck.pop());
        emitLog(room, '--- Turn ---');
    } else if (gs.phase === 'turn') {
        gs.phase = 'river';
        gs.communityCards.push(gs.deck.pop());
        emitLog(room, '--- River ---');
    } else {
        gs.phase = 'showdown';
        runShowdown(room);
        return;
    }

    const start = findNextActionable(gs, gs.dealerPosition);
    gs.playersToAct = buildActionQueue(gs, start);
    gs.currentPlayerIndex = gs.playersToAct[0] ?? -1;
    emitState(room);
    runTurnLoop(room);
}

function runShowdown(room) {
    const gs = room.gs;
    const contenders = inHandPlayers(gs);
    emitLog(room, '--- Showdown ---');

    if (contenders.length === 0) {
        gs.phase = 'complete';
        emitState(room);
        return;
    }

    const results = contenders.map(p => ({
        player: p,
        hand: evaluateHand([...p.hand, ...gs.communityCards])
    }));
    results.forEach(r => emitLog(room, `${r.player.name}: ${r.hand.name}`));

    let winners = [results[0]];
    for (let i = 1; i < results.length; i++) {
        const r = results[i];
        const diff = r.hand.rank - winners[0].hand.rank;
        if (diff > 0) winners = [r];
        else if (diff === 0) {
            const cmp = compareValues(r.hand.values, winners[0].hand.values);
            if (cmp > 0) winners = [r];
            else if (cmp === 0) winners.push(r);
        }
    }

    const base = Math.floor(gs.pot / winners.length);
    const remainder = gs.pot - base * winners.length;
    winners.forEach((w, i) => {
        const payout = base + (i === 0 ? remainder : 0);
        w.player.chips += payout;
        emitLog(room, `${w.player.name} wins $${payout} with ${w.hand.name}!`);
    });
    gs.pot = 0;
    gs.phase = 'complete';

    for (const p of gs.players) p.eliminated = p.chips <= 0;
    emitState(room);
}

function checkImmediateWin(room) {
    const gs = room.gs;
    const inHand = inHandPlayers(gs);
    if (inHand.length !== 1) return false;
    const w = inHand[0];
    emitLog(room, `${w.name} wins $${gs.pot} (everyone folded)`);
    w.chips += gs.pot;
    gs.pot = 0;
    gs.phase = 'complete';
    for (const p of gs.players) p.eliminated = p.chips <= 0;
    emitState(room);
    return true;
}

function runTurnLoop(room) {
    const gs = room.gs;
    if (gs.phase === 'showdown' || gs.phase === 'complete') return;
    if (checkImmediateWin(room)) return;

    if (gs.playersToAct.length === 0) {
        advancePhase(room);
        return;
    }

    const idx = gs.playersToAct[0];
    gs.currentPlayerIndex = idx;
    const player = gs.players[idx];

    if (!player || player.eliminated || player.folded || player.allIn || player.chips <= 0) {
        gs.playersToAct.shift();
        gs.currentPlayerIndex = gs.playersToAct[0] ?? -1;
        runTurnLoop(room);
        return;
    }

    emitState(room);

    if (player.isAI) {
        const token = room.turnToken;
        const delay = AI_THINK_MIN_MS + Math.floor(Math.random() * (AI_THINK_MAX_MS - AI_THINK_MIN_MS));
        setTimeout(() => {
            if (token !== room.turnToken) return;
            const decision = makeAIDecision(player, gs);
            applyAction(room, idx, decision);
        }, delay);
    }
}

function applyAction(room, playerIndex, actionReq) {
    const gs = room.gs;
    const player = gs.players[playerIndex];

    if (!player || playerIndex !== gs.currentPlayerIndex || gs.playersToAct[0] !== playerIndex) return;
    if (player.folded || player.allIn || player.eliminated || gs.phase === 'complete') return;

    const action = actionReq?.action;
    const toCall = Math.max(0, gs.currentBet - player.currentBet);
    const canCheck = toCall === 0;
    let reopened = false;

    if (action === 'fold') {
        player.folded = true;
        player.actedThisStreet = true;
        player.streetAction = 'Fold';
        emitLog(room, `${player.name} folds`);
    } else if (action === 'check') {
        if (!canCheck) return;
        player.actedThisStreet = true;
        player.streetAction = 'Check';
        emitLog(room, `${player.name} checks`);
    } else if (action === 'call') {
        if (canCheck) {
            player.actedThisStreet = true;
            player.streetAction = 'Check';
            emitLog(room, `${player.name} checks`);
        } else {
            const pay = Math.min(toCall, player.chips);
            player.chips -= pay;
            player.currentBet += pay;
            gs.pot += pay;
            player.actedThisStreet = true;
            if (player.chips === 0) player.allIn = true;
            player.streetAction = player.allIn ? `Call $${pay} (All-in)` : `Call $${pay}`;
            emitLog(room, `${player.name} calls $${pay}${player.allIn ? ' (all-in)' : ''}`);
        }
    } else if (action === 'raise') {
        const maxTo = player.currentBet + player.chips;
        let targetTo = Math.floor(Number(actionReq.amount));
        const legalMin = gs.currentBet + gs.minRaise;

        if (!Number.isFinite(targetTo)) return;
        if (targetTo > maxTo) targetTo = maxTo;
        if (targetTo <= gs.currentBet) {
            return applyAction(room, playerIndex, { action: canCheck ? 'check' : 'call' });
        }
        if (targetTo < legalMin && targetTo < maxTo) {
            emitLog(room, `Minimum raise is to $${legalMin}`);
            return;
        }

        const pay = targetTo - player.currentBet;
        player.chips -= pay;
        player.currentBet = targetTo;
        gs.pot += pay;
        player.actedThisStreet = true;
        player.allIn = player.chips === 0;
        player.streetAction = player.allIn ? `Raise to $${targetTo} (All-in)` : `Raise to $${targetTo}`;

        const raiseSize = targetTo - gs.currentBet;
        if (raiseSize >= gs.minRaise) gs.minRaise = raiseSize;
        gs.currentBet = targetTo;

        for (const p of actionablePlayers(gs)) {
            if (p.id !== player.id) p.actedThisStreet = false;
        }
        reopened = true;
        emitLog(room, `${player.name} raises to $${targetTo}${player.allIn ? ' (all-in)' : ''}`);
    } else {
        return;
    }

    if (checkImmediateWin(room)) return;

    if (gs.playersToAct[0] === playerIndex) gs.playersToAct.shift();
    if (reopened) gs.playersToAct = buildReopenQueue(gs, playerIndex);

    if (gs.playersToAct.length === 0) {
        emitState(room);
        advancePhase(room);
        return;
    }

    gs.currentPlayerIndex = gs.playersToAct[0] ?? -1;
    emitState(room);
    runTurnLoop(room);
}

/* ===== SOCKET.IO ===== */
io.on('connection', (socket) => {
    console.log(`[+] ${socket.id}`);

    socket.on('createRoom', ({ name, totalSeats, numAI }) => {
        const existing = getRoomBySocket(socket.id);
        if (existing) return socket.emit('error', 'You are already in a room.');
        if (!name || !totalSeats) return socket.emit('error', 'Invalid parameters');
        totalSeats = Math.max(2, Math.min(6, parseInt(totalSeats)));
        numAI = Math.max(0, Math.min(totalSeats - 1, parseInt(numAI) || 0));

        const room = createRoom(socket.id, name.trim().substring(0, 20), totalSeats, numAI);
        socket.join(room.code);
        socket.emit('roomCreated', { ...lobbyInfo(room, socket.id), isHost: true });
        console.log(`Room ${room.code} created by ${name}`);
    });

    socket.on('joinRoom', ({ name, code }) => {
        const existing = getRoomBySocket(socket.id);
        if (existing) return socket.emit('error', 'You are already in a room.');
        if (!name || !code) return socket.emit('error', 'Invalid parameters');
        const err = joinRoom(socket.id, name.trim().substring(0, 20), code.toUpperCase());
        if (err) return socket.emit('error', err);

        const room = rooms.get(code.toUpperCase());
        socket.join(room.code);
        socket.emit('joinedRoom', { ...lobbyInfo(room, socket.id), isHost: false });
        emitLobby(room);
        console.log(`${name} joined room ${room.code}`);
    });

    socket.on('startGame', () => {
        const room = getRoomBySocket(socket.id);
        if (!room) return;
        if (socket.id !== room.hostSocketId) return socket.emit('error', 'Only the host can start the game');
        if (room.phase !== 'lobby') return;

        // Fill any remaining empty human slots with AI
        let aiCount = room.numAI;
        room.slots.forEach(s => {
            if (!s.isAI && !s.socketId) {
                s.isAI = true;
                aiCount++;
                s.name = `AI ${aiCount}`;
            }
        });

        startGameInRoom(room);
        console.log(`Game started in room ${room.code}`);
    });

    socket.on('action', ({ type, amount }) => {
        const room = getRoomBySocket(socket.id);
        if (!room || room.phase !== 'playing') return;
        const seat = getSeatBySocket(room, socket.id);
        if (seat < 0) return;
        applyAction(room, seat, { action: type, amount });
    });

    socket.on('nextHand', () => {
        const room = getRoomBySocket(socket.id);
        if (!room || room.phase !== 'playing') return;
        if (room.gs?.phase === 'complete') {
            startNewRound(room);
        }
    });

    socket.on('disconnect', () => {
        console.log(`[-] ${socket.id}`);
        const room = getRoomBySocket(socket.id);
        if (!room) return;

        const slot = getSlotBySocket(room, socket.id);
        if (!slot) return;

        if (room.phase === 'lobby') {
            slot.socketId = null;
            slot.name = null;
            if (socket.id === room.hostSocketId) {
                const newHost = room.slots.find(s => s.socketId && !s.isAI);
                if (newHost) {
                    room.hostSocketId = newHost.socketId;
                    emitLobby(room);
                } else {
                    rooms.delete(room.code);
                }
            } else {
                emitLobby(room);
            }
        } else {
            // In-game: convert disconnected player to AI
            const player = room.gs?.players[slot.seat];
            if (player && !player.eliminated) {
                player.isAI = true;
                slot.isAI = true;
                emitLog(room, `${player.name} disconnected — now playing as AI`);
                // If it was their turn, trigger AI
                if (room.gs.currentPlayerIndex === slot.seat && room.gs.phase !== 'complete') {
                    runTurnLoop(room);
                }
            }
            slot.socketId = null;
        }
    });
});

server.listen(PORT, () => {
    console.log(`\n🃏 Poker server running at http://localhost:${PORT}\n`);
});
