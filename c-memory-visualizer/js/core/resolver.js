/*
 * Name resolution and static checks.
 *
 * Walks the AST once before execution to:
 *   - bind every identifier to a local slot, parameter, global, function, or constant,
 *   - hoist each function's locals into a fixed list of stack slots (so the whole
 *     frame can be allocated on entry, the way a compiler lays it out),
 *   - intern string literals,
 *   - report errors such as undeclared names or wrong argument counts up front.
 */
(function (root, factory) {
  const ns = (root.CViz = root.CViz || {});
  factory(ns);
  if (typeof module === 'object' && module.exports) module.exports = ns;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CViz) {
  'use strict';

  const { CompileError, Types } = CViz;

  class Resolver {
    constructor(program, builtins, constants) {
      this.program = program;
      this.builtins = builtins;
      this.constants = constants;
      this.scopes = [];
      this.fn = null;
      this.scopeOwners = [];
      this.loopDepth = 0;
      this.switchDepth = 0;
      this.stringIndex = new Map();
      program.strings = [];
    }

    error(message, node) {
      throw new CompileError(message, node && node.loc ? node.loc : node);
    }

    run() {
      const program = this.program;
      const globalScope = new Map();
      this.scopes = [globalScope];

      program.globals.forEach((g, index) => {
        if (globalScope.has(g.name) || program.functions.has(g.name)) {
          this.error(`redefinition of '${g.name}'`, g);
        }
        globalScope.set(g.name, { kind: 'global', index });
        if (g.init) this.visitInit(g.init, g.ctype);
      });

      if (!program.functions.has('main')) {
        throw new CompileError("undefined reference to 'main' — every program needs an int main() function", {
          line: 1, col: 1, endLine: 1, endCol: 2,
        });
      }

      for (const fn of program.functions.values()) this.visitFunction(fn);
      return program;
    }

    visitFunction(fn) {
      if (fn.ctype.variadic) {
        this.error(`user-defined variadic functions ('${fn.name}(...)') are not supported`, fn.nameLoc);
      }
      if (fn.retType.kind === 'struct') {
        this.error(
          `'${fn.name}' returns a struct by value, which is not supported — return a pointer instead`,
          fn.nameLoc
        );
      }
      if (fn.retType.kind === 'array') this.error(`'${fn.name}' cannot return an array`, fn.nameLoc);

      this.fn = fn;
      fn.locals = [];
      const paramScope = new Map();
      fn.params.forEach((p, index) => {
        if (paramScope.has(p.name)) this.error(`duplicate parameter name '${p.name}'`, p);
        if (p.type.kind === 'struct' && !p.type.complete) {
          this.error(`parameter '${p.name}' has incomplete type`, p);
        }
        paramScope.set(p.name, { kind: 'param', index });
      });
      this.scopes.push(paramScope);
      this.visitStmt(fn.body);
      this.scopes.pop();
      this.fn = null;
    }

    /* ------------------------------- scopes ------------------------------- */

    pushScope(owner) {
      owner.scopeSlots = [];
      this.scopes.push(new Map());
      this.scopeOwners.push(owner);
    }

    popScope() {
      this.scopes.pop();
      this.scopeOwners.pop();
    }

    declareLocal(decl) {
      const scope = this.scopes[this.scopes.length - 1];
      if (scope.has(decl.name)) this.error(`redeclaration of '${decl.name}' in the same scope`, decl);
      const slot = this.fn.locals.length;
      this.fn.locals.push({ name: decl.name, type: decl.ctype });
      decl.slot = slot;
      scope.set(decl.name, { kind: 'local', slot });
      this.scopeOwners[this.scopeOwners.length - 1].scopeSlots.push(slot);
    }

    lookup(name) {
      for (let i = this.scopes.length - 1; i >= 0; i--) {
        const hit = this.scopes[i].get(name);
        if (hit) return hit;
      }
      return null;
    }

    /* ----------------------------- statements ----------------------------- */

    visitStmt(node) {
      switch (node.type) {
        case 'Block':
          this.pushScope(node);
          node.items.forEach((item) => this.visitStmt(item));
          this.popScope();
          break;
        case 'VarDecl':
          for (const d of node.decls) {
            this.declareLocal(d);
            if (d.init) this.visitInit(d.init, d.ctype);
          }
          break;
        case 'ExprStmt':
          this.visitExpr(node.expr);
          break;
        case 'If':
          this.visitExpr(node.test);
          this.visitStmt(node.then);
          if (node.otherwise) this.visitStmt(node.otherwise);
          break;
        case 'While':
        case 'DoWhile':
          this.visitExpr(node.test);
          this.loopDepth++;
          this.visitStmt(node.body);
          this.loopDepth--;
          break;
        case 'For':
          this.pushScope(node);
          if (node.init) this.visitStmt(node.init);
          if (node.test) this.visitExpr(node.test);
          if (node.update) this.visitExpr(node.update);
          this.loopDepth++;
          this.visitStmt(node.body);
          this.loopDepth--;
          this.popScope();
          break;
        case 'Switch':
          this.visitExpr(node.disc);
          this.switchDepth++;
          this.visitStmt(node.body);
          this.switchDepth--;
          this.checkSwitchLabels(node);
          break;
        case 'Case':
        case 'Default':
          if (!this.switchDepth) this.error(`'${node.type.toLowerCase()}' label outside of a switch`, node);
          break;
        case 'Return':
          if (node.arg) {
            if (this.fn.retType.kind === 'void') {
              this.error(`'${this.fn.name}' is declared void, so it cannot return a value`, node);
            }
            this.visitExpr(node.arg);
          }
          break;
        case 'Break':
          if (!this.loopDepth && !this.switchDepth) this.error("'break' outside of a loop or switch", node);
          break;
        case 'Continue':
          if (!this.loopDepth) this.error("'continue' outside of a loop", node);
          break;
        case 'Empty':
          break;
        default:
          this.error(`internal error: unknown statement type ${node.type}`, node);
      }
    }

    checkSwitchLabels(node) {
      const seen = new Set();
      let hasDefault = false;
      for (const item of node.body.items) {
        if (item.type === 'Case') {
          if (seen.has(item.value)) this.error(`duplicate case value ${item.value}`, item);
          seen.add(item.value);
        } else if (item.type === 'Default') {
          if (hasDefault) this.error("multiple 'default' labels in one switch", item);
          hasDefault = true;
        }
      }
    }

    /* ---------------------------- expressions ----------------------------- */

    visitInit(init, type) {
      if (init.type === 'InitList') {
        if (type.kind === 'array') {
          if (init.items.length > type.length) {
            this.error(`too many initializers: array holds ${type.length} element(s)`, init);
          }
          init.items.forEach((item) => this.visitInit(item, type.of));
        } else if (type.kind === 'struct') {
          if (init.items.length > type.fields.length) {
            this.error(`too many initializers for 'struct ${type.tag}'`, init);
          }
          init.items.forEach((item, i) => this.visitInit(item, type.fields[i].type));
        } else {
          if (init.items.length !== 1) this.error('a scalar needs exactly one initializer', init);
          this.visitInit(init.items[0], type);
        }
        return;
      }
      if (init.type === 'Str' && type.kind === 'array' && type.of.kind === 'int' && type.of.size === 1) {
        if (init.bytes.length > type.length) {
          this.error(
            `string of ${init.bytes.length} characters does not fit in an array of ${type.length}`,
            init
          );
        }
        init.inline = true; // bytes are copied straight into the array; no .rodata entry needed
        return;
      }
      if (type.kind === 'array') {
        this.error('an array must be initialized with a brace-enclosed list', init);
      }
      this.visitExpr(init);
    }

    visitExpr(node) {
      switch (node.type) {
        case 'Num':
        case 'SizeofType':
          break;
        case 'Str': {
          const key = node.bytes.join(',');
          let index = this.stringIndex.get(key);
          if (index === undefined) {
            index = this.program.strings.length;
            this.program.strings.push(node.bytes);
            this.stringIndex.set(key, index);
          }
          node.strIndex = index;
          break;
        }
        case 'Ident':
          node.ref = this.resolveIdent(node);
          break;
        case 'Unary':
        case 'Update':
        case 'Cast':
        case 'SizeofExpr':
          this.visitExpr(node.arg);
          break;
        case 'Binary':
        case 'Logical':
        case 'Assign':
          this.visitExpr(node.left);
          this.visitExpr(node.right);
          break;
        case 'Cond':
          this.visitExpr(node.test);
          this.visitExpr(node.then);
          this.visitExpr(node.otherwise);
          break;
        case 'Comma':
          node.exprs.forEach((e) => this.visitExpr(e));
          break;
        case 'Index':
          this.visitExpr(node.object);
          this.visitExpr(node.index);
          break;
        case 'Member':
          this.visitExpr(node.object);
          break;
        case 'Call':
          this.visitCall(node);
          break;
        case 'InitList':
          this.error('a brace-enclosed list is only allowed as an initializer', node);
          break;
        default:
          this.error(`internal error: unknown expression type ${node.type}`, node);
      }
    }

    resolveIdent(node) {
      const name = node.name;
      const hit = this.lookup(name);
      if (hit) return hit;
      if (this.program.functions.has(name)) return { kind: 'func', name };
      if (this.program.prototypes.has(name)) {
        this.error(`undefined reference to '${name}': it is declared but never defined`, node);
      }
      if (Object.prototype.hasOwnProperty.call(this.builtins, name)) return { kind: 'builtin', name };
      if (this.program.enumConsts.has(name)) {
        return { kind: 'const', value: this.program.enumConsts.get(name), ctype: Types.int };
      }
      if (Object.prototype.hasOwnProperty.call(this.constants, name)) {
        const c = this.constants[name];
        return { kind: 'const', value: c.value, ctype: c.ctype };
      }
      this.error(`'${name}' undeclared (first use in this function)`, node);
      return null;
    }

    visitCall(node) {
      const callee = node.callee;
      if (callee.type === 'Ident' && !this.lookup(callee.name)) {
        const name = callee.name;
        const count = node.args.length;
        if (this.program.functions.has(name)) {
          const fn = this.program.functions.get(name);
          callee.ref = { kind: 'func', name };
          if (count !== fn.params.length) {
            this.error(
              `${name}() takes ${fn.params.length} argument${fn.params.length === 1 ? '' : 's'} ` +
                `but ${count} ${count === 1 ? 'was' : 'were'} given`,
              node
            );
          }
        } else if (this.program.prototypes.has(name)) {
          this.error(`undefined reference to '${name}': it is declared but never defined`, callee);
        } else if (Object.prototype.hasOwnProperty.call(this.builtins, name)) {
          const b = this.builtins[name];
          callee.ref = { kind: 'builtin', name };
          if (count < b.min || count > b.max) {
            const want = b.max === Infinity ? `at least ${b.min}` : b.min === b.max ? `${b.min}` : `${b.min}–${b.max}`;
            this.error(`${name}() expects ${want} argument(s) but ${count} ${count === 1 ? 'was' : 'were'} given`, node);
          }
        } else {
          this.error(`implicit declaration of function '${name}' — it is not defined anywhere`, callee);
        }
      } else {
        this.visitExpr(callee);
      }
      node.args.forEach((a) => this.visitExpr(a));
    }
  }

  function resolve(program, builtins, constants) {
    return new Resolver(program, builtins || {}, constants || {}).run();
  }

  CViz.resolve = resolve;
});
