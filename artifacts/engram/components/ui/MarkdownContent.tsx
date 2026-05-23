"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import Link from "next/link";
import { cn } from "@/lib/utils";

export interface CitationSource {
  ref: number;
  id: string;
}

interface MarkdownContentProps {
  content: string;
  sources?: CitationSource[];
  className?: string;
}

export function MarkdownContent({
  content,
  sources = [],
  className,
}: MarkdownContentProps) {
  // Pre-process: convert citation markers [N] → [N](#cite-N) so react-markdown
  // treats them as inline links we can intercept in the custom <a> renderer.
  const processed =
    sources.length > 0
      ? content.replace(/\[(\d+)\]/g, (_, n) => `[${n}](#cite-${n})`)
      : content;

  return (
    <div className={cn("engram-md", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // ── Block / inline code ──────────────────────────────────
          pre({ children }) {
            return <div className="my-3">{children}</div>;
          },
          code({ className: cls, children }) {
            const lang = /language-(\w+)/.exec(cls || "")?.[1];
            const raw = String(children).replace(/\n$/, "");
            const isBlock = !!lang || raw.includes("\n");

            if (isBlock) {
              return (
                <SyntaxHighlighter
                  language={lang ?? "text"}
                  style={vscDarkPlus}
                  PreTag="div"
                  showLineNumbers={raw.split("\n").length > 4}
                  wrapLongLines={false}
                  customStyle={{
                    margin: 0,
                    borderRadius: "0.5rem",
                    border: "1px solid rgba(48,54,61,0.9)",
                    background: "#0d1117",
                    fontSize: "13px",
                    lineHeight: "1.6",
                  }}
                  codeTagProps={{ style: { fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace" } }}
                >
                  {raw}
                </SyntaxHighlighter>
              );
            }

            // Inline code
            return (
              <code className="px-1.5 py-0.5 rounded text-[12.5px] font-mono bg-[#161b22] border border-gh-border text-[#e6edf3]">
                {children}
              </code>
            );
          },

          // ── Links — citations render as purple pills ──────────────
          a({ href, children }) {
            const citeMatch = href?.match(/^#cite-(\d+)$/);
            if (citeMatch) {
              const ref = parseInt(citeMatch[1], 10);
              const src = sources.find((s) => s.ref === ref);
              if (src) {
                return (
                  <Link
                    href={`/context/${src.id}`}
                    className="inline-flex items-center px-1.5 py-px rounded text-[11px] font-mono bg-engram/15 text-engram-light hover:bg-engram/25 transition-colors mx-0.5 align-baseline"
                  >
                    {ref}
                  </Link>
                );
              }
              return <sup className="text-engram-light text-[11px]">[{children}]</sup>;
            }
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-engram-light underline underline-offset-2 hover:text-engram transition-colors"
              >
                {children}
              </a>
            );
          },

          // ── Typography ───────────────────────────────────────────
          h1({ children }) {
            return (
              <h1 className="text-[19px] font-semibold text-gh-text mt-5 mb-2 leading-snug">
                {children}
              </h1>
            );
          },
          h2({ children }) {
            return (
              <h2 className="text-[17px] font-semibold text-gh-text mt-4 mb-2 leading-snug">
                {children}
              </h2>
            );
          },
          h3({ children }) {
            return (
              <h3 className="text-[15px] font-semibold text-gh-text mt-3 mb-1.5 leading-snug">
                {children}
              </h3>
            );
          },
          p({ children }) {
            return (
              <p className="text-[15px] text-gh-text leading-relaxed mb-3 last:mb-0">
                {children}
              </p>
            );
          },
          strong({ children }) {
            return <strong className="font-semibold text-[#e6edf3]">{children}</strong>;
          },
          em({ children }) {
            return <em className="italic text-gh-text/90">{children}</em>;
          },

          // ── Lists ────────────────────────────────────────────────
          ul({ children }) {
            return (
              <ul className="list-disc pl-5 space-y-1 my-2 text-gh-text">
                {children}
              </ul>
            );
          },
          ol({ children }) {
            return (
              <ol className="list-decimal pl-5 space-y-1 my-2 text-gh-text">
                {children}
              </ol>
            );
          },
          li({ children }) {
            return <li className="text-[15px] leading-relaxed">{children}</li>;
          },

          // ── Blockquote ───────────────────────────────────────────
          blockquote({ children }) {
            return (
              <blockquote className="border-l-2 border-engram/50 pl-4 my-3 text-gh-muted italic">
                {children}
              </blockquote>
            );
          },

          // ── Table ────────────────────────────────────────────────
          table({ children }) {
            return (
              <div className="overflow-x-auto my-3 rounded-lg border border-gh-border">
                <table className="w-full text-sm border-collapse">{children}</table>
              </div>
            );
          },
          thead({ children }) {
            return <thead className="bg-gh-bg/60">{children}</thead>;
          },
          th({ children }) {
            return (
              <th className="text-left px-3 py-2 text-[11px] font-mono uppercase tracking-wider text-gh-muted border-b border-gh-border">
                {children}
              </th>
            );
          },
          td({ children }) {
            return (
              <td className="px-3 py-2 text-[14px] text-gh-text border-b border-gh-border/40 last-of-type:border-0">
                {children}
              </td>
            );
          },

          // ── Misc ─────────────────────────────────────────────────
          hr() {
            return <hr className="border-gh-border my-4" />;
          },
        }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
}
