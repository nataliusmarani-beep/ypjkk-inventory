export default function StatusFilter({ value, onChange }) {
  return (
    <select className="filter-select" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">All Status</option>
      <option value="ok">OK</option>
      <option value="low_stock">Low Stock</option>
      <option value="out_of_stock">Out of Stock</option>
    </select>
  );
}
