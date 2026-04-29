export default function TransactionList({ transactions, onCheckIn }) {
  if (transactions.length === 0) {
    return <p className="empty-state">No transactions yet.</p>;
  }

  return (
    <div className="table-wrapper">
      <table className="inventory-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Category</th>
            <th>Borrower</th>
            <th>Email</th>
            <th>Qty</th>
            <th>Checked Out</th>
            <th>Due Date</th>
            <th>Returned</th>
            <th>Notes</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((tx) => (
            <tr key={tx.id} className={!tx.return_date ? 'row-open' : ''}>
              <td>{tx.item_name}</td>
              <td>{tx.category}</td>
              <td>{tx.borrower_name}</td>
              <td>{tx.borrower_email || '—'}</td>
              <td className="qty">{tx.quantity}</td>
              <td>{tx.created_at?.slice(0, 10)}</td>
              <td>{tx.due_date || '—'}</td>
              <td>{tx.return_date || <span className="badge badge-low_stock">Open</span>}</td>
              <td>{tx.notes || '—'}</td>
              <td>
                {!tx.return_date && (
                  <button className="btn btn-sm btn-success" onClick={() => onCheckIn(tx)}>
                    Check In
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
