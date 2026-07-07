import { useEffect, useRef, useState } from "react";
import {
  editorCommandsForKind,
  matchesEditorShortcut,
  type EditorCommandId,
  type EditorCommandRequest,
} from "@/features/documentEditor/commands";
import { useEditorKeymap } from "@/features/documentEditor/fonts";
import { stableJson } from "@/features/documentEditor/models";
import {
  countModelMatches,
  replaceAllInModel,
  replaceFirstInModel,
} from "@/features/documentEditor/search";
import { useWriteDocumentEditorModel } from "@/features/documentEditor/api";
import { drivePackageUrl } from "@/features/drive/api";
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
  const keymapEntries = keymap.data?.shortcuts ?? [];
  const rootRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<unknown>(() => data.model);
  const [baseKey, setBaseKey] = useState(() => stableJson(data.model));
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
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
  const dirty = draftKey !== baseKey;
  const matchCount = countModelMatches(draft, {
    query: findQuery,
    matchCase,
  });

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  function commitDraft(next: unknown) {
    if (stableJson(next) === stableJson(draft)) return;
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
    const saved = await writeModel.mutateAsync({
      path: data.path,
      editorKind: data.editorKind,
      model: draft,
      expectedFingerprint: data.fingerprint,
    });
    setDraft(saved.model);
    setBaseKey(stableJson(saved.model));
    setLastSavedAt(new Date().toLocaleTimeString());
    return true;
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
    saveError: writeModel.isError,
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

