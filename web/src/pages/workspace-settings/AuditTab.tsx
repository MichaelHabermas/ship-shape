import type { AuditLogResponse } from '@ship/shared';

export function AuditTab({ auditLogs }: { auditLogs: AuditLogResponse[] }) {
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <table className="w-full">
        <thead className="bg-border/30">
          <tr>
            <th className="px-4 py-3 text-left text-sm font-medium text-muted">Time</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-muted">Actor</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-muted">Action</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-muted">Resource</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {auditLogs.map((log) => (
            <tr key={log.id}>
              <td className="px-4 py-3 text-sm text-muted whitespace-nowrap">
                {new Date(log.createdAt).toLocaleString()}
              </td>
              <td className="px-4 py-3 text-sm text-foreground">
                {log.actorName || log.actorEmail}
              </td>
              <td className="px-4 py-3 text-sm text-muted">{log.action}</td>
              <td className="px-4 py-3 text-sm text-muted">
                {log.resourceType ? `${log.resourceType}:${log.resourceId?.slice(0, 8)}...` : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
