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
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState("");
  const [findPanelOpen, setFindPanelOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replaceValue, setReplaceValue] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [editorCommandRequest, setEditorCommandRequest] =
    useState<EditorCommandRequest | null>(null);
  const [history, setHistory] = useState<{ past: unknown[]; future: unknown[] }>({
    past: [],
    future: [],
  });
  const draftKey = stableJson(draft);
  const latestDraftKeyRef = useRef(draftKey);
  latestDraftKeyRef.current = draftKey;
  const dirty = draftKey !== baseKey;
  const matchCount = countModelMatches(draft, {
    query: findQuery,
    matchCase,
  });
  const runAutosave = useEffectEvent(() => {
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

  function commitDraft(next: unknown) {
    if (stableJson(next) === stableJson(draft)) return;
    setSaveConflict(false);
    writeModel.reset();
    setHistory((current) => ({
      past: [...current.past, draft].slice(-100),
      future: [],
    }));
    setDraft(next);
  }

  function undo() {
    const previous = history.past.at(-1);
    if (previous === undefined) return;
    setHistory({
      past: history.past.slice(0, -1),
      future: [draft, ...history.future].slice(0, 100),
    });
    setDraft(previous);
  }

  function redo() {
    const next = history.future[0];
    if (next === undefined) return;
    setHistory({
      past: [...history.past, draft].slice(-100),
      future: history.future.slice(1),
    });
    setDraft(next);
  }

  function replaceFirst() {
    const result = replaceFirstInModel(draft, {
      query: findQuery,
      replacement: replaceValue,
      matchCase,
    });
    if (result.replacements > 0) commitDraft(result.model);
  }

  function replaceAll() {
    const result = replaceAllInModel(draft, {
      query: findQuery,
      replacement: replaceValue,
      matchCase,
    });
    if (result.replacements > 0) commitDraft(result.model);
  }

  async function save() {
    if (writeModel.isPending) return false;
    if (!dirty) return true;
    const savingDraftKey = draftKey;
    setSaveConflict(false);
    writeModel.reset();
    try {
      const saved = await writeModel.mutateAsync({
        path: data.path,
        editorKind: data.editorKind,
        model: draft,
        expectedFingerprint: fingerprint,
        syncQuery: false,
      });
      const savedKey = stableJson(saved.model);
      setSaveConflict(false);
      setFingerprint(saved.fingerprint);
      setBaseKey(savedKey);
      setLastSavedAt(new Date().toLocaleTimeString());
      if (latestDraftKeyRef.current === savingDraftKey) {
        setDraft(saved.model);
        return true;
      }
      return false;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setSaveConflict(true);
        return false;
      }
      setSaveConflict(false);
      return false;
    }
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
    dirty,
    lastSavedAt,
    isSaving: writeModel.isPending,
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
    replaceFirst,
    replaceAll,
  };
}
