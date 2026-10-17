"use client";

// Chat/wiki markdown. The parser stack (micromark + remark-gfm) is the single
// heaviest piece of first-paint JS, and nothing needs it before the first
// reply lands — so it loads lazily, with the raw text shown meanwhile.
//
// Markdown is memoized: a finished bubble never re-parses. ThrottledMarkdown
// is for the bubble that is still streaming — it re-parses at most every
// 150ms instead of once per token.

import { Suspense, lazy, memo, useEffect, useState } from "react";

const Impl = lazy(() => import("./MarkdownImpl"));

function Plain({ text }: { text: string }) {
  return <span className="whitespace-pre-wrap">{text}</span>;
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <Suspense fallback={<Plain text={text} />}>
      <Impl text={text} />
    </Suspense>
  );
});

export function ThrottledMarkdown({ text }: { text: string }) {
  const [shown, setShown] = useState(text);
  useEffect(() => {
    if (shown === text) return;
    const t = setTimeout(() => setShown(text), 150);
    return () => clearTimeout(t);
  }, [text, shown]);
  return <Markdown text={shown} />;
}
