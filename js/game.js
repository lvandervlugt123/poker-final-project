/* ===== LOCAL AI-ONLY MODE ===== */
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const VALUES = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14 };
const SMALL_BLIND = 10;
const BIG_BLIND = 20;
const STARTING_CHIPS = 1000;
const MAX_LOG_ENTRIES = 120;

const state = {
    players: [],
    deck: [],
    board: [],
    pot: 0,
    currentBet: 0,
    minRaise: BIG_BLIND,
    dealer: -1,
    sb: -1,
    bb: -1,
    current: -1,
    phase: 'idle',
    queue: []
};

function startGame() {
    document.getElementById('lobbyOverlay').classList.add('hidden');
    document.getElementById('gameContainer').classList.remove('hidden');
    if (state.players.length === 0) initGame();
}

function backToLanding() { location.reload(); }

function createDeck() {
    const d = [];
    for (const s of SUITS) for (const r of RANKS) d.push({ rank: r, suit: s });
    return d;
}

function shuffle(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function evaluateHand(cards) {
    const combos = combinations(cards, 5);
    let best = { rank: -1, values: [], name: 'High Card' };
    for (const c of combos) {
        const h = eval5(c);
        if (h.rank > best.rank || (h.rank === best.rank && cmp(h.values, best.values) > 0)) best = h;
    }
    return best;
}

function combinations(arr, k) {
    const out = [];
    const go = (i, pick) => {
        if (pick.length === k) return out.push([...pick]);
        for (let x = i; x < arr.length; x++) { pick.push(arr[x]); go(x + 1, pick); pick.pop(); }
    };
    go(0, []);
    return out;
}

function eval5(cards) {
    const suits = cards.map(c => c.suit);
    const ranks = cards.map(c => VALUES[c.rank]).sort((a, b) => b - a);
    const counts = {};
    for (const r of ranks) counts[r] = (counts[r] || 0) + 1;
    const uniq = Object.keys(counts).map(Number).sort((a, b) => b - a);
    const freq = Object.values(counts).sort((a, b) => b - a);
    const flush = suits.every(s => s === suits[0]);
    const straightHigh = getStraight(uniq);
    const straight = straightHigh !== null;

    if (flush && straight && straightHigh === 14 && uniq.includes(10)) return { rank: 9, values: [14], name: 'Royal Flush' };
    if (flush && straight) return { rank: 8, values: [straightHigh], name: 'Straight Flush' };
    if (freq[0] === 4) return { rank: 7, values: [uniq.find(r => counts[r] === 4), uniq.find(r => counts[r] === 1)], name: 'Four of a Kind' };
    if (freq[0] === 3 && freq[1] === 2) return { rank: 6, values: [uniq.find(r => counts[r] === 3), uniq.find(r => counts[r] === 2)], name: 'Full House' };
    if (flush) return { rank: 5, values: ranks, name: 'Flush' };
    if (straight) return { rank: 4, values: [straightHigh], name: 'Straight' };
    if (freq[0] === 3) return { rank: 3, values: [uniq.find(r => counts[r] === 3), ...uniq.filter(r => counts[r] === 1)], name: 'Three of a Kind' };
    if (freq[0] === 2 && freq[1] === 2) {
        const pairs = uniq.filter(r => counts[r] === 2).sort((a, b) => b - a);
        return { rank: 2, values: [...pairs, uniq.find(r => counts[r] === 1)], name: 'Two Pair' };
    }
    if (freq[0] === 2) return { rank: 1, values: [uniq.find(r => counts[r] === 2), ...uniq.filter(r => counts[r] === 1)], name: 'One Pair' };
    return { rank: 0, values: ranks, name: 'High Card' };
}

function getStraight(uniqDesc) {
    if (uniqDesc.length < 5) return null;
    for (let i = 0; i <= uniqDesc.length - 5; i++) {
        const w = uniqDesc.slice(i, i + 5);
        if (w[0] - w[4] === 4) return w[0];
    }
    return [14, 5, 4, 3, 2].every(r => uniqDesc.includes(r)) ? 5 : null;
}

function cmp(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const av = a[i] || 0, bv = b[i] || 0;
        if (av > bv) return 1;
        if (av < bv) return -1;
    }
    return 0;
}

