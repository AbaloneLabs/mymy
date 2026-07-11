const CHANNEL_NAME = "mymy-document-revisions-v1";

export interface DocumentEditorRevisionNotice {
  version: 1;
  path: string;
  fingerprint: string;
  sourceSessionId: string;
  actor: "browser-tab";
  savedAt: string;
}

/**
 * Notify sibling tabs after a durable save. The notice carries no document
 * content; recipients still refetch the authoritative server model and run it
 * through their own dirty-draft conflict state machine.
 */
export function publishDocumentEditorRevision(
  notice: Omit<DocumentEditorRevisionNotice, "version" | "actor" | "savedAt">,
) {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.postMessage({
    ...notice,
    version: 1,
    actor: "browser-tab",
    savedAt: new Date().toISOString(),
  } satisfies DocumentEditorRevisionNotice);
  channel.close();
}

export function subscribeToDocumentEditorRevisions(
  onNotice: (notice: DocumentEditorRevisionNotice) => void,
) {
  if (typeof BroadcastChannel === "undefined") return () => undefined;
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event: MessageEvent<unknown>) => {
    const notice = parseDocumentEditorRevisionNotice(event.data);
    if (notice) onNotice(notice);
  };
  return () => channel.close();
}

export function parseDocumentEditorRevisionNotice(
  value: unknown,
): DocumentEditorRevisionNotice | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<DocumentEditorRevisionNotice>;
  return candidate.version === 1 &&
    candidate.actor === "browser-tab" &&
    typeof candidate.path === "string" &&
    typeof candidate.fingerprint === "string" &&
    typeof candidate.sourceSessionId === "string" &&
    typeof candidate.savedAt === "string"
    ? (candidate as DocumentEditorRevisionNotice)
    : null;
}
