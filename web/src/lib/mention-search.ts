import type { MentionSearchResult } from '@/api/schemas';
import type { MentionItem } from '@/components/editor/MentionList';
import { apiGetJson } from '@/lib/api';

function mapMentionSearchToItems(data: MentionSearchResult): MentionItem[] {
  const items: MentionItem[] = [];

  for (const person of data.people) {
    items.push({
      id: person.id,
      label: person.name,
      type: 'person',
    });
  }

  for (const doc of data.documents) {
    items.push({
      id: doc.id,
      label: doc.title,
      type: 'document',
      documentType: doc.document_type,
    });
  }

  return items;
}

export async function fetchMentionSuggestions(query: string): Promise<MentionItem[]> {
  try {
    const data = await apiGetJson<MentionSearchResult>(
      `/api/search/mentions?q=${encodeURIComponent(query)}`,
      'Failed to fetch mention suggestions'
    );
    return mapMentionSearchToItems(data);
  } catch (error) {
    console.error('Error fetching mention suggestions:', error);
    return [];
  }
}

export async function fetchWikiDocumentsForEmbed(
  query: string
): Promise<Array<{ id: string; title: string }>> {
  try {
    const data = await apiGetJson<MentionSearchResult>(
      `/api/search/mentions?q=${encodeURIComponent(query)}`,
      'Failed to fetch documents for embed'
    );
    return data.documents
      .filter((doc) => doc.document_type === 'wiki')
      .map((doc) => ({ id: doc.id, title: doc.title || 'Untitled' }));
  } catch (error) {
    console.error('Error fetching documents for embed:', error);
    return [];
  }
}
