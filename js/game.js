/* ===== GAME STATE ===== */
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_VALUES = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
    '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14
};

const SMALL_BLIND = 10;
const BIG_BLIND = 20;
const STARTING_CHIPS = 1000;
const AI_THINK_MS = 450;
const MAX_LOG_ENTRIES = 120;
const ACTION_LABEL_DURATION_MS = 850;
const SHOWDOWN_TRANSFER_MIN_MS = 560;
const SHOWDOWN_TRANSFER_MAX_MS = 1400;

let gameState = {
    players: [],
    deck: [],
    communityCards: [],
    pot: 0,
    currentBet: 0,
    minRaise: BIG_BLIND,
    dealerPosition: -1,
    smallBlindPosition: -1,
    bigBlindPosition: -1,
    currentPlayerIndex: 0,
    phase: 'idle', // preflop, flop, turn, river, showdown, complete
    turnToken: 0,
    playersToAct: [],
    boardAnimatedCount: 0,
    potPulseTimer: null,
    actionLabelTimers: new Map(),
    performance: {
        handsPlayed: 0,
        preflopOpportunities: 0,
        vpipHands: 0,
        handsWon: 0,
        grossWon: 0
    },
    handTracking: {
        humanVoluntaryPutInPreflop: false,
        humanCanTrackThisHand: false,
        humanWonThisHand: false
    }
};

function getHumanPlayer() {
    return gameState.players.find((p) => p.id === 0) || null;
}

function formatCurrency(amount) {
    const value = Number.isFinite(amount) ? amount : 0;
    const sign = value > 0 ? '+' : '';
    return `${sign}$${value}`;
}

function updatePerformancePanel() {
    const human = getHumanPlayer();
    const chips = human ? human.chips : 0;

    const { handsPlayed, preflopOpportunities, vpipHands, handsWon, grossWon } = gameState.performance;
    const vpipPct = preflopOpportunities > 0 ? (vpipHands / preflopOpportunities) * 100 : 0;
    const winRate = handsPlayed > 0 ? (handsWon / handsPlayed) * 100 : 0;
    const net = chips - STARTING_CHIPS;

    const setValue = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };

    setValue('statHandsPlayed', `${handsPlayed}`);
    setValue('statVpip', `${vpipPct.toFixed(1)}%`);
    setValue('statHandsWon', `${handsWon}`);
    setValue('statWinRate', `${winRate.toFixed(1)}%`);
    setValue('statGrossWon', `$${grossWon}`);
    setValue('statNetWon', formatCurrency(net));
}

function trackHumanPreflopVoluntaryAction() {
    if (gameState.phase !== 'preflop') return;
    if (!gameState.handTracking.humanCanTrackThisHand) return;
    if (gameState.handTracking.humanVoluntaryPutInPreflop) return;

    gameState.handTracking.humanVoluntaryPutInPreflop = true;
    gameState.performance.vpipHands += 1;
    updatePerformancePanel();
}

function trackHumanHandWin(amount) {
    if (!gameState.handTracking.humanCanTrackThisHand) return;
    if (gameState.handTracking.humanWonThisHand) return;
    if (!(amount > 0)) return;

    gameState.handTracking.humanWonThisHand = true;
    gameState.performance.handsWon += 1;
    gameState.performance.grossWon += amount;
    updatePerformancePanel();
}

/* ===== DECK MANAGEMENT ===== */
function createDeck() {
    const deck = [];
    for (const suit of SUITS) {
        for (const rank of RANKS) {
            deck.push({ rank, suit });
        }
    }
    return deck;
}

function shuffleDeck(deck) {
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

    for (const combo of combos) {
        const h = evaluateFiveCards(combo);
        if (h.rank > best.rank || (h.rank === best.rank && compareValues(h.values, best.values) > 0)) {
            best = h;
        }
    }

    return best;
}

function getCombinations(arr, size) {
    const out = [];

    function walk(start, picked) {
        if (picked.length === size) {
            out.push([...picked]);
            return;
        }
        for (let i = start; i < arr.length; i++) {
            picked.push(arr[i]);
            walk(i + 1, picked);
            picked.pop();
        }
    }

    walk(0, []);
    return out;
}

function getStraightHigh(ranksDescUnique) {
    if (ranksDescUnique.length < 5) return null;

    for (let i = 0; i <= ranksDescUnique.length - 5; i++) {
        const w = ranksDescUnique.slice(i, i + 5);
        if (w[0] - w[4] === 4) return w[0];
    }

    // Wheel A-2-3-4-5 => high card 5
    const hasWheel = [14, 5, 4, 3, 2].every((r) => ranksDescUnique.includes(r));
    return hasWheel ? 5 : null;
}

