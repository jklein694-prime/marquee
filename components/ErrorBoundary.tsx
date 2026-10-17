"use client";

import { Component, type ReactNode } from "react";
import { Button } from "./ui";

// One panel throwing (a bad poster URL, a graph edge to a missing node, a
// third-party canvas bug) must not blank the whole app. Each panel and the
// chat sit inside their own boundary; the fallback keeps the rest usable
// and offers a local retry that remounts only that section.
export class ErrorBoundary extends Component<
  { name: string; children: ReactNode },
  { error: Error | null; attempt: number }
> {
  state = { error: null as Error | null, attempt: 0 };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    console.error(`[${this.props.name}] crashed:`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div role="alert" className="m-4 rounded-lg border border-danger/60 bg-surface-1 p-4 text-sm">
          <div className="font-medium text-danger">{this.props.name} hit an error</div>
          <div className="mt-1 break-words text-xs text-muted">{this.state.error.message}</div>
          <Button
            variant="primary"
            className="mt-3"
            onClick={() => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }))}
          >
            Reload this section
          </Button>
        </div>
      );
    }
    // a new key remounts the subtree on retry
    return <div key={this.state.attempt} className="contents">{this.props.children}</div>;
  }
}
