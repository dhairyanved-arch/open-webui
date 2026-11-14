/*
 * Test suite for the C runtime simulator. No dependencies:
 *
 *     node tests/run-tests.js
 *
 * Covers the embedded programs, language semantics, the standard library,
 * runtime error detection, and stack/heap accounting.
 */
'use strict';

const path = require('path');

const root = path.join(__dirname, '..', 'js');
for (const file of [
  'core/errors', 'core/types', 'core/lexer', 'core/parser', 'core/memory', 'core/resolver',
  'core/stdlib', 'core/interpreter', 'core/session', 'core/view-model', 'programs', 'ui/layout',
]) {
  require(path.join(root, file + '.js'));
}
const C = globalThis.CViz;

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push({ name, error: e });
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message || 'assertion failed');
}

function equal(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || 'values differ'}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`);
  }
}

/** Runs a program to completion and returns the finished session. */
function run(source, stdin) {
  return new C.Session(source, { stdin: stdin || '', maxHistory: 1e9 }).runToEnd();
}

/** Wraps statements in main() and returns stdout. */
function output(body, prelude) {
  const s = run(`${prelude || ''}\nint main() {\n${body}\nreturn 0;\n}\n`);
  if (s.status === 'error') throw new Error('runtime error: ' + s.current.error);
  return s.stdout();
}

function runtimeError(source) {
  const s = run(source);
  assert(s.status === 'error', 'expected a runtime error but the program finished normally');
  return s.current.error;
}

function compileError(source) {
  try {
    C.compile(source);
  } catch (e) {
    if (e instanceof C.CompileError) return e;
    throw e;
  }
  throw new Error('expected a compile error but the program compiled');
}

/* ====================================================================== *
 * Embedded programs
 * ====================================================================== */

for (const program of C.Programs) {
  test(`program: ${program.title} prints the expected output`, () => {
    const s = run(program.source, program.stdin);
    equal(s.status, 'finished');
    equal(s.exitCode, 0);
    equal(s.stdout(), program.expected);
  });

  test(`program: ${program.title} leaves the stack and heap clean`, () => {
    const s = run(program.source, program.stdin);
    const mem = s.interp.mem;
    equal(mem.sp, C.LAYOUT.STACK_TOP, 'stack pointer is back at the top of the stack');
    equal(mem.frames.length, 0, 'no frames remain');
    equal(mem.stats.framesPushed, mem.stats.framesPopped, 'every pushed frame was popped');
    equal(mem.stats.mallocs, mem.stats.frees, 'every allocation was freed');
    equal(mem.heapBytesInUse(), 0, 'no heap bytes in use');
  });
}

/* ====================================================================== *
 * Armstrong generator: step-by-step frame accounting
 * ====================================================================== */

test('armstrong: frames allocate and deallocate correctly on every step', () => {
  const program = C.Programs.find((p) => p.id === 'armstrong');
  const s = run(program.source);
  const TOP = C.LAYOUT.STACK_TOP;
  const callees = { main: ['isArmstrong'], isArmstrong: ['countDigits', 'power'], countDigits: [], power: [] };
  let pushes = 0;
  let pops = 0;
  let previous = [];

  for (const rec of s.records) {
    const frames = rec.snap.frames;
    equal(frames.length, rec.depth, `step ${rec.step}: recorded depth matches the frame list`);

    // Frames are contiguous: each starts where its caller's ends, and sp sits below the last.
    let expectedTop = TOP;
    frames.forEach((f, i) => {
      equal(f.top, expectedTop, `step ${rec.step}: frame ${i} starts where its caller ends`);
      assert(f.bottom < f.top, `step ${rec.step}: frame ${i} has a positive size`);
      equal(f.depth, i);
      if (i > 0) {
        assert(callees[frames[i - 1].name].includes(f.name),
          `step ${rec.step}: ${frames[i - 1].name}() does not call ${f.name}()`);
        // The saved frame pointer links back into the caller's frame.
        equal(f.savedFp, frames[i - 1].savedFpAt, `step ${rec.step}: saved fp points at the caller's frame`);
      }
      // Parameters sit above the return address; locals sit below the saved frame pointer.
      f.params.forEach((p) => assert(p.addr > f.retAddrAt && p.addr + p.type.size <= f.top));
      f.locals.forEach((l) => assert(l.addr < f.savedFpAt && l.addr >= f.bottom));
      equal(f.retAddrAt, f.savedFpAt + 4);
      expectedTop = f.bottom;
    });
    equal(rec.snap.sp, expectedTop, `step ${rec.step}: sp is the bottom of the newest frame`);
    if (frames.length) equal(frames[0].name, 'main');

    // Count transitions by comparing frame ids with the previous step.
    const ids = frames.map((f) => f.id);
    for (const id of ids) if (!previous.includes(id)) pushes++;
    for (const id of previous) if (!ids.includes(id)) pops++;
    previous = ids;
  }

  const stats = s.interp.mem.stats;
  equal(pushes, stats.framesPushed, 'every push is visible in the history');
  equal(pops, stats.framesPopped, 'every pop is visible in the history');
  equal(pushes, pops);
  equal(stats.maxDepth, 3, 'main → isArmstrong → power is three frames deep');
  // 1 main + 500 isArmstrong + 500 countDigits + one power() call per digit of 1..500.
  const digitCalls = 9 * 1 + 90 * 2 + 401 * 3;
  equal(stats.framesPushed, 1 + 500 + 500 + digitCalls);
  equal(s.records[s.records.length - 1].snap.sp, TOP, 'final snapshot has an empty stack');
});

