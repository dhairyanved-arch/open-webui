# C Memory & Stack Visualizer

Step through C programs in the browser and watch what the machine does with
them: stack frames being pushed and popped, heap blocks being allocated and
freed, and every pointer drawn as an arrow to the memory it refers to.

Everything runs client-side. There is no build step, no server, and no
dependency — the C runtime is a lexer, parser, and interpreter written in
plain JavaScript, and the memory view is drawn on an HTML5 canvas.

## Quick start

Open `index.html` in a browser. That is all.

If you prefer to serve it (any static server works):

```sh
cd c-memory-visualizer
python3 -m http.server 8080      # then visit http://localhost:8080
```

The page opens on the Armstrong number generator, paused three calls deep, so
the first thing on screen is a real stack with a heap array attached.

## What you can do

| Control | Keyboard | What it does |
| --- | --- | --- |
| **Run / Pause** | `Space`, `Ctrl/⌘+Enter` | Runs at the chosen speed; stops at breakpoints |
| **Step** | `→` or `S` | Runs one statement, entering function calls |
| **Over** | `O`, `F10` | Runs one statement, treating a call as a single step |
| **Out** | `U`, `Shift+F10` | Runs until the current function returns |
| **Back** | `←` or `B` | Steps backwards through recorded history |
| **Restart** | `R` | Recompiles and starts again |
| **History slider** | | Scrubs to any recorded step |
| **Speed slider** | | 1 statement/second up to "max" (as fast as the browser allows) |

Letter and arrow shortcuts work whenever the cursor is not in the editor.

Other things worth knowing:

- **Edit the code.** The source pane is a real editor. The program recompiles
  as you type and compile errors are reported with line and column.
- **Breakpoints.** Click a line number.
- **stdin.** Programs that call `scanf` or `getchar` read from the `stdin` box.
- **Canvas.** Drag to pan, `Ctrl`+scroll or pinch to zoom, hover a row for its
  address, size, raw bytes, and what a pointer points at. *Follow* (or a
  double-click) returns to automatic framing, which keeps the executing frame
  in view.

## Embedded programs

| Program | What it shows |
| --- | --- |
| Leap Year Check | An array, a loop, and one call frame per check |
| Prime Number Check | `scanf` input and an out-parameter written through a pointer |
| Armstrong Number Generator | Calls three frames deep; results stored in a `malloc`'d array |
| String Palindrome | Two `char *` walking toward each other over a heap string |
| Perfect Number Logic | A helper function summing divisors for each candidate |
| Linked List on the Heap | Structs chained by pointers, then freed (watch `list` dangle) |
| Recursion and Pointer Swap | Five stacked `factorial` frames; `swap` through pointers |

Each program carries its expected output, and the test suite runs all of them
through the simulator.

## How it works

```
source text
   │  js/core/lexer.js        tokens (comments, #include, #define handled here)
   ▼
   │  js/core/parser.js       AST with a source range on every node
   ▼
   │  js/core/resolver.js     names bound to stack slots; static checks
   ▼
   │  js/core/interpreter.js  generator-based evaluator: yields before each statement
   │        │
   │        └── js/core/memory.js   byte-accurate stack, heap, .data, .rodata
   ▼
   │  js/core/session.js      drives the generator; records a snapshot per step
   ▼
   │  js/core/view-model.js   snapshot → cells (variables, elements, fields) + pointer targets
   ▼
   │  js/ui/layout.js         cells → world coordinates
   ▼
      js/ui/renderer.js       canvas: animated sprites, arrows, camera, hit-testing
```

Supporting files: `js/core/types.js` (the C type system), `js/core/stdlib.js`
(the simulated standard library), `js/core/errors.js`, `js/programs.js` (the
embedded examples), `js/ui/editor.js` (the code editor), and `js/ui/app.js`
(toolbar and wiring).

### The runtime

The interpreter is a tree walker written as JavaScript generators. `run()`
yields a pause point before every statement, plus one extra pause on each
`return` after the value is computed and before the frame is popped. That is
what makes single-stepping, breakpoints, and "run at N statements per second"
possible without ever blocking the page.

Stepping backwards does not undo anything. Each pause stores an immutable
snapshot of memory (only the bytes in use, so a snapshot is a few hundred
bytes), and *Back* moves a cursor over that recording. The last 5,000 steps
are kept.

### The memory model

A 32-bit little-endian process image, laid out like classic Linux/x86:

| Region | Base | Contents |
| --- | --- | --- |
| `.text` | `0x08048000` | Function entry points; return addresses point here |
| `.rodata` | `0x08049000` | String literals (writes are rejected) |
| `.data` | `0x0804a000` | Global variables |
| heap | `0x0804c000` | Grows up; first-fit allocator with splitting and coalescing |
| stack | `0xbffff000` | Grows down; one cdecl-style frame per call |

Sizes: `char` 1, `short` 2, `int`/`long`/pointers 4, `long long` 8, `float` 4,
`double` 8. Structs are padded and aligned the usual way.

