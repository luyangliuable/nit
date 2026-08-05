"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Markdown renderer for chat bubbles. Styling lives in the .chat-md rules in
// globals.css so we stay Tailwind and utility driven without extra plugins.
export function Markdown({ children }: { children: string }) {
  return (
    <div className="chat-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer" />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
