/** Renders TipTap JSON content as simple HTML */
export function TipTapContent({ content }: { content: unknown }) {
  if (!content || typeof content !== 'object') {
    return <p className="text-sm text-muted italic">Empty</p>;
  }

  const doc = content as { type?: string; content?: unknown[] };
  if (!doc.content || !Array.isArray(doc.content)) {
    return <p className="text-sm text-muted italic">Empty</p>;
  }

  return (
    <div className="text-sm text-foreground space-y-2">
      {doc.content.map((node, i) => (
        <TipTapNode key={i} node={node} />
      ))}
    </div>
  );
}

function TipTapNode({ node }: { node: unknown }) {
  if (!node || typeof node !== 'object') return null;
  const n = node as { type?: string; content?: unknown[]; text?: string; attrs?: Record<string, unknown>; marks?: Array<{ type: string }> };

  if (n.type === 'text') {
    let text = <>{n.text}</>;
    if (n.marks) {
      for (const mark of n.marks) {
        if (mark.type === 'bold') text = <strong>{text}</strong>;
        if (mark.type === 'italic') text = <em>{text}</em>;
      }
    }
    return text;
  }

  const children = n.content?.map((child, i) => <TipTapNode key={i} node={child} />) ?? null;

  switch (n.type) {
    case 'heading': {
      const level = (n.attrs?.level as number) || 2;
      if (level === 1) return <h3 className="text-base font-semibold text-foreground">{children}</h3>;
      if (level === 2) return <h4 className="text-sm font-semibold text-foreground">{children}</h4>;
      return <h5 className="text-sm font-medium text-foreground">{children}</h5>;
    }
    case 'paragraph':
      return <p className="text-sm leading-relaxed">{children || '\u00A0'}</p>;
    case 'bulletList':
      return <ul className="list-disc pl-5 space-y-1">{children}</ul>;
    case 'listItem':
      return <li className="text-sm">{children}</li>;
    case 'blockquote':
      return <blockquote className="border-l-2 border-accent/50 pl-3 text-sm italic text-muted">{children}</blockquote>;
    default:
      return <div>{children}</div>;
  }
}