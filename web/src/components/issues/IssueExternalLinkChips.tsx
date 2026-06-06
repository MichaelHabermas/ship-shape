// Read-only external link chips for issue properties (GitLab MR, etc.).
import type { PublicIssueExternalLink } from '@ship/shared';

interface IssueExternalLinkChipsProps {
  links: PublicIssueExternalLink[];
}

export function IssueExternalLinkChips({ links }: IssueExternalLinkChipsProps) {
  if (links.length === 0) return null;

  return (
    <ul className="flex flex-col gap-2">
      {links.map((link) => (
        <li key={`${link.provider}:${link.external_id}`}>
          <a
            href={link.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-full flex-wrap items-center gap-2 rounded border border-border bg-surface px-2 py-1 text-xs text-accent hover:bg-accent/10"
          >
            <span className="rounded bg-muted/30 px-1.5 py-0.5 font-medium uppercase tracking-wide text-muted">
              {link.provider}
            </span>
            <span className="truncate font-medium text-foreground">{link.title}</span>
            {link.status ? (
              <span className="text-muted">({link.status})</span>
            ) : null}
          </a>
        </li>
      ))}
    </ul>
  );
}
