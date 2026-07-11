import { useState } from "react";
import {
  countModelMatches,
  modelSearchError,
  replaceAllInModel,
  replaceFirstInModel,
} from "@/features/documentEditor/shared/search";

export function useDocumentEditorSearch(
  model: unknown,
  commitModel: (model: unknown) => void,
) {
  const [findPanelOpen, setFindPanelOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replaceValue, setReplaceValue] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regexSearch, setRegexSearch] = useState(false);
  const options = { query: findQuery, matchCase, wholeWord, regexSearch };
  const matchCount = countModelMatches(model, options);
  const searchError = modelSearchError(options);

  function replaceFirst() {
    const result = replaceFirstInModel(model, {
      ...options,
      replacement: replaceValue,
    });
    if (result.replacements > 0) commitModel(result.model);
  }

  function replaceAll() {
    const result = replaceAllInModel(model, {
      ...options,
      replacement: replaceValue,
    });
    if (result.replacements > 0) commitModel(result.model);
  }

  return {
    findPanelOpen,
    findQuery,
    replaceValue,
    matchCase,
    wholeWord,
    regexSearch,
    matchCount,
    searchError,
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