test('armstrong: results are written into the heap block and it is freed', () => {
  const program = C.Programs.find((p) => p.id === 'armstrong');
  const s = run(program.source);
  // Find the last step before free(): the block must hold the 13 Armstrong numbers.
  const beforeFree = s.records.filter((r) => r.snap.blocks.some((b) => b.state === 'used')).pop();
  const block = beforeFree.snap.blocks[0];
  equal(block.size, 64, 'malloc(16 * sizeof(int))');
  equal(block.viewType, C.Types.int, 'the block is viewed as an int array');
  const values = [];
  for (let i = 0; i < 13; i++) values.push(beforeFree.snap.peek(block.addr + i * 4, C.Types.int));
  equal(values.join(','), '1,2,3,4,5,6,7,8,9,153,370,371,407');
  assert(!beforeFree.snap.isInit(block.addr + 13 * 4, 4), 'slot 13 was never written');
  const final = s.current.snap;
  equal(final.blocks.filter((b) => b.state === 'used').length, 0);
  equal(final.heapInUse, 0);
});

test('armstrong: the view model resolves the results pointer to the heap array', () => {
  const program = C.Programs.find((p) => p.id === 'armstrong');
  const s = new C.Session(program.source);
  while (!(s.current.fn === 'power' && s.current.depth === 3)) s.stepForward();
  const view = C.buildView(s.current, s.program);
  equal(view.frames.map((f) => f.name).join('>'), 'main>isArmstrong>power');
  equal(view.heap.length, 1);
  equal(view.heap[0].cells.length, 16);
  equal(view.pointers.length, 1);
  equal(view.pointers[0].status, 'ok');
  equal(view.pointers[0].to, view.heap[0].cells[0].id, 'results points at element [0]');
  const layout = C.computeLayout(view, 'wide');
  const ids = new Set(layout.items.map((i) => i.id));
  assert(ids.has(view.pointers[0].from) && ids.has(view.pointers[0].to), 'both arrow endpoints are laid out');
  const frames = layout.items.filter((i) => i.kind === 'frame');
  assert(frames[0].y < frames[1].y && frames[1].y < frames[2].y, 'newer frames are placed lower');
});

