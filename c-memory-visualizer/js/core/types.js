/*
 * C type system for the simulator.
 *
 * Models an ILP32 little-endian machine (the classic 32-bit Linux layout):
 *   char 1, short 2, int 4, long 4, long long 8, float 4, double 8, pointers 4.
 */
(function (root, factory) {
  const ns = (root.CViz = root.CViz || {});
  factory(ns);
  if (typeof module === 'object' && module.exports) module.exports = ns;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CViz) {
  'use strict';

  const POINTER_SIZE = 4;

  function intType(name, size, signed, rank) {
    return Object.freeze({ kind: 'int', name, size, align: size, signed, rank });
  }

  const Types = {
    void: Object.freeze({ kind: 'void', name: 'void', size: 1, align: 1 }),
    bool: Object.freeze({ kind: 'int', name: 'bool', size: 1, align: 1, signed: false, rank: 0, isBool: true }),
    char: intType('char', 1, true, 1),
    uchar: intType('unsigned char', 1, false, 1),
    short: intType('short', 2, true, 2),
    ushort: intType('unsigned short', 2, false, 2),
    int: intType('int', 4, true, 3),
    uint: intType('unsigned int', 4, false, 3),
    long: intType('long', 4, true, 4),
    ulong: intType('unsigned long', 4, false, 4),
    llong: intType('long long', 8, true, 5),
    ullong: intType('unsigned long long', 8, false, 5),
    float: Object.freeze({ kind: 'float', name: 'float', size: 4, align: 4 }),
    double: Object.freeze({ kind: 'float', name: 'double', size: 8, align: 8 }),
  };

  const ptrCache = new WeakMap();

  function ptrTo(type) {
    let p = ptrCache.get(type);
    if (!p) {
      p = Object.freeze({ kind: 'ptr', to: type, size: POINTER_SIZE, align: POINTER_SIZE });
      ptrCache.set(type, p);
    }
    return p;
  }

  function arrayOf(type, length) {
    return Object.freeze({
      kind: 'array',
      of: type,
      length,
      size: type.size * length,
      align: type.align,
    });
  }

  function funcType(ret, params, variadic) {
    return Object.freeze({ kind: 'func', ret, params, variadic: !!variadic, size: 1, align: 1 });
  }

  /** Creates an incomplete struct type; call completeStruct() once the fields are known. */
  function structType(tag) {
    return { kind: 'struct', tag, fields: [], size: 0, align: 1, complete: false };
  }

  function alignUp(n, align) {
    return Math.ceil(n / align) * align;
  }

  function completeStruct(type, fieldDecls) {
    let offset = 0;
    let align = 1;
    type.fields = [];
    for (const f of fieldDecls) {
      offset = alignUp(offset, f.type.align);
      type.fields.push({ name: f.name, type: f.type, offset });
      offset += f.type.size;
      if (f.type.align > align) align = f.type.align;
    }
    type.align = align;
    type.size = Math.max(1, alignUp(offset, align));
    type.complete = true;
    return type;
  }

  const isInteger = (t) => t.kind === 'int';
  const isFloat = (t) => t.kind === 'float';
  const isArith = (t) => t.kind === 'int' || t.kind === 'float';
  const isPointer = (t) => t.kind === 'ptr';
  const isArray = (t) => t.kind === 'array';
  const isStruct = (t) => t.kind === 'struct';
  const isScalar = (t) => isArith(t) || isPointer(t);
  const isVoid = (t) => t.kind === 'void';

  function sameType(a, b) {
    if (a === b) return true;
    if (a.kind !== b.kind) return false;
    switch (a.kind) {
      case 'int':
        return a.name === b.name;
      case 'float':
        return a.name === b.name;
      case 'ptr':
        return sameType(a.to, b.to);
      case 'array':
        return a.length === b.length && sameType(a.of, b.of);
      case 'func':
        return (
          sameType(a.ret, b.ret) &&
          a.params.length === b.params.length &&
          a.params.every((p, i) => sameType(p.type, b.params[i].type))
        );
      default:
        return false;
    }
  }

  /** Integer promotion: anything narrower than int becomes int. */
  function promote(t) {
    if (t.kind === 'int' && t.rank < Types.int.rank) return Types.int;
    return t;
  }

  /** The usual arithmetic conversions for a binary operator. */
  function usualArithmetic(a, b) {
    if (a === Types.double || b === Types.double) return Types.double;
    if (a.kind === 'float' || b.kind === 'float') return Types.float;
    a = promote(a);
    b = promote(b);
    if (a.rank === b.rank) return a.signed ? b : a;
    const hi = a.rank > b.rank ? a : b;
    const lo = a.rank > b.rank ? b : a;
    if (hi.signed && !lo.signed && hi.size === lo.size) {
      return hi === Types.long ? Types.ulong : Types.ullong;
    }
    return hi;
  }

  /** Renders a declaration the way C spells it: `int *p`, `char s[8]`, `int (*fp)(int)`. */
  function declString(type, name) {
    let inner = name || '';
    let t = type;
    for (;;) {
      if (t.kind === 'ptr') {
        inner = '*' + inner;
        if (t.to.kind === 'array' || t.to.kind === 'func') inner = '(' + inner + ')';
        t = t.to;
      } else if (t.kind === 'array') {
        inner = inner + '[' + t.length + ']';
        t = t.of;
      } else if (t.kind === 'func') {
        const params = t.params.map((p) => declString(p.type, '')).join(', ');
        inner = inner + '(' + (params || 'void') + (t.variadic ? ', ...' : '') + ')';
        t = t.ret;
      } else {
        break;
      }
    }
    const base = t.kind === 'struct' ? 'struct ' + t.tag : t.name;
    if (!inner) return base;
    return base + ' ' + inner;
  }

  function typeToString(type) {
    return declString(type, '');
  }

  CViz.POINTER_SIZE = POINTER_SIZE;
  CViz.Types = Types;
  CViz.TypeUtil = {
    ptrTo,
    arrayOf,
    funcType,
    structType,
    completeStruct,
    alignUp,
    isInteger,
    isFloat,
    isArith,
    isPointer,
    isArray,
    isStruct,
    isScalar,
    isVoid,
    sameType,
    promote,
    usualArithmetic,
    declString,
    typeToString,
  };
});
