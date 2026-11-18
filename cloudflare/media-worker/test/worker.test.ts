/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Worker の fetch ハンドラを、R2 バケットを模したオブジェクトで動かして確かめる。
// R2 の Range・条件付きリクエストの解釈は、この偽物では必要な範囲だけを真似ている

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { handleRequest, parseObjectKey, type Env } from '../src/index.ts';
import { signMediaGateToken } from '../src/token.ts';

const SECRET = 'test-only-secret-do-not-use-in-production-0123456789';
const NOW = 1760000000;
const BASE = 'https://42times.kinachan.com/media/';

type StoredObject = { data: Uint8Array; contentType?: string; contentDisposition?: string; etag: string };

class FakeObject {
	public readonly key: string;
	public readonly size: number;
	public readonly etag: string;
	public readonly httpEtag: string;
	public readonly uploaded = new Date('2026-10-01T00:00:00Z');
	public readonly httpMetadata: { contentType?: string; contentDisposition?: string; cacheControl?: string };
	public range?: { offset: number; length: number };

	constructor(key: string, stored: StoredObject) {
		this.key = key;
		this.size = stored.data.length;
		this.etag = stored.etag;
		this.httpEtag = `"${stored.etag}"`;
		this.httpMetadata = {
			contentType: stored.contentType,
			contentDisposition: stored.contentDisposition,
			// Misskey はアップロード時にこれを指定する
			cacheControl: 'max-age=31536000, immutable',
		};
	}

	public writeHttpMetadata(headers: Headers): void {
		if (this.httpMetadata.contentType) headers.set('Content-Type', this.httpMetadata.contentType);
		if (this.httpMetadata.contentDisposition) headers.set('Content-Disposition', this.httpMetadata.contentDisposition);
		if (this.httpMetadata.cacheControl) headers.set('Cache-Control', this.httpMetadata.cacheControl);
	}
}

class FakeBucket {
	public objects = new Map<string, StoredObject>();
	public requestedKeys: string[] = [];

	public async head(key: string) {
		this.requestedKeys.push(key);
		const stored = this.objects.get(key);
		return stored ? new FakeObject(key, stored) : null;
	}

