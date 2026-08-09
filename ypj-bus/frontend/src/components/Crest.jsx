import { useState } from 'react';

/**
 * The YPJ crest.
 *
 * Reads `/logo-ypj.png` from `frontend/public/`. If that file has not been added
 * yet the component falls back to a plain gold "YPJ" monogram, so the app never
 * shows a broken image — but the fallback is deliberately not an imitation of the
 * real crest: an approximated institutional logo is worse than an obvious
 * placeholder.
 */
export default function Crest({ size = 34, title = 'Yayasan Pendidikan Jayawijaya' }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span
        aria-label={title}
        style={{
          width: size, height: size, flex: 'none', borderRadius: '50%',
          background: 'var(--accent)', color: 'var(--primary-dark)',
          display: 'grid', placeItems: 'center',
          fontSize: Math.round(size * 0.32), fontWeight: 800, letterSpacing: 0.3,
        }}
      >
        YPJ
      </span>
    );
  }

  return (
    <img
      src="/logo-ypj.png"
      alt={title}
      title={title}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      style={{ width: size, height: size, flex: 'none', objectFit: 'contain' }}
    />
  );
}
