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
import { DownloadService, type DownloadUrlOptions } from '@/core/DownloadService.js';
import { MemoryKVCache } from '@/misc/cache.js';
import { createMediaGateUserChecker, mediaGateRouteOptions, registerMediaGateHooks, type MediaGateUserChecker } from '@/server/media-gate-hooks.js';
import { MediaSessionApiService } from '@/server/api/MediaSessionApiService.js';
import { AuthenticationError } from '@/server/api/AuthenticateService.js';
import { FileServerProxyHandler } from '@/server/file/FileServerProxyHandler.js';
import { FileServerFileResolver } from '@/server/file/FileServerFileResolver.js';

const mediaGate: MediaGateConfig = { secret: 'test-only-secret-do-not-use-in-production-0123456789', cookieName: 'mi_media_session', ttlSec: 7200 };

function cookieFor(subject: string): string {
	return `other=1; ${mediaGate.cookieName}=${issueMediaGateToken(mediaGate, subject, nowUnixSec()).token}`;
}

function validCookie(): string {
	return cookieFor('a1b2c3d4e5');
}

describe('media-gate のフック', () => {
	let fastify: FastifyInstance;
	let checkedUserIds: string[];

	beforeEach(async () => {
		fastify = Fastify();
		checkedUserIds = [];

		// a1b2c3d4e5 だけが有効なユーザー。b... は凍結・削除済み、または存在しないユーザーとして扱う
		const isActiveUser: MediaGateUserChecker = async (userId) => {
			checkedUserIds.push(userId);
			return userId === 'a1b2c3d4e5';
		};

		// ServerService と同じく、ルートごとにオプションとして渡す形
		fastify.get('/avatar', mediaGateRouteOptions(mediaGate, isActiveUser), async (request, reply) => {
			reply.header('Cache-Control', 'public, max-age=86400');
			return 'avatar';
		});
		fastify.get('/open', mediaGateRouteOptions(undefined, isActiveUser), async (request, reply) => {
			reply.header('Cache-Control', 'public, max-age=86400');
			return 'open';
		});

		// FileServerService と同じく、プラグインのスコープに登録する形
		fastify.register((instance, options, done) => {
			registerMediaGateHooks(instance, mediaGate, isActiveUser);
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

	test('期限内でも、凍結・削除済みのユーザーの Cookie は 401', async () => {
		for (const url of ['/avatar', '/files/x']) {
			const res = await fastify.inject({ method: 'GET', url, headers: { cookie: cookieFor('b1b2c3d4e5') } });
			expect(res.statusCode).toBe(401);
			expect(res.headers['cache-control']).toBe('no-store');
		}
		expect(checkedUserIds).toEqual(['b1b2c3d4e5', 'b1b2c3d4e5']);
	});

	test('サーバー自身の Cookie はユーザーの状態を確かめずに通す', async () => {
		const res = await fastify.inject({ method: 'GET', url: '/files/x', headers: { cookie: cookieFor(MEDIA_GATE_SERVER_SUBJECT) } });
		expect(res.statusCode).toBe(200);
		expect(checkedUserIds).toEqual([]);
	});

	test('署名が無効な Cookie では、ユーザーの状態を確かめない', async () => {
		const other = issueMediaGateToken({ ...mediaGate, secret: 'another-secret-another-secret-another-secret' }, 'a1b2c3d4e5', nowUnixSec()).token;
		const res = await fastify.inject({ method: 'GET', url: '/avatar', headers: { cookie: `${mediaGate.cookieName}=${other}` } });
		expect(res.statusCode).toBe(401);
		expect(checkedUserIds).toEqual([]);
	});
});

describe('createMediaGateUserChecker', () => {
	type FakeUser = { id: string; isSuspended: boolean; isDeleted: boolean };
	let cache: MemoryKVCache<FakeUser>;
	let dbUsers: Record<string, FakeUser>;
	let dbQueries: unknown[];
	let isActiveUser: MediaGateUserChecker;

	beforeEach(() => {
		cache = new MemoryKVCache<FakeUser>(1000 * 60 * 5);
		dbUsers = {
			'a1b2c3d4e5': { id: 'a1b2c3d4e5', isSuspended: false, isDeleted: false },
			'b1b2c3d4e5': { id: 'b1b2c3d4e5', isSuspended: true, isDeleted: false },
			'c1b2c3d4e5': { id: 'c1b2c3d4e5', isSuspended: false, isDeleted: true },
		};
		dbQueries = [];
		const usersRepository = {
			findOneBy: async (where: { id: string }) => {
				dbQueries.push(where);
				return dbUsers[where.id] ?? null;
			},
		};
		isActiveUser = createMediaGateUserChecker({ localUserByIdCache: cache } as any, usersRepository as any);
	});

	afterEach(() => {
		cache.dispose();
	});

	test('凍結・削除済み・存在しないユーザーは false', async () => {
		expect(await isActiveUser('a1b2c3d4e5')).toBe(true);
		expect(await isActiveUser('b1b2c3d4e5')).toBe(false);
		expect(await isActiveUser('c1b2c3d4e5')).toBe(false);
		expect(await isActiveUser('z1b2c3d4e5')).toBe(false);
	});

	test('ローカルユーザーだけを DB から引き、結果をキャッシュして 2 回目からは DB を引かない', async () => {
		await isActiveUser('a1b2c3d4e5');
		await isActiveUser('a1b2c3d4e5');
		expect(dbQueries).toHaveLength(1);
		expect(dbQueries[0]).toMatchObject({ id: 'a1b2c3d4e5' });
		expect((dbQueries[0] as { host: unknown }).host).toBeDefined();
	});

	test('凍結されてキャッシュが更新されたら (CacheService の内部イベントの処理)、次のリクエストから false', async () => {
		expect(await isActiveUser('a1b2c3d4e5')).toBe(true);
		cache.set('a1b2c3d4e5', { id: 'a1b2c3d4e5', isSuspended: true, isDeleted: false });
		expect(await isActiveUser('a1b2c3d4e5')).toBe(false);
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
		expect(reply.headers['set-cookie']).toMatch(/^mi_media_session=v1\.a1b2c3d4e5\.\d+\.[A-Za-z0-9_-]{43}; Path=\/; Max-Age=7200; HttpOnly; SameSite=Lax; Secure$/);

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
	const attach: DownloadUrlOptions = { attachMediaGateCookie: true };

	function headersFor(config: Partial<Config>, url: string, options: DownloadUrlOptions): Record<string, string> {
		const service = new DownloadService(config as Config, {} as any, { getLogger: () => ({}) } as any);
		return (service as any).getMediaGateHeaders(new URL(url), options);
	}

	test('指定されたときだけ、自分のホストへの取得にサーバー用の短い期限の Cookie を付ける', () => {
		const headers = headersFor({ url: 'https://example.com', mediaGate }, 'https://example.com/media/a.png', attach);
		const token = headers.Cookie.slice(`${mediaGate.cookieName}=`.length);
		const verified = verifyMediaGateToken(mediaGate.secret, token, nowUnixSec());
		expect(verified?.subject).toBe(MEDIA_GATE_SERVER_SUBJECT);
		expect(verified!.exp - nowUnixSec()).toBeLessThanOrEqual(300);
	});

	test('指定しなければ、自分のホストへの取得でも付けない (drive/files/upload-from-url や ActivityPub 由来の取得)', () => {
		expect(headersFor({ url: 'https://example.com', mediaGate }, 'https://example.com/media/a.png', {})).toEqual({});
		expect(headersFor({ url: 'https://example.com', mediaGate }, 'https://example.com/media/a.png', { attachMediaGateCookie: false })).toEqual({});
	});

	test('指定しても、他のホストや mediaGate が無効なときは付けない', () => {
		expect(headersFor({ url: 'https://example.com', mediaGate }, 'https://other.example/media/a.png', attach)).toEqual({});
		expect(headersFor({ url: 'https://example.com', mediaGate }, 'http://example.com/media/a.png', attach)).toEqual({});
		expect(headersFor({ url: 'https://example.com', mediaGate: undefined }, 'https://example.com/media/a.png', attach)).toEqual({});
	});

	test('downloadUrl は options をそのまま getMediaGateHeaders に渡す', async () => {
		const service = new DownloadService({ url: 'https://example.com', mediaGate } as Config, {} as any, { getLogger: () => ({ info: () => {} }) } as any);
		const seen: DownloadUrlOptions[] = [];
		// @bindThis のメソッドはプロトタイプの getter なので、インスタンスに直接定義して差し替える
		Object.defineProperty(service, 'getMediaGateHeaders', {
			value: (_url: URL, options: DownloadUrlOptions) => {
				seen.push(options);
				// 実際の通信をさせないよう、ここで止める
				throw new Error('stop');
			},
		});
		await expect(service.downloadUrl('https://example.com/media/a.png', '/dev/null')).rejects.toThrow('stop');
		await expect(service.downloadUrl('https://example.com/media/a.png', '/dev/null', attach)).rejects.toThrow('stop');
		await expect(service.downloadTextFile('https://example.com/media/a.txt', attach)).rejects.toThrow('stop');
		expect(seen).toEqual([{}, attach, attach]);
	});
});

describe('FileServerProxyHandler が自分のホストのメディアを取得するとき', () => {
	test('/files/* 以外の URL は、メディア用 Cookie を付けて取得する', async () => {
		const calls: [string, DownloadUrlOptions | undefined][] = [];
		const resolver = {
			downloadAndDetectTypeFromUrl: async (url: string, options?: DownloadUrlOptions) => {
				calls.push([url, options]);
				return { kind: 'not-found' };
			},
		};
		const handler = new FileServerProxyHandler({ url: 'https://example.com' } as Config, resolver as any, '', {} as any);
		await (handler as any).getStreamAndTypeFromUrl('https://example.com/media/files/a.webp');
		expect(calls).toEqual([['https://example.com/media/files/a.webp', { attachMediaGateCookie: true }]]);
	});

	test('リモートのリンクファイル (ActivityPub 由来) の取得には付けない', async () => {
		const calls: [string, DownloadUrlOptions | undefined][] = [];
		const downloadService = {
			downloadUrl: async (url: string, _path: string, options?: DownloadUrlOptions) => {
				calls.push([url, options]);
				throw new Error('stop');
			},
		};
		const file = { accessKey: 'key', thumbnailAccessKey: null, webpublicAccessKey: null, storedInternal: false, isLink: true, uri: 'https://example.com/media/remote.png' };
		const driveFilesRepository = {
			createQueryBuilder: () => {
				const qb = { where: () => qb, orWhere: () => qb, getOne: async () => file };
				return qb;
			},
		};
		const resolver = new FileServerFileResolver(driveFilesRepository as any, {} as any, downloadService as any, {} as any);
		await expect(resolver.resolveFileByAccessKey('key')).rejects.toThrow('stop');
		expect(calls).toHaveLength(1);
		expect(calls[0][1]?.attachMediaGateCookie).not.toBe(true);
	});
});
