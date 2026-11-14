/*
 * Tree-walking interpreter for the C subset.
 *
 * Execution is written as generators: `run()` yields a pause point before
 * every statement (and at a few extra moments, such as just before a frame
 * is popped), so a debugger can drive the program one step at a time without
 * blocking the browser. Between pauses the interpreter mutates the Memory
 * model; the caller snapshots it at each pause.
 */
(function (root, factory) {
  const ns = (root.CViz = root.CViz || {});
  factory(ns);
  if (typeof module === 'object' && module.exports) module.exports = ns;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CViz) {
  'use strict';

  const { Types, TypeUtil, RuntimeError, ExitSignal, Memory, LAYOUT, hex } = CViz;
  const { ptrTo, arrayOf, isPointer, isArith, usualArithmetic, promote, typeToString } = TypeUtil;

  const BREAK = Object.freeze({ type: 'break' });
  const CONTINUE = Object.freeze({ type: 'continue' });
  const VOID_VALUE = Object.freeze({ type: Types.void, value: 0 });
  const CHAR_PTR = ptrTo(Types.char);

  function wrapInt(v, t) {
    if (t.isBool) return v ? 1 : 0;
    switch (t.size) {
      case 1:
        return t.signed ? (v << 24) >> 24 : v & 0xff;
      case 2:
        return t.signed ? (v << 16) >> 16 : v & 0xffff;
      case 4:
        return t.signed ? v | 0 : v >>> 0;
      default: {
        const big = BigInt(Number.isFinite(v) ? Math.trunc(v) : 0);
        return Number(t.signed ? BigInt.asIntN(64, big) : BigInt.asUintN(64, big));
      }
    }
  }

  function bigIntOp(op, x, y, t) {
    const a = BigInt(Math.trunc(x));
    const b = BigInt(Math.trunc(y));
    let r;
    switch (op) {
      case '+': r = a + b; break;
      case '-': r = a - b; break;
      case '*': r = a * b; break;
      case '/': r = a / b; break;
      case '%': r = a % b; break;
      case '&': r = a & b; break;
      case '|': r = a | b; break;
      case '^': r = a ^ b; break;
      case '<<': r = a << (b & 63n); break;
      case '>>': r = a >> (b & 63n); break;
      default: throw new RuntimeError(`internal error: operator ${op}`);
    }
    return Number(t.signed ? BigInt.asIntN(64, r) : BigInt.asUintN(64, r));
  }

  function formatValue(v) {
    const t = v.type;
    if (t.kind === 'ptr') return v.value === 0 ? 'NULL' : hex(v.value);
    if (t.kind === 'float') {
      const s = Number(v.value.toPrecision(7)).toString();
      return /[.e]|Infinity|NaN/.test(s) ? s : s + '.0';
    }
    if (t.kind === 'struct') return `struct ${t.tag}`;
    if (t.kind === 'int' && t.size === 1 && !t.isBool && v.value >= 32 && v.value < 127) {
      return `'${String.fromCharCode(v.value)}'`;
    }
    return String(v.value);
  }

  class Interpreter {
    /**
     * @param program  resolved AST from CViz.compile()
     * @param options  {stdin: string, source: string}
     */
    constructor(program, options) {
      const opts = options || {};
      this.program = program;
      this.mem = new Memory();
      this.stdin = opts.stdin || '';
      this.stdinPos = 0;
      this.sourceLines = (opts.source || '').split('\n');
      this.console = []; // [{kind: 'out'|'warn'|'info'|'error', text}]
      this.events = []; // what happened since the previous pause; drained by the session
      this.warned = new Set();
      this.curNode = null;
      this.curFn = null;
      this.rngState = 1;
      this.exitCode = null;
      this.stringAddrs = [];
      this.fnByAddr = new Map();
    }

    /* ------------------------------------------------------------------ *
     * Console and event plumbing
     * ------------------------------------------------------------------ */

    print(text) {
      if (!text) return;
      const last = this.console[this.console.length - 1];
      if (last && last.kind === 'out') last.text += text;
      else this.console.push({ kind: 'out', text });
    }

    log(kind, text) {
      this.console.push({ kind, text });
    }

    warn(text, node) {
      const at = node || this.curNode;
      const line = at && at.loc ? at.loc.line : 0;
      const key = line + ':' + text;
      if (this.warned.has(key)) return;
      this.warned.add(key);
      this.log('warn', (line ? `line ${line}: ` : '') + 'warning: ' + text);
    }

    event(kind, text) {
      this.events.push({ kind, text });
    }

    fail(message, node) {
      const at = node || this.curNode;
      throw new RuntimeError(message, at ? at.loc : null);
    }

    sourceText(loc) {
      if (!loc || loc.line !== loc.endLine) return '';
      const line = this.sourceLines[loc.line - 1] || '';
      return line.slice(loc.col - 1, loc.endCol - 1);
    }

    pause(kind, loc) {
      return { kind, loc, depth: this.mem.frames.length, fn: this.curFn ? this.curFn.name : null };
    }

    /* ------------------------------------------------------------------ *
     * Program start-up
     * ------------------------------------------------------------------ */

    *run() {
      const program = this.program;
      let index = 0;
      for (const fn of program.functions.values()) {
        fn.addr = LAYOUT.TEXT_BASE + 0x100 + index * 0x80;
        this.fnByAddr.set(fn.addr, fn);
        index++;
      }
      this.stringAddrs = program.strings.map((bytes) => this.mem.internString(bytes));

      try {
        this.globalAddrs = program.globals.map((g) => this.mem.allocGlobal(g.name, g.ctype));
        for (let i = 0; i < program.globals.length; i++) {
          const g = program.globals[i];
          if (g.init) yield* this.initialize(this.globalAddrs[i], g.ctype, g.init);
        }

        const main = program.functions.get('main');
        const args = main.params.map((p, i) => {
          // main(int argc, char **argv): one argument (the program name) and no argv storage.
          if (i === 0 && p.type.kind === 'int') return { type: p.type, value: 1 };
          return { type: p.type, value: 0 };
        });
        const result = yield* this.callFunction(main, args, null);
        this.exitCode = main.retType.kind === 'void' || !result ? 0 : result.value | 0;
      } catch (e) {
        if (!(e instanceof ExitSignal)) throw e;
        this.exitCode = e.code;
        // exit() never returns: the process image, stack included, is simply torn down.
        while (this.mem.frames.length) this.mem.popFrame();
        this.event('return', `exit(${e.code}) ended the program and discarded every stack frame`);
      }
      return this.exitCode;
    }

    /* ------------------------------------------------------------------ *
     * Function calls
     * ------------------------------------------------------------------ */

    *callFunction(fn, args, callNode) {
      const callerFn = this.curFn;
      let retAddr = LAYOUT.TEXT_BASE + 0x10;
      let returnLabel = '_start';
      if (callNode && callerFn) {
        const line = callNode.loc.line;
        retAddr = callerFn.addr + 4 + ((line - callerFn.loc.line) * 5 + (callNode.loc.col % 5)) % 0x7c;
        returnLabel = `${callerFn.name}() line ${line}`;
      }

      let frame;
      try {
        frame = this.mem.pushFrame({
          name: fn.name,
          params: fn.params,
          locals: fn.locals,
          retAddr,
          returnLabel,
        });
      } catch (e) {
        if (e instanceof RuntimeError && !e.loc && callNode) e.loc = callNode.loc;
        throw e;
      }
      for (let i = 0; i < args.length; i++) {
        this.storeTo(frame.params[i].addr, fn.params[i].type, args[i]);
      }

      const shown = args.map((a, i) => `${fn.params[i].name}=${formatValue(a)}`).join(', ');
      this.event('call', `${fn.name}(${shown}) was called: a new ${frame.top - frame.bottom}-byte ` +
        `frame is pushed at ${hex(frame.bottom)}`);

      this.curFn = fn;
      let result = null;
      const completion = yield* this.execBlock(fn.body);
      if (completion && completion.type === 'return') {
        result = completion.value;
      } else {
        // Control fell off the end of the function: pause on the closing brace.
        frame.returning = true;
        if (fn.retType.kind !== 'void') {
          if (fn.name !== 'main') {
            this.warn(`control reaches the end of non-void function '${fn.name}' without a return`, fn.body);
          }
          result = { type: fn.retType, value: 0 };
          if (fn.name === 'main') frame.retVal = result;
        }
        yield this.pause('return', fn.body.closeLoc);
      }

      this.mem.popFrame();
      this.curFn = callerFn;
      const gave = result && fn.retType.kind !== 'void' ? ` returned ${formatValue(result)};` : ' returned;';
      this.event('return', `${fn.name}()${gave} its frame is popped and sp moves back up to ${hex(this.mem.sp)}`);
      return result || VOID_VALUE;
    }

    /* ------------------------------------------------------------------ *
     * Statements
     * ------------------------------------------------------------------ */

    endScope(node) {
      const frame = this.mem.currentFrame();
      if (!frame || !node.scopeSlots) return;
      for (const slot of node.scopeSlots) frame.live[slot] = 0;
    }

    *execBlock(node) {
      for (const item of node.items) {
        const completion = yield* this.execStmt(item);
        if (completion) {
          this.endScope(node);
          return completion;
        }
      }
      this.endScope(node);
      return null;
    }

    *execStmt(node) {
      switch (node.type) {
        case 'Block':
          return yield* this.execBlock(node);

        case 'VarDecl': {
          if (node.decls.length === 0) return null;
          yield this.pause('stmt', node.loc);
          const frame = this.mem.currentFrame();
          for (const d of node.decls) {
            const local = frame.locals[d.slot];
            frame.live[d.slot] = 1;
            if (d.init) yield* this.initialize(local.addr, d.ctype, d.init);
          }
          return null;
        }

        case 'ExprStmt':
          yield this.pause('stmt', node.loc);
          yield* this.evalExpr(node.expr);
          return null;

        case 'If': {
          yield this.pause('stmt', node.headLoc);
          const taken = yield* this.evalCondition(node.test);
          if (taken) return yield* this.execStmt(node.then);
          if (node.otherwise) return yield* this.execStmt(node.otherwise);
          return null;
        }

        case 'While':
          for (;;) {
            yield this.pause('stmt', node.headLoc);
            if (!(yield* this.evalCondition(node.test))) return null;
            const c = yield* this.execStmt(node.body);
            if (c === BREAK) return null;
            if (c && c !== CONTINUE) return c;
          }

        case 'DoWhile':
          for (;;) {
            const c = yield* this.execStmt(node.body);
            if (c === BREAK) return null;
            if (c && c !== CONTINUE) return c;
            yield this.pause('stmt', node.headLoc);
            if (!(yield* this.evalCondition(node.test))) return null;
          }

        case 'For': {
          let result = null;
          if (node.init) yield* this.execStmt(node.init);
          for (;;) {
            if (node.test) {
              yield this.pause('stmt', node.test.loc);
              if (!(yield* this.evalCondition(node.test))) break;
            }
            const c = yield* this.execStmt(node.body);
            if (c === BREAK) break;
            if (c && c !== CONTINUE) {
              result = c;
              break;
            }
            if (node.update) {
              yield this.pause('stmt', node.update.loc);
              yield* this.evalExpr(node.update);
            }
          }
          this.endScope(node);
          return result;
        }

        case 'Switch': {
          yield this.pause('stmt', node.headLoc);
          const disc = yield* this.evalExpr(node.disc);
          if (disc.type.kind !== 'int') this.fail('switch quantity is not an integer', node.disc);
          const items = node.body.items;
          let start = items.findIndex((s) => s.type === 'Case' && s.value === disc.value);
          if (start < 0) start = items.findIndex((s) => s.type === 'Default');
          let result = null;
          if (start >= 0) {
            for (let i = start; i < items.length; i++) {
              const c = yield* this.execStmt(items[i]);
              if (c === BREAK) break;
              if (c) {
                result = c;
                break;
              }
            }
          }
          this.endScope(node.body);
          return result;
        }

        case 'Return': {
          yield this.pause('stmt', node.loc);
          const fn = this.curFn;
          const frame = this.mem.currentFrame();
          let value = null;
          if (node.arg) {
            const v = yield* this.evalExpr(node.arg);
            this.curNode = node;
            value = this.convert(v, fn.retType, false);
          } else if (fn.retType.kind !== 'void') {
            this.warn(`'return' with no value in function '${fn.name}' that returns ${typeToString(fn.retType)}`, node);
            value = { type: fn.retType, value: 0 };
          }
          frame.retVal = value;
          frame.returning = true;
          // Second pause on the same line: the value is known and the frame is about to go.
          yield this.pause('return', node.loc);
          return { type: 'return', value };
        }

        case 'Break':
          yield this.pause('stmt', node.loc);
          return BREAK;

        case 'Continue':
          yield this.pause('stmt', node.loc);
          return CONTINUE;

        case 'Case':
        case 'Default':
        case 'Empty':
          return null;

        default:
          this.fail(`internal error: cannot execute ${node.type}`, node);
          return null;
      }
    }

    *evalCondition(test) {
      const v = yield* this.evalExpr(test);
      const taken = this.truthy(v, test);
      const text = this.sourceText(test.loc);
      if (text) this.event('branch', `(${text}) is ${taken ? 'true' : 'false'}`);
      return taken;
    }

    truthy(v, node) {
      if (v.type.kind === 'struct' || v.type.kind === 'void') {
        this.fail(`a value of type '${typeToString(v.type)}' cannot be used as a condition`, node);
      }
      return v.value !== 0;
    }

    /* ------------------------------------------------------------------ *
     * Initializers
     * ------------------------------------------------------------------ */

    *initialize(addr, type, init) {
      this.curNode = init;
      if (type.kind === 'array') {
        const elem = type.of;
        if (init.type === 'Str' && init.inline) {
          for (let i = 0; i < init.bytes.length; i++) this.mem.writeByte(addr + i, init.bytes[i]);
          const rest = type.length - init.bytes.length;
          if (rest > 0) this.mem.fill(addr + init.bytes.length, 0, rest);
          return;
        }
        if (init.type !== 'InitList') this.fail('an array must be initialized with a brace-enclosed list', init);
        for (let i = 0; i < init.items.length; i++) {
          yield* this.initialize(addr + i * elem.size, elem, init.items[i]);
        }
        // Elements without an initializer are zeroed, as the standard requires.
        const done = init.items.length * elem.size;
        if (done < type.size) this.mem.fill(addr + done, 0, type.size - done);
        return;
      }
      if (type.kind === 'struct') {
        if (init.type === 'InitList') {
          this.mem.fill(addr, 0, type.size);
          for (let i = 0; i < init.items.length; i++) {
            const f = type.fields[i];
            yield* this.initialize(addr + f.offset, f.type, init.items[i]);
          }
          return;
        }
        const v = yield* this.evalExpr(init);
        this.curNode = init;
        this.storeTo(addr, type, v);
        return;
      }
      const expr = init.type === 'InitList' ? init.items[0] : init;
      if (expr.type === 'InitList') this.fail('too many braces around a scalar initializer', init);
      const v = yield* this.evalExpr(expr);
      this.curNode = init;
      this.storeTo(addr, type, v);
    }

    /* ------------------------------------------------------------------ *
     * Values, conversions, loads, and stores
     * ------------------------------------------------------------------ */

    convert(v, to, explicit) {
      const from = v.type;
      if (from === to) return v;
      switch (to.kind) {
        case 'int':
          if (to.isBool && from.kind !== 'struct' && from.kind !== 'void') {
            return { type: to, value: v.value !== 0 ? 1 : 0 };
          }
          if (from.kind === 'int') return { type: to, value: wrapInt(v.value, to) };
          if (from.kind === 'float') {
            const t = Math.trunc(v.value);
            return { type: to, value: wrapInt(Number.isFinite(t) ? t : 0, to) };
          }
          if (from.kind === 'ptr') {
            if (!explicit) this.warn(`converting pointer '${typeToString(from)}' to integer without a cast`);
            return { type: to, value: wrapInt(v.value, to) };
          }
          break;
        case 'float':
          if (isArith(from)) return { type: to, value: to.size === 4 ? Math.fround(v.value) : Number(v.value) };
          break;
        case 'ptr':
          if (from.kind === 'ptr') {
            if (to.to.kind !== 'struct' || to.to.complete) this.mem.noteBlockType(v.value, to.to);
            return { type: to, value: v.value };
          }
          if (from.kind === 'int') {
            if (!explicit && v.value !== 0) {
              this.warn(`making a pointer from the integer ${v.value} without a cast`);
            }
            return { type: to, value: v.value >>> 0 };
          }
          break;
        case 'void':
          return VOID_VALUE;
        case 'struct':
          if (from.kind === 'struct' && from === to) return v;
          break;
        default:
          break;
      }
      this.fail(`cannot convert '${typeToString(from)}' to '${typeToString(to)}'`);
      return null;
    }

    /** Stores a value at an address, converting it to the destination type first. */
    storeTo(addr, type, v) {
      if (type.kind === 'struct') {
        if (v.type !== type) this.fail(`cannot assign '${typeToString(v.type)}' to '${typeToString(type)}'`);
        this.mem.copy(addr, v.value, type.size);
        return v;
      }
      if (type.kind === 'array') this.fail('an array cannot be assigned to; copy its elements instead');
      const c = this.convert(v, type, false);
      this.mem.write(addr, type, c.value);
      return c;
    }

    /** Reads the value designated by an lvalue. Arrays decay to pointers. */
    load(lv, node) {
      const t = lv.type;
      if (t.kind === 'array') return { type: ptrTo(t.of), value: lv.addr };
      if (t.kind === 'struct') return { type: t, value: lv.addr };
      if (t.kind === 'func') return { type: ptrTo(t), value: lv.addr };
      if (t.kind === 'void') this.fail('cannot read a value of type void', node);
      const value = this.mem.read(lv.addr, t);
      if (!this.mem.isInit(lv.addr, t.size)) {
        const text = node ? this.sourceText(node.loc) : '';
        this.warn(`${text ? `'${text}'` : 'a value'} is read before it was ever assigned (indeterminate value)`, node);
      }
      return { type: t, value };
    }

    identType(ref) {
      switch (ref.kind) {
        case 'local':
          return this.curFn.locals[ref.slot].type;
        case 'param':
          return this.curFn.params[ref.index].type;
        case 'global':
          return this.program.globals[ref.index].ctype;
        default:
          return null;
      }
    }

    identLValue(node) {
      const ref = node.ref;
      const frame = this.mem.currentFrame();
      switch (ref.kind) {
        case 'local': {
          const l = frame.locals[ref.slot];
          return { type: l.type, addr: l.addr };
        }
        case 'param': {
          const p = frame.params[ref.index];
          return { type: p.type, addr: p.addr };
        }
        case 'global':
          return { type: this.program.globals[ref.index].ctype, addr: this.globalAddrs[ref.index] };
        case 'func': {
          const fn = this.program.functions.get(ref.name);
          return { type: fn.ctype, addr: fn.addr };
        }
        default:
          this.fail(`'${node.name}' is not a variable`, node);
          return null;
      }
    }

    *evalLValue(node) {
      this.curNode = node;
      switch (node.type) {
        case 'Ident':
          return this.identLValue(node);
        case 'Unary':
          if (node.op === '*') {
            const p = yield* this.evalExpr(node.arg);
            this.curNode = node;
            if (!isPointer(p.type)) {
              this.fail(`cannot dereference '${typeToString(p.type)}': the operand of unary * must be a pointer`, node);
            }
            if (p.type.to.kind === 'void') this.fail('cannot dereference a void* — cast it to a typed pointer first', node);
            return { type: p.type.to, addr: p.value };
          }
          break;
        case 'Index': {
          let base = yield* this.evalExpr(node.object);
          let index = yield* this.evalExpr(node.index);
          this.curNode = node;
          if (!isPointer(base.type) && isPointer(index.type)) [base, index] = [index, base];
          if (!isPointer(base.type)) {
            this.fail(`subscripted value has type '${typeToString(base.type)}', which is neither an array nor a pointer`, node);
          }
          if (index.type.kind !== 'int') this.fail('array subscript is not an integer', node.index);
          const elem = base.type.to;
          if (elem.kind === 'void') this.fail('cannot index a void* — cast it to a typed pointer first', node);
          return { type: elem, addr: (base.value + index.value * elem.size) >>> 0 };
        }
        case 'Member': {
          let type;
          let addr;
          if (node.arrow) {
            const p = yield* this.evalExpr(node.object);
            this.curNode = node;
            if (!isPointer(p.type) || p.type.to.kind !== 'struct') {
              this.fail(`'->' needs a pointer to a struct, but the left side has type '${typeToString(p.type)}'`, node);
            }
            type = p.type.to;
            addr = p.value;
          } else {
            const lv = yield* this.evalLValue(node.object);
            this.curNode = node;
            if (lv.type.kind !== 'struct') {
              const hint = isPointer(lv.type) ? " — use '->' with a pointer" : '';
              this.fail(`'.' needs a struct, but the left side has type '${typeToString(lv.type)}'${hint}`, node);
            }
            type = lv.type;
            addr = lv.addr;
          }
          if (!type.complete) this.fail(`'struct ${type.tag}' is declared but never defined`, node);
          const field = type.fields.find((f) => f.name === node.field);
          if (!field) this.fail(`'struct ${type.tag}' has no field named '${node.field}'`, node);
          return { type: field.type, addr: (addr + field.offset) >>> 0 };
        }
        case 'Str':
          return { type: arrayOf(Types.char, node.bytes.length + 1), addr: this.stringAddrs[node.strIndex] };
        default:
          break;
      }
      this.fail('this expression is not assignable (an lvalue is required)', node);
      return null;
    }

    /* ------------------------------------------------------------------ *
     * Expressions
     * ------------------------------------------------------------------ */

    *evalExpr(node) {
      this.curNode = node;
      switch (node.type) {
        case 'Num':
          return { type: node.ctype, value: node.value };

        case 'Str':
          return { type: CHAR_PTR, value: this.stringAddrs[node.strIndex] };

        case 'Ident': {
          const ref = node.ref;
          if (ref.kind === 'const') return { type: ref.ctype, value: ref.value };
          if (ref.kind === 'builtin') {
            this.fail(`library function '${node.name}' can only be called, not used as a value`, node);
          }
          return this.load(this.identLValue(node), node);
        }

        case 'Index':
        case 'Member': {
          const lv = yield* this.evalLValue(node);
          return this.load(lv, node);
        }

        case 'Unary':
          return yield* this.evalUnary(node);

        case 'Update': {
          const lv = yield* this.evalLValue(node.arg);
          const old = this.load(lv, node.arg);
          this.curNode = node;
          const delta = node.op === '++' ? 1 : -1;
          let next;
          if (isPointer(old.type)) {
            next = { type: old.type, value: (old.value + delta * this.pointeeSize(old.type, node)) >>> 0 };
          } else if (old.type.kind === 'int') {
            next = { type: old.type, value: wrapInt(old.value + delta, old.type) };
          } else if (old.type.kind === 'float') {
            const sum = old.value + delta;
            next = { type: old.type, value: old.type.size === 4 ? Math.fround(sum) : sum };
          } else {
            this.fail(`'${node.op}' cannot be applied to '${typeToString(old.type)}'`, node);
          }
          this.mem.write(lv.addr, lv.type, next.value);
          return node.prefix ? next : old;
        }

        case 'Binary': {
          const a = yield* this.evalExpr(node.left);
          const b = yield* this.evalExpr(node.right);
          this.curNode = node;
          return this.binaryOp(node.op, a, b, node);
        }

        case 'Logical': {
          const a = yield* this.evalExpr(node.left);
          const left = this.truthy(a, node.left);
          if (node.op === '&&' ? !left : left) return { type: Types.int, value: left ? 1 : 0 };
          const b = yield* this.evalExpr(node.right);
          return { type: Types.int, value: this.truthy(b, node.right) ? 1 : 0 };
        }

        case 'Assign': {
          const lv = yield* this.evalLValue(node.left);
          let value;
          if (node.op === '=') {
            value = yield* this.evalExpr(node.right);
          } else {
            const current = this.load(lv, node.left);
            const rhs = yield* this.evalExpr(node.right);
            this.curNode = node;
            value = this.binaryOp(node.op.slice(0, -1), current, rhs, node);
          }
          this.curNode = node;
          return this.storeTo(lv.addr, lv.type, value);
        }

        case 'Cond': {
          const test = yield* this.evalExpr(node.test);
          return yield* this.evalExpr(this.truthy(test, node.test) ? node.then : node.otherwise);
        }

        case 'Comma': {
          let last = VOID_VALUE;
          for (const e of node.exprs) last = yield* this.evalExpr(e);
          return last;
        }

        case 'Cast': {
          const v = yield* this.evalExpr(node.arg);
          this.curNode = node;
          if (node.ctype.kind === 'struct' || node.ctype.kind === 'array') {
            this.fail(`cannot cast to '${typeToString(node.ctype)}'`, node);
          }
          return this.convert(v, node.ctype, true);
        }

        case 'SizeofType':
          return { type: Types.uint, value: node.ctype.size };

        case 'SizeofExpr':
          return { type: Types.uint, value: this.typeOf(node.arg).size };

        case 'Call':
          return yield* this.evalCall(node);

        default:
          this.fail(`internal error: cannot evaluate ${node.type}`, node);
          return null;
      }
    }

    *evalUnary(node) {
      switch (node.op) {
        case '&': {
          const lv = yield* this.evalLValue(node.arg);
          return { type: ptrTo(lv.type), value: lv.addr };
        }
        case '*': {
          const lv = yield* this.evalLValue(node);
          return this.load(lv, node);
        }
        default:
          break;
      }
      const v = yield* this.evalExpr(node.arg);
      this.curNode = node;
      if (node.op === '!') return { type: Types.int, value: this.truthy(v, node.arg) ? 0 : 1 };
      if (!isArith(v.type)) {
        this.fail(`unary '${node.op}' cannot be applied to '${typeToString(v.type)}'`, node);
      }
      if (node.op === '~') {
        if (v.type.kind !== 'int') this.fail("'~' needs an integer operand", node);
        const t = promote(v.type);
        return { type: t, value: t.size === 8 ? bigIntOp('^', v.value, -1, t) : wrapInt(~v.value, t) };
      }
      if (v.type.kind === 'float') return { type: v.type, value: node.op === '-' ? -v.value : v.value };
      const t = promote(v.type);
      return { type: t, value: wrapInt(node.op === '-' ? -v.value : v.value, t) };
    }

    pointeeSize(ptrType, node) {
      const to = ptrType.to;
      if (to.kind === 'struct' && !to.complete) {
        this.fail(`pointer arithmetic on incomplete type 'struct ${to.tag}'`, node);
      }
      return to.kind === 'void' || to.kind === 'func' ? 1 : to.size;
    }

    binaryOp(op, a, b, node) {
      const ta = a.type;
      const tb = b.type;

      if (isPointer(ta) || isPointer(tb)) {
        const cmp = (x, y) => {
          switch (op) {
            case '==': return x === y;
            case '!=': return x !== y;
            case '<': return x < y;
            case '>': return x > y;
            case '<=': return x <= y;
            default: return x >= y;
          }
        };
        switch (op) {
          case '+':
            if (isPointer(ta) && tb.kind === 'int') {
              return { type: ta, value: (a.value + b.value * this.pointeeSize(ta, node)) >>> 0 };
            }
            if (isPointer(tb) && ta.kind === 'int') {
              return { type: tb, value: (b.value + a.value * this.pointeeSize(tb, node)) >>> 0 };
            }
            break;
          case '-':
            if (isPointer(ta) && tb.kind === 'int') {
              return { type: ta, value: (a.value - b.value * this.pointeeSize(ta, node)) >>> 0 };
            }
            if (isPointer(ta) && isPointer(tb)) {
              return { type: Types.int, value: Math.trunc((a.value - b.value) / this.pointeeSize(ta, node)) | 0 };
            }
            break;
          case '==': case '!=': case '<': case '>': case '<=': case '>=':
            if ((isPointer(ta) || ta.kind === 'int') && (isPointer(tb) || tb.kind === 'int')) {
              return { type: Types.int, value: cmp(a.value >>> 0, b.value >>> 0) ? 1 : 0 };
            }
            break;
          default:
            break;
        }
        this.fail(`invalid operands to '${op}': '${typeToString(ta)}' and '${typeToString(tb)}'`, node);
      }

      if (!isArith(ta) || !isArith(tb)) {
        this.fail(`invalid operands to '${op}': '${typeToString(ta)}' and '${typeToString(tb)}'`, node);
      }

      if (op === '<<' || op === '>>') {
        if (ta.kind !== 'int' || tb.kind !== 'int') this.fail(`'${op}' needs integer operands`, node);
        const t = promote(ta);
        const x = wrapInt(a.value, t);
        if (t.size === 8) return { type: t, value: bigIntOp(op, x, b.value, t) };
        const count = b.value & 31;
        if (op === '<<') return { type: t, value: wrapInt(x << count, t) };
        return { type: t, value: t.signed ? x >> count : x >>> count };
      }

      const t = usualArithmetic(ta, tb);
      const x = this.convert(a, t, true).value;
      const y = this.convert(b, t, true).value;

      switch (op) {
        case '==': return { type: Types.int, value: x === y ? 1 : 0 };
        case '!=': return { type: Types.int, value: x !== y ? 1 : 0 };
        case '<': return { type: Types.int, value: x < y ? 1 : 0 };
        case '>': return { type: Types.int, value: x > y ? 1 : 0 };
        case '<=': return { type: Types.int, value: x <= y ? 1 : 0 };
        case '>=': return { type: Types.int, value: x >= y ? 1 : 0 };
        default: break;
      }

      if (t.kind === 'float') {
        let r;
        switch (op) {
          case '+': r = x + y; break;
          case '-': r = x - y; break;
          case '*': r = x * y; break;
          case '/': r = x / y; break;
          default:
            this.fail(`invalid operands to '${op}': '${typeToString(ta)}' and '${typeToString(tb)}'`, node);
        }
        return { type: t, value: t.size === 4 ? Math.fround(r) : r };
      }

      if ((op === '/' || op === '%') && y === 0) {
        this.fail(op === '/' ? 'division by zero' : 'modulo by zero (% with a zero right operand)', node);
      }
      if (t.size === 8) return { type: t, value: bigIntOp(op, x, y, t) };

      let r;
      switch (op) {
        case '+': r = x + y; break;
        case '-': r = x - y; break;
        case '*': r = Math.imul(x, y); break;
        case '/': r = Math.trunc(x / y); break;
        case '%': r = x % y; break;
        case '&': r = x & y; break;
        case '|': r = x | y; break;
        case '^': r = x ^ y; break;
        default:
          this.fail(`internal error: unknown operator '${op}'`, node);
      }
      return { type: t, value: wrapInt(r, t) };
    }

    *evalCall(node) {
      const callee = node.callee;
      let fn = null;
      let builtin = null;
      if (callee.type === 'Ident' && callee.ref.kind === 'func') {
        fn = this.program.functions.get(callee.ref.name);
      } else if (callee.type === 'Ident' && callee.ref.kind === 'builtin') {
        builtin = CViz.Builtins[callee.ref.name];
      } else {
        const target = yield* this.evalExpr(callee);
        this.curNode = node;
        const t = target.type;
        if (!isPointer(t) || t.to.kind !== 'func') {
          this.fail(`called object has type '${typeToString(t)}', which is not a function`, node);
        }
        fn = this.fnByAddr.get(target.value);
        if (!fn) {
          this.fail(target.value === 0
            ? 'call through a NULL function pointer'
            : `call through an invalid function pointer (${hex(target.value)})`, node);
        }
        if (node.args.length !== fn.params.length) {
          this.fail(`${fn.name}() takes ${fn.params.length} argument(s) but ${node.args.length} were given`, node);
        }
      }

      const args = [];
      for (const a of node.args) args.push(yield* this.evalExpr(a));
      this.curNode = node;

      if (builtin) return builtin.call(this, args, node);

      const converted = args.map((a, i) => {
        const want = fn.params[i].type;
        if (want.kind === 'struct') {
          if (a.type !== want) {
            this.fail(`argument ${i + 1} of ${fn.name}() must be '${typeToString(want)}'`, node.args[i]);
          }
          return a;
        }
        this.curNode = node.args[i];
        return this.convert(a, want, false);
      });
      this.curNode = node;
      const result = yield* this.callFunction(fn, converted, node);
      this.curNode = node;
      return result;
    }

    /* ------------------------------------------------------------------ *
     * Static typing (only needed for `sizeof expr`, which never evaluates)
     * ------------------------------------------------------------------ */

    typeOf(node) {
      const decay = (t) => (t.kind === 'array' ? ptrTo(t.of) : t.kind === 'func' ? ptrTo(t) : t);
      switch (node.type) {
        case 'Num':
          return node.ctype;
        case 'Str':
          return arrayOf(Types.char, node.bytes.length + 1);
        case 'Ident': {
          const ref = node.ref;
          if (ref.kind === 'const') return ref.ctype;
          if (ref.kind === 'func') return this.program.functions.get(ref.name).ctype;
          const t = this.identType(ref);
          if (!t) this.fail(`cannot take sizeof '${node.name}'`, node);
          return t;
        }
        case 'Unary': {
          if (node.op === '&') return ptrTo(this.typeOf(node.arg));
          if (node.op === '!') return Types.int;
          const t = decay(this.typeOf(node.arg));
          if (node.op === '*') {
            if (!isPointer(t)) this.fail('cannot dereference a non-pointer', node);
            return t.to;
          }
          return t.kind === 'int' ? promote(t) : t;
        }
        case 'Index': {
          let t = decay(this.typeOf(node.object));
          if (!isPointer(t)) t = decay(this.typeOf(node.index));
          if (!isPointer(t)) this.fail('subscripted value is neither an array nor a pointer', node);
          return t.to;
        }
        case 'Member': {
          let t = this.typeOf(node.object);
          if (node.arrow) t = decay(t).to || t;
          const field = t.kind === 'struct' ? t.fields.find((f) => f.name === node.field) : null;
          if (!field) this.fail(`no field named '${node.field}'`, node);
          return field.type;
        }
        case 'Cast':
          return node.ctype;
        case 'SizeofType':
        case 'SizeofExpr':
          return Types.uint;
        case 'Call': {
          const c = node.callee;
          if (c.type === 'Ident' && c.ref.kind === 'func') return this.program.functions.get(c.ref.name).retType;
          if (c.type === 'Ident' && c.ref.kind === 'builtin') return CViz.Builtins[c.ref.name].ret;
          const t = decay(this.typeOf(c));
          return isPointer(t) && t.to.kind === 'func' ? t.to.ret : Types.int;
        }
        case 'Binary': {
          if (['==', '!=', '<', '>', '<=', '>='].includes(node.op)) return Types.int;
          const a = decay(this.typeOf(node.left));
          const b = decay(this.typeOf(node.right));
          if (isPointer(a) && isPointer(b)) return Types.int;
          if (isPointer(a)) return a;
          if (isPointer(b)) return b;
          if (node.op === '<<' || node.op === '>>') return promote(a);
          return usualArithmetic(a, b);
        }
        case 'Logical':
          return Types.int;
        case 'Assign':
          return this.typeOf(node.left);
        case 'Update':
          return this.typeOf(node.arg);
        case 'Cond':
          return decay(this.typeOf(node.then));
        case 'Comma':
          return decay(this.typeOf(node.exprs[node.exprs.length - 1]));
        default:
          this.fail('cannot determine the type of this expression', node);
          return Types.int;
      }
    }
  }

  /** Lexes, parses, and resolves a C source string. Throws CompileError on failure. */
  function compile(source) {
    const program = CViz.parse(source);
    return CViz.resolve(program, CViz.Builtins, CViz.BuiltinConstants);
  }

  CViz.Interpreter = Interpreter;
  CViz.compile = compile;
  CViz.formatValue = formatValue;
});
