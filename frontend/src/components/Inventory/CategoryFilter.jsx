export const CATEGORIES = [
  'Dress',
  'Decoration tools',
  'Teacher Resources',
  'School supplies',
  'IT equipment',
  'Furniture',
  'Lab equipment',
];

export default function CategoryFilter({ value, onChange }) {
  return (
    <select className="filter-select" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">All Categories</option>
      {CATEGORIES.map((c) => (
        <option key={c} value={c}>{c}</option>
      ))}
    </select>
  );
}