function evaluateFiveCards(cards) {
    const suits = cards.map((c) => c.suit);
    const ranks = cards.map((c) => RANK_VALUES[c.rank]).sort((a, b) => b - a);
    const rankCounts = {};
    ranks.forEach((r) => { rankCounts[r] = (rankCounts[r] || 0) + 1; });

    const uniqueRanks = Object.keys(rankCounts).map(Number).sort((a, b) => b - a);
    const counts = Object.values(rankCounts).sort((a, b) => b - a);

    const isFlush = suits.every((s) => s === suits[0]);
    const straightHigh = getStraightHigh(uniqueRanks);
    const isStraight = straightHigh !== null;

    if (isFlush && isStraight && straightHigh === 14 && uniqueRanks.includes(10)) {
        return { rank: 9, values: [14], name: 'Royal Flush' };
    }

    if (isFlush && isStraight) {
        return { rank: 8, values: [straightHigh], name: 'Straight Flush' };
    }

    if (counts[0] === 4) {
        const four = uniqueRanks.find((r) => rankCounts[r] === 4);
        const kicker = uniqueRanks.find((r) => rankCounts[r] === 1);
        return { rank: 7, values: [four, kicker], name: 'Four of a Kind' };
    }

    if (counts[0] === 3 && counts[1] === 2) {
        const trips = uniqueRanks.find((r) => rankCounts[r] === 3);
        const pair = uniqueRanks.find((r) => rankCounts[r] === 2);
        return { rank: 6, values: [trips, pair], name: 'Full House' };
    }

    if (isFlush) {
        return { rank: 5, values: ranks, name: 'Flush' };
    }

    if (isStraight) {
        return { rank: 4, values: [straightHigh], name: 'Straight' };
    }

    if (counts[0] === 3) {
        const trips = uniqueRanks.find((r) => rankCounts[r] === 3);
        const kickers = uniqueRanks.filter((r) => rankCounts[r] === 1);
        return { rank: 3, values: [trips, ...kickers], name: 'Three of a Kind' };
    }

    if (counts[0] === 2 && counts[1] === 2) {
        const pairs = uniqueRanks.filter((r) => rankCounts[r] === 2).sort((a, b) => b - a);
        const kicker = uniqueRanks.find((r) => rankCounts[r] === 1);
        return { rank: 2, values: [...pairs, kicker], name: 'Two Pair' };
    }

    if (counts[0] === 2) {
        const pair = uniqueRanks.find((r) => rankCounts[r] === 2);
        const kickers = uniqueRanks.filter((r) => rankCounts[r] === 1);
        return { rank: 1, values: [pair, ...kickers], name: 'One Pair' };
    }

    return { rank: 0, values: ranks, name: 'High Card' };
}

function compareValues(a, b) {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
        const av = a[i] || 0;
        const bv = b[i] || 0;
        if (av > bv) return 1;
        if (av < bv) return -1;
    }
    return 0;
}

/* ===== AI LOGIC ===== */
function evaluatePreflopStrength(cardA, cardB) {
    const r1 = RANK_VALUES[cardA.rank];
    const r2 = RANK_VALUES[cardB.rank];
    const high = Math.max(r1, r2);
    const low = Math.min(r1, r2);
    const suited = cardA.suit === cardB.suit;
    const pair = r1 === r2;
    const gap = high - low;

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

    // Flush draw approximation
    const suitCounts = {};
    for (const c of cards) suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1;
    const flushDraw = Object.values(suitCounts).some((count) => count === 4);

    // Straight draw approximation
    const ranks = [...new Set(cards.map((c) => RANK_VALUES[c.rank]))].sort((a, b) => a - b);
    if (ranks.includes(14)) ranks.unshift(1);
    let openEnded = false;
    let gutshot = false;
    for (let i = 0; i <= ranks.length - 4; i++) {
        const segment = ranks.slice(i, i + 4);
        const span = segment[3] - segment[0];
        if (span === 3) openEnded = true;
        if (span === 4) gutshot = true;
    }

    let draw = 0;
    if (flushDraw) draw += board.length === 3 ? 0.36 : 0.2;
    if (openEnded) draw += board.length === 3 ? 0.31 : 0.17;
    else if (gutshot) draw += board.length === 3 ? 0.17 : 0.09;
    return Math.min(0.45, draw);
}

function getPostflopHandStrength(player) {
    const hand = evaluateHand([...player.hand, ...gameState.communityCards]);
    const byRank = [0.08, 0.32, 0.52, 0.67, 0.79, 0.86, 0.93, 0.97, 0.99, 1];
    return { hand, strength: byRank[hand.rank] || 0.08 };
}

