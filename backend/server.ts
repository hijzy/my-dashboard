import Busboy from 'busboy';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { finished } from 'node:stream/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Todo = {
	id?: string;
	text: string;
	completed: boolean;
	editing: boolean;
	important?: boolean;
	createdAt?: string;
	completedAt?: string;
};

type AuthConfig = {
	salt: string;
	passwordHash: string;
};

type FileMeta = {
	id: string;
	name: string;
	type: string;
	size: number;
	uploadedAt: string;
	storedName: string;
};

type UploadedFileMeta = {
	id: string;
	name: string;
	type: string;
	size: number;
	createdAt: string;
	storedName: string;
};

type NoteAttachmentMeta = UploadedFileMeta & {
	orphanedAt: string | null;
};

type LoginAttemptState = {
	failures: number;
	firstFailureAt: number;
	blockedUntil: number;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const dataDir = join(projectRoot, 'data');
const todosFile = join(dataDir, 'todos.json');
const authFile = join(dataDir, 'auth.json');
const noteFile = join(dataDir, 'notes.md');
const filesMetaFile = join(dataDir, 'files.json');
const filesDir = join(dataDir, 'files');
const noteAttachmentsMetaFile = join(dataDir, 'note-attachments.json');
const noteAttachmentsDir = join(dataDir, 'note-attachments');
const distDir = join(projectRoot, 'dist');
const port = Number(process.env.TODO_SERVER_PORT || 8081);
const sessionCookieName = 'todo_session';
const sessionMaxAgeSeconds = 60 * 60 * 24 * 365 * 10;
const maxUploadBytes = 512 * 1024 * 1024;
const noteAttachmentGraceMs = 7 * 24 * 60 * 60 * 1000;
const loginWindowMs = 10 * 60 * 1000;
const maxLoginFailuresPerWindow = 5;
const loginBlockDurationMs = 10 * 60 * 1000;
const loginAttemptsByIp = new Map<string, LoginAttemptState>();

class HttpError extends Error {
	statusCode: number;

	constructor(message: string, statusCode: number) {
		super(message);
		this.statusCode = statusCode;
	}
}

async function ensureStorage() {
	await mkdir(dataDir, { recursive: true });
	await mkdir(filesDir, { recursive: true });
	await mkdir(noteAttachmentsDir, { recursive: true });
	if (!existsSync(todosFile)) {
		await writeFile(todosFile, '[]', 'utf-8');
	}
	if (!existsSync(authFile)) {
		await writeFile(authFile, 'null', 'utf-8');
	}
	if (!existsSync(noteFile)) {
		await writeFile(noteFile, '', 'utf-8');
	}
	if (!existsSync(filesMetaFile)) {
		await writeFile(filesMetaFile, '[]', 'utf-8');
	}
	if (!existsSync(noteAttachmentsMetaFile)) {
		await writeFile(noteAttachmentsMetaFile, '[]', 'utf-8');
	}
}

async function readTodos() {
	try {
		const content = await readFile(todosFile, 'utf-8');
		const parsed = JSON.parse(content) as unknown;
		return Array.isArray(parsed) ? (parsed as Todo[]) : [];
	} catch {
		return [];
	}
}

async function writeTodos(todos: Todo[]) {
	await writeFile(todosFile, JSON.stringify(todos, null, 2), 'utf-8');
}

async function readNote() {
	try {
		return await readFile(noteFile, 'utf-8');
	} catch {
		return '';
	}
}

async function writeNote(content: string) {
	await writeFile(noteFile, content, 'utf-8');
}

async function readFilesMeta() {
	try {
		const content = await readFile(filesMetaFile, 'utf-8');
		const parsed = JSON.parse(content) as unknown;
		if (!Array.isArray(parsed)) {
			return [];
		}
		return parsed as FileMeta[];
	} catch {
		return [];
	}
}

async function writeFilesMeta(files: FileMeta[]) {
	await writeFile(filesMetaFile, JSON.stringify(files, null, 2), 'utf-8');
}

async function readNoteAttachmentsMeta() {
	try {
		const content = await readFile(noteAttachmentsMetaFile, 'utf-8');
		const parsed = JSON.parse(content) as unknown;
		if (!Array.isArray(parsed)) {
			return [];
		}
		return parsed as NoteAttachmentMeta[];
	} catch {
		return [];
	}
}

async function writeNoteAttachmentsMeta(attachments: NoteAttachmentMeta[]) {
	await writeFile(noteAttachmentsMetaFile, JSON.stringify(attachments, null, 2), 'utf-8');
}

function extractNoteAttachmentIds(content: string) {
	const ids = new Set<string>();
	for (const match of content.matchAll(/\/api\/note\/attachments\/([A-Za-z0-9_-]+)/g)) {
		ids.add(match[1]);
	}
	return ids;
}

async function maintainNoteAttachments() {
	const [content, attachments] = await Promise.all([readNote(), readNoteAttachmentsMeta()]);
	const referencedIds = extractNoteAttachmentIds(content);
	const now = Date.now();
	const nowIso = new Date(now).toISOString();
	const nextAttachments: NoteAttachmentMeta[] = [];

	for (const attachment of attachments) {
		if (referencedIds.has(attachment.id)) {
			nextAttachments.push({ ...attachment, orphanedAt: null });
			continue;
		}

		if (!attachment.orphanedAt) {
			nextAttachments.push({ ...attachment, orphanedAt: nowIso });
			continue;
		}

		const orphanedAtMs = Date.parse(attachment.orphanedAt);
		if (!Number.isFinite(orphanedAtMs)) {
			nextAttachments.push({ ...attachment, orphanedAt: nowIso });
			continue;
		}

		if (now - orphanedAtMs >= noteAttachmentGraceMs) {
			await unlink(join(noteAttachmentsDir, attachment.storedName)).catch(() => undefined);
			continue;
		}

		nextAttachments.push(attachment);
	}

	await writeNoteAttachmentsMeta(nextAttachments);
}

function sanitizeFileName(name: string) {
	return name.normalize('NFC').replace(/[^\p{L}\p{N}.\-()_\s]/gu, '_').trim().slice(0, 180) || 'file';
}

function decodeMultipartFileName(name: string) {
	return Buffer.from(name, 'latin1').toString('utf8');
}

async function readAuthConfig() {
	try {
		const content = await readFile(authFile, 'utf-8');
		const parsed = JSON.parse(content) as unknown;
		if (!parsed || typeof parsed !== 'object') {
			return null;
		}
		const salt = (parsed as AuthConfig).salt;
		const passwordHash = (parsed as AuthConfig).passwordHash;
		if (typeof salt !== 'string' || typeof passwordHash !== 'string') {
			return null;
		}
		if (!salt || !passwordHash) {
			return null;
		}
		return { salt, passwordHash };
	} catch {
		return null;
	}
}

async function writeAuthConfig(config: AuthConfig | null) {
	await writeFile(authFile, JSON.stringify(config), 'utf-8');
}

function hashPassword(password: string, salt: string) {
	return scryptSync(password, salt, 64).toString('hex');
}

function getClientIp(request: import('node:http').IncomingMessage) {
	const forwardedFor = request.headers['x-forwarded-for'];
	if (typeof forwardedFor === 'string') {
		const [firstIp] = forwardedFor.split(',');
		if (firstIp?.trim()) {
			return firstIp.trim();
		}
	}
	if (Array.isArray(forwardedFor)) {
		const [firstValue] = forwardedFor;
		const [firstIp] = firstValue?.split(',') ?? [];
		if (firstIp?.trim()) {
			return firstIp.trim();
		}
	}
	return request.socket.remoteAddress || 'unknown';
}

function getActiveLoginAttemptState(ip: string, now: number) {
	const state = loginAttemptsByIp.get(ip);
	if (!state) {
		return null;
	}
	if (state.blockedUntil > now) {
		return state;
	}
	if (now - state.firstFailureAt >= loginWindowMs) {
		loginAttemptsByIp.delete(ip);
		return null;
	}
	if (state.blockedUntil !== 0) {
		state.blockedUntil = 0;
		loginAttemptsByIp.set(ip, state);
	}
	return state;
}

function getRemainingBlockSeconds(blockedUntil: number, now: number) {
	return Math.max(1, Math.ceil((blockedUntil - now) / 1000));
}

function recordLoginFailure(ip: string, now: number) {
	const currentState = getActiveLoginAttemptState(ip, now);
	if (!currentState) {
		loginAttemptsByIp.set(ip, {
			failures: 1,
			firstFailureAt: now,
			blockedUntil: 0
		});
		return;
	}
	const nextFailures = currentState.failures + 1;
	const nextState: LoginAttemptState = {
		...currentState,
		failures: nextFailures
	};
	if (nextFailures > maxLoginFailuresPerWindow) {
		nextState.blockedUntil = now + loginBlockDurationMs;
	}
	loginAttemptsByIp.set(ip, nextState);
}

function resetLoginFailures(ip: string) {
	loginAttemptsByIp.delete(ip);
}

function readCookie(request: import('node:http').IncomingMessage, key: string) {
	const cookieHeader = request.headers.cookie;
	if (!cookieHeader) {
		return '';
	}
	const parts = cookieHeader.split(';');
	for (const part of parts) {
		const [name, ...rest] = part.trim().split('=');
		if (name === key) {
			return decodeURIComponent(rest.join('='));
		}
	}
	return '';
}

function createSessionToken(authConfig: AuthConfig) {
	return createHmac('sha256', authConfig.passwordHash).update(`${authConfig.salt}:todo-session:v1`).digest('hex');
}

function isAuthenticated(request: import('node:http').IncomingMessage, authConfig: AuthConfig | null) {
	if (!authConfig) {
		return false;
	}
	const token = readCookie(request, sessionCookieName);
	if (!token) {
		return false;
	}
	return token === createSessionToken(authConfig);
}

function buildSessionCookie(token: string) {
	return `${sessionCookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionMaxAgeSeconds}`;
}

function buildSessionClearCookie() {
	return `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function sendJson(
	response: import('node:http').ServerResponse,
	statusCode: number,
	data: unknown,
	extraHeaders: Record<string, string | string[]> = {}
) {
	response.writeHead(statusCode, {
		'Content-Type': 'application/json; charset=utf-8',
		...extraHeaders
	});
	response.end(JSON.stringify(data));
}

function sendText(response: import('node:http').ServerResponse, statusCode: number, data: string | Buffer, contentType: string) {
	response.writeHead(statusCode, {
		'Content-Type': contentType
	});
	response.end(data);
}

function getContentType(filePath: string) {
	const extension = extname(filePath).toLowerCase();
	if (extension === '.html') {
		return 'text/html; charset=utf-8';
	}
	if (extension === '.js') {
		return 'application/javascript; charset=utf-8';
	}
	if (extension === '.css') {
		return 'text/css; charset=utf-8';
	}
	if (extension === '.json') {
		return 'application/json; charset=utf-8';
	}
	if (extension === '.png') {
		return 'image/png';
	}
	if (extension === '.jpg' || extension === '.jpeg') {
		return 'image/jpeg';
	}
	if (extension === '.svg') {
		return 'image/svg+xml';
	}
	if (extension === '.ico') {
		return 'image/x-icon';
	}
	if (extension === '.woff2') {
		return 'font/woff2';
	}
	if (extension === '.woff') {
		return 'font/woff';
	}
	if (extension === '.ttf') {
		return 'font/ttf';
	}
	if (extension === '.otf') {
		return 'font/otf';
	}
	return 'application/octet-stream';
}

async function parseRequestBody(request: import('node:http').IncomingMessage) {
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
	}
	const raw = Buffer.concat(chunks).toString('utf-8');
	return raw ? (JSON.parse(raw) as unknown) : [];
}

async function parseMultipartFiles(request: import('node:http').IncomingMessage, destinationDir: string) {
	return new Promise<UploadedFileMeta[]>((resolve, reject) => {
		const contentType = request.headers['content-type'] || '';
		if (!contentType.includes('multipart/form-data')) {
			reject(new HttpError('Expected multipart/form-data', 400));
			return;
		}

		const uploadTasks: Promise<UploadedFileMeta | null>[] = [];
		const createdPaths: string[] = [];
		let didFail = false;

		const fail = (error: Error) => {
			if (didFail) {
				return;
			}
			didFail = true;
			void Promise.all(createdPaths.map(path => unlink(path).catch(() => undefined))).finally(() => {
				reject(error);
			});
		};

		const busboy = Busboy({
			headers: request.headers,
			limits: {
				fileSize: maxUploadBytes,
				files: 20
			}
		});

		busboy.on('file', (_fieldName, fileStream, info) => {
			const safeName = sanitizeFileName(decodeMultipartFileName(info.filename || 'file'));
			const id = randomBytes(12).toString('hex');
			const storedName = `${id}-${safeName}`;
			const filePath = join(destinationDir, storedName);
			const writeStream = createWriteStream(filePath);
			const createdAt = new Date().toISOString();
			let size = 0;
			let limitError: HttpError | null = null;

			createdPaths.push(filePath);

			fileStream.on('data', chunk => {
				size += chunk.length;
			});

			fileStream.on('limit', () => {
				limitError = new HttpError(`File "${safeName}" exceeds the ${Math.round(maxUploadBytes / (1024 * 1024))} MB limit`, 413);
				writeStream.destroy(limitError);
				fileStream.resume();
			});

			const uploadTask = (async () => {
				try {
					fileStream.pipe(writeStream);
					await Promise.all([finished(fileStream), finished(writeStream)]);
					if (didFail || size === 0) {
						return null;
					}
					if (limitError) {
						throw limitError;
					}
					return {
						id,
						name: safeName,
						type: info.mimeType || 'application/octet-stream',
						size,
						createdAt,
						storedName
					};
				} catch (error) {
					if (limitError) {
						throw limitError;
					}
					throw error instanceof Error ? error : new HttpError('Upload failed', 400);
				}
			})();

			uploadTasks.push(uploadTask);
		});

		busboy.on('error', error => {
			fail(error instanceof Error ? error : new Error('Upload parse failed'));
		});

		busboy.on('finish', () => {
			void Promise.all(uploadTasks)
				.then(results => {
					if (didFail) {
						return;
					}
					const uploads = results.filter((file): file is UploadedFileMeta => file !== null);
					if (!uploads.length) {
						fail(new HttpError('No files uploaded', 400));
						return;
					}
					resolve(uploads);
				})
				.catch(error => {
					fail(error instanceof Error ? error : new Error('Upload failed'));
				});
		});

		request.on('aborted', () => {
			fail(new HttpError('Upload aborted', 499));
		});

		request.on('error', error => {
			fail(error instanceof Error ? error : new HttpError('Upload failed', 400));
		});

		request.pipe(busboy);
	});
}

async function readStaticFile(pathname: string) {
	const normalizedPath = pathname === '/' ? '/index.html' : pathname;
	const decodedPath = decodeURIComponent(normalizedPath);
	const filePath = resolve(distDir, `.${decodedPath}`);
	if (!filePath.startsWith(distDir)) {
		return null;
	}
	try {
		const content = await readFile(filePath);
		return { content, contentType: getContentType(filePath) };
	} catch {
		return null;
	}
}

await ensureStorage();

const server = createServer(async (request, response) => {
	const url = new URL(request.url || '/', `http://${request.headers.host}`);
	const authConfig = await readAuthConfig();

	if (url.pathname === '/api/auth/status' && request.method === 'GET') {
		sendJson(response, 200, {
			initialized: Boolean(authConfig),
			authenticated: isAuthenticated(request, authConfig)
		});
		return;
	}

	if (url.pathname === '/api/auth/setup' && request.method === 'POST') {
		if (authConfig) {
			sendJson(response, 409, { message: 'Password already set' });
			return;
		}
		try {
			const body = await parseRequestBody(request);
			const password = typeof (body as { password?: unknown }).password === 'string' ? (body as { password: string }).password : '';
			const safePassword = password.trim();
			if (!safePassword) {
				sendJson(response, 400, { message: 'Password is required' });
				return;
			}
			const salt = randomBytes(16).toString('hex');
			const passwordHash = hashPassword(safePassword, salt);
			const nextAuthConfig = { salt, passwordHash };
			await writeAuthConfig(nextAuthConfig);
			const token = createSessionToken(nextAuthConfig);
			sendJson(response, 200, { success: true }, { 'Set-Cookie': buildSessionCookie(token) });
			return;
		} catch {
			sendJson(response, 400, { message: 'Invalid request body' });
			return;
		}
	}

	if (url.pathname === '/api/auth/login' && request.method === 'POST') {
		const now = Date.now();
		const clientIp = getClientIp(request);
		const loginAttemptState = getActiveLoginAttemptState(clientIp, now);
		if (loginAttemptState?.blockedUntil && loginAttemptState.blockedUntil > now) {
			sendJson(
				response,
				429,
				{ message: 'Too many failed login attempts. Please try again later.' },
				{ 'Retry-After': String(getRemainingBlockSeconds(loginAttemptState.blockedUntil, now)) }
			);
			return;
		}
		try {
			const body = await parseRequestBody(request);
			const password = typeof (body as { password?: unknown }).password === 'string' ? (body as { password: string }).password : '';
			const safePassword = password.trim();
			if (!authConfig || !safePassword) {
				recordLoginFailure(clientIp, now);
				sendJson(response, 401, { message: 'Login failed' });
				return;
			}
			const passwordHash = hashPassword(safePassword, authConfig.salt);
			const expected = Buffer.from(authConfig.passwordHash, 'hex');
			const actual = Buffer.from(passwordHash, 'hex');
			if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
				recordLoginFailure(clientIp, now);
				sendJson(response, 401, { message: 'Login failed' });
				return;
			}
			resetLoginFailures(clientIp);
			const token = createSessionToken(authConfig);
			sendJson(response, 200, { success: true }, { 'Set-Cookie': buildSessionCookie(token) });
			return;
		} catch {
			sendJson(response, 400, { message: 'Invalid request body' });
			return;
		}
	}

	if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
		sendJson(response, 200, { success: true }, { 'Set-Cookie': buildSessionClearCookie() });
		return;
	}

	if ((url.pathname.startsWith('/api/') || url.pathname === '/todos.json') && !isAuthenticated(request, authConfig)) {
		sendJson(response, 401, { message: 'Authentication required' });
		return;
	}

	if (url.pathname === '/todos.json' && request.method === 'GET') {
		const todos = await readTodos();
		sendJson(response, 200, todos);
		return;
	}

	if (url.pathname === '/todos.json' && request.method === 'PUT') {
		try {
			const body = await parseRequestBody(request);
			if (!Array.isArray(body)) {
				sendJson(response, 400, { message: 'Body must be an array' });
				return;
			}
			await writeTodos(body as Todo[]);
			sendJson(response, 200, { success: true });
			return;
		} catch {
			sendJson(response, 400, { message: 'Invalid JSON' });
			return;
		}
	}

	if (url.pathname === '/api/note' && request.method === 'GET') {
		const content = await readNote();
		sendJson(response, 200, { content });
		return;
	}

	if (url.pathname === '/api/note' && request.method === 'PUT') {
		try {
			const body = await parseRequestBody(request);
			const content = typeof (body as { content?: unknown }).content === 'string' ? (body as { content: string }).content : '';
			await writeNote(content);
			sendJson(response, 200, { success: true });
			return;
		} catch {
			sendJson(response, 400, { message: 'Invalid JSON' });
			return;
		}
	}

	if (url.pathname === '/api/note/attachments/maintenance' && request.method === 'POST') {
		try {
			await maintainNoteAttachments();
			sendJson(response, 200, { success: true });
			return;
		} catch {
			sendJson(response, 500, { message: 'Attachment maintenance failed' });
			return;
		}
	}

	if (url.pathname === '/api/note/attachments' && request.method === 'POST') {
		try {
			const uploadedFiles = await parseMultipartFiles(request, noteAttachmentsDir);
			const hasNonImage = uploadedFiles.some(file => !file.type.startsWith('image/'));
			if (hasNonImage) {
				await Promise.all(uploadedFiles.map(file => unlink(join(noteAttachmentsDir, file.storedName)).catch(() => undefined)));
				sendJson(response, 400, { message: 'Only image uploads are supported for notes' });
				return;
			}
			const attachments = uploadedFiles.map(file => ({
				...file,
				orphanedAt: null
			}));
			const existingAttachments = await readNoteAttachmentsMeta();
			await writeNoteAttachmentsMeta([...attachments, ...existingAttachments]);
			sendJson(
				response,
				200,
				attachments.map(({ storedName, orphanedAt, ...rest }) => rest)
			);
			return;
		} catch (error) {
			const statusCode = error instanceof HttpError ? error.statusCode : 400;
			const message = error instanceof Error ? error.message : 'Invalid upload payload';
			sendJson(response, statusCode, { message });
			return;
		}
	}

	const noteAttachmentMatch = url.pathname.match(/^\/api\/note\/attachments\/([^/]+)$/);
	if (noteAttachmentMatch && request.method === 'GET') {
		const id = decodeURIComponent(noteAttachmentMatch[1]);
		const attachments = await readNoteAttachmentsMeta();
		const target = attachments.find(attachment => attachment.id === id);
		if (!target) {
			sendJson(response, 404, { message: 'Attachment not found' });
			return;
		}
		try {
			const filePath = join(noteAttachmentsDir, target.storedName);
			const fileStat = await stat(filePath);
			response.writeHead(200, {
				'Content-Type': target.type || 'application/octet-stream',
				'Content-Length': String(fileStat.size),
				'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(target.name)}`
			});
			const stream = createReadStream(filePath);
			stream.on('error', () => {
				response.destroy();
			});
			stream.pipe(response);
			return;
		} catch {
			sendJson(response, 404, { message: 'Attachment content missing' });
			return;
		}
	}

	if (url.pathname === '/api/files' && request.method === 'GET') {
		const files = await readFilesMeta();
		sendJson(
			response,
			200,
			files.map(({ storedName, ...rest }) => rest)
		);
		return;
	}

	if (url.pathname === '/api/files' && request.method === 'POST') {
		try {
			const uploadedFiles = (await parseMultipartFiles(request, filesDir)).map(({ createdAt, ...rest }) => ({
				...rest,
				uploadedAt: createdAt
			}));
			const files = await readFilesMeta();
			await writeFilesMeta([...uploadedFiles, ...files]);
			sendJson(
				response,
				200,
				uploadedFiles.map(({ storedName, ...rest }) => rest)
			);
			return;
		} catch (error) {
			const statusCode = error instanceof HttpError ? error.statusCode : 400;
			const message = error instanceof Error ? error.message : 'Invalid upload payload';
			sendJson(response, statusCode, { message });
			return;
		}
	}

	if (url.pathname === '/api/files' && request.method === 'DELETE') {
		const files = await readFilesMeta();
		await Promise.all(files.map(file => unlink(join(filesDir, file.storedName)).catch(() => undefined)));
		await writeFilesMeta([]);
		sendJson(response, 200, { success: true });
		return;
	}

	const fileDeleteMatch = url.pathname.match(/^\/api\/files\/([^/]+)$/);
	if (fileDeleteMatch && request.method === 'DELETE') {
		const id = decodeURIComponent(fileDeleteMatch[1]);
		const files = await readFilesMeta();
		const target = files.find(file => file.id === id);
		if (!target) {
			sendJson(response, 404, { message: 'File not found' });
			return;
		}
		try {
			await unlink(join(filesDir, target.storedName));
		} catch {
		}
		await writeFilesMeta(files.filter(file => file.id !== id));
		sendJson(response, 200, { success: true });
		return;
	}

	const fileDownloadMatch = url.pathname.match(/^\/api\/files\/([^/]+)\/download$/);
	if (fileDownloadMatch && request.method === 'GET') {
		const id = decodeURIComponent(fileDownloadMatch[1]);
		const files = await readFilesMeta();
		const target = files.find(file => file.id === id);
		if (!target) {
			sendJson(response, 404, { message: 'File not found' });
			return;
		}
		try {
			const filePath = join(filesDir, target.storedName);
			const fileStat = await stat(filePath);
			response.writeHead(200, {
				'Content-Type': target.type || 'application/octet-stream',
				'Content-Length': String(fileStat.size),
				'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(target.name)}`
			});
			const stream = createReadStream(filePath);
			stream.on('error', () => {
				response.destroy();
			});
			stream.pipe(response);
			return;
		} catch {
			sendJson(response, 404, { message: 'File content missing' });
			return;
		}
	}

	if (!existsSync(distDir)) {
		sendText(response, 503, 'Frontend build not found. Run npm run build first.', 'text/plain; charset=utf-8');
		return;
	}

	const staticFile = await readStaticFile(url.pathname);
	if (staticFile) {
		sendText(response, 200, staticFile.content, staticFile.contentType);
		return;
	}

	const htmlFallback = await readStaticFile('/index.html');
	if (htmlFallback) {
		sendText(response, 200, htmlFallback.content.toString('utf-8'), htmlFallback.contentType);
		return;
	}

	sendJson(response, 404, { message: 'Not found' });
});

server.listen(port, '0.0.0.0', () => {
	console.log(`Todo server listening at http://localhost:${port}`);
});