/* ====================================================================== *
 * Debug session
 * ====================================================================== */

test('session: stepping back and forward replays identical snapshots', () => {
  const s = new C.Session(C.Programs.find((p) => p.id === 'recursion').source);
  for (let i = 0; i < 12; i++) s.stepForward();
  const at12 = s.current;
  equal(at12.depth, 6, 'five factorial frames plus main');
  for (let i = 0; i < 5; i++) s.stepBack();
  equal(s.current.step, 7);
  assert(!s.atHead);
  for (let i = 0; i < 5; i++) s.stepForward();
  assert(s.current === at12, 'replay returns the recorded snapshot, not a new one');
  assert(s.atHead);
});

test('session: console output is truncated to the viewed step', () => {
  const s = run('#include <stdio.h>\nint main() { printf("a"); printf("b\\n"); printf("c\\n"); return 0; }');
  const text = (rec) => s.consoleAt(rec).filter((c) => c.kind === 'out').map((c) => c.text).join('');
  equal(text(s.records[0]), '');
  equal(text(s.records[1]), 'a');
  equal(text(s.records[2]), 'ab\n');
  equal(text(s.records[s.records.length - 1]), 'ab\nc\n');
});

test('session: history is capped but stepping continues', () => {
  const s = new C.Session('int main() { int n = 0; for (int i = 0; i < 400; i++) { n += i; } return n > 0 ? 0 : 1; }', { maxHistory: 50 });
  while (s.stepForward()) { /* run */ }
  equal(s.status, 'finished');
  assert(s.records.length <= 50);
  assert(s.base > 0);
  equal(s.exitCode, 0);
});

test('session: scanf consumes stdin and echoes it', () => {
  const s = run('#include <stdio.h>\nint main() { int a; float f; char w[8]; scanf("%d %f %s", &a, &f, w); printf("%d %.1f %s\\n", a * 2, f, w); return 0; }', '21 2.5 hey');
  equal(s.stdout(), '42 2.5 hey\n');
  assert(s.interp.console.some((c) => c.kind === 'in'));
});

/* ====================================================================== *
 * Language semantics
 * ====================================================================== */

test('integers: arithmetic, precedence, and truncating division', () => {
  equal(output('printf("%d %d %d %d %d", 2 + 3 * 4, (2 + 3) * 4, 7 / 2, -7 / 2, -7 % 3);'), '14 20 3 -3 -1');
});

test('integers: overflow wraps to 32 bits', () => {
  equal(output('int a = 2147483647; a++; unsigned int u = 0; u--; printf("%d %u %d", a, u, 65536 * 65536);'),
    '-2147483648 4294967295 0');
});

test('integers: char and short wrap; unsigned char does not sign-extend', () => {
  equal(output('char c = 200; unsigned char u = 200; short s = 40000; printf("%d %d %d", c, u, s);'), '-56 200 -25536');
});

test('integers: bitwise operators and shifts', () => {
  equal(output('printf("%d %d %d %d %d %d", 6 & 3, 6 | 3, 6 ^ 3, ~6, 1 << 10, -16 >> 2);'), '2 7 5 -7 1024 -4');
});

test('integers: compound assignment and increment forms', () => {
  equal(output('int a = 5; a += 3; a *= 2; a -= 1; a /= 3; a %= 4; int b = a++ + ++a; printf("%d %d", a, b);'), '3 4');
});

test('long long: 64-bit arithmetic', () => {
  equal(output('long long f = 1; for (int i = 1; i <= 15; i++) f *= i; printf("%lld", f);'), '1307674368000');
});

test('floats: float precision, double precision, and mixed arithmetic', () => {
  equal(output('float f = 0.1f; double d = 0.1; printf("%.10f %.10f %.2f %d", f, d, 7 / 2.0, (int)3.99);'),
    '0.1000000015 0.1000000000 3.50 3');
});

