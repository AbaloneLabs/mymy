import { FilePlus, Save, Trash2 } from "lucide-react";
import type { JsonSchemaRegistryEntry } from "./textSchemaRegistry";
import { toolbarTextButtonClass } from "./textEditorChromeClasses";

type TextEditorSchemaPanelProps = {
  schemaDiagnosticsCount: number;
  schemaDraft: string;
  schemaDraftError: string | null;
  schemaNameDraft: string;
  schemaRegistry: JsonSchemaRegistryEntry[];
  selectedSchema?: JsonSchemaRegistryEntry;
  selectedSchemaId: string;
  onDeleteSelectedSchema: () => void;
  onSaveCurrentSchema: () => void;
  onSchemaDraftChange: (value: string) => void;
  onSchemaNameDraftChange: (value: string) => void;
  onSelectSchema: (schemaId: string) => void;
  onStartNewSchema: () => void;
};

export function TextEditorSchemaPanel({
  schemaDiagnosticsCount,
  schemaDraft,
  schemaDraftError,
  schemaNameDraft,
  schemaRegistry,
  selectedSchema,
  selectedSchemaId,
  onDeleteSelectedSchema,
  onSaveCurrentSchema,
  onSchemaDraftChange,
  onSchemaNameDraftChange,
  onSelectSchema,
  onStartNewSchema,
}: TextEditorSchemaPanelProps) {
  return (
    <div className="grid shrink-0 gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2 lg:grid-cols-[220px_minmax(0,1fr)_minmax(180px,260px)]">
      <div className="grid gap-2 rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 text-xs">
        <select
          value={selectedSchemaId}
          onChange={(event) => onSelectSchema(event.currentTarget.value)}
          className="h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
        >
          <option value="">Unsaved schema</option>
          {schemaRegistry.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
        <input
          value={schemaNameDraft}
          onChange={(event) => onSchemaNameDraftChange(event.currentTarget.value)}
          className="h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          placeholder="Schema name"
        />
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={onStartNewSchema}
            className={toolbarTextButtonClass(false)}
          >
            <FilePlus className="h-3.5 w-3.5" strokeWidth={1.75} />
            New
          </button>
          <button
            type="button"
            onClick={onSaveCurrentSchema}
            disabled={!schemaDraft.trim() || Boolean(schemaDraftError)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Save className="h-3.5 w-3.5" strokeWidth={1.75} />
            Save
          </button>
          <button
            type="button"
            onClick={onDeleteSelectedSchema}
            disabled={!selectedSchema}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
            Delete
          </button>
        </div>
      </div>
      <textarea
        value={schemaDraft}
        onChange={(event) => onSchemaDraftChange(event.currentTarget.value)}
        placeholder="JSON Schema"
        spellCheck={false}
        className="h-24 min-h-0 resize-y rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 font-mono text-xs leading-5 text-[var(--text)] outline-none focus:border-[var(--accent)]"
      />
      <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 text-xs text-[var(--text-muted)]">
        <div className="font-medium text-[var(--text)]">JSON Schema</div>
        <div className="mt-1 text-[var(--text-faint)]">
          type, required, properties, items, enum
        </div>
        {schemaDraftError ? (
          <div className="mt-2 text-[var(--status-error)]">{schemaDraftError}</div>
        ) : schemaDraft.trim() ? (
          <div className="mt-2 text-[var(--text-faint)]">
            {schemaDiagnosticsCount} schema issues
          </div>
        ) : (
          <div className="mt-2 text-[var(--text-faint)]">
            {schemaRegistry.length} saved schemas
          </div>
        )}
        {selectedSchema && (
          <div className="mt-2 text-[var(--text-faint)]">
            Updated {new Date(selectedSchema.updatedAt).toLocaleString()}
          </div>
        )}
      </div>
    </div>
  );
}
