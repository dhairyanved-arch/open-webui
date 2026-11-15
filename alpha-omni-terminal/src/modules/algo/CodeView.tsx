import * as React from 'react';

type Token = { text: string; cls?: string };

const PY_RE =
	/("""[\s\S]*?"""|#[^\n]*)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|\b(def|return|import|from|as|if|else|elif|for|in|while|not|and|or|is|None|True|False|break|continue|lambda|class|with|any|sum)\b|\b(\d[\d_]*(?:\.\d+)?)\b|\b([A-Za-z_][A-Za-z0-9_]*)(?=\()/g;

const JSON_RE = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

const CLS = {
	comment: 'text-white/35 italic',
	string: 'text-bull/85',
	keyword: 'text-violet',
	number: 'text-primary',
	call: 'text-accent',
	key: 'text-accent',
	literal: 'text-violet'
};

function tokenise(source: string, language: 'python' | 'json'): Token[] {
	const tokens: Token[] = [];
	const re = new RegExp(language === 'python' ? PY_RE : JSON_RE);
	let last = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(source))) {
		if (m.index > last) tokens.push({ text: source.slice(last, m.index) });
		if (language === 'python') {
			const cls = m[1] ? CLS.comment : m[2] ? CLS.string : m[3] ? CLS.keyword : m[4] ? CLS.number : CLS.call;
			tokens.push({ text: m[0], cls });
		} else if (m[1]) {
			tokens.push({ text: m[1], cls: m[2] ? CLS.key : CLS.string });
			if (m[2]) tokens.push({ text: m[2] });
		} else {
			tokens.push({ text: m[0], cls: m[3] ? CLS.literal : CLS.number });
		}
		last = m.index + m[0].length;
	}
	if (last < source.length) tokens.push({ text: source.slice(last) });
	return tokens;
}

/** Read-only code pane with line numbers and light syntax colouring. */
export function CodeView({ source, language }: { source: string; language: 'python' | 'json' }) {
	const tokens = React.useMemo(() => tokenise(source, language), [source, language]);
	const lineCount = React.useMemo(() => source.split('\n').length, [source]);
	return (
		<div className="thin-scroll h-full overflow-auto bg-black/30">
			<div className="flex min-w-max py-3 text-[11.5px] leading-[1.6]">
				<div aria-hidden className="num sticky left-0 shrink-0 bg-[rgb(7_10_14/0.92)] pr-3 pl-3 text-right text-white/25 select-none">
					{Array.from({ length: lineCount }, (_, i) => (
						<div key={i}>{i + 1}</div>
					))}
				</div>
				<pre className="num m-0 pr-4">
					<code data-testid="code-output" data-language={language}>
						{tokens.map((t, i) =>
							t.cls ? (
								<span key={i} className={t.cls}>
									{t.text}
								</span>
							) : (
								t.text
							)
						)}
					</code>
				</pre>
			</div>
		</div>
	);
}