test('conversions: usual arithmetic conversions pick the wider type', () => {
  equal(output('int i = -1; unsigned int u = 1; printf("%d %d %d", i < u, (char)300, 5 / 2 * 2.0 == 4.0);'), '0 44 1');
});

test('logic: short-circuit evaluation skips the right operand', () => {
  equal(output('int n = 0; int a = 0 && ++n; int b = 1 || ++n; int c = 1 && ++n; printf("%d %d %d %d", a, b, c, n);'), '0 1 1 1');
});

test('control flow: ternary, comma, and nested conditionals', () => {
  equal(output('int x = 7; int y = x > 5 ? (x > 6 ? 2 : 1) : 0; int z = (x++, x * 2); printf("%d %d", y, z);'), '2 16');
});

test('control flow: while, do-while, break, and continue', () => {
  equal(output(`int s = 0; int i = 0;
    while (1) { i++; if (i % 2) continue; if (i > 10) break; s += i; }
    int n = 0; do { n++; } while (n < 3);
    printf("%d %d %d", s, i, n);`), '30 12 3');
});

test('control flow: for loop scoping and nested loops', () => {
  equal(output('int t = 0; for (int i = 0; i < 3; i++) { for (int j = 0; j <= i; j++) { t += j; } } int i = 9; printf("%d %d", t, i);'), '4 9');
});

test('control flow: switch with fallthrough and default', () => {
  equal(output(`for (int i = 0; i < 5; i++) {
      switch (i) {
        case 0: printf("zero "); break;
        case 1:
        case 2: printf("low ");
        case 3: printf("three "); break;
        default: printf("other ");
      }
    }`), 'zero low three low three three other ');
});

test('functions: recursion and mutual calls through prototypes', () => {
  equal(output('printf("%d %d %d", fib(10), isEven(10), isEven(7));',
    'int isOdd(int n);\nint isEven(int n) { return n == 0 ? 1 : isOdd(n - 1); }\nint isOdd(int n) { return n == 0 ? 0 : isEven(n - 1); }\nint fib(int n) { if (n < 2) return n; return fib(n - 1) + fib(n - 2); }'),
  '55 1 0');
});

test('functions: arguments are passed by value', () => {
  equal(output('int x = 1; bump(x); printf("%d", x);', 'void bump(int n) { n = n + 100; }'), '1');
});

test('functions: function pointers', () => {
  equal(output('int (*op)(int, int) = add; int a = op(2, 3); op = &mul; printf("%d %d %d", a, op(2, 3), apply(add, 10, 20));',
    'int add(int a, int b) { return a + b; }\nint mul(int a, int b) { return a * b; }\nint apply(int (*f)(int, int), int a, int b) { return f(a, b); }'),
  '5 6 30');
});

test('globals: initialised before main and shared across calls', () => {
  equal(output('tick(); tick(); printf("%d %d %s", counter, table[2], name);',
    'int counter = 10;\nint table[4] = {1, 2, 3};\nchar *name = "glob";\nvoid tick() { counter++; }'), '12 3 glob');
});

test('pointers: address-of, dereference, and writing through a pointer', () => {
  equal(output('int x = 5; int *p = &x; *p = 9; int **pp = &p; **pp += 1; printf("%d %d", x, *p == x);'), '10 1');
});

test('pointers: arithmetic scales by the pointee size', () => {
  equal(output('int a[5] = {10, 20, 30, 40, 50}; int *p = a; p += 2; int *q = &a[4]; printf("%d %d %d %d", *p, *(p + 1), (int)(q - p), p[-1]);'),
    '30 40 2 20');
});

test('pointers: comparisons and NULL checks', () => {
  equal(output('int a[3]; int *p = a; int *q = a + 2; int *n = NULL; printf("%d %d %d %d", p < q, p == a, n == NULL, !n);'), '1 1 1 1');
});