function makePlayer(id, name, ai) {
    return { id, name, isAI: ai, chips: STARTING_CHIPS, hand: [], currentBet: 0, folded: false, allIn: false, eliminated: false, streetAction: '' };
}

const alive = () => state.players.filter(p => !p.eliminated);
const inHand = () => alive().filter(p => !p.folded);

function nextAlive(i) {
    const n = state.players.length;
    for (let s = 1; s <= n; s++) {
        const x = (i + s) % n;
        if (!state.players[x].eliminated) return x;
    }
    return i;
}

function nextActionable(i) {
    const n = state.players.length;
    for (let s = 1; s <= n; s++) {
        const x = (i + s) % n;
        const p = state.players[x];
        if (!p.eliminated && !p.folded && !p.allIn && p.chips > 0) return x;
    }
    return -1;
}

function queueFrom(start) {
    if (start < 0) return [];
    const q = [start];
    let i = nextActionable(start);
    while (i !== -1 && i !== start) {
        q.push(i);
        i = nextActionable(i);
        if (q.length > state.players.length + 1) break;
    }
    return q;
}

function initGame() {
    state.players = [
        makePlayer(0, 'You', false),
        makePlayer(1, 'AI 1', true),
        makePlayer(2, 'AI 2', true),
        makePlayer(3, 'AI 3', true)
    ];
    createPlayerElements();
    newRound();
}

function createPlayerElements() {
    const c = document.getElementById('gameContainer');
    c.querySelectorAll('.player').forEach(x => x.remove());
    state.players.forEach((p, i) => {
        const d = document.createElement('div');
        d.id = `player${i}`;
        d.className = 'player';
        d.innerHTML = `
            <div class="player-cards" id="cards${i}"></div>
            <div class="player-info" id="info${i}">
                <div class="player-name">${p.name}
                    <span class="role-badge dealer-button" id="dealer${i}" style="display:none;">D</span>
                    <span class="role-badge sb-button" id="sb${i}" style="display:none;">SB</span>
                    <span class="role-badge bb-button" id="bb${i}" style="display:none;">BB</span>
                </div>
                <div class="player-chips" id="chips${i}">$${p.chips}</div>
                <div class="player-bet" id="bet${i}"></div>
                <div class="player-status" id="status${i}"></div>
            </div>`;
        c.appendChild(d);
    });
}

function newRound() {
    const champion = alive();
    if (champion.length === 1) {
        addLog(`Game Over! ${champion[0].name} wins the table.`);
        state.phase = 'complete';
        updateUI();
        return;
    }

    state.deck = shuffle(createDeck());
    state.board = [];
    state.pot = 0;
    state.currentBet = 0;
    state.minRaise = BIG_BLIND;
    state.phase = 'preflop';

    state.players.forEach(p => {
        p.hand = [];
        p.currentBet = 0;
        p.folded = p.eliminated;
        p.allIn = false;
        p.streetAction = '';
    });

    document.querySelectorAll('.winner').forEach(el => el.classList.remove('winner'));

    state.dealer = nextAlive(state.dealer);
    const live = alive();
    state.sb = live.length === 2 ? state.dealer : nextAlive(state.dealer);
    state.bb = nextAlive(state.sb);

    postBlind(state.sb, SMALL_BLIND, 'small blind');
    postBlind(state.bb, BIG_BLIND, 'big blind');
    state.currentBet = Math.max(state.players[state.sb].currentBet, state.players[state.bb].currentBet);

    alive().forEach(p => p.hand = [state.deck.pop(), state.deck.pop()]);
    state.current = nextActionable(state.bb);
    state.queue = queueFrom(state.current);

    addLog('--- New Round Started ---');
    addLog(`Dealer: ${state.players[state.dealer].name}`);
    updateUI();
    runLoop();
}

