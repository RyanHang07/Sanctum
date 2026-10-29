import "@testing-library/jest-dom/vitest";

// jsdom has no layout. ProseMirror (the notes editor) measures the caret and scrolls it into
// view, so give ranges and elements empty rectangles instead of throwing.
const emptyRect = () => ({ x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
for (const proto of [Range.prototype, Element.prototype] as { getClientRects?: () => DOMRectList; getBoundingClientRect?: () => DOMRect }[]) {
  proto.getClientRects ??= emptyRects;
  proto.getBoundingClientRect ??= emptyRect;
}
document.elementFromPoint ??= () => null;
