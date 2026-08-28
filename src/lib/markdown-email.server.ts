/**
 * Converts the markdown that agents produce into email-ready output:
 * a styled HTML body plus a clean plain-text fallback (no `**`, `#`, `-` noise).
 */

const escapeHtml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Inline markdown -> HTML. Input must already be HTML-escaped. */
function inlineToHtml(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '<code style="background:#f3f4f6;padding:1px 4px;border-radius:3px">$1</code>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" style="color:#1a56db;text-decoration:underline">$1</a>',
    )
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "<strong>$2</strong>")
    .replace(/(?<![*\w])\*(?=\S)([^*\n]*?\S)\*(?!\*)/g, "<em>$1</em>")
    .replace(/(?<![_\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, "<em>$1</em>");
}

/** Inline markdown -> plain text. */
function inlineToText(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\(([^)]*)\)/g, "")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 ($2)")
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/(?<![*\w])\*(?=\S)([^*\n]*?\S)\*(?!\*)/g, "$1")
    .replace(/(?<![_\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, "$1")
    .trimEnd();
}

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; text: string }
  | { type: "code"; text: string }
  | { type: "rule" };

const norm = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Avoid printing the subject twice when the body already opens with that title. */
function dropDuplicateTitle(blocks: Block[], subject?: string): Block[] {
  const first = blocks[0];
  if (!subject?.trim() || !first || first.type !== "heading" || first.level > 2) return blocks;
  return norm(first.text) === norm(subject) ? blocks.slice(1) : blocks;
}

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, "\n").replace(/\t/g, "  ").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: "paragraph", text: paragraph.join(" ").trim() });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list && list.items.length) blocks.push({ type: "list", ...list });
    list = null;
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (/^```/.test(trimmed)) {
      flushAll();
      const buffer: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i] ?? "")) {
        buffer.push(lines[i] ?? "");
        i += 1;
      }
      blocks.push({ type: "code", text: buffer.join("\n") });
      continue;
    }

    if (trimmed === "") {
      flushAll();
      continue;
    }

    if (/^([-*_])(\s*\1){2,}$/.test(trimmed)) {
      flushAll();
      blocks.push({ type: "rule" });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushAll();
      blocks.push({
        type: "heading",
        level: heading[1]!.length,
        text: heading[2]!.replace(/\s*#+\s*$/, "").trim(),
      });
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(trimmed);
    if (quote) {
      flushAll();
      blocks.push({ type: "quote", text: quote[1]!.trim() });
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      const item = (bullet?.[1] ?? numbered?.[1] ?? "").trim();
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(item);
      continue;
    }

    // Continuation of a list item (indented wrap) or plain paragraph text.
    if (list && /^\s{2,}\S/.test(line)) {
      list.items[list.items.length - 1] = `${list.items[list.items.length - 1]} ${trimmed}`;
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flushAll();
  return blocks;
}

const HEADING_STYLES: Record<number, string> = {
  1: "margin:28px 0 10px;font-size:22px;line-height:1.3;font-weight:700;color:#111827",
  2: "margin:24px 0 8px;font-size:18px;line-height:1.35;font-weight:700;color:#111827",
  3: "margin:20px 0 8px;font-size:16px;line-height:1.4;font-weight:600;color:#111827",
};

/** Markdown -> readable HTML email body with headings and sections. */
export function markdownToEmailHtml(markdown: string, subject?: string): string {
  const parts = dropDuplicateTitle(parseBlocks(markdown), subject).map((block) => {
    switch (block.type) {
      case "heading": {
        const level = Math.min(block.level, 3);
        const tag = `h${level}`;
        return `<${tag} style="${HEADING_STYLES[level]}">${inlineToHtml(escapeHtml(block.text))}</${tag}>`;
      }
      case "paragraph":
        return `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#1f2937">${inlineToHtml(
          escapeHtml(block.text),
        )}</p>`;
      case "list": {
        const tag = block.ordered ? "ol" : "ul";
        const items = block.items
          .map(
            (item) =>
              `<li style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#1f2937">${inlineToHtml(
                escapeHtml(item),
              )}</li>`,
          )
          .join("");
        return `<${tag} style="margin:0 0 16px;padding-left:22px">${items}</${tag}>`;
      }
      case "quote":
        return `<blockquote style="margin:0 0 16px;padding:8px 14px;border-left:3px solid #d1d5db;color:#4b5563;font-size:15px;line-height:1.6">${inlineToHtml(
          escapeHtml(block.text),
        )}</blockquote>`;
      case "code":
        return `<pre style="margin:0 0 16px;padding:12px;background:#f3f4f6;border-radius:6px;font-size:13px;line-height:1.5;white-space:pre-wrap;color:#111827">${escapeHtml(
          block.text,
        )}</pre>`;
      case "rule":
        return '<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0" />';
      default:
        return "";
    }
  });

  const heading = subject?.trim()
    ? `<h1 style="${HEADING_STYLES[1]};margin-top:0">${inlineToHtml(escapeHtml(subject.trim()))}</h1>`
    : "";

  return `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body style="margin:0;padding:0;background:#ffffff"><div style="max-width:640px;margin:0 auto;padding:28px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#1f2937">${heading}${parts.join(
    "",
  )}</div></body></html>`;
}

/** Markdown -> clean plain text: no stars, pound signs or bullet markers. */
export function markdownToPlainText(markdown: string, subject?: string): string {
  const sections = dropDuplicateTitle(parseBlocks(markdown), subject).map((block) => {
    switch (block.type) {
      case "heading": {
        const text = inlineToText(block.text).toUpperCase();
        return block.level <= 2 ? `${text}\n${"-".repeat(Math.min(text.length, 60))}` : text;
      }
      case "paragraph":
        return inlineToText(block.text);
      case "list":
        return block.items
          .map((item, index) =>
            block.ordered ? `${index + 1}. ${inlineToText(item)}` : `• ${inlineToText(item)}`,
          )
          .join("\n");
      case "quote":
        return `"${inlineToText(block.text)}"`;
      case "code":
        return block.text;
      case "rule":
        return "----------";
      default:
        return "";
    }
  });

  const body = sections.filter(Boolean).join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  const title = subject?.trim() ? `${inlineToText(subject.trim()).toUpperCase()}\n\n` : "";
  return `${title}${body}\n`;
}
