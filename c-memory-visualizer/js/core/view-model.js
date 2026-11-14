/*
 * View model: turns a memory snapshot into a tree of display cells.
 *
 * A "cell" is one addressable thing the canvas draws as a row: a scalar
 * variable, an array (with one child cell per element), or a struct (one
 * child per field). The view also lists every live pointer and resolves the
 * cell each one points at, which is what the arrow layer draws.
 */
(function (root, factory) {
  const ns = (root.CViz = root.CViz || {});
  factory(ns);
  if (typeof module === 'object' && module.exports) module.exports = ns;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CViz) {
  'use strict';

  const { Types, TypeUtil, LAYOUT, hex } = CViz;
  const { arrayOf, declString, typeToString, sameType } = TypeUtil;

  const MAX_ELEMENTS = 32;
  const UINT = Types.uint;

  function charLiteral(code) {
    const c = code & 0xff;
    switch (c) {
      case 0: return "'\\0'";
      case 9: return "'\\t'";
      case 10: return "'\\n'";
      case 13: return "'\\r'";
      case 39: return "'\\''";
      case 92: return "'\\\\'";
      default:
        if (c >= 32 && c < 127) return `'${String.fromCharCode(c)}'`;
        return "'\\x" + c.toString(16).padStart(2, '0') + "'";
    }
  }

  function formatFloat(v, single) {
    if (!Number.isFinite(v)) return Number.isNaN(v) ? 'nan' : v > 0 ? 'inf' : '-inf';
    const s = Number(v.toPrecision(single ? 7 : 12)).toString();
    return /[.e]/.test(s) ? s : s + '.0';
  }

  function escapeString(s) {
    return s.replace(/[\\"\n\t\r]/g, (c) => ({ '\\': '\\\\', '"': '\\"', '\n': '\\n', '\t': '\\t', '\r': '\\r' }[c]))
      .replace(/[^\x20-\x7e]/g, (c) => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0'));
  }

  class ViewBuilder {
    constructor(snap, program) {
      this.snap = snap;
      this.fnByAddr = new Map();
      if (program) {
        for (const fn of program.functions.values()) this.fnByAddr.set(fn.addr, fn.name);
      }
      this.pointers = [];
    }

    /** Builds the cell for one object of `type` at `addr`. */
    cell(id, label, type, addr, role, live, path) {
      const snap = this.snap;
      const c = {
        id,
        label,
        path,
        type,
        typeStr: typeToString(type),
        decl: declString(type, label),
        addr,
        size: type.size,
        role,
        live,
        kind: 'scalar',
        init: true,
        value: '',
        raw: null,
        bytes: null,
        children: null,
        preview: null,
        isPointer: false,
        hidden: 0,
      };

      if (type.kind === 'array') {
        c.kind = 'array';
        const elem = type.of;
        const shown = Math.min(type.length, MAX_ELEMENTS);
        c.children = [];
        for (let i = 0; i < shown; i++) {
          c.children.push(
            this.cell(`${id}[${i}]`, `[${i}]`, elem, addr + i * elem.size, role, live, `${path}[${i}]`));
        }
        c.hidden = type.length - shown;
        if (elem.kind === 'int' && elem.size === 1 && live) {
          let text = '';
          let terminated = false;
          for (let i = 0; i < type.length; i++) {
            if (!snap.isInit(addr + i, 1)) break;
            const b = snap.peek(addr + i, Types.uchar);
            if (b === 0) {
              terminated = true;
              break;
            }
            text += String.fromCharCode(b);
          }
          if (text || terminated) c.preview = '"' + escapeString(text) + '"';
        }
        return c;
      }

      if (type.kind === 'struct') {
        c.kind = 'struct';
        c.children = type.fields.map((f) =>
          this.cell(`${id}.${f.name}`, '.' + f.name, f.type, addr + f.offset, role, live, `${path}.${f.name}`));
        return c;
      }

      c.init = snap.isInit(addr, type.size);
      c.raw = snap.peek(addr, type);
      c.bytes = snap.peekBytes(addr, type.size);
      if (c.raw === null) {
        c.init = false;
        c.value = '?';
        return c;
      }
      if (type.kind === 'ptr') {
        c.isPointer = true;
        if (!c.init) {
          c.value = '?';
        } else if (c.raw === 0) {
          c.value = 'NULL';
        } else if (type.to.kind === 'func' && this.fnByAddr.has(c.raw)) {
          c.value = '&' + this.fnByAddr.get(c.raw);
        } else {
          c.value = hex(c.raw);
          if (live) this.pointers.push({ from: id, addr: c.raw, type });
        }
      } else if (!c.init) {
        c.value = '?';
      } else if (type.kind === 'float') {
        c.value = formatFloat(c.raw, type.size === 4);
      } else if (type.size === 1 && !type.isBool) {
        c.value = charLiteral(c.raw);
        c.note = String(c.raw);
      } else {
        c.value = String(c.raw);
      }
      return c;
    }

    /** A bookkeeping row inside a frame (return address / saved frame pointer). */
    metaCell(id, label, addr, role, note, path) {
      const snap = this.snap;
      const raw = snap.peek(addr, UINT);
      return {
        id, label, path, type: UINT, typeStr: '', decl: label, addr, size: 4, role, live: true,
        kind: 'scalar', init: true, value: raw ? hex(raw) : '0x0', raw, bytes: snap.peekBytes(addr, 4),
        children: null, preview: null, isPointer: false, hidden: 0, note,
      };
    }

    build(options) {
      const snap = this.snap;
      const final = !!(options && options.final);

      const frames = snap.frames.map((f, i) => {
        const fid = 'F' + f.id;
        const cells = [];
        for (let k = f.params.length - 1; k >= 0; k--) {
          const p = f.params[k];
          cells.push(this.cell(`${fid}:p${k}`, p.name, p.type, p.addr, 'param', true, `${f.name}() · ${p.name}`));
        }
        cells.push(this.metaCell(`${fid}:ret`, 'return addr', f.retAddrAt, 'ret', '→ ' + f.returnLabel,
          `${f.name}() · return address`));
        cells.push(this.metaCell(`${fid}:fp`, 'saved fp', f.savedFpAt, 'fp',
          f.savedFp ? "caller's frame" : 'first frame', `${f.name}() · saved frame pointer`));
        f.locals.forEach((l) => {
          cells.push(this.cell(`${fid}:l${l.slot}`, l.name, l.type, l.addr, 'local', f.live[l.slot] === 1,
            `${f.name}() · ${l.name}`));
        });
        return {
          id: fid,
          name: f.name,
          depth: f.depth,
          top: f.top,
          bottom: f.bottom,
          size: f.top - f.bottom,
          active: i === snap.frames.length - 1,
          returning: f.returning,
          retVal: f.retVal ? CViz.formatValue(f.retVal) : null,
          cells,
        };
      });

      const globals = snap.globals.map((g, i) => this.cell(`G${i}`, g.name, g.type, g.addr, 'global', true, g.name));

      const heap = snap.blocks.map((b) => {
        const block = {
          id: 'H' + b.id,
          addr: b.addr,
          size: b.state === 'used' ? b.size : b.cap,
          state: b.state,
          leaked: final && b.state === 'used',
          allocLine: b.allocLine,
          freeLine: b.freeLine,
          typeStr: '',
          cells: [],
        };
        if (b.state !== 'used') return block;
        const t = b.viewType;
        if (!t || t.size === 0 || t.size > b.size) {
          const bytes = snap.peekBytes(b.addr, Math.min(b.size, 8)) || [];
          block.cells.push({
            id: block.id + ':raw', label: 'raw bytes', path: `heap ${hex(b.addr)}`, type: Types.uchar, typeStr: '', decl: 'raw bytes',
            addr: b.addr, size: b.size, role: 'heap', live: true, kind: 'scalar',
            init: snap.isInit(b.addr, Math.min(b.size, 8)),
            value: bytes.map((x) => x.toString(16).padStart(2, '0')).join(' ') + (b.size > 8 ? ' …' : ''),
            raw: null, bytes, children: null, preview: null, isPointer: false, hidden: 0,
            note: 'no typed pointer refers to this block yet',
          });
          block.cells[0].value = block.cells[0].init ? block.cells[0].value : '?';
          return block;
        }
        const count = Math.floor(b.size / t.size);
        if (count === 1) {
          block.rootType = t;
          block.typeStr = typeToString(t);
          const rootCell = this.cell(block.id + ':v', '', t, b.addr, 'heap', true, `heap ${hex(b.addr)}`);
          // A lone struct shows its fields directly; a lone scalar is a single row.
          block.cells = rootCell.children || [Object.assign(rootCell, { label: '*', decl: typeToString(t) })];
          block.preview = rootCell.preview;
        } else {
          const arr = arrayOf(t, count);
          block.typeStr = typeToString(arr);
          const rootCell = this.cell(block.id + ':v', '', arr, b.addr, 'heap', true, `heap ${hex(b.addr)}`);
          block.cells = rootCell.children;
          block.hidden = rootCell.hidden;
          block.preview = rootCell.preview;
        }
        return block;
      });

      // String literals are only worth showing while something points at them.
      const literals = [];
      const literalHits = new Set();
      for (const p of this.pointers) {
        for (let i = 0; i < snap.literals.length; i++) {
          const lit = snap.literals[i];
          if (p.addr >= lit.addr && p.addr < lit.addr + lit.length) literalHits.add(i);
        }
      }
      Array.from(literalHits).sort((a, b) => a - b).forEach((i) => {
        const lit = snap.literals[i];
        literals.push(this.cell(`L${i}`, 'literal', arrayOf(Types.char, lit.length), lit.addr, 'literal', true,
          'string literal'));
      });

      const view = {
        frames,
        globals,
        literals,
        heap,
        pointers: [],
        sp: snap.sp,
        stackBytes: LAYOUT.STACK_TOP - snap.sp,
        heapInUse: snap.heapInUse,
        heapBlocks: snap.blocks.filter((b) => b.state === 'used').length,
        stats: snap.stats,
      };
      view.pointers = this.pointers.map((p) => Object.assign({}, p, resolveTarget(view, snap, p.addr, p.type)));
      return view;
    }
  }

  /**
   * Depth-first search for the cell containing `addr`. Normally that is the
   * innermost cell, but a cell that starts exactly at `addr` and has the
   * pointer's own pointee type wins: a `struct Node *` points at the whole
   * struct, not at its first field.
   */
  function findCell(cells, addr, pointee) {
    for (const c of cells) {
      if (addr >= c.addr && addr < c.addr + Math.max(c.size, 1)) {
        if (pointee && c.addr === addr && sameType(c.type, pointee)) return c;
        if (c.children) {
          const inner = findCell(c.children, addr, pointee);
          if (inner) return inner;
          if (c.hidden) return Object.assign({ overflow: true }, c);
        }
        return c;
      }
    }
    return null;
  }

  /** Finds an array of `pointee` elements whose storage ends exactly at `addr`. */
  function findArrayEndingAt(cells, addr, pointee) {
    for (const c of cells) {
      if (c.kind === 'array' && c.addr + c.size === addr && c.children.length && !c.hidden &&
          (!pointee || sameType(c.type.of, pointee))) {
        return c.children[c.children.length - 1];
      }
      if (c.children) {
        const inner = findArrayEndingAt(c.children, addr, pointee);
        if (inner) return inner;
      }
    }
    return null;
  }

  /**
   * Classifies where a pointer value lands:
   *   {status: 'ok', to}          a live cell (or `block` for a whole heap block)
   *   {status: 'scope', to}       a variable that is not in scope right now
   *   {status: 'end', to}         one past the last element of an array
   *   {status: 'freed', block}    inside a freed heap block
   *   {status: 'dead-stack'}      stack memory of a frame that already returned
   *   {status: 'wild'}            nothing mapped there
   */
  function resolveTarget(view, snap, addr, ptrType) {
    const pointee = ptrType && ptrType.to.kind !== 'void' ? ptrType.to : null;
    const describe = (hit) => ({ status: hit.live ? 'ok' : 'scope', to: hit.id, overflow: !!hit.overflow });
    // A hit is "natural" when the pointer's type matches what lives there.
    const natural = (hit) => hit && hit.addr === addr && pointee && sameType(hit.type, pointee) &&
      hit.role !== 'ret' && hit.role !== 'fp';

    let fallback = null;
    for (const f of view.frames) {
      const hit = findCell(f.cells, addr, pointee);
      if (!hit) continue;
      if (natural(hit)) return describe(hit);
      fallback = describe(hit);
      break;
    }
    if (!fallback) {
      for (const b of view.heap) {
        if (addr >= b.addr && addr < b.addr + Math.max(b.size, 1)) {
          if (b.state !== 'used') return { status: 'freed', block: b.id };
          if (addr === b.addr && b.rootType && pointee && sameType(b.rootType, pointee) && b.rootType.kind !== 'int' &&
              b.rootType.kind !== 'float' && b.rootType.kind !== 'ptr') {
            return { status: 'ok', block: b.id };
          }
          const hit = findCell(b.cells, addr, pointee);
          return hit ? describe(hit) : { status: 'ok', block: b.id };
        }
      }
      const hit = findCell(view.globals, addr, pointee) || findCell(view.literals, addr, pointee);
      if (hit) {
        if (natural(hit)) return describe(hit);
        fallback = describe(hit);
      }
    }

    // `p == array + length`: legal to hold and compare, not to dereference. Checked
    // before the fallback because the byte after an array usually belongs to
    // something unrelated (often the saved frame pointer).
    let end = null;
    for (const f of view.frames) end = end || findArrayEndingAt(f.cells, addr, pointee);
    for (const b of view.heap) {
      if (!end && b.state === 'used' && b.addr + b.size === addr && b.cells.length && !b.hidden) {
        end = b.cells[b.cells.length - 1];
      }
    }
    end = end || findArrayEndingAt(view.globals, addr, pointee);
    if (end) return { status: 'end', to: end.id };
    if (fallback) return fallback;

    if (addr >= LAYOUT.STACK_TOP - LAYOUT.STACK_SIZE && addr < snap.sp) return { status: 'dead-stack' };
    return { status: 'wild' };
  }

  /** @param record a Session record; @param program the compiled program (for function names) */
  function buildView(record, program) {
    const view = new ViewBuilder(record.snap, program).build({ final: record.kind === 'exit' });
    view.kind = record.kind;
    return view;
  }

  CViz.buildView = buildView;
  CViz.charLiteral = charLiteral;
});