function postBlind(i, amt, label) {
    const p = state.players[i];
    const paid = Math.min(amt, p.chips);
    p.chips -= paid;
    p.currentBet += paid;
    p.allIn = p.chips === 0;
    state.pot += paid;
    addLog(`${p.name} posts ${label}: $${paid}`);
}

function runLoop() {
    if (state.phase === 'complete' || state.phase === 'showdown') return;
    if (checkImmediateWin()) return;
    if (state.queue.length === 0) return nextPhase();

    state.current = state.queue[0];
    const p = state.players[state.current];
    if (!p || p.folded || p.eliminated || p.allIn || p.chips <= 0) {
        state.queue.shift();
        return runLoop();
    }

    updateUI();
    if (p.isAI) {
        const delay = 700 + Math.floor(Math.random() * 700);
        setTimeout(() => applyAction(state.current, aiDecision(p)), delay);
    }
}

function aiDecision(p) {
    const toCall = Math.max(0, state.currentBet - p.currentBet);
    const check = toCall === 0;
    const strength = state.phase === 'preflop'
        ? Math.max(0.1, Math.min(0.95, (VALUES[p.hand[0].rank] + VALUES[p.hand[1].rank]) / 28 + (p.hand[0].rank === p.hand[1].rank ? 0.25 : 0)))
        : (evaluateHand([...p.hand, ...state.board]).rank + 1) / 10;

    if (!check && toCall / Math.max(1, p.chips) > 0.45 && strength < 0.45) return { action: 'fold' };
    if (!check && strength < 0.28) return { action: Math.random() < 0.75 ? 'fold' : 'call' };

    const maxTo = p.currentBet + p.chips;
    const minTo = state.currentBet + state.minRaise;
    if (maxTo > state.currentBet && strength > 0.72 && Math.random() < 0.55) {
        const target = Math.max(minTo, Math.floor(state.currentBet + Math.max(BIG_BLIND, state.pot * 0.45)));
        return { action: 'raise', amount: Math.min(maxTo, target) };
    }
    return { action: check ? 'check' : 'call' };
}

function applyAction(i, req) {
    const p = state.players[i];
    if (!p || i !== state.current || state.queue[0] !== i) return;

    const toCall = Math.max(0, state.currentBet - p.currentBet);
    const canCheck = toCall === 0;
    const a = req?.action;
    let reopened = false;

    if (a === 'fold') {
        p.folded = true;
        p.streetAction = 'Fold';
        addLog(`${p.name} folds`);
    } else if (a === 'check') {
        if (!canCheck) return;
        p.streetAction = 'Check';
        addLog(`${p.name} checks`);
    } else if (a === 'call') {
        if (canCheck) {
            p.streetAction = 'Check';
            addLog(`${p.name} checks`);
        } else {
            const pay = Math.min(toCall, p.chips);
            p.chips -= pay;
            p.currentBet += pay;
            state.pot += pay;
            p.allIn = p.chips === 0;
            p.streetAction = p.allIn ? `Call $${pay} (All-in)` : `Call $${pay}`;
            addLog(`${p.name} calls $${pay}${p.allIn ? ' (all-in)' : ''}`);
        }
    } else if (a === 'raise') {
        const maxTo = p.currentBet + p.chips;
        let target = Math.floor(Number(req.amount));
        const minTo = state.currentBet + state.minRaise;
        if (!Number.isFinite(target)) return;
        if (target > maxTo) target = maxTo;
        if (target <= state.currentBet) return applyAction(i, { action: canCheck ? 'check' : 'call' });
        if (target < minTo && target < maxTo) {
            addLog(`Minimum raise is to $${minTo}`);
            return;
        }

        const pay = target - p.currentBet;
        p.chips -= pay;
        p.currentBet = target;
        state.pot += pay;
        p.allIn = p.chips === 0;
        p.streetAction = p.allIn ? `Raise to $${target} (All-in)` : `Raise to $${target}`;

        const raiseSize = target - state.currentBet;
        if (raiseSize >= state.minRaise) state.minRaise = raiseSize;
        state.currentBet = target;
        reopened = true;
        addLog(`${p.name} raises to $${target}${p.allIn ? ' (all-in)' : ''}`);
    } else {
        return;
    }

    if (checkImmediateWin()) return;
    state.queue.shift();
    if (reopened) state.queue = queueFrom(nextActionable(i));

    if (state.queue.length === 0) return nextPhase();
    state.current = state.queue[0];
    updateUI();
    runLoop();
}

