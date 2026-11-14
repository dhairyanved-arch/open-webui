/*
 * The simulated C standard library: stdio, stdlib, string, ctype, and math.
 *
 * Each builtin receives the interpreter plus already-evaluated argument
 * values ({type, value}) and returns a value. All memory traffic goes through
 * the checked Memory API, so e.g. strcpy() into a too-small malloc'd buffer is
 * reported as a heap buffer overflow.
 */
(function (root, factory) {
  const ns = (root.CViz = root.CViz || {});
  factory(ns);
  if (typeof module === 'object' && module.exports) module.exports = ns;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CViz) {
  'use strict';

  const { Types, TypeUtil, RuntimeError, hex } = CViz;
  const { ptrTo } = TypeUtil;

  const VOID_PTR = ptrTo(Types.void);
  const CHAR_PTR = ptrTo(Types.char);

  const Builtins = {};

  function def(name, ret, min, max, call) {
    Builtins[name] = { name, ret, min, max, call };
  }

  const int = (value) => ({ type: Types.int, value: value | 0 });
  const uint = (value) => ({ type: Types.uint, value: value >>> 0 });
  const dbl = (value) => ({ type: Types.double, value });
  const ptr = (value, type) => ({ type: type || VOID_PTR, value: value >>> 0 });
  const VOID = { type: Types.void, value: 0 };

  function num(arg, what, fnName) {
    if (arg.type.kind === 'struct' || arg.type.kind === 'void') {
      throw new RuntimeError(`${fnName}(): ${what} must be a number or pointer`);
    }
    return arg.value;
  }

  function address(arg, fnName) {
    if (arg.type.kind !== 'ptr' && arg.type.kind !== 'int') {
      throw new RuntimeError(`${fnName}(): expected a pointer argument`);
    }
    return arg.value >>> 0;
  }

  /* ------------------------------------------------------------------ *
   * printf-family formatting
   * ------------------------------------------------------------------ */

  function pad(text, width, left, zero) {
    if (width === null || text.length >= width) return text;
    const fill = width - text.length;
    if (left) return text + ' '.repeat(fill);
    if (zero) {
      const m = /^([+\- ]?(?:0[xX])?)(.*)$/.exec(text);
      return m[1] + '0'.repeat(fill) + m[2];
    }
    return ' '.repeat(fill) + text;
  }

  function formatExp(value, precision, upper) {
    let s = value.toExponential(precision);
    s = s.replace(/e([+-])(\d)$/, 'e$10$2');
    return upper ? s.toUpperCase() : s;
  }

  function formatGeneral(value, precision, alt, upper) {
    if (value === 0) return alt ? (0).toFixed(Math.max(precision - 1, 0)) : '0';
    const p = precision === 0 ? 1 : precision;
    const exp = Math.floor(Math.log10(Math.abs(value)));
    // Rounding can bump the exponent (9.9999 → 1e+01), so derive it from the rounded form.
    const rounded = Number(value.toExponential(p - 1));
    const x = rounded === 0 ? exp : Math.floor(Math.log10(Math.abs(rounded)));
    let s;
    if (x < -4 || x >= p) {
      s = value.toExponential(p - 1);
      if (!alt) s = s.replace(/\.?0+e/, 'e');
      s = s.replace(/e([+-])(\d)$/, 'e$10$2');
    } else {
      s = value.toFixed(Math.max(p - 1 - x, 0));
      if (!alt && s.includes('.')) s = s.replace(/\.?0+$/, '');
    }
    return upper ? s.toUpperCase() : s;
  }

  function toBigUnsigned(value, bits) {
    return BigInt.asUintN(bits, BigInt(Number.isFinite(value) ? Math.trunc(value) : 0));
  }

  function format(interp, fnName, fmt, args, start) {
    const mem = interp.mem;
    let out = '';
    let ai = start;
    const nextArg = (spec) => {
      if (ai >= args.length) {
        throw new RuntimeError(`${fnName}(): the format string has '${spec}' but no matching argument`);
      }
      return args[ai++];
    };
    const re = /%([-+ #0]*)(\*|\d+)?(?:\.(\*|\d*))?(hh|h|ll|l|z|j|t|L)?(.)/g;
    let last = 0;
    let m;
    while ((m = re.exec(fmt)) !== null) {
      out += fmt.slice(last, m.index);
      last = re.lastIndex;
      const flags = m[1];
      const conv = m[5];
      if (conv === '%') {
        out += '%';
        continue;
      }
      let width = null;
      let left = flags.includes('-');
      if (m[2] === '*') {
        width = num(nextArg('*'), 'width', fnName) | 0;
        if (width < 0) {
          left = true;
          width = -width;
        }
      } else if (m[2] !== undefined) {
        width = parseInt(m[2], 10);
      }
      let precision = null;
      if (m[3] === '*') precision = num(nextArg('.*'), 'precision', fnName) | 0;
      else if (m[3] !== undefined) precision = m[3] === '' ? 0 : parseInt(m[3], 10);
      const length = m[4] || '';
      const zero = flags.includes('0') && !left;
      const plus = flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
      const alt = flags.includes('#');
      const spec = m[0];
      let text;

      switch (conv) {
        case 'd':
        case 'i': {
          const a = nextArg(spec);
          if (a.type.kind === 'float') {
            interp.warn(`${fnName}(): '${spec}' expects an integer but the argument is ${a.type.name}`);
          }
          let v = Math.trunc(num(a, 'argument', fnName));
          if (!Number.isFinite(v)) v = 0;
          if (length === 'll' || length === 'j') v = Number(BigInt.asIntN(64, BigInt(v)));
          else if (length === 'hh') v = (v << 24) >> 24;
          else if (length === 'h') v = (v << 16) >> 16;
          else v |= 0;
          let digits = Math.abs(v).toString();
          if (precision !== null) digits = digits.padStart(precision, '0');
          text = (v < 0 ? '-' : plus) + digits;
          text = pad(text, width, left, zero && precision === null);
          break;
        }
        case 'u':
        case 'x':
        case 'X':
        case 'o': {
          const a = nextArg(spec);
          const raw = num(a, 'argument', fnName);
          const bits = length === 'll' || length === 'j' ? 64 : length === 'hh' ? 8 : length === 'h' ? 16 : 32;
          const big = toBigUnsigned(raw, bits);
          const radix = conv === 'u' ? 10 : conv === 'o' ? 8 : 16;
          let digits = big.toString(radix);
          if (conv === 'X') digits = digits.toUpperCase();
          if (precision !== null) digits = digits.padStart(precision, '0');
          let prefix = '';
          if (alt && big !== 0n) prefix = conv === 'x' ? '0x' : conv === 'X' ? '0X' : conv === 'o' ? '0' : '';
          text = pad(prefix + digits, width, left, zero && precision === null);
          break;
        }
        case 'c': {
          const a = nextArg(spec);
          text = pad(String.fromCharCode(num(a, 'argument', fnName) & 0xff), width, left, false);
          break;
        }
        case 's': {
          const a = nextArg(spec);
          if (a.type.kind !== 'ptr') {
            throw new RuntimeError(
              `${fnName}(): '%s' needs a char* but the argument has type '${TypeUtil.typeToString(a.type)}'`
            );
          }
          let s = a.value === 0 ? '(null)' : mem.readString(a.value);
          if (precision !== null) s = s.slice(0, precision);
          text = pad(s, width, left, false);
          break;
        }
        case 'f':
        case 'F':
        case 'e':
        case 'E':
        case 'g':
        case 'G': {
          const a = nextArg(spec);
          if (a.type.kind !== 'float') {
            interp.warn(
              `${fnName}(): '${spec}' expects a double but the argument is ` +
                `'${TypeUtil.typeToString(a.type)}' — cast it with (double)`
            );
          }
          const v = Number(num(a, 'argument', fnName));
          const p = precision === null ? 6 : precision;
          const upper = conv === 'F' || conv === 'E' || conv === 'G';
          let body;
          if (!Number.isFinite(v)) {
            body = Number.isNaN(v) ? 'nan' : 'inf';
            if (upper) body = body.toUpperCase();
          } else if (conv === 'f' || conv === 'F') {
            body = Math.abs(v).toFixed(Math.min(p, 100));
            if (alt && p === 0) body += '.';
          } else if (conv === 'e' || conv === 'E') {
            body = formatExp(Math.abs(v), Math.min(p, 100), upper);
          } else {
            body = formatGeneral(Math.abs(v), Math.min(p, 100), alt, upper);
          }
          const negative = v < 0 || Object.is(v, -0);
          text = pad((negative ? '-' : plus) + body, width, left, zero && Number.isFinite(v));
          break;
        }
        case 'p': {
          const a = nextArg(spec);
          const v = num(a, 'argument', fnName) >>> 0;
          text = pad(v === 0 ? '(nil)' : hex(v), width, left, false);
          break;
        }
        default:
          throw new RuntimeError(`${fnName}(): unsupported conversion '${spec}'`);
      }
      out += text;
    }
    out += fmt.slice(last);
    return out;
  }

  /* ------------------------------------------------------------------ *
   * scanf
   * ------------------------------------------------------------------ */

  function scan(interp, fmt, args) {
    const mem = interp.mem;
    const input = interp.stdin;
    let pos = interp.stdinPos;
    let ai = 1;
    let assigned = 0;
    let hitEnd = false;
    const skipSpace = () => {
      while (pos < input.length && /\s/.test(input[pos])) pos++;
    };
    const target = (spec) => {
      if (ai >= args.length) throw new RuntimeError(`scanf(): '${spec}' has no matching pointer argument`);
      const a = args[ai++];
      if (a.type.kind !== 'ptr') {
        throw new RuntimeError(
          `scanf(): '${spec}' needs a pointer (did you forget the '&'?) but got '${TypeUtil.typeToString(a.type)}'`
        );
      }
      return a.value;
    };

    const re = /%(\*)?(\d+)?(hh|h|ll|l|L)?(.)|(\s+)|([^%\s]+)/g;
    let m;
    scanning: while ((m = re.exec(fmt)) !== null) {
      if (m[5] !== undefined) {
        skipSpace();
        continue;
      }
      if (m[6] !== undefined) {
        for (const ch of m[6]) {
          if (input[pos] !== ch) break scanning;
          pos++;
        }
        continue;
      }
      const suppress = !!m[1];
      const maxWidth = m[2] ? parseInt(m[2], 10) : Infinity;
      const length = m[3] || '';
      const conv = m[4];
      const spec = m[0];

      if (conv === '%') {
        skipSpace();
        if (input[pos] !== '%') break;
        pos++;
        continue;
      }
      if (conv === 'c') {
        if (pos >= input.length) {
          hitEnd = true;
          break;
        }
        const code = input.charCodeAt(pos++) & 0xff;
        if (!suppress) {
          mem.write(target(spec), Types.char, code);
          assigned++;
        }
        continue;
      }

      skipSpace();
      if (pos >= input.length) {
        hitEnd = true;
        break;
      }
      const rest = input.slice(pos, maxWidth === Infinity ? undefined : pos + maxWidth);

      if (conv === 's') {
        const word = /^\S+/.exec(rest)[0];
        pos += word.length;
        if (!suppress) {
          const addr = target(spec);
          for (let i = 0; i < word.length; i++) mem.writeByte(addr + i, word.charCodeAt(i));
          mem.writeByte(addr + word.length, 0);
          assigned++;
        }
        continue;
      }

      let pattern;
      if (conv === 'd' || conv === 'u') pattern = /^[+-]?\d+/;
      else if (conv === 'i') pattern = /^[+-]?(0[xX][0-9a-fA-F]+|\d+)/;
      else if (conv === 'x' || conv === 'X') pattern = /^[+-]?(0[xX])?[0-9a-fA-F]+/;
      else if (conv === 'o') pattern = /^[+-]?[0-7]+/;
      else if ('fFeEgG'.includes(conv)) pattern = /^[+-]?(\d+\.?\d*([eE][+-]?\d+)?|\.\d+([eE][+-]?\d+)?)/;
      else throw new RuntimeError(`scanf(): unsupported conversion '${spec}'`);

      const hit = pattern.exec(rest);
      if (!hit) break; // matching failure: leave the offending input in place
      pos += hit[0].length;
      if (suppress) continue;

      const addr = target(spec);
      if ('fFeEgG'.includes(conv)) {
        mem.write(addr, length === 'l' || length === 'L' ? Types.double : Types.float, parseFloat(hit[0]));
      } else {
        let value;
        if (conv === 'x' || conv === 'X') value = parseInt(hit[0], 16);
        else if (conv === 'o') value = parseInt(hit[0], 8);
        else if (conv === 'i') value = /0[xX]/.test(hit[0]) ? parseInt(hit[0], 16) : parseInt(hit[0], 10);
        else value = parseInt(hit[0], 10);
        const unsigned = conv !== 'd' && conv !== 'i';
        let type;
        if (length === 'll') type = unsigned ? Types.ullong : Types.llong;
        else if (length === 'hh') type = unsigned ? Types.uchar : Types.char;
        else if (length === 'h') type = unsigned ? Types.ushort : Types.short;
        else type = unsigned ? Types.uint : Types.int;
        mem.write(addr, type, value);
      }
      assigned++;
    }

    // Echo what was consumed, the way a terminal shows what the user typed.
    const typed = input.slice(interp.stdinPos, pos).replace(/^\s+/, '');
    if (typed) interp.log('in', typed + '\n');
    interp.stdinPos = pos;
    if (hitEnd && assigned === 0) {
      // Reaching the end of real input is normal (`while (scanf(...) == 1)`); only
      // flag the case where no input was provided at all.
      if (input.trim() === '') {
        interp.warn('scanf(): standard input is empty — type the program input into the "stdin" box and restart');
      }
      return -1;
    }
    return assigned;
  }

  /* ------------------------------------------------------------------ *
   * <stdio.h>
   * ------------------------------------------------------------------ */

  def('printf', Types.int, 1, Infinity, (interp, args) => {
    const fmt = interp.mem.readString(address(args[0], 'printf'));
    const text = format(interp, 'printf', fmt, args, 1);
    interp.print(text);
    return int(text.length);
  });

  def('sprintf', Types.int, 2, Infinity, (interp, args) => {
    const dst = address(args[0], 'sprintf');
    const fmt = interp.mem.readString(address(args[1], 'sprintf'));
    const text = format(interp, 'sprintf', fmt, args, 2);
    for (let i = 0; i < text.length; i++) interp.mem.writeByte(dst + i, text.charCodeAt(i));
    interp.mem.writeByte(dst + text.length, 0);
    return int(text.length);
  });

  def('puts', Types.int, 1, 1, (interp, args) => {
    interp.print(interp.mem.readString(address(args[0], 'puts')) + '\n');
    return int(1);
  });

  def('putchar', Types.int, 1, 1, (interp, args) => {
    const c = num(args[0], 'argument', 'putchar') & 0xff;
    interp.print(String.fromCharCode(c));
    return int(c);
  });

  def('getchar', Types.int, 0, 0, (interp) => {
    if (interp.stdinPos >= interp.stdin.length) return int(-1);
    return int(interp.stdin.charCodeAt(interp.stdinPos++) & 0xff);
  });

  def('scanf', Types.int, 1, Infinity, (interp, args) => {
    const fmt = interp.mem.readString(address(args[0], 'scanf'));
    return int(scan(interp, fmt, args));
  });

  /* ------------------------------------------------------------------ *
   * <stdlib.h>
   * ------------------------------------------------------------------ */

  def('malloc', VOID_PTR, 1, 1, (interp, args, node) => {
    const size = num(args[0], 'size', 'malloc');
    if (size < 0) throw new RuntimeError(`malloc(): negative size ${size}`);
    const addr = interp.mem.malloc(size, node.loc.line);
    interp.event('heap', addr
      ? `malloc(${size}) reserved ${size} byte${size === 1 ? '' : 's'} on the heap at ${hex(addr)}`
      : `malloc(${size}) returned NULL`);
    return ptr(addr);
  });

  def('calloc', VOID_PTR, 2, 2, (interp, args, node) => {
    const count = num(args[0], 'count', 'calloc');
    const size = num(args[1], 'size', 'calloc');
    if (count < 0 || size < 0) throw new RuntimeError('calloc(): negative size');
    const addr = interp.mem.calloc(count, size, node.loc.line);
    interp.event('heap', addr
      ? `calloc(${count}, ${size}) reserved ${count * size} zeroed bytes on the heap at ${hex(addr)}`
      : `calloc(${count}, ${size}) returned NULL`);
    return ptr(addr);
  });

  def('realloc', VOID_PTR, 2, 2, (interp, args, node) => {
    const old = address(args[0], 'realloc');
    const size = num(args[1], 'size', 'realloc');
    const addr = interp.mem.realloc(old, size, node.loc.line);
    interp.event('heap', addr === old
      ? `realloc() resized the block at ${hex(old)} in place to ${size} bytes`
      : `realloc() moved the block from ${hex(old)} to ${hex(addr)} (${size} bytes)`);
    return ptr(addr);
  });

  def('free', Types.void, 1, 1, (interp, args, node) => {
    const addr = address(args[0], 'free');
    interp.mem.free(addr, node.loc.line);
    interp.event('heap', addr ? `free() released the heap block at ${hex(addr)}` : 'free(NULL) does nothing');
    return VOID;
  });

  def('exit', Types.void, 1, 1, (interp, args) => {
    throw new CViz.ExitSignal(num(args[0], 'status', 'exit') | 0);
  });

  def('abs', Types.int, 1, 1, (interp, args) => int(Math.abs(num(args[0], 'argument', 'abs') | 0)));
  def('labs', Types.long, 1, 1, (interp, args) => ({
    type: Types.long,
    value: Math.abs(num(args[0], 'argument', 'labs') | 0) | 0,
  }));

  def('atoi', Types.int, 1, 1, (interp, args) => {
    const s = interp.mem.readString(address(args[0], 'atoi'));
    const m = /^\s*[+-]?\d+/.exec(s);
    return int(m ? parseInt(m[0], 10) : 0);
  });

  def('atof', Types.double, 1, 1, (interp, args) => {
    const s = interp.mem.readString(address(args[0], 'atof'));
    const v = parseFloat(s);
    return dbl(Number.isNaN(v) ? 0 : v);
  });

  def('rand', Types.int, 0, 0, (interp) => {
    interp.rngState = (Math.imul(interp.rngState, 1103515245) + 12345) & 0x7fffffff;
    return int(interp.rngState);
  });

  def('srand', Types.void, 1, 1, (interp, args) => {
    interp.rngState = num(args[0], 'seed', 'srand') >>> 0;
    return VOID;
  });

  def('time', Types.long, 0, 1, () => ({ type: Types.long, value: Math.floor(Date.now() / 1000) | 0 }));

  /* ------------------------------------------------------------------ *
   * <string.h>
   * ------------------------------------------------------------------ */

  def('strlen', Types.uint, 1, 1, (interp, args) => {
    const s = address(args[0], 'strlen');
    let n = 0;
    while (interp.mem.readByte(s + n) !== 0) n++;
    return uint(n);
  });

  def('strcpy', CHAR_PTR, 2, 2, (interp, args) => {
    const dst = address(args[0], 'strcpy');
    const src = address(args[1], 'strcpy');
    for (let i = 0; ; i++) {
      const c = interp.mem.readByte(src + i);
      interp.mem.writeByte(dst + i, c);
      if (c === 0) break;
    }
    return ptr(dst, CHAR_PTR);
  });

  def('strncpy', CHAR_PTR, 3, 3, (interp, args) => {
    const dst = address(args[0], 'strncpy');
    const src = address(args[1], 'strncpy');
    const n = num(args[2], 'count', 'strncpy') >>> 0;
    let ended = false;
    for (let i = 0; i < n; i++) {
      const c = ended ? 0 : interp.mem.readByte(src + i);
      if (c === 0) ended = true;
      interp.mem.writeByte(dst + i, c);
    }
    return ptr(dst, CHAR_PTR);
  });

  def('strcat', CHAR_PTR, 2, 2, (interp, args) => {
    const dst = address(args[0], 'strcat');
    const src = address(args[1], 'strcat');
    let end = 0;
    while (interp.mem.readByte(dst + end) !== 0) end++;
    for (let i = 0; ; i++) {
      const c = interp.mem.readByte(src + i);
      interp.mem.writeByte(dst + end + i, c);
      if (c === 0) break;
    }
    return ptr(dst, CHAR_PTR);
  });

  function compare(interp, a, b, limit) {
    for (let i = 0; i < limit; i++) {
      const x = interp.mem.readByte(a + i);
      const y = interp.mem.readByte(b + i);
      if (x !== y) return x < y ? -1 : 1;
      if (x === 0) return 0;
    }
    return 0;
  }

  def('strcmp', Types.int, 2, 2, (interp, args) =>
    int(compare(interp, address(args[0], 'strcmp'), address(args[1], 'strcmp'), Infinity)));

  def('strncmp', Types.int, 3, 3, (interp, args) =>
    int(compare(interp, address(args[0], 'strncmp'), address(args[1], 'strncmp'),
      num(args[2], 'count', 'strncmp') >>> 0)));

  def('strchr', CHAR_PTR, 2, 2, (interp, args) => {
    const s = address(args[0], 'strchr');
    const target = num(args[1], 'character', 'strchr') & 0xff;
    for (let i = 0; ; i++) {
      const c = interp.mem.readByte(s + i);
      if (c === target) return ptr(s + i, CHAR_PTR);
      if (c === 0) return ptr(0, CHAR_PTR);
    }
  });

  def('strrchr', CHAR_PTR, 2, 2, (interp, args) => {
    const s = address(args[0], 'strrchr');
    const target = num(args[1], 'character', 'strrchr') & 0xff;
    let found = 0;
    for (let i = 0; ; i++) {
      const c = interp.mem.readByte(s + i);
      if (c === target) found = s + i;
      if (c === 0) return ptr(found, CHAR_PTR);
    }
  });

  def('strstr', CHAR_PTR, 2, 2, (interp, args) => {
    const hayAddr = address(args[0], 'strstr');
    const hay = interp.mem.readString(hayAddr);
    const needle = interp.mem.readString(address(args[1], 'strstr'));
    const at = hay.indexOf(needle);
    return ptr(at < 0 ? 0 : hayAddr + at, CHAR_PTR);
  });

  def('memset', VOID_PTR, 3, 3, (interp, args) => {
    const dst = address(args[0], 'memset');
    interp.mem.fill(dst, num(args[1], 'value', 'memset'), num(args[2], 'count', 'memset') >>> 0);
    return ptr(dst);
  });

  const memcpy = (name) => (interp, args) => {
    const dst = address(args[0], name);
    interp.mem.copy(dst, address(args[1], name), num(args[2], 'count', name) >>> 0);
    return ptr(dst);
  };
  def('memcpy', VOID_PTR, 3, 3, memcpy('memcpy'));
  def('memmove', VOID_PTR, 3, 3, memcpy('memmove'));

  def('memcmp', Types.int, 3, 3, (interp, args) => {
    const a = address(args[0], 'memcmp');
    const b = address(args[1], 'memcmp');
    const n = num(args[2], 'count', 'memcmp') >>> 0;
    for (let i = 0; i < n; i++) {
      const x = interp.mem.readByte(a + i);
      const y = interp.mem.readByte(b + i);
      if (x !== y) return int(x < y ? -1 : 1);
    }
    return int(0);
  });

  /* ------------------------------------------------------------------ *
   * <ctype.h>
   * ------------------------------------------------------------------ */

  const ctype = (name, test) =>
    def(name, Types.int, 1, 1, (interp, args) => {
      const c = num(args[0], 'argument', name) | 0;
      return int(c >= 0 && c < 256 && test(c) ? 1 : 0);
    });

  const isUpper = (c) => c >= 65 && c <= 90;
  const isLower = (c) => c >= 97 && c <= 122;
  const isDigitCode = (c) => c >= 48 && c <= 57;
  ctype('isdigit', isDigitCode);
  ctype('isupper', isUpper);
  ctype('islower', isLower);
  ctype('isalpha', (c) => isUpper(c) || isLower(c));
  ctype('isalnum', (c) => isUpper(c) || isLower(c) || isDigitCode(c));
  ctype('isspace', (c) => c === 32 || (c >= 9 && c <= 13));
  ctype('ispunct', (c) => c > 32 && c < 127 && !(isUpper(c) || isLower(c) || isDigitCode(c)));
  ctype('isxdigit', (c) => isDigitCode(c) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102));

  def('toupper', Types.int, 1, 1, (interp, args) => {
    const c = num(args[0], 'argument', 'toupper') | 0;
    return int(isLower(c) ? c - 32 : c);
  });
  def('tolower', Types.int, 1, 1, (interp, args) => {
    const c = num(args[0], 'argument', 'tolower') | 0;
    return int(isUpper(c) ? c + 32 : c);
  });

  /* ------------------------------------------------------------------ *
   * <math.h>
   * ------------------------------------------------------------------ */

  const math1 = (name, fn) =>
    def(name, Types.double, 1, 1, (interp, args) => dbl(fn(Number(num(args[0], 'argument', name)))));
  const math2 = (name, fn) =>
    def(name, Types.double, 2, 2, (interp, args) =>
      dbl(fn(Number(num(args[0], 'argument', name)), Number(num(args[1], 'argument', name)))));

  math1('sqrt', Math.sqrt);
  math1('cbrt', Math.cbrt);
  math1('fabs', Math.abs);
  math1('floor', Math.floor);
  math1('ceil', Math.ceil);
  math1('trunc', Math.trunc);
  // C rounds halfway cases away from zero; Math.round rounds them toward +infinity.
  math1('round', (x) => (x < 0 ? -Math.round(-x) : Math.round(x)));
  math1('sin', Math.sin);
  math1('cos', Math.cos);
  math1('tan', Math.tan);
  math1('exp', Math.exp);
  math1('log', Math.log);
  math1('log10', Math.log10);
  math1('log2', Math.log2);
  math2('pow', Math.pow);
  math2('fmod', (a, b) => a % b);
  math2('fmax', Math.max);
  math2('fmin', Math.min);

  /* ------------------------------------------------------------------ *
   * Predefined constants
   * ------------------------------------------------------------------ */

  const BuiltinConstants = {
    NULL: { value: 0, ctype: VOID_PTR },
    EOF: { value: -1, ctype: Types.int },
    true: { value: 1, ctype: Types.int },
    false: { value: 0, ctype: Types.int },
    INT_MAX: { value: 2147483647, ctype: Types.int },
    INT_MIN: { value: -2147483648, ctype: Types.int },
    UINT_MAX: { value: 4294967295, ctype: Types.uint },
    CHAR_MAX: { value: 127, ctype: Types.int },
    CHAR_MIN: { value: -128, ctype: Types.int },
    RAND_MAX: { value: 2147483647, ctype: Types.int },
    EXIT_SUCCESS: { value: 0, ctype: Types.int },
    EXIT_FAILURE: { value: 1, ctype: Types.int },
    M_PI: { value: Math.PI, ctype: Types.double },
    M_E: { value: Math.E, ctype: Types.double },
  };

  CViz.Builtins = Builtins;
  CViz.BuiltinConstants = BuiltinConstants;
  CViz.formatPrintf = format;
});
