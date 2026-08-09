import { useEffect, useRef, useState } from 'react';

/**
 * Drawn e-signature on a plain canvas — no dependency needed.
 *
 * The 2024/25 form's "Signature" question was a single checkbox, which is thin
 * evidence for revoking a child's transit privileges later. This produces a real
 * PNG, stored against the exact rules version the parent was shown.
 *
 * Calls onChange(dataUrl | null) whenever the drawing changes.
 */
export default function SignaturePad({ onChange, error }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const hasInk = useRef(false);
  const [empty, setEmpty] = useState(true);

  // Canvas needs a pixel size that matches its CSS size, or strokes land off the
  // pointer on high-DPI phones.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;

    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#121826';
  }, []);

  function pointOf(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e) {
    e.preventDefault();
    drawing.current = true;
    const { x, y } = pointOf(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function move(e) {
    if (!drawing.current) return;
    e.preventDefault();
    const { x, y } = pointOf(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.lineTo(x, y);
    ctx.stroke();
    hasInk.current = true;
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    if (hasInk.current) {
      setEmpty(false);
      // JPEG would blur thin strokes; PNG of a small canvas stays tiny anyway.
      onChange(canvasRef.current.toDataURL('image/png'));
    }
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const ratio = window.devicePixelRatio || 1;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width / ratio, canvas.height / ratio);
    hasInk.current = false;
    setEmpty(true);
    onChange(null);
  }

  return (
    <div className="field">
      <label>Tanda Tangan Orang Tua / Wali <span className="req">*</span></label>
      <div className="hint" style={{ marginTop: 0, marginBottom: 8 }}>
        Tanda tangani di dalam kotak menggunakan jari atau stylus.
      </div>
      <canvas
        ref={canvasRef}
        className={`sign-pad${error ? ' error' : ''}`}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        onPointerCancel={end}
      />
      <div className="row" style={{ marginTop: 6 }}>
        <button type="button" className="link" onClick={clear} disabled={empty}>
          Hapus &amp; ulangi
        </button>
        <span className="grow" />
        {error && <span className="error" style={{ margin: 0 }}>{error}</span>}
      </div>
    </div>
  );
}
