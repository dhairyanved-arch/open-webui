/*
 * Recursive-descent parser for the supported C subset.
 *
 * Output is a plain-object AST. Every node carries `loc`
 * ({line, col, endLine, endCol}) so the debugger can highlight exactly the
 * source range that is about to execute.
 */
(function (root, factory) {
  const ns = (root.CViz = root.CViz || {});
  factory(ns);
  if (typeof module === 'object' && module.exports) module.exports = ns;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CViz) {
  'use strict';

  const { CompileError, Types, TypeUtil } = CViz;
  const { ptrTo, arrayOf, funcType, structType, completeStruct } = TypeUtil;

  const TYPE_KEYWORDS = new Set([
    'void', 'char', 'short', 'int', 'long', 'float', 'double', 'signed', 'unsigned',
    '_Bool', 'struct', 'union', 'enum', 'const', 'volatile', 'static', 'extern',
    'register', 'auto', 'inline', 'typedef', 'restrict',
  ]);

  const BINARY_PRECEDENCE = {
    '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5,
    '==': 6, '!=': 6,
    '<': 7, '>': 7, '<=': 7, '>=': 7,
    '<<': 8, '>>': 8,
    '+': 9, '-': 9,
    '*': 10, '/': 10, '%': 10,
  };

  const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']);

  class Parser {
    constructor(tokens) {
      this.toks = tokens;
      this.i = 0;
      this.structs = new Map();
      this.enumConsts = new Map();
      this.anonCount = 0;
      this.typedefs = new Map([
        ['size_t', Types.uint],
        ['bool', Types.bool],
        ['int8_t', Types.char],
        ['uint8_t', Types.uchar],
        ['int16_t', Types.short],
        ['uint16_t', Types.ushort],
        ['int32_t', Types.int],
        ['uint32_t', Types.uint],
        ['int64_t', Types.llong],
        ['uint64_t', Types.ullong],
      ]);
    }

    /* ---------------------------- token helpers ---------------------------- */

    get tok() {
      return this.toks[this.i];
    }

    peekTok(n) {
      return this.toks[Math.min(this.i + n, this.toks.length - 1)];
    }

    next() {
      const t = this.toks[this.i];
      if (this.i < this.toks.length - 1) this.i++;
      return t;
    }

    is(value) {
      const t = this.tok;
      return (t.type === 'punct' || t.type === 'keyword') && t.value === value;
    }

    accept(value) {
      if (this.is(value)) {
        this.next();
        return true;
      }
      return false;
    }

    describe(t) {
      if (t.type === 'eof') return 'end of file';
      if (t.type === 'string') return 'string literal';
      if (t.type === 'char') return 'character constant';
      return `'${t.value}'`;
    }

    error(message, tokOrLoc) {
      const t = tokOrLoc || this.tok;
      throw new CompileError(message, {
        line: t.line, col: t.col, endLine: t.endLine, endCol: t.endCol,
      });
    }

    expect(value) {
      if (!this.is(value)) {
        // Point at the end of the previous token: that is where the missing piece belongs.
        const prev = this.toks[Math.max(0, this.i - 1)];
        const where = this.tok.line !== prev.endLine
          ? { line: prev.endLine, col: prev.endCol, endLine: prev.endLine, endCol: prev.endCol + 1 }
          : this.tok;
        this.error(`expected '${value}' before ${this.describe(this.tok)}`, where);
      }
      return this.next();
    }

    expectIdent(what) {
      if (this.tok.type !== 'ident') {
        this.error(`expected ${what || 'an identifier'} but found ${this.describe(this.tok)}`);
      }
      return this.next();
    }

    locFrom(startTok) {
      const end = this.toks[Math.max(0, this.i - 1)];
      return { line: startTok.line, col: startTok.col, endLine: end.endLine, endCol: end.endCol };
    }

    node(type, startTok, props) {
      return Object.assign({ type, loc: this.locFrom(startTok) }, props);
    }

    /* ------------------------------ top level ------------------------------ */

    parseProgram() {
      const program = {
        type: 'Program',
        globals: [],
        functions: new Map(),
        prototypes: new Map(),
        structs: this.structs,
        enumConsts: this.enumConsts,
      };
      while (this.tok.type !== 'eof') {
        if (this.accept(';')) continue;
        this.parseExternalDeclaration(program);
      }
      return program;
    }

    parseExternalDeclaration(program) {
      const start = this.tok;
      const spec = this.parseDeclSpecifiers();
      if (!spec) this.error(`expected a declaration but found ${this.describe(this.tok)}`);

      if (this.accept(';')) return; // e.g. a bare `struct Node { ... };`

      let first = true;
      for (;;) {
        const declStart = this.tok;
        const d = this.parseDeclarator(spec.type, false);
        if (spec.isTypedef) {
          this.typedefs.set(d.name, d.type);
        } else if (d.type.kind === 'func') {
          const fn = {
            type: 'FuncDef',
            name: d.name,
            ctype: d.type,
            retType: d.type.ret,
            params: d.params,
            body: null,
            loc: this.locFrom(start),
            nameLoc: d.loc,
          };
          if (first && this.is('{')) {
            if (program.functions.has(d.name)) {
              this.error(`redefinition of function '${d.name}'`, declStart);
            }
            fn.params.forEach((p) => {
              if (!p.name) this.error(`parameter of '${d.name}' needs a name`, declStart);
            });
            fn.body = this.parseBlock();
            fn.loc = this.locFrom(start);
            program.functions.set(d.name, fn);
            return;
          }
          program.prototypes.set(d.name, fn);
        } else {
          if (d.type.kind === 'void') this.error(`variable '${d.name}' declared void`, declStart);
          const decl = { name: d.name, ctype: d.type, init: null, loc: d.loc };
          if (this.accept('=')) decl.init = this.parseInitializer();
          decl.ctype = this.completeArrayType(decl, declStart);
          decl.loc = this.locFrom(declStart);
          program.globals.push(decl);
        }
        first = false;
        if (!this.accept(',')) break;
      }
      this.expect(';');
    }

    /* ----------------------------- declarations ---------------------------- */

    isTypeStart(t) {
      t = t || this.tok;
      if (t.type === 'keyword') return TYPE_KEYWORDS.has(t.value);
      return t.type === 'ident' && this.typedefs.has(t.value);
    }

    /** Parses `static const unsigned long int` style specifiers into a base type. */
    parseDeclSpecifiers() {
      if (!this.isTypeStart()) return null;
      const start = this.tok;
      let base = null;
      let longs = 0;
      let short = false;
      let signedness = null;
      let isTypedef = false;
      let isStatic = false;
      let sawAny = false;

      for (;;) {
        const t = this.tok;
        if (t.type === 'ident') {
          if (base || longs || short || signedness || !this.typedefs.has(t.value)) break;
          base = this.typedefs.get(t.value);
          this.next();
          sawAny = true;
          continue;
        }
        if (t.type !== 'keyword' || !TYPE_KEYWORDS.has(t.value)) break;
        sawAny = true;
        switch (t.value) {
          case 'const': case 'volatile': case 'register': case 'auto':
          case 'inline': case 'extern': case 'restrict':
            this.next();
            break;
          case 'static':
            isStatic = true;
            this.next();
            break;
          case 'typedef':
            isTypedef = true;
            this.next();
            break;
          case 'signed': case 'unsigned':
            signedness = t.value;
            this.next();
            break;
          case 'long':
            longs++;
            this.next();
            break;
          case 'short':
            short = true;
            this.next();
            break;
          case 'struct':
            if (base) this.error('two or more data types in declaration', t);
            base = this.parseStructSpecifier();
            break;
          case 'enum':
            if (base) this.error('two or more data types in declaration', t);
            base = this.parseEnumSpecifier();
            break;
          case 'union':
            this.error('unions are not supported by this simulator', t);
            break;
          default: {
            if (base) this.error('two or more data types in declaration', t);
            base = { void: Types.void, char: Types.char, int: Types.int, float: Types.float,
              double: Types.double, _Bool: Types.bool }[t.value];
            this.next();
          }
        }
      }
      if (!sawAny) return null;

      let type = base || Types.int;
      const unsigned = signedness === 'unsigned';
      if (type === Types.char) {
        type = unsigned ? Types.uchar : Types.char;
      } else if (type === Types.int || !base) {
        if (short) type = unsigned ? Types.ushort : Types.short;
        else if (longs >= 2) type = unsigned ? Types.ullong : Types.llong;
        else if (longs === 1) type = unsigned ? Types.ulong : Types.long;
        else type = unsigned ? Types.uint : Types.int;
      } else if (type === Types.double && longs) {
        type = Types.double; // `long double` is treated as double
      } else if (signedness || longs || short) {
        this.error('invalid combination of type specifiers', start);
      }
      return { type, isTypedef, isStatic };
    }

    parseStructSpecifier() {
      const kw = this.next(); // 'struct'
      let tag = null;
      if (this.tok.type === 'ident') tag = this.next().value;
      if (!tag && !this.is('{')) this.error("expected a struct name or '{'");
      if (!tag) tag = `<anonymous ${++this.anonCount}>`;

      let type = this.structs.get(tag);
      if (!type) {
        type = structType(tag);
        this.structs.set(tag, type);
      }
      if (this.accept('{')) {
        if (type.complete) this.error(`redefinition of 'struct ${tag}'`, kw);
        const fields = [];
        while (!this.is('}')) {
          const spec = this.parseDeclSpecifiers();
          if (!spec) this.error(`expected a field declaration but found ${this.describe(this.tok)}`);
          for (;;) {
            const fieldTok = this.tok;
            const d = this.parseDeclarator(spec.type, false);
            if (d.type.kind === 'func') this.error('struct fields cannot be functions', fieldTok);
            if (d.type.kind === 'struct' && !d.type.complete) {
              this.error(
                `field '${d.name}' has incomplete type 'struct ${d.type.tag}' (use a pointer instead)`,
                fieldTok
              );
            }
            if (d.type.kind === 'array' && d.type.length === null) {
              this.error(`array field '${d.name}' needs a size`, fieldTok);
            }
            if (fields.some((f) => f.name === d.name)) this.error(`duplicate field '${d.name}'`, fieldTok);
            if (this.is(':')) this.error('bit-fields are not supported by this simulator');
            fields.push({ name: d.name, type: d.type });
            if (!this.accept(',')) break;
          }
          this.expect(';');
        }
        this.expect('}');
        if (fields.length === 0) this.error(`'struct ${tag}' has no fields`, kw);
        completeStruct(type, fields);
      }
      return type;
    }

    parseEnumSpecifier() {
      this.next(); // 'enum'
      if (this.tok.type === 'ident') this.next();
      if (this.accept('{')) {
        let value = 0;
        while (!this.is('}')) {
          const name = this.expectIdent('an enumerator name');
          if (this.accept('=')) value = this.constInt(this.parseConditional());
          this.enumConsts.set(name.value, value);
          value++;
          if (!this.accept(',')) break;
        }
        this.expect('}');
      }
      return Types.int;
    }

    /**
     * Parses a declarator (the `*p`, `a[10]`, `(*fp)(int)` part of a
     * declaration) and applies it to `base`. With `abstract` set, the name is
     * optional — that form is used for casts, sizeof, and unnamed parameters.
     */
    parseDeclarator(base, abstract) {
      const shape = this.parseDeclaratorShape(abstract);
      const type = shape.apply(base);
      return { name: shape.name, type, loc: shape.loc, params: shape.params };
    }

    parseDeclaratorShape(abstract) {
      const start = this.tok;
      let pointers = 0;
      while (this.accept('*')) {
        pointers++;
        while (this.is('const') || this.is('volatile') || this.is('restrict')) this.next();
      }

      let name = null;
      let inner = null;
      let nameLoc = null;
      if (this.is('(') && this.isNestedDeclarator()) {
        this.next();
        inner = this.parseDeclaratorShape(abstract);
        this.expect(')');
        name = inner.name;
        nameLoc = inner.loc;
      } else if (this.tok.type === 'ident') {
        const t = this.next();
        name = t.value;
        nameLoc = { line: t.line, col: t.col, endLine: t.endLine, endCol: t.endCol };
      } else if (!abstract) {
        this.error(`expected a name in this declaration but found ${this.describe(this.tok)}`);
      }

      const suffixes = [];
      for (;;) {
        if (this.accept('[')) {
          let length = null;
          if (!this.is(']')) {
            const sizeTok = this.tok;
            const sizeExpr = this.parseConditional();
            const size = this.evalConst(sizeExpr);
            if (size === null) {
              throw new CompileError(
                'array size must be a constant — variable-length arrays are not supported (use malloc instead)',
                sizeExpr.loc
              );
            }
            length = Math.trunc(size);
            if (length <= 0) this.error('array size must be a positive constant', sizeTok);
          }
          this.expect(']');
          suffixes.push({ kind: 'array', length });
        } else if (this.is('(')) {
          this.next();
          suffixes.push(Object.assign({ kind: 'func' }, this.parseParameterList()));
        } else {
          break;
        }
      }

      const self = this;
      return {
        name,
        loc: nameLoc || this.locFrom(start),
        params: inner ? inner.params : (suffixes[0] && suffixes[0].kind === 'func' ? suffixes[0].params : null),
        apply(baseType) {
          let t = baseType;
          for (let k = 0; k < pointers; k++) t = ptrTo(t);
          for (let k = suffixes.length - 1; k >= 0; k--) {
            const s = suffixes[k];
            if (s.kind === 'array') {
              if (t.kind === 'void') self.error('array of void is not allowed', start);
              if (t.kind === 'array' && t.length === null) {
                self.error('only the first array dimension may be omitted', start);
              }
              t = s.length === null
                ? Object.freeze({ kind: 'array', of: t, length: null, size: 0, align: t.align })
                : arrayOf(t, s.length);
            } else {
              t = funcType(t, s.params.map((p) => ({ name: p.name, type: p.type })), s.variadic);
            }
          }
          return inner ? inner.apply(t) : t;
        },
      };
    }

    /** After '(' in a declarator: is it grouping `(*fp)` or a parameter list `(int x)`? */
    isNestedDeclarator() {
      const t = this.peekTok(1);
      if (t.type === 'punct') return t.value === '*' || t.value === '(' || t.value === '[';
      return t.type === 'ident' && !this.typedefs.has(t.value);
    }

    parseParameterList() {
      const params = [];
      let variadic = false;
      if (this.accept(')')) return { params, variadic };
      if (this.is('void') && this.peekTok(1).value === ')') {
        this.next();
        this.next();
        return { params, variadic };
      }
      for (;;) {
        if (this.accept('...')) {
          variadic = true;
          break;
        }
        const pTok = this.tok;
        const spec = this.parseDeclSpecifiers();
        if (!spec) this.error(`expected a parameter type but found ${this.describe(this.tok)}`);
        const d = this.parseDeclarator(spec.type, true);
        let type = d.type;
        // Arrays and functions decay to pointers when used as parameters.
        if (type.kind === 'array') type = ptrTo(type.of);
        else if (type.kind === 'func') type = ptrTo(type);
        if (type.kind === 'void') this.error('parameter cannot have type void', pTok);
        params.push({ name: d.name, type, loc: this.locFrom(pTok) });
        if (!this.accept(',')) break;
      }
      this.expect(')');
      return { params, variadic };
    }

    parseTypeName() {
      const spec = this.parseDeclSpecifiers();
      if (!spec) this.error(`expected a type name but found ${this.describe(this.tok)}`);
      return this.parseDeclarator(spec.type, true).type;
    }

    parseInitializer() {
      const start = this.tok;
      if (this.accept('{')) {
        const items = [];
        while (!this.is('}')) {
          if (this.is('.') || this.is('[')) this.error('designated initializers are not supported');
          items.push(this.parseInitializer());
          if (!this.accept(',')) break;
        }
        this.expect('}');
        return this.node('InitList', start, { items });
      }
      return this.parseAssignment();
    }

    /** Fills in `int a[] = {...}` / `char s[] = "..."` lengths from the initializer. */
    completeArrayType(decl, tok) {
      const t = decl.ctype;
      if (t.kind === 'struct' && !t.complete) {
        this.error(`variable '${decl.name}' has incomplete type 'struct ${t.tag}'`, tok);
      }
      if (t.kind !== 'array' || t.length !== null) return t;
      const init = decl.init;
      if (init && init.type === 'InitList') return arrayOf(t.of, Math.max(1, init.items.length));
      if (init && init.type === 'Str' && t.of.kind === 'int' && t.of.size === 1) {
        return arrayOf(t.of, init.bytes.length + 1);
      }
      this.error(`array '${decl.name}' needs an explicit size or an initializer`, tok);
      return t;
    }

    parseLocalDeclaration() {
      const start = this.tok;
      const spec = this.parseDeclSpecifiers();
      if (spec.isStatic) this.error('static local variables are not supported', start);
      const decls = [];
      if (!this.is(';')) {
        for (;;) {
          const declStart = this.tok;
          const d = this.parseDeclarator(spec.type, false);
          if (spec.isTypedef) {
            this.typedefs.set(d.name, d.type);
          } else {
            if (d.type.kind === 'func') this.error('nested function declarations are not supported', declStart);
            if (d.type.kind === 'void') this.error(`variable '${d.name}' declared void`, declStart);
            const decl = { name: d.name, ctype: d.type, init: null, loc: d.loc, slot: -1 };
            if (this.accept('=')) decl.init = this.parseInitializer();
            decl.ctype = this.completeArrayType(decl, declStart);
            decl.loc = this.locFrom(declStart);
            decls.push(decl);
          }
          if (!this.accept(',')) break;
        }
      }
      this.expect(';');
      return this.node('VarDecl', start, { decls });
    }

    /* ------------------------------ statements ----------------------------- */

    parseBlock() {
      const start = this.expect('{');
      const items = [];
      while (!this.is('}')) {
        if (this.tok.type === 'eof') this.error("expected '}' before end of file — unclosed block", start);
        items.push(this.parseBlockItem());
      }
      const close = this.next();
      return this.node('Block', start, {
        items,
        closeLoc: { line: close.line, col: close.col, endLine: close.endLine, endCol: close.endCol },
      });
    }

    parseBlockItem() {
      // `name:` would be a label; an identifier that is a typedef starts a declaration.
      if (this.isTypeStart() && !(this.tok.type === 'ident' && this.peekTok(1).value === ':')) {
        return this.parseLocalDeclaration();
      }
      return this.parseStatement();
    }

    parseStatement() {
      const start = this.tok;
      if (start.type === 'punct') {
        if (start.value === '{') return this.parseBlock();
        if (start.value === ';') {
          this.next();
          return this.node('Empty', start, {});
        }
      }
      if (start.type === 'keyword') {
        switch (start.value) {
          case 'if': {
            this.next();
            this.expect('(');
            const test = this.parseExpression();
            this.expect(')');
            const headLoc = this.locFrom(start);
            const then = this.parseStatement();
            const otherwise = this.accept('else') ? this.parseStatement() : null;
            return this.node('If', start, { test, then, otherwise, headLoc });
          }
          case 'while': {
            this.next();
            this.expect('(');
            const test = this.parseExpression();
            this.expect(')');
            const headLoc = this.locFrom(start);
            const body = this.parseStatement();
            return this.node('While', start, { test, body, headLoc });
          }
          case 'do': {
            this.next();
            const body = this.parseStatement();
            const whileTok = this.expect('while');
            this.expect('(');
            const test = this.parseExpression();
            this.expect(')');
            this.expect(';');
            return this.node('DoWhile', start, { test, body, headLoc: this.locFrom(whileTok) });
          }
          case 'for': {
            this.next();
            this.expect('(');
            let init = null;
            if (this.isTypeStart()) {
              init = this.parseLocalDeclaration();
            } else {
              if (!this.is(';')) {
                const initStart = this.tok;
                init = this.node('ExprStmt', initStart, { expr: this.parseExpression() });
              }
              this.expect(';');
            }
            const test = this.is(';') ? null : this.parseExpression();
            this.expect(';');
            const update = this.is(')') ? null : this.parseExpression();
            this.expect(')');
            const headLoc = this.locFrom(start);
            const body = this.parseStatement();
            return this.node('For', start, { init, test, update, body, headLoc });
          }
          case 'return': {
            this.next();
            const arg = this.is(';') ? null : this.parseExpression();
            this.expect(';');
            return this.node('Return', start, { arg });
          }
          case 'break':
            this.next();
            this.expect(';');
            return this.node('Break', start, {});
          case 'continue':
            this.next();
            this.expect(';');
            return this.node('Continue', start, {});
          case 'switch': {
            this.next();
            this.expect('(');
            const disc = this.parseExpression();
            this.expect(')');
            const headLoc = this.locFrom(start);
            if (!this.is('{')) this.error("expected '{' after switch (...)");
            const body = this.parseBlock();
            return this.node('Switch', start, { disc, body, headLoc });
          }
          case 'case': {
            this.next();
            const value = this.constInt(this.parseConditional());
            this.expect(':');
            return this.node('Case', start, { value });
          }
          case 'default':
            this.next();
            this.expect(':');
            return this.node('Default', start, {});
          case 'goto':
            this.error('goto is not supported by this simulator', start);
            break;
          default:
            break;
        }
      }
      const expr = this.parseExpression();
      this.expect(';');
      return this.node('ExprStmt', start, { expr });
    }

    /* ----------------------------- expressions ----------------------------- */

    parseExpression() {
      const start = this.tok;
      const first = this.parseAssignment();
      if (!this.is(',')) return first;
      const exprs = [first];
      while (this.accept(',')) exprs.push(this.parseAssignment());
      return this.node('Comma', start, { exprs });
    }

    parseAssignment() {
      const start = this.tok;
      const left = this.parseConditional();
      if (this.tok.type === 'punct' && ASSIGN_OPS.has(this.tok.value)) {
        const op = this.next().value;
        const right = this.parseAssignment();
        return this.node('Assign', start, { op, left, right });
      }
      return left;
    }

    parseConditional() {
      const start = this.tok;
      const test = this.parseBinary(1);
      if (!this.accept('?')) return test;
      const then = this.parseExpression();
      this.expect(':');
      const otherwise = this.parseConditional();
      return this.node('Cond', start, { test, then, otherwise });
    }

    parseBinary(minPrec) {
      const start = this.tok;
      let left = this.parseUnary();
      for (;;) {
        const t = this.tok;
        const prec = t.type === 'punct' ? BINARY_PRECEDENCE[t.value] : undefined;
        if (prec === undefined || prec < minPrec) return left;
        this.next();
        const right = this.parseBinary(prec + 1);
        const type = t.value === '&&' || t.value === '||' ? 'Logical' : 'Binary';
        left = this.node(type, start, { op: t.value, left, right });
      }
    }

    parseUnary() {
      const start = this.tok;
      if (start.type === 'punct') {
        switch (start.value) {
          case '++': case '--': {
            this.next();
            const arg = this.parseUnary();
            return this.node('Update', start, { op: start.value, prefix: true, arg });
          }
          case '+': case '-': case '!': case '~': case '*': case '&': {
            this.next();
            const arg = this.parseUnary();
            return this.node('Unary', start, { op: start.value, arg });
          }
          case '(':
            if (this.isTypeStart(this.peekTok(1))) {
              this.next();
              const ctype = this.parseTypeName();
              this.expect(')');
              const arg = this.parseUnary();
              return this.node('Cast', start, { ctype, arg });
            }
            break;
          default:
            break;
        }
      }
      if (start.type === 'keyword' && start.value === 'sizeof') {
        this.next();
        if (this.is('(') && this.isTypeStart(this.peekTok(1))) {
          this.next();
          const ctype = this.parseTypeName();
          this.expect(')');
          return this.node('SizeofType', start, { ctype });
        }
        const arg = this.parseUnary();
        return this.node('SizeofExpr', start, { arg });
      }
      return this.parsePostfix();
    }

    parsePostfix() {
      const start = this.tok;
      let expr = this.parsePrimary();
      for (;;) {
        if (this.accept('[')) {
          const index = this.parseExpression();
          this.expect(']');
          expr = this.node('Index', start, { object: expr, index });
        } else if (this.accept('(')) {
          const args = [];
          if (!this.is(')')) {
            do {
              args.push(this.parseAssignment());
            } while (this.accept(','));
          }
          this.expect(')');
          expr = this.node('Call', start, { callee: expr, args });
        } else if (this.is('.') || this.is('->')) {
          const arrow = this.next().value === '->';
          const field = this.expectIdent('a field name').value;
          expr = this.node('Member', start, { object: expr, field, arrow });
        } else if (this.is('++') || this.is('--')) {
          const op = this.next().value;
          expr = this.node('Update', start, { op, prefix: false, arg: expr });
        } else {
          return expr;
        }
      }
    }

    parsePrimary() {
      const t = this.tok;
      switch (t.type) {
        case 'number': {
          this.next();
          let ctype;
          if (t.isFloat) {
            ctype = t.single ? Types.float : Types.double;
          } else if (t.longCount >= 2) {
            ctype = t.unsigned ? Types.ullong : Types.llong;
          } else if (t.unsigned) {
            ctype = t.value > 0xffffffff ? Types.ullong : Types.uint;
          } else if (t.value > 0xffffffff) {
            ctype = Types.llong;
          } else if (t.value > 0x7fffffff) {
            ctype = Types.uint;
          } else {
            ctype = t.longCount ? Types.long : Types.int;
          }
          return this.node('Num', t, { value: t.value, ctype });
        }
        case 'char':
          this.next();
          return this.node('Num', t, { value: t.value, ctype: Types.int, isChar: true });
        case 'string':
          this.next();
          return this.node('Str', t, { bytes: t.value });
        case 'ident':
          this.next();
          return this.node('Ident', t, { name: t.value });
        case 'punct':
          if (t.value === '(') {
            this.next();
            const expr = this.parseExpression();
            this.expect(')');
            return expr;
          }
          break;
        default:
          break;
      }
      this.error(`expected an expression but found ${this.describe(t)}`);
      return null;
    }

    /* ------------------------- constant expressions ------------------------ */

    constInt(node) {
      const v = this.evalConst(node);
      if (v === null) {
        throw new CompileError('expected a constant integer expression', node.loc);
      }
      return Math.trunc(v);
    }

    evalConst(node) {
      switch (node.type) {
        case 'Num':
          return node.value;
        case 'Ident':
          return this.enumConsts.has(node.name) ? this.enumConsts.get(node.name) : null;
        case 'SizeofType':
          return node.ctype.size;
        case 'Cast': {
          const v = this.evalConst(node.arg);
          if (v === null) return null;
          return node.ctype.kind === 'int' ? Math.trunc(v) : v;
        }
        case 'Unary': {
          const v = this.evalConst(node.arg);
          if (v === null) return null;
          switch (node.op) {
            case '-': return -v;
            case '+': return v;
            case '~': return ~v;
            case '!': return v ? 0 : 1;
            default: return null;
          }
        }
        case 'Binary':
        case 'Logical': {
          const a = this.evalConst(node.left);
          const b = this.evalConst(node.right);
          if (a === null || b === null) return null;
          switch (node.op) {
            case '+': return a + b;
            case '-': return a - b;
            case '*': return a * b;
            case '/': return b === 0 ? null : Math.trunc(a / b);
            case '%': return b === 0 ? null : a % b;
            case '<<': return a << b;
            case '>>': return a >> b;
            case '&': return a & b;
            case '|': return a | b;
            case '^': return a ^ b;
            case '<': return a < b ? 1 : 0;
            case '>': return a > b ? 1 : 0;
            case '<=': return a <= b ? 1 : 0;
            case '>=': return a >= b ? 1 : 0;
            case '==': return a === b ? 1 : 0;
            case '!=': return a !== b ? 1 : 0;
            case '&&': return a && b ? 1 : 0;
            case '||': return a || b ? 1 : 0;
            default: return null;
          }
        }
        case 'Cond': {
          const c = this.evalConst(node.test);
          if (c === null) return null;
          return this.evalConst(c ? node.then : node.otherwise);
        }
        default:
          return null;
      }
    }
  }

  function parse(source) {
    const tokens = CViz.tokenize(source);
    return new Parser(tokens).parseProgram();
  }

  CViz.Parser = Parser;
  CViz.parse = parse;
});
