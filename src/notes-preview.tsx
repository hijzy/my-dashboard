import MarkdownIt from 'markdown-it';
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

const markdownRenderer = new MarkdownIt({
	html: false,
	linkify: true,
	typographer: true,
	highlight(code: string, language: string) {
		try {
			return highlightCode(code, language);
		} catch {
			return `<pre class="hljs"><code>${escapeHtml(code)}</code></pre>`;
		}
	}
});

export function NotesPreview(props: NotesPreviewProps) {
	const previewHtml = markdownRenderer.render(props.content);
	return <div className="note-preview markdown-body" dangerouslySetInnerHTML={{ __html: previewHtml }} />;
}

