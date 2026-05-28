// Shared compact label chip for notification and chat attention states.
type NotificationSignalType = 'blocked' | 'stale' | 'at_risk';

const signalChipClassNames: Record<NotificationSignalType, string> = {
  blocked: 'border-[#1f6fae]/50 bg-[#0f2f49] text-[#8dccff]',
  stale: 'border-[#8a6f1d]/60 bg-[#332a0f] text-[#f5d36b]',
  at_risk: 'border-[#9b3a25]/60 bg-[#3b1711] text-[#ff9c7a]',
};

export function NotificationLabelChip({
  label,
  signalType = 'blocked',
}: {
  label: string;
  signalType?: NotificationSignalType;
}) {
  return (
    <span className={`inline-flex max-w-[72px] shrink-0 items-center truncate rounded border px-1.5 py-0.5 text-[11px] font-medium leading-4 ${signalChipClassNames[signalType]}`}>
      {label}
    </span>
  );
}