function makeAIDecision(player) {
    const toCall = Math.max(0, gameState.currentBet - player.currentBet);
    const canCheck = toCall === 0;
    const potAfterCall = gameState.pot + toCall;
    const potOdds = toCall > 0 ? toCall / Math.max(1, potAfterCall) : 0;

    let handStrength = 0;
    let drawStrength = 0;

    if (gameState.phase === 'preflop') {
        handStrength = evaluatePreflopStrength(player.hand[0], player.hand[1]);
    } else {
        const post = getPostflopHandStrength(player);
        handStrength = post.strength;
        drawStrength = estimateDrawStrength(player, gameState.communityCards);
    }

    const effectiveEquity = Math.min(0.99, handStrength + drawStrength * 0.6);
    const stackPressure = toCall / Math.max(1, player.chips);
    const strongRaiseThreshold = gameState.phase === 'preflop' ? 0.72 : 0.78;
    const mediumRaiseThreshold = gameState.phase === 'preflop' ? 0.64 : 0.68;

    if (!canCheck) {
        if (stackPressure > 0.55 && effectiveEquity < 0.55) {
            return { action: 'fold' };
        }

        if (effectiveEquity + 0.05 < potOdds) {
            if (toCall <= BIG_BLIND && Math.random() < 0.25) return { action: 'call' };
            return { action: 'fold' };
        }
    }

    const legalMinRaiseTo = gameState.currentBet + gameState.minRaise;
    const maxRaiseTo = player.currentBet + player.chips;
    const canRaise = maxRaiseTo > gameState.currentBet;

    if (canRaise) {
        if (effectiveEquity >= strongRaiseThreshold && Math.random() < 0.72) {
            const target = Math.max(legalMinRaiseTo, Math.floor(gameState.currentBet + gameState.pot * 0.6));
            return { action: 'raise', amount: Math.min(maxRaiseTo, target) };
        }
        if (effectiveEquity >= mediumRaiseThreshold && canCheck && Math.random() < 0.28) {
            const target = Math.max(legalMinRaiseTo, Math.floor(gameState.currentBet + Math.max(BIG_BLIND, gameState.pot * 0.35)));
            return { action: 'raise', amount: Math.min(maxRaiseTo, target) };
        }
    }

    if (canCheck) return { action: 'check' };
    return { action: 'call' };
}

/* ===== PLAYER + ROUND HELPERS ===== */
function createPlayer(id, name, isAI) {
    return {
        id,
        name,
        isAI,
        chips: STARTING_CHIPS,
        hand: [],
        currentBet: 0,
        folded: false,
        allIn: false,
        actedThisStreet: false,
        eliminated: false,
        streetAction: '',
        actionState: {
            name: '',
            labelUntil: 0
        }
    };
}

function clearActionLabelTimer(playerId) {
    const timer = gameState.actionLabelTimers.get(playerId);
    if (!timer) return;
    clearTimeout(timer);
    gameState.actionLabelTimers.delete(playerId);
}

function setPlayerActionState(player, actionName = '') {
    clearActionLabelTimer(player.id);

    if (!actionName) {
        player.actionState = { name: '', labelUntil: 0 };
        return;
    }

    const labelUntil = Date.now() + ACTION_LABEL_DURATION_MS;
    player.actionState = { name: actionName, labelUntil };

    const timer = setTimeout(() => {
        player.actionState = { name: '', labelUntil: 0 };
        gameState.actionLabelTimers.delete(player.id);
        updateUI();
    }, ACTION_LABEL_DURATION_MS + 10);

    gameState.actionLabelTimers.set(player.id, timer);
}

function pulsePot() {
    const el = document.getElementById('potDisplay');
    if (!el) return;
    if (gameState.potPulseTimer) clearTimeout(gameState.potPulseTimer);
    el.classList.add('pot-pulse');
    gameState.potPulseTimer = setTimeout(() => {
        el.classList.remove('pot-pulse');
        gameState.potPulseTimer = null;
    }, 210);
}

function alivePlayers() {
    return gameState.players.filter((p) => !p.eliminated);
}

function inHandPlayers() {
    return alivePlayers().filter((p) => !p.folded);
}

function actionablePlayers() {
    return inHandPlayers().filter((p) => !p.allIn && p.chips > 0);
}

function nextAliveIndex(fromIdx) {
    const n = gameState.players.length;
    for (let step = 1; step <= n; step++) {
        const idx = (fromIdx + step) % n;
        if (!gameState.players[idx].eliminated) return idx;
    }
    return fromIdx;
}

function getBlindSeatIndexes() {
    const alive = alivePlayers();
    if (alive.length < 2) {
        return { smallBlindPos: -1, bigBlindPos: -1 };
    }

    // Heads-up rule:
    // Dealer posts SB, other player posts BB.
    if (alive.length === 2) {
        const smallBlindPos = gameState.dealerPosition;
        const bigBlindPos = nextAliveIndex(gameState.dealerPosition);
        return { smallBlindPos, bigBlindPos };
    }

    // 3+ players:
    // SB is left of dealer, BB is left of SB.
    const smallBlindPos = nextAliveIndex(gameState.dealerPosition);
    const bigBlindPos = nextAliveIndex(smallBlindPos);
    return { smallBlindPos, bigBlindPos };
}

