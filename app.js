// Socket.io connection
// Prefer environment variables in production. Fallback to localhost for dev.
const SOCKET_BASE = (typeof process !== 'undefined' && process.env && process.env.REACT_APP_SOCKET_URL)
  || (window?.location?.hostname === 'localhost' ? 'http://localhost:4000' : '');
if (!SOCKET_BASE && window?.location?.hostname !== 'localhost') {
  console.warn('No REACT_APP_SOCKET_URL configured. Set it in Vercel to your backend WebSocket URL (e.g., wss://<render-app>.onrender.com)');
}
const socket = io(SOCKET_BASE || 'http://localhost:4000', { transports: ['websocket'] });

// Game state
let gameState = {
    gameId: null,
    mySymbol: null,
    currentTurn: null,
    board: Array(9).fill(null),
    isPlaying: false,
    selectedBet: null,
    lightningAddress: null,
    authToken: null,
    turnTimer: null,
    timerInterval: null,
    turnDeadline: null
};

// DOM elements
const gameBoard = document.getElementById('gameBoard');
const cells = document.querySelectorAll('.cell');
const playBtn = document.getElementById('playBtn');
const betBtns = document.querySelectorAll('.bet-btn');
const modalOverlay = document.getElementById('modalOverlay');
const modalContent = document.getElementById('modalContent');
const closeModal = document.getElementById('closeModal');
const howToPlayBtn = document.getElementById('howToPlayBtn');
const termsBtn = document.getElementById('termsBtn');
const gameStatus = document.getElementById('gameStatus');
const statusMessage = document.getElementById('statusMessage');
const payoutMessage = document.getElementById('payoutMessage');
const turnTimer = document.getElementById('turnTimer');
const timerValue = document.getElementById('timerValue');
// New elements for wallet connection
const speedUsernameInput = document.getElementById('speedUsername');
const speedAuthTokenInput = document.getElementById('speedAuthToken');
const fetchAddressBtn = document.getElementById('fetchAddressBtn');
const useAddressBtn = document.getElementById('useAddressBtn');
const lnAddressStatus = document.getElementById('lnAddressStatus');

// Initialize particles
function createParticles() {
    const particlesContainer = document.getElementById('particles');
    for (let i = 0; i < 20; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        particle.style.width = Math.random() * 10 + 5 + 'px';
        particle.style.height = particle.style.width;
        particle.style.left = Math.random() * 100 + '%';
        particle.style.top = Math.random() * 100 + '%';
        particle.style.animationDelay = Math.random() * 20 + 's';
        particle.style.animationDuration = (Math.random() * 20 + 20) + 's';
        particlesContainer.appendChild(particle);
    }
}

// Bet selection
betBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        betBtns.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        gameState.selectedBet = parseInt(btn.dataset.amount);
        playBtn.disabled = false;
    });
});
// Play button
playBtn.addEventListener('click', async () => {
    if (!gameState.selectedBet) {
        showNotification('Please select a bet amount first!', 'error');
        return;
    }

    // Require a Lightning address (either set via auth or input elsewhere)
    if (!gameState.lightningAddress) {
        showNotification('Please connect your Speed wallet or enter a Lightning address to proceed.', 'error');
        return;
    }

    // Show waiting screen
    showWaitingScreen();

    // Join game
    socket.emit('joinGame', {
        betAmount: gameState.selectedBet,
        lightningAddress: gameState.lightningAddress
    });
});

// Waiting screen
function showWaitingScreen() {
    modalContent.innerHTML = `
        <div class="waiting-screen">
            <div class="waiting-animation">
                <div class="waiting-ring"></div>
                <div class="waiting-ring"></div>
                <div class="waiting-ring"></div>
            </div>
            <div class="waiting-timer" id="waitingTimer">--</div>
            <div class="waiting-message">Finding an opponent...</div>
            <div class="waiting-message" style="font-size: 0.9rem; margin-top: 10px; color: #666;">
                This may take 13-25 seconds
            </div>
        </div>
    `;
    modalOverlay.classList.add('active');
    closeModal.style.display = 'none';
}

