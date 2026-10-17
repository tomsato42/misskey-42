/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// mediaGate (画像・添付ファイルをログインしている人にだけ見せる機能) の HTTP まわり。
// DB を使わず、fastify.inject と差し替えた依存で確かめる

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { Config, MediaGateConfig } from '@/config.js';
import { MEDIA_GATE_SERVER_SUBJECT, issueMediaGateToken, nowUnixSec, verifyMediaGateToken } from '@/core/media-gate/media-gate.js';
import { DownloadService } from '@/core/DownloadService.js';
import { mediaGateRouteOptions, registerMediaGateHooks } from '@/server/media-gate-hooks.js';
import { MediaSessionApiService } from '@/server/api/MediaSessionApiService.js';
import { AuthenticationError } from '@/server/api/AuthenticateService.js';

const mediaGate: MediaGateConfig = { secret: 'test-only-secret-do-not-use-in-production-0123456789', cookieName: 'mi_media_session', ttlSec: 604800 };

function validCookie(): string {
	return `other=1; ${mediaGate.cookieName}=${issueMediaGateToken(mediaGate, 'a1b2c3d4e5', nowUnixSec()).token}`;
}

describe('media-gate のフック', () => {
	let fastify: FastifyInstance;

	beforeEach(async () => {
		fastify = Fastify();

		// ServerService と同じく、ルートごとにオプションとして渡す形
		fastify.get('/avatar', mediaGateRouteOptions(mediaGate), async (request, reply) => {
			reply.header('Cache-Control', 'public, max-age=86400');
			return 'avatar';
		});
		fastify.get('/open', mediaGateRouteOptions(undefined), async (request, reply) => {
			reply.header('Cache-Control', 'public, max-age=86400');
			return 'open';
		});

		// FileServerService と同じく、プラグインのスコープに登録する形
		fastify.register((instance, options, done) => {
			registerMediaGateHooks(instance, mediaGate);
			instance.get('/files/x', async (request, reply) => {
				reply.header('Cache-Control', 'max-age=31536000, immutable');
				return 'file';
			});
			done();
		});
		fastify.get('/outside', async (request, reply) => {
			reply.header('Cache-Control', 'public, max-age=60');
			return 'outside';
		});

		await fastify.ready();
	});

	afterEach(async () => {
		await fastify.close();
	});

	test('Cookie が無ければ 401 で、キャッシュさせない', async () => {
		for (const url of ['/avatar', '/files/x']) {
			const res = await fastify.inject({ method: 'GET', url });
			expect(res.statusCode).toBe(401);
			expect(res.headers['cache-control']).toBe('no-store');
		}
	});

	test('期限切れや改ざんされた Cookie は 401', async () => {
		const expired = issueMediaGateToken(mediaGate, 'a1b2c3d4e5', nowUnixSec() - 10, 5).token;
		const res1 = await fastify.inject({ method: 'GET', url: '/avatar', headers: { cookie: `${mediaGate.cookieName}=${expired}` } });
		expect(res1.statusCode).toBe(401);

		const other = issueMediaGateToken({ ...mediaGate, secret: 'another-secret-another-secret-another-secret' }, 'a1b2c3d4e5', nowUnixSec()).token;
		const res2 = await fastify.inject({ method: 'GET', url: '/avatar', headers: { cookie: `${mediaGate.cookieName}=${other}` } });
		expect(res2.statusCode).toBe(401);
	});

	test('有効な Cookie なら通し、Cache-Control を private にする', async () => {
		const res1 = await fastify.inject({ method: 'GET', url: '/avatar', headers: { cookie: validCookie() } });
		expect(res1.statusCode).toBe(200);
		expect(res1.body).toBe('avatar');
		expect(res1.headers['cache-control']).toBe('private, max-age=86400');

		const res2 = await fastify.inject({ method: 'GET', url: '/files/x', headers: { cookie: validCookie() } });
		expect(res2.statusCode).toBe(200);
		expect(res2.headers['cache-control']).toBe('private, max-age=31536000, immutable');
	});

	test('mediaGate が無効なルートやスコープの外は upstream と同じ', async () => {
		const res1 = await fastify.inject({ method: 'GET', url: '/open' });
		expect(res1.statusCode).toBe(200);
		expect(res1.headers['cache-control']).toBe('public, max-age=86400');

		const res2 = await fastify.inject({ method: 'GET', url: '/outside' });
		expect(res2.statusCode).toBe(200);
		expect(res2.headers['cache-control']).toBe('public, max-age=60');
	});
});

class FakeReply {
	public statusCode = 200;
	public headers: Record<string, string | string[]> = {};
	public sent = false;
	public code(status: number) {
		this.statusCode = status;
		return this;
	}
	public header(key: string, value: string) {
		this.headers[key.toLowerCase()] = value;
		return this;
	}
	public send() {
		this.sent = true;
		return this;
	}
}

type FakeUser = { id: string; isSuspended: boolean; isDeleted: boolean; };