	public async get(key: string, options: { onlyIf: Headers; range: Headers }) {
		this.requestedKeys.push(key);
		const stored = this.objects.get(key);
		if (stored == null) return null;
		const object = new FakeObject(key, stored);

		const ifNoneMatch = options.onlyIf.get('If-None-Match');
		if (ifNoneMatch != null && ifNoneMatch.replace(/"/g, '') === stored.etag) {
			return object;
		}

		let data = stored.data;
		const range = options.range.get('Range');
		if (range != null) {
			const match = /^bytes=(\d+)-(\d*)$/.exec(range);
			if (match == null) throw new Error('unsupported range in fake');
			const start = Number(match[1]);
			const end = match[2] === '' ? stored.data.length - 1 : Number(match[2]);
			if (start >= stored.data.length) throw new Error('InvalidRange');
			data = stored.data.slice(start, end + 1);
			object.range = { offset: start, length: data.length };
		}

		return Object.assign(object, { body: new Blob([data]).stream() });
	}
}

async function cookieFor(subject = 'a1b2c3d4e5', exp = NOW + 3600, secret = SECRET): Promise<string> {
	return `mi_media_session=${await signMediaGateToken(secret, subject, exp)}`;
}

describe('Worker', () => {
	let bucket: FakeBucket;
	let env: Env;

	const request = (path: string, init: RequestInit = {}) => handleRequest(new Request(BASE + path, init), env, NOW);

	beforeEach(() => {
		bucket = new FakeBucket();
		bucket.objects.set('files/a.png', {
			data: new TextEncoder().encode('0123456789'),
			contentType: 'image/png',
			contentDisposition: 'inline; filename="a.png"',
			etag: 'etag-a',
		});
		bucket.objects.set('files/page.html', {
			data: new TextEncoder().encode('<script>alert(1)</script>'),
			contentType: 'text/html',
			etag: 'etag-html',
		});
		bucket.objects.set('files/icon.png', { data: new Uint8Array([1, 2, 3]), contentType: 'image/png', etag: 'etag-icon' });
		env = {
			MEDIA_BUCKET: bucket as unknown as R2Bucket,
			MEDIA_GATE_SECRET: SECRET,
			COOKIE_NAME: 'mi_media_session',
			PUBLIC_KEYS: 'files/icon.png, other/key.png',
		};
	});

	test('Cookie が無ければ 401 で、R2 を読まない', async () => {
		const res = await request('files/a.png');
		assert.equal(res.status, 401);
		assert.equal(res.headers.get('Cache-Control'), 'no-store');
		assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
		assert.deepEqual(bucket.requestedKeys, []);
	});

	test('期限切れ・別の secret で署名された Cookie は 401', async () => {
		assert.equal((await request('files/a.png', { headers: { Cookie: await cookieFor('a1b2c3d4e5', NOW) } })).status, 401);
		assert.equal((await request('files/a.png', { headers: { Cookie: await cookieFor('a1b2c3d4e5', NOW + 60, SECRET + 'x') } })).status, 401);
		assert.equal((await request('files/a.png', { headers: { Cookie: 'other_name=' + (await cookieFor()).split('=')[1] } })).status, 401);
	});

	test('有効な Cookie ならファイルを返す', async () => {
		const res = await request('files/a.png', { headers: { Cookie: `x=1; ${await cookieFor()}` } });
		assert.equal(res.status, 200);
		assert.equal(await res.text(), '0123456789');
		assert.equal(res.headers.get('Content-Type'), 'image/png');
		assert.equal(res.headers.get('Content-Disposition'), 'inline; filename="a.png"');
		assert.equal(res.headers.get('Cache-Control'), 'private, max-age=31536000, immutable');
		assert.equal(res.headers.get('ETag'), '"etag-a"');
		assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
		assert.equal(res.headers.get('Content-Security-Policy'), 'default-src \'none\'; img-src \'self\'; media-src \'self\'; style-src \'unsafe-inline\'');
		assert.deepEqual(bucket.requestedKeys, ['files/a.png']);
	});

	test('Misskey 自身の取得 (subject が server) も受け付ける', async () => {
		const res = await request('files/a.png', { headers: { Cookie: await cookieFor('server') } });
		assert.equal(res.status, 200);
	});

	test('ブラウザで安全に表示できない形式は application/octet-stream で返す', async () => {
		const res = await request('files/page.html', { headers: { Cookie: await cookieFor() } });
		assert.equal(res.status, 200);
		assert.equal(res.headers.get('Content-Type'), 'application/octet-stream');
	});

	test('Range リクエストには 206 で一部を返す', async () => {
		const res = await request('files/a.png', { headers: { Cookie: await cookieFor(), Range: 'bytes=2-5' } });
		assert.equal(res.status, 206);
		assert.equal(await res.text(), '2345');
		assert.equal(res.headers.get('Content-Range'), 'bytes 2-5/10');
		assert.equal(res.headers.get('Accept-Ranges'), 'bytes');
	});

	test('満たせない Range には 416', async () => {
		const res = await request('files/a.png', { headers: { Cookie: await cookieFor(), Range: 'bytes=20-' } });
		assert.equal(res.status, 416);
		assert.equal(res.headers.get('Content-Range'), 'bytes */10');
	});

	test('If-None-Match が ETag と一致すれば 304', async () => {
		const res = await request('files/a.png', { headers: { Cookie: await cookieFor(), 'If-None-Match': '"etag-a"' } });
		assert.equal(res.status, 304);
		assert.equal(res.headers.get('ETag'), '"etag-a"');
		assert.equal(res.headers.get('Cache-Control'), 'private, max-age=31536000, immutable');
	});

	test('HEAD は本文なしでメタデータを返し、If-None-Match にも応じる', async () => {
		const res = await request('files/a.png', { method: 'HEAD', headers: { Cookie: await cookieFor() } });
		assert.equal(res.status, 200);
		assert.equal(res.headers.get('Content-Length'), '10');
		assert.equal(res.headers.get('Content-Type'), 'image/png');
		assert.equal(await res.text(), '');

		const res304 = await request('files/a.png', { method: 'HEAD', headers: { Cookie: await cookieFor(), 'If-None-Match': 'W/"etag-a"' } });
		assert.equal(res304.status, 304);
	});

	test('存在しないキーは 404', async () => {
		assert.equal((await request('files/none.png', { headers: { Cookie: await cookieFor() } })).status, 404);
		assert.equal((await request('files/none.png', { method: 'HEAD', headers: { Cookie: await cookieFor() } })).status, 404);
	});

	test('GET と HEAD 以外は 405', async () => {
		for (const method of ['POST', 'PUT', 'DELETE']) {
			const res = await request('files/a.png', { method, headers: { Cookie: await cookieFor() } });
			assert.equal(res.status, 405);
			assert.equal(res.headers.get('Allow'), 'GET, HEAD');
		}
	});

	test('不正なキーは 400', async () => {
		for (const path of ['', 'files//a.png', 'files/..%2Fsecret', 'files/a.png/', 'files/%E0%A4%A', 'files/a%5Cb.png', 'files/a%00.png']) {
			const res = await request(path, { headers: { Cookie: await cookieFor() } });
			assert.equal(res.status, 400, path);
		}
		assert.deepEqual(bucket.requestedKeys, []);
	});

	test('/media/ の外は 404', async () => {
		const res = await handleRequest(new Request('https://42times.kinachan.com/other/a.png', { headers: { Cookie: await cookieFor() } }), env, NOW);
		assert.equal(res.status, 404);
		// URL の解釈で /media/%2E%2E/a.png は /a.png になる
		assert.equal((await request('%2E%2E/a.png', { headers: { Cookie: await cookieFor() } })).status, 404);
	});

	test('PUBLIC_KEYS に指定したキーは Cookie なしで返し、共有キャッシュを許す', async () => {
		const res = await request('files/icon.png');
		assert.equal(res.status, 200);
		assert.equal(res.headers.get('Cache-Control'), 'public, max-age=86400');
		// 他のキーは引き続き Cookie が必要
		assert.equal((await request('files/a.png')).status, 401);
	});

	test('MEDIA_GATE_SECRET が無い・短いときは誰にも返さない', async () => {
		env.MEDIA_GATE_SECRET = undefined;
		assert.equal((await request('files/icon.png')).status, 500);
		env.MEDIA_GATE_SECRET = 'short';
		assert.equal((await request('files/a.png', { headers: { Cookie: await cookieFor() } })).status, 500);
	});
});

describe('parseObjectKey', () => {
	test('Misskey が作るキー', () => {
		assert.equal(parseObjectKey('files/0f3a2b4c-1111-2222-3333-444455556666.webp'), 'files/0f3a2b4c-1111-2222-3333-444455556666.webp');
		assert.equal(parseObjectKey('thumbnail-0f3a.webp'), 'thumbnail-0f3a.webp');
	});

	test('パーセントエンコードを戻す', () => {
		assert.equal(parseObjectKey('files/a%20b.png'), 'files/a b.png');
	});

	test('長すぎるキーは拒否する', () => {
		assert.equal(parseObjectKey('a'.repeat(1025)), null);
	});
});
