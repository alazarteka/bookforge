import type { Block, Inline, Publication, Section } from "./model.js";

export interface TraversalContext {
  section?: Section;
}

export interface IrVisitor {
  block?: (block: Block, context: TraversalContext) => void;
  inline?: (inline: Inline, context: TraversalContext) => void;
}

export interface PublicationTraversalOptions {
  includeTitles?: boolean;
}

/**
 * Visits every block and inline in source order, descending through all nested
 * inline and block containers. Switches are deliberately exhaustive so a new
 * IR variant cannot be silently skipped by analyses built on this traversal.
 */
export function visitPublication(publication: Publication, visitor: IrVisitor, options: PublicationTraversalOptions = {}): void {
  for (const section of publication.spine) visitSection(section, visitor, options);
}

export function visitSection(section: Section, visitor: IrVisitor, options: PublicationTraversalOptions = {}): void {
  const context = { section };
  if (options.includeTitles !== false) visitInlines(section.title, visitor, context);
  visitBlocks(section.blocks, visitor, context);
}

export function visitBlocks(blocks: Block[], visitor: IrVisitor, context: TraversalContext = {}): void {
  for (const block of blocks) {
    visitor.block?.(block, context);
    switch (block.type) {
      case "paragraph":
      case "heading":
        visitInlines(block.children, visitor, context);
        break;
      case "blockquote":
        visitBlocks(block.blocks, visitor, context);
        break;
      case "sceneBreak":
      case "codeBlock":
        break;
      case "list":
        for (const item of block.items) visitBlocks(item, visitor, context);
        break;
      case "figure":
        visitInlines([block.image], visitor, context);
        visitInlines(block.caption, visitor, context);
        break;
      case "table":
        for (const header of block.headers) visitInlines(header, visitor, context);
        for (const row of block.rows) for (const cell of row) visitInlines(cell, visitor, context);
        break;
      default:
        assertNever(block);
    }
  }
}

export function visitInlines(inlines: Inline[], visitor: IrVisitor, context: TraversalContext = {}): void {
  for (const inline of inlines) {
    visitor.inline?.(inline, context);
    switch (inline.type) {
      case "text":
      case "space":
      case "softBreak":
      case "lineBreak":
      case "code":
      case "image":
        break;
      case "emphasis":
      case "strong":
      case "link":
        visitInlines(inline.children, visitor, context);
        break;
      case "footnote":
        visitBlocks(inline.blocks, visitor, context);
        break;
      default:
        assertNever(inline);
    }
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported publication IR node: ${JSON.stringify(value)}`);
}