function findNextActionableIndex(fromIdx) {
    const n = gameState.players.length;
    for (let step = 1; step <= n; step++) {
        const idx = (fromIdx + step) % n;
        const p = gameState.players[idx];
        if (!p.eliminated && !p.folded && !p.allIn && p.chips > 0) {
            return idx;
        }
    }
    return -1;
}

function buildFullActionQueue(startIdx) {
    if (!Number.isInteger(startIdx) || startIdx < 0) return [];
    const queue = [startIdx];
    let idx = findNextActionableIndex(startIdx);
    while (idx !== -1 && idx !== startIdx) {
        queue.push(idx);
        idx = findNextActionableIndex(idx);
        if (queue.length > gameState.players.length + 1) break;
    }
    return queue;
}

function buildReopenQueueAfterRaise(raiserIdx) {
    const queue = [];
    let idx = findNextActionableIndex(raiserIdx);
    while (idx !== -1 && idx !== raiserIdx) {
        queue.push(idx);
        idx = findNextActionableIndex(idx);
        if (queue.length > gameState.players.length + 1) break;
    }
    return queue;
}

function resetStreetBets() {
    for (const p of gameState.players) {
        p.currentBet = 0;
        p.actedThisStreet = false;
    }
    gameState.currentBet = 0;
    gameState.minRaise = BIG_BLIND;
}

function postBlind(index, amount, label) {
    const p = gameState.players[index];
    if (p.eliminated) return;

    const paid = Math.min(amount, p.chips);
    p.chips -= paid;
    p.currentBet += paid;
    p.allIn = p.chips === 0;
    gameState.pot += paid;

    addLog(`${p.name} posts ${label}: $${paid}`);
}

function dealHoleCards() {
    for (const p of alivePlayers()) {
        p.hand = [gameState.deck.pop(), gameState.deck.pop()];
    }
}

function dealCommunityCards(count) {
    for (let i = 0; i < count; i++) {
        gameState.communityCards.push(gameState.deck.pop());
    }
    renderCommunityCards(count);
}

function isBettingRoundComplete() {
    return gameState.playersToAct.length === 0;
}

function checkForImmediateWin() {
    const inHand = inHandPlayers();
    if (inHand.length !== 1) return false;
    const winner = inHand[0];
    const amountWon = gameState.pot;
    winner.chips += gameState.pot;
    addLog(`${winner.name} wins $${gameState.pot} (everyone folded)`);
    gameState.pot = 0;

    if (winner.id === 0) {
        trackHumanHandWin(amountWon);
    }

    gameState.phase = 'complete';
    markEliminations();
    updateUI();
    document.getElementById(`info${winner.id}`).classList.add('winner');
    return true;
}

function markEliminations() {
    for (const p of gameState.players) {
        p.eliminated = p.chips <= 0;
    }
}

function tournamentWinner() {
    const alive = alivePlayers();
    return alive.length === 1 ? alive[0] : null;
}

/* ===== GAME FLOW ===== */
function initGame() {
    gameState.players = [
        createPlayer(0, 'You', false),
        createPlayer(1, 'AI 1', true),
        createPlayer(2, 'AI 2', true),
        createPlayer(3, 'AI 3', true)
    ];

    createPlayerElements();
    startNewRound();
}

function createPlayerElements() {
    const container = document.getElementById('gameContainer');
    gameState.players.forEach((player, index) => {
        const playerDiv = document.createElement('div');
        playerDiv.id = `player${index}`;
        playerDiv.className = 'player';
        playerDiv.innerHTML = `
            <div class="player-cards" id="cards${index}"></div>
            <div class="player-info" id="info${index}">
                <div class="player-name">${player.name}
                    <span class="role-badge dealer-button" id="dealer${index}" style="display:none;">D</span>
                    <span class="role-badge sb-button" id="sb${index}" style="display:none;">SB</span>
                    <span class="role-badge bb-button" id="bb${index}" style="display:none;">BB</span>
                </div>
                <div class="player-chips" id="chips${index}">$${player.chips}</div>
                <div class="player-bet" id="bet${index}"></div>
                <div class="player-status" id="status${index}"></div>
            </div>
        `;
        container.appendChild(playerDiv);
    });
}