// Opponent found screen
function showOpponentFound(opponent, countdown) {
    const isBot = opponent && (opponent.type === 'bot' || opponent.isBot === true);
    modalContent.innerHTML = `
        <div class="opponent-found">
            <h2 style="color: var(--primary-neon); margin-bottom: 20px;">Opponent Found!</h2>
            <div class="vs-display">
                <div class="player-avatar">👤</div>
                <div class="vs-text">VS</div>
                <div class="player-avatar">${isBot ? '🤖' : '👤'}</div>
            </div>
            <div style="color: var(--text-dim); font-size: 1.1rem;">
                ${isBot ? 'AI Bot' : 'Human Player'}
            </div>
            <div class="countdown-display" id="matchCountdown">${countdown}</div>
            <div style="color: var(--text-dim); margin-top: 20px;">Game starts in...</div>
        </div>
    `;
}

// Wallet connect handlers
if (fetchAddressBtn) {
    fetchAddressBtn.addEventListener('click', () => {
        const token = (speedAuthTokenInput?.value || '').trim();
        if (!token) {
            showNotification('Please paste a valid Speed auth token first.', 'error');
            return;
        }
        if (gameState.lightningAddress) return; // already set
        gameState.authToken = token;
        socket.emit('set_auth_token', { authToken: token });
        lnAddressStatus.textContent = 'Fetching address from Speed...';
    });
}

if (useAddressBtn) {
    useAddressBtn.addEventListener('click', () => {
        if (gameState.lightningAddress) return; // already set
        const username = (speedUsernameInput?.value || '').trim();
        if (!username) {
            showNotification('Please enter your Speed username.', 'error');
            return;
        }
        const addr = `${username}@speed.app`;
        gameState.lightningAddress = addr;
        lockLightningAddress(addr, true);
        showNotification(`Using address ${addr}`, 'success');
    });
}

function lockLightningAddress(addr, fromFetch = false) {
    // Show and lock
    if (speedUsernameInput) {
        try {
            const userPart = addr.includes('@') ? addr.split('@')[0] : addr;
            speedUsernameInput.value = userPart;
        } catch {}
        speedUsernameInput.disabled = true;
    }
    if (speedAuthTokenInput) speedAuthTokenInput.disabled = true;
    if (fetchAddressBtn) fetchAddressBtn.disabled = true;
    if (useAddressBtn) useAddressBtn.disabled = true;
    lnAddressStatus.textContent = `Connected: ${addr}`;
}

// Socket event handlers
socket.on('waitingForOpponent', (data) => {
    let timeLeft = data.estWaitSeconds;
    let waitingTimerEl = document.getElementById('waitingTimer');
    if (!waitingTimerEl) {
        // Ensure the waiting UI is visible so the timer element exists
        showWaitingScreen();
        waitingTimerEl = document.getElementById('waitingTimer');
    }

    const waitInterval = setInterval(() => {
        if (waitingTimerEl) {
            waitingTimerEl.textContent = timeLeft + 's';
        }
        timeLeft--;
        
        if (timeLeft < 0) {
            clearInterval(waitInterval);
        }
    }, 1000);
});

socket.on('matchFound', (data) => {
    let countdown = data.startsIn;
    showOpponentFound(data.opponent, countdown);
    
    const countInterval = setInterval(() => {
        countdown--;
        const countdownEl = document.getElementById('matchCountdown');
        if (countdownEl) {
            countdownEl.textContent = countdown;
        }
        
        if (countdown <= 0) {
            clearInterval(countInterval);
            modalOverlay.classList.remove('active');
        }
    }, 1000);
});

socket.on('paymentRequest', (data) => {
    // Show Lightning invoice (BOLT11)
    const invoice = data.lightningInvoice || data.invoice;
    showPaymentModal(invoice, data.invoiceId);
});

// Backend emits 'startGame'
socket.on('startGame', (data) => {
    gameState.gameId = data.gameId;
    gameState.mySymbol = data.symbol;
    gameState.currentTurn = data.turn;
    gameState.board = Array(9).fill(null);
    gameState.isPlaying = true;
    gameState.turnDeadline = data.turnDeadline || null;

    modalOverlay.classList.remove('active');
    updateBoard();
    updateStatus(`You are ${gameState.mySymbol}. ${gameState.currentTurn === socket.id ? 'Your turn!' : "Opponent's turn"}`);

    // Start turn timer using deadline if provided
    startTurnTimer(gameState.currentTurn === socket.id, gameState.turnDeadline);
});

// Backend emits 'boardUpdate' for board state changes
socket.on('boardUpdate', (data) => {
    gameState.board = data.board;
    updateBoard();
});

// Backend emits 'nextTurn' with whose turn and deadline
socket.on('nextTurn', (data) => {
    gameState.currentTurn = data.turn;
    gameState.turnDeadline = data.turnDeadline || null;
    updateStatus(gameState.currentTurn === socket.id ? 'Your turn!' : "Opponent's turn");
    startTurnTimer(gameState.currentTurn === socket.id, gameState.turnDeadline);
});

