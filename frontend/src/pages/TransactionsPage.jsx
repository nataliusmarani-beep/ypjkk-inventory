import { useState } from 'react';
import { useTransactions } from '../hooks/useTransactions.js';
import { api } from '../api.js';
import TransactionList from '../components/Transactions/TransactionList.jsx';
import CheckInForm from '../components/Transactions/CheckInForm.jsx';
import Modal from '../components/shared/Modal.jsx';
import Toast from '../components/shared/Toast.jsx';

export default function TransactionsPage() {
  const [statusFilter, setStatusFilter] = useState('');
  const { transactions, loading, error, refresh } = useTransactions({ status: statusFilter });

  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);

  const handleCheckIn = async (form) => {
    await api.checkin(modal.data.id, form);
    refresh();
    setToast({ message: 'Item checked in successfully.', type: 'success' });
  };

  return (
    <div>
      <div className="page-header">
        <h1>Transactions</h1>
        <select
          className="filter-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All</option>
          <option value="open">Open (not returned)</option>
          <option value="returned">Returned</option>
        </select>
      </div>

      {loading && <p className="loading">Loading...</p>}
      {error && <p className="form-error">{error}</p>}
      {!loading && !error && (
        <TransactionList
          transactions={transactions}
          onCheckIn={(tx) => setModal({ data: tx })}
        />
      )}

      {modal && (
        <Modal title="Check In Item" onClose={() => setModal(null)}>
          <CheckInForm
            transaction={modal.data}
            onSubmit={handleCheckIn}
            onClose={() => setModal(null)}
          />
        </Modal>
      )}

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  );
}
