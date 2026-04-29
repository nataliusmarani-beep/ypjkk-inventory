import { useState } from 'react';

const today = () => new Date().toISOString().slice(0, 10);

export default function CheckOutForm({ item, onSubmit, onClose }) {
  const [form, setForm] = useState({
    borrower_name: '',
    borrower_email: '',
    quantity: 1,
    due_date: '',
    notes: '',
  });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const set = (field) => (e) =>
    setForm((f) => ({ ...f, [field]: e.target.type === 'number' ? Number(e.target.value) : e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSubmit({ ...form, item_id: item.id });
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
        Checking out: <strong>{item.name}</strong> &mdash; {item.quantity} unit(s) available
      </p>

      {error && <div className="form-error">{error}</div>}

      <label>
        Borrower Name *
        <input type="text" value={form.borrower_name} onChange={set('borrower_name')} required />
      </label>

      <label>
        Borrower Email *
        <input type="email" value={form.borrower_email} onChange={set('borrower_email')} required placeholder="e.g. teacher@school.edu" />
      </label>

      <div className="form-row">
        <label>
          Quantity *
          <input type="number" min="1" max={item.quantity} value={form.quantity} onChange={set('quantity')} required />
        </label>
        <label>
          Due Date
          <input type="date" min={today()} value={form.due_date} onChange={set('due_date')} />
        </label>
      </div>

      <label>
        Notes
        <textarea value={form.notes} onChange={set('notes')} rows={2} />
      </label>

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Checking out...' : 'Check Out'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}
