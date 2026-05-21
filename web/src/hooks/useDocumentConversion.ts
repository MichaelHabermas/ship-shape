import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { apiPost } from '@/lib/api';
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
      const res = await apiPost(`/api/documents/${documentId}/convert`, { target_type: targetType });

      if (res.ok) {
        const data = await res.json();

        // Invalidate caches - document stays same ID with in-place conversion
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: issueKeys.lists() }),
          queryClient.invalidateQueries({ queryKey: projectKeys.lists() }),
          queryClient.invalidateQueries({ queryKey: ['document', documentId] }),
        ]);

        if (navigateAfterConvert) {
          // Use unified document route - ID stays same with in-place conversion
          navigate(`/documents/${data.id}`, { replace: true });
        }

        onSuccess?.(data.id);
        return data as ConversionResult;
      } else {
        const error = await res.json();
        const errorMessage = error.error || `Failed to convert ${sourceType} to ${targetType}`;
        console.error(`Failed to convert ${sourceType}:`, error);
        showToast(errorMessage, 'error');
        onError?.(errorMessage);
        return null;
      }
    } catch (err) {
      const errorMessage = `Failed to convert ${sourceType} to ${targetType}`;
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
      const res = await apiPost(`/api/documents/${documentId}/undo-conversion`, {});

      if (res.ok) {
        const data = await res.json();

        // Invalidate caches - document restores to previous type in-place
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: issueKeys.lists() }),
          queryClient.invalidateQueries({ queryKey: projectKeys.lists() }),
          queryClient.invalidateQueries({ queryKey: ['document', documentId] }),
        ]);

        if (navigateAfterConvert) {
          // Use unified document route - ID stays same with in-place restoration
          navigate(`/documents/${data.id}`, { replace: true });
        }

        onSuccess?.(data.id);
        return data as ConversionResult;
      } else {
        const error = await res.json();
        const errorMessage = error.error || 'Failed to undo conversion';
        console.error('Failed to undo conversion:', error);
        showToast(errorMessage, 'error');
        onError?.(errorMessage);
        return null;
      }
    } catch (err) {
      const errorMessage = 'Failed to undo conversion';
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