A stack frame, from high to low addresses, holds the arguments, the return
address, the saved frame pointer, and then every local of the function. The
whole frame is reserved on entry, as a compiler would do it; locals that have
not been declared yet (or have gone out of scope) are shown dimmed.

Every byte also carries an "initialised" bit. A variable that was never
assigned is drawn as a hatched `?` and reading it produces a warning.

Every access the program makes is checked, so these are reported as runtime
errors with the offending line instead of corrupting memory silently:

- NULL and wild pointer dereferences
- use after free, double free, freeing a pointer `malloc` never returned
- heap buffer overflows (including through `strcpy` and friends)
- reads and writes through a pointer to a frame that has returned
- writes to string literals
- division by zero
- stack overflow (the simulator allows 200 nested calls)

When `main` returns, any block still allocated is flagged as a leak.

### The renderer

`renderer.js` runs a `requestAnimationFrame` loop. Every drawable — frame,
variable row, heap block — is a sprite with a stable id that eases from where
it is to where the latest layout puts it, so frames slide in when the stack
grows and neighbours close up when it shrinks. Arrow geometry is recomputed
from the sprites' in-flight positions on every frame, so arrows stay attached
while things move, and an arrow whose pointer was reassigned glides from the
old target to the new one.

Arrows between the stack and the heap run through the gap between the columns;
arrows within a column bow out to its right. Several arrows into one row fan
out. Dashed red arrows are dangling pointers; a dashed arrow to the bottom
edge of an array's last element is a one-past-the-end pointer.

The loop skips drawing when nothing is moving, and the measured frame rate is
shown in the status bar.

## Supported C

**Types** — `void`, `char`, `short`, `int`, `long`, `long long` and their
`unsigned` forms, `float`, `double`, `bool`, pointers (any depth), arrays
(any number of dimensions), `struct`, `enum`, `typedef`, function pointers,
and the `<stdint.h>` fixed-width names.

**Statements** — declarations with initialisers (including brace lists and
string initialisers), `if`/`else`, `for`, `while`, `do`/`while`, `switch`
with fallthrough, `break`, `continue`, `return`.

**Expressions** — the full C operator set with standard precedence: arithmetic,
comparison, logical (short-circuiting), bitwise, shifts, assignment and
compound assignment, `++`/`--`, the ternary and comma operators, casts,
`sizeof`, `&`, `*`, `[]`, `.`, `->`, and calls. Integer arithmetic wraps to
the width of its type; the usual arithmetic conversions apply.

**Preprocessor** — `#include` lines are accepted and ignored (the library is
always available); object-like `#define NAME value` is expanded.

**Library** — `printf`, `sprintf`, `puts`, `putchar`, `scanf`, `getchar`;
`malloc`, `calloc`, `realloc`, `free`, `exit`, `abs`, `atoi`, `atof`, `rand`,
`srand`; `strlen`, `strcpy`, `strncpy`, `strcat`, `strcmp`, `strncmp`,
`strchr`, `strrchr`, `strstr`, `memset`, `memcpy`, `memmove`, `memcmp`;
`isdigit`, `isalpha`, `isalnum`, `isspace`, `isupper`, `islower`, `ispunct`,
`toupper`, `tolower`; `sqrt`, `pow`, `fabs`, `floor`, `ceil`, `round`, `fmod`,
`sin`, `cos`, `tan`, `exp`, `log`, `log10`.

**Not supported** — `union`, `goto`, function-like macros and conditional
compilation, variadic user functions, `static` locals, variable-length arrays,
designated initialisers, bit-fields, and returning a struct by value (pass or
return a pointer instead). Each of these produces a compile error that says so.

## Tests

```sh
node tests/run-tests.js      # or: npm test
```

The suite needs nothing but Node. It covers:

- every embedded program: exact output, exit code, an empty stack and a clean
  heap at exit;
- the Armstrong generator step by step — on each of its ~35,000 pauses the
  frames must be contiguous, correctly nested, and linked through their saved
  frame pointers, and every push must be matched by a pop (2,393 of each);
- language semantics (integer wrapping, conversions, short-circuiting, control
  flow, pointers and pointer arithmetic, arrays, strings, structs, function
  pointers, `printf` formatting);
- each runtime error listed above, and compile-error reporting;
- stepping backwards and forwards, history capping, and stdin handling;
- the view model and layout (pointer target classification, scope and
  initialisation flags, no overlapping or missing layout items).

## Project layout

```
c-memory-visualizer/
├── index.html
├── css/styles.css
├── js/
│   ├── core/         errors, types, lexer, parser, resolver, memory,
│   │                 stdlib, interpreter, session, view-model
│   ├── ui/           layout, renderer, editor, app
│   └── programs.js
├── tests/run-tests.js
├── package.json
└── README.md
```

The scripts are plain `<script>` files that attach to one `CViz` namespace
(and export it under Node), which is why the page works straight from the file
system with no bundler or dev server.
