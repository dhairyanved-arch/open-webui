/*
 * Error types shared by the lexer, parser, and interpreter.
 */
(function (root, factory) {
  const ns = (root.CViz = root.CViz || {});
  factory(ns);
  if (typeof module === 'object' && module.exports) module.exports = ns;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CViz) {
  'use strict';

  /** A problem found before execution starts (lexing, parsing, or name resolution). */
  class CompileError extends Error {
    constructor(message, loc) {
      super(message);
      this.name = 'CompileError';
      this.loc = loc || null;
    }
  }

  /** A problem found while the simulated program runs (segfault, division by zero, ...). */
  class RuntimeError extends Error {
    constructor(message, loc) {
      super(message);
      this.name = 'RuntimeError';
      this.loc = loc || null;
    }
  }

  /** Thrown by exit() to unwind the simulated program; not an error. */
  class ExitSignal {
    constructor(code) {
      this.code = code;
    }
  }

  CViz.ExitSignal = ExitSignal;
  CViz.CompileError = CompileError;
  CViz.RuntimeError = RuntimeError;
});
