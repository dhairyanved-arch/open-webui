/*
 * Memory manager: a byte-accurate model of a 32-bit process image.
 *
 *   0x08048000  .text    function entry points (return addresses point here)
 *   0x08049000  .rodata  string literals (read-only)
 *   0x0804a000  .data    global variables
 *   0x0804c000  heap     grows toward higher addresses (malloc / free)
 *   0xbffff000  stack    grows toward lower addresses (one frame per call)
 *
 * Every access made by the simulated program is bounds-checked, so wild
 * pointers, use-after-free, and stack overflow surface as runtime errors
 * instead of silent corruption. Each byte also carries an "initialised" bit
 * so the visualiser can show indeterminate values honestly.
 */
(function (root, factory) {
  const ns = (root.CViz = root.CViz || {});
  factory(ns);
  if (typeof module === 'object' && module.exports) module.exports = ns;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CViz) {
  'use strict';

  const { RuntimeError, TypeUtil } = CViz;
  const { alignUp } = TypeUtil;

  const LAYOUT = Object.freeze({
    TEXT_BASE: 0x08048000,
    RODATA_BASE: 0x08049000,
    RODATA_SIZE: 0x1000,
    DATA_BASE: 0x0804a000,
    DATA_SIZE: 0x1000,
    HEAP_BASE: 0x0804c000,
    HEAP_SIZE: 0x4000,
    STACK_TOP: 0xbffff000,
    STACK_SIZE: 0x4000,
    MAX_FRAMES: 200, // nested-call limit; keeps the host JavaScript stack from overflowing first
    HEAP_HEADER: 8,
    HEAP_ALIGN: 8,
  });

  const hex = (n) => '0x' + (n >>> 0).toString(16).padStart(8, '0');
  const alignDown = (n, a) => Math.floor(n / a) * a;

  function readTyped(view, off, type) {
    if (type.kind === 'float') {
      return type.size === 4 ? view.getFloat32(off, true) : view.getFloat64(off, true);
    }
    if (type.kind === 'ptr') return view.getUint32(off, true);
    switch (type.size) {
      case 1:
        return type.signed ? view.getInt8(off) : view.getUint8(off);
      case 2:
        return type.signed ? view.getInt16(off, true) : view.getUint16(off, true);
      case 4:
        return type.signed ? view.getInt32(off, true) : view.getUint32(off, true);
      default:
        return Number(type.signed ? view.getBigInt64(off, true) : view.getBigUint64(off, true));
    }
  }

  function writeTyped(view, off, type, value) {
    if (type.kind === 'float') {
      if (type.size === 4) view.setFloat32(off, value, true);
      else view.setFloat64(off, value, true);
      return;
    }
    if (type.kind === 'ptr') {
      view.setUint32(off, value >>> 0, true);
      return;
    }
    switch (type.size) {
      case 1:
        view.setUint8(off, value & 0xff);
        break;
      case 2:
        view.setUint16(off, value & 0xffff, true);
        break;
      case 4:
        view.setUint32(off, value >>> 0, true);
        break;
      default: {
        const big = BigInt.asUintN(64, BigInt(Number.isFinite(value) ? Math.trunc(value) : 0));
        view.setBigUint64(off, big, true);
      }
    }
  }

  /** Unchecked, read-only access shared by live memory and snapshots (used by the UI). */
  class MemoryReader {
    /** Returns {buf, init, view, off} for an address range, or null when unmapped. */
    region(/* addr, size */) {
      return null;
    }

    peek(addr, type) {
      const r = this.region(addr, type.size);
      return r ? readTyped(r.view, r.off, type) : null;
    }

    peekBytes(addr, size) {
      const r = this.region(addr, size);
      return r ? Array.from(r.buf.subarray(r.off, r.off + size)) : null;
    }

    isInit(addr, size) {
      const r = this.region(addr, size);
      if (!r) return false;
      for (let i = 0; i < size; i++) if (!r.init[r.off + i]) return false;
      return true;
    }

    /** Reads a NUL-terminated string without access checks; returns null when unmapped. */
    peekString(addr, max) {
      const limit = max || 256;
      let out = '';
      for (let i = 0; i < limit; i++) {
        const r = this.region(addr + i, 1);
        if (!r) return null;
        const c = r.buf[r.off];
        if (c === 0) return out;
        out += String.fromCharCode(c);
      }
      return out;
    }

    findBlock(addr) {
      for (const b of this.blocks) {
        if (addr >= b.addr && addr < b.addr + Math.max(b.cap, 1)) return b;
      }
      return null;
    }
  }

  class MemorySnapshot extends MemoryReader {
    constructor(fields) {
      super();
      Object.assign(this, fields);
    }

    region(addr, size) {
      for (const r of this.regions) {
        if (addr >= r.base && addr + size <= r.base + r.buf.length) {
          if (!r.view) r.view = new DataView(r.buf.buffer, r.buf.byteOffset, r.buf.byteLength);
          return { buf: r.buf, init: r.init, view: r.view, off: addr - r.base };
        }
      }
      return null;
    }
  }

  class Segment {
    constructor(name, base, size) {
      this.name = name;
      this.base = base;
      this.size = size;
      this.buf = new Uint8Array(size);
      this.init = new Uint8Array(size);
      this.view = new DataView(this.buf.buffer);
    }
  }

  class Memory extends MemoryReader {
    constructor() {
      super();
      this.rodata = new Segment('rodata', LAYOUT.RODATA_BASE, LAYOUT.RODATA_SIZE);
      this.data = new Segment('data', LAYOUT.DATA_BASE, LAYOUT.DATA_SIZE);
      this.heap = new Segment('heap', LAYOUT.HEAP_BASE, LAYOUT.HEAP_SIZE);
      this.stack = new Segment('stack', LAYOUT.STACK_TOP - LAYOUT.STACK_SIZE, LAYOUT.STACK_SIZE);

      this.rodataUsed = 0;
      this.dataUsed = 0;
      this.brk = LAYOUT.HEAP_BASE;
      this.sp = LAYOUT.STACK_TOP;
      this.fp = 0;

      this.frames = [];
      this.blocks = [];
      this.globals = [];
      this.literals = [];

      this.nextFrameId = 1;
      this.nextBlockId = 1;

      // Lifetime statistics, used by the self-verification tests and the status bar.
      this.stats = {
        framesPushed: 0,
        framesPopped: 0,
        maxDepth: 0,
        mallocs: 0,
        frees: 0,
        peakStackBytes: 0,
        peakHeapBytes: 0,
      };
    }

    /* ------------------------------------------------------------------ *
     * Raw region lookup (no access checks)
     * ------------------------------------------------------------------ */

    segmentOf(addr) {
      if (addr >= this.stack.base && addr < LAYOUT.STACK_TOP) return this.stack;
      if (addr >= this.heap.base && addr < this.heap.base + this.heap.size) return this.heap;
      if (addr >= this.data.base && addr < this.data.base + this.data.size) return this.data;
      if (addr >= this.rodata.base && addr < this.rodata.base + this.rodata.size) return this.rodata;
      return null;
    }

    region(addr, size) {
      const seg = this.segmentOf(addr);
      if (!seg || addr + size > seg.base + seg.size) return null;
      return { buf: seg.buf, init: seg.init, view: seg.view, off: addr - seg.base };
    }

    /* ------------------------------------------------------------------ *
     * Checked access used by the running program
     * ------------------------------------------------------------------ */

    check(addr, size, isWrite) {
      const verb = isWrite ? 'write to' : 'read from';
      if (addr >= 0 && addr < 0x1000) {
        throw new RuntimeError(
          addr === 0
            ? `segmentation fault: NULL pointer dereference (${verb} address 0x0)`
            : `segmentation fault: ${verb} ${hex(addr)}, an offset from a NULL pointer`
        );
      }
      const seg = this.segmentOf(addr);
      if (!seg) {
        throw new RuntimeError(`segmentation fault: ${verb} unmapped address ${hex(addr)}`);
      }
      const end = addr + size;
      if (seg === this.stack) {
        if (addr < this.sp) {
          throw new RuntimeError(
            `invalid ${isWrite ? 'write' : 'read'} at ${hex(addr)}: this stack memory belongs to ` +
              'a function that already returned (dangling pointer)'
          );
        }
        if (end > LAYOUT.STACK_TOP) {
          throw new RuntimeError(`segmentation fault: ${verb} ${hex(addr)} runs past the top of the stack`);
        }
      } else if (seg === this.heap) {
        this.checkHeap(addr, size, isWrite, verb);
      } else if (seg === this.data) {
        if (end > this.data.base + this.dataUsed) {
          throw new RuntimeError(`segmentation fault: ${verb} ${hex(addr)} is past the end of .data`);
        }
      } else if (seg === this.rodata) {
        if (isWrite) {
          throw new RuntimeError(
            `segmentation fault: write to ${hex(addr)} — string literals live in read-only memory`
          );
        }
        if (end > this.rodata.base + this.rodataUsed) {
          throw new RuntimeError(`segmentation fault: ${verb} ${hex(addr)} is past the end of .rodata`);
        }
      }
      return seg;
    }

    checkHeap(addr, size, isWrite, verb) {
      // The block that starts at or before this address (blocks are kept sorted).
      let block = null;
      for (const b of this.blocks) {
        if (b.addr > addr) break;
        block = b;
      }
      if (!block) {
        throw new RuntimeError(
          `invalid heap access: ${verb} ${hex(addr)}, which is not inside any malloc'd block`
        );
      }
      if (block.state === 'free') {
        if (addr < block.addr + block.cap) {
          throw new RuntimeError(
            `use after free: ${verb} ${hex(addr)}, inside a block that was already freed`
          );
        }
        throw new RuntimeError(
          `invalid heap access: ${verb} ${hex(addr)}, which is not inside any malloc'd block`
        );
      }
      const blockEnd = block.addr + block.size;
      if (addr + size > blockEnd) {
        const past = Math.max(addr, blockEnd) - blockEnd;
        const where = past === 0
          ? 'runs past the end'
          : `starts ${past} byte${past === 1 ? '' : 's'} past the end`;
        throw new RuntimeError(
          `heap buffer overflow: ${isWrite ? 'write' : 'read'} of ${size} byte${size === 1 ? '' : 's'} at ` +
            `${hex(addr)} ${where} of the ${block.size}-byte block at ${hex(block.addr)}`
        );
      }
    }

    read(addr, type) {
      const seg = this.check(addr, type.size, false);
      return readTyped(seg.view, addr - seg.base, type);
    }

    write(addr, type, value) {
      const seg = this.check(addr, type.size, true);
      const off = addr - seg.base;
      writeTyped(seg.view, off, type, value);
      seg.init.fill(1, off, off + type.size);
    }

    readByte(addr) {
      const seg = this.check(addr, 1, false);
      return seg.buf[addr - seg.base];
    }

    writeByte(addr, value) {
      const seg = this.check(addr, 1, true);
      seg.buf[addr - seg.base] = value & 0xff;
      seg.init[addr - seg.base] = 1;
    }

    /** memmove semantics; carries the "initialised" bits along with the bytes. */
    copy(dst, src, size) {
      if (size <= 0) return;
      const from = this.check(src, size, false);
      const to = this.check(dst, size, true);
      const bytes = from.buf.slice(src - from.base, src - from.base + size);
      const bits = from.init.slice(src - from.base, src - from.base + size);
      to.buf.set(bytes, dst - to.base);
      to.init.set(bits, dst - to.base);
    }

    fill(addr, value, size) {
      if (size <= 0) return;
      const seg = this.check(addr, size, true);
      const off = addr - seg.base;
      seg.buf.fill(value & 0xff, off, off + size);
      seg.init.fill(1, off, off + size);
    }

    /** Reads a NUL-terminated string with full access checks. */
    readString(addr) {
      let out = '';
      for (let i = 0; i < 65536; i++) {
        const c = this.readByte(addr + i);
        if (c === 0) return out;
        out += String.fromCharCode(c);
      }
      throw new RuntimeError('string is not NUL-terminated');
    }

    /* ------------------------------------------------------------------ *
     * Static data
     * ------------------------------------------------------------------ */

    allocGlobal(name, type) {
      const off = alignUp(this.dataUsed, type.align);
      if (off + type.size > this.data.size) throw new RuntimeError('out of memory in .data segment');
      this.dataUsed = off + type.size;
      this.data.init.fill(1, off, off + type.size);
      const addr = this.data.base + off;
      this.globals.push({ name, type, addr });
      return addr;
    }

    internString(bytes) {
      const off = this.rodataUsed;
      if (off + bytes.length + 1 > this.rodata.size) throw new RuntimeError('out of memory in .rodata segment');
      this.rodata.buf.set(bytes, off);
      this.rodata.buf[off + bytes.length] = 0;
      this.rodata.init.fill(1, off, off + bytes.length + 1);
      this.rodataUsed = off + bytes.length + 1;
      const addr = this.rodata.base + off;
      this.literals.push({ addr, length: bytes.length + 1 });
      return addr;
    }

    /* ------------------------------------------------------------------ *
     * Stack
     * ------------------------------------------------------------------ */

    /**
     * Pushes a cdecl-style frame. From high to low addresses:
     *   arguments (last argument highest) | return address | saved frame pointer | locals
     *
     * `spec.params` and `spec.locals` are [{name, type}] lists; the returned
     * frame carries the address assigned to each.
     */
    pushFrame(spec) {
      const top = this.sp;
      const limit = this.stack.base;
      let addr = top;

      const params = new Array(spec.params.length);
      for (let i = spec.params.length - 1; i >= 0; i--) {
        const p = spec.params[i];
        addr = alignDown(addr - p.type.size, Math.max(4, p.type.align));
        params[i] = { name: p.name, type: p.type, addr };
      }
      addr -= 4;
      const retAddrAt = addr;
      addr -= 4;
      const savedFpAt = addr;

      const locals = new Array(spec.locals.length);
      for (let i = 0; i < spec.locals.length; i++) {
        const l = spec.locals[i];
        addr = alignDown(addr - l.type.size, l.type.align);
        locals[i] = { name: l.name, type: l.type, addr, slot: i };
      }
      addr = alignDown(addr, 4);

      if (this.frames.length >= LAYOUT.MAX_FRAMES) {
        throw new RuntimeError(
          `stack overflow: ${spec.name}() would be call number ${this.frames.length + 1} on the stack, ` +
            `past the simulator's limit of ${LAYOUT.MAX_FRAMES} nested calls (runaway recursion?)`
        );
      }
      if (addr < limit) {
        throw new RuntimeError(
          `stack overflow: calling ${spec.name}() needs ${top - addr} more bytes but only ` +
            `${top - limit} remain (${this.frames.length} frames deep — runaway recursion?)`
        );
      }

      const frame = {
        id: this.nextFrameId++,
        name: spec.name,
        depth: this.frames.length,
        top,
        bottom: addr,
        retAddrAt,
        savedFpAt,
        params,
        locals,
        live: new Uint8Array(locals.length),
        retAddr: spec.retAddr >>> 0,
        returnLabel: spec.returnLabel,
        savedFp: this.fp,
        retVal: null,
        returning: false,
      };

      this.sp = addr;
      // Locals start out indeterminate: whatever bytes the previous occupant left behind.
      const off = addr - limit;
      this.stack.init.fill(0, off, savedFpAt - limit);
      this.stack.init.fill(1, savedFpAt - limit, top - limit);
      writeTyped(this.stack.view, retAddrAt - limit, CViz.Types.uint, frame.retAddr);
      writeTyped(this.stack.view, savedFpAt - limit, CViz.Types.uint, this.fp);
      this.fp = savedFpAt;

      this.frames.push(frame);
      this.stats.framesPushed++;
      if (this.frames.length > this.stats.maxDepth) this.stats.maxDepth = this.frames.length;
      const used = LAYOUT.STACK_TOP - this.sp;
      if (used > this.stats.peakStackBytes) this.stats.peakStackBytes = used;
      return frame;
    }

    popFrame() {
      const frame = this.frames.pop();
      if (!frame) throw new RuntimeError('internal error: stack underflow');
      const base = this.stack.base;
      // The bytes stay behind (as on a real machine) but are no longer valid to read.
      this.stack.init.fill(0, frame.bottom - base, frame.top - base);
      this.sp = frame.top;
      this.fp = frame.savedFp;
      this.stats.framesPopped++;
      return frame;
    }

    currentFrame() {
      return this.frames[this.frames.length - 1] || null;
    }

    /* ------------------------------------------------------------------ *
     * Heap: first-fit allocator with block splitting and coalescing
     * ------------------------------------------------------------------ */

    heapBytesInUse() {
      let total = 0;
      for (const b of this.blocks) if (b.state === 'used') total += b.size;
      return total;
    }

    malloc(size, line) {
      size = Math.floor(size);
      if (!(size > 0)) return 0;
      const need = alignUp(size, LAYOUT.HEAP_ALIGN);
      const base = this.heap.base;
      let block = null;

      for (let i = 0; i < this.blocks.length; i++) {
        const b = this.blocks[i];
        if (b.state !== 'free' || b.cap < need) continue;
        const spare = b.cap - need;
        if (spare >= LAYOUT.HEAP_HEADER + LAYOUT.HEAP_ALIGN) {
          this.blocks.splice(i + 1, 0, {
            id: this.nextBlockId++,
            addr: b.addr + need + LAYOUT.HEAP_HEADER,
            size: 0,
            cap: spare - LAYOUT.HEAP_HEADER,
            state: 'free',
            viewType: null,
            allocLine: 0,
            freeLine: b.freeLine,
          });
          b.cap = need;
        }
        block = b;
        break;
      }

      if (!block) {
        const addr = this.brk + LAYOUT.HEAP_HEADER;
        if (addr + need > base + this.heap.size) return 0; // out of memory → NULL
        block = { addr, cap: need };
        this.blocks.push(block);
        this.brk = addr + need;
      }

      block.id = this.nextBlockId++;
      block.size = size;
      block.state = 'used';
      block.viewType = null;
      block.allocLine = line || 0;
      block.freeLine = 0;
      this.heap.init.fill(0, block.addr - base, block.addr - base + block.cap);

      this.stats.mallocs++;
      const inUse = this.heapBytesInUse();
      if (inUse > this.stats.peakHeapBytes) this.stats.peakHeapBytes = inUse;
      return block.addr;
    }

    calloc(count, size, line) {
      const total = Math.floor(count) * Math.floor(size);
      const addr = this.malloc(total, line);
      if (addr) {
        const off = addr - this.heap.base;
        this.heap.buf.fill(0, off, off + total);
        this.heap.init.fill(1, off, off + total);
      }
      return addr;
    }

    free(addr, line) {
      if (addr === 0) return;
      const idx = this.blocks.findIndex((b) => b.addr === addr);
      if (idx < 0) {
        const inside = this.segmentOf(addr) === this.heap ? this.findBlock(addr) : null;
        throw new RuntimeError(
          inside
            ? `free(): invalid pointer ${hex(addr)} — it points into the middle of a block, not its start`
            : `free(): invalid pointer ${hex(addr)} — this address was not returned by malloc`
        );
      }
      const block = this.blocks[idx];
      if (block.state === 'free') {
        throw new RuntimeError(`double free: the block at ${hex(addr)} was already freed`);
      }
      block.state = 'free';
      block.freeLine = line || 0;
      block.size = 0;
      block.viewType = null;
      this.heap.init.fill(0, addr - this.heap.base, addr - this.heap.base + block.cap);
      this.stats.frees++;

      // Coalesce with free neighbours so the free list does not fragment.
      const next = this.blocks[idx + 1];
      if (next && next.state === 'free') {
        block.cap += LAYOUT.HEAP_HEADER + next.cap;
        this.blocks.splice(idx + 1, 1);
      }
      const prev = this.blocks[idx - 1];
      if (prev && prev.state === 'free') {
        prev.cap += LAYOUT.HEAP_HEADER + block.cap;
        prev.freeLine = block.freeLine;
        this.blocks.splice(idx, 1);
      }
    }

    realloc(addr, size, line) {
      if (addr === 0) return this.malloc(size, line);
      size = Math.floor(size);
      if (!(size > 0)) {
        this.free(addr, line);
        return 0;
      }
      const block = this.blocks.find((b) => b.addr === addr);
      if (!block) throw new RuntimeError(`realloc(): invalid pointer ${hex(addr)}`);
      if (block.state === 'free') throw new RuntimeError(`realloc(): the block at ${hex(addr)} was already freed`);
      if (alignUp(size, LAYOUT.HEAP_ALIGN) <= block.cap) {
        block.size = size;
        return addr;
      }
      const viewType = block.viewType;
      const oldSize = block.size;
      const fresh = this.malloc(size, line);
      if (!fresh) return 0;
      this.copy(fresh, addr, Math.min(oldSize, size));
      this.blocks.find((b) => b.addr === fresh).viewType = viewType;
      this.free(addr, line);
      return fresh;
    }

    /** Records how a heap block should be displayed (set when a typed pointer first refers to it). */
    noteBlockType(addr, type) {
      if (addr < this.heap.base || addr >= this.brk) return;
      if (type.kind === 'void' || type.kind === 'func') return;
      for (const b of this.blocks) {
        if (b.addr === addr) {
          if (b.state === 'used' && !b.viewType && type.size <= b.size) b.viewType = type;
          return;
        }
      }
    }

    /* ------------------------------------------------------------------ *
     * Snapshots
     * ------------------------------------------------------------------ */

    /** Captures an immutable copy of everything the visualiser needs for one step. */
    snapshot() {
      const stackOff = this.sp - this.stack.base;
      const heapLen = this.brk - this.heap.base;
      const regions = [
        {
          base: this.sp,
          buf: this.stack.buf.slice(stackOff),
          init: this.stack.init.slice(stackOff),
        },
        {
          base: this.heap.base,
          buf: this.heap.buf.slice(0, heapLen),
          init: this.heap.init.slice(0, heapLen),
        },
        {
          base: this.data.base,
          buf: this.data.buf.slice(0, this.dataUsed),
          init: this.data.init.slice(0, this.dataUsed),
        },
        {
          // String literals never change after load, so every snapshot shares one copy.
          base: this.rodata.base,
          buf: this.rodata.buf.subarray(0, this.rodataUsed),
          init: this.rodata.init.subarray(0, this.rodataUsed),
        },
      ];
      return new MemorySnapshot({
        regions,
        sp: this.sp,
        fp: this.fp,
        brk: this.brk,
        frames: this.frames.map((f) => Object.assign({}, f, { live: f.live.slice() })),
        blocks: this.blocks.map((b) => Object.assign({}, b)),
        globals: this.globals,
        literals: this.literals,
        heapInUse: this.heapBytesInUse(),
        stats: Object.assign({}, this.stats),
      });
    }
  }

  CViz.LAYOUT = LAYOUT;
  CViz.Memory = Memory;
  CViz.MemorySnapshot = MemorySnapshot;
  CViz.hex = hex;
});
