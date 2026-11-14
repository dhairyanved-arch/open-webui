/*
 * Code editor: a transparent <textarea> layered over a syntax-highlighted
 * <pre>, with a line-number gutter, clickable breakpoints, and markers for
 * the line (and exact source range) that is about to execute.
 */
(function (root, factory) {
  const ns = (root.CViz = root.CViz || {});
  factory(ns);
  if (typeof module === 'object' && module.exports) module.exports = ns;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CViz) {
  'use strict';

  const TYPE_WORDS = new Set([
    'void', 'char', 'short', 'int', 'long', 'float', 'double', 'signed', 'unsigned',
    'struct', 'enum', 'union', 'const', 'static', 'typedef', 'size_t', 'bool', '_Bool',
    'extern', 'volatile', 'register', 'auto', 'inline',
  ]);
  const FLOW_WORDS = new Set([
    'if', 'else', 'for', 'while', 'do', 'return', 'break', 'continue', 'switch', 'case',
    'default', 'sizeof', 'goto',
  ]);
  const CONST_WORDS = new Set(['NULL', 'true', 'false', 'EOF']);

  // One alternation, tried left to right: comments, strings, chars, preprocessor, numbers, words.
  const TOKEN_RE = new RegExp([
    '(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?(?:\\*\\/|$))',
    '("(?:[^"\\\\\\n]|\\\\.)*"?)',
    "('(?:[^'\\\\\\n]|\\\\.)*'?)",
    '(^[ \\t]*#[^\\n]*)',
    '(\\b(?:0[xX][0-9a-fA-F]+|\\d+\\.?\\d*(?:[eE][+-]?\\d+)?)[uUlLfF]*\\b)',
    '([A-Za-z_]\\w*)',
  ].join('|'), 'gm');

  function escapeHtml(s) {
    return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  function highlight(source) {
    let out = '';
    let last = 0;
    TOKEN_RE.lastIndex = 0;
    let m;
    while ((m = TOKEN_RE.exec(source)) !== null) {
      if (m[0] === '') {
        TOKEN_RE.lastIndex++;
        continue;
      }
      out += escapeHtml(source.slice(last, m.index));
      last = m.index + m[0].length;
      let cls = null;
      if (m[1] !== undefined) cls = 'tk-comment';
      else if (m[2] !== undefined) cls = 'tk-string';
      else if (m[3] !== undefined) cls = 'tk-string';
      else if (m[4] !== undefined) cls = 'tk-pre';
      else if (m[5] !== undefined) cls = 'tk-number';
      else if (TYPE_WORDS.has(m[6])) cls = 'tk-type';
      else if (FLOW_WORDS.has(m[6])) cls = 'tk-flow';
      else if (CONST_WORDS.has(m[6])) cls = 'tk-number';
      else if (/^\s*\(/.test(source.slice(last, last + 8))) cls = 'tk-call';
      const text = escapeHtml(m[0]);
      out += cls ? `<span class="${cls}">${text}</span>` : text;
    }
    return out + escapeHtml(source.slice(last));
  }

  class Editor {
    /**
     * @param host     container element
     * @param options  {onChange: fn(source), onBreakpoints: fn(Set<number>)}
     */
    constructor(host, options) {
      const opts = options || {};
      this.host = host;
      this.onChange = opts.onChange || (() => {});
      this.onBreakpoints = opts.onBreakpoints || (() => {});
      this.breakpoints = new Set();
      this.lineCount = 0;
      this.marker = null;

      host.classList.add('ed');
      host.innerHTML =
        '<div class="ed-scroll">' +
        '<div class="ed-gutter" aria-hidden="true"></div>' +
        '<div class="ed-body">' +
        '<div class="ed-line" hidden></div>' +
        '<div class="ed-range" hidden></div>' +
        '<pre class="ed-pre" aria-hidden="true"></pre>' +
        '<textarea class="ed-input" id="source-input" spellcheck="false" autocapitalize="off" ' +
        'autocomplete="off" autocorrect="off" wrap="off" aria-label="C source code"></textarea>' +
        '</div></div>';
      this.scroller = host.querySelector('.ed-scroll');
      this.gutter = host.querySelector('.ed-gutter');
      this.body = host.querySelector('.ed-body');
      this.lineEl = host.querySelector('.ed-line');
      this.rangeEl = host.querySelector('.ed-range');
      this.pre = host.querySelector('.ed-pre');
      this.input = host.querySelector('.ed-input');

      this.input.addEventListener('input', () => {
        this.render();
        this.onChange(this.input.value);
      });
      this.input.addEventListener('keydown', (e) => this.handleKey(e));
      this.gutter.addEventListener('click', (e) => {
        const row = e.target.closest('[data-line]');
        if (row) this.toggleBreakpoint(Number(row.dataset.line));
      });
    }

    get value() {
      return this.input.value;
    }

    setValue(source) {
      this.input.value = source;
      this.breakpoints.clear();
      this.clearMarker();
      this.render();
      this.scroller.scrollTop = 0;
      this.scroller.scrollLeft = 0;
    }

    metrics() {
      const style = getComputedStyle(this.pre);
      return {
        lineHeight: parseFloat(style.lineHeight) || 20,
        padTop: parseFloat(style.paddingTop) || 0,
        padLeft: parseFloat(style.paddingLeft) || 0,
      };
    }

    render() {
      const source = this.input.value;
      // The trailing newline keeps the <pre> as tall as the textarea's last (empty) line.
      this.pre.innerHTML = highlight(source) + '\n';
      const lines = source.split('\n').length;
      if (lines !== this.lineCount) {
        this.lineCount = lines;
        for (const bp of Array.from(this.breakpoints)) if (bp > lines) this.breakpoints.delete(bp);
        this.renderGutter();
      }
    }

    renderGutter() {
      let html = '';
      for (let i = 1; i <= this.lineCount; i++) {
        const cls = (this.breakpoints.has(i) ? ' has-bp' : '') +
          (this.marker && this.marker.line === i ? ' is-current is-' + this.marker.kind : '');
        html += `<div class="ed-num${cls}" data-line="${i}" title="Toggle breakpoint on line ${i}">${i}</div>`;
      }
      this.gutter.innerHTML = html;
    }

    toggleBreakpoint(line) {
      if (this.breakpoints.has(line)) this.breakpoints.delete(line);
      else this.breakpoints.add(line);
      this.renderGutter();
      this.onBreakpoints(this.breakpoints);
    }

    /**
     * Marks the source range that is about to run.
     * @param loc   {line, col, endLine, endCol} (1-based) or null to clear
     * @param kind  'exec' | 'return' | 'error'
     * @param follow  whether to scroll the line into view
     */
    setMarker(loc, kind, follow) {
      if (!loc) {
        this.clearMarker();
        return;
      }
      const m = this.metrics();
      this.marker = { line: loc.line, kind: kind || 'exec' };

      this.lineEl.hidden = false;
      this.lineEl.className = 'ed-line is-' + this.marker.kind;
      this.lineEl.style.top = m.padTop + (loc.line - 1) * m.lineHeight + 'px';
      this.lineEl.style.height = m.lineHeight + 'px';

      const singleLine = loc.endLine === loc.line && loc.endCol > loc.col;
      if (singleLine) {
        this.rangeEl.hidden = false;
        this.rangeEl.className = 'ed-range is-' + this.marker.kind;
        this.rangeEl.style.top = m.padTop + (loc.line - 1) * m.lineHeight + 'px';
        this.rangeEl.style.height = m.lineHeight + 'px';
        this.rangeEl.style.left = `calc(${m.padLeft}px + ${loc.col - 1}ch)`;
        this.rangeEl.style.width = `${loc.endCol - loc.col}ch`;
      } else {
        this.rangeEl.hidden = true;
      }

      const old = this.gutter.querySelector('.is-current');
      if (old) old.className = 'ed-num' + (old.classList.contains('has-bp') ? ' has-bp' : '');
      const row = this.gutter.children[loc.line - 1];
      if (row) {
        row.className = 'ed-num' + (this.breakpoints.has(loc.line) ? ' has-bp' : '') +
          ' is-current is-' + this.marker.kind;
      }
      if (follow) this.scrollToLine(loc.line, m);
    }

    clearMarker() {
      this.marker = null;
      this.lineEl.hidden = true;
      this.rangeEl.hidden = true;
      const old = this.gutter.querySelector('.is-current');
      if (old) old.className = 'ed-num' + (old.classList.contains('has-bp') ? ' has-bp' : '');
    }

    scrollToLine(line, metrics) {
      const m = metrics || this.metrics();
      const top = m.padTop + (line - 1) * m.lineHeight;
      const view = this.scroller;
      const margin = m.lineHeight * 2;
      if (top < view.scrollTop + margin) {
        view.scrollTop = Math.max(0, top - margin);
      } else if (top + m.lineHeight > view.scrollTop + view.clientHeight - margin) {
        view.scrollTop = top + m.lineHeight - view.clientHeight + margin;
      }
    }

    handleKey(e) {
      const input = this.input;
      if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        this.insert('    ');
      } else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        // Keep the current indentation; add one level after an opening brace.
        const before = input.value.slice(0, input.selectionStart);
        const line = before.slice(before.lastIndexOf('\n') + 1);
        const indent = /^[ \t]*/.exec(line)[0];
        const extra = /\{\s*$/.test(line) ? '    ' : '';
        e.preventDefault();
        this.insert('\n' + indent + extra);
      }
    }

    insert(text) {
      const input = this.input;
      const start = input.selectionStart;
      const end = input.selectionEnd;
      input.setRangeText(text, start, end, 'end');
      this.render();
      this.onChange(input.value);
    }
  }

  CViz.Editor = Editor;
  CViz.highlightC = highlight;
});
