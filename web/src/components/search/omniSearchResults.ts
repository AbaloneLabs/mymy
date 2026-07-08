import type {
  SearchResultEvent,
  SearchResultKnowledge,
  SearchResultMessage,
  SearchResultNote,
  SearchResultProject,
  SearchResultTask,
  SearchResults,
} from "@/types/search";

export type FlatSearchResult =
  | { type: "note"; item: SearchResultNote }
  | { type: "task"; item: SearchResultTask }
  | { type: "project"; item: SearchResultProject }
  | { type: "event"; item: SearchResultEvent }
  | { type: "message"; item: SearchResultMessage }
  | { type: "knowledge"; item: SearchResultKnowledge };

export function flattenSearchResults(results: SearchResults): FlatSearchResult[] {
  return [
    ...results.notes.map((item) => ({ type: "note" as const, item })),
    ...results.tasks.map((item) => ({ type: "task" as const, item })),
    ...results.projects.map((item) => ({ type: "project" as const, item })),
    ...results.events.map((item) => ({ type: "event" as const, item })),
    ...results.messages.map((item) => ({ type: "message" as const, item })),
    ...results.knowledge.map((item) => ({ type: "knowledge" as const, item })),
  ];
}

export function findFlatSearchResultIndex(
  results: FlatSearchResult[],
  target: FlatSearchResult,
) {
  return results.findIndex(
    (result) => result.type === target.type && result.item.id === target.item.id,
  );
}
