import React, { useEffect, useMemo, useRef, useState } from 'react';
import io from 'socket.io-client';
import { QRCodeSVG } from 'qrcode.react';

import PracticeBoard from './components/PracticeBoard';
import StartScreen from './components/StartScreen';
import PaymentScreen from './components/PaymentScreen';
import WaitingScreen from './components/WaitingScreen';
import GameScreen from './components/GameScreen';
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
  const [currentScreen, setCurrentScreen] = useState('menu'); // 'menu', 'start', 'payment', 'waiting', 'game'
  const [socket, setSocket] = useState(null);
  const [socketId, setSocketId] = useState(null);

  const [betAmount, setBetAmount] = useState(() => localStorage.getItem('ttt_lastBet') || '50');
  const [payoutAmount, setPayoutAmount] = useState(() => {
    const saved = localStorage.getItem('ttt_lastBet');
    const opt = BET_OPTIONS.find(o => o.amount === parseInt(saved || '50'));
    return opt ? String(opt.winnings) : '80';
  });
  const [lightningAddress, setLightningAddress] = useState('');
  const [acctId, setAcctId] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [lnurl, setLnurl] = useState('');
  const [addressLocked, setAddressLocked] = useState(false);

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
  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('ttt_theme');
    return saved && saved !== 'neon' ? saved : 'simple';
  });
  const [turnDuration, setTurnDuration] = useState(null); // seconds for current turn
  const confettiRef = useRef(null);
  const [showSettings, setShowSettings] = useState(false);
  const [sfxEnabled, setSfxEnabled] = useState(() => localStorage.getItem('ttt_sfx') !== '0');
  const [hapticsEnabled, setHapticsEnabled] = useState(() => localStorage.getItem('ttt_haptics') !== '0');
  const [tiltEnabled, setTiltEnabled] = useState(() => localStorage.getItem('ttt_tilt') !== '0');
  const boardRef = useRef(null);
  const audioCtxRef = useRef(null);
  const touchStartRef = useRef(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [waitingInfo, setWaitingInfo] = useState(null); // { minWait, maxWait, estWaitSeconds, spawnAt }
  const waitingIntervalRef = useRef(null);
  const [waitingSecondsLeft, setWaitingSecondsLeft] = useState(null);
  const [matchInfo, setMatchInfo] = useState(null); // { opponent, startsIn, startAt }
  const matchIntervalRef = useRef(null);
  const [matchSecondsLeft, setMatchSecondsLeft] = useState(null);

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
      paymentRequest: async ({ lightningInvoice, hostedInvoiceUrl, amountSats, amountUSD, invoiceId, speedInterfaceUrl }) => {
        const data = { lightningInvoice, hostedInvoiceUrl, amountSats, amountUSD, invoiceId, speedInterfaceUrl };
        setPaymentInfo(data);
        setLnurl(lightningInvoice || hostedInvoiceUrl);
        setQrCode('');
        setMessage(`Pay ${amountSats} SATS (~$${amountUSD})`);
        setGameState('awaitingPayment');
        setCurrentScreen('payment');
        setIsWaitingForPayment(true);

        // Generate QR code for Lightning invoice
        if (lightningInvoice) {
          try {
            const response = await fetch(`${BACKEND_URL}/api/generate-qr`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ invoice: lightningInvoice })
            });
            const qrData = await response.json();
            if (qrData.qr) {
              setQrCode(qrData.qr);
            }
          } catch (error) {
            console.error('Failed to generate QR code:', error);
          }
        }

        // Store Speed interface URL if available
        if (speedInterfaceUrl) {
          localStorage.setItem('speedInterfaceUrl', speedInterfaceUrl);
        }
      },
      payment_sent: ({ amount, status, txId }) => {
        setMessage(`Payout sent: ${amount} SATS${txId ? ` (tx: ${txId})` : ''}`);
      },
      payment_error: ({ error }) => {
        setMessage(`Payout error: ${error || 'Unknown error'}`);
      },
      paymentVerified: () => {
        setIsWaitingForPayment(false);
        setMessage('Payment verified! Waiting for opponent...');
        setGameState('waiting');
        setCurrentScreen('waiting');
      },
      paymentStatus: ({ status, message }) => {
        console.log('Payment status:', status, message);
        if (status === 'pending' || status === 'unpaid') {
          setMessage('Payment pending... Please complete the payment');
        } else if (status === 'error') {
          setMessage(`Payment check error: ${message || 'Unknown error'}`);
        }
      },
      transaction: ({ message }) => {
        setMessage(message);
      },
      waitingForOpponent: ({ minWait, maxWait, estWaitSeconds, spawnAt }) => {
        // Start waiting countdown until potential bot spawn or human arrival
        setGameState('waiting');
        setCurrentScreen('waiting');
        setWaitingInfo({ minWait, maxWait, estWaitSeconds, spawnAt });
        setMatchInfo(null);
        if (waitingIntervalRef.current) { clearInterval(waitingIntervalRef.current); waitingIntervalRef.current = null; }
        const tick = () => {
          const secs = Math.max(0, Math.ceil((Number(spawnAt) - Date.now()) / 1000));
          setWaitingSecondsLeft(secs);
        };
        tick();
        waitingIntervalRef.current = setInterval(tick, 500);
      },
      matchFound: ({ opponent, startsIn, startAt }) => {
        // Switch to pre-game countdown
        if (waitingIntervalRef.current) { clearInterval(waitingIntervalRef.current); waitingIntervalRef.current = null; }
        setWaitingInfo(null);
        setMatchInfo({ opponent, startsIn, startAt });
        setGameState('waiting');
        setMessage('Opponent found! Starting soon...');
        if (matchIntervalRef.current) { clearInterval(matchIntervalRef.current); matchIntervalRef.current = null; }
        const tick = () => {
          const secs = Math.max(0, Math.ceil((Number(startAt) - Date.now()) / 1000));
          setMatchSecondsLeft(secs);
        };
        tick();
        matchIntervalRef.current = setInterval(tick, 250);
      },
      startGame: ({ gameId, symbol, turn, message, turnDeadline }) => {
        // Clear waiting/match timers on actual game start
        if (waitingIntervalRef.current) { clearInterval(waitingIntervalRef.current); waitingIntervalRef.current = null; }
        if (matchIntervalRef.current) { clearInterval(matchIntervalRef.current); matchIntervalRef.current = null; }
        setWaitingInfo(null);
        setMatchInfo(null);
        setWaitingSecondsLeft(null);
        setMatchSecondsLeft(null);
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
        setCurrentScreen('game');
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
        const isWin = !!(winnerSymbol && symbol && winnerSymbol === symbol);
        const isDraw = winnerSymbol == null;
        const entry = {
          id: `g_${Date.now()}`,
          ts: new Date().toISOString(),
          bet: parseInt(betAmount, 10),
          outcome: isDraw ? 'draw' : (isWin ? 'win' : 'loss'),
          amount: isDraw ? 0 : (isWin ? (PAYOUTS[betAmount]?.winner - parseInt(betAmount,10)) : -parseInt(betAmount,10)),
        };
        const newHist = [entry, ...history].slice(0, 100);
        setHistory(newHist);
        localStorage.setItem('ttt_history', JSON.stringify(newHist));
        if (isWin) {
          launchConfetti();
          sfxPlay('win');
          triggerHaptic([30, 40, 30]);
        } else if (isDraw) {
          // no-op for draw
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
      if (waitingIntervalRef.current) { clearInterval(waitingIntervalRef.current); waitingIntervalRef.current = null; }
      if (matchIntervalRef.current) { clearInterval(matchIntervalRef.current); matchIntervalRef.current = null; }
    };
  }, [BACKEND_URL, betAmount, history]);

  const handleJoinGame = async () => {
    // Auto-format Lightning address if needed
    let formattedAddress = lightningAddress.trim();
    if (formattedAddress && !formattedAddress.includes('@')) {
      formattedAddress = `${formattedAddress}@speed.app`;
    }

    if (!formattedAddress || !formattedAddress.includes('@')) {
      alert('Please enter a valid Lightning address (e.g., username or username@speed.app)');
      return;
    }
    if (!betAmount) {
      alert('Please select a bet amount');
      return;
    }

    // Check for Speed auth token and fetch Lightning address if available
    const authToken = localStorage.getItem('speedAuthToken');
    if (authToken && !lightningAddress) {
      try {
        const response = await fetch(`${BACKEND_URL}/api/get-lightning-address`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ authToken })
        });
        const data = await response.json();
        if (data.lightningAddress) {
          setLightningAddress(data.lightningAddress);
          setAcctId(data.acctId);
          formattedAddress = data.lightningAddress;
        }
      } catch (error) {
        console.error('Failed to fetch Lightning address:', error);
      }
    }

    socket.emit('joinGame', { 
      betAmount: parseInt(betAmount, 10), 
      lightningAddress: formattedAddress,
      acctId: acctId || localStorage.getItem('speedAcctId')
    });
    localStorage.setItem('ttt_lastBet', String(betAmount));
    localStorage.setItem('ttt_lightningAddress', formattedAddress || '');
    localStorage.setItem('ttt_lastAddress', formattedAddress || '');
    setAddressLocked(true);
    setCurrentScreen('payment');
  };


  // Sea Battle style - payment verification only via webhooks

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
    setCurrentScreen('menu');
    setActiveTab('Menu');
    setMessage('');
    setBoard(Array(9).fill(null));
    setLastMove(null);
    setWinningLine(null);
    setTurnDeadline(null);
    setTimeLeft(null);
    setPaymentInfo(null);
    setIsWaitingForPayment(false);
    if (waitingIntervalRef.current) { clearInterval(waitingIntervalRef.current); waitingIntervalRef.current = null; }
    if (matchIntervalRef.current) { clearInterval(matchIntervalRef.current); matchIntervalRef.current = null; }
    setWaitingInfo(null);
    setWaitingSecondsLeft(null);
    setMatchInfo(null);
    setMatchSecondsLeft(null);
    setAcceptedTerms(false);
    // defaults 50 -> 80
    setBetAmount('50');
    setPayoutAmount('80');
    setShowHowToModal(false);
    setShowStartModal(false);
    setShowSupportModal(false);
    setAddressLocked(false);
  };

  useEffect(() => {
    const opt = BET_OPTIONS.find(o => o.amount === parseInt(betAmount, 10));
    setPayoutAmount(String(opt?.winnings || 0));
  }, [betAmount]);

  // Persist toggles
  useEffect(() => { localStorage.setItem('ttt_sfx', sfxEnabled ? '1' : '0'); }, [sfxEnabled]);
  useEffect(() => { localStorage.setItem('ttt_haptics', hapticsEnabled ? '1' : '0'); }, [hapticsEnabled]);
  useEffect(() => { localStorage.setItem('ttt_tilt', tiltEnabled ? '1' : '0'); }, [tiltEnabled]);
  useEffect(() => { localStorage.setItem('ttt_theme', theme); }, [theme]);

  // Autofill Lightning username from URL (#p_add=user@speed.app or ?p_add=)
  useEffect(() => {
    try {
      const hash = window.location.hash.substring(1);
      const hashParams = new URLSearchParams(hash);
      const urlParams = new URLSearchParams(window.location.search);
      const pAdd = hashParams.get('p_add') || urlParams.get('p_add');
      if (pAdd) {
        const username = pAdd.split('@')[0].trim();
        setLightningAddress(username);
        if (username) setAddressLocked(true);
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

      {activeTab === 'Menu' && currentScreen === 'menu' && (
        <div className="menu-page">
          <div className="menu-center">
          <div className="cta-col">
            <div className="cta-item">
              <button
                className="neo-btn cta-main primary"
                onClick={() => setCurrentScreen('start')}
                disabled={gameState==='playing'}
                aria-label={`Start Game — Win ${payoutAmount} SATS`}
              >Start Game</button>
            </div>
            <div className="cta-item">
              <button
                className="neo-btn cta-main"
                onClick={() => setShowHowToModal(true)}
                aria-label="How to Play — Rules and tips"
              >How to Play</button>
            </div>
            <div className="cta-item">
              <button
                className="neo-btn cta-main outline"
                onClick={() => setShowSupportModal(true)}
                aria-label="Contact Support on Telegram"
              >Contact Support</button>
            </div>
          </div>
          </div>
          <PracticeBoard />
        </div>
      )}

      {currentScreen === 'start' && (
        <StartScreen
          lightningAddress={lightningAddress}
          setLightningAddress={setLightningAddress}
          betAmount={betAmount}
          setBetAmount={setBetAmount}
          acceptedTerms={acceptedTerms}
          setAcceptedTerms={setAcceptedTerms}
          onStart={handleJoinGame}
          connected={connected}
          onOpenTerms={() => setShowTerms(true)}
          onOpenPrivacy={() => setShowPrivacy(true)}
          addressLocked={addressLocked}
        />
      )}

      {currentScreen === 'payment' && (
        <PaymentScreen
          paymentInfo={paymentInfo}
          message={message}
          onCopyPayment={copyPayment}
          onCancel={resetToMenu}
          qrCode={qrCode}
        />
      )}

      {currentScreen === 'waiting' && (
        <WaitingScreen
          waitingInfo={waitingInfo}
          waitingSecondsLeft={waitingSecondsLeft}
          matchInfo={matchInfo}
          matchSecondsLeft={matchSecondsLeft}
        />
      )}

      {currentScreen === 'game' && (
        <GameScreen
          board={board}
          symbol={symbol}
          turn={turn}
          socketId={socketId}
          lastMove={lastMove}
          winningLine={winningLine}
          message={message}
          gameState={gameState}
          onCellClick={onCellClick}
          onResign={doResign}
          onReturnToMenu={resetToMenu}
          onShareResult={shareResult}
          tiltEnabled={tiltEnabled}
          boardRef={boardRef}
          onBoardPointerMove={handleBoardPointer}
          onBoardPointerLeave={resetBoardTilt}
        />
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
                {[['simple', 'Green'], ['blue', 'Monochrome'], ['pink', 'Red'], ['yellow', 'Gold']].map(([key, label]) => (
                  <button key={key} className={`neo-btn ${theme===key?'primary':''}`} onClick={()=>setTheme(key)} style={{textTransform: 'capitalize'}}>{label}</button>
                ))}
              </div>
            </div>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
              <button className="neo-btn" onClick={() => setShowSettings(false)}>Close</button>
            </div>
          </div>
        </div>
      )}


      {showHowToModal && (
        <div className="modal-backdrop" onClick={() => setShowHowToModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>How to Play</h3>
            <div className="section">
              <p className="fun-intro">Rule #1: Be X-ceptional. Rule #2: Be O-pen to genius moves. Rule #3: Don’t time out!</p>
              <ol>
                <li>Join & Pay: Enter your Speed username (e.g., yourname) and choose a bet. You’ll get a Lightning invoice and a same-page payment window. Pay to enter.</li>
                <li>Matchmaking: We search for a real player for 13–25 seconds. If none joins, we’ll match you with a clearly disclosed bot. Either way, you’ll see “Opponent found” and a 5→1 countdown.</li>
                <li>Turns & Timers: First move has up to 8 seconds; every move after that has 5 seconds. If a game ends in a draw, the opponent starts next game with a 5-second timer.</li>
                <li>Winning: Classic 3-in-a-row rules. If you win, payouts are sent instantly to your Lightning address per the bet’s winnings.</li>
                <li>Payments & Payouts: Bets are in SATS. Payouts are automatic to your provided Lightning address via Speed Wallet. We log payout confirmations for support.</li>
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

      {showTerms && (
        <div className="modal-backdrop" onClick={() => setShowTerms(false)}>
          <div className="modal terms" onClick={(e) => e.stopPropagation()}>
            <h3>Terms & Conditions</h3>
            <div className="section scrollable">
              <p>Welcome to Tic‑Tac‑Toe. By playing you agree to fair play rules, our payout terms, and standard limitations of liability.</p>
              <ul>
                <li>Eligibility: You must be of legal age in your jurisdiction.</li>
                <li>Payments: Bets are paid in SATS via Speed Wallet. Winners receive the advertised payout instantly after game end.</li>
                <li>Bots Disclosure: In times of low traffic, the game may match you with a computer-controlled opponent (a “bot”). Bots adhere to the same time limits and rules and are clearly disclosed in the UI.</li>
                <li>Fairness: No rigging. Game outcomes depend on player moves and valid game logic.</li>
                <li>Disconnections: If a player disconnects or times out, the game may forfeit the turn or end per the rules shown in How to Play.</li>
                <li>Liability: We are not liable for network outages, wallet downtime, or losses beyond your wager. Do not wager more than you can afford to lose.</li>
                <li>Prohibited Conduct: No cheating, exploiting bugs, or harassment.</li>
              </ul>
            </div>
            <div style={{ display:'flex', justifyContent:'flex-end' }}>
              <button className="neo-btn" onClick={() => setShowTerms(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {showPrivacy && (
        <div className="modal-backdrop" onClick={() => setShowPrivacy(false)}>
          <div className="modal privacy" onClick={(e) => e.stopPropagation()}>
            <h3>Privacy Policy</h3>
            <div className="section scrollable">
              <p>We process minimal data needed to run the game and payments.</p>
              <ul>
                <li>What we store: basic gameplay events, bet amounts, and payout confirmations for anti-fraud and support.</li>
                <li>Wallet data: Lightning address you provide is used solely to process payments.</li>
                <li>Telemetry: Aggregate stats may be collected to improve matchmaking and game stability.</li>
              </ul>
            </div>
            <div style={{ display:'flex', justifyContent:'flex-end' }}>
              <button className="neo-btn" onClick={() => setShowPrivacy(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
