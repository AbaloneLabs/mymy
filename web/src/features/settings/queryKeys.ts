/** Stable cache identities owned by the settings feature facade. */
export const settingsQueryKeys = {
  root: ["settings"] as const,
  security: ["settings", "security"] as const,
  quarantine: ["settings", "security", "quarantine"] as const,
  pendingQuarantine: [
    "settings",
    "security",
    "quarantine",
    "pending",
  ] as const,
};
