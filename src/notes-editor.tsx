import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { indentWithTab } from '@codemirror/commands';
import { indentUnit } from '@codemirror/language';
import { markdown as markdownLanguage } from '@codemirror/lang-markdown';
import { minimalSetup } from 'codemirror';

type NotesEditorProps = {
	value: string;
	onChange: (value: string) => void;
};

function createNotesEditorTheme(noteCodeCursor: string, noteCodeSelectionBg: string, noteCodeSelectionFg: string) {
	return EditorView.theme({
		'&': {
			height: '100%',
			backgroundColor: 'transparent'
		},
		'.cm-scroller': {
			overflow: 'auto',
			fontFamily: "'JetBrains Mono Nerd', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
			lineHeight: '1.65'
		},
		'.cm-content, .cm-gutter': {
			minHeight: '100%'
		},
		'.cm-content': {
			padding: '14px 5ch 14px 0',
			minWidth: '100%',
			width: 'fit-content'
		},
		'.cm-line': {
			padding: '0 0 0 10px'
		},
		'.cm-gutters': {
			backgroundColor: 'rgba(238, 243, 248, 0.96)',
			borderRight: '1px solid rgba(220, 226, 236, 0.92)',
			color: 'var(--text-soft)'
		},
		'.cm-gutter': {
			backgroundColor: 'rgba(238, 243, 248, 0.96)'
		},
		'.cm-gutterElement': {
			boxSizing: 'border-box',
			padding: '0 4px 0 6px',
			minWidth: '24px',
			textAlign: 'right'
		},
		'.cm-activeLineGutter': {
			backgroundColor: 'rgba(232, 238, 246, 0.96)'
		},
		'.cm-activeLine': {
			backgroundColor: 'transparent'
		},
		'.cm-cursor': {
			borderLeftColor: noteCodeCursor
		},
		'.cm-content ::selection': {
			backgroundColor: noteCodeSelectionBg,
			color: noteCodeSelectionFg
		},
		'.cm-selectionBackground, ::selection': {
			backgroundColor: `${noteCodeSelectionBg} !important`,
			color: noteCodeSelectionFg
		},
		'&.cm-focused': {
			outline: 'none'
		}
	});
}

export function NotesEditor(props: NotesEditorProps) {
	const editorHostRef = useRef<HTMLDivElement | null>(null);
	const editorViewRef = useRef<EditorView | null>(null);
	const onChangeRef = useRef(props.onChange);

	useEffect(() => {
		onChangeRef.current = props.onChange;
	}, [props.onChange]);

	useEffect(() => {
		let cancelled = false;
		async function setupEditor() {
			if (!editorHostRef.current) {
				return;
			}
			const [{ EditorState }, { EditorView, keymap, lineNumbers }, { closeBrackets, closeBracketsKeymap }, { indentWithTab }, { indentUnit }, { markdown: markdownLanguage }, { minimalSetup }] = await Promise.all([
				import('@codemirror/state'),
				import('@codemirror/view'),
				import('@codemirror/autocomplete'),
				import('@codemirror/commands'),
				import('@codemirror/language'),
				import('@codemirror/lang-markdown'),
				import('codemirror')
			]);
			if (cancelled || !editorHostRef.current) {
				return;
			}
			const theme = createNotesEditorTheme(
				getComputedStyle(document.documentElement).getPropertyValue('--note-code-cursor').trim() || '#000000',
				getComputedStyle(document.documentElement).getPropertyValue('--note-code-selection-bg').trim() || 'rgba(196, 127, 213, 0.28)',
				getComputedStyle(document.documentElement).getPropertyValue('--note-code-selection-fg').trim() || '#ffffff'
			);
			const view = new EditorView({
				state: EditorState.create({
					doc: props.value,
					extensions: [
						minimalSetup,
						lineNumbers(),
						indentUnit.of('    '),
						closeBrackets(),
						keymap.of([indentWithTab, ...closeBracketsKeymap]),
						markdownLanguage(),
						theme,
						EditorView.updateListener.of((update: import('@codemirror/view').ViewUpdate) => {
							if (update.docChanged) {
								onChangeRef.current(update.state.doc.toString());
							}
						})
					]
				}),
				parent: editorHostRef.current
			});
			editorViewRef.current = view;
		}
		void setupEditor();
		return () => {
			cancelled = true;
			editorViewRef.current?.destroy();
			editorViewRef.current = null;
		};
	}, []);

	useEffect(() => {
		const view = editorViewRef.current;
		if (!view) {
			return;
		}
		const current = view.state.doc.toString();
		if (current === props.value) {
			return;
		}
		const currentSelection = view.state.selection.main;
		view.dispatch({
			changes: { from: 0, to: current.length, insert: props.value },
			selection: {
				anchor: Math.min(currentSelection.anchor, props.value.length),
				head: Math.min(currentSelection.head, props.value.length)
			}
		});
	}, [props.value]);

	return <div className="note-editor" ref={editorHostRef} />;
}

