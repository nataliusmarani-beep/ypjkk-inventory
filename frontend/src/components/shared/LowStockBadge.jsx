export default function LowStockBadge({ status }) {
  if (status === 'ok') return null;
  const label = status === 'out_of_stock' ? 'Out of Stock' : 'Low Stock';
  return <span className={`badge badge-${status}`}>{label}</span>;
}
