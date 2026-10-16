import type { ReactNode } from "react";

/**
 * A deliberately small Markdown renderer that produces React elements, never HTML strings.
 * Artifacts can contain text fetched from the internet, so nothing here uses innerHTML,
 * and links are limited to http(s).
 */

function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

const INLINE_RE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|https?:\/\/[^\s<>()]+[^\s<>().,;:!?"'”’])/g;

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const tok = m[0];
    if (m.index! > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith("**")) out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={key}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("[")) {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)!;
      const href = safeHref(lm[2]!);
      out.push(href ? <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow">{lm[1]}</a> : lm[1]);
    } else {
      const href = safeHref(tok);
      out.push(href ? <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow">{tok}</a> : tok);
    }
    last = m.index! + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  const blocks: ReactNode[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const key = `b${k++}`;
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (!line.trim()) {
      i++;
    } else if (heading) {
      const level = Math.min(heading[1]!.length + 1, 5); // document h1 renders as h2 under the page title
      const Tag = `h${level}` as "h2";
      blocks.push(<Tag key={key}>{inline(heading[2]!, key)}</Tag>);
      i++;
    } else if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i]!)) {
        const raw = lines[i]!.replace(/^\s*([-*]|\d+\.)\s+/, "");
        const box = /^\[([ xX])\]\s+(.*)$/.exec(raw);
        items.push(
          <li key={`${key}-${items.length}`} className={box ? "task-item" : undefined}>
            {box ? (
              <>
                <span className={`checkbox${box[1] !== " " ? " checked" : ""}`} aria-hidden="true" />
                <span className="visually-hidden">{box[1] !== " " ? "Done: " : "To do: "}</span>
                {inline(box[2]!, `${key}-${items.length}`)}
              </>
            ) : (
              inline(raw, `${key}-${items.length}`)
            )}
          </li>,
        );
        i++;
      }
      blocks.push(ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>);
    } else if (line.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i]!.startsWith(">")) quote.push(lines[i++]!.replace(/^>\s?/, ""));
      blocks.push(<blockquote key={key}>{inline(quote.join(" "), key)}</blockquote>);
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i]!.trim() && !/^(#{1,4}\s|\s*([-*]|\d+\.)\s|>)/.test(lines[i]!)) para.push(lines[i++]!);
      blocks.push(<p key={key}>{inline(para.join(" "), key)}</p>);
    }
  }
  return <div className="prose">{blocks}</div>;
}
