import ItemRow from './ItemRow.jsx';

export default function ItemTable({ items, onEdit, onDelete, onCheckOut }) {
  if (items.length === 0) {
    return <p className="empty-state">No items found. Add one to get started!</p>;
  }

  return (
    <div className="table-wrapper">
      <table className="inventory-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Category</th>
            <th>Qty</th>
            <th>Min</th>
            <th>Description</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              onEdit={onEdit}
              onDelete={onDelete}
              onCheckOut={onCheckOut}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