describe('MediaSessionApiService', () => {
	const url = 'https://example.com';
	let users: Record<string, FakeUser>;
	let service: MediaSessionApiService;

	function request(body: unknown, headers: Record<string, string> = {}) {
		return { body, headers: { origin: url, 'sec-fetch-site': 'same-origin', ...headers }, ip: '127.0.0.1' } as any;
	}

	function issuedToken(reply: FakeReply): string {
		const cookie = reply.headers['set-cookie'] as string;
		return cookie.slice(`${mediaGate.cookieName}=`.length, cookie.indexOf(';'));
	}

	beforeEach(() => {
		users = {
			'aaaaaaaaaaaaaaaa': { id: 'a1b2c3d4e5', isSuspended: false, isDeleted: false },
			'bbbbbbbbbbbbbbbb': { id: 'b1b2c3d4e5', isSuspended: true, isDeleted: false },
			'cccccccccccccccc': { id: 'c1b2c3d4e5', isSuspended: false, isDeleted: true },
		};
		service = new MediaSessionApiService(
			{ url, enableIpRateLimit: false, mediaGate } as Config,
			{
				authenticate: async (token: string) => {
					const user = users[token];
					if (user == null) throw new AuthenticationError('user not found');
					return [user, null];
				},
			} as any,
			{ limit: async () => null } as any,
		);
	});

	test('ログイン中のユーザーに Cookie を発行する', async () => {
		const reply = new FakeReply();
		const res = await service.issue(request({ i: 'aaaaaaaaaaaaaaaa' }), reply as any);
		expect(reply.statusCode).toBe(200);
		expect(reply.headers['set-cookie']).toMatch(/^mi_media_session=v1\.a1b2c3d4e5\.\d+\.[A-Za-z0-9_-]{43}; Path=\/; Max-Age=604800; HttpOnly; SameSite=Lax; Secure$/);

		const verified = verifyMediaGateToken(mediaGate.secret, issuedToken(reply), nowUnixSec());
		expect(verified?.subject).toBe('a1b2c3d4e5');
		expect(res).toEqual({ expiresAt: verified!.exp * 1000 });
	});

	test.each([
		['トークンが無い', undefined],
		['トークンが文字列でない', { i: 1 }],
		['アプリのアクセストークン (ネイティブのトークンでない)', { i: 'a'.repeat(32) }],
		['存在しないトークン', { i: 'zzzzzzzzzzzzzzzz' }],
		['凍結されたユーザー', { i: 'bbbbbbbbbbbbbbbb' }],
		['削除されたユーザー', { i: 'cccccccccccccccc' }],
	])('%s なら発行しない', async (_, body) => {
		const reply = new FakeReply();
		await service.issue(request(body), reply as any);
		expect(reply.statusCode).toBe(401);
		expect(reply.headers['set-cookie']).toBeUndefined();
	});

	test('別のオリジンからのリクエストは拒否する', async () => {
		const reply1 = new FakeReply();
		await service.issue(request({ i: 'aaaaaaaaaaaaaaaa' }, { origin: 'https://evil.example' }), reply1 as any);
		expect(reply1.statusCode).toBe(403);
		expect(reply1.headers['set-cookie']).toBeUndefined();

		const reply2 = new FakeReply();
		await service.clear(request(undefined, { origin: url, 'sec-fetch-site': 'cross-site' }), reply2 as any);
		expect(reply2.statusCode).toBe(403);
		expect(reply2.headers['set-cookie']).toBeUndefined();
	});

	test('Cookie を消す', async () => {
		const reply = new FakeReply();
		await service.clear(request(undefined), reply as any);
		expect(reply.statusCode).toBe(204);
		expect(reply.headers['set-cookie']).toBe('mi_media_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure');
	});

	test('認証以外のエラーは握りつぶさない', async () => {
		service = new MediaSessionApiService(
			{ url, enableIpRateLimit: false, mediaGate } as Config,
			{ authenticate: async () => { throw new Error('db down'); } } as any,
			{ limit: async () => null } as any,
		);
		await expect(service.issue(request({ i: 'aaaaaaaaaaaaaaaa' }), new FakeReply() as any)).rejects.toThrow('db down');
	});
});

describe('DownloadService のメディア用 Cookie', () => {
	function headersFor(config: Partial<Config>, url: string): Record<string, string> {
		const service = new DownloadService(config as Config, {} as any, { getLogger: () => ({}) } as any);
		return (service as any).getMediaGateHeaders(new URL(url));
	}

	test('自分のホストへの取得には、サーバー用の短い期限の Cookie を付ける', () => {
		const headers = headersFor({ url: 'https://example.com', mediaGate }, 'https://example.com/media/a.png');
		const token = headers.Cookie.slice(`${mediaGate.cookieName}=`.length);
		const verified = verifyMediaGateToken(mediaGate.secret, token, nowUnixSec());
		expect(verified?.subject).toBe(MEDIA_GATE_SERVER_SUBJECT);
		expect(verified!.exp - nowUnixSec()).toBeLessThanOrEqual(300);
	});

	test('他のホストや、mediaGate が無効なときは付けない', () => {
		expect(headersFor({ url: 'https://example.com', mediaGate }, 'https://other.example/media/a.png')).toEqual({});
		expect(headersFor({ url: 'https://example.com', mediaGate }, 'http://example.com/media/a.png')).toEqual({});
		expect(headersFor({ url: 'https://example.com', mediaGate: undefined }, 'https://example.com/media/a.png')).toEqual({});
	});
});
