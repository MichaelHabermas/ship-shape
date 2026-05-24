function escapeInline(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatInline(text) {
  return escapeInline(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

export function markdownToHtml(markdown) {
  if (!markdown) return '';
  const lines = String(markdown).split('\n');
  const out = [];
  let inList = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
      continue;
    }
    if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
      out.push(`<p><strong>${escapeInline(trimmed.slice(2, -2))}</strong></p>`);
      continue;
    }
    if (trimmed.startsWith('- ')) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${formatInline(trimmed.slice(2))}</li>`);
      continue;
    }
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
    out.push(`<p>${formatInline(trimmed)}</p>`);
  }
  if (inList) out.push('</ul>');
  return out.join('');
}