function nextPhase() {
    state.players.forEach(p => { p.currentBet = 0; p.streetAction = ''; });
    state.currentBet = 0;
    state.minRaise = BIG_BLIND;

    if (state.phase === 'preflop') {
        state.phase = 'flop';
        state.board.push(state.deck.pop(), state.deck.pop(), state.deck.pop());
        addLog('--- Flop ---');
    } else if (state.phase === 'flop') {
        state.phase = 'turn';
        state.board.push(state.deck.pop());
        addLog('--- Turn ---');
    } else if (state.phase === 'turn') {
        state.phase = 'river';
        state.board.push(state.deck.pop());
        addLog('--- River ---');
    } else {
        state.phase = 'showdown';
        return showdown();
    }

    state.current = nextActionable(state.dealer);
    state.queue = queueFrom(state.current);
    updateUI();
    runLoop();
}

function checkImmediateWin() {
    const left = inHand();
    if (left.length !== 1) return false;
    const w = left[0];
    const amount = state.pot;
    w.chips += amount;
    state.pot = 0;
    addLog(`${w.name} wins $${amount} (everyone folded)`);
    state.phase = 'complete';
    state.players.forEach(p => p.eliminated = p.chips <= 0);
    updateUI();
    const info = document.getElementById(`info${w.id}`);
    if (info) info.classList.add('winner');
    return true;
}

function showdown() {
    const contenders = inHand();
    addLog('--- Showdown ---');

    const results = contenders.map(p => ({ p, hand: evaluateHand([...p.hand, ...state.board]) }));
    results.forEach(r => addLog(`${r.p.name}: ${r.hand.name}`));

    let winners = [results[0]];
    for (let i = 1; i < results.length; i++) {
        const r = results[i];
        const d = r.hand.rank - winners[0].hand.rank;
        if (d > 0) winners = [r];
        else if (d === 0) {
            const c = cmp(r.hand.values, winners[0].hand.values);
            if (c > 0) winners = [r];
            else if (c === 0) winners.push(r);
        }
    }

    const base = Math.floor(state.pot / winners.length);
    const odd = state.pot - base * winners.length;
    winners.forEach((w, i) => {
        const win = base + (i === 0 ? odd : 0);
        w.p.chips += win;
        addLog(`${w.p.name} wins $${win} with ${w.hand.name}!`);
    });

    state.pot = 0;
    state.phase = 'complete';
    state.players.forEach(p => p.eliminated = p.chips <= 0);
    updateUI();
    winners.forEach(w => document.getElementById(`info${w.p.id}`)?.classList.add('winner'));
}

