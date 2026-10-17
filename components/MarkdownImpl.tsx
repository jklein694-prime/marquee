"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { WIKILINK } from "@/lib/wikilink";

export default function MarkdownImpl({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: (p) => <p className="my-1.5 first:mt-0 last:mb-0" {...p} />,
        strong: (p) => <strong className="font-semibold text-fg" {...p} />,
        h1: (p) => <div className="mt-2 font-semibold text-fg" {...p} />,
        h2: (p) => <div className="mt-2 font-semibold text-fg" {...p} />,
        h3: (p) => <div className="mt-2 font-semibold text-fg" {...p} />,
        h4: (p) => <div className="mt-2 font-semibold text-fg" {...p} />,
        hr: () => <hr className="my-2 border-border" />,
        ul: (p) => <ul className="my-1.5 list-disc space-y-1 pl-5" {...p} />,
        ol: (p) => <ol className="my-1.5 list-decimal space-y-1 pl-5" {...p} />,
        a: (p) => <a className="text-accent underline" target="_blank" {...p} />,
        code: (p) => <code className="rounded bg-surface-0 px-1 font-mono text-[0.9em]" {...p} />,
        pre: (p) => (
          <pre
            className="my-1.5 overflow-x-auto rounded-lg border border-border bg-surface-0 p-2.5 text-xs [&_code]:bg-transparent [&_code]:p-0"
            {...p}
          />
        ),
        img: ({ alt, ...p }) => <img alt={alt ?? ""} className="my-1.5 max-w-full rounded-lg" {...p} />,
        blockquote: (p) => <blockquote className="border-l-2 border-border-strong pl-3 text-muted" {...p} />,
        table: (p) => (
          <div className="my-1.5 overflow-x-auto">
            <table className="w-full border-collapse text-xs" {...p} />
          </div>
        ),
        th: (p) => <th className="border-b border-border px-2 py-1 text-left font-semibold text-fg" {...p} />,
        td: (p) => <td className="border-b border-border/60 px-2 py-1 align-top" {...p} />,
      }}
    >
      {text.replace(WIKILINK, "$1")}
    </ReactMarkdown>
  );
}
