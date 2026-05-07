const PALETTE = [
  ['#dbeafe','#1d4ed8'],
  ['#dcfce7','#15803d'],
  ['#fef3c7','#92400e'],
  ['#fee2e2','#991b1b'],
  ['#f3e8ff','#7e22ce'],
  ['#ccfbf1','#0f766e'],
  ['#fce7f3','#9d174d'],
  ['#e0f2fe','#0369a1'],
  ['#ffedd5','#c2410c'],
  ['#d1fae5','#065f46'],
  ['#ede9fe','#5b21b6'],
  ['#fdf4ff','#a21caf'],
  ['#fef9c3','#854d0e'],
  ['#f1f5f9','#334155'],
];

export function catColor(name = '') {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export default function CategoryBadge({ category }) {
  const [bg, text] = catColor(category || '');
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 20,
      fontSize: 11, fontWeight: 700, letterSpacing: 0.2,
      background: bg, color: text, whiteSpace: 'nowrap',
    }}>{category}</span>
  );
}