test('pointers: swap through pointer parameters', () => {
  equal(output('int a = 1, b = 2; swap(&a, &b); printf("%d %d", a, b);',
    'void swap(int *x, int *y) { int t = *x; *x = *y; *y = t; }'), '2 1');
});

test('arrays: initialisers zero-fill and sizeof reports the whole array', () => {
  equal(output('int a[6] = {1, 2}; char s[] = "hey"; printf("%d %d %d %d %d", a[1], a[5], (int)sizeof(a), (int)sizeof(s), (int)(sizeof(a) / sizeof(a[0])));'),
    '2 0 24 4 6');
});

test('arrays: two-dimensional arrays', () => {
  equal(output('int m[2][3] = {{1, 2, 3}, {4, 5, 6}}; int t = 0; for (int r = 0; r < 2; r++) for (int c = 0; c < 3; c++) t += m[r][c] * (r + 1); printf("%d %d", t, (int)sizeof(m));'),
    '36 24');
});

test('arrays: decay to a pointer when passed to a function', () => {
  equal(output('int a[4] = {4, 3, 2, 1}; printf("%d", total(a, 4));',
    'int total(int values[], int n) { int t = 0; for (int i = 0; i < n; i++) t += values[i]; return t; }'), '10');
});

test('strings: literals, char arrays, and <string.h>', () => {
  equal(output(`char buf[16]; strcpy(buf, "abc"); strcat(buf, "def");
    printf("%d %s %d %d %d", (int)strlen(buf), buf, strcmp("abc", "abd") < 0, strcmp(buf, "abcdef"), strncmp("hello", "help", 3));`),
  '6 abcdef 1 0 0');
});

test('strings: walking a string with a pointer', () => {
  equal(output('char *s = "hello"; int n = 0; while (*s) { if (*s == \'l\') n++; s++; } printf("%d", n);'), '2');
});

test('strings: <ctype.h> classification and case conversion', () => {
  equal(output('printf("%d %d %d %c %c", isdigit(\'7\'), isalpha(\'7\'), isspace(\' \'), toupper(\'q\'), tolower(\'Q\'));'), '1 0 1 Q q');
});

test('structs: fields, pointers to structs, and layout with padding', () => {
  equal(output(`struct P p = {'x', 7, 2.5}; struct P *q = &p; q->n += 1; p.d *= 2;
    printf("%c %d %.1f %d", q->tag, p.n, q->d, (int)sizeof(struct P));`,
  'struct P { char tag; int n; double d; };'), 'x 8 5.0 16');
});

test('structs: assignment copies, and arrays of structs', () => {
  equal(output(`struct V a = {1, 2}; struct V b = a; b.x = 9; struct V arr[2] = {{3, 4}, {5, 6}};
    printf("%d %d %d %d", a.x, b.x, arr[1].y, len2(arr[0]));`,
  'struct V { int x; int y; };\nint len2(struct V v) { return v.x * v.x + v.y * v.y; }'), '1 9 6 25');
});

test('structs: typedef names and self-referential nodes', () => {
  equal(output(`Node a = {1, NULL}; Node b = {2, &a}; Node *n = &b; int t = 0; while (n) { t += n->v; n = n->next; } printf("%d", t);`,
    'typedef struct Node { int v; struct Node *next; } Node;'), '3');
});

test('enums and #define constants', () => {
  equal(output('enum Color c = GREEN; int a[SIZE]; printf("%d %d %d %d", RED, c, BLUE, (int)(sizeof(a) / sizeof(int)));',
    '#define SIZE 3\nenum Color { RED, GREEN = 5, BLUE };'), '0 5 6 3');
});

test('sizeof: types and expressions', () => {
  equal(output('int x; double d; char *p; printf("%d %d %d %d %d %d", (int)sizeof(char), (int)sizeof x, (int)sizeof(d), (int)sizeof(p), (int)sizeof(long long), (int)sizeof(x + d));'),
    '1 4 8 4 8 8');
});

