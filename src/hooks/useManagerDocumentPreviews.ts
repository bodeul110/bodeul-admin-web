import { useCallback, useEffect, useRef, useState } from "react";

type UseManagerDocumentPreviewsParams<TManager, TKey extends string, TPreview> = {
  selectedManager: TManager | null;
  documentKeys: readonly TKey[];
  getManagerKey: (manager: TManager) => string;
  createIdleState: () => Record<TKey, TPreview>;
  createLoadingState: () => Record<TKey, TPreview>;
  createErrorPreview: (key: TKey) => TPreview;
  resolvePreview: (manager: TManager, key: TKey) => Promise<TPreview>;
  disposePreview?: (preview: TPreview) => void;
};

export function useManagerDocumentPreviews<TManager, TKey extends string, TPreview>({
  selectedManager,
  documentKeys,
  getManagerKey,
  createIdleState,
  createLoadingState,
  createErrorPreview,
  resolvePreview,
  disposePreview,
}: UseManagerDocumentPreviewsParams<TManager, TKey, TPreview>) {
  const [loadedManagerKey, setLoadedManagerKey] = useState("");
  const [loadedPreviews, setLoadedPreviews] = useState<Record<TKey, TPreview>>(createIdleState);
  const loadedPreviewsRef = useRef<Record<TKey, TPreview> | null>(null);
  const disposePreviewRef = useRef(disposePreview);

  useEffect(() => {
    disposePreviewRef.current = disposePreview;
  }, [disposePreview]);

  const disposeState = useCallback((state: Record<TKey, TPreview> | null): void => {
    if (!state || !disposePreviewRef.current) return;
    Object.values(state).forEach((preview) => disposePreviewRef.current?.(preview as TPreview));
  }, []);

  useEffect(() => {
    let cancelled = false;

    disposeState(loadedPreviewsRef.current);
    loadedPreviewsRef.current = null;

    if (!selectedManager) {
      return () => {
        cancelled = true;
      };
    }
    const managerKey = getManagerKey(selectedManager);

    void Promise.allSettled(
      documentKeys.map(async (documentKey) => ({
        key: documentKey,
        preview: await resolvePreview(selectedManager, documentKey),
      })),
    ).then((results) => {
      const nextState = createIdleState();
      results.forEach((result, index) => {
        const key = documentKeys[index];
        if (result.status === "fulfilled") {
          nextState[key] = result.value.preview;
          return;
        }
        nextState[key] = createErrorPreview(key);
      });
      if (cancelled) {
        disposeState(nextState);
        return;
      }
      loadedPreviewsRef.current = nextState;
      setLoadedPreviews(nextState);
      setLoadedManagerKey(managerKey);
    }).catch(() => {
      if (cancelled) {
        return;
      }
      const nextState = createIdleState();
      documentKeys.forEach((key) => {
        nextState[key] = createErrorPreview(key);
      });
      loadedPreviewsRef.current = nextState;
      setLoadedPreviews(nextState);
      setLoadedManagerKey(managerKey);
    });

    return () => {
      cancelled = true;
    };
  }, [
    createErrorPreview,
    createIdleState,
    createLoadingState,
    disposeState,
    documentKeys,
    getManagerKey,
    resolvePreview,
    selectedManager,
  ]);

  useEffect(() => () => {
    disposeState(loadedPreviewsRef.current);
    loadedPreviewsRef.current = null;
  }, [disposeState]);

  if (!selectedManager) {
    return createIdleState();
  }
  if (loadedManagerKey !== getManagerKey(selectedManager)) {
    return createLoadingState();
  }
  return loadedPreviews;
}
