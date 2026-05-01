/* ===== CLIENT STATE ===== */
const socket = typeof window.io === 'function'
    ? window.io()
    : {
        on: () => {},
        emit: () => {}
    };

if (typeof window.io !== 'function') {
    window.addEventListener('DOMContentLoaded', () => {
        const err = document.getElementById('lobbyError');
        if (err) {
            err.textContent = 'Realtime server not found. Open this app at http://localhost:3000 (not the Live Server port).';
        }
    });
}

let clientState = null;
let mySeat = -1;
let numPlayers = 0;
let isHost = false;
let playerName = '';

const lobbySettings = { totalSeats: 4, numAI: 3 };

/* ===== SEAT → VISUAL INDEX MAPPING =====
 * Visual index 0 = me (bottom-center), others numbered clockwise.
 */
function visualIndex(seatIdx) {
    if (seatIdx < 0 || numPlayers === 0) return seatIdx;
    return (seatIdx - mySeat + numPlayers) % numPlayers;
}

/* ===== LOBBY HELPERS ===== */
function showStep(id) {
    ['stepName','stepMode','stepCreate','stepJoin','stepWaiting'].forEach(s => {
        document.getElementById(s).classList.add('hidden');
    });
    document.getElementById(id).classList.remove('hidden');
    document.getElementById('lobbyError').textContent = '';
}

function setLobbyError(msg) {
    document.getElementById('lobbyError').textContent = msg;
}

/* ===== LOBBY BUTTON EVENTS ===== */
document.getElementById('btnContinue').addEventListener('click', () => {
    const val = document.getElementById('nameInput').value.trim();
    if (!val) return setLobbyError('Please enter a name.');
    playerName = val;
    showStep('stepMode');
});
document.getElementById('nameInput').addEventListener('keypress', e => {
    if (e.key === 'Enter') document.getElementById('btnContinue').click();
});

document.getElementById('btnCreate').addEventListener('click', () => {
    updateSettingsDisplay();
    showStep('stepCreate');
});
document.getElementById('btnJoin').addEventListener('click', () => showStep('stepJoin'));
document.getElementById('btnBack1').addEventListener('click', () => showStep('stepName'));

document.querySelectorAll('.num-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const target = btn.dataset.target;
        const delta = parseInt(btn.dataset.delta);
        if (target === 'totalSeats') {
            lobbySettings.totalSeats = Math.max(2, Math.min(6, lobbySettings.totalSeats + delta));
            lobbySettings.numAI = Math.min(lobbySettings.numAI, lobbySettings.totalSeats - 1);
        } else if (target === 'numAI') {
            lobbySettings.numAI = Math.max(0, Math.min(lobbySettings.totalSeats - 1, lobbySettings.numAI + delta));
        }
        updateSettingsDisplay();
    });
});

function updateSettingsDisplay() {
    document.getElementById('totalSeatsVal').textContent = lobbySettings.totalSeats;
    document.getElementById('numAIVal').textContent = lobbySettings.numAI;
    const humanSlots = lobbySettings.totalSeats - lobbySettings.numAI;
    document.getElementById('humanSlotsHint').textContent =
        `(${humanSlots} human seat${humanSlots !== 1 ? 's' : ''}, ${lobbySettings.numAI} AI)`;
}

document.getElementById('btnConfirmCreate').addEventListener('click', () => {
    socket.emit('createRoom', {
        name: playerName,
        totalSeats: lobbySettings.totalSeats,
        numAI: lobbySettings.numAI
    });
});
document.getElementById('btnBack2').addEventListener('click', () => showStep('stepMode'));

document.getElementById('btnConfirmJoin').addEventListener('click', () => {
    const code = document.getElementById('codeInput').value.trim().toUpperCase();
    if (!code) return setLobbyError('Please enter a room code.');
    socket.emit('joinRoom', { name: playerName, code });
});
document.getElementById('codeInput').addEventListener('keypress', e => {
    if (e.key === 'Enter') document.getElementById('btnConfirmJoin').click();
});
document.getElementById('btnBack3').addEventListener('click', () => showStep('stepMode'));

document.getElementById('btnStart').addEventListener('click', () => socket.emit('startGame'));
document.getElementById('btnBack4').addEventListener('click', () => location.reload());

/* ===== WAITING ROOM RENDER ===== */
function renderWaitingRoom(data) {
    document.getElementById('displayCode').textContent = data.code;
    const list = document.getElementById('playerSlots');
    list.innerHTML = '';
    data.slots.forEach(s => {
        const div = document.createElement('div');
        div.className = 'lobby-slot' + (s.filled ? ' filled' : '');
        if (s.isAI) {
            div.innerHTML = `<span class="slot-icon">🤖</span> ${s.name}`;
        } else if (s.filled) {
            div.innerHTML = `<span class="slot-icon">👤</span> ${s.name}`;
        } else {
            div.innerHTML = `<span class="slot-icon">⏳</span> <em>Waiting for player…</em>`;
        }
        list.appendChild(div);
    });

    const startBtn = document.getElementById('btnStart');
    const waitHint = document.getElementById('waitHint');
    if (data.isHost) {
        startBtn.classList.remove('hidden');
        const emptyHumans = data.slots.filter(s => !s.isAI && !s.filled).length;
        waitHint.textContent = emptyHumans > 0
            ? `${emptyHumans} empty seat(s) will be filled with AI when you start.`
            : 'All seats filled — ready to start!';
    } else {
        startBtn.classList.add('hidden');
        waitHint.textContent = 'Waiting for the host to start the game…';
    }
}

