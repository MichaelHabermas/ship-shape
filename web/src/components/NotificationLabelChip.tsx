// Shared compact label chip for notification and chat attention states.
export function NotificationLabelChip({ label }: { label: string }) {
  return (
    <span className="inline-flex max-w-[72px] shrink-0 items-center truncate rounded border border-[#1f6fae]/50 bg-[#0f2f49] px-1.5 py-0.5 text-[11px] font-medium leading-4 text-[#8dccff]">
      {label}
    </span>
  );
}
