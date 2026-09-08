"use client";

import { Fragment, type ReactNode } from "react";

/**
 * Minimal Markdown renderer for generated profile documents.
 *
 * Deliberately renders to React elements instead of injecting HTML: profile content is
 * derived from resumes and crawled pages, so treating it as markup would be an injection
 * risk. Only the small subset the profile generator emits is supported.
 */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const key = `${keyPrefix}-${index++}`;
    if (match[1]) nodes.push(<strong key={key}>{match[1]}</strong>);
    else if (match[2]) nodes.push(<em key={key}>{match[2]}</em>);
    else if (match[3] && match[4]) nodes.push(<a key={key} href={match[4]} target="_blank" rel="noopener noreferrer">{match[3]}</a>);
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

export function Markdown({ content }: { content: string }) {
  const blocks: ReactNode[] = [];
  const lines = content.split("\n");
  let listItems: string[] = [];

  const flushList = (key: string) => {
    if (!listItems.length) return;
    blocks.push(<ul key={key}>{listItems.map((item, index) => <li key={index}>{renderInline(item, `${key}-${index}`)}</li>)}</ul>);
    listItems = [];
  };

  lines.forEach((rawLine, index) => {
    const line = rawLine.trimEnd();
    const key = `block-${index}`;

    if (/^\s*[-*]\s+/.test(line)) { listItems.push(line.replace(/^\s*[-*]\s+/, "")); return; }
    flushList(`list-${index}`);

    if (!line.trim()) return;
    if (line.startsWith("### ")) blocks.push(<h4 key={key}>{renderInline(line.slice(4), key)}</h4>);
    else if (line.startsWith("## ")) blocks.push(<h3 key={key}>{renderInline(line.slice(3), key)}</h3>);
    else if (line.startsWith("# ")) blocks.push(<h2 key={key}>{renderInline(line.slice(2), key)}</h2>);
    else blocks.push(<p key={key}>{renderInline(line, key)}</p>);
  });
  flushList("list-final");

  return <div className="markdown-body">{blocks.map((block, index) => <Fragment key={index}>{block}</Fragment>)}</div>;
}
