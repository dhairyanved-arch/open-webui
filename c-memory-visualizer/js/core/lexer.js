/*
 * Lexer for the supported C subset.
 *
 * Produces a flat token array. Comments are skipped, `#include` lines are
 * ignored, and object-like `#define NAME tokens` macros are expanded in place.
 */
(function (root, factory) {
  const ns = (root.CViz = root.CViz || {});
  factory(ns);
  if (typeof module === 'object' && module.exports) module.exports = ns;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CViz) {
  'use strict';

  const { CompileError } = CViz;

  const KEYWORDS = new Set([
    'auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do', 'double',
    'else', 'enum', 'extern', 'float', 'for', 'goto', 'if', 'inline', 'int', 'long',
    'register', 'restrict', 'return', 'short', 'signed', 'sizeof', 'static', 'struct',
    'switch', 'typedef', 'union', 'unsigned', 'void', 'volatile', 'while', '_Bool',
  ]);

  const PUNCTUATORS = [
    '...', '<<=', '>>=',
    '->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||',
    '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=',
    '+', '-', '*', '/', '%', '=', '<', '>', '!', '~', '&', '|', '^', '?', ':',
    ';', ',', '.', '(', ')', '[', ']', '{', '}',
  ];

  const SIMPLE_ESCAPES = {
    n: 10, t: 9, r: 13, '0': 0, a: 7, b: 8, f: 12, v: 11,
    '\\': 92, "'": 39, '"': 34, '?': 63,
  };

  const isDigit = (c) => c >= '0' && c <= '9';
  const isIdentStart = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
  const isIdentPart = (c) => isIdentStart(c) || isDigit(c);
  const isHexDigit = (c) => isDigit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');

  class Lexer {
    constructor(source) {
      this.src = source.replace(/\r\n?/g, '\n');
      this.pos = 0;
      this.line = 1;
      this.col = 1;
      this.tokens = [];
      this.macros = new Map();
      this.atLineStart = true;
    }

    error(message, line, col) {
      throw new CompileError(message, {
        line: line || this.line,
        col: col || this.col,
        endLine: line || this.line,
        endCol: (col || this.col) + 1,
      });
    }

    peek(offset) {
      return this.src[this.pos + (offset || 0)];
    }

    advance() {
      const c = this.src[this.pos++];
      if (c === '\n') {
        this.line++;
        this.col = 1;
      } else {
        this.col++;
      }
      return c;
    }

    tokenize() {
      while (this.pos < this.src.length) {
        const c = this.peek();
        if (c === '\n') {
          this.advance();
          this.atLineStart = true;
          continue;
        }
        if (c === ' ' || c === '\t' || c === '\f' || c === '\v') {
          this.advance();
          continue;
        }
        if (c === '/' && this.peek(1) === '/') {
          while (this.pos < this.src.length && this.peek() !== '\n') this.advance();
          continue;
        }
        if (c === '/' && this.peek(1) === '*') {
          this.skipBlockComment();
          continue;
        }
        if (c === '#' && this.atLineStart) {
          this.readDirective();
          continue;
        }
        this.atLineStart = false;
        this.readToken(this.tokens);
      }
      this.tokens.push({
        type: 'eof', value: '<end of file>',
        line: this.line, col: this.col, endLine: this.line, endCol: this.col,
      });
      return this.expandMacros(this.tokens);
    }

    skipBlockComment() {
      const line = this.line;
      const col = this.col;
      this.advance();
      this.advance();
      while (this.pos < this.src.length && !(this.peek() === '*' && this.peek(1) === '/')) {
        this.advance();
      }
      if (this.pos >= this.src.length) this.error('unterminated /* comment', line, col);
      this.advance();
      this.advance();
    }

    readDirective() {
      const line = this.line;
      const col = this.col;
      this.advance(); // '#'
      // Gather the directive line, honouring backslash continuations.
      let text = '';
      while (this.pos < this.src.length && this.peek() !== '\n') {
        if (this.peek() === '\\' && this.peek(1) === '\n') {
          this.advance();
          this.advance();
          text += ' ';
          continue;
        }
        text += this.advance();
      }
      const match = /^\s*([A-Za-z_]+)\s*(.*)$/.exec(text);
      if (!match) return;
      const name = match[1];
      const rest = match[2];
      if (name === 'include' || name === 'pragma') return;
      if (name === 'define') {
        const def = /^([A-Za-z_][A-Za-z0-9_]*)(\(?)(.*)$/.exec(rest);
        if (!def) this.error('malformed #define', line, col);
        if (def[2] === '(') {
          this.error(
            `function-like macro '${def[1]}' is not supported; use a function instead`,
            line, col
          );
        }
        const sub = new Lexer(def[3].replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, ' '));
        const body = [];
        while (sub.pos < sub.src.length) {
          const ch = sub.peek();
          if (ch === ' ' || ch === '\t' || ch === '\n') {
            sub.advance();
            continue;
          }
          sub.readToken(body);
        }
        this.macros.set(def[1], body);
        return;
      }
      if (name === 'undef') {
        this.macros.delete(rest.trim());
        return;
      }
      this.error(`preprocessor directive '#${name}' is not supported`, line, col);
    }

    readToken(out) {
      const line = this.line;
      const col = this.col;
      const c = this.peek();
      const push = (type, value, extra) => {
        out.push(Object.assign(
          { type, value, line, col, endLine: this.line, endCol: this.col },
          extra || {}
        ));
      };

      if (isIdentStart(c)) {
        let text = '';
        while (this.pos < this.src.length && isIdentPart(this.peek())) text += this.advance();
        push(KEYWORDS.has(text) ? 'keyword' : 'ident', text);
        return;
      }

      if (isDigit(c) || (c === '.' && isDigit(this.peek(1) || ''))) {
        this.readNumber(push);
        return;
      }

      if (c === '"') {
        this.advance();
        const bytes = [];
        for (;;) {
          if (this.pos >= this.src.length || this.peek() === '\n') {
            this.error('unterminated string literal', line, col);
          }
          if (this.peek() === '"') {
            this.advance();
            break;
          }
          bytes.push(this.readCharCode());
        }
        // Adjacent string literals concatenate, as in C.
        const prev = out[out.length - 1];
        if (prev && prev.type === 'string' && out === this.tokens) {
          prev.value = prev.value.concat(bytes);
          prev.endLine = this.line;
          prev.endCol = this.col;
        } else {
          push('string', bytes);
        }
        return;
      }

      if (c === "'") {
        this.advance();
        if (this.peek() === "'") this.error('empty character constant', line, col);
        const code = this.readCharCode();
        if (this.peek() !== "'") this.error('unterminated character constant', line, col);
        this.advance();
        push('char', code);
        return;
      }

      for (const p of PUNCTUATORS) {
        if (this.src.startsWith(p, this.pos)) {
          for (let i = 0; i < p.length; i++) this.advance();
          push('punct', p);
          return;
        }
      }

      this.error(`unexpected character '${c}'`, line, col);
    }

    readCharCode() {
      const c = this.advance();
      if (c !== '\\') return c.charCodeAt(0) & 0xff;
      const e = this.advance();
      if (e === 'x') {
        let hex = '';
        while (isHexDigit(this.peek() || '')) hex += this.advance();
        if (!hex) this.error('\\x used with no following hex digits');
        return parseInt(hex, 16) & 0xff;
      }
      if (e >= '0' && e <= '7') {
        let oct = e;
        while (oct.length < 3 && this.peek() >= '0' && this.peek() <= '7') oct += this.advance();
        return parseInt(oct, 8) & 0xff;
      }
      if (Object.prototype.hasOwnProperty.call(SIMPLE_ESCAPES, e)) return SIMPLE_ESCAPES[e];
      this.error(`unknown escape sequence '\\${e}'`);
      return 0;
    }

    readNumber(push) {
      let text = '';
      let isFloat = false;
      if (this.peek() === '0' && (this.peek(1) === 'x' || this.peek(1) === 'X')) {
        text += this.advance() + this.advance();
        while (isHexDigit(this.peek() || '')) text += this.advance();
        if (text.length === 2) this.error('invalid hexadecimal constant');
      } else {
        while (isDigit(this.peek() || '')) text += this.advance();
        if (this.peek() === '.') {
          isFloat = true;
          text += this.advance();
          while (isDigit(this.peek() || '')) text += this.advance();
        }
        if (this.peek() === 'e' || this.peek() === 'E') {
          const next = this.peek(1) || '';
          const next2 = this.peek(2) || '';
          if (isDigit(next) || ((next === '+' || next === '-') && isDigit(next2))) {
            isFloat = true;
            text += this.advance() + this.advance();
            while (isDigit(this.peek() || '')) text += this.advance();
          }
        }
      }
      let suffix = '';
      while (/[uUlLfF]/.test(this.peek() || '')) suffix += this.advance().toLowerCase();
      if (isIdentPart(this.peek() || '')) this.error(`invalid suffix on numeric constant '${text}'`);

      if (isFloat || (suffix === 'f' && !/^0[xX]/.test(text))) {
        push('number', parseFloat(text), { isFloat: true, single: suffix.includes('f') });
        return;
      }
      let value;
      if (/^0[xX]/.test(text)) value = parseInt(text, 16);
      else if (text.length > 1 && text[0] === '0') value = parseInt(text, 8);
      else value = parseInt(text, 10);
      if (Number.isNaN(value)) this.error(`invalid numeric constant '${text}'`);
      push('number', value, {
        isFloat: false,
        unsigned: suffix.includes('u'),
        longCount: (suffix.match(/l/g) || []).length,
      });
    }

    expandMacros(tokens) {
      if (this.macros.size === 0) return tokens;
      const out = [];
      const expand = (tok, active) => {
        if (tok.type === 'ident' && this.macros.has(tok.value) && !active.has(tok.value)) {
          active.add(tok.value);
          for (const m of this.macros.get(tok.value)) {
            // Expanded tokens report the position of the macro use site.
            expand(Object.assign({}, m, {
              line: tok.line, col: tok.col, endLine: tok.endLine, endCol: tok.endCol,
            }), active);
          }
          active.delete(tok.value);
        } else {
          out.push(tok);
        }
      };
      for (const tok of tokens) expand(tok, new Set());
      return out;
    }
  }

  function tokenize(source) {
    return new Lexer(source).tokenize();
  }

  CViz.KEYWORDS = KEYWORDS;
  CViz.tokenize = tokenize;
});