/* ===== SOCKET EVENTS ===== */
socket.on('roomCreated', (data) => {
    isHost = true;
    mySeat = Number.isInteger(data.viewerSeat) ? data.viewerSeat : 0;
    numPlayers = data.totalSeats;
    renderWaitingRoom(data);
    showStep('stepWaiting');
});

socket.on('joinedRoom', (data) => {
    isHost = !!data.isHost;
    mySeat = Number.isInteger(data.viewerSeat) ? data.viewerSeat : -1;
    numPlayers = data.totalSeats;
    renderWaitingRoom(data);
    showStep('stepWaiting');
});

socket.on('lobbyUpdate', (data) => {
    if (Number.isInteger(data.viewerSeat) && data.viewerSeat >= 0) mySeat = data.viewerSeat;
    isHost = data.isHost;
    numPlayers = data.totalSeats;
    renderWaitingRoom(data);
    if (document.getElementById('stepWaiting').classList.contains('hidden')) {
        showStep('stepWaiting');
    }
});

socket.on('gameStarted', (data) => {
    numPlayers = data.numPlayers;
    document.getElementById('lobbyOverlay').classList.add('hidden');
    document.getElementById('gameContainer').classList.remove('hidden');
    createPlayerElements(numPlayers);
});

socket.on('stateUpdate', (state) => {
    clientState = state;
    mySeat = state.mySeat;
    numPlayers = state.numPlayers;
    updateUI();
});

socket.on('log', (msg) => addLog(msg));

socket.on('error', (msg) => setLobbyError(msg));

/* ===== CREATE PLAYER ELEMENTS ===== */
function createPlayerElements(n) {
    const container = document.getElementById('gameContainer');
    container.querySelectorAll('.player').forEach(el => el.remove());
    container.dataset.playerCount = n;

    for (let vIdx = 0; vIdx < n; vIdx++) {
        const div = document.createElement('div');
        div.id = `player${vIdx}`;
        div.className = 'player';
        div.innerHTML = `
            <div class="player-cards" id="cards${vIdx}"></div>
            <div class="player-info" id="info${vIdx}">
                <div class="player-name" id="pname${vIdx}">
                    <span class="role-badge dealer-button" id="dealer${vIdx}" style="display:none;">D</span>
                    <span class="role-badge sb-button" id="sb${vIdx}" style="display:none;">SB</span>
                    <span class="role-badge bb-button" id="bb${vIdx}" style="display:none;">BB</span>
                </div>
                <div class="player-chips" id="chips${vIdx}">$0</div>
                <div class="player-bet" id="bet${vIdx}"></div>
                <div class="player-status" id="status${vIdx}"></div>
            </div>`;
        container.appendChild(div);
    }
}