function startNewRound() {
    gameState.turnToken += 1;

    const winner = tournamentWinner();
    if (winner) {
        addLog(`Game Over! ${winner.name} wins the table.`);
        gameState.phase = 'complete';
        updateUI();
        return;
    }

    gameState.deck = shuffleDeck(createDeck());
    gameState.communityCards = [];
    gameState.boardAnimatedCount = 0;
    gameState.pot = 0;
    gameState.phase = 'preflop';
    gameState.minRaise = BIG_BLIND;

    const human = getHumanPlayer();
    const humanCanTrack = !!human && !human.eliminated;
    gameState.handTracking = {
        humanVoluntaryPutInPreflop: false,
        humanCanTrackThisHand: humanCanTrack,
        humanWonThisHand: false
    };

    if (humanCanTrack) {
        gameState.performance.handsPlayed += 1;
        gameState.performance.preflopOpportunities += 1;
    }

    for (const p of gameState.players) {
        p.hand = [];
        p.currentBet = 0;
        p.folded = p.eliminated;
        p.allIn = false;
        p.actedThisStreet = false;
        p.streetAction = '';
        setPlayerActionState(p, '');
    }

    document.querySelectorAll('.winner').forEach((el) => el.classList.remove('winner'));

    gameState.dealerPosition = nextAliveIndex(gameState.dealerPosition);
    const { smallBlindPos, bigBlindPos } = getBlindSeatIndexes();

    gameState.smallBlindPosition = smallBlindPos;
    gameState.bigBlindPosition = bigBlindPos;

    postBlind(smallBlindPos, SMALL_BLIND, 'small blind');
    postBlind(bigBlindPos, BIG_BLIND, 'big blind');

    gameState.currentBet = Math.max(
        gameState.players[smallBlindPos].currentBet,
        gameState.players[bigBlindPos].currentBet
    );

    dealHoleCards();

    // Preflop starts left of BB (which is dealer in heads-up, per rules)
    const preflopStart = findNextActionableIndex(bigBlindPos);
    gameState.playersToAct = buildFullActionQueue(preflopStart);
    gameState.currentPlayerIndex = gameState.playersToAct[0] ?? -1;
    addLog('--- New Round Started ---');
    addLog(`Dealer: ${gameState.players[gameState.dealerPosition].name}`);

    updateUI({ animateHoleDeal: true });
    updatePerformancePanel();
    runTurnLoop();
}

function advancePhase() {
    gameState.turnToken += 1;

    for (const p of gameState.players) {
        p.currentBet = 0;
        p.actedThisStreet = false;
        p.streetAction = '';
    }
    gameState.currentBet = 0;
    gameState.minRaise = BIG_BLIND;

    if (gameState.phase === 'preflop') {
        gameState.phase = 'flop';
        dealCommunityCards(3);
        addLog('--- Flop ---');
    } else if (gameState.phase === 'flop') {
        gameState.phase = 'turn';
        dealCommunityCards(1);
        addLog('--- Turn ---');
    } else if (gameState.phase === 'turn') {
        gameState.phase = 'river';
        dealCommunityCards(1);
        addLog('--- River ---');
    } else {
        gameState.phase = 'showdown';
        showdown();
        return;
    }

    const start = findNextActionableIndex(gameState.dealerPosition);
    gameState.playersToAct = buildFullActionQueue(start);
    gameState.currentPlayerIndex = gameState.playersToAct[0] ?? -1;
    updateUI();
    runTurnLoop();
}

function showdown() {
    const contenders = inHandPlayers();
    addLog('--- Showdown ---');

    if (contenders.length === 0) {
        gameState.phase = 'complete';
        updateUI();
        return;
    }

    const results = contenders.map((player) => ({
        player,
        hand: evaluateHand([...player.hand, ...gameState.communityCards])
    }));

    results.forEach((r) => addLog(`${r.player.name}: ${r.hand.name}`));

    let winners = [results[0]];
    for (let i = 1; i < results.length; i++) {
        const r = results[i];
        const rankDiff = r.hand.rank - winners[0].hand.rank;
        if (rankDiff > 0) {
            winners = [r];
        } else if (rankDiff === 0) {
            const cmp = compareValues(r.hand.values, winners[0].hand.values);
            if (cmp > 0) winners = [r];
            else if (cmp === 0) winners.push(r);
        }
    }

    const base = Math.floor(gameState.pot / winners.length);
    let odd = gameState.pot - base * winners.length;

    const payouts = winners.map((w, i) => ({
        winner: w,
        payout: base + (odd > 0 && i === 0 ? odd : 0)
    }));

    const humanPayout = payouts
        .filter((p) => p.winner.player.id === 0)
        .reduce((sum, p) => sum + p.payout, 0);
    if (humanPayout > 0) {
        trackHumanHandWin(humanPayout);
    }

    payouts.forEach(({ winner, payout }) => {
        addLog(`${winner.player.name} wins $${payout} with ${winner.hand.name}!`);
    });

    animateShowdownPayout(payouts).then(() => {
        gameState.phase = 'complete';
        markEliminations();
        updateUI();

        winners.forEach((w) => {
            document.getElementById(`info${w.player.id}`).classList.add('winner');
        });
    });
}

