import { DragEvent as ReactDragEvent, FormEvent, PointerEvent as ReactPointerEvent, Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import './dashboard.css';
import ItemCard from './task-card';
import type { Todo } from './types';

type AuthScreen = 'checking' | 'setup' | 'login' | 'ready';
type GroupName = 'important' | 'tasks' | 'completed';
type NoteView = 'source' | 'preview';

type StashedFile = {
	id: string;
	name: string;
	type: string;
	size: number;
	uploadedAt: string;
};

type FileIconEntry = {
	text: string;
	fg: string;
};

type FileIconConfig = {
	files: Record<string, FileIconEntry>;
	extensions: Record<string, FileIconEntry>;
	defaults: Record<string, FileIconEntry>;
};

type NoteThemeConfig = {
	background?: string;
	foreground?: string;
	cursorColor?: string;
	cursorText?: string;
	selectionBackground?: string;
	selectionForeground?: string;
	inlineCodeBackground?: string;
	codeBorder?: string;
	comment?: string;
	string?: string;
	number?: string;
	keyword?: string;
	title?: string;
	builtin?: string;
	symbol?: string;
	meta?: string;
	black?: string;
	red?: string;
	green?: string;
	yellow?: string;
	blue?: string;
	purple?: string;
	cyan?: string;
	white?: string;
	brightBlack?: string;
	brightRed?: string;
	brightGreen?: string;
	brightYellow?: string;
	brightBlue?: string;
	brightPurple?: string;
	brightCyan?: string;
	brightWhite?: string;
};

type DragPreview = {
	todo: Todo;
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
	x: number;
	y: number;
};

type ConfirmDialog = {
	message: string;
	onConfirm: () => void;
};

const CLOUD_CACHE_TASKS_KEY = 'tasks_cloud_cache';
const CLOUD_CACHE_NOTE_KEY = 'note_cloud_cache';
const CLOUD_CACHE_FILES_KEY = 'files_cloud_cache';
const GROUP_IMPORTANT: GroupName = 'important';
const GROUP_TASKS: GroupName = 'tasks';
const GROUP_COMPLETED: GroupName = 'completed';
const DEFAULT_NOTE_CONTENT = '';

function createId() {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const COMPLETED_TODO_EXPIRY_DAYS = 30;

function pruneExpiredCompletedTodos(todos: Todo[]) {
	const expiryMs = COMPLETED_TODO_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
	const now = Date.now();
	return todos.filter(todo => {
		if (!todo.completed) {
			return true;
		}
		return now - parseStoredDate(todo.completedAt)!.getTime() < expiryMs;
	});
}

function normalizeTodos(rawTodos: Todo[]) {
	return pruneExpiredCompletedTodos(rawTodos);
}

function getTodoGroupName(todo: Todo): GroupName {
	if (todo.completed) {
		return GROUP_COMPLETED;
	}
	if (todo.important) {
		return GROUP_IMPORTANT;
	}
	return GROUP_TASKS;
}

function groupTodosBySection(todos: Todo[]) {
	return {
		important: todos.filter(todo => getTodoGroupName(todo) === GROUP_IMPORTANT),
		tasks: todos.filter(todo => getTodoGroupName(todo) === GROUP_TASKS),
		completed: todos.filter(todo => getTodoGroupName(todo) === GROUP_COMPLETED)
	};
}

function readTodosByKey(key: string) {
	const saved = localStorage.getItem(key);
	if (!saved) {
		return [];
	}
	try {
		return normalizeTodos(JSON.parse(saved) as Todo[]);
	} catch {
		return [];
	}
}

function readFilesByKey(key: string) {
	const saved = localStorage.getItem(key);
	if (!saved) {
		return [];
	}
	try {
		const parsed = JSON.parse(saved) as unknown;
		if (!Array.isArray(parsed)) {
			return [];
		}
		return parsed.filter(item => typeof item === 'object' && item !== null) as StashedFile[];
	} catch {
		return [];
	}
}

function readCloudCacheTasks() {
	return readTodosByKey(CLOUD_CACHE_TASKS_KEY);
}

const NotesEditor = lazy(() => import('./notes-editor').then(module => ({ default: module.NotesEditor })));
const NotesPreview = lazy(() => import('./notes-preview').then(module => ({ default: module.NotesPreview })));

function scheduleIdleTask(task: () => void) {
	if (typeof window.requestIdleCallback === 'function') {
		window.requestIdleCallback(() => task());
		return;
	}
	window.setTimeout(task, 1200);
}

function formatBytes(bytes: number) {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const displayWeekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatDisplayDate(date = new Date()) {
	const year = date.getFullYear();
	const month = `${date.getMonth() + 1}`.padStart(2, '0');
	const day = `${date.getDate()}`.padStart(2, '0');
	const hours = `${date.getHours()}`.padStart(2, '0');
	const minutes = `${date.getMinutes()}`.padStart(2, '0');
	const seconds = `${date.getSeconds()}`.padStart(2, '0');
	return `${year}/${month}/${day} ${hours}:${minutes}:${seconds} ${displayWeekdays[date.getDay()]}`;
}

function parseStoredDate(value?: string) {
	if (!value) {
		return null;
	}
	if (/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} [A-Za-z]{3}$/.test(value)) {
		const [datePart, timePart] = value.split(' ');
		const [year, month, day] = datePart.split('/').map(Number);
		const [hours, minutes, seconds] = timePart.split(':').map(Number);
		return new Date(year, month - 1, day, hours, minutes, seconds);
	}
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatStoredDate(value?: string) {
	const parsed = parseStoredDate(value);
	return parsed ? formatDisplayDate(parsed) : value || '';
}

function getFileVisual(file: StashedFile, config: FileIconConfig | null) {
	const normalizedName = file.name.toLowerCase();
	const extension = normalizedName.includes('.') ? normalizedName.split('.').pop()! : '';
	const type = file.type.toLowerCase();

	const byFile = config?.files[normalizedName];
	if (byFile) {
		return byFile;
	}

	const byExtension = config?.extensions[extension];
	if (byExtension) {
		return byExtension;
	}

	if (type.startsWith('image/')) {
		return config?.defaults.image || { text: '', fg: '#b58900' };
	}
	if (type === 'application/pdf' || extension === 'pdf') {
		return config?.defaults.pdf || { text: '', fg: '#dc322f' };
	}
	if (type.startsWith('audio/')) {
		return config?.defaults.audio || { text: '', fg: '#268bd2' };
	}
	if (type.startsWith('video/')) {
		return config?.defaults.video || { text: '', fg: '#cb4b16' };
	}
	if (['zip', 'rar', '7z', 'tar', 'gz', 'xz'].includes(extension)) {
		return config?.defaults.archive || { text: '', fg: '#b58900' };
	}
	if (['json', 'json5', 'jsonc', 'yaml', 'yml', 'toml', 'xml', 'ini', 'conf', 'config', 'env'].includes(extension)) {
		return config?.defaults.config || { text: '', fg: '#586e75' };
	}
	if (['txt', 'rtf', 'doc', 'docx'].includes(extension)) {
		return config?.defaults.document || { text: '', fg: '#657b83' };
	}
	return config?.defaults.file || { text: '', fg: '#657b83' };
}

function Workspace() {
	const [todos, setTodos] = useState<Todo[]>(() => readCloudCacheTasks());
	const [isHydratingRemote, setIsHydratingRemote] = useState(false);
	const [authScreen, setAuthScreen] = useState<AuthScreen>('checking');
	const [authPassword, setAuthPassword] = useState('');
	const [authError, setAuthError] = useState('');
	const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
	const [openDropdownTodoId, setOpenDropdownTodoId] = useState('');
	const [draggingTodoId, setDraggingTodoId] = useState('');
	const [draggingGroup, setDraggingGroup] = useState<GroupName | ''>('');
	const [dropBeforeTodoId, setDropBeforeTodoId] = useState('');
	const [recentlyMovedTodoId, setRecentlyMovedTodoId] = useState('');
	const [isDropping, setIsDropping] = useState(false);
	const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
	const [noteContent, setNoteContent] = useState(() => localStorage.getItem(CLOUD_CACHE_NOTE_KEY) ?? DEFAULT_NOTE_CONTENT);
	const [noteView, setNoteView] = useState<NoteView>('source');
	const [noteUnsaved, setNoteUnsaved] = useState(false);
	const [noteSaveError, setNoteSaveError] = useState(false);
	const [todoSaveError, setTodoSaveError] = useState(false);
	const [stashedFiles, setStashedFiles] = useState<StashedFile[]>(() => readFilesByKey(CLOUD_CACHE_FILES_KEY));
	const [isUploadingFiles, setIsUploadingFiles] = useState(false);
	const [uploadProgress, setUploadProgress] = useState(0);
	const [uploadStatusText, setUploadStatusText] = useState('');
	const [fileIconConfig, setFileIconConfig] = useState<FileIconConfig | null>(null);
	const dragStateRef = useRef({ dropBeforeTodoId: '', lastUpdateTime: 0 });
	const pointerDragRef = useRef({ startY: 0, moved: false });
	const todoSaveTimerRef = useRef<number | null>(null);
	const todoRetryTimerRef = useRef<number | null>(null);
	const todosRef = useRef(todos);
	const noteSaveTimerRef = useRef<number | null>(null);
	const noteContentRef = useRef(noteContent);
	const noteRetryTimerRef = useRef<number | null>(null);
	const lastSyncedNoteRef = useRef(noteContent);
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const uploadXhrRef = useRef<XMLHttpRequest | null>(null);
	const uploadFailedRef = useRef(false);
	const listRefs = useRef<Record<GroupName, HTMLUListElement | null>>({
		important: null,
		tasks: null,
		completed: null
	});
	const isAuthorized = authScreen === 'ready';
	noteContentRef.current = noteContent;
	todosRef.current = todos;

	useEffect(() => {
		fetch('/yazi-file-icons.json')
			.then(response => {
				if (!response.ok) {
					throw new Error('icon config read failed');
				}
				return response.json() as Promise<FileIconConfig>;
			})
			.then(config => {
				setFileIconConfig(config);
			})
			.catch(() => {
				setFileIconConfig(null);
			});
	}, []);

	useEffect(() => {
		scheduleIdleTask(() => {
			void import('./notes-editor');
			void import('./notes-preview');
		});
	}, []);

	useEffect(() => {
		fetch('/notes-code-theme.json')
			.then(response => {
				if (!response.ok) {
					throw new Error('theme read failed');
				}
				return response.json() as Promise<NoteThemeConfig>;
			})
			.then(theme => {
				const root = document.documentElement;
				const pickColor = (...candidates: Array<string | undefined>) => {
					for (const value of candidates) {
						if (typeof value === 'string' && value.trim()) {
							return value;
						}
					}
					return '';
				};
				const useReadableCursorColor = (color: string) => {
					const hex = color.trim();
					if (!/^#([0-9a-fA-F]{6})$/.test(hex)) {
						return color;
					}
					const r = parseInt(hex.slice(1, 3), 16);
					const g = parseInt(hex.slice(3, 5), 16);
					const b = parseInt(hex.slice(5, 7), 16);
					const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
					return luminance > 0.82 ? '#111111' : color;
				};
				const codeBg = pickColor(theme.background, '#222222');
				const codeFg = pickColor(theme.foreground, theme.white, theme.brightWhite, '#ffffff');
				const cursor = pickColor(theme.cursorColor, '#000000');
				root.style.setProperty('--note-inline-code-bg', pickColor(theme.inlineCodeBackground, 'rgba(34, 34, 34, 0.08)'));
				root.style.setProperty('--note-code-bg', codeBg);
				root.style.setProperty('--note-code-border', pickColor(theme.codeBorder, 'rgba(34, 34, 34, 0.12)'));
				root.style.setProperty('--note-code-fg', codeFg);
				root.style.setProperty('--note-code-cursor', useReadableCursorColor(cursor));
				root.style.setProperty('--note-code-selection-bg', pickColor(theme.selectionBackground, 'rgba(196, 127, 213, 0.28)'));
				root.style.setProperty('--note-code-selection-fg', pickColor(theme.selectionForeground, codeFg));
				root.style.setProperty('--note-code-comment', pickColor(theme.comment, theme.brightBlack, theme.black, '#666666'));
				root.style.setProperty('--note-code-string', pickColor(theme.string, theme.green, theme.brightGreen, '#91d4a8'));
				root.style.setProperty('--note-code-number', pickColor(theme.number, theme.yellow, theme.brightYellow, '#e9be74'));
				root.style.setProperty('--note-code-keyword', pickColor(theme.keyword, theme.red, theme.brightRed, '#7fb6ed'));
				root.style.setProperty('--note-code-title', pickColor(theme.title, theme.blue, theme.brightBlue, theme.keyword, '#7fb6ed'));
				root.style.setProperty('--note-code-builtin', pickColor(theme.builtin, theme.cyan, theme.brightCyan, theme.symbol, '#5edee3'));
				root.style.setProperty('--note-code-symbol', pickColor(theme.symbol, theme.cyan, theme.brightCyan, '#5edee3'));
				root.style.setProperty('--note-code-meta', pickColor(theme.meta, theme.purple, theme.brightPurple, '#f88aaf'));
			})
			.catch(() => undefined);
	}, []);

	function getGroupName(todo: Todo): GroupName {
		return getTodoGroupName(todo);
	}

	function moveTodoToGroupFront(previousTodos: Todo[], updatedTodo: Todo) {
		const remainingTodos = previousTodos.filter(todo => todo.id !== updatedTodo.id);
		const grouped = groupTodosBySection(remainingTodos);
		grouped[getGroupName(updatedTodo)].unshift(updatedTodo);
		return [...grouped.important, ...grouped.tasks, ...grouped.completed];
	}

	function reorderTodoInGroup(movedTodoId: string, targetGroup: GroupName, beforeTodoId?: string) {
		setTodos(previousTodos => {
			const movedTodo = previousTodos.find(todo => todo.id === movedTodoId);
			if (!movedTodo || getGroupName(movedTodo) !== targetGroup) {
				return previousTodos;
			}
			const todoWithoutMoved = previousTodos.filter(todo => todo.id !== movedTodoId);
			const grouped = groupTodosBySection(todoWithoutMoved);
			const targetTodos = grouped[targetGroup];
			if (beforeTodoId) {
				const targetIndex = targetTodos.findIndex(todo => todo.id === beforeTodoId);
				if (targetIndex >= 0) {
					targetTodos.splice(targetIndex, 0, movedTodo);
				} else {
					targetTodos.push(movedTodo);
				}
			} else {
				targetTodos.push(movedTodo);
			}
			return [...grouped.important, ...grouped.tasks, ...grouped.completed];
		});
		setRecentlyMovedTodoId(movedTodoId);
	}

	function clearDragState() {
		setDraggingTodoId('');
		setDraggingGroup('');
		setDropBeforeTodoId('');
		setDragPreview(null);
		dragStateRef.current.dropBeforeTodoId = '';
		dragStateRef.current.lastUpdateTime = 0;
	}

	function setTodoDropdownOpen(todoId: string, open: boolean) {
		setOpenDropdownTodoId(open ? todoId : '');
	}

	function beginDrag(todoId: string, groupName: GroupName) {
		setDraggingTodoId(todoId);
		setDraggingGroup(groupName);
		setDropBeforeTodoId('');
		dragStateRef.current.dropBeforeTodoId = '';
		dragStateRef.current.lastUpdateTime = 0;
	}

	function beginPointerDrag(todo: Todo, groupName: GroupName, event: ReactPointerEvent<HTMLButtonElement>) {
		event.preventDefault();
		const itemElement = event.currentTarget.closest('li');
		if (!(itemElement instanceof HTMLLIElement)) {
			return;
		}
		const rect = itemElement.getBoundingClientRect();
		pointerDragRef.current.startY = event.clientY;
		pointerDragRef.current.moved = false;
		setDragPreview({
			todo,
			width: rect.width,
			height: rect.height,
			offsetX: event.clientX - rect.left,
			offsetY: event.clientY - rect.top,
			x: event.clientX,
			y: event.clientY
		});
		beginDrag(todo.id, groupName);
	}

	function getShiftDirection(todoId: string, groupTodos: Todo[], groupName: GroupName): 'up' | 'down' | '' {
		if (draggingGroup !== groupName || !draggingTodoId || todoId === draggingTodoId) {
			return '';
		}
		const visibleTodos = groupTodos.filter(todo => todo.id !== draggingTodoId);
		const targetIndex = dropBeforeTodoId ? visibleTodos.findIndex(todo => todo.id === dropBeforeTodoId) : visibleTodos.length;
		const safeTargetIndex = targetIndex < 0 ? visibleTodos.length : targetIndex;
		const currentIndex = visibleTodos.findIndex(todo => todo.id === todoId);
		if (currentIndex >= safeTargetIndex) {
			return 'down';
		}
		return '';
	}

	const GROUP_ORDER: GroupName[] = [GROUP_IMPORTANT, GROUP_TASKS, GROUP_COMPLETED];

	function isSubsequentGroupShifted(groupName: GroupName) {
		if (!draggingTodoId || !draggingGroup || !dropBeforeTodoId) {
			return false;
		}
		return GROUP_ORDER.indexOf(groupName) > GROUP_ORDER.indexOf(draggingGroup);
	}

	function separateTodos() {
		const grouped = groupTodosBySection(todos);
		return {
			importantTodos: grouped.important,
			taskTodos: grouped.tasks,
			completedTodos: grouped.completed
		};
	}

	function getDropBeforeIdByY(groupName: GroupName, clientY: number) {
		const listElement = listRefs.current[groupName];
		if (!listElement) {
			return '';
		}
		const todoElements = Array.from(listElement.querySelectorAll<HTMLLIElement>('.todo-item:not(.dragging)'));
		const sorted = todoElements.sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top);
		for (const todoElement of sorted) {
			const rect = todoElement.getBoundingClientRect();
			if (clientY < rect.top + rect.height * 0.5) {
				return todoElement.dataset.todoId || '';
			}
		}
		return '';
	}

	function updateDragTarget(clientY: number) {
		if (!draggingTodoId || !draggingGroup) {
			return;
		}
		const now = Date.now();
		if (now - dragStateRef.current.lastUpdateTime < 18) {
			return;
		}
		dragStateRef.current.lastUpdateTime = now;
		const beforeId = getDropBeforeIdByY(draggingGroup, clientY);
		if (beforeId !== dragStateRef.current.dropBeforeTodoId) {
			dragStateRef.current.dropBeforeTodoId = beforeId;
			setDropBeforeTodoId(beforeId);
		}
	}

	function commitDrop() {
		if (!draggingTodoId || !draggingGroup) {
			return;
		}
		setIsDropping(true);
		reorderTodoInGroup(draggingTodoId, draggingGroup, dragStateRef.current.dropBeforeTodoId || undefined);
		clearDragState();
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				setIsDropping(false);
			});
		});
	}

	function handleAddTodo(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const input = event.currentTarget.elements.namedItem('todo');
		if (!(input instanceof HTMLInputElement)) {
			return;
		}
		const value = input.value.trim();
		if (!value) {
			return;
		}
		const todo: Todo = {
			id: createId(),
			text: value,
			completed: false,
			editing: false,
			createdAt: formatDisplayDate()
		};
		setTodos([todo, ...todos]);
		input.value = '';
	}

	function handleCompleteTodo(todo: Todo) {
		setTodos(previous =>
			moveTodoToGroupFront(previous, {
				...todo,
				completed: !todo.completed,
				completedAt: !todo.completed ? formatDisplayDate() : undefined
			})
		);
	}

	function handleDeleteTodo(todo: Todo) {
		setTodos(previous => previous.filter(item => item.id !== todo.id));
	}

	function handleClear() {
		requestConfirm('Clear all todos?', () => {
			setTodos([]);
		});
	}

	function handleEditTodo(todo: Todo) {
		setTodos(previous => previous.map(item => (item.id === todo.id ? { ...item, editing: true } : item)));
	}

	function handleSaveTodo(todo: Todo, event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const input = event.currentTarget.elements.namedItem('editTodo');
		if (!(input instanceof HTMLInputElement)) {
			return;
		}
		const value = input.value.trim();
		if (!value) {
			return;
		}
		setTodos(previous => previous.map(item => (item.id === todo.id ? { ...item, text: value, editing: false } : item)));
	}

	function handleMarkImportant(todo: Todo) {
		setTodos(previous =>
			moveTodoToGroupFront(previous, {
				...todo,
				important: !todo.important
			})
		);
	}

	async function refreshFiles() {
		const response = await fetch('/api/files');
		if (!response.ok) {
			throw new Error('files read failed');
		}
		const remoteFiles = (await response.json()) as StashedFile[];
		const safeFiles = Array.isArray(remoteFiles) ? remoteFiles : [];
		setStashedFiles(safeFiles);
		localStorage.setItem(CLOUD_CACHE_FILES_KEY, JSON.stringify(safeFiles));
	}

	function showFileStatus(text: string, durationMs: number) {
		setUploadStatusText(text);
		window.setTimeout(() => {
			setUploadStatusText(previous => (previous === text ? '' : previous));
		}, durationMs);
	}

	async function uploadFiles(files: FileList | File[]) {
		if (!files.length || isUploadingFiles) {
			return;
		}
		const fileArray = Array.from(files);
		const fileLabel = fileArray.length === 1 ? fileArray[0].name : `${fileArray.length} files`;
		uploadFailedRef.current = false;
		setIsUploadingFiles(true);
		setUploadProgress(0);
		setUploadStatusText(`Uploading ${fileLabel}`);
		try {
			const formData = new FormData();
			for (const file of fileArray) {
				formData.append('files', file, file.name);
			}
			const response = await new Promise<Response>((resolve, reject) => {
				const xhr = new XMLHttpRequest();
				uploadXhrRef.current = xhr;
				xhr.open('POST', '/api/files');
				xhr.responseType = 'json';
				xhr.upload.onprogress = event => {
					if (!event.lengthComputable) {
						return;
					}
					setUploadProgress(event.loaded / event.total);
				};
				xhr.onabort = () => {
					reject(new Error(`Upload cancelled: ${fileLabel}`));
				};
				xhr.onerror = () => {
					reject(new Error(`Upload failed: ${fileLabel}`));
				};
				xhr.onload = () => {
					const body = xhr.response && typeof xhr.response === 'object' ? JSON.stringify(xhr.response) : xhr.responseText;
					resolve(
						new Response(body, {
							status: xhr.status,
							statusText: xhr.statusText,
							headers: { 'Content-Type': xhr.getResponseHeader('Content-Type') || 'application/json' }
						})
					);
				};
				xhr.send(formData);
			});
			if (!response.ok) {
				const payload = (await response.json().catch(() => null)) as { message?: string } | null;
				throw new Error(payload?.message || `Upload failed: ${fileLabel}`);
			}
			setUploadProgress(1);
			refreshFiles().catch(() => undefined);
		} catch (error) {
			uploadFailedRef.current = true;
			setUploadStatusText(error instanceof Error ? error.message : `Upload failed: ${fileLabel}`);
		} finally {
			uploadXhrRef.current = null;
			setIsUploadingFiles(false);
			const delay = uploadFailedRef.current ? 3500 : 900;
			window.setTimeout(() => {
				setUploadProgress(0);
				setUploadStatusText(previous => {
					if (uploadFailedRef.current && previous) {
						return '';
					}
					return previous ? '' : previous;
				});
			}, delay);
		}
	}

	function cancelUpload() {
		uploadXhrRef.current?.abort();
	}

	const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);

	const requestConfirm = useCallback((message: string, onConfirm: () => void) => {
		setConfirmDialog({ message, onConfirm });
	}, []);

	const dismissConfirm = useCallback(() => {
		setConfirmDialog(null);
	}, []);

	const acceptConfirm = useCallback(() => {
		confirmDialog?.onConfirm();
		setConfirmDialog(null);
	}, [confirmDialog]);

	const [isDraggingOver, setIsDraggingOver] = useState(false);
	const dragOverCountRef = useRef(0);

	function handlePanelDragEnter(event: ReactDragEvent<HTMLElement>) {
		event.preventDefault();
		dragOverCountRef.current += 1;
		if (dragOverCountRef.current === 1) {
			setIsDraggingOver(true);
		}
	}

	function handlePanelDragLeave() {
		dragOverCountRef.current -= 1;
		if (dragOverCountRef.current <= 0) {
			dragOverCountRef.current = 0;
			setIsDraggingOver(false);
		}
	}

	function handlePanelDrop(event: ReactDragEvent<HTMLElement>) {
		event.preventDefault();
		dragOverCountRef.current = 0;
		setIsDraggingOver(false);
		if (!isUploadingFiles) {
			void uploadFiles(event.dataTransfer.files);
		}
	}

	function blockDrop(event: ReactDragEvent<HTMLDivElement>) {
		event.preventDefault();
	}

	function handleClearFiles() {
		requestConfirm('Clear all files?', async () => {
			try {
				const response = await fetch('/api/files', { method: 'DELETE' });
				if (!response.ok) {
					throw new Error('clear failed');
				}
				setStashedFiles([]);
				localStorage.setItem(CLOUD_CACHE_FILES_KEY, JSON.stringify([]));
			} catch {
				showFileStatus('Clear failed', 3500);
			}
		});
	}

	async function handleDeleteFile(fileId: string, fileName: string) {
		try {
			const response = await fetch(`/api/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
			if (!response.ok) {
				throw new Error('delete failed');
			}
			setStashedFiles(previous => previous.filter(item => item.id !== fileId));
		} catch {
			showFileStatus(`Delete failed: ${fileName}`, 3500);
		}
	}

	function handleDownloadFile(file: StashedFile) {
		window.open(`/api/files/${encodeURIComponent(file.id)}/download`, '_blank');
	}

	useEffect(() => {
		let cancelled = false;
		fetch('/api/auth/status')
			.then(response => {
				if (!response.ok) {
					throw new Error('auth status failed');
				}
				return response.json() as Promise<{ initialized: boolean; authenticated: boolean }>;
			})
			.then(result => {
				if (cancelled) {
					return;
				}
				if (!result.initialized) {
					setAuthScreen('setup');
					return;
				}
				if (result.authenticated) {
					setAuthScreen('ready');
					return;
				}
				setAuthScreen('login');
			})
			.catch(() => {
				if (cancelled) {
					return;
				}
				setAuthScreen('login');
				setAuthError('Server unavailable, please retry.');
			});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (!draggingTodoId || !draggingGroup) {
			return;
		}
		const handleWindowDragOver = (event: globalThis.DragEvent) => {
			event.preventDefault();
			updateDragTarget(event.clientY);
		};
		const handleWindowDrop = (event: globalThis.DragEvent) => {
			event.preventDefault();
			commitDrop();
		};
		window.addEventListener('dragover', handleWindowDragOver);
		window.addEventListener('drop', handleWindowDrop);
		return () => {
			window.removeEventListener('dragover', handleWindowDragOver);
			window.removeEventListener('drop', handleWindowDrop);
		};
	}, [draggingTodoId, draggingGroup]);

	useEffect(() => {
		if (!recentlyMovedTodoId) {
			return;
		}
		const timeoutId = window.setTimeout(() => setRecentlyMovedTodoId(''), 320);
		return () => {
			window.clearTimeout(timeoutId);
		};
	}, [recentlyMovedTodoId]);

	useEffect(() => {
		if (!draggingTodoId || !draggingGroup) {
			return;
		}

		const handlePointerMove = (event: globalThis.PointerEvent) => {
			const distance = Math.abs(event.clientY - pointerDragRef.current.startY);
			if (distance > 3) {
				pointerDragRef.current.moved = true;
			}
			setDragPreview(previous =>
				previous
					? {
							...previous,
							x: event.clientX,
							y: event.clientY
						}
					: previous
			);
			updateDragTarget(event.clientY);
		};

		const handlePointerUp = () => {
			if (pointerDragRef.current.moved) {
				commitDrop();
				return;
			}
			clearDragState();
		};

		const previousUserSelect = document.body.style.userSelect;
		document.body.style.userSelect = 'none';
		window.addEventListener('pointermove', handlePointerMove);
		window.addEventListener('pointerup', handlePointerUp, { once: true });
		window.addEventListener('pointercancel', handlePointerUp, { once: true });

		return () => {
			document.body.style.userSelect = previousUserSelect;
			window.removeEventListener('pointermove', handlePointerMove);
			window.removeEventListener('pointerup', handlePointerUp);
			window.removeEventListener('pointercancel', handlePointerUp);
		};
	}, [draggingTodoId, draggingGroup]);

	useEffect(() => {
		localStorage.setItem(CLOUD_CACHE_TASKS_KEY, JSON.stringify(todos));
	}, [todos]);

	useEffect(() => {
		localStorage.setItem(CLOUD_CACHE_FILES_KEY, JSON.stringify(stashedFiles));
	}, [stashedFiles]);

	function saveTodosToServer(todosToSave: Todo[]) {
		fetch('/todos.json', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(todosToSave)
		})
		.then(response => {
			if (response.status === 401) {
				setAuthScreen('login');
				setAuthError('Session expired, please sign in again.');
				throw new Error('unauthorized');
			}
			if (!response.ok) {
				throw new Error('todo write failed');
			}
			setTodoSaveError(false);
		})
		.catch((error) => {
			if (error.message === 'unauthorized') return;
			setTodoSaveError(true);
			if (todoRetryTimerRef.current) {
				window.clearTimeout(todoRetryTimerRef.current);
			}
			todoRetryTimerRef.current = window.setTimeout(() => {
				todoRetryTimerRef.current = null;
				saveTodosToServer(todosRef.current);
			}, 3000);
		});
	}

	function saveNoteToServer(content: string) {
		fetch('/api/note', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ content })
		})
		.then(response => {
			if (!response.ok) {
				throw new Error('save failed');
			}
			lastSyncedNoteRef.current = content;
			setNoteSaveError(false);
			if (noteContentRef.current === content) {
				setNoteUnsaved(false);
			}
		})
		.catch(() => {
			setNoteSaveError(true);
			if (noteRetryTimerRef.current) {
				window.clearTimeout(noteRetryTimerRef.current);
			}
			noteRetryTimerRef.current = window.setTimeout(() => {
				noteRetryTimerRef.current = null;
				saveNoteToServer(noteContentRef.current);
			}, 3000);
		});
	}

	useEffect(() => {
		localStorage.setItem(CLOUD_CACHE_NOTE_KEY, noteContent);
		if (!isAuthorized || isHydratingRemote) {
			return;
		}
		if (noteContent === lastSyncedNoteRef.current) {
			setNoteUnsaved(false);
			return;
		}
		setNoteUnsaved(true);
		if (noteSaveTimerRef.current) {
			window.clearTimeout(noteSaveTimerRef.current);
		}
		if (noteRetryTimerRef.current) {
			window.clearTimeout(noteRetryTimerRef.current);
			noteRetryTimerRef.current = null;
		}
		noteSaveTimerRef.current = window.setTimeout(() => {
			saveNoteToServer(noteContent);
		}, 1500);
		return () => {
			if (noteSaveTimerRef.current) {
				window.clearTimeout(noteSaveTimerRef.current);
			}
		};
	}, [noteContent, isAuthorized, isHydratingRemote]);

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			if ((event.metaKey || event.ctrlKey) && event.key === 's') {
				event.preventDefault();
				if (!isAuthorized || isHydratingRemote) {
					return;
				}
				if (noteSaveTimerRef.current) {
					window.clearTimeout(noteSaveTimerRef.current);
					noteSaveTimerRef.current = null;
				}
				if (noteRetryTimerRef.current) {
					window.clearTimeout(noteRetryTimerRef.current);
					noteRetryTimerRef.current = null;
				}
				saveNoteToServer(noteContentRef.current);
			}
		}
		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [isAuthorized, isHydratingRemote]);

	useEffect(() => {
		return () => {
			if (noteRetryTimerRef.current) {
				window.clearTimeout(noteRetryTimerRef.current);
			}
		};
	}, []);

	useEffect(() => {
		if (!isAuthorized) {
			return;
		}
		let cancelled = false;
		setIsHydratingRemote(true);
		Promise.all([
		fetch('/todos.json').then(response => {
				if (response.status === 401) {
					setAuthScreen('login');
					setAuthError('Session expired, please sign in again.');
					throw new Error('unauthorized');
				}
				if (!response.ok) {
					throw new Error('todo read failed');
				}
				return response.json() as Promise<Todo[]>;
			}),
			fetch('/api/note').then(response => {
				if (!response.ok) {
					throw new Error('note read failed');
				}
				return response.json() as Promise<{ content: string }>;
			}),
			fetch('/api/files').then(response => {
				if (!response.ok) {
					throw new Error('files read failed');
				}
				return response.json() as Promise<StashedFile[]>;
			})
		])
			.then(([remoteTodos, remoteNote, remoteFiles]) => {
				if (cancelled) {
					return;
				}
				const normalizedTodos = normalizeTodos(Array.isArray(remoteTodos) ? remoteTodos : []);
				const safeNote = typeof remoteNote.content === 'string' ? remoteNote.content : DEFAULT_NOTE_CONTENT;
				const safeFiles = Array.isArray(remoteFiles) ? remoteFiles : [];
				setTodos(normalizedTodos);
				lastSyncedNoteRef.current = safeNote;
				setNoteContent(safeNote);
				setStashedFiles(safeFiles);
				localStorage.setItem(CLOUD_CACHE_TASKS_KEY, JSON.stringify(normalizedTodos));
				localStorage.setItem(CLOUD_CACHE_NOTE_KEY, safeNote);
			localStorage.setItem(CLOUD_CACHE_FILES_KEY, JSON.stringify(safeFiles));
		})
		.catch(() => {
			if (cancelled) {
				return;
			}
			setTodos(readCloudCacheTasks());
			const cachedNote = localStorage.getItem(CLOUD_CACHE_NOTE_KEY) ?? DEFAULT_NOTE_CONTENT;
			lastSyncedNoteRef.current = cachedNote;
			setNoteContent(cachedNote);
			setStashedFiles(readFilesByKey(CLOUD_CACHE_FILES_KEY));
		})
			.finally(() => {
				if (cancelled) {
					return;
				}
				setIsHydratingRemote(false);
			});
		return () => {
			cancelled = true;
		};
	}, [isAuthorized]);

	useEffect(() => {
		if (!isAuthorized || isHydratingRemote) {
			return;
		}
		if (todoSaveTimerRef.current) {
			window.clearTimeout(todoSaveTimerRef.current);
		}
		if (todoRetryTimerRef.current) {
			window.clearTimeout(todoRetryTimerRef.current);
			todoRetryTimerRef.current = null;
		}
		todoSaveTimerRef.current = window.setTimeout(() => {
			saveTodosToServer(todos);
		}, 300);
		return () => {
			if (todoSaveTimerRef.current) {
				window.clearTimeout(todoSaveTimerRef.current);
			}
		};
	}, [todos, isAuthorized, isHydratingRemote]);

	function submitAuthForm(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (authScreen !== 'setup' && authScreen !== 'login') {
			return;
		}
		const safePassword = authPassword.trim();
		if (!safePassword) {
			setAuthError('Password is required.');
			return;
		}
		setAuthError('');
		setIsAuthSubmitting(true);
		const endpoint = authScreen === 'setup' ? '/api/auth/setup' : '/api/auth/login';
		fetch(endpoint, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ password: safePassword })
		})
			.then(async response => {
				if (!response.ok) {
					let message = authScreen === 'setup' ? 'Setup failed.' : 'Wrong password.';
					try {
						const payload = (await response.json()) as { message?: unknown };
						if (typeof payload.message === 'string' && payload.message) {
							message = payload.message;
						}
					} catch {
						if (response.status >= 500) {
							message = 'Server unavailable, please retry.';
						}
					}
					throw new Error(message);
				}
			setAuthPassword('');
			setAuthScreen('ready');
		})
			.catch(error => {
				if (error instanceof Error) {
					setAuthError(error.message);
					return;
				}
				setAuthError('Server unavailable, please retry.');
			})
			.finally(() => {
				setIsAuthSubmitting(false);
			});
	}

	const { importantTodos, taskTodos, completedTodos } = separateTodos();
	if (authScreen === 'checking') {
		return null;
	}
	if (authScreen !== 'ready') {
		return (
			<div className="main auth-main">
				<div className="auth-card">
					<h1>{authScreen === 'setup' ? 'Set Access Password' : 'Enter Access Password'}</h1>
					<form className="auth-form" onSubmit={submitAuthForm}>
						<input
							type="password"
							name="authPassword"
							value={authPassword}
							onChange={event => setAuthPassword(event.target.value)}
							autoComplete={authScreen === 'setup' ? 'new-password' : 'current-password'}
							placeholder={authScreen === 'setup' ? 'Create password' : 'Input password'}
							className="auth-input"
						/>
						<button type="submit" disabled={isAuthSubmitting}>
							{isAuthSubmitting ? 'Please wait...' : authScreen === 'setup' ? 'Set Password' : 'Unlock'}
						</button>
					</form>
					{authError && <p className="sync-state">{authError}</p>}
				</div>
			</div>
		);
	}

	return (
		<div className={`main ${isDropping ? 'is-dropping' : ''}`} onDragOver={blockDrop} onDrop={blockDrop}>
				<div className="workspace-shell">
					<header className="app-header">
						<div className="app-brand">
							<h1 className="page-title">MyDashboard</h1>
							<p className="eyebrow">Todos / Notes / Files</p>
						</div>
					</header>
					<div className="workspace-grid">
						<section className="panel todo-panel">
						<div className="panel-head">
							<div>
								<h2 className="panel-title">Todos</h2>
								{todoSaveError && (
									<span className="todo-save-error">
										Save failed, retrying<span className="todo-save-error-dots" />
									</span>
								)}
							</div>
							<div className="panel-head-actions">
								<div className="panel-count">{importantTodos.length + taskTodos.length}</div>
								{todos.length > 0 && (
									<button onClick={handleClear} className="clear-button" type="button">
										Clear all
									</button>
								)}
							</div>
						</div>
						<div className="todo-scroll-area">
							{importantTodos.length > 0 && (
								<div className={`todo-group is-important${isSubsequentGroupShifted(GROUP_IMPORTANT) ? ' shift-down' : ''}`}>
									<h3 className="group-title">
										<span className="group-title-icon" aria-hidden="true">
											<svg viewBox="0 0 24 24">
												<path d="m12 3.6 2.62 5.31 5.86.85-4.24 4.13 1 5.84L12 16.97l-5.24 2.76 1-5.84-4.24-4.13 5.86-.85L12 3.6Z" fill="currentColor" stroke="currentColor" strokeWidth="0.6" strokeLinejoin="round" />
											</svg>
										</span>
										<span>Important</span>
									</h3>
									<ul
										ref={element => {
											listRefs.current.important = element;
										}}
									>
										{importantTodos.map(todo => (
											<ItemCard
												key={todo.id}
												todo={todo}
												formatTimestamp={formatStoredDate}
												handleCompleteTodo={() => handleCompleteTodo(todo)}
												handleEditTodo={() => handleEditTodo(todo)}
												handleSaveTodo={event => handleSaveTodo(todo, event)}
												handleDeleteTodo={() => handleDeleteTodo(todo)}
												handleMarkImportant={() => handleMarkImportant(todo)}
												onPointerDragStart={event => beginPointerDrag(todo, GROUP_IMPORTANT, event)}
												dropdownOpen={openDropdownTodoId === todo.id}
												onDropdownOpenChange={open => setTodoDropdownOpen(todo.id, open)}
												isDropTarget={dropBeforeTodoId === todo.id}
												isDragging={draggingTodoId === todo.id}
												shiftDirection={getShiftDirection(todo.id, importantTodos, GROUP_IMPORTANT)}
												isRecentlyMoved={recentlyMovedTodoId === todo.id}
											/>
										))}
									</ul>
								</div>
							)}
							{taskTodos.length > 0 && (
								<div className={`todo-group${isSubsequentGroupShifted(GROUP_TASKS) ? ' shift-down' : ''}`}>
									<h3 className="group-title">
										<span className="group-title-icon" aria-hidden="true">
											<svg viewBox="0 0 24 24">
												<path d="M5 7h14M5 12h14M5 17h9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
											</svg>
										</span>
										<span>Tasks</span>
									</h3>
									<ul
										ref={element => {
											listRefs.current.tasks = element;
										}}
									>
										{taskTodos.map(todo => (
											<ItemCard
												key={todo.id}
												todo={todo}
												formatTimestamp={formatStoredDate}
												handleCompleteTodo={() => handleCompleteTodo(todo)}
												handleEditTodo={() => handleEditTodo(todo)}
												handleSaveTodo={event => handleSaveTodo(todo, event)}
												handleDeleteTodo={() => handleDeleteTodo(todo)}
												handleMarkImportant={() => handleMarkImportant(todo)}
												onPointerDragStart={event => beginPointerDrag(todo, GROUP_TASKS, event)}
												dropdownOpen={openDropdownTodoId === todo.id}
												onDropdownOpenChange={open => setTodoDropdownOpen(todo.id, open)}
												isDropTarget={dropBeforeTodoId === todo.id}
												isDragging={draggingTodoId === todo.id}
												shiftDirection={getShiftDirection(todo.id, taskTodos, GROUP_TASKS)}
												isRecentlyMoved={recentlyMovedTodoId === todo.id}
											/>
										))}
									</ul>
								</div>
							)}
							{completedTodos.length > 0 && (
								<div className={`todo-group is-completed${isSubsequentGroupShifted(GROUP_COMPLETED) ? ' shift-down' : ''}`}>
									<h3 className="group-title">
										<span className="group-title-icon" aria-hidden="true">
											<svg viewBox="0 0 24 24">
												<path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" fill="none" stroke="currentColor" strokeWidth="1.6" />
												<path d="M8.4 12.3 11 14.9l4.7-4.9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
											</svg>
										</span>
										<span>Completed</span>
									</h3>
									<ul
										ref={element => {
											listRefs.current.completed = element;
										}}
									>
										{completedTodos.map(todo => (
											<ItemCard
												key={todo.id}
												todo={todo}
												formatTimestamp={formatStoredDate}
												handleCompleteTodo={() => handleCompleteTodo(todo)}
												handleEditTodo={() => handleEditTodo(todo)}
												handleSaveTodo={event => handleSaveTodo(todo, event)}
												handleDeleteTodo={() => handleDeleteTodo(todo)}
												handleMarkImportant={() => handleMarkImportant(todo)}
												onPointerDragStart={event => beginPointerDrag(todo, GROUP_COMPLETED, event)}
												dropdownOpen={openDropdownTodoId === todo.id}
												onDropdownOpenChange={open => setTodoDropdownOpen(todo.id, open)}
												isDropTarget={dropBeforeTodoId === todo.id}
												isDragging={draggingTodoId === todo.id}
												shiftDirection={getShiftDirection(todo.id, completedTodos, GROUP_COMPLETED)}
												isRecentlyMoved={recentlyMovedTodoId === todo.id}
											/>
										))}
									</ul>
								</div>
							)}
							{importantTodos.length === 0 && taskTodos.length === 0 && completedTodos.length === 0 && (
								<div className="empty-state-wrap">
									<svg className="empty-state-icon" viewBox="0 0 64 64" aria-hidden="true">
										<rect x="12" y="14" width="40" height="42" rx="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
										<path d="M22 28h20M22 36h20M22 44h12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
										<path d="M26 8v8M38 8v8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
									</svg>
									<p className="empty-state">No todo items yet.<br />Add one to start your day.</p>
								</div>
							)}
						</div>
						<form onSubmit={handleAddTodo} className="add-todo-container">
							<input type="text" name="todo" id="todo-input" autoComplete="off" className="add-input" placeholder="Add a new task..." />
							<button type="submit" className="add-button" aria-label="Add todo">
								+
							</button>
						</form>
					</section>
					<section className="panel note-panel">
						<div className="panel-head">
							<div>
								<h2 className="panel-title">Notes{noteUnsaved && <span className="note-unsaved-dot">*</span>}</h2>
								{noteSaveError && (
									<span className="note-save-error">
										Save failed, retrying<span className="note-save-error-dots" />
									</span>
								)}
							</div>
							<div className="note-switch" role="tablist" aria-label="Notes view" data-view={noteView}>
								<button type="button" className={noteView === 'source' ? 'active' : ''} onClick={() => setNoteView('source')}>
									<span>Source</span>
								</button>
								<button type="button" className={noteView === 'preview' ? 'active' : ''} onClick={() => setNoteView('preview')}>
									<span>Preview</span>
								</button>
							</div>
						</div>
						<Suspense fallback={null}>
							{noteView === 'source' ? (
								<div className="note-source-wrap">
									<NotesEditor value={noteContent} onChange={setNoteContent} />
								</div>
							) : (
								<NotesPreview content={noteContent} />
							)}
						</Suspense>
					</section>
					<section
						className="panel file-panel"
						onDragOver={event => event.preventDefault()}
						onDragEnter={handlePanelDragEnter}
						onDragLeave={handlePanelDragLeave}
						onDrop={handlePanelDrop}
					>
						<div className="panel-head">
							<div>
								<h2 className="panel-title">Files</h2>
							</div>
							<div className="panel-head-actions">
								<div className="panel-count">{stashedFiles.length}</div>
								{stashedFiles.length > 0 && (
									<button type="button" className="clear-button" onClick={handleClearFiles}>
										Clear all
									</button>
								)}
							</div>
							<input
								ref={fileInputRef}
								type="file"
								multiple
								hidden
								onChange={event => {
									if (event.target.files) {
										void uploadFiles(event.target.files);
									}
									event.currentTarget.value = '';
								}}
							/>
						</div>
						<div
							className={`drop-zone${isDraggingOver ? ' drag-active' : ''}`}
							onClick={() => { if (!isUploadingFiles) fileInputRef.current?.click(); }}
						>
							<div className="drop-zone-plus" aria-hidden="true">+</div>
							<p className={isUploadingFiles ? 'drop-zone-uploading' : uploadFailedRef.current && uploadStatusText ? 'drop-zone-error' : ''}>{isUploadingFiles ? uploadStatusText || 'Uploading...' : uploadStatusText || 'Drop files here to upload'}</p>
							<span>
								{isUploadingFiles ? `${Math.round(uploadProgress * 100)}% complete` : uploadStatusText ? '' : 'or click to browse files'}
							</span>
							{isUploadingFiles && (
								<button type="button" className="danger-button upload-cancel" onClick={event => { event.stopPropagation(); cancelUpload(); }}>Cancel</button>
							)}
							{isUploadingFiles && (
								<div className="upload-progress" aria-hidden="true">
									<div className="upload-progress-bar" style={{ width: `${Math.max(uploadProgress * 100, 4)}%` }} />
								</div>
							)}
						</div>
						<ul className="file-list">
							{stashedFiles.map(file => {
								const fileVisual = getFileVisual(file, fileIconConfig);
								return (
								<li key={file.id} className="file-item">
									<div className="file-meta-wrap">
										<div className="file-icon" aria-hidden="true" style={{ color: fileVisual.fg }}>
											<span>{fileVisual.text}</span>
										</div>
										<div className="file-meta">
										<p className="file-name">{file.name}</p>
										<p className="file-sub">{formatBytes(file.size)} · {formatStoredDate(file.uploadedAt)}</p>
									</div>
									</div>
									<div className="file-actions">
										<button type="button" className="secondary-button" onClick={() => handleDownloadFile(file)}>
											Download
										</button>
										<button type="button" className="danger-button" onClick={() => void handleDeleteFile(file.id, file.name)}>
											Delete
										</button>
									</div>
								</li>
								);
							})}
							{stashedFiles.length === 0 && <li className="file-empty">No files yet.</li>}
						</ul>
					</section>
				</div>
			</div>
			{dragPreview && (
				<div
					className="drag-preview"
					style={{
						width: dragPreview.width,
						height: dragPreview.height,
						transform: `translate3d(${dragPreview.x - dragPreview.offsetX}px, ${dragPreview.y - dragPreview.offsetY}px, 0)`
					}}
				>
					<div
						className={[
							'todo-item',
							'drag-preview-card',
							dragPreview.todo.completed ? 'completed' : '',
							dragPreview.todo.important ? 'is-important' : ''
						]
							.filter(Boolean)
							.join(' ')}
					>
						<div className="drag-handle drag-preview-handle" aria-hidden="true">
							<svg viewBox="0 0 24 24">
								<circle cx="8" cy="6" r="1.4" />
								<circle cx="16" cy="6" r="1.4" />
								<circle cx="8" cy="12" r="1.4" />
								<circle cx="16" cy="12" r="1.4" />
								<circle cx="8" cy="18" r="1.4" />
								<circle cx="16" cy="18" r="1.4" />
							</svg>
						</div>
						<div className={`complete-button ${dragPreview.todo.completed ? 'is-preview-complete' : ''}`} aria-hidden="true">
							<svg viewBox="0 0 24 24">
								<path d="M7 12.5 10.3 16 17 8.8" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
							</svg>
						</div>
						<div className="todo-main">
							<p className="todo-text">{dragPreview.todo.text}</p>
							{((dragPreview.todo.completed && dragPreview.todo.completedAt) || (!dragPreview.todo.completed && dragPreview.todo.createdAt)) && (
								<p className={`todo-meta ${dragPreview.todo.completed ? 'is-completed' : ''}`}>
									<span className="todo-meta-icon" aria-hidden="true">
										{dragPreview.todo.completed ? (
											<svg viewBox="0 0 16 16">
												<path d="M3.5 8.2 6.3 11l6.2-6.3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
											</svg>
										) : (
											<svg viewBox="0 0 16 16">
												<circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
												<path d="M8 4.7v3.6l2.3 1.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
											</svg>
										)}
									</span>
									<span>{dragPreview.todo.completed ? `Completed at ${formatStoredDate(dragPreview.todo.completedAt)}` : `Created at ${formatStoredDate(dragPreview.todo.createdAt)}`}</span>
								</p>
							)}
						</div>
						{dragPreview.todo.important && (
							<div className="right">
								<div className="star-slot">
									<span className="no-fill-icon-button" aria-hidden="true">
										<span className="glyph-icon star-glyph is-active">★</span>
									</span>
								</div>
							</div>
						)}
					</div>
				</div>
			)}
			{confirmDialog && (
				<div className="confirm-overlay" onClick={dismissConfirm}>
					<div className="confirm-card" onClick={e => e.stopPropagation()}>
						<p className="confirm-message">{confirmDialog.message}</p>
						<div className="confirm-actions">
							<button type="button" className="confirm-cancel" onClick={dismissConfirm}>Cancel</button>
							<button type="button" className="confirm-accept" onClick={acceptConfirm}>Confirm</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

export default Workspace;