function updateUI() {
    document.getElementById('potDisplay').textContent = `Pot: $${state.pot}`;
    renderBoard();

    state.players.forEach((p, i) => {
        const cards = document.getElementById(`cards${i}`);
        const info = document.getElementById(`info${i}`);
        const chips = document.getElementById(`chips${i}`);
        const bet = document.getElementById(`bet${i}`);
        const status = document.getElementById(`status${i}`);
        const dealer = document.getElementById(`dealer${i}`);
        const sb = document.getElementById(`sb${i}`);
        const bb = document.getElementById(`bb${i}`);

        cards.innerHTML = '';
        const show = !p.isAI || state.phase === 'showdown' || state.phase === 'complete';
        p.hand.forEach(c => cards.appendChild(cardEl(c, !show)));

        chips.textContent = `$${p.chips}`;
        bet.textContent = p.currentBet > 0 ? `Bet: $${p.currentBet}` : '';
        info.classList.remove('folded', 'active');

        if (p.eliminated) { status.textContent = 'Out'; info.classList.add('folded'); }
        else if (p.folded) { status.textContent = p.streetAction || 'Folded'; info.classList.add('folded'); }
        else if (p.allIn) status.textContent = p.streetAction || 'All-in';
        else status.textContent = p.streetAction || '';

        if (i === state.current && state.phase !== 'complete' && state.phase !== 'showdown' && !p.folded && !p.eliminated && !p.allIn) {
            info.classList.add('active');
        }

        dealer.style.display = i === state.dealer ? 'inline-block' : 'none';
        sb.style.display = i === state.sb ? 'inline-block' : 'none';
        bb.style.display = i === state.bb ? 'inline-block' : 'none';
    });

    const cp = state.players[state.current];
    const canAct = !!cp && !cp.isAI && !cp.folded && !cp.eliminated && !cp.allIn && state.phase !== 'complete' && state.phase !== 'showdown';
    const toCall = cp ? Math.max(0, state.currentBet - cp.currentBet) : 0;

    document.getElementById('foldBtn').disabled = !canAct;
    document.getElementById('checkBtn').disabled = !canAct || toCall > 0;
    const call = document.getElementById('callBtn');
    call.textContent = toCall > 0 ? `Call $${toCall}` : 'Call $0';
    call.disabled = !canAct || toCall === 0;
    document.getElementById('raiseBtn').disabled = !canAct;
    document.getElementById('raiseAmount').disabled = !canAct;
    document.getElementById('newGameBtn').disabled = state.phase !== 'complete';
}

function renderBoard() {
    const div = document.getElementById('communityCards');
    div.innerHTML = '';
    state.board.forEach(c => div.appendChild(cardEl(c, false)));
}

function cardEl(card, down) {
    const el = document.createElement('div');
    el.className = 'card';
    if (down) { el.classList.add('face-down'); return el; }
    el.classList.add(card.suit === '♥' || card.suit === '♦' ? 'red' : 'black');
    el.innerHTML = `<div class="rank">${card.rank}</div><div class="suit">${card.suit}</div>`;
    return el;
}

function addLog(msg) {
    const log = document.getElementById('logContent');
    const e = document.createElement('div');
    e.className = 'log-entry';
    e.textContent = msg;
    log.appendChild(e);
    while (log.children.length > MAX_LOG_ENTRIES) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
}

document.getElementById('btnInstantAi')?.addEventListener('click', startGame);
document.getElementById('backToLandingBtn')?.addEventListener('click', backToLanding);
document.getElementById('foldBtn').addEventListener('click', () => applyAction(state.current, { action: 'fold' }));
document.getElementById('checkBtn').addEventListener('click', () => applyAction(state.current, { action: 'check' }));
document.getElementById('callBtn').addEventListener('click', () => applyAction(state.current, { action: 'call' }));
document.getElementById('raiseBtn').addEventListener('click', () => {
    const val = Number.parseInt(document.getElementById('raiseAmount').value, 10);
    if (!Number.isFinite(val)) return addLog('Enter a raise amount.');
    applyAction(state.current, { action: 'raise', amount: val });
    document.getElementById('raiseAmount').value = '';
});
document.getElementById('newGameBtn').addEventListener('click', newRound);
document.getElementById('raiseAmount').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('raiseBtn').click();
});

const helpBtn = document.getElementById('helpBtn');
const helpModal = document.getElementById('helpModal');
const helpCloseBtn = document.getElementById('helpCloseBtn');
if (helpBtn && helpModal) helpBtn.addEventListener('click', () => helpModal.classList.remove('hidden'));
if (helpCloseBtn && helpModal) helpCloseBtn.addEventListener('click', () => helpModal.classList.add('hidden'));
if (helpModal) helpModal.addEventListener('click', (e) => { if (e.target === helpModal) helpModal.classList.add('hidden'); });
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && helpModal && !helpModal.classList.contains('hidden')) helpModal.classList.add('hidden');
});
