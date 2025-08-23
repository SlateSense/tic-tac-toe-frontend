import React, { useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

export default function PaymentScreen({ 
  paymentInfo, 
  message,
  onCopyPayment,
  onCancel,
  qrCode
}) {
  const [showInlineWindow, setShowInlineWindow] = useState(true);

  const payUrl = useMemo(() => {
    return paymentInfo?.hostedInvoiceUrl || '';
  }, [paymentInfo]);

  if (!paymentInfo) {
    return (
      <div className="payment-screen">
        <div className="panel neo-panel glass">
          <h2>Payment Required</h2>
          <p>Generating invoice...</p>
          <div className="spinner" aria-label="Loading" />
        </div>
      </div>
    );
  }

  return (
    <div className="payment-screen">
      <div className="panel neo-panel glass">
        <h2>Payment Required</h2>
        <p className="payment-msg">{message}</p>

        {/* Same‑page payment window (no new tab) */}
        {showInlineWindow && payUrl ? (
          <div className="inline-payment-window" role="dialog" aria-label="Payment Window">
            <iframe
              title="Speed Payment"
              src={payUrl}
              className="payment-iframe"
              sandbox="allow-scripts allow-same-origin allow-forms"
            />
          </div>
        ) : (
          <div className="qr-container">
            <div className="qr-frame">
              {qrCode ? (
                <img src={qrCode} alt="Lightning QR Code" style={{ width: 240, height: 240 }} />
              ) : (
                <QRCodeSVG 
                  value={paymentInfo.lightningInvoice || paymentInfo.hostedInvoiceUrl || ''} 
                  size={240} 
                />
              )}
            </div>
          </div>
        )}

        <div className="payment-info">
          <div className="amount-display">
            <span className="label">Amount:</span>
            <span className="value">{paymentInfo.amountSats} SATS</span>
            <span className="usd">(~${paymentInfo.amountUSD})</span>
          </div>
        </div>

        <div className="actions">
          <button 
            className="neo-btn primary" 
            onClick={() => setShowInlineWindow((v) => !v)}
            aria-pressed={showInlineWindow}
          >
            {showInlineWindow ? 'Show QR Instead' : 'Show Inline Payment Window'}
          </button>
          <button className="neo-btn" onClick={onCopyPayment}>
            Copy Invoice
          </button>
          {localStorage.getItem('speedInterfaceUrl') && (
            <button 
              className="neo-btn primary"
              onClick={() => window.open(localStorage.getItem('speedInterfaceUrl'), '_blank')}
              style={{
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
              }}
            >
              Pay with Speed Wallet
            </button>
          )}
          <button className="neo-btn outline" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