test('math: <math.h> functions', () => {
  equal(output('printf("%.1f %.1f %.1f %.1f %d", sqrt(16.0), pow(2, 10), fabs(-2.5), floor(2.7), abs(-9));'), '4.0 1024.0 2.5 2.0 9');
});

test('printf: widths, flags, precision, and bases', () => {
  equal(output('printf("[%5d][%-5d][%05d][%+d][%x][%X][%o][%c][%5s][%-5s][%.2s][%%]", 42, 42, 42, 42, 255, 255, 8, 65, "ab", "ab", "abcdef");'),
    '[   42][42   ][00042][+42][ff][FF][10][A][   ab][ab   ][ab][%]');
});

test('printf: floating-point formats', () => {
  equal(output('printf("%f %.3f %8.2f %e %g %g", 3.14159, 2.0, 3.14159, 12345.678, 0.0001, 1234567.0);'),
    '3.141590 2.000 %s 1.234568e+04 0.0001 1.23457e+06'.replace('%s', '    3.14'));
});

test('heap: malloc, write, read, realloc, free', () => {
  equal(output(`int *a = malloc(3 * sizeof(int)); for (int i = 0; i < 3; i++) a[i] = i + 1;
    a = realloc(a, 6 * sizeof(int)); a[5] = 60; int t = a[0] + a[1] + a[2] + a[5]; free(a);
    int *z = calloc(4, sizeof(int)); t += z[3]; free(z); printf("%d", t);`), '66');
});

test('heap: freed blocks are reused and neighbours coalesce', () => {
  const s = run(`#include <stdlib.h>
    int main() {
      char *a = malloc(16); char *b = malloc(16); char *c = malloc(16);
      free(a); free(b);
      char *d = malloc(24);
      int same = d == a;
      free(c); free(d);
      return same;
    }`);
  equal(s.exitCode, 1, 'the coalesced a+b region satisfies a larger request at the same address');
  equal(s.interp.mem.blocks.length, 1, 'everything coalesced into one free block');
  equal(s.interp.mem.blocks[0].state, 'free');
});

/* ====================================================================== *
 * Runtime errors
 * ====================================================================== */

test('error: NULL pointer dereference', () => {
  assert(/NULL pointer dereference/.test(runtimeError('int main() { int *p = 0; return *p; }')));
});

test('error: division by zero', () => {
  assert(/division by zero/.test(runtimeError('int main() { int z = 0; return 10 / z; }')));
});

test('error: use after free', () => {
  assert(/use after free/.test(runtimeError('#include <stdlib.h>\nint main() { int *p = malloc(4); *p = 1; free(p); return *p; }')));
});

test('error: double free', () => {
  assert(/double free/.test(runtimeError('#include <stdlib.h>\nint main() { int *p = malloc(4); free(p); free(p); return 0; }')));
});

test('error: heap buffer overflow', () => {
  assert(/heap buffer overflow/.test(runtimeError('#include <stdlib.h>\nint main() { int *p = malloc(8); p[2] = 1; return 0; }')));
});

test('error: strcpy past the end of a heap buffer', () => {
  assert(/heap buffer overflow/.test(runtimeError('#include <stdlib.h>\n#include <string.h>\nint main() { char *p = malloc(4); strcpy(p, "too long"); return 0; }')));
});

test('error: free of a pointer that malloc never returned', () => {
  assert(/invalid pointer/.test(runtimeError('#include <stdlib.h>\nint main() { int x; free(&x); return 0; }')));
});

test('error: dangling pointer to a returned frame', () => {
  const msg = runtimeError('int *leak() { int local = 5; return &local; }\nint main() { int *p = leak(); return *p; }');
  assert(/already returned/.test(msg), msg);
});

test('error: writing to a string literal', () => {
  assert(/read-only/.test(runtimeError('int main() { char *s = "abc"; s[0] = 65; return 0; }')));
});

