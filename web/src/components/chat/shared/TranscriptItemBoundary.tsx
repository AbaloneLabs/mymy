import { Component, type ErrorInfo, type ReactNode } from "react";
import { reloadStaleRouteOnce } from "@/lib/deploymentVersion";

interface TranscriptItemBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
  itemId: string;
}

interface TranscriptItemBoundaryState {
  failed: boolean;
}

/**
 * Keep one malformed or temporarily unavailable rich message from replacing
 * the entire chat route. The persisted plain-text payload remains usable, and
 * a different item gets a fresh rendering attempt without requiring a page
 * reload or disturbing an active agent run.
 */
export class TranscriptItemBoundary extends Component<
  TranscriptItemBoundaryProps,
  TranscriptItemBoundaryState
> {
  state: TranscriptItemBoundaryState = { failed: false };

  static getDerivedStateFromError(): TranscriptItemBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Chat transcript item rendering failed", error, info.componentStack);
    reloadStaleRouteOnce(error);
  }

  componentDidUpdate(previous: TranscriptItemBoundaryProps) {
    if (this.state.failed && previous.itemId !== this.props.itemId) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (this.state.failed) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}
