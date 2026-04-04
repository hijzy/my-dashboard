declare module 'markdown-it-texmath' {
	import type MarkdownIt from 'markdown-it';
	import type katex from 'katex';

	interface TexMathOptions {
		engine: typeof katex;
		delimiters?: 'dollars' | 'brackets' | 'gitlab' | 'julia' | 'kramdown';
		katexOptions?: katex.KatexOptions;
	}

	const texmath: MarkdownIt.PluginWithOptions<TexMathOptions>;
	export default texmath;
}

declare module 'markdown-it-task-lists' {
	import type MarkdownIt from 'markdown-it';

	interface TaskListsOptions {
		enabled?: boolean;
		label?: boolean;
		labelAfter?: boolean;
	}

	const taskLists: MarkdownIt.PluginWithOptions<TaskListsOptions>;
	export default taskLists;
}