socket.on('gameEnd', (data) => {
    gameState.isPlaying = false;
    stopTurnTimer();

    // Highlight winning line if provided
    if (Array.isArray(data.winningLine)) {
        data.winningLine.forEach((idx) => {
            const cell = document.querySelector(`.cell[data-index="${idx}"]`);
            if (cell) cell.classList.add('win');
        });
    }

    // Use message from server
    if (data.message) {
        updateStatus(data.message);
    }
});

// Payment notifications from backend
socket.on('lightning_address', (data) => {
    const addr = (data && data.lightningAddress) || '';
    if (!addr) {
        showNotification('Failed to fetch address from Speed.', 'error');
        return;
    }
    if (gameState.lightningAddress) return; // prevent changes after set
    gameState.lightningAddress = addr;
    lockLightningAddress(addr, true);
    showNotification(`Connected Lightning address: ${addr}`, 'success');
});

socket.on('auth_error', (data) => {
    const msg = data && data.error ? data.error : 'Auth error';
    showNotification(`Auth error: ${msg}`, 'error');
    lnAddressStatus.textContent = 'Auth failed. Please check your token.';
});
socket.on('paymentVerified', () => {
    showNotification('Payment received! Waiting for opponent...', 'success');
    // Restore waiting UI so upcoming waitingForOpponent updates the timer
    showWaitingScreen();
});
socket.on('payment_sent', (data) => {
    showNotification(`Payout sent: ${data.amount} sats`, 'success');
    payoutMessage.style.display = 'block';
    payoutMessage.textContent = `+${data.amount} SATS! 🎉`;
});

socket.on('payment_error', (data) => {
    showNotification(`Payout error: ${data.error}`, 'error');
});

socket.on('error', (data) => {
    showNotification(data.message, 'error');
});

// Turn timer
function startTurnTimer(isMyTurn, deadlineMs = null) {
    stopTurnTimer();

    let timeLeft;
    if (deadlineMs) {
        const now = Date.now();
        timeLeft = Math.max(0, Math.ceil((deadlineMs - now) / 1000));
    } else {
        const isFirstMove = gameState.board.every(cell => cell === null);
        timeLeft = isFirstMove ? 8 : 5;
    }

    turnTimer.classList.add('active');
    turnTimer.classList.remove('warning');
    timerValue.textContent = timeLeft;

    gameState.timerInterval = setInterval(() => {
        timeLeft--;
        timerValue.textContent = timeLeft;

        if (timeLeft <= 2) {
            turnTimer.classList.add('warning');
        }

        if (timeLeft <= 0) {
            stopTurnTimer();
            if (isMyTurn) {
                // Auto-move to random empty cell
                const emptyCells = gameState.board.map((cell, i) => cell === null ? i : -1).filter(i => i !== -1);
                if (emptyCells.length > 0) {
                    const randomCell = emptyCells[Math.floor(Math.random() * emptyCells.length)];
                    makeMove(randomCell);
                }
            }
        }
    }, 1000);
}

function stopTurnTimer() {
    if (gameState.timerInterval) {
        clearInterval(gameState.timerInterval);
        gameState.timerInterval = null;
    }
    turnTimer.classList.remove('active', 'warning');
}

// Game board interaction
cells.forEach(cell => {
    cell.addEventListener('click', () => {
        const index = parseInt(cell.dataset.index);
        if (gameState.isPlaying && gameState.currentTurn === socket.id && !gameState.board[index]) {
            makeMove(index);
        }
    });
});

function makeMove(position) {
    socket.emit('makeMove', {
        gameId: gameState.gameId,
        position: position
    });
}

function updateBoard() {
    cells.forEach((cell, index) => {
        const value = gameState.board[index];
        cell.textContent = value || '';
        cell.className = 'cell';
        
        if (value) {
            cell.classList.add('taken');
            cell.classList.add(value.toLowerCase());
        }
    });
}

function handleGameEnd(winner, winLine) {
    gameState.isPlaying = false;
    
    // Highlight winning line
    if (winLine) {
        winLine.forEach(index => {
            cells[index].classList.add('win');
        });
    }
}

function handleDraw() {
    gameState.isPlaying = false;
    updateStatus("It's a draw! Rematch?");
}

