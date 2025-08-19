import React, { useEffect, useMemo, useRef, useState } from 'react';

const LINES = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6]
];

function getWinner(board) {
  for (const line of LINES) {
    const [a,b,c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line };
    }
  }
  return null;
}
function isDraw(board) {
  return board.every(v => v !== null) && !getWinner(board);
}
function emptySquares(board) {
  const out = [];
  for (let i = 0; i < 9; i++) if (board[i] == null) out.push(i);
  return out;
}

function smartMove(board, bot, you) {
  const empties = emptySquares(board);
  // 1) Win now
  for (const i of empties) {
    const b = board.slice(); b[i] = bot;
    if (getWinner(b)) return i;
  }
  // 2) Block opponent win
  for (const i of empties) {
    const b = board.slice(); b[i] = you;
    if (getWinner(b)) return i;
  }
  // 3) Take center
  if (empties.includes(4)) return 4;
  // 4) Take a corner
  const corners = [0,2,6,8].filter(i => empties.includes(i));
  if (corners.length) return corners[Math.floor(Math.random() * corners.length)];
  // 5) Any side
  const sides = [1,3,5,7].filter(i => empties.includes(i));
  if (sides.length) return sides[Math.floor(Math.random() * sides.length)];
  // Fallback
  return empties.length ? empties[0] : null;
}
function easyMove(board) {
  const empties = emptySquares(board);
  if (!empties.length) return null;
  return empties[Math.floor(Math.random() * empties.length)];
}

export default function PracticeBoard() {
  const [board, setBoard] = useState(Array(9).fill(null));
  const youSymbol = 'X';
  const botSymbol = 'O';
  const [lastMove, setLastMove] = useState(null);
  const [winningLine, setWinningLine] = useState(null);
  const [status, setStatus] = useState('Your move');
  const botTimerRef = useRef(null);
  const [botThinking, setBotThinking] = useState(false);

  // Derived state
  const ended = useMemo(() => !!getWinner(board) || isDraw(board), [board]);
  const turnCount = useMemo(() => board.filter(v => v != null).length, [board]);
  const yourTurn = useMemo(() => (turnCount % 2 === 0), [turnCount]); // You always start
  const currentSymbol = yourTurn ? youSymbol : botSymbol;

  useEffect(() => {
    // Update status based on state
    const w = getWinner(board);
    if (w) {
      setWinningLine(w.line);
      setStatus(w.winner === youSymbol ? 'You win!' : 'Bot wins!');
      return;
    }
    if (isDraw(board)) {
      setWinningLine(null);
      setStatus('Draw');
      return;
    }
    setWinningLine(null);
    setStatus(yourTurn ? 'Your move' : "Bot's move");
  }, [board, youSymbol, yourTurn]);

  // Cleanup any pending timers on unmount
  useEffect(() => {
    return () => { if (botTimerRef.current) clearTimeout(botTimerRef.current); };
  }, []);

  // Reset the board (you always start)
  const reset = () => {
    if (botTimerRef.current) clearTimeout(botTimerRef.current);
    setBoard(Array(9).fill(null));
    setLastMove(null);
    setWinningLine(null);
    setStatus('Your move');
    setBotThinking(false);
  };

  const onCell = (i) => {
    if (ended || !yourTurn || board[i] != null) return;
    if (botTimerRef.current) clearTimeout(botTimerRef.current);
    // Apply your move
    setBoard(prev => {
      const b = prev.slice();
      b[i] = youSymbol; setLastMove(i);
      return b;
    });
    // Schedule bot move with randomized timing (300ms to 2000ms)
    setBotThinking(true);
    const randomDelay = 300 + Math.random() * 1700;
    botTimerRef.current = setTimeout(() => {
      setBoard(prev => {
        if (getWinner(prev) || isDraw(prev)) return prev; // game could have ended
        const b2 = prev.slice();
        const idx = smartMove(b2, botSymbol, youSymbol);
        if (idx == null || b2[idx] != null) return prev;
        b2[idx] = botSymbol; setLastMove(idx);
        return b2;
      });
      setBotThinking(false);
    }, randomDelay);
  };

  // Removed controls (difficulty, starter, symbol) for a simpler UI

  return (
    <div className="panel neo-panel glass practice" role="region" aria-label="Practice: You vs Bot">
      <div className="practice-header">
        <h3 className="practice-title">Practice: You vs Bot</h3>
        <div>
          <button className="neo-btn small outline" onClick={reset}>Reset</button>
        </div>
      </div>

      <div className="status" aria-live="polite">{status}</div>

      <div className="board neo-board practice-board">
        {board.map((cell, idx) => {
          const win = Array.isArray(winningLine) && winningLine.includes(idx);
          const last = lastMove === idx;
          const xo = cell === 'X' ? ' x' : (cell === 'O' ? ' o' : '');
          const cls = `cell${xo}${win ? ' win':''}${last ? ' last':''}`;
          const disabled = ended || !yourTurn || board[idx] !== null;
          return (
            <button key={idx} className={cls} onClick={() => onCell(idx)} disabled={disabled} aria-label={`Practice cell ${idx+1}`}>
              {cell || ''}
            </button>
          );
        })}
      </div>
      <div className="practice-footer">
        <small className="muted">A friendly practice board. No payments. No opponents. Just you vs. bot.</small>
      </div>
    </div>
  );
}