function animateShowdownPayout(payouts) {
    const startingPot = gameState.pot;
    if (!Array.isArray(payouts) || payouts.length === 0 || startingPot <= 0) {
        gameState.pot = 0;
        return Promise.resolve();
    }

    const totalPayout = payouts.reduce((sum, p) => sum + p.payout, 0);
    if (totalPayout <= 0) {
        gameState.pot = 0;
        return Promise.resolve();
    }

    const before = new Map();
    payouts.forEach(({ winner }) => before.set(winner.player.id, winner.player.chips));

    const duration = Math.max(
        SHOWDOWN_TRANSFER_MIN_MS,
        Math.min(SHOWDOWN_TRANSFER_MAX_MS, 320 + totalPayout * 2.2)
    );

    const startedAt = Date.now();

    return new Promise((resolve) => {
        function step() {
            const now = Date.now();
            const t = Math.min(1, (now - startedAt) / duration);
            const eased = 1 - Math.pow(1 - t, 3);

            let paidSoFar = 0;
            payouts.forEach(({ winner, payout }) => {
                const delta = Math.floor(payout * eased);
                winner.player.chips = (before.get(winner.player.id) || 0) + delta;
                paidSoFar += delta;
            });

            gameState.pot = Math.max(0, startingPot - paidSoFar);
            updateUI();

            if (t >= 1) {
                payouts.forEach(({ winner, payout }) => {
                    winner.player.chips = (before.get(winner.player.id) || 0) + payout;
                });
                gameState.pot = 0;
                pulsePot();
                updateUI();
                resolve();
                return;
            }

            requestAnimationFrame(step);
        }

        requestAnimationFrame(step);
    });
}

function runTurnLoop() {
    if (gameState.phase === 'showdown' || gameState.phase === 'complete') return;
    if (checkForImmediateWin()) return;

    if (isBettingRoundComplete()) {
        advancePhase();
        return;
    }

    const idx = gameState.playersToAct[0] ?? -1;
    gameState.currentPlayerIndex = idx;
    const player = gameState.players[idx];
    if (!player || player.eliminated || player.folded || player.allIn || player.chips <= 0) {
        gameState.playersToAct.shift();
        gameState.currentPlayerIndex = gameState.playersToAct[0] ?? -1;
        updateUI();
        runTurnLoop();
        return;
    }

    updateUI();

    if (player.isAI) {
        const token = gameState.turnToken;
        setTimeout(() => {
            if (token !== gameState.turnToken) return;
            const decision = makeAIDecision(player);
            applyAction(idx, decision);
        }, AI_THINK_MS + Math.floor(Math.random() * 250));
    }
}

/* ===== ACTION APPLICATION ===== */
function applyAction(playerIndex, actionRequest) {
    const player = gameState.players[playerIndex];
    if (!player || playerIndex !== gameState.currentPlayerIndex || gameState.playersToAct[0] !== playerIndex) return;
    if (player.folded || player.allIn || player.eliminated || gameState.phase === 'complete') return;

    const action = actionRequest?.action;
    const toCall = Math.max(0, gameState.currentBet - player.currentBet);
    const canCheck = toCall === 0;
    let reopenedByRaise = false;

    if (action === 'fold') {
        player.folded = true;
        player.actedThisStreet = true;
        player.streetAction = 'Fold';
        setPlayerActionState(player, 'fold');
        addLog(`${player.name} folds`);
    } else if (action === 'check') {
        if (!canCheck) return;
        player.actedThisStreet = true;
        player.streetAction = 'Check';
        setPlayerActionState(player, 'check');
        addLog(`${player.name} checks`);
    } else if (action === 'call') {
        if (canCheck) {
            player.actedThisStreet = true;
            player.streetAction = 'Check';
            setPlayerActionState(player, 'check');
            addLog(`${player.name} checks`);
        } else {
            const pay = Math.min(toCall, player.chips);
            if (player.id === 0 && gameState.phase === 'preflop' && pay > 0) {
                trackHumanPreflopVoluntaryAction();
            }
            player.chips -= pay;
            player.currentBet += pay;
            gameState.pot += pay;
            player.actedThisStreet = true;
            if (player.chips === 0) player.allIn = true;
            player.streetAction = player.allIn ? `Call $${pay} (All-in)` : `Call $${pay}`;
            setPlayerActionState(player, player.allIn ? 'allin' : 'call');
            addLog(`${player.name} calls $${pay}${player.allIn ? ' (all-in)' : ''}`);
            pulsePot();
        }
    } else if (action === 'raise') {
        const maxTo = player.currentBet + player.chips;
        let targetTo = Number(actionRequest.amount);
        const legalMinTo = gameState.currentBet + gameState.minRaise;

        if (!Number.isFinite(targetTo)) return;
        targetTo = Math.floor(targetTo);
        if (targetTo > maxTo) targetTo = maxTo;

        if (targetTo <= gameState.currentBet) {
            return applyAction(playerIndex, { action: canCheck ? 'check' : 'call' });
        }

        if (targetTo < legalMinTo && targetTo < maxTo) {
            addLog(`Minimum raise is to $${legalMinTo}`);
            return;
        }

        const pay = targetTo - player.currentBet;
        if (player.id === 0 && gameState.phase === 'preflop' && pay > 0) {
            trackHumanPreflopVoluntaryAction();
        }
        player.chips -= pay;
        player.currentBet = targetTo;
        gameState.pot += pay;
        player.actedThisStreet = true;
        player.allIn = player.chips === 0;
        player.streetAction = player.allIn ? `Raise to $${targetTo} (All-in)` : `Raise to $${targetTo}`;
        setPlayerActionState(player, player.allIn ? 'allin' : 'raise');

        const raiseSize = targetTo - gameState.currentBet;
        if (raiseSize >= gameState.minRaise) {
            gameState.minRaise = raiseSize;
        }
        gameState.currentBet = targetTo;

        for (const p of actionablePlayers()) {
            if (p.id !== player.id) p.actedThisStreet = false;
        }

        reopenedByRaise = true;

        addLog(`${player.name} raises to $${targetTo}${player.allIn ? ' (all-in)' : ''}`);
        pulsePot();
    } else {
        return;
    }

    if (checkForImmediateWin()) return;

    // Current player has acted; remove from the front of action queue.
    if (gameState.playersToAct[0] === playerIndex) {
        gameState.playersToAct.shift();
    }

    // A raise reopens action for everyone else still eligible.
    if (reopenedByRaise) {
        gameState.playersToAct = buildReopenQueueAfterRaise(playerIndex);
    }

    if (isBettingRoundComplete()) {
        updateUI();
        advancePhase();
        return;
    }

    gameState.currentPlayerIndex = gameState.playersToAct[0] ?? -1;
    updateUI();
    runTurnLoop();
}

