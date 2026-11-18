/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// R2 の非公開バケットに保存した Misskey のドライブのファイルを、
// Misskey にログインしている人 (Misskey が発行したメディア用 Cookie を持つブラウザ) にだけ返す。
// ルート {ホスト}/media/* に割り当て、/media/ より後ろを R2 のキーとして扱う。

import { getCookieValue, verifyMediaGateToken } from './token.ts';

export interface Env {
	MEDIA_BUCKET: R2Bucket;
	/** Misskey の mediaGate.secret と同じ値。wrangler secret put MEDIA_GATE_SECRET で登録する */
	MEDIA_GATE_SECRET?: string;
	/** Misskey の mediaGate.cookieName と同じ値 */
	COOKIE_NAME?: string;
	/** ログインしていない人にも返すオブジェクトのキー (カンマ区切り) */
	PUBLIC_KEYS?: string;
}

export const PATH_PREFIX = '/media/';
const DEFAULT_COOKIE_NAME = 'mi_media_session';
const MIN_SECRET_LENGTH = 32;
const MAX_KEY_LENGTH = 1024;

// ログインした人のブラウザにだけキャッシュさせる。キーは UUID なので、同じキーの中身は変わらない
const PRIVATE_CACHE_CONTROL = 'private, max-age=31536000, immutable';
// PUBLIC_KEYS に指定したもの (ログイン画面のアイコンなど) は共有キャッシュも許す
const PUBLIC_CACHE_CONTROL = 'public, max-age=86400';

// Misskey 本体がファイル配信 (packages/backend/src/server/FileServerService.ts) で付けているものと同じ
const CONTENT_SECURITY_POLICY = 'default-src \'none\'; img-src \'self\'; media-src \'self\'; style-src \'unsafe-inline\'';

// packages/backend/src/const.ts の FILE_TYPE_BROWSERSAFE と同じ。
// これ以外の Content-Type は application/octet-stream として返す (Misskey のアップロード時の扱いと同じ)
const FILE_TYPE_BROWSERSAFE = new Set([
	'image/png',
	'image/gif',
	'image/jpeg',
	'image/webp',
	'image/avif',
	'image/apng',
	'image/bmp',
	'image/tiff',
	'image/x-icon',
	'audio/opus',
	'video/ogg',
	'audio/ogg',
	'application/ogg',
	'video/quicktime',
	'video/mp4',
	'audio/mp4',
	'video/x-m4v',
	'audio/x-m4a',
	'video/3gpp',
	'video/3gpp2',
	'video/mpeg',
	'audio/mpeg',
	'video/webm',
	'audio/webm',
	'audio/aac',
	'audio/flac',
	'audio/wav',
	'audio/x-flac',
	'audio/vnd.wave',
]);

export function getSafeContentType(contentType: string | undefined): string {
	if (contentType == null) return 'application/octet-stream';
	const mime = contentType.split(';')[0].trim().toLowerCase();
	return FILE_TYPE_BROWSERSAFE.has(mime) ? mime : 'application/octet-stream';
}

/**
 * パスの /media/ より後ろの部分から R2 のキーを取り出す。不正なら null
 */
export function parseObjectKey(rawPath: string): string | null {
	let key: string;
	try {
		key = decodeURIComponent(rawPath);
	} catch {
		return null;
	}

	if (key.length === 0 || key.length > MAX_KEY_LENGTH) return null;
	// 制御文字とバックスラッシュは Misskey が作るキーには含まれない
	// eslint-disable-next-line no-control-regex
	if (/[\u0000-\u001f\u007f\\]/.test(key)) return null;
	// 空のセグメント (先頭・末尾の / や //) や、. / .. のセグメントは拒否する
	if (key.split('/').some(segment => segment === '' || segment === '.' || segment === '..')) return null;

	return key;
}

export function parsePublicKeys(value: string | undefined): Set<string> {
	if (value == null) return new Set();
	return new Set(value.split(',').map(x => x.trim()).filter(x => x !== ''));
}

function securityHeaders(headers: Headers): Headers {
	headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
	headers.set('X-Content-Type-Options', 'nosniff');
	// 学内SNSの画像なので、検索エンジンにインデックスさせない (Misskey 本体の学内SNSモードと同じ値)
	headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
	return headers;
}

function textResponse(status: number, body: string, extraHeaders: Record<string, string> = {}): Response {
	const headers = securityHeaders(new Headers({
		'Content-Type': 'text/plain; charset=utf-8',
		'Cache-Control': 'no-store',
		...extraHeaders,
	}));
	return new Response(body, { status, headers });
}