test('error: runaway recursion overflows the stack', () => {
  const s = run('int down(int n) { return down(n + 1); }\nint main() { return down(0); }');
  equal(s.status, 'error');
  assert(/stack overflow/.test(s.current.error));
  equal(s.interp.mem.frames.length, C.LAYOUT.MAX_FRAMES, 'the stack was full when it overflowed');
});

test('error: runtime errors carry the source line', () => {
  const s = run('int main() {\n  int a = 1;\n  int *p = 0;\n  *p = a;\n  return 0;\n}');
  equal(s.current.kind, 'error');
  equal(s.current.loc.line, 4);
});

test('warning: reading an uninitialised variable', () => {
  const s = run('int main() { int x; int y = x + 1; return 0; }');
  assert(s.interp.console.some((c) => c.kind === 'warn' && /before it was ever assigned/.test(c.text)));
});

test('leak check: unfreed memory is reported at exit', () => {
  const s = run('#include <stdlib.h>\nint main() { int *p = malloc(40); p[0] = 1; return 0; }');
  assert(s.interp.console.some((c) => c.kind === 'warn' && /40 byte\(s\) in 1 block/.test(c.text)));
  const view = C.buildView(s.current, s.program);
  assert(view.heap[0].leaked, 'the leaked block is flagged in the final view');
});

test('exit(): ends the program from inside a nested call', () => {
  const s = run('#include <stdlib.h>\n#include <stdio.h>\nvoid stop() { printf("bye\\n"); exit(3); }\nint main() { stop(); printf("unreachable"); return 0; }');
  equal(s.status, 'finished');
  equal(s.exitCode, 3);
  equal(s.stdout(), 'bye\n');
  equal(s.interp.mem.frames.length, 0);
});

/* ====================================================================== *
 * Compile errors
 * ====================================================================== */

test('compile error: missing semicolon points at the right line', () => {
  const e = compileError('int main() {\n  int x = 1\n  return x;\n}');
  assert(/expected ';'/.test(e.message), e.message);
  equal(e.loc.line, 2);
});

test('compile error: undeclared identifier', () => {
  const e = compileError('int main() {\n  return y;\n}');
  assert(/'y' undeclared/.test(e.message));
  equal(e.loc.line, 2);
});

test('compile error: wrong argument count', () => {
  const e = compileError('int f(int a) { return a; }\nint main() { return f(1, 2); }');
  assert(/takes 1 argument but 2 were given/.test(e.message), e.message);
});

test('compile error: missing main, unknown function, break outside loop', () => {
  assert(/main/.test(compileError('int f() { return 0; }').message));
  assert(/not defined anywhere/.test(compileError('int main() { return nope(); }').message));
  assert(/outside of a loop/.test(compileError('int main() { break; return 0; }').message));
});

test('compile error: unterminated string and unclosed block', () => {
  assert(/unterminated string/.test(compileError('int main() { char *s = "abc; return 0; }').message));
  assert(/unclosed block|expected/.test(compileError('int main() { return 0;').message));
});

test('compile error: unsupported features are named explicitly', () => {
  const cases = [
    ['union U { int a; };\nint main() { return 0; }', /unions are not supported/],
    ['int main() { int n = 3; int a[n]; return 0; }', /variable-length arrays are not supported/],
    ['struct B { int x : 3; };\nint main() { return 0; }', /bit-fields are not supported/],
    ['int main() { goto end; end: return 0; }', /goto is not supported/],
    ['#define SQ(x) ((x) * (x))\nint main() { return 0; }', /function-like macro/],
    ['#ifdef X\n#endif\nint main() { return 0; }', /'#ifdef' is not supported/],
    ['int main() { static int n = 0; return n; }', /static local variables are not supported/],
    ['int main() { int a[2] = {[1] = 5}; return 0; }', /designated initializers are not supported/],
    ['struct P { int x; };\nstruct P make() { struct P p = {1}; return p; }\nint main() { return 0; }', /returns a struct by value/],
    ['int sum(int n, ...) { return n; }\nint main() { return 0; }', /variadic functions/],
  ];
  for (const [source, pattern] of cases) {
    const e = compileError(source);
    assert(pattern.test(e.message), `expected ${pattern} but got: ${e.message}`);
    assert(e.loc && e.loc.line >= 1, 'the error carries a source location');
  }
});

