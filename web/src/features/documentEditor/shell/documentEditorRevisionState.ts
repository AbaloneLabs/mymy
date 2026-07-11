/**
 * Classify a server revision without mutating editor state.
 *
 * Query libraries are free to refetch on focus or reconnect. The editor must
 * therefore decide whether an incoming model may become authoritative before
 * handing it to controlled editor components. Dirty or saving sessions pin the
 * local draft and retain the server model only as an external revision.
 */
export function classifyIncomingDocumentRevision({
  acceptedFingerprint,
  incomingFingerprint,
  dirty,
  saving,
}: {
  acceptedFingerprint: string;
  incomingFingerprint: string;
  dirty: boolean;
  saving: boolean;
}): "same" | "adopt" | "pin-external" {
  if (acceptedFingerprint === incomingFingerprint) return "same";
  return dirty || saving ? "pin-external" : "adopt";
}

/**
 * A conflict overwrite is permitted only against the exact revision shown to
 * the user. Returning null keeps missing or unchanged conflict data from
 * degrading into the previous blind-overwrite behavior.
 */
export function reviewedConflictFingerprint({
  acceptedFingerprint,
  reviewedFingerprint,
}: {
  acceptedFingerprint: string;
  reviewedFingerprint?: string | null;
}) {
  if (!reviewedFingerprint || reviewedFingerprint === acceptedFingerprint) {
    return null;
  }
  return reviewedFingerprint;
}
