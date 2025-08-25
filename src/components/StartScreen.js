import React from 'react';

const BET_OPTIONS = [
  { amount: 50, winnings: 80 },
  { amount: 300, winnings: 500 },
  { amount: 500, winnings: 800 },
  { amount: 1000, winnings: 1700 },
  { amount: 5000, winnings: 8000 },
  { amount: 10000, winnings: 17000 },
];

export default function StartScreen({ 
  lightningAddress, 
  setLightningAddress, 
  betAmount, 
  setBetAmount,
  acceptedTerms,
  setAcceptedTerms,
  onStart,
  connected,
  onOpenTerms,
  onOpenPrivacy,
  addressLocked = false,
  noticeMessage
}) {
  const payoutAmount = BET_OPTIONS.find(o => o.amount === parseInt(betAmount, 10))?.winnings || 0;

  return (
    <div className="start-screen">
      <div className="panel neo-panel glass">
        <h2>Start New Game</h2>
        <div className="subtitle">Win {payoutAmount} SATS</div>

        {noticeMessage ? (
          <p className="payment-msg" role="status" aria-live="polite" style={{marginTop: 8}}>
            {noticeMessage}
          </p>
        ) : null}

        <p className="notice-agree">
          By playing the game you agree to our Terms & Conditions and Privacy Policy.
        </p>
        
        <div className="form-section">
          <label htmlFor="ln-username">Lightning Username</label>
          <div className="input-group">
            <span className="prefix" aria-hidden>⚡</span>
            <input 
              id="ln-username" 
              value={lightningAddress} 
              onChange={e => setLightningAddress(e.target.value)} 
              placeholder="username@speed.app" 
              disabled={addressLocked}
            />
            {lightningAddress && !addressLocked && (
              <button 
                type="button" 
                className="suffix-btn" 
                onClick={() => setLightningAddress('')} 
                aria-label="Clear username"
              >
                ✕
              </button>
            )}
          </div>
          <small className="helper">Enter your Speed username or full Lightning address</small>
        </div>

        <div className="form-section">
          <label>Select Bet Amount</label>
          <div className="bet-grid">
            {BET_OPTIONS.map(o => (
              <label key={o.amount} className={`bet-chip ${String(o.amount) === String(betAmount) ? 'active' : ''}`}>
                <input 
                  type="radio" 
                  name="bet" 
                  value={o.amount} 
                  checked={String(o.amount) === String(betAmount)} 
                  onChange={() => setBetAmount(String(o.amount))} 
                />
                <span className="amt">{o.amount} SATS</span>
                <span className="win">Win {o.winnings}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="form-section">
          <label className="checkbox-label">
            <input 
              type="checkbox" 
              checked={acceptedTerms} 
              onChange={(e) => setAcceptedTerms(e.target.checked)} 
            />
            <span>
              I agree to the{' '}
              <button type="button" className="linklike" onClick={onOpenTerms}>Terms & Conditions</button>{' '}
              and{' '}
              <button type="button" className="linklike" onClick={onOpenPrivacy}>Privacy Policy</button>
            </span>
          </label>
        </div>

        <div className="actions">
          <button 
            className="neo-btn primary large" 
            onClick={onStart} 
            disabled={!connected || !acceptedTerms}
            aria-label="Start Game"
          >
            {connected ? 'Start Game' : 'Connecting...'}
          </button>
        </div>
      </div>
    </div>
  );
}
