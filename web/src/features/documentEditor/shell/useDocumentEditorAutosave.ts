import { useEffect, useEffectEvent, useRef, useState } from "react";

interface DocumentEditorAutosaveOptions {
  enabled: boolean;
  delayMs: number;
  dirty: boolean;
  draftKey: string;
  savePending: boolean;
  saveConflict: boolean;
  onSave: () => void;
}

/** Coordinates delayed autosave and one explicit save queued behind a request. */
export function useDocumentEditorAutosave({
  enabled,
  delayMs,
  dirty,
  draftKey,
  savePending,
  saveConflict,
  onSave,
}: DocumentEditorAutosaveOptions) {
  const queuedRef = useRef(false);
  const [queued, setQueued] = useState(false);
  const runSave = useEffectEvent(onSave);

  function queue() {
    queuedRef.current = true;
    setQueued(true);
  }

  function clear() {
    queuedRef.current = false;
    setQueued(false);
  }

  const runQueuedSave = useEffectEvent(() => {
    if (!queuedRef.current || savePending || saveConflict || !dirty) return;
    clear();
    runSave();
  });

  useEffect(() => {
    if (!enabled || !dirty || savePending || saveConflict) return;
    const timer = window.setTimeout(runSave, delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, dirty, draftKey, enabled, saveConflict, savePending]);

  useEffect(() => {
    runQueuedSave();
  }, [dirty, draftKey, saveConflict, savePending]);

  return { queued, queuedRef, queue, clear };
}
