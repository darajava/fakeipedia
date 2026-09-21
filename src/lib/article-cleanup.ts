import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { Root, RootContent } from "mdast";

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const border = /^[+┌┐└┘├┤┬┴┼╔╗╚╝╠╣╦╩╬┏┓┗┛┣┫┳┻╋][+\-=─━═┌┐└┘├┤┬┴┼╔╗╚╝╠╣╦╩╬┏┓┗┛┣┫┳┻╋\s]+[+┌┐└┘├┤┬┴┼╔╗╚╝╠╣╦╩╬┏┓┗┛┣┫┳┻╋]$/u;
const row = /^[|│┃║].*[|│┃║]$/u;

function stripBoxedTables(text: string): string {
  const lines = text.split(/(?<=\n)/);
  const kept: string[] = [];
  for (let index = 0; index < lines.length;) {
    if (!border.test(lines[index].trim())) {
      kept.push(lines[index++]);
      continue;
    }

    let end = index;
    let borders = 0;
    let rows = 0;
    while (end < lines.length) {
      const line = lines[end].trim();
      if (border.test(line)) borders++;
      else if (row.test(line)) rows++;
      else break;
      end++;
    }
    if (borders < 2 || rows === 0) kept.push(...lines.slice(index, end));
    index = end;
  }
  return kept.join("");
}

/** Remove text-drawn tables while preserving real tables, prose and code. */
export function removeAsciiTables(markdown: string): string {
  const tree = parser.parse(markdown);
  const protectedBlocks: { start: number; end: number; remove: boolean }[] = [];

  function visit(node: Root | RootContent) {
    if (["code", "table", "html", "math"].includes(node.type)) {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) {
        const remove = node.type === "code"
          && (!node.lang || /^(?:text|txt|plain|plaintext|ascii|table)$/i.test(node.lang))
          && stripBoxedTables(node.value) !== node.value;
        protectedBlocks.push({ start, end, remove });
      }
      return;
    }
    if ("children" in node) for (const child of node.children) visit(child);
  }
  visit(tree);

  let result = "";
  let offset = 0;
  for (const block of protectedBlocks) {
    result += stripBoxedTables(markdown.slice(offset, block.start));
    if (!block.remove) result += markdown.slice(block.start, block.end);
    offset = block.end;
  }
  return result + stripBoxedTables(markdown.slice(offset));
}
