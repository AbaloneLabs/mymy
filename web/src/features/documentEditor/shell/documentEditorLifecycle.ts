export type DocumentEditorLifecycleStatus =
  | "loading"
  | "clean"
  | "dirty"
  | "saving"
  | "reconciling"
  | "conflict"
  | "recovery_available"
  | "lifecycle_blocked"
  | "read_only";

/**
 * Collapse persistence signals into one user-facing state with a fixed
 * precedence. This prevents independent booleans from claiming both “saved”
 * and “conflict” or hiding a lifecycle denial behind an autosave spinner.
 */
export function documentEditorLifecycleStatus({
  loaded,
  readOnly,
  lifecycleBlocked,
  conflict,
  recoveryAvailable,
  saving,
  reconciling,
  dirty,
}: {
  loaded: boolean;
  readOnly: boolean;
  lifecycleBlocked: boolean;
  conflict: boolean;
  recoveryAvailable: boolean;
  saving: boolean;
  reconciling: boolean;
  dirty: boolean;
}): DocumentEditorLifecycleStatus {
  if (!loaded) return "loading";
  if (lifecycleBlocked) return "lifecycle_blocked";
  if (readOnly) return "read_only";
  if (conflict) return "conflict";
  if (recoveryAvailable) return "recovery_available";
  if (saving) return "saving";
  if (reconciling) return "reconciling";
  return dirty ? "dirty" : "clean";
}
