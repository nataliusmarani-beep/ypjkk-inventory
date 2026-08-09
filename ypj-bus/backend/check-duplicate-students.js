require('dotenv').config();
const db = require('./db');

// Flags students whose name is an exact or near-exact match to another
// student's name, across different parent accounts and/or grades. The DB
// already blocks an exact (name, grade) duplicate under the SAME parent
// (students_unique_per_parent) — this script looks for everything that
// constraint can't catch: the same child submitted under two different
// parent logins, or the same child re-typed with a spelling variant.

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

function normalize(name) {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

function similarity(a, b) {
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length) || 1;
  return 1 - dist / maxLen;
}

const students = db.prepare(`
  SELECT s.id, s.full_name, s.grade, s.parent_id, s.is_active, s.created_at,
         u.name AS parent_name, u.email AS parent_email
  FROM students s
  JOIN users u ON u.id = s.parent_id
  ORDER BY s.full_name
`).all();

const appsByStudent = new Map();
for (const row of db.prepare(`
  SELECT student_id, application_no, status FROM applications
`).all()) {
  if (!appsByStudent.has(row.student_id)) appsByStudent.set(row.student_id, []);
  appsByStudent.get(row.student_id).push(row);
}

const pairs = [];
for (let i = 0; i < students.length; i++) {
  for (let j = i + 1; j < students.length; j++) {
    const a = students[i], b = students[j];
    const sim = similarity(normalize(a.full_name), normalize(b.full_name));
    if (sim >= 0.75) {
      pairs.push({ a, b, sim, sameGrade: a.grade === b.grade, sameParent: a.parent_id === b.parent_id });
    }
  }
}

pairs.sort((x, y) => y.sim - x.sim);

console.log(`Total active/inactive students checked: ${students.length}`);
console.log(`Potential duplicate/near-duplicate pairs found: ${pairs.length}\n`);

for (const { a, b, sim, sameGrade, sameParent } of pairs) {
  console.log('─'.repeat(70));
  console.log(`Similarity: ${(sim * 100).toFixed(0)}%  ${sameGrade ? '(same grade)' : '(different grade)'}  ${sameParent ? '⚠ SAME PARENT (should be blocked by DB)' : ''}`);
  for (const s of [a, b]) {
    const apps = (appsByStudent.get(s.id) || []).map(x => `${x.application_no || '—'}[${x.status}]`).join(', ') || 'no application';
    console.log(`  #${s.id} "${s.full_name}" (${s.grade}) active=${s.is_active} — parent: ${s.parent_name} <${s.parent_email}> — apps: ${apps}`);
  }
}