function objectHeaders(object: R2Object, isPublic: boolean): Headers {
	const headers = new Headers();
	// Content-Type・Content-Disposition など、アップロード時に Misskey が指定したもの
	object.writeHttpMetadata(headers);
	headers.set('Content-Type', getSafeContentType(object.httpMetadata?.contentType));
	headers.set('Cache-Control', isPublic ? PUBLIC_CACHE_CONTROL : PRIVATE_CACHE_CONTROL);
	headers.set('ETag', object.httpEtag);
	headers.set('Last-Modified', object.uploaded.toUTCString());
	headers.set('Accept-Ranges', 'bytes');
	return securityHeaders(headers);
}

/**
 * If-None-Match が ETag に一致するか (弱い比較)
 */
export function matchesIfNoneMatch(ifNoneMatch: string | null, etag: string): boolean {
	if (ifNoneMatch == null) return false;
	const normalize = (value: string) => value.trim().replace(/^W\//, '');
	const target = normalize(etag);
	return ifNoneMatch.split(',').some(value => value.trim() === '*' || normalize(value) === target);
}

function contentRange(range: R2Range, size: number): { start: number; end: number } {
	if ('suffix' in range && range.suffix != null) {
		const length = Math.min(range.suffix, size);
		return { start: size - length, end: size - 1 };
	}
	const start = 'offset' in range && range.offset != null ? range.offset : 0;
	const length = 'length' in range && range.length != null ? range.length : size - start;
	return { start, end: Math.min(start + length, size) - 1 };
}

async function isAuthorized(request: Request, env: Env, nowSec: number): Promise<boolean> {
	const token = getCookieValue(request.headers.get('Cookie'), env.COOKIE_NAME || DEFAULT_COOKIE_NAME);
	if (token == null) return false;
	return await verifyMediaGateToken(env.MEDIA_GATE_SECRET!, token, nowSec) != null;
}

export async function handleRequest(request: Request, env: Env, nowSec = Math.floor(Date.now() / 1000)): Promise<Response> {
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		return textResponse(405, 'Method Not Allowed', { 'Allow': 'GET, HEAD' });
	}

	// 秘密の値が無い・短すぎるときは、誰にも返さない
	if (env.MEDIA_GATE_SECRET == null || env.MEDIA_GATE_SECRET.length < MIN_SECRET_LENGTH) {
		console.error('MEDIA_GATE_SECRET is not configured (or is too short)');
		return textResponse(500, 'Internal Server Error');
	}

	const url = new URL(request.url);
	if (!url.pathname.startsWith(PATH_PREFIX)) {
		return textResponse(404, 'Not Found');
	}

	const key = parseObjectKey(url.pathname.slice(PATH_PREFIX.length));
	if (key == null) {
		return textResponse(400, 'Bad Request');
	}

	const isPublic = parsePublicKeys(env.PUBLIC_KEYS).has(key);
	if (!isPublic && !await isAuthorized(request, env, nowSec)) {
		return textResponse(401, 'Unauthorized');
	}

	if (request.method === 'HEAD') {
		const object = await env.MEDIA_BUCKET.head(key);
		if (object == null) return textResponse(404, 'Not Found');

		const headers = objectHeaders(object, isPublic);
		if (matchesIfNoneMatch(request.headers.get('If-None-Match'), object.httpEtag)) {
			return new Response(null, { status: 304, headers });
		}
		headers.set('Content-Length', String(object.size));
		return new Response(null, { status: 200, headers });
	}

	let object: R2ObjectBody | R2Object | null;
	try {
		// Range・If-None-Match などの解釈は R2 に任せる
		object = await env.MEDIA_BUCKET.get(key, { onlyIf: request.headers, range: request.headers });
	} catch (err) {
		// 満たせない Range (ファイルの大きさを超えるもの) は例外になる
		if (request.headers.has('Range')) {
			const head = await env.MEDIA_BUCKET.head(key);
			if (head == null) return textResponse(404, 'Not Found');
			return textResponse(416, 'Range Not Satisfiable', { 'Content-Range': `bytes */${head.size}` });
		}
		throw err;
	}

	if (object == null) return textResponse(404, 'Not Found');

	const headers = objectHeaders(object, isPublic);

	// 条件付きリクエストの条件に当てはまり、本文が返されなかった
	if (!('body' in object)) {
		const notModified = request.headers.has('If-None-Match') || request.headers.has('If-Modified-Since');
		return new Response(null, { status: notModified ? 304 : 412, headers });
	}

	if (object.range != null && request.headers.has('Range')) {
		const { start, end } = contentRange(object.range, object.size);
		headers.set('Content-Range', `bytes ${start}-${end}/${object.size}`);
		return new Response(object.body, { status: 206, headers });
	}

	// Content-Length は R2 の本文 (長さが分かっているストリーム) から Workers のランタイムが付ける
	return new Response(object.body, { status: 200, headers });
}

export default {
	fetch(request, env) {
		return handleRequest(request, env);
	},
} satisfies ExportedHandler<Env>;