/* ====================================================================== *
 * View model
 * ====================================================================== */

test('view: pointer targets are classified', () => {
  const s = new C.Session(`#include <stdlib.h>
    int main() {
      int a[3] = {1, 2, 3};
      int *first = a;
      int *end = a + 3;
      int *heap = malloc(8);
      int *gone = heap;
      char *lit = "hi";
      free(heap);
      heap = NULL;
      return 0;
    }`);
  while (!(s.current.loc && s.current.loc.line === 11)) s.stepForward();
  const view = C.buildView(s.current, s.program);
  const main = view.frames[0];
  const byName = {};
  for (const cell of main.cells) byName[cell.label] = cell;
  const target = (name) => view.pointers.find((p) => p.from === byName[name].id);
  equal(target('first').status, 'ok');
  equal(target('first').to, byName.a.children[0].id);
  equal(target('end').status, 'end', 'one-past-the-end pointer');
  equal(target('gone').status, 'freed', 'dangling pointer into a freed block');
  equal(target('lit').status, 'ok');
  equal(view.literals.length, 1, 'the referenced string literal is shown');
  equal(byName.heap.value, 'NULL');
  assert(!target('heap'), 'NULL pointers draw no arrow');
});

test('view: uninitialised and out-of-scope variables are flagged', () => {
  const s = new C.Session('int main() {\n  int a;\n  int b = 2;\n  {\n    int c = 3;\n    b += c;\n  }\n  return b;\n}');
  const cellsAt = (line) => {
    while (!(s.current.loc && s.current.loc.line === line)) s.stepForward();
    const out = {};
    for (const cell of C.buildView(s.current, s.program).frames[0].cells) out[cell.label] = cell;
    return out;
  };
  let cells = cellsAt(3);
  assert(cells.a.live && !cells.a.init, 'a is declared but never assigned');
  assert(!cells.b.live, 'b is not declared yet');
  cells = cellsAt(6);
  assert(cells.c.live && cells.c.init && cells.c.value === '3');
  cells = cellsAt(8);
  assert(!cells.c.live, 'c went out of scope with its block');
  equal(cells.b.value, '5');
});

test('view: layout places every cell and keeps columns apart', () => {
  for (const program of C.Programs) {
    const s = new C.Session(program.source, { stdin: program.stdin });
    for (let i = 0; i < 60 && s.stepForward(); i++) {
      const view = C.buildView(s.current, s.program);
      for (const mode of ['wide', 'narrow']) {
        const layout = C.computeLayout(view, mode);
        const ids = new Set();
        for (const item of layout.items) {
          assert(!ids.has(item.id), `${program.id}: duplicate layout id ${item.id}`);
          ids.add(item.id);
          assert(item.w > 0 && item.h > 0 && item.y >= 0, `${program.id}: bad geometry for ${item.id}`);
          assert(item.x + item.w <= layout.bounds.w, `${program.id}: ${item.id} overflows the layout bounds`);
        }
        for (const p of view.pointers) {
          assert(ids.has(p.from), `${program.id}: arrow source ${p.from} is not laid out`);
          if (p.to) assert(ids.has(p.to), `${program.id}: arrow target ${p.to} is not laid out`);
        }
      }
    }
  }
});

/* ====================================================================== */

for (const f of failures) {
  console.log(`\n  FAIL  ${f.name}\n      ${f.error.message}`);
  if (!/expected|assert|differ/.test(f.error.message)) console.log(f.error.stack.split('\n').slice(1, 5).join('\n'));
}
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
