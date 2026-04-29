import LowStockBadge from '../shared/LowStockBadge.jsx';

export default function ItemRow({ item, onEdit, onDelete, onCheckOut }) {
  return (
    <tr className={item.status === 'out_of_stock' ? 'row-out' : item.status === 'low_stock' ? 'row-low' : ''}>
      <td>
        {item.name}
        <LowStockBadge status={item.status} />
      </td>
      <td>{item.category}</td>
      <td className="qty">{item.quantity}</td>
      <td>{item.min_threshold}</td>
      <td>{item.description || '—'}</td>
      <td className="actions">
        <button className="btn btn-sm btn-primary" onClick={() => onEdit(item)}>Edit</button>
        <button
          className="btn btn-sm btn-success"
          onClick={() => onCheckOut(item)}
          disabled={item.quantity === 0}
        >
          Check Out
        </button>
        <button className="btn btn-sm btn-danger" onClick={() => onDelete(item)}>Delete</button>
      </td>
    </tr>
  );
}
