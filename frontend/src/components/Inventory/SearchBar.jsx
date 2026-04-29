export default function SearchBar({ value, onChange }) {
  return (
    <input
      type="search"
      className="search-bar"
      placeholder="Search by name..."
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
