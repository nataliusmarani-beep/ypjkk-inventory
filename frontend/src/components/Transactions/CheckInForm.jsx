import { useState } from 'react';

const today = () => new Date().toISOString().slice(0, 10);

export default function CheckInForm({ transaction, onSubmit, onClose }) {
  const [form, setForm] = useState({ return_date: today(), notes: '' });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSubmit(form);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="item-form">
      <p className="form-subtitle">
        Returning: <strong>{transaction.item_name}</strong> &mdash; borrowed by{' '}
        <strong>{transaction.borrower_name}</strong> ({transaction.quantity} unit(s))
      </p>

      {error && <div className="form-error">{error}</div>}

      <label>
        Return Date *
        <input type="date" value={form.return_date} onChange={set('return_date')} required />
      </label>

      <label>
        Notes
        <textarea value={form.notes} onChange={set('notes')} rows={2} />
      </label>

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Checking in...' : 'Check In'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}
