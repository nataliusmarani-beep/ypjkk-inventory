import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { renderMarkdown } from '../components/RulesPanel.jsx';

/**
 * Read-only view of the current "Peraturan dan Ketentuan Bis Sekolah YPJ",
 * reachable any time from the parent dashboard — not just during registration.
 * A parent who signed up months ago and wants to check the pickup/dropoff
 * tolerance rule, or remind themselves who to contact, shouldn't have to start
 * a new application to see it.
 *
 * No scroll-gating or checkboxes here: consent already happened at submit
 * time and is recorded against a specific rule_document_id. This page just
 * shows whatever is currently published, which may be a newer version than
 * what any given parent originally agreed to.
 */
export default function RulesViewPage() {
  const navigate = useNavigate();
  const [rules, setRules] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.meta()
      .then((m) => setRules(m.rules))
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div className="page">
      <h1>Peraturan &amp; Kebijakan Bis Sekolah</h1>
      <p className="muted">
        Ketentuan penggunaan bis sekolah YPJ, termasuk aturan bagi pengantar dan
        penjemput siswa.
      </p>

      {error && <div className="banner danger"><span>⚠</span><div>{error}</div></div>}

      {!rules && !error && <p className="muted">Memuat…</p>}

      {rules && (
        <div className="card">
          <h2 style={{ marginBottom: 2 }}>{rules.title}</h2>
          <p className="muted" style={{ marginBottom: 16 }}>Versi {rules.version}</p>
          <div dangerouslySetInnerHTML={{ __html: renderMarkdown(rules.body_md) }} />
        </div>
      )}

      <div className="banner info">
        <span>✉</span>
        <div>
          <strong>Punya keluhan atau masukan?</strong>
          Sampaikan langsung ke Tim Transportasi YPJ melalui halaman{' '}
          <button className="link" style={{ padding: 0 }} onClick={() => navigate('/keluhan')}>
            Laporkan Keluhan
          </button>.
        </div>
      </div>

      <button className="ghost block" onClick={() => navigate('/')}>Kembali ke Beranda</button>
    </div>
  );
}
