import { useRef, useState } from "react";
import { createUuid } from "@/lib/uuid";
import type { QueuedChatTurn } from "../shared/types";

export function createQueuedTurnId() {
  return createUuid();
}

export function useQueuedChatTurns() {
  const [queuedTurns, setQueuedTurns] = useState<QueuedChatTurn[]>([]);
  const [editingQueuedTurnId, setEditingQueuedTurnId] = useState<string | null>(null);
  const [queuedEditText, setQueuedEditText] = useState("");
  const queuedTurnsRef = useRef<QueuedChatTurn[]>([]);
  const editingQueuedTurnIdRef = useRef<string | null>(null);

  function setQueuedTurnState(next: QueuedChatTurn[]) {
    queuedTurnsRef.current = next;
    setQueuedTurns(next);
  }

  function enqueueTurn(turn: QueuedChatTurn) {
    setQueuedTurnState([...queuedTurnsRef.current, turn]);
  }

  function setQueuedTurnEditState(turnId: string | null, content = "") {
    editingQueuedTurnIdRef.current = turnId;
    setEditingQueuedTurnId(turnId);
    setQueuedEditText(content);
  }

  function dequeueNextTurnBatch(): QueuedChatTurn[] {
    if (editingQueuedTurnIdRef.current) return [];

    const [first] = queuedTurnsRef.current;
    if (!first) return [];

    const batch: QueuedChatTurn[] = [];
    const rest: QueuedChatTurn[] = [];
    let foundDifferentSession = false;

    for (const turn of queuedTurnsRef.current) {
      if (!foundDifferentSession && turn.sessionId === first.sessionId) {
        batch.push(turn);
      } else {
        foundDifferentSession = true;
        rest.push(turn);
      }
    }

    setQueuedTurnState(rest);
    return batch;
  }

  function dequeueNextMergedTurn(): QueuedChatTurn | null {
    const batch = dequeueNextTurnBatch();
    const [first] = batch;
    if (!first) return null;
    const last = batch[batch.length - 1] ?? first;

    return {
      id: first.id,
      sessionId: first.sessionId,
      content: batch.map((turn) => turn.content).join("\n\n"),
      options: last.options,
      createdAt: first.createdAt,
    };
  }

  function beginQueuedTurnEdit(turn: QueuedChatTurn) {
    setQueuedTurnEditState(turn.id, turn.content);
  }

  function saveQueuedTurnEdit() {
    const editingId = editingQueuedTurnIdRef.current;
    const content = queuedEditText.trim();
    if (!editingId || !content) return false;

    setQueuedTurnState(
      queuedTurnsRef.current.map((turn) =>
        turn.id === editingId ? { ...turn, content } : turn,
      ),
    );
    setQueuedTurnEditState(null);
    return true;
  }

  function cancelQueuedTurnEdit() {
    setQueuedTurnEditState(null);
  }

  function cancelQueuedTurn(turnId: string) {
    setQueuedTurnState(queuedTurnsRef.current.filter((turn) => turn.id !== turnId));
    if (editingQueuedTurnIdRef.current === turnId) {
      setQueuedTurnEditState(null);
    }
  }

  return {
    queuedTurns,
    editingQueuedTurnId,
    queuedEditText,
    setQueuedEditText,
    enqueueTurn,
    dequeueNextMergedTurn,
    beginQueuedTurnEdit,
    saveQueuedTurnEdit,
    cancelQueuedTurnEdit,
    cancelQueuedTurn,
  };
}
