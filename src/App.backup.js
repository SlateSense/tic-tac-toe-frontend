import React, { useEffect, useMemo, useRef, useState } from 'react';
import io from 'socket.io-client';
import { QRCodeSVG } from 'qrcode.react';

const PAYOUTS = {
  50: { winner: 80 },
  300: { winner: 500 },
  500: { winner: 800 },
  1000: { winner: 1700 },
  5000: { winner: 8000 },
  10000: { winner: 17000 },
};
const BET_OPTIONS = Object.keys(PAYOUTS).map(k => ({ amount: parseInt(k, 10), winnings: PAYOUTS[k].winner }));

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:4000';

export default function App() {
  const [activeTab, setActiveTab] = useState('Menu');
  const [gameState, setGameState] = useState('splash');
  const [socket, setSocket] = useState(null);
  const [socketId, setSocketId] = useState(null);

  const [betAmount, setBetAmount] = useState(() => localStorage.getItem('ttt_lastBet') || '50');
  const [payoutAmount, setPayoutAmount] = useState(() => {
    const saved = localStorage.getItem('ttt_lastBet');
    const opt = BET_OPTIONS.find(o => o.amount === parseInt(saved || '50'));
    return opt ? String(opt.winnings) : '80';
  });
  const [lightningAddress, setLightningAddress] = useState(localStorage.getItem('ttt_lightningAddress') || '');

  // Payment state
  const [paymentInfo, setPaymentInfo] = useState(null); // { invoiceId, lightningInvoice, hostedInvoiceUrl, amountSats, amountUSD }
  const [isWaitingForPayment, setIsWaitingForPayment] = useState(false);

  // Game state
  const [gameId, setGameId] = useState(null);
  const [symbol, setSymbol] = useState(null); // 'X' | 'O'
  const [turn, setTurn] = useState(null); // socketId whose turn
  const [board, setBoard] = useState(Array(9).fill(null));
  const [message, setMessage] = useState('');
  const [lastMove, setLastMove] = useState(null);
  const [winningLine, setWinningLine] = useState(null);
  const [turnDeadline, setTurnDeadline] = useState(null);
  const [timeLeft, setTimeLeft] = useState(null); // seconds
  const [connected, setConnected] = useState(false);
  const [showHowToModal, setShowHowToModal] = useState(false);
  const [showStartModal, setShowStartModal] = useState(false);
  const [showSupportModal, setShowSupportModal] = useState(false);
  const [theme, setTheme] = useState('minimal');
  const [turnDuration, setTurnDuration] = useState(null); // seconds for current turn
  const confettiRef = useRef(null);
  const [showSettings, setShowSettings] = useState(false);
  const [sfxEnabled, setSfxEnabled] = useState(() => localStorage.getItem('ttt_sfx') !== '0');
  const [hapticsEnabled, setHapticsEnabled] = useState(() => localStorage.getItem('ttt_haptics') !== '0');
  const [tiltEnabled, setTiltEnabled] = useState(() => localStorage.getItem('ttt_tilt') !== '0');
  const boardRef = useRef(null);
  const audioCtxRef = useRef(null);
  const touchStartRef = useRef(null);

  // History
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ttt_history') || '[]'); } catch { return []; }
  });

  const stats = useMemo(() => {
    let wins = 0, losses = 0, net = 0, streak = 0, cur = 0;
    for (const h of history) {
      if (h.outcome === 'win') { wins++; net += h.amount; cur = cur >= 0 ? cur + 1 : 1; }
      else { losses++; net += h.amount; cur = cur <= 0 ? cur - 1 : -1; }
    }
    streak = cur;
    const total = wins + losses;
    const wr = total ? Math.round((wins / total) * 100) : 0;
    return { wins, losses, net, streak, winrate: wr };
  }, [history]);

  useEffect(() => {
    const s = io(BACKEND_URL, { transports: ['websocket', 'polling'] });
    setSocket(s);

    const handlers = {
      connect: () => {
        setSocketId(s.id);
        setConnected(true);
      },
      disconnect: () => {
        setConnected(false);
        setMessage('Disconnected. Retrying...');
      },
      connect_error: (err) => {
        setConnected(false);
        setMessage(`Cannot reach server at ${BACKEND_URL}`);
      },
      error: (payload) => {
        const msg = typeof payload === 'string' ? payload : (payload?.message || 'Error');
        setMessage(msg);
      },
      paymentRequest: ({ lightningInvoice, hostedInvoiceUrl, amountSats, amountUSD, invoiceId, demo }) => {
        setPaymentInfo({ lightningInvoice, hostedInvoiceUrl, amountSats, amountUSD, invoiceId, demo: !!demo });
        setIsWaitingForPayment(true);
        setMessage(`Pay ${amountSats} SATS (~$${amountUSD})`);
        setGameState('awaitingPayment');
      },
      paymentVerified: () => {
        setIsWaitingForPayment(false);
        setMessage('Payment verified! Waiting for opponent...');
      },
      transaction: ({ message }) => {
        setMessage(message);
      },
      startGame: ({ gameId, symbol, turn, message, turnDeadline }) => {
        setGameId(gameId);
        setSymbol(symbol);
        setTurn(turn);
        setBoard(Array(9).fill(null));
        setLastMove(null);
        setWinningLine(null);
        setTurnDeadline(turnDeadline || null);
        const ttl = turnDeadline ? Math.max(1, Math.ceil((Number(turnDeadline) - Date.now()) / 1000)) : null;
        setTurnDuration(ttl);
        setGameState('playing');
        setShowStartModal(false);
        setMessage(message || (turn === s.id ? 'Your move' : "Opponent's move"));
      },
      boardUpdate: ({ board, lastMove }) => {
        setBoard(board);
        setLastMove(typeof lastMove === 'number' ? lastMove : null);
      },
      nextTurn: ({ turn, turnDeadline }) => {
        setTurn(turn);
        setTurnDeadline(turnDeadline || null);
        const ttl = turnDeadline ? Math.max(1, Math.ceil((Number(turnDeadline) - Date.now()) / 1000)) : null;
        setTurnDuration(ttl);
        setMessage(turn === s.id ? 'Your move' : "Opponent's move");
      },
      gameEnd: ({ message, winnerSymbol, winningLine }) => {
        setGameState('finished');
        setMessage(message);
        setWinningLine(Array.isArray(winningLine) ? winningLine : null);
        setTurnDeadline(null);
        setTimeLeft(null);
        // Save to history
        const isWin = winnerSymbol && symbol && winnerSymbol === symbol;
        const entry = {
          id: `g_${Date.now()}`,
          ts: new Date().toISOString(),
          bet: parseInt(betAmount, 10),
          outcome: isWin ? 'win' : 'loss',
          amount: isWin ? (PAYOUTS[betAmount]?.winner - parseInt(betAmount,10)) : -parseInt(betAmount,10),
        };
        const newHist = [entry, ...history].slice(0, 100);
        setHistory(newHist);
        localStorage.setItem('ttt_history', JSON.stringify(newHist));
        if (isWin) {
          launchConfetti();
          sfxPlay('win');
          triggerHaptic([30, 40, 30]);
        } else {
          sfxPlay('lose');
          triggerHaptic([15, 25]);
        }
      }
    };

    Object.entries(handlers).forEach(([evt, fn]) => s.on(evt, fn));
    s.connect();

    return () => {
      Object.entries(handlers).forEach(([evt, fn]) => s.off(evt, fn));
      s.disconnect();
    };
  }, [BACKEND_URL, betAmount, history]);

  const doJoin = () => {
    if (!socket || !connected) return;
    const bet = parseInt(betAmount, 10);
    socket.emit('joinGame', { betAmount: bet, lightningAddress: lightningAddress || 'anon' });
    localStorage.setItem('ttt_lastBet', String(bet));
    localStorage.setItem('ttt_lightningAddress', lightningAddress || '');
  };

  const simulatePayment = () => {
    if (!socket || !paymentInfo) return;
    socket.emit('simulatePayment', { invoiceId: paymentInfo.invoiceId });
  };

  const onCellClick = (idx) => {
    if (gameState !== 'playing') return;
    if (turn !== socketId) return; // not your turn
    if (board[idx] !== null) return;
    sfxPlay('move');
    triggerHaptic(10);
    socket.emit('makeMove', { gameId, position: idx });
  };

  const resetToMenu = () => {
    setGameState('splash');
    setActiveTab('Menu');
    setMessage('');
    setBoard(Array(9).fill(null));
    setLastMove(null);
    setWinningLine(null);
    setTurnDeadline(null);
    setTimeLeft(null);
    setPaymentInfo(null);
    setIsWaitingForPayment(false);
    // defaults 50 -> 80
    setBetAmount('50');
    setPayoutAmount('80');
    setShowHowToModal(false);
    setShowStartModal(false);
    setShowSupportModal(false);
  };

  useEffect(() => {
    const opt = BET_OPTIONS.find(o => o.amount === parseInt(betAmount, 10));
    setPayoutAmount(String(opt?.winnings || 0));
  }, [betAmount]);

  // Persist toggles
  useEffect(() => { localStorage.setItem('ttt_sfx', sfxEnabled ? '1' : '0'); }, [sfxEnabled]);
  useEffect(() => { localStorage.setItem('ttt_haptics', hapticsEnabled ? '1' : '0'); }, [hapticsEnabled]);
  useEffect(() => { localStorage.setItem('ttt_tilt', tiltEnabled ? '1' : '0'); }, [tiltEnabled]);

  // Autofill Lightning username from URL (#p_add=user@speed.app or ?p_add=)
  useEffect(() => {
    try {
      const hash = window.location.hash.substring(1);
      const hashParams = new URLSearchParams(hash);
      const urlParams = new URLSearchParams(window.location.search);
      const pAdd = hashParams.get('p_add') || urlParams.get('p_add');
      if (pAdd) {
        const username = pAdd.split('@')[0];
        setLightningAddress(username);
        localStorage.setItem('ttt_lightningAddress', username);
        localStorage.setItem('ttt_lastAddress', username);
      } else if (!lightningAddress) {
        const last = localStorage.getItem('ttt_lastAddress');
        if (last) setLightningAddress(last);
      }
    } catch {}
  }, []);

  // Countdown timer for current turn
  useEffect(() => {
    if (!turnDeadline || gameState !== 'playing') {
      setTimeLeft(null);
      return;
    }
    const update = () => {
      const ms = Math.max(0, Number(turnDeadline) - Date.now());
      setTimeLeft(Math.ceil(ms / 1000));
    };
    update();
    const t = setInterval(update, 250);
    return () => clearInterval(t);
  }, [turnDeadline, gameState]);

  const doResign = () => {
    if (!socket || !gameId) return;
    socket.emit('resign', { gameId });
    sfxPlay('resign');
    triggerHaptic([20, 30, 20]);
  };

  const copyPayment = async () => {
    try {
      if (!paymentInfo) return;
      const text = paymentInfo.lightningInvoice || paymentInfo.hostedInvoiceUrl || '';
      if (!text) return;
      await navigator.clipboard.writeText(text);
      setMessage('Payment request copied to clipboard');
    } catch (e) {
      setMessage('Copy failed');
    }
  };

  // Audio & Haptics
  const ensureAudioCtx = () => {
    if (!audioCtxRef.current) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtxRef.current = new AC();
    }
    return audioCtxRef.current;
  };

  const tone = (ctx, { freq = 600, time = 0, dur = 0.08, type = 'sine', gain = 0.08 }) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type; osc.frequency.value = freq;
    osc.connect(g); g.connect(ctx.destination);
    const t0 = ctx.currentTime + time;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  };

  const sfxPlay = (name) => {
    if (!sfxEnabled) return;
    const ctx = ensureAudioCtx();
    if (!ctx) return;
    if (name === 'move') {
      tone(ctx, { freq: 740, dur: 0.06, type: 'triangle', gain: 0.06 });
    } else if (name === 'win') {
      tone(ctx, { freq: 523, dur: 0.10, type: 'sine', gain: 0.06 });
      tone(ctx, { freq: 659, time: 0.10, dur: 0.10, type: 'sine', gain: 0.06 });
      tone(ctx, { freq: 784, time: 0.20, dur: 0.12, type: 'sine', gain: 0.06 });
    } else if (name === 'lose') {
      tone(ctx, { freq: 440, dur: 0.12, type: 'sawtooth', gain: 0.05 });
      tone(ctx, { freq: 330, time: 0.10, dur: 0.14, type: 'sawtooth', gain: 0.05 });
    } else if (name === 'resign') {
      tone(ctx, { freq: 300, dur: 0.12, type: 'square', gain: 0.05 });
      tone(ctx, { freq: 220, time: 0.10, dur: 0.16, type: 'square', gain: 0.05 });
    }
  };

  const triggerHaptic = (pattern) => {
    try { if (hapticsEnabled && navigator.vibrate) navigator.vibrate(pattern); } catch {}
  };

  const shareResult = async () => {
    if (gameState !== 'finished') return;
    const last = history[0];
    const text = last ? `I just ${last.outcome === 'win' ? 'won' : 'played'} ${Math.abs(last.amount)} SATS in Tic‑Tac‑Toe!` : 'Play Tic‑Tac‑Toe with SATS!';
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Tic‑Tac‑Toe', text, url: window.location.origin });
      } else {
        await navigator.clipboard.writeText(`${text} ${window.location.origin}`);
        setMessage('Share text copied to clipboard');
      }
    } catch {}
  };

  // 3D Tilt handlers
  const handleBoardPointer = (e) => {
    if (!tiltEnabled || !boardRef.current) return;
    const rect = boardRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width; // 0..1
    const y = (e.clientY - rect.top) / rect.height; // 0..1
    const ry = (x - 0.5) * 8; // deg
    const rx = -(y - 0.5) * 8;
    boardRef.current.style.setProperty('--rx', rx.toFixed(2) + 'deg');
    boardRef.current.style.setProperty('--ry', ry.toFixed(2) + 'deg');
  };
  const resetBoardTilt = () => {
    if (!boardRef.current) return;
    boardRef.current.style.setProperty('--rx', '0deg');
    boardRef.current.style.setProperty('--ry', '0deg');
  };

  // Simple canvas confetti on win
  const launchConfetti = () => {
    try {
      const host = confettiRef.current || document.body;
      const canvas = document.createElement('canvas');
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      canvas.style.position = 'fixed';
      canvas.style.left = '0';
      canvas.style.top = '0';
      canvas.style.pointerEvents = 'none';
      canvas.style.zIndex = '9999';
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      host.appendChild(canvas);

      const colors = ['#60a5fa', '#f59e0b', '#22c55e', '#e879f9', '#f43f5e'];
      const N = 120;
      const particles = Array.from({ length: N }).map(() => ({
        x: w / 2 + (Math.random() - 0.5) * 80,
        y: h / 2 + (Math.random() - 0.5) * 40,
        r: 3 + Math.random() * 4,
        c: colors[(Math.random() * colors.length) | 0],
        vx: (Math.random() - 0.5) * 6,
        vy: -Math.random() * 6 - 2,
        g: 0.12 + Math.random() * 0.08,
        a: 1,
        life: 60 + (Math.random() * 40)
      }));

      let frame = 0;
      const tick = () => {
        frame++;
        ctx.clearRect(0, 0, w, h);
        particles.forEach(p => {
          p.x += p.vx;
          p.y += p.vy;
          p.vy += p.g;
          p.a *= 0.992;
          p.life--;
          ctx.globalAlpha = Math.max(0, p.a);
          ctx.fillStyle = p.c;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
        });
        if (frame < 180) requestAnimationFrame(tick); else host.removeChild(canvas);
      };
      tick();
    } catch {}
  };

  // Circular timer progress ring
  function TimerRing({ progress, size = 54 }) {
    const stroke = 6;
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const clamped = Math.max(0, Math.min(1, progress ?? 0));
    const dash = c * clamped;
    return (
      <svg className="timer-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <defs>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#60a5fa" />
            <stop offset="100%" stopColor="#f59e0b" />
          </linearGradient>
        </defs>
        <circle cx={size/2} cy={size/2} r={r} stroke="rgba(148,163,184,0.25)" strokeWidth={stroke} fill="none" />
        <circle cx={size/2} cy={size/2} r={r} stroke="url(#ringGrad)" strokeWidth={stroke} fill="none" strokeDasharray={`${c}`} strokeDashoffset={`${c - dash}`} strokeLinecap="round" transform={`rotate(-90 ${size/2} ${size/2})`} />
      </svg>
    );
  }

  const turnProgress = (typeof timeLeft === 'number' && typeof turnDuration === 'number' && turnDuration > 0)
    ? Math.max(0, Math.min(1, timeLeft / turnDuration))
    : null;

  // Swipe gestures for tab switching
  const modalOpen = showSettings || showStartModal || showHowToModal || showSupportModal;
  const handleTouchStart = (e) => {
    if (modalOpen || !e.touches?.length) return;
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  };
  const handleTouchEnd = (e) => {
    if (modalOpen || !touchStartRef.current || !e.changedTouches?.length) return;
    const start = touchStartRef.current;
    touchStartRef.current = null;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0 && activeTab === 'Menu') setActiveTab('History');
      else if (dx > 0 && activeTab === 'History') setActiveTab('Menu');
    }
  };

  // Keyboard shortcuts (Menu): 1=Start, 2=HowTo, 3=Support
  useEffect(() => {
    const onKey = (e) => {
      if (modalOpen || activeTab !== 'Menu') return;
      if (e.code === 'Digit1') setShowStartModal(true);
      else if (e.code === 'Digit2') setShowHowToModal(true);
      else if (e.code === 'Digit3') setShowSupportModal(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalOpen, activeTab]);

  return (
    <div className={`app theme-${theme}`} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark" aria-hidden>⚡</div>
          <h1 className="brand-title">Tic‑Tac‑Toe</h1>
        </div>
        <div className="header-actions">
          <button className="neo-btn small" onClick={() => setShowSettings(true)} aria-label="Open settings">⚙️ Settings</button>
        </div>
      </header>
      <div className="tabs neo-tabs">
        {['Menu','History'].map(t => (
          <button key={t} className={activeTab===t? 'active':''} onClick={()=>setActiveTab(t)}>{t}</button>
        ))}
      </div>

      {activeTab === 'Menu' && (
        <div className="menu-page">
          <p className="tagline">Play for real SATS. Fast, fair, and fun.</p>
          <div className="menu-center">
          <div className="cta-col">
            <div className="cta-item">
              <button
                className="neo-btn cta-main primary"
                onClick={() => setShowStartModal(true)}
                disabled={gameState==='playing'}
                aria-label={`Start Game — Win ${payoutAmount} SATS`}
              >Start Game</button>
              <div className="cta-context">Join & pay • Win {payoutAmount} SATS</div>
            </div>
            <div className="cta-item">
              <button
                className="neo-btn cta-main"
                onClick={() => setShowHowToModal(true)}
                aria-label="How to Play — Rules and tips"
              >How to Play</button>
              <div className="cta-context">Rules & tips in 30 seconds</div>
            </div>
            <div className="cta-item">
              <button
                className="neo-btn cta-main outline"
                onClick={() => setShowSupportModal(true)}
                aria-label="Contact Support on Telegram"
              >Contact Support</button>
              <div className="cta-context">Telegram @ThunderSlate</div>
            </div>
          </div>
          </div>

          {(gameState === 'playing' || gameState === 'finished') && (
            <div className="section">
              <div className="status">
                <div className="hud">
                  <div className="hud-left">
                    {gameState === 'playing' && turnProgress != null ? (
                      <TimerRing progress={turnProgress} size={58} />
                    ) : null}
                  </div>
                  <div className="hud-center">
                    <div className="message-line">{message}</div>
                    {gameState === 'playing' && typeof timeLeft === 'number' ? (
                      <div className="countdown" role="timer" aria-live="polite">⏳ {timeLeft}s</div>
                    ) : null}
                  </div>
                  <div className="hud-right">
                    <div className="meta">You: {symbol || '-'}</div>
                  </div>
                </div>
              </div>
              <div ref={boardRef} className={`board neo-board ${tiltEnabled ? 'tilt' : ''}`} onPointerMove={handleBoardPointer} onPointerLeave={resetBoardTilt}>
                {board.map((cell, idx) => {
                  const win = Array.isArray(winningLine) && winningLine.includes(idx);
                  const last = lastMove === idx;
                  const xo = cell === 'X' ? ' x' : (cell === 'O' ? ' o' : '');
                  const cls = `cell${xo}${win ? ' win':''}${last ? ' last':''}`;
                  const disabled = gameState !== 'playing' || turn !== socketId || board[idx] !== null;
                  return (
                    <button key={idx} className={cls} onClick={() => onCellClick(idx)} disabled={disabled} aria-label={`Cell ${idx+1}`}>
                      {cell || ''}
                    </button>
                  );
                })}
              </div>
              {gameState === 'playing' ? (
                <div style={{ display:'flex', gap:8, justifyContent:'center' }}>
                  <button className="neo-btn outline" onClick={doResign}>Resign</button>
                  <button className="neo-btn" onClick={resetToMenu}>Return to Menu</button>
                </div>
              ) : (
                <div style={{ display:'flex', gap:8, justifyContent:'center' }}>
                  <button className="neo-btn outline" onClick={shareResult}>Share Result</button>
                  <button className="neo-btn" onClick={resetToMenu}>Return to Menu</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Join tab removed: flow moved into Menu */}

      {false && (
        <div className="status">{message}</div>
      )}

      {false && (
        <div className="panel">
          {gameState === 'playing' || gameState === 'finished' ? (
            <>
              <div className="status">
                {message}
                {gameState === 'playing' && typeof timeLeft === 'number' ? (
                  <div className="countdown" role="timer" aria-live="polite">⏳ {timeLeft}s</div>
                ) : null}
                <div className="meta">You: {symbol || '-'}</div>
              </div>
              <div className="board">
                {board.map((cell, idx) => {
                  const win = Array.isArray(winningLine) && winningLine.includes(idx);
                  const last = lastMove === idx;
                  const xo = cell === 'X' ? ' x' : (cell === 'O' ? ' o' : '');
                  const cls = `cell${xo}${win ? ' win':''}${last ? ' last':''}`;
                  const disabled = gameState !== 'playing' || turn !== socketId || board[idx] !== null;
                  return (
                    <button key={idx} className={cls} onClick={() => onCellClick(idx)} disabled={disabled} aria-label={`Cell ${idx+1}`}> 
                      {cell || ''}
                    </button>
                  );
                })}
              </div>
              {gameState === 'playing' ? (
                <div style={{ display:'flex', gap:8, justifyContent:'center' }}>
                  <button onClick={doResign}>Resign</button>
                  <button onClick={resetToMenu}>Return to Menu</button>
                </div>
              ) : (
                <button onClick={resetToMenu}>Return to Menu</button>
              )}
            </>
          ) : (
            <div className="status">{message}</div>
          )}
        </div>
      )}

      {activeTab === 'History' && (
        <div className="panel neo-panel glass">
          <div className="stats-chips" aria-label="Your stats">
            <span className="chip">Wins: {stats.wins}</span>
            <span className="chip">Losses: {stats.losses}</span>
            <span className="chip">Win rate: {stats.winrate}%</span>
            <span className="chip">Streak: {stats.streak}</span>
            <span className="chip">Net: {stats.net} SATS</span>
          </div>
          <h3>Recent Games</h3>
          {history.length === 0 ? (
            <p>No games yet.</p>
          ) : (
            <ul className="history">
              {history.map(h => (
                <li key={h.id}>
                  <span>{new Date(h.ts).toLocaleString()}</span>
                  <span>Bet: {h.bet}</span>
                  <span>{h.outcome === 'win' ? '+': ''}{h.amount} SATS</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div ref={confettiRef} className="confetti-layer" />

      {showSettings && (
        <div className="modal-backdrop" onClick={() => setShowSettings(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Settings</h3>
            <div className="section">
              <label><input type="checkbox" checked={sfxEnabled} onChange={(e)=>setSfxEnabled(e.target.checked)} /> Sound effects</label>
              <label><input type="checkbox" checked={hapticsEnabled} onChange={(e)=>setHapticsEnabled(e.target.checked)} /> Haptics (vibration)</label>
              <label><input type="checkbox" checked={tiltEnabled} onChange={(e)=>setTiltEnabled(e.target.checked)} /> 3D board tilt</label>
            </div>
            <div className="section">
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                {['minimal','neon','ocean','sunset'].map(tn => (
                  <button key={tn} className={`neo-btn ${theme===tn?'primary':''}`} onClick={()=>setTheme(tn)}>{tn}</button>
                ))}
              </div>
            </div>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
              <button className="neo-btn" onClick={() => setShowSettings(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {showStartModal && (
        <div className="modal-backdrop" onClick={() => setShowStartModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Start Game</h3>
            <div className="section">
              <label>
                Lightning Username
                <input value={lightningAddress} onChange={e=>setLightningAddress(e.target.value)} placeholder="e.g. user" />
              </label>
              <label>
                Bet Amount (SATS)
                <select value={betAmount} onChange={e=>setBetAmount(e.target.value)}>
                  {BET_OPTIONS.map(o => (
                    <option key={o.amount} value={o.amount}>{o.amount} SATS (Win {o.winnings})</option>
                  ))}
                </select>
              </label>
              <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop: 8 }}>
                <button className="neo-btn" onClick={() => setShowStartModal(false)}>Close</button>
                <button className="neo-btn primary" onClick={doJoin} disabled={!connected || isWaitingForPayment}>
                  {connected ? 'Join & Pay' : 'Connecting...'}
                </button>
              </div>

              {paymentInfo && (
                <div className="payment glass">
                  <p>{message}</p>
                  <div className="qr">
                    <QRCodeSVG value={paymentInfo.lightningInvoice || paymentInfo.hostedInvoiceUrl || ''} size={180} />
                  </div>
                  <div className="actions">
                    <a className="neo-btn outline" href={paymentInfo.hostedInvoiceUrl} target="_blank" rel="noreferrer">Open Payment Page</a>
                    <button className="neo-btn" onClick={copyPayment}>Copy Payment Request</button>
                    {paymentInfo.demo ? (
                      <button className="neo-btn" onClick={simulatePayment}>I have paid (demo)</button>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showHowToModal && (
        <div className="modal-backdrop" onClick={() => setShowHowToModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>How to Play</h3>
            <div className="section">
              <ol>
                <li>Enter your Lightning username and choose a bet (default 50 SATS, win 80 SATS).</li>
                <li>Click Join & Pay and pay the invoice (demo mode lets you simulate).</li>
                <li>Play Tic‑Tac‑Toe. You have a turn timer; you can resign anytime.</li>
              </ol>
            </div>
            <div style={{ display:'flex', justifyContent:'flex-end' }}>
              <button className="neo-btn" onClick={() => setShowHowToModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {showSupportModal && (
        <div className="modal-backdrop" onClick={() => setShowSupportModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Contact Support</h3>
            <div className="section">
              <p>Chat with us on Telegram:</p>
              <p><a className="neo-btn outline" href="https://t.me/ThunderSlate" target="_blank" rel="noreferrer">Open Telegram @ThunderSlate</a></p>
            </div>
            <div style={{ display:'flex', justifyContent:'flex-end' }}>
              <button className="neo-btn" onClick={() => setShowSupportModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