// UI Updates
function updateStatus(message) {
    gameStatus.style.display = 'block';
    statusMessage.textContent = message;
}

function showWinMessage(payout) {
    updateStatus('🎉 You Won! 🎉');
    payoutMessage.style.display = 'block';
    payoutMessage.textContent = `+${payout} SATS!`;
}

function showLoseMessage() {
    updateStatus('You lost. Better luck next time!');
}

function showDrawMessage() {
    updateStatus("It's a draw! No winner this time.");
}

function showNotification(message, type) {
    // Create notification element
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 25px;
        background: ${type === 'error' ? 'var(--danger-neon)' : 'var(--primary-neon)'};
        color: var(--bg-dark);
        border-radius: 10px;
        font-weight: bold;
        z-index: 2000;
        animation: slideIn 0.3s ease;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// Payment modal
function showPaymentModal(invoice, invoiceId) {
    modalContent.innerHTML = `
        <div style="text-align: center; padding: 20px;">
            <h2 style="color: var(--primary-neon); margin-bottom: 20px;">⚡ Lightning Payment Required</h2>
            <div style="background: white; padding: 20px; border-radius: 10px; margin: 20px 0;">
                <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(invoice)}" alt="Lightning Invoice QR">
            </div>
            <div style="margin: 20px 0;">
                <input type="text" value="${invoice}" readonly style="width: 100%; padding: 10px; background: var(--bg-dark); border: 1px solid var(--primary-neon); border-radius: 5px; color: var(--text-light); font-family: monospace; font-size: 0.8rem;">
            </div>
            <button onclick="navigator.clipboard.writeText('${invoice}')" style="padding: 10px 20px; background: var(--primary-neon); color: var(--bg-dark); border: none; border-radius: 5px; font-weight: bold; cursor: pointer;">
                Copy Invoice
            </button>
            <p style="margin-top: 20px; color: var(--text-dim);">Waiting for payment...</p>
        </div>
    `;
    modalOverlay.classList.add('active');
    closeModal.style.display = 'none';
}

// How to Play modal
howToPlayBtn.addEventListener('click', () => {
    modalContent.innerHTML = `
        <div class="how-to-play-content">
            <h2 class="modal-header">⚡ How to Play Lightning Tic-Tac-Toe</h2>
            
            <div class="step">
                <div class="step-number">1</div>
                <div class="step-content">
                    <h4>Get a Lightning Wallet</h4>
                    <p>You need a Lightning wallet to play. We recommend Speed Wallet for instant payments! Download it from the app store and set it up in seconds.</p>
                </div>
            </div>
            
            <div class="step">
                <div class="step-number">2</div>
                <div class="step-content">
                    <h4>Choose Your Bet</h4>
                    <p>Select from 50, 100, 300, or 500 sats. Higher bets = bigger rewards! Winners get 1.8x their bet (minus a small 10% platform fee).</p>
                </div>
            </div>
            
            <div class="step">
                <div class="step-number">3</div>
                <div class="step-content">
                    <h4>Pay to Play</h4>
                    <p>Scan the Lightning QR code with your wallet to pay your bet. Payment is instant and secure through the Lightning Network!</p>
                </div>
            </div>
            
            <div class="step">
                <div class="step-number">4</div>
                <div class="step-content">
                    <h4>Wait for Opponent</h4>
                    <p>We'll match you with another player in 13-25 seconds. If no human is available, you'll play against our AI bot!</p>
                </div>
            </div>
            
            <div class="step">
                <div class="step-number">5</div>
                <div class="step-content">
                    <h4>Play Fast!</h4>
                    <p>You have 8 seconds for your first move, then 5 seconds per turn. Think fast or lose your turn! Get 3 in a row to win.</p>
                </div>
            </div>
            
            <div class="step">
                <div class="step-number">6</div>
                <div class="step-content">
                    <h4>Win Bitcoin!</h4>
                    <p>Winners receive their payout instantly to their Lightning wallet! Draws result in a rematch with switched turns.</p>
                </div>
            </div>
            
            <div style="background: linear-gradient(135deg, var(--primary-neon), var(--secondary-neon)); padding: 20px; border-radius: 10px; margin-top: 30px; text-align: center;">
                <h3 style="color: var(--bg-dark); margin-bottom: 10px;">🎮 Pro Tips</h3>
                <p style="color: var(--bg-dark); font-weight: 500;">• Control the center for strategic advantage<br>• Block opponent's winning moves<br>• Create multiple win opportunities<br>• Play fast to pressure opponents!</p>
            </div>
        </div>
    `;
    modalOverlay.classList.add('active');
    closeModal.style.display = 'block';
});

// Terms & Conditions modal
termsBtn.addEventListener('click', () => {
    modalContent.innerHTML = `
        <div class="modal-header">Terms & Conditions</div>
        <div class="terms-content">
            <h3>1. Acceptance of Terms</h3>
            <p>By playing Lightning Tic-Tac-Toe, you agree to these Terms & Conditions. If you do not agree, please do not use our service.</p>
            
            <h3>2. Eligibility</h3>
            <p>You must be at least 18 years old and legally permitted to participate in skill-based games with monetary stakes in your jurisdiction.</p>
            
            <h3>3. Game Rules</h3>
            <p>• Players must pay the selected bet amount via Lightning Network to participate</p>
            <p>• Winners receive 1.8x their bet amount (90% payout after 10% platform fee)</p>
            <p>• Games must be completed within the time limits (8s first move, 5s subsequent moves)</p>
            <p>• Disconnections forfeit the game to the remaining player</p>
            
            <h3>4. Matchmaking System</h3>
            <p>Our advanced matchmaking system ensures fair and balanced gameplay. We use sophisticated algorithms to match players of similar skill levels. In certain situations where no human opponent is available within the waiting period, you may be matched against an AI opponent to ensure continuous gameplay experience.</p>
            
            <h3>5. AI Opponents Disclosure</h3>
            <p style="font-size: 0.85rem; opacity: 0.8;">To maintain consistent game availability and reduce wait times, our platform employs AI bots that simulate human players. These bots are designed to provide challenging and fair gameplay. The use of AI opponents ensures that players can always find a match within 13-25 seconds. Bot behavior is randomized and follows strategic patterns similar to human players. By continuing to play, you acknowledge and accept that some of your opponents may be AI-controlled.</p>
            
            <h3>6. Payments & Refunds</h3>
            <p>• All payments are final and non-refundable</p>
            <p>• Payouts are processed instantly via Lightning Network</p>
            <p>• Platform reserves the right to void games in case of technical issues</p>
            <p>• Minimum balance requirements may apply for withdrawals</p>
            
            <h3>7. Fair Play</h3>
            <p>• Cheating, exploiting, or using automated tools is strictly prohibited</p>
            <p>• Collusion between players is not allowed</p>
            <p>• Violations result in immediate account termination and forfeiture of funds</p>
            
            <h3>8. Privacy Policy</h3>
            <p>We collect minimal data necessary for gameplay:</p>
            <p>• Lightning addresses for payments</p>
            <p>• Game statistics and betting patterns for matchmaking</p>
            <p>• IP addresses for security purposes</p>
            <p>We never store sensitive payment information or private keys.</p>
            
            <h3>9. Limitation of Liability</h3>
            <p>The platform is provided "as is" without warranties. We are not liable for any losses incurred through gameplay, technical issues, or Lightning Network failures.</p>
            
            <h3>10. Bot Gaming Patterns</h3>
            <p style="font-size: 0.85rem; opacity: 0.8;">Our AI system implements dynamic difficulty adjustment based on player betting patterns and historical performance. This ensures engaging gameplay regardless of skill level. The AI opponents utilize advanced strategies including minimax algorithms with controlled randomization to simulate human decision-making patterns. Betting amounts may influence matchmaking priorities and game dynamics to optimize player experience and platform sustainability.</p>
            
            <h3>11. Dispute Resolution</h3>
            <p>All disputes must be reported within 24 hours of the game. Contact support with your game ID and Lightning address for investigation.</p>
            
            <h3>12. Changes to Terms</h3>
            <p>We reserve the right to modify these terms at any time. Continued use constitutes acceptance of updated terms.</p>
            
            <h3>13. Contact Information</h3>
            <p>For support, disputes, or questions: support@lightning-tictactoe.com</p>
            
            <div class="accept-terms">
                <input type="checkbox" id="acceptTerms">
                <label for="acceptTerms">I have read and agree to the Terms & Conditions</label>
            </div>
        </div>
    `;
    modalOverlay.classList.add('active');
    closeModal.style.display = 'block';
});

// Close modal
closeModal.addEventListener('click', () => {
    modalOverlay.classList.remove('active');
});

// Click outside modal to close
modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay && closeModal.style.display !== 'none') {
        modalOverlay.classList.remove('active');
    }
});

// Initialize
createParticles();
playBtn.disabled = true;
