/*
 * Application controller: wires the editor, the debug session, the canvas
 * renderer, and the toolbar together.
 */
(function () {
  'use strict';

  const C = window.CViz;
  const $ = (id) => document.getElementById(id);

  // Slider position → statements per second. The last stop runs as fast as the browser allows.
  const SPEEDS = [1, 2, 4, 8, 15, 30, 60, 200, 1000, Infinity];
  const DEFAULT_PROGRAM = 'armstrong';
  const RUN_BUDGET_MS = 10;
  const COMPILE_DELAY_MS = 450;

  const els = {
    program: $('program'),
    restart: $('btn-restart'),
    back: $('btn-back'),
    run: $('btn-run'),
    runLabel: $('btn-run-label'),
    step: $('btn-step'),
    over: $('btn-over'),
    out: $('btn-out'),
    speed: $('speed'),
    speedLabel: $('speed-label'),
    theme: $('btn-theme'),
    themeLabel: $('btn-theme-label'),
    runState: $('run-state'),
    stdin: $('stdin'),
    console: $('console'),
    narration: $('narration'),
    timeline: $('timeline'),
    timelineLabel: $('timeline-label'),
    zoomIn: $('btn-zoom-in'),
    zoomOut: $('btn-zoom-out'),
    fit: $('btn-fit'),
    statLine: $('stat-line'),
    statFn: $('stat-fn'),
    statDepth: $('stat-depth'),
    statSp: $('stat-sp'),
    statStack: $('stat-stack'),
    statHeap: $('stat-heap'),
    statFps: $('stat-fps'),
  };

  const state = {
    session: null,
    compileError: null,
    running: false,
    until: null, // predicate that ends a "step over" / "step out" run
    stepDebt: 0,
    lastTick: 0,
    breakpoints: new Set(),
    compileTimer: 0,
    shownConsoleKey: '',
  };

  const editor = new C.Editor($('editor'), {
    onChange: () => onSourceEdited(),
    onBreakpoints: (set) => {
      state.breakpoints = set;
    },
  });

  const renderer = new C.Renderer($('memory'), {
    tooltip: $('tooltip'),
    onCameraChange: (auto) => els.fit.classList.toggle('is-on', auto),
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  /* ------------------------------------------------------------------ *
   * Session lifecycle
   * ------------------------------------------------------------------ */

  /** Compiles the editor contents into a fresh session. Returns false on a compile error. */
  function compile() {
    clearTimeout(state.compileTimer);
    stopRunning();
    state.session = null;
    state.compileError = null;
    state.shownConsoleKey = '';
    renderer.clear();
    try {
      state.session = new C.Session(editor.value, { stdin: els.stdin.value });
    } catch (e) {
      if (!(e instanceof C.CompileError)) throw e;
      state.compileError = e;
    }
    show(true);
    return !!state.session;
  }

  function ensureSession() {
    return state.session ? true : compile();
  }

  function onSourceEdited() {
    // The running program no longer matches the text, so drop it and recompile shortly.
    stopRunning();
    state.session = null;
    state.compileError = null;
    editor.clearMarker();
    setRunState('edited', 'edited');
    updateButtons();
    clearTimeout(state.compileTimer);
    state.compileTimer = setTimeout(compile, COMPILE_DELAY_MS);
  }

  function loadProgram(id) {
    const program = C.Programs.find((p) => p.id === id) || C.Programs[0];
    els.program.value = program.id;
    els.stdin.value = program.stdin;
    editor.setValue(program.source);
    state.breakpoints = editor.breakpoints;
    renderer.fit();
    compile();
  }

  /* ------------------------------------------------------------------ *
   * Stepping
   * ------------------------------------------------------------------ */

  function stopRunning() {
    state.running = false;
    state.until = null;
    state.stepDebt = 0;
  }

  function startRunning(until) {
    if (!ensureSession()) return;
    if (state.session.done) {
      if (!compile()) return;
    }
    state.running = true;
    state.until = until || null;
    state.stepDebt = 0;
    state.lastTick = 0;
    updateButtons();
  }

  function toggleRun() {
    if (state.running) {
      stopRunning();
      show(true);
    } else {
      startRunning(null);
    }
  }

  function stepInto() {
    stopRunning();
    if (!ensureSession()) return;
    state.session.stepForward();
    show(true);
  }

  function stepBack() {
    stopRunning();
    if (!state.session) return;
    state.session.stepBack();
    show(true);
  }

  function stepOver() {
    if (!ensureSession() || state.session.done) return;
    const depth = state.session.current.depth;
    startRunning((rec) => rec.depth <= depth);
  }

  function stepOut() {
    if (!ensureSession() || state.session.done) return;
    const depth = state.session.current.depth;
    startRunning((rec) => rec.depth < depth);
  }

  function restart() {
    compile();
  }

  /** Executes one step during a run. Returns false when the run should stop. */
  function runOneStep() {
    const session = state.session;
    const before = session.current;
    if (!session.stepForward()) return false;
    const rec = session.current;
    if (session.done) return false;
    if (state.until && state.until(rec)) return false;
    if (rec.kind === 'stmt' && rec.loc && state.breakpoints.has(rec.loc.line)) {
      const sameSpot = before.loc && before.loc.line === rec.loc.line && before.depth === rec.depth;
      if (!sameSpot) return false;
    }
    return true;
  }

  function runLoop(time) {
    requestAnimationFrame(runLoop);
    if (!state.running || !state.session) {
      state.lastTick = 0;
      return;
    }
    const dt = state.lastTick ? Math.min(0.1, (time - state.lastTick) / 1000) : 0.016;
    state.lastTick = time;

    const speed = state.until ? Infinity : SPEEDS[Number(els.speed.value) - 1];
    let steps;
    if (speed === Infinity) {
      steps = Infinity;
    } else {
      state.stepDebt += dt * speed;
      steps = Math.floor(state.stepDebt);
      state.stepDebt -= steps;
    }
    if (steps === 0) return;

    const deadline = performance.now() + RUN_BUDGET_MS;
    let keepGoing = true;
    let done = 0;
    while (keepGoing && done < steps) {
      keepGoing = runOneStep();
      done++;
      if ((done & 31) === 0 && performance.now() > deadline) break;
    }
    if (!keepGoing) stopRunning();
    show(!state.running);
  }

  /* ------------------------------------------------------------------ *
   * Presentation
   * ------------------------------------------------------------------ */

  function setRunState(key, text) {
    els.runState.dataset.state = key;
    els.runState.textContent = text;
  }

  function updateButtons() {
    const s = state.session;
    const ok = !!s || !state.compileError;
    els.run.classList.toggle('is-running', state.running);
    els.runLabel.textContent = state.running ? 'Pause' : s && s.done ? 'Rerun' : 'Run';
    els.run.disabled = !ok;
    els.step.disabled = !ok || (!!s && !s.canStepForward);
    els.over.disabled = !ok || (!!s && s.done);
    els.out.disabled = !s || s.done || s.current.depth < 2;
    els.back.disabled = !s || !s.canStepBack;
    els.restart.disabled = !s && !state.compileError;
  }

  function renderConsole() {
    const s = state.session;
    let html = '';
    let key;
    if (state.compileError) {
      const e = state.compileError;
      const where = e.loc ? `line ${e.loc.line}, column ${e.loc.col}: ` : '';
      key = 'compile:' + where + e.message;
      html = `<span class="c-error">compile error — ${escapeHtml(where + e.message)}</span>\n` +
        '<span class="c-info">Fix the source above; it recompiles as you type.</span>';
    } else if (s) {
      const rec = s.current;
      key = rec.step + ':' + rec.consoleLen + ':' + rec.consoleTail;
      if (key === state.shownConsoleKey) return;
      const chunks = s.consoleAt(rec);
      html = chunks.map((c) => `<span class="c-${c.kind}">${escapeHtml(c.text)}${c.kind === 'out' || c.kind === 'in' ? '' : '\n'}</span>`).join('');
      // Diagnostics always start on their own line, even after unterminated output.
      html = html.replace(/([^\n>])<\/span><span class="c-(warn|error|info)">/g, '$1\n</span><span class="c-$2">');
      if (!html) html = '<span class="c-empty">Program output appears here.</span>';
    } else {
      key = 'none';
      html = '<span class="c-empty">Program output appears here.</span>';
    }
    if (key === state.shownConsoleKey) return;
    state.shownConsoleKey = key;
    els.console.innerHTML = html;
    els.console.scrollTop = els.console.scrollHeight;
  }

  function sourceSnippet(loc) {
    if (!loc) return '';
    const line = editor.value.split('\n')[loc.line - 1] || '';
    const text = loc.endLine === loc.line ? line.slice(loc.col - 1, loc.endCol - 1) : line.slice(loc.col - 1);
    return text.trim().replace(/\s+/g, ' ');
  }

  const TAGS = { call: 'call', return: 'return', heap: 'heap', branch: 'test', next: 'next', done: 'done', error: 'error', info: 'info' };

  function renderNarration() {
    const s = state.session;
    const lines = [];
    if (state.compileError) {
      lines.push({ kind: 'error', html: escapeHtml(state.compileError.message) });
    } else if (!s) {
      lines.push({ kind: 'info', html: 'Compiling…' });
    } else {
      const rec = s.current;
      for (const ev of rec.events.slice(-3)) lines.push({ kind: ev.kind, html: escapeHtml(ev.text) });
      if (rec.kind === 'exit') {
        lines.push({ kind: 'done', html: `The program finished with exit code ${rec.exitCode}. Press Rerun, or step back through the history.` });
      } else if (rec.kind === 'error') {
        lines.push({ kind: 'error', html: escapeHtml(rec.error) });
      } else if (rec.kind === 'return') {
        const frame = rec.snap.frames[rec.snap.frames.length - 1];
        const value = frame && frame.retVal ? ` with the value <code>${escapeHtml(C.formatValue(frame.retVal))}</code>` : '';
        lines.push({ kind: 'next', html: `<code>${escapeHtml(rec.fn)}()</code> is about to return${value}; its frame will be popped.` });
      } else {
        const snippet = sourceSnippet(rec.loc);
        lines.push({
          kind: 'next',
          html: `line ${rec.loc.line}` + (snippet ? `: <code>${escapeHtml(snippet)}</code>` : ''),
        });
      }
    }
    els.narration.innerHTML = lines.map((l) =>
      `<div class="nar" data-kind="${l.kind}"><span class="nar-tag">${TAGS[l.kind] || l.kind}</span>` +
      `<span class="nar-text">${l.html}</span></div>`).join('');
  }

  function renderStatus() {
    const s = state.session;
    if (!s) {
      els.timeline.min = 0;
      els.timeline.max = 0;
      els.timeline.value = 0;
      els.timeline.disabled = true;
      els.timelineLabel.textContent = 'no history';
      els.statLine.textContent = '–';
      els.statFn.textContent = '–';
      els.statDepth.textContent = '0';
      els.statSp.textContent = '–';
      els.statStack.textContent = '0 B';
      els.statHeap.textContent = '0 B';
      return;
    }
    const rec = s.current;
    els.timeline.disabled = false;
    els.timeline.min = s.base;
    els.timeline.max = s.head;
    els.timeline.value = s.cursor;
    els.timelineLabel.textContent = s.atHead ? `step ${rec.step}` : `step ${rec.step} of ${s.head}`;
    els.statLine.textContent = rec.loc ? String(rec.loc.line) : '–';
    els.statFn.textContent = rec.fn ? rec.fn + '()' : '–';
    els.statDepth.textContent = String(rec.snap.frames.length);
    els.statSp.textContent = C.hex(rec.snap.sp);
    els.statStack.textContent = `${C.LAYOUT.STACK_TOP - rec.snap.sp} B`;
    const blocks = rec.snap.blocks.filter((b) => b.state === 'used').length;
    els.statHeap.textContent = `${rec.snap.heapInUse} B` + (blocks ? ` in ${blocks} block${blocks === 1 ? '' : 's'}` : '');
  }

  /** Brings every panel in line with the session's current record. */
  function show(follow) {
    const s = state.session;
    if (state.compileError) {
      editor.setMarker(state.compileError.loc, 'error', true);
      setRunState('error', 'compile error');
    } else if (s) {
      const rec = s.current;
      renderer.setView(C.buildView(rec, s.program));
      const kind = rec.kind === 'error' ? 'error' : 'exec';
      editor.setMarker(rec.loc, kind, true);
      if (rec.kind === 'exit') setRunState('finished', `finished · exit ${rec.exitCode}`);
      else if (rec.kind === 'error') setRunState('error', 'runtime error');
      else if (state.running) setRunState('running', 'running');
      else if (!s.atHead) setRunState('paused', 'viewing history');
      else setRunState('paused', rec.step === 0 ? 'ready' : 'paused');
    }
    renderConsole();
    renderNarration();
    renderStatus();
    updateButtons();
  }

  /* ------------------------------------------------------------------ *
   * Theme
   * ------------------------------------------------------------------ */

  const THEMES = ['auto', 'dark', 'light'];

  function applyTheme(theme) {
    const rootEl = document.documentElement;
    if (theme === 'auto') rootEl.removeAttribute('data-theme');
    else rootEl.setAttribute('data-theme', theme);
    els.themeLabel.textContent = theme === 'auto' ? 'Auto' : theme === 'dark' ? 'Dark' : 'Light';
    els.theme.dataset.theme = theme;
    renderer.refreshTheme();
  }

  function initTheme() {
    const preset = document.documentElement.getAttribute('data-theme');
    let saved = null;
    try {
      saved = localStorage.getItem('cviz-theme');
    } catch (e) {
      saved = null;
    }
    applyTheme(THEMES.includes(saved) ? saved : THEMES.includes(preset) ? preset : 'auto');

    els.theme.addEventListener('click', () => {
      const next = THEMES[(THEMES.indexOf(els.theme.dataset.theme) + 1) % THEMES.length];
      applyTheme(next);
      try {
        localStorage.setItem('cviz-theme', next);
      } catch (e) {
        /* storage is optional */
      }
    });

    // Follow the OS setting, and any host page that flips data-theme on <html>.
    if (typeof matchMedia === 'function') {
      const mq = matchMedia('(prefers-color-scheme: dark)');
      if (mq.addEventListener) mq.addEventListener('change', () => renderer.refreshTheme());
    }
    new MutationObserver(() => {
      const attr = document.documentElement.getAttribute('data-theme');
      const theme = THEMES.includes(attr) ? attr : 'auto';
      if (theme !== els.theme.dataset.theme) applyTheme(theme);
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  /* ------------------------------------------------------------------ *
   * Wiring
   * ------------------------------------------------------------------ */

  function updateSpeedLabel() {
    const speed = SPEEDS[Number(els.speed.value) - 1];
    els.speedLabel.textContent = speed === Infinity ? 'max' : `${speed} step${speed === 1 ? '' : 's'}/s`;
  }

  function bind() {
    for (const p of C.Programs) {
      const option = document.createElement('option');
      option.value = p.id;
      option.textContent = p.title;
      option.title = p.summary;
      els.program.appendChild(option);
    }
    els.program.addEventListener('change', () => loadProgram(els.program.value));

    els.run.addEventListener('click', toggleRun);
    els.step.addEventListener('click', stepInto);
    els.back.addEventListener('click', stepBack);
    els.over.addEventListener('click', stepOver);
    els.out.addEventListener('click', stepOut);
    els.restart.addEventListener('click', restart);

    els.speed.addEventListener('input', updateSpeedLabel);
    els.stdin.addEventListener('change', compile);

    els.timeline.addEventListener('input', () => {
      if (!state.session) return;
      stopRunning();
      state.session.seek(Number(els.timeline.value));
      show(true);
    });

    els.zoomIn.addEventListener('click', () => renderer.zoomAt(1.2));
    els.zoomOut.addEventListener('click', () => renderer.zoomAt(1 / 1.2));
    els.fit.addEventListener('click', () => renderer.fit());

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        toggleRun();
        return;
      }
      if (e.key === 'F10') {
        e.preventDefault();
        if (e.shiftKey) stepOut();
        else stepOver();
        return;
      }
      const tag = e.target && e.target.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' || e.ctrlKey || e.metaKey || e.altKey) return;
      switch (e.key) {
        case ' ':
          // Let Space activate a focused button instead of toggling the run twice.
          if (tag === 'BUTTON') return;
          toggleRun();
          break;
        case 'ArrowRight': case 's': case 'S':
          stepInto();
          break;
        case 'ArrowLeft': case 'b': case 'B':
          stepBack();
          break;
        case 'o': case 'O':
          stepOver();
          break;
        case 'u': case 'U':
          stepOut();
          break;
        case 'r': case 'R':
          restart();
          break;
        default:
          return;
      }
      e.preventDefault();
    });

    setInterval(() => {
      els.statFps.textContent = renderer.fps ? `${renderer.fps} fps` : '– fps';
    }, 500);

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        renderer.dirty = true;
      });
    }
  }

  /**
   * Opens on a state worth looking at: the default program, advanced until
   * three frames are stacked and the heap array exists.
   */
  function openingScene() {
    loadProgram(DEFAULT_PROGRAM);
    const s = state.session;
    if (!s) return;
    for (let i = 0; i < 400 && s.status === 'running'; i++) {
      if (s.current.depth >= 3 && s.current.fn === 'power' && s.current.events.length === 0) break;
      s.stepForward();
    }
    renderer.clear();
    show(true);
  }

  bind();
  initTheme();
  updateSpeedLabel();
  openingScene();
  requestAnimationFrame(runLoop);

  // Exposed for debugging from the browser console and for automated tests.
  window.CVizApp = { state, editor, renderer, compile, stepInto, stepBack, stepOver, stepOut, toggleRun, loadProgram };
})();
