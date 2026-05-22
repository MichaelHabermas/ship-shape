import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { apiPostJson } from '@/lib/api';
import type { Document, LegacyErrorResponse } from '@/api/schemas';
import { issueKeys } from '@/hooks/useIssuesQuery';
import { projectKeys } from '@/hooks/useProjectsQuery';
import { useToast } from '@/components/ui/Toast';

export type DocumentType = 'issue' | 'project';

interface UseDocumentConversionOptions {
  /** Navigate to the converted document after conversion */
  navigateAfterConvert?: boolean;
  /** Callback after successful conversion */
  onSuccess?: (convertedId: string) => void;
  /** Callback after conversion failure */
  onError?: (error: string) => void;
}

interface ConversionResult {
  id: string;
  document_type: string;
  title: string;
}

function conversionFromDocument(doc: Document): ConversionResult {
  return {
    id: doc.id,
    document_type: doc.document_type,
    title: doc.title,
  };
}

function errorMessageFromResponse(error: LegacyErrorResponse, fallback: string): string {
  return typeof error.error === 'string' ? error.error : fallback;
}

export function useDocumentConversion(options: UseDocumentConversionOptions = {}) {
  const { navigateAfterConvert = true, onSuccess, onError } = options;
  const [isConverting, setIsConverting] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const convert = useCallback(async (
    documentId: string,
    sourceType: DocumentType,
    _documentTitle: string
  ): Promise<ConversionResult | null> => {
    setIsConverting(true);
    const targetType = sourceType === 'issue' ? 'project' : 'issue';

    try {
      const data = await apiPostJson<Document>(
        `/api/documents/${documentId}/convert`,
        { target_type: targetType },
        `Failed to convert ${sourceType} to ${targetType}`
      );

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: issueKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: projectKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: ['document', documentId] }),
      ]);

      const result = conversionFromDocument(data);

      if (navigateAfterConvert) {
        navigate(`/documents/${result.id}`, { replace: true });
      }

      onSuccess?.(result.id);
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error && err.message
        ? err.message
        : `Failed to convert ${sourceType} to ${targetType}`;
      console.error(`Failed to convert ${sourceType}:`, err);
      showToast(errorMessage, 'error');
      onError?.(errorMessage);
      return null;
    } finally {
      setIsConverting(false);
    }
  }, [navigate, queryClient, showToast, navigateAfterConvert, onSuccess, onError]);

  const undoConversion = useCallback(async (
    documentId: string,
    _documentType: DocumentType
  ): Promise<ConversionResult | null> => {
    setIsConverting(true);

    try {
      const data = await apiPostJson<Document>(
        `/api/documents/${documentId}/undo-conversion`,
        {},
        'Failed to undo conversion'
      );

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: issueKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: projectKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: ['document', documentId] }),
      ]);

      const result = conversionFromDocument(data);

      if (navigateAfterConvert) {
        navigate(`/documents/${result.id}`, { replace: true });
      }

      onSuccess?.(result.id);
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error && err.message
        ? err.message
        : 'Failed to undo conversion';
      console.error('Failed to undo conversion:', err);
      showToast(errorMessage, 'error');
      onError?.(errorMessage);
      return null;
    } finally {
      setIsConverting(false);
    }
  }, [navigate, queryClient, showToast, navigateAfterConvert, onSuccess, onError]);

  return {
    convert,
    undoConversion,
    isConverting,
  };
}

// Keep helper exported for tests that assert error shape parsing
export { errorMessageFromResponse };
