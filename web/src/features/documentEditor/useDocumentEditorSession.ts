import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  editorCommandsForKind,
  matchesEditorShortcut,
  type EditorCommandId,
  type EditorCommandRequest,
} from "@/features/documentEditor/commands";
import {
  useEditorKeymap,
  useEditorPreferences,
} from "@/features/documentEditor/fonts";
import { stableJson } from "@/features/documentEditor/models";
import {
  countModelMatches,
  replaceAllInModel,
  replaceFirstInModel,
} from "@/features/documentEditor/search";
import { useWriteDocumentEditorModel } from "@/features/documentEditor/api";
import { drivePackageUrl } from "@/features/drive/api";
import { ApiError } from "@/lib/api";
import type { DocumentEditorModelResponse } from "@/types/documentEditor";

const MAX_HISTORY_ENTRIES = 100;
const MAX_HISTORY_BYTES = 5_000_000;

interface HistoryEntry {
  model: unknown;
  key: string;
  size: number;
}

interface EditorHistory {
  past: HistoryEntry[];
  future: HistoryEntry[];
}

export function useDocumentEditorSession({
  data,
  onDirtyChange,
}: {
  data: DocumentEditorModelResponse;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const writeModel = useWriteDocumentEditorModel();
  const keymap = useEditorKeymap();
  const preferences = useEditorPreferences();
  const keymapEntries = keymap.data?.shortcuts ?? [];
  const autosaveEnabled = preferences.data?.preferences.autosaveEnabled === true;
  const autosaveDelayMs = preferences.data?.preferences.autosaveDelayMs ?? 5_000;
  const rootRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<unknown>(() => data.model);
  const [baseKey, setBaseKey] = useState(() => stableJson(data.model));
  const [fingerprint, setFingerprint] = useState(() => data.fingerprint);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [saveConflict, setSaveConflict] = useState(false);
  const [saveQueued, setSaveQueued] = useState(false);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState("");
  const [findPanelOpen, setFindPanelOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replaceValue, setReplaceValue] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regexSearch, setRegexSearch] = useState(false);
  const [editorCommandRequest, setEditorCommandRequest] =
    useState<EditorCommandRequest | null>(null);
  const [history, setHistory] = useState<EditorHistory>({
    past: [],
    future: [],
  });
  const draftKey = stableJson(draft);
  const latestDraftRef = useRef(draft);
  const latestDraftKeyRef = useRef(draftKey);
  const saveQueuedRef = useRef(false);
  latestDraftRef.current = draft;
  latestDraftKeyRef.current = draftKey;
  const dirty = draftKey !== baseKey;
  const matchCount = countModelMatches(draft, {
    query: findQuery,
    matchCase,
    wholeWord,
    regexSearch,
  });
  const runAutosave = useEffectEvent(() => {
    void save();
  });
  const runQueuedSave = useEffectEvent(() => {
    if (!saveQueuedRef.current || writeModel.isPending || saveConflict) return;
    saveQueuedRef.current = false;
    setSaveQueued(false);
    void save();
  });

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!autosaveEnabled || !dirty || writeModel.isPending || saveConflict) return;
    const timer = window.setTimeout(() => {
      runAutosave();
    }, autosaveDelayMs);
    return () => window.clearTimeout(timer);
  }, [
    autosaveDelayMs,
    autosaveEnabled,
    dirty,
    draftKey,
    saveConflict,
    writeModel.isPending,
  ]);

  useEffect(() => {
    if (writeModel.isPending || !dirty || saveConflict) return;
    runQueuedSave();
  }, [dirty, draftKey, saveConflict, writeModel.isPending]);

  function commitDraft(next: unknown) {
    const nextKey = stableJson(next);
    if (nextKey === draftKey) return;
    setSaveConflict(false);
    writeModel.reset();
    if (writeModel.isPending) queueSave();
    setHistory((current) => ({
      past: trimHistoryEntries([...current.past, historyEntry(draft, draftKey)]),
      future: [],
    }));
    setDraft(next);
  }

  function undo() {
    const previous = history.past.at(-1);
    if (previous === undefined) return;
    setHistory({
      past: history.past.slice(0, -1),
      future: trimHistoryEntries(
        [historyEntry(draft, draftKey), ...history.future],
        "start",
      ),
    });
    setDraft(previous.model);
  }

  function redo() {
    const next = history.future[0];
    if (next === undefined) return;
    setHistory({
      past: trimHistoryEntries([...history.past, historyEntry(draft, draftKey)]),
      future: history.future.slice(1),
    });
    setDraft(next.model);
  }

  function replaceFirst() {
    const result = replaceFirstInModel(draft, {
      query: findQuery,
      replacement: replaceValue,
      matchCase,
      wholeWord,
      regexSearch,
    });
    if (result.replacements > 0) commitDraft(result.model);
  }

  function replaceAll() {
    const result = replaceAllInModel(draft, {
      query: findQuery,
      replacement: replaceValue,
      matchCase,
      wholeWord,
      regexSearch,
    });
    if (result.replacements > 0) commitDraft(result.model);
  }

  async function save() {
    if (writeModel.isPending) {
      if (dirty) queueSave();
      return false;
    }
    if (!dirty) return true;
    const savingDraftKey = draftKey;
    const savingDraft = latestDraftRef.current;
    setSaveConflict(false);
    writeModel.reset();
    try {
      const saved = await writeModel.mutateAsync({
        path: data.path,
        editorKind: data.editorKind,
        model: savingDraft,
        expectedFingerprint: fingerprint,
        syncQuery: false,
      });
      const savedKey = stableJson(saved.model);
      setSaveConflict(false);
      setSaveQueued(false);
      setFingerprint(saved.fingerprint);
      setBaseKey(savedKey);
      setLastSavedAt(new Date().toLocaleTimeString());
      if (latestDraftKeyRef.current === savingDraftKey) {
        setDraft(saved.model);
        return true;
      }
      queueSave();
      return false;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setSaveConflict(true);
        setSaveQueued(false);
        return false;
      }
      setSaveConflict(false);
      setSaveQueued(false);
      return false;
    }
  }

  function queueSave() {
    saveQueuedRef.current = true;
    setSaveQueued(true);
  }

  async function downloadPackage() {
    if (writeModel.isPending) return;
    const saved = await save();
    if (!saved) return;
    window.location.assign(drivePackageUrl(data.path));
  }

  function openCommandPalette() {
    setCommandPaletteQuery("");
    setCommandPaletteOpen(true);
  }

  function runShellCommand(commandId: EditorCommandId) {
    setCommandPaletteOpen(false);
    const command = editorCommandsForKind(data.editorKind, keymapEntries).find(
      (item) => item.id === commandId,
    );
    if (command && !command.handledByShell) {
      setEditorCommandRequest({ id: commandId, token: Date.now() + Math.random() });
      return;
    }
    if (commandId === "save") {
      void save();
      return;
    }
    if (commandId === "downloadPackage") {
      void downloadPackage();
      return;
    }
    if (commandId === "undo") {
      undo();
      return;
    }
    if (commandId === "redo") {
      redo();
      return;
    }
    if (commandId === "find" || commandId === "replace") {
      setFindPanelOpen(true);
      return;
    }
    if (commandId === "shortcuts") {
      setShortcutHelpOpen((current) => !current);
      return;
    }
    if (commandId === "commandPalette") {
      openCommandPalette();
    }
  }

  function clearEditorCommandRequest(request: EditorCommandRequest) {
    setEditorCommandRequest((current) =>
      current?.token === request.token ? null : current,
    );
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      const target = event.target;
      if (!(target instanceof Node) || !rootRef.current?.contains(target)) return;
      const command = editorCommandsForKind(data.editorKind, keymapEntries).find((item) =>
        matchesEditorShortcut(event, item),
      );
      if (!command) return;
      event.preventDefault();
      runShellCommand(command.id);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  return {
    rootRef,
    draft,
    fingerprint,
    dirty,
    lastSavedAt,
    isSaving: writeModel.isPending,
    isSaveQueued: saveQueued,
    saveError: writeModel.isError && !saveConflict,
    saveConflict,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    keymapEntries,
    shortcutHelpOpen,
    commandPaletteOpen,
    commandPaletteQuery,
    findPanelOpen,
    findQuery,
    replaceValue,
    matchCase,
    wholeWord,
    regexSearch,
    matchCount,
    editorCommandRequest,
    commitDraft,
    undo,
    redo,
    save,
    downloadPackage,
    openCommandPalette,
    runShellCommand,
    clearEditorCommandRequest,
    setShortcutHelpOpen,
    setCommandPaletteOpen,
    setCommandPaletteQuery,
    setFindPanelOpen,
    setFindQuery,
    setReplaceValue,
    setMatchCase,
    setWholeWord,
    setRegexSearch,
    replaceFirst,
    replaceAll,
  };
}

function historyEntry(model: unknown, key = stableJson(model)): HistoryEntry {
  return { model, key, size: key.length };
}

function trimHistoryEntries(
  entries: HistoryEntry[],
  keep: "end" | "start" = "end",
) {
  const next =
    keep === "end"
      ? entries.slice(-MAX_HISTORY_ENTRIES)
      : entries.slice(0, MAX_HISTORY_ENTRIES);
  let totalSize = next.reduce((sum, entry) => sum + entry.size, 0);
  while (next.length > 1 && totalSize > MAX_HISTORY_BYTES) {
    const removed = keep === "end" ? next.shift() : next.pop();
    totalSize -= removed?.size ?? 0;
  }
  return next;
}