/* ===== PLAYER INPUT HANDLERS ===== */
function playerFold() {
    applyAction(gameState.currentPlayerIndex, { action: 'fold' });
}

function playerCheck() {
    applyAction(gameState.currentPlayerIndex, { action: 'check' });
}

function playerCall() {
    applyAction(gameState.currentPlayerIndex, { action: 'call' });
}

function playerRaise() {
    const p = gameState.players[gameState.currentPlayerIndex];
    if (!p) return;

    const input = document.getElementById('raiseAmount');
    const parsed = Number.parseInt(input.value, 10);
    if (!Number.isFinite(parsed)) {
        addLog('Enter a raise total amount.');
        return;
    }

    applyAction(gameState.currentPlayerIndex, { action: 'raise', amount: parsed });
    input.value = '';
}

/* ===== UI ===== */
function renderCommunityCards(newlyDealtCount = 0) {
    const communityDiv = document.getElementById('communityCards');
    communityDiv.innerHTML = '';

    const startAnimatedIndex = Math.max(0, gameState.communityCards.length - newlyDealtCount);
    gameState.communityCards.forEach((card, idx) => {
        const isNew = idx >= startAnimatedIndex && newlyDealtCount > 0;
        const dealDelayMs = isNew ? (idx - startAnimatedIndex) * 90 : 0;
        const cardEl = createCardElement(card, false, {
            boardNew: isNew,
            dealDelayMs
        });
        communityDiv.appendChild(cardEl);
    });

    gameState.boardAnimatedCount = gameState.communityCards.length;
}

