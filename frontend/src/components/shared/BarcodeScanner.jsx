import { useEffect, useRef, useState } from 'react';

/**
 * BarcodeScanner — opens the device camera and scans any 1D/2D barcode.
 * Calls onScan(code) on success, onClose() when dismissed.
 */
export default function BarcodeScanner({ onScan, onClose }) {
  const [status,  setStatus]  = useState('starting'); // starting | scanning | error
  const [errMsg,  setErrMsg]  = useState('');
  const scannerRef = useRef(null);
  const calledRef  = useRef(false);   // prevent double-fire in React strict mode

  useEffect(() => {
    let scanner;

    async function start() {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        scanner = new Html5Qrcode('barcode-reader-box');
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: 'environment' },   // back camera
          {
            fps: 10,
            qrbox: { width: 260, height: 100 },
          },
          (decoded) => {
            if (calledRef.current) return;
            calledRef.current = true;
            scanner.stop().catch(() => {});
            onScan(decoded);
          },
          () => {},    // per-frame errors — ignore
        );
        setStatus('scanning');
      } catch (err) {
        const msg = String(err).includes('permission')
          ? 'Camera access was denied. Please allow camera permission in your browser settings and try again.'
          : 'Could not start the camera. Make sure no other app is using it.';
        setStatus('error');
        setErrMsg(msg);
      }
    }

    start();

    return () => {
      scannerRef.current?.isScanning && scannerRef.current.stop().catch(() => {});
    };
  }, []);

  const handleClose = () => {
    scannerRef.current?.isScanning && scannerRef.current.stop().catch(() => {});
    onClose();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 16,
    }}>
      <div style={{
        background: 'white', borderRadius: 14, width: '100%', maxWidth: 420,
        overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
      }}>
        {/* Header */}
        <div style={{
          background: 'var(--navy)', color: 'white',
          padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>📷 Scan Barcode</div>
          <button
            onClick={handleClose}
            style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white',
              borderRadius: '50%', width: 28, height: 28, cursor: 'pointer', fontSize: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >✕</button>
        </div>

        {/* Body */}
        <div style={{ padding: 18 }}>
          {status === 'error' ? (
            <div style={{ textAlign: 'center', padding: '20px 10px' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>📵</div>
              <div style={{ fontSize: 13, color: '#b91c1c', lineHeight: 1.6, marginBottom: 16 }}>{errMsg}</div>
              <button className="btn btn-ghost" onClick={handleClose}>Close</button>
            </div>
          ) : (
            <>
              {status === 'starting' && (
                <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--muted)', fontSize: 13 }}>
                  Starting camera…
                </div>
              )}

              {/* Camera viewfinder — html5-qrcode injects video here */}
              <div
                id="barcode-reader-box"
                style={{ width: '100%', borderRadius: 8, overflow: 'hidden' }}
              />

              <div style={{
                marginTop: 12, textAlign: 'center', fontSize: 12,
                color: 'var(--muted)', lineHeight: 1.6,
              }}>
                Point the camera at the barcode on the item.<br />
                The scan happens automatically.
              </div>

              <button
                type="button"
                className="btn btn-ghost"
                style={{ width: '100%', marginTop: 12 }}
                onClick={handleClose}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
