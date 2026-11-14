/*
 * Spatial layout: maps a view model onto world coordinates for the canvas.
 *
 *   wide mode                              narrow mode (phones)
 *   ┌─ STACK ─────┐   gap   ┌─ STATIC ──┐   ┌─ STACK ──┐
 *   │ main()      │ ◀─────▶ │ globals   │   │ ...      │
 *   │ callee()    │ arrows  ├─ HEAP ────┤   ├─ STATIC ─┤
 *   └─────────────┘         │ blocks    │   ├─ HEAP ───┤
 *                           └───────────┘   └──────────┘
 *
 * Every drawable gets a stable id, so the renderer can animate an item from
 * its previous position to its new one when frames are pushed or popped.
 */
(function (root, factory) {
  const ns = (root.CViz = root.CViz || {});
  factory(ns);
  if (typeof module === 'object' && module.exports) module.exports = ns;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CViz) {
  'use strict';

  const GEOMETRY = Object.freeze({
    COL_W: 344, // width of the stack column and of the heap/static column
    GAP: 156, // horizontal gap between the columns, where cross-column arrows run
    ARROW_ROOM: 96, // space right of a column for same-column arrows to bulge into
    TITLE_H: 42,
    HEAD_H: 30, // frame / heap block header
    ROW_H: 26, // top-level variable row
    SUB_H: 22, // array element / struct field row
    META_H: 21, // return address / saved frame pointer row
    INNER: 6, // padding between a container edge and its rows
    INDENT: 14, // extra left inset per nesting level
    FRAME_GAP: 12,
    SECTION_GAP: 22,
    EMPTY_H: 62,
    SP_H: 18,
  });

  function computeLayout(view, mode) {
    const G = GEOMETRY;
    const wide = mode !== 'narrow';
    const items = [];
    let focus = null;

    function placeCell(cell, cx, y, cw, depth, column, container, compact) {
      const x = cx + G.INNER + depth * G.INDENT;
      const w = cw - 2 * G.INNER - depth * G.INDENT;
      const isMeta = cell.role === 'ret' || cell.role === 'fp';
      const h = isMeta ? G.META_H : depth > 0 || compact ? G.SUB_H : G.ROW_H;
      const rowType = cell.kind === 'scalar' ? (isMeta ? 'meta' : 'scalar') : 'header';
      items.push({ kind: 'row', id: cell.id, x, y, w, h, cell, depth, column, container, rowType });
      y += h;
      if (cell.children) {
        for (const child of cell.children) {
          y = placeCell(child, cx, y, cw, depth + 1, column, container, compact);
        }
        if (cell.hidden) y = placeMore(cell.id, cell.hidden, cx, y, cw, depth + 1, column, container);
      }
      return y;
    }

    function placeMore(id, hidden, cx, y, cw, depth, column, container) {
      const x = cx + G.INNER + depth * G.INDENT;
      const w = cw - 2 * G.INNER - depth * G.INDENT;
      items.push({
        kind: 'row', id: id + ':more', x, y, w, h: G.SUB_H, depth, column, container, rowType: 'more',
        text: `… ${hidden} more element${hidden === 1 ? '' : 's'} not shown`,
      });
      return y + G.SUB_H;
    }

    /* ------------------------------- stack ------------------------------- */

    let y = 0;
    items.push({
      kind: 'title', id: 'title:stack', x: 0, y, w: G.COL_W, h: G.TITLE_H,
      text: 'Stack', sub: 'one frame per call · grows toward lower addresses',
    });
    y += G.TITLE_H;

    if (view.frames.length === 0) {
      items.push({
        kind: 'empty', id: 'empty:stack', x: 0, y, w: G.COL_W, h: G.EMPTY_H,
        text: view.kind === 'exit' ? 'Empty: main() returned and every frame was popped.' : 'No frames yet.',
      });
      y += G.EMPTY_H + G.FRAME_GAP;
    }
    for (const frame of view.frames) {
      const top = y;
      let cy = y + G.HEAD_H;
      for (const cell of frame.cells) cy = placeCell(cell, 0, cy, G.COL_W, 0, 0, frame.id, false);
      cy += G.INNER;
      const item = { kind: 'frame', id: frame.id, x: 0, y: top, w: G.COL_W, h: cy - top, frame, column: 0 };
      items.push(item);
      if (frame.active) focus = item;
      y = cy + G.FRAME_GAP;
    }
    if (view.frames.length) {
      items.push({ kind: 'sp', id: 'sp', x: 0, y: y - G.FRAME_GAP + 2, w: G.COL_W, h: G.SP_H, addr: view.sp });
      y += G.SP_H;
    }
    const stackBottom = y;

    /* ------------------------- static data + heap ------------------------- */

    const rx = wide ? G.COL_W + G.GAP : 0;
    let ry = wide ? 0 : stackBottom + G.SECTION_GAP;

    const statics = view.globals.concat(view.literals);
    if (statics.length) {
      items.push({
        kind: 'title', id: 'title:static', x: rx, y: ry, w: G.COL_W, h: G.TITLE_H,
        text: 'Static data', sub: 'globals and string literals · live for the whole run',
      });
      ry += G.TITLE_H;
      const top = ry;
      let cy = ry + G.INNER;
      for (const cell of statics) cy = placeCell(cell, rx, cy, G.COL_W, 0, 1, 'static', false);
      cy += G.INNER;
      items.push({ kind: 'static', id: 'static', x: rx, y: top, w: G.COL_W, h: cy - top, column: 1 });
      ry = cy + G.SECTION_GAP;
    }

    items.push({
      kind: 'title', id: 'title:heap', x: rx, y: ry, w: G.COL_W, h: G.TITLE_H,
      text: 'Heap', sub: 'malloc() and free() · grows toward higher addresses',
    });
    ry += G.TITLE_H;
    if (view.heap.length === 0) {
      items.push({
        kind: 'empty', id: 'empty:heap', x: rx, y: ry, w: G.COL_W, h: G.EMPTY_H,
        text: 'Nothing allocated. malloc() reserves memory here.',
      });
      ry += G.EMPTY_H + G.FRAME_GAP;
    }
    for (const block of view.heap) {
      const top = ry;
      let cy = ry + G.HEAD_H;
      if (block.state === 'used') {
        for (const cell of block.cells) cy = placeCell(cell, rx, cy, G.COL_W, 0, 1, block.id, true);
        if (block.hidden) cy = placeMore(block.id, block.hidden, rx, cy, G.COL_W, 0, 1, block.id);
        cy += G.INNER;
      }
      items.push({ kind: 'block', id: block.id, x: rx, y: top, w: G.COL_W, h: cy - top, block, column: 1 });
      ry = cy + G.FRAME_GAP;
    }

    const height = Math.max(stackBottom, ry);
    const width = (wide ? G.COL_W * 2 + G.GAP : G.COL_W) + G.ARROW_ROOM;
    return { items, bounds: { x: 0, y: 0, w: width, h: height }, focus, wide };
  }

  CViz.GEOMETRY = GEOMETRY;
  CViz.computeLayout = computeLayout;
});
