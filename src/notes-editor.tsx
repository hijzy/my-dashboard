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
	onUploadImages?: (files: File[]) => Promise<NoteAttachment[]>;
	onUploadError?: (message: string) => void;
};

type NoteAttachment = {
	id: string;
	name: string;
	type: string;
	size: number;
	createdAt: string;
};

type EditorRange = {
	from: number;
	to: number;
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

function getImageExtension(type: string) {
	if (type === 'image/jpeg') return 'jpg';
	if (type === 'image/gif') return 'gif';
	if (type === 'image/webp') return 'webp';
	if (type === 'image/svg+xml') return 'svg';
	return 'png';
}

function ensureImageFileName(file: File, index: number) {
	if (file.name) {
		return file;
	}
	const extension = getImageExtension(file.type);
	return new File([file], `image-${Date.now()}-${index + 1}.${extension}`, { type: file.type, lastModified: file.lastModified });
}

function collectImageFiles(dataTransfer: DataTransfer | null) {
	if (!dataTransfer) {
		return [];
	}
	const itemFiles = Array.from(dataTransfer.items)
		.filter(item => item.kind === 'file')
		.map(item => item.getAsFile())
		.filter((file): file is File => Boolean(file && file.type.startsWith('image/')));
	const sourceFiles = itemFiles.length > 0
		? itemFiles
		: Array.from(dataTransfer.files).filter(file => file.type.startsWith('image/'));
	return sourceFiles.map(ensureImageFileName);
}

function escapeMarkdownAlt(value: string) {
	return value.replace(/[[\]\\]/g, '\\$&').replace(/\s+/g, ' ').trim() || 'image';
}

function buildImageMarkdown(attachments: NoteAttachment[]) {
	return attachments
		.map(attachment => `![${escapeMarkdownAlt(attachment.name)}](/api/note/attachments/${encodeURIComponent(attachment.id)})`)
		.join('\n');
}

function insertMarkdownAtRange(view: import('@codemirror/view').EditorView, range: EditorRange, markdown: string) {
	const doc = view.state.doc;
	const from = Math.max(0, Math.min(range.from, doc.length));
	const to = Math.max(from, Math.min(range.to, doc.length));
	const before = from > 0 ? doc.sliceString(from - 1, from) : '\n';
	const after = to < doc.length ? doc.sliceString(to, to + 1) : '\n';
	const insert = `${before === '\n' ? '' : '\n'}${markdown}${after === '\n' ? '' : '\n'}`;
	view.dispatch({
		changes: { from, to, insert },
		selection: { anchor: from + insert.length }
	});
	view.focus();
}

export function NotesEditor(props: NotesEditorProps) {
	const editorHostRef = useRef<HTMLDivElement | null>(null);
	const editorViewRef = useRef<EditorView | null>(null);
	const onChangeRef = useRef(props.onChange);
	const onUploadImagesRef = useRef(props.onUploadImages);
	const onUploadErrorRef = useRef(props.onUploadError);

	useEffect(() => {
		onChangeRef.current = props.onChange;
	}, [props.onChange]);

	useEffect(() => {
		onUploadImagesRef.current = props.onUploadImages;
		onUploadErrorRef.current = props.onUploadError;
	}, [props.onUploadImages, props.onUploadError]);

	useEffect(() => {
		let cancelled = false;
		async function uploadImagesIntoEditor(view: import('@codemirror/view').EditorView, files: File[], range: EditorRange) {
			const uploadImages = onUploadImagesRef.current;
			if (!uploadImages) {
				return;
			}
			try {
				const attachments = await uploadImages(files);
				if (!attachments.length || !view.dom.isConnected) {
					return;
				}
				insertMarkdownAtRange(view, range, buildImageMarkdown(attachments));
			} catch (error) {
				onUploadErrorRef.current?.(error instanceof Error ? error.message : 'Image upload failed');
			}
		}
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
						EditorView.domEventHandlers({
							paste(event: ClipboardEvent, view: import('@codemirror/view').EditorView) {
								const files = collectImageFiles(event.clipboardData);
								const uploadImages = onUploadImagesRef.current;
								if (!files.length || !uploadImages) {
									return false;
								}
								event.preventDefault();
								const selection = view.state.selection.main;
								void uploadImagesIntoEditor(view, files, { from: selection.from, to: selection.to });
								return true;
							},
							drop(event: DragEvent, view: import('@codemirror/view').EditorView) {
								const files = collectImageFiles(event.dataTransfer);
								const uploadImages = onUploadImagesRef.current;
								if (!files.length || !uploadImages) {
									return false;
								}
								event.preventDefault();
								const position = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.from;
								void uploadImagesIntoEditor(view, files, { from: position, to: position });
								return true;
							}
						}),
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

