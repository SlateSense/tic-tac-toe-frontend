import React from 'react';

export default function WaitingScreen({ 
  waitingInfo, 
  waitingSecondsLeft,
  matchInfo,
  matchSecondsLeft 
}) {
  return (
    <div className="waiting-screen">
      <div className="panel neo-panel glass">
        <h2>{matchInfo ? 'Match Found!' : 'Finding Opponent'}</h2>
        
        <div className="waiting-display">
          <div className="spinner-container">
            <div className="spinner" aria-label="Searching" />
          </div>
          
          {waitingInfo && !matchInfo && (
            <div className="waiting-info">
              <p>Searching for an opponent...</p>
              <div className="wait-stats">
                <div className="stat">
                  <span className="label">Estimated wait:</span>
                  <span className="value">{waitingInfo.estimatedWait || `${waitingInfo.minWait}–${waitingInfo.maxWait}s`}</span>
                </div>
              </div>
            </div>
          )}
          
          {matchInfo && (
            <div className="match-info">
              <p className="match-found">Opponent ready!</p>
              <div className="countdown-display">
                <span className="label">Game starts in:</span>
                <span className="countdown-value">{matchSecondsLeft ?? matchInfo.startsIn}s</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
