# Learning Log — Texas Hold'em Poker Project

---

## Iteration 1 — Static Prototype (HTML/CSS/JS)

**What was built:**
The first version of the project was a fully self-contained, single-file web application. All game logic, UI rendering, and AI decision-making lived inside `index.html` as an inline `<script>` block, with styles also embedded in a `<style>` tag.

**Features:**
- A visual poker table rendered with pure CSS (oval green felt, border, shadows)
- 4 fixed players: one human (bottom-center) and 3 AI opponents
- Basic Texas Hold'em rules: dealing hole cards, community cards (flop/turn/river), betting rounds, and showdown
- Simple AI that made decisions based on hand rank and pot odds
- Fold, Check, Call, and Raise buttons for the human player
- A game log panel showing all actions
- Dealer button displayed on the correct seat

**Key concepts learned:**
- DOM manipulation to dynamically create and update player elements
- Game state management using a plain JavaScript object
- Implementing poker hand evaluation (combinations, rank comparisons)
- CSS positioning to place elements on an oval table layout

---

## Iteration 2 — Refactored Single-Player App (Separated Files)

**What was built:**
The codebase was cleaned up and split into proper separate files: `index.html`, `css/style.css`, and `js/game.js`. This made the project easier to read, maintain, and extend.

**Improvements over Iteration 1:**
- Full Texas Hold'em rules with correct blind posting, preflop/postflop action order, and all-in handling
- Proper betting queue system (`playersToAct` array) replacing the fragile `activePlayers` list
- Raise reopens action for all other players correctly
- Minimum raise enforcement
- AI upgraded with preflop hand strength scoring (suited connectors, pairs, high cards), post-flop equity estimation, draw strength (flush draw, open-ended straight draw, gutshot), and pot odds calculation
- Smooth card dealing animations (CSS keyframes with `--deal-delay` custom property)
- Pot pulse animation when chips are added
- Animated showdown payout (chips visually transfer over time)
- SB/BB badges on player info panels
- Performance stats panel: Hands Played, VPIP, Win Rate, Gross Won, Net Profit
- Help modal explaining hand rankings and rules
- Responsive layout for different screen sizes
- Tournament elimination (players with $0 chips are marked out)
- Maximum log entry limit to prevent memory buildup

**Key concepts learned:**
- Separating concerns across HTML, CSS, and JS files
- Using `setTimeout` and `requestAnimationFrame` for smooth animations
- Turn token pattern to cancel stale AI timeouts after a new round starts
- Tracking VPIP (Voluntarily Put In Pot) as a poker stat

---

## Iteration 3 — Multiplayer with Node.js + Socket.io

**What was built:**
The project was transformed from a local single-player game into a real-time multiplayer web application. A Node.js server was added as the authoritative game engine, and the client was reduced to a pure view layer.

**Architecture change:**
- `server.js` — runs the full game engine (deck, hand evaluation, AI, betting logic, room management) using Express and Socket.io
- `js/game.js` — rewritten as a client that sends player actions to the server and renders state received back
- All game logic moved off the client; the client no longer controls the game

**New features:**
- **Lobby system** with a multi-step UI flow:
  1. Enter your name
  2. Choose to create a room or join one
  3. Configure table size (2–6 seats) and number of AI players
  4. Share a 6-character room code with friends
  5. Wait for players to join, then host starts the game
- **Room management** — server tracks multiple concurrent rooms, each with their own independent game state
- **Private hole cards** — the server only sends each player their own cards; opponents' cards are hidden until showdown
- **Human + AI mixed tables** — any combination of human and AI players is supported; empty human seats are auto-filled with AI when the host starts
- **Disconnect handling** — if a human player disconnects mid-game, their seat is automatically converted to AI so the game continues uninterrupted
- **Seat-to-visual mapping** — each client always sees themselves at the bottom-center of the table, with opponents arranged clockwise around them regardless of their assigned seat number
- **Persistent game log** — all game events (blinds, actions, winners) are broadcast to all players in the room in real time

**Key concepts learned:**
- Client–server architecture: separating authoritative state (server) from rendering (client)
- Real-time bidirectional communication with WebSockets via Socket.io
- Room/session management on a Node.js server
- Emitting private data to individual sockets vs. broadcasting to a room
- Seat perspective mapping so each player's view is always centered on themselves
- Graceful degradation when players disconnect
