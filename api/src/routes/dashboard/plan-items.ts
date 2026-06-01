import { extractPlanItemsFromContent } from '@ship/shared';

export interface PlanItem {
  text: string;
  checked: boolean;
}

export function extractPlanItems(content: unknown): PlanItem[] {
  return extractPlanItemsFromContent(content, {
    includeParagraphs: false,
    withChecked: true,
  });
}
