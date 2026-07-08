import { useEffect, useMemo, useState } from "react";
import {
  createJsonSchemaRegistryEntry,
  jsonSchemaParseError,
  loadJsonSchemaRegistry,
  saveJsonSchemaRegistry,
  schemaNameFromPath,
  updateJsonSchemaRegistryEntry,
} from "./textSchemaRegistry";

export function useJsonSchemaRegistryControls(filePath: string) {
  const [schemaDraft, setSchemaDraft] = useState("");
  const [schemaNameDraft, setSchemaNameDraft] = useState(() =>
    schemaNameFromPath(filePath),
  );
  const [schemaRegistry, setSchemaRegistry] = useState(loadJsonSchemaRegistry);
  const [selectedSchemaId, setSelectedSchemaId] = useState("");
  const schemaDraftError = useMemo(
    () => jsonSchemaParseError(schemaDraft),
    [schemaDraft],
  );
  const selectedSchema = useMemo(
    () => schemaRegistry.find((entry) => entry.id === selectedSchemaId),
    [schemaRegistry, selectedSchemaId],
  );

  useEffect(() => {
    saveJsonSchemaRegistry(schemaRegistry);
  }, [schemaRegistry]);

  function selectSchema(schemaId: string) {
    setSelectedSchemaId(schemaId);
    const entry = schemaRegistry.find((candidate) => candidate.id === schemaId);
    if (!entry) {
      setSchemaDraft("");
      setSchemaNameDraft(schemaNameFromPath(filePath));
      return;
    }
    setSchemaDraft(entry.schema);
    setSchemaNameDraft(entry.name);
  }

  function startNewSchema() {
    setSelectedSchemaId("");
    setSchemaDraft("");
    setSchemaNameDraft(schemaNameFromPath(filePath));
  }

  function saveCurrentSchema() {
    if (!schemaDraft.trim() || schemaDraftError) return;
    if (selectedSchema) {
      const updated = updateJsonSchemaRegistryEntry(
        selectedSchema,
        schemaNameDraft,
        schemaDraft,
      );
      setSchemaRegistry((current) =>
        current
          .map((entry) => (entry.id === updated.id ? updated : entry))
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
      );
      setSchemaNameDraft(updated.name);
      return;
    }
    const created = createJsonSchemaRegistryEntry(schemaNameDraft, schemaDraft);
    setSchemaRegistry((current) => [created, ...current]);
    setSelectedSchemaId(created.id);
    setSchemaNameDraft(created.name);
  }

  function deleteSelectedSchema() {
    if (!selectedSchema) return;
    setSchemaRegistry((current) =>
      current.filter((entry) => entry.id !== selectedSchema.id),
    );
    startNewSchema();
  }

  return {
    deleteSelectedSchema,
    saveCurrentSchema,
    schemaDraft,
    schemaDraftError,
    schemaNameDraft,
    schemaRegistry,
    selectSchema,
    selectedSchema,
    selectedSchemaId,
    setSchemaDraft,
    setSchemaNameDraft,
    startNewSchema,
  };
}