/* ===== UPDATE UI ===== */
function updateUI() {
    const state = clientState;
    if (!state) return;

    document.getElementById('potDisplay').textContent = `Pot: $${state.pot}`;
    renderCommunityCards(state.communityCards);

    state.players.forEach((player) => {
        const vIdx = visualIndex(player.id);
        const playerEl  = document.getElementById(`player${vIdx}`);
        const cardsDiv  = document.getElementById(`cards${vIdx}`);
        const infoDiv   = document.getElementById(`info${vIdx}`);
        const nameDiv   = document.getElementById(`pname${vIdx}`);
        const chipsDiv  = document.getElementById(`chips${vIdx}`);
        const betDiv    = document.getElementById(`bet${vIdx}`);
        const statusDiv = document.getElementById(`status${vIdx}`);
        const dealerBtn = document.getElementById(`dealer${vIdx}`);
        const sbBtn     = document.getElementById(`sb${vIdx}`);
        const bbBtn     = document.getElementById(`bb${vIdx}`);

        if (!playerEl) return;

        // Name — set as first text node so badges stay
        const nameText = (player.id === mySeat ? 'You' : player.name) + (player.isAI ? ' 🤖' : '');
        let textNode = Array.from(nameDiv.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
        if (textNode) textNode.textContent = nameText;
        else nameDiv.insertBefore(document.createTextNode(nameText), nameDiv.firstChild);

        // Cards
        cardsDiv.innerHTML = '';
        if (player.hand && player.hand.length > 0) {
            const isMe = player.id === mySeat;
            const revealed = state.phase === 'showdown' || state.phase === 'complete';
            player.hand.forEach(card => {
                cardsDiv.appendChild(createCardElement(card, !card || (!isMe && !revealed)));
            });
        }

        chipsDiv.textContent = `$${player.chips}`;
        betDiv.textContent = player.currentBet > 0 ? `Bet: $${player.currentBet}` : '';

        playerEl.classList.remove('checked','called','raised','allin','action-label');
        infoDiv.classList.remove('folded','active','winner');

        if (player.eliminated) {
            statusDiv.textContent = 'Out';
            infoDiv.classList.add('folded');
        } else if (player.folded) {
            statusDiv.textContent = player.streetAction || 'Folded';
            infoDiv.classList.add('folded');
        } else if (player.allIn) {
            statusDiv.textContent = player.streetAction || 'All-in';
        } else {
            statusDiv.textContent = player.streetAction || '';
        }

        if (
            player.id === state.currentPlayerIndex &&
            state.phase !== 'complete' && state.phase !== 'showdown' &&
            !player.folded && !player.eliminated && !player.allIn
        ) {
            infoDiv.classList.add('active');
        }

        dealerBtn.style.display = player.id === state.dealerPosition    ? 'inline-block' : 'none';
        sbBtn.style.display     = player.id === state.smallBlindPosition ? 'inline-block' : 'none';
        bbBtn.style.display     = player.id === state.bigBlindPosition   ? 'inline-block' : 'none';
    });

    // Controls
    const me = state.players[mySeat];
    const myTurn = !!me &&
        mySeat === state.currentPlayerIndex &&
        !me.folded && !me.eliminated && !me.allIn &&
        state.phase !== 'complete' && state.phase !== 'showdown';

    const toCall = me ? Math.max(0, state.currentBet - me.currentBet) : 0;

    document.getElementById('foldBtn').disabled  = !myTurn;
    document.getElementById('checkBtn').disabled = !myTurn || toCall > 0;

    const callBtn = document.getElementById('callBtn');
    callBtn.textContent = toCall > 0 ? `Call $${toCall}` : 'Call $0';
    callBtn.disabled = !myTurn || toCall === 0;

    document.getElementById('raiseBtn').disabled   = !myTurn;
    document.getElementById('raiseAmount').disabled = !myTurn;
    document.getElementById('newGameBtn').disabled  = state.phase !== 'complete';

    if (me && myTurn) {
        const minRaiseTo = state.currentBet + state.minRaise;
        document.getElementById('raiseAmount').placeholder = `Min $${minRaiseTo}`;
        document.getElementById('raiseAmount').min = minRaiseTo;
    }
}

/* ===== COMMUNITY CARDS ===== */
function renderCommunityCards(cards) {
    const div = document.getElementById('communityCards');
    div.innerHTML = '';
    if (!cards) return;
    cards.forEach(card => div.appendChild(createCardElement(card, false)));
}

/* ===== CARD ELEMENT ===== */
function createCardElement(card, faceDown) {
    const el = document.createElement('div');
    el.className = 'card';
    if (faceDown || !card) { el.classList.add('face-down'); return el; }
    const color = card.suit === '♥' || card.suit === '♦' ? 'red' : 'black';
    el.classList.add(color);
    el.innerHTML = `<div class="rank">${card.rank}</div><div class="suit">${card.suit}</div>`;
    return el;
}

/* ===== LOG ===== */
const MAX_LOG_ENTRIES = 120;
function addLog(message) {
    const logContent = document.getElementById('logContent');
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.textContent = message;
    logContent.appendChild(entry);
    while (logContent.children.length > MAX_LOG_ENTRIES) logContent.removeChild(logContent.firstChild);
    logContent.scrollTop = logContent.scrollHeight;
}

/* ===== ACTION HANDLERS ===== */
document.getElementById('foldBtn').addEventListener('click',   () => socket.emit('action', { type: 'fold' }));
document.getElementById('checkBtn').addEventListener('click',  () => socket.emit('action', { type: 'check' }));
document.getElementById('callBtn').addEventListener('click',   () => socket.emit('action', { type: 'call' }));
document.getElementById('raiseBtn').addEventListener('click',  () => {
    const input  = document.getElementById('raiseAmount');
    const parsed = parseInt(input.value, 10);
    if (!Number.isFinite(parsed)) { addLog('Enter a raise amount.'); return; }
    socket.emit('action', { type: 'raise', amount: parsed });
    input.value = '';
});
document.getElementById('raiseAmount').addEventListener('keypress', e => {
    if (e.key === 'Enter') document.getElementById('raiseBtn').click();
});
document.getElementById('newGameBtn').addEventListener('click', () => socket.emit('nextHand'));

/* ===== HELP MODAL ===== */
const helpBtn      = document.getElementById('helpBtn');
const helpModal    = document.getElementById('helpModal');
const helpCloseBtn = document.getElementById('helpCloseBtn');
if (helpBtn)      helpBtn.addEventListener('click',      () => helpModal.classList.remove('hidden'));
if (helpCloseBtn) helpCloseBtn.addEventListener('click', () => helpModal.classList.add('hidden'));
if (helpModal) {
    helpModal.addEventListener('click', e => { if (e.target === helpModal) helpModal.classList.add('hidden'); });
}
window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && helpModal && !helpModal.classList.contains('hidden'))
        helpModal.classList.add('hidden');
});
