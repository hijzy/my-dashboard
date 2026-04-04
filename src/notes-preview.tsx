import { useEffect, useRef } from 'react';
import MarkdownIt from 'markdown-it';
import texmath from 'markdown-it-texmath';
import taskLists from 'markdown-it-task-lists';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import mermaid from 'mermaid';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import plaintext from 'highlight.js/lib/languages/plaintext';
import python from 'highlight.js/lib/languages/python';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import 'highlight.js/styles/github.css';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('css', css);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);
hljs.registerLanguage('plaintext', plaintext);
hljs.registerLanguage('text', plaintext);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);

mermaid.initialize({ startOnLoad: false, theme: 'default' });

type NotesPreviewProps = {
	content: string;
};

function escapeHtml(value: string) {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

function highlightCode(code: string, language: string) {
	if (language && hljs.getLanguage(language)) {
		return `<pre class="hljs"><code>${hljs.highlight(code, { language, ignoreIllegals: true }).value}</code></pre>`;
	}
	return `<pre class="hljs"><code>${hljs.highlightAuto(code).value}</code></pre>`;
}

let mermaidIdCounter = 0;

const markdownRenderer = new MarkdownIt({
	html: false,
	linkify: true,
	typographer: true,
	highlight(code: string, language: string) {
		if (language === 'mermaid') {
			const id = `mmd-${++mermaidIdCounter}`;
			return `<div class="mermaid" id="${id}">${escapeHtml(code)}</div>`;
		}
		try {
			return highlightCode(code, language);
		} catch {
			return `<pre class="hljs"><code>${escapeHtml(code)}</code></pre>`;
		}
	}
});

markdownRenderer.use(texmath, {
	engine: katex,
	delimiters: 'dollars',
	katexOptions: { throwOnError: false }
});

markdownRenderer.use(taskLists, { enabled: true, label: true, labelAfter: true });

export function NotesPreview(props: NotesPreviewProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const previewHtml = markdownRenderer.render(props.content);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const nodes = container.querySelectorAll<HTMLElement>('.mermaid');
		if (nodes.length === 0) return;

		let cancelled = false;
		const renderDiagrams = async () => {
			for (let i = 0; i < nodes.length; i++) {
				if (cancelled) return;
				const node = nodes[i];
				const source = node.textContent || '';
				if (!source.trim()) continue;
				try {
					const id = `mermaid-render-${Date.now()}-${i}`;
					const { svg } = await mermaid.render(id, source);
					if (!cancelled && node.isConnected) {
						node.innerHTML = svg;
					}
				} catch {
					if (!cancelled && node.isConnected) {
						node.classList.add('mermaid-error');
					}
				}
			}
		};
		void renderDiagrams();
		return () => { cancelled = true; };
	}, [previewHtml]);

	return <div ref={containerRef} className="note-preview markdown-body" dangerouslySetInnerHTML={{ __html: previewHtml }} />;
}
