import { useRef } from 'react';

/**
 * Renders the versioned "Peraturan dan Ketentuan Bis Sekolah YPJ" and reports
 * when the parent has actually scrolled to the end — the consent checkboxes stay
 * disabled until then. Not legal armour by itself, but it removes the "the rules
 * were hidden below the fold" argument.
 */
export default function RulesPanel({ rules, onReachedEnd, reachedEnd }) {
  const boxRef = useRef(null);

  function handleScroll() {
    const el = boxRef.current;
    if (!el || reachedEnd) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) onReachedEnd();
  }

  return (
    <>
      <div className="rules-box" ref={boxRef} onScroll={handleScroll}
           dangerouslySetInnerHTML={{ __html: renderMarkdown(rules?.body_md || '') }} />
      {!reachedEnd && (
        <div className="hint">⌄ Gulir sampai akhir untuk mengaktifkan persetujuan.</div>
      )}
    </>
  );
}

/**
 * Minimal Markdown → HTML for headings, bullets and bold. The rules text is
 * authored by the Transport Team in the database, so it is not arbitrary user
 * input — but it is still escaped before any formatting is applied, so a stray
 * angle bracket can never become markup.
 */
export function renderMarkdown(md) {
  const escaped = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const lines = escaped.split('\n');
  const out = [];
  let inList = false;

  const inline = (text) => text
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('- ')) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(trimmed.slice(2))}</li>`);
      continue;
    }
    if (inList) { out.push('</ul>'); inList = false; }

    if (!trimmed) continue;
    if (trimmed.startsWith('### ')) out.push(`<h3>${inline(trimmed.slice(4))}</h3>`);
    else if (trimmed.startsWith('## ')) out.push(`<h2>${inline(trimmed.slice(3))}</h2>`);
    else if (trimmed.startsWith('# ')) out.push(`<h2>${inline(trimmed.slice(2))}</h2>`);
    else out.push(`<p>${inline(trimmed)}</p>`);
  }
  if (inList) out.push('</ul>');

  return out.join('');
}
