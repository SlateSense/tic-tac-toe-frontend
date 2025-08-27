import React from 'react';

export default function GameScreen({ 
  board, 
  symbol, 
  turn, 
  socketId,
  lastMove,
  winningLine,
  message,
  gameState,
  onCellClick,
  onResign,
  onReturnToMenu,
  onShareResult,
  tiltEnabled,
  boardRef,
  onBoardPointerMove,
  onBoardPointerLeave,
  turnDuration
}) {
  const isPlaying = gameState === 'playing';
  const isFinished = gameState === 'finished';
  const isMyTurn = turn === socketId;

  return (
    <div className="game-screen">
      <div className="panel neo-panel glass">
        <div className="game-header">
          <h2>Tic-Tac-Toe</h2>
          <div className="game-status">
            <span className="message">{message}</span>
            {turnDuration && isPlaying && (
              <span className="turn-timer">Time: {turnDuration}s</span>
            )}
            <span className="player-symbol">You: {symbol || '-'}</span>
          </div>
        </div>

        <div 
          ref={boardRef}
          className={`board neo-board ${tiltEnabled ? 'tilt' : ''}`}
          onPointerMove={onBoardPointerMove}
          onPointerLeave={onBoardPointerLeave}
        >
          {board.map((cell, idx) => {
            const isWinningCell = Array.isArray(winningLine) && winningLine.includes(idx);
            const isLastMove = lastMove === idx;
            const cellClass = `cell${cell === 'X' ? ' x' : cell === 'O' ? ' o' : ''}${isWinningCell ? ' win' : ''}${isLastMove ? ' last' : ''}`;
            const disabled = !isPlaying || !isMyTurn || board[idx] !== null;
            
            return (
              <button 
                key={idx} 
                className={cellClass} 
                onClick={() => onCellClick(idx)} 
                disabled={disabled}
                aria-label={`Cell ${idx + 1}`}
              >
                {cell || ''}
              </button>
            );
          })}
        </div>

        <div className="game-actions">
          {isPlaying ? (
            <>
              <button className="neo-btn outline" onClick={onResign}>
                Resign
              </button>
              <button className="neo-btn" onClick={onReturnToMenu}>
                Return to Menu
              </button>
            </>
          ) : isFinished ? (
            <>
              <button className="neo-btn outline" onClick={onShareResult}>
                Share Result
              </button>
              <button className="neo-btn primary" onClick={onReturnToMenu}>
                New Game
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
