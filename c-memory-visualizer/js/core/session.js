/*
 * Debug session: drives the interpreter one pause at a time and keeps a
 * history of memory snapshots so the UI can step backwards.
 *
 * The interpreter only ever runs forward. "Step back" moves a cursor over
 * the recorded snapshots; stepping forward again replays the recording until
 * the cursor reaches the live head, then resumes real execution.
 */
(function (root, factory) {
  const ns = (root.CViz = root.CViz || {});
  factory(ns);
  if (typeof module === 'object' && module.exports) module.exports = ns;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CViz) {
  'use strict';

  const { RuntimeError } = CViz;

  class Session {
    /**
     * @param source   C source text
     * @param options  {stdin: string, maxHistory: number}
     * @throws CViz.CompileError when the program does not compile
     */
    constructor(source, options) {
      const opts = Object.assign({ stdin: '', maxHistory: 5000 }, options);
      this.source = source;
      this.maxHistory = Math.max(2, opts.maxHistory);
      this.program = CViz.compile(source);
      this.interp = new CViz.Interpreter(this.program, { stdin: opts.stdin, source });
      this.gen = this.interp.run();
      this.records = [];
      this.base = 0; // step number of records[0]
      this.cursor = 0; // step number currently shown
      this.steps = 0; // total pauses recorded so far
      this.status = 'running'; // 'running' | 'finished' | 'error'
      this.exitCode = null;
      this.advance();
    }

    get head() {
      return this.base + this.records.length - 1;
    }

    get current() {
      return this.records[this.cursor - this.base];
    }

    get atHead() {
      return this.cursor === this.head;
    }

    get canStepBack() {
      return this.cursor > this.base;
    }

    get canStepForward() {
      return this.cursor < this.head || this.status === 'running';
    }

    /** True once the cursor sits on the final record of a finished (or crashed) run. */
    get done() {
      return this.atHead && this.status !== 'running';
    }

    makeRecord(pause) {
      const interp = this.interp;
      const consoleLen = interp.console.length;
      const record = {
        step: this.steps++,
        kind: pause.kind,
        loc: pause.loc,
        depth: pause.depth,
        fn: pause.fn,
        snap: interp.mem.snapshot(),
        events: interp.events,
        consoleLen,
        consoleTail: consoleLen ? interp.console[consoleLen - 1].text.length : 0,
      };
      interp.events = [];
      return record;
    }

    /** Runs the interpreter to its next pause and records it. Returns false when nothing is left to run. */
    advance() {
      if (this.status !== 'running') return false;
      const interp = this.interp;
      let record;
      try {
        const r = this.gen.next();
        if (r.done) {
          this.status = 'finished';
          this.exitCode = r.value;
          this.reportExit();
          record = this.makeRecord({ kind: 'exit', loc: null, depth: 0, fn: null });
          record.exitCode = r.value;
        } else {
          record = this.makeRecord(r.value);
        }
      } catch (thrown) {
        let e = thrown;
        if (e instanceof RangeError && /call stack|recursion/i.test(e.message)) {
          // The host JavaScript stack ran out before the simulated one did.
          e = new RuntimeError(`stack overflow: ${interp.mem.frames.length} nested calls exhausted the simulator`);
        }
        if (!(e instanceof RuntimeError)) throw e;
        this.status = 'error';
        const loc = e.loc || (interp.curNode ? interp.curNode.loc : null);
        interp.log('error', `runtime error${loc ? ` on line ${loc.line}` : ''}: ${e.message}`);
        record = this.makeRecord({
          kind: 'error',
          loc,
          depth: interp.mem.frames.length,
          fn: interp.curFn ? interp.curFn.name : null,
        });
        record.error = e.message;
      }
      this.records.push(record);
      // Trim in batches so a long run does not shift the whole array on every step.
      const slack = Math.min(512, this.maxHistory >> 2);
      if (this.records.length > this.maxHistory + slack || (this.status !== 'running' && this.records.length > this.maxHistory)) {
        const drop = this.records.length - this.maxHistory;
        this.records.splice(0, drop);
        this.base += drop;
        if (this.cursor < this.base) this.cursor = this.base;
      }
      return true;
    }

    reportExit() {
      const interp = this.interp;
      const mem = interp.mem;
      interp.log('info', `Program exited with code ${this.exitCode}.`);
      if (mem.stats.mallocs > 0) {
        const leaked = mem.blocks.filter((b) => b.state === 'used');
        if (leaked.length === 0) {
          interp.log('info', `Heap check: all ${mem.stats.mallocs} allocation(s) were freed.`);
        } else {
          const bytes = leaked.reduce((sum, b) => sum + b.size, 0);
          interp.log('warn',
            `Heap check: ${bytes} byte(s) in ${leaked.length} block(s) were never freed (memory leak).`);
        }
      }
    }

    /** Moves one step forward (replaying history first). Returns false at the end of the program. */
    stepForward() {
      if (this.cursor < this.head) {
        this.cursor++;
        return true;
      }
      if (!this.advance()) return false;
      this.cursor = this.head;
      return true;
    }

    stepBack() {
      if (!this.canStepBack) return false;
      this.cursor--;
      return true;
    }

    seek(step) {
      this.cursor = Math.min(this.head, Math.max(this.base, step));
    }

    /** Console contents as they were at the given record: [{kind, text}]. */
    consoleAt(record) {
      const rec = record || this.current;
      const chunks = this.interp.console.slice(0, rec.consoleLen);
      if (chunks.length) {
        const last = chunks[chunks.length - 1];
        if (last.text.length !== rec.consoleTail) {
          chunks[chunks.length - 1] = { kind: last.kind, text: last.text.slice(0, rec.consoleTail) };
        }
      }
      return chunks;
    }

    /** Program output (stdout only) accumulated so far. */
    stdout() {
      return this.interp.console.filter((c) => c.kind === 'out').map((c) => c.text).join('');
    }

    /** Runs to completion without keeping the UI in the loop. Used by tests. */
    runToEnd(maxSteps) {
      const limit = maxSteps || 5e6;
      let n = 0;
      while (this.status === 'running') {
        this.advance();
        if (++n > limit) throw new Error(`program did not finish within ${limit} steps`);
      }
      this.cursor = this.head;
      return this;
    }
  }

  CViz.Session = Session;
});