function updateUI({ animateHoleDeal = false } = {}) {
    document.getElementById('potDisplay').textContent = `Pot: $${gameState.pot}`;
    renderCommunityCards(0);

    const now = Date.now();

    gameState.players.forEach((player, idx) => {
        const playerEl = document.getElementById(`player${idx}`);
        const cardsDiv = document.getElementById(`cards${idx}`);
        const infoDiv = document.getElementById(`info${idx}`);
        const chipsDiv = document.getElementById(`chips${idx}`);
        const betDiv = document.getElementById(`bet${idx}`);
        const statusDiv = document.getElementById(`status${idx}`);
        const dealerBtn = document.getElementById(`dealer${idx}`);
        const sbBtn = document.getElementById(`sb${idx}`);
        const bbBtn = document.getElementById(`bb${idx}`);

        cardsDiv.innerHTML = '';
        if (player.hand.length > 0) {
            const showCards = !player.isAI || gameState.phase === 'showdown' || gameState.phase === 'complete';
            player.hand.forEach((card, cardIdx) => {
                const cardEl = createCardElement(card, !showCards, {
                    isDealing: animateHoleDeal,
                    dealDelayMs: animateHoleDeal ? (idx * 60 + cardIdx * 90) : 0
                });
                cardsDiv.appendChild(cardEl);
            });
        }

        chipsDiv.textContent = `$${player.chips}`;
        betDiv.textContent = player.currentBet > 0 ? `Bet: $${player.currentBet}` : '';

        playerEl.classList.remove('checked', 'called', 'raised', 'allin', 'action-label');
        infoDiv.classList.remove('folded', 'active');
        if (player.eliminated) {
            statusDiv.textContent = 'Out';
            infoDiv.classList.add('folded');
        } else if (player.folded) {
            statusDiv.textContent = player.streetAction || 'Folded';
            infoDiv.classList.add('folded');
        } else if (player.allIn) {
            statusDiv.textContent = player.streetAction || 'All-in';
        } else {
            if (player.actionState?.name && (player.actionState.labelUntil || 0) > now) {
                const labelMap = {
                    fold: 'Fold',
                    check: 'Check',
                    call: 'Call',
                    raise: 'Raise',
                    allin: 'All-In'
                };
                statusDiv.textContent = labelMap[player.actionState.name] || '';
                playerEl.classList.add('action-label');
                if (player.actionState.name === 'check') playerEl.classList.add('checked');
                if (player.actionState.name === 'call') playerEl.classList.add('called');
                if (player.actionState.name === 'raise') playerEl.classList.add('raised');
                if (player.actionState.name === 'allin') playerEl.classList.add('allin');
            } else {
                statusDiv.textContent = player.streetAction || '';
            }
        }

        if (
            idx === gameState.currentPlayerIndex &&
            gameState.phase !== 'complete' &&
            gameState.phase !== 'showdown' &&
            !player.folded &&
            !player.eliminated &&
            !player.allIn
        ) {
            infoDiv.classList.add('active');
        }

        dealerBtn.style.display = idx === gameState.dealerPosition ? 'inline-block' : 'none';
        sbBtn.style.display = idx === gameState.smallBlindPosition ? 'inline-block' : 'none';
        bbBtn.style.display = idx === gameState.bigBlindPosition ? 'inline-block' : 'none';
    });

    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    const playerCanAct = !!currentPlayer &&
        !currentPlayer.isAI &&
        !currentPlayer.folded &&
        !currentPlayer.eliminated &&
        !currentPlayer.allIn &&
        gameState.phase !== 'complete' &&
        gameState.phase !== 'showdown';

    const toCall = currentPlayer ? Math.max(0, gameState.currentBet - currentPlayer.currentBet) : 0;

    document.getElementById('foldBtn').disabled = !playerCanAct;
    document.getElementById('checkBtn').disabled = !playerCanAct || toCall > 0;

    const callBtn = document.getElementById('callBtn');
    callBtn.textContent = toCall > 0 ? `Call $${toCall}` : 'Call $0';
    callBtn.disabled = !playerCanAct || toCall === 0;

    document.getElementById('raiseBtn').disabled = !playerCanAct;
    document.getElementById('raiseAmount').disabled = !playerCanAct;
    document.getElementById('newGameBtn').disabled = gameState.phase !== 'complete';

    updatePerformancePanel();
}

function createCardElement(card, faceDown, options = {}) {
    const {
        isDealing = false,
        boardNew = false,
        dealDelayMs = 0
    } = options;

    const cardDiv = document.createElement('div');
    cardDiv.className = 'card';

    if (isDealing) {
        cardDiv.classList.add('is-dealing');
        cardDiv.style.setProperty('--deal-delay', `${dealDelayMs}ms`);
    }

    if (boardNew) {
        cardDiv.classList.add('board-new');
        cardDiv.style.setProperty('--deal-delay', `${dealDelayMs}ms`);
    }

    if (faceDown) {
        cardDiv.classList.add('face-down');
        return cardDiv;
    }

    const color = card.suit === '♥' || card.suit === '♦' ? 'red' : 'black';
    cardDiv.classList.add(color);
    cardDiv.innerHTML = `
        <div class="rank">${card.rank}</div>
        <div class="suit">${card.suit}</div>
    `;
    return cardDiv;
}

function addLog(message) {
    const logContent = document.getElementById('logContent');
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.textContent = message;
    logContent.appendChild(entry);

    while (logContent.children.length > MAX_LOG_ENTRIES) {
        logContent.removeChild(logContent.firstChild);
    }

    logContent.scrollTop = logContent.scrollHeight;
}

/* ===== EVENT LISTENERS ===== */
document.getElementById('foldBtn').addEventListener('click', playerFold);
document.getElementById('checkBtn').addEventListener('click', playerCheck);
document.getElementById('callBtn').addEventListener('click', playerCall);
document.getElementById('raiseBtn').addEventListener('click', playerRaise);
document.getElementById('newGameBtn').addEventListener('click', startNewRound);

document.getElementById('raiseAmount').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') playerRaise();
});

const helpBtn = document.getElementById('helpBtn');
const helpModal = document.getElementById('helpModal');
const helpCloseBtn = document.getElementById('helpCloseBtn');

if (helpBtn && helpModal) {
    helpBtn.addEventListener('click', () => {
        helpModal.classList.remove('hidden');
    });
}

if (helpCloseBtn && helpModal) {
    helpCloseBtn.addEventListener('click', () => {
        helpModal.classList.add('hidden');
    });
}

if (helpModal) {
    helpModal.addEventListener('click', (e) => {
        if (e.target === helpModal) {
            helpModal.classList.add('hidden');
        }
    });
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && helpModal && !helpModal.classList.contains('hidden')) {
        helpModal.classList.add('hidden');
    }
});

window.addEventListener('load', initGame);
