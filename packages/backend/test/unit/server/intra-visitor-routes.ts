/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 42 intra 連携が有効なとき (学内SNSモード) に、API 以外のルートが未ログインの訪問者へ情報を出さないことを確かめる

import { resolve } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, test, vi } from 'vitest';
import Logger from '@/logger.js';
import { ClientServerService } from '@/server/web/ClientServerService.js';
import { NodeinfoServerService } from '@/server/NodeinfoServerService.js';
import { UrlPreviewService } from '@/server/web/UrlPreviewService.js';
import { AuthenticationError } from '@/server/api/AuthenticateService.js';

const intra = {
	clientId: 'id',
	clientSecret: 'secret',
	cursusId: 21,
	apiBaseUrl: 'https://api.intra.42.fr',
		levelBadgeUrl: null, coalitionIconUrl: null,
};

const apps: FastifyInstance[] = [];

afterEach(async () => {
	await Promise.all(apps.splice(0).map(app => app.close()));
});

function createRepository() {
	return {
		findOneBy: vi.fn().mockResolvedValue(null),
		findOne: vi.fn().mockResolvedValue(null),
		findOneByOrFail: vi.fn().mockRejectedValue(new Error('should not be called')),
	};
}

async function createClientServer(withIntra: boolean) {
	const config = {
		url: 'http://localhost:3000',
		host: 'localhost:3000',
		rootDir: resolve(import.meta.dirname, '../../../../..'),
		// vite の開発サーバーへのプロキシを登録しないようにする
		frontendEmbedManifestExists: true,
		intra: withIntra ? intra : undefined,
	};

	const repositories = {
		users: createRepository(),
		userProfiles: createRepository(),
		notes: createRepository(),
		galleryPosts: createRepository(),
		channels: createRepository(),
		clips: createRepository(),
		pages: createRepository(),
		flashs: createRepository(),
		reversiGames: createRepository(),
		announcements: createRepository(),
	};

	const htmlTemplateService = {
		getCommonData: vi.fn().mockResolvedValue({
			version: '0.0.0',
			config,
			langs: [],
			instanceName: 'Test Instance',
			icon: null,
			appleTouchIcon: null,
			themeColor: null,
			serverErrorImageUrl: '',
			infoImageUrl: '',
			notFoundImageUrl: '',
			instanceUrl: config.url,
			metaJson: '{}',
			now: 0,
			federationEnabled: false,
			frontendViteFiles: null,
			frontendBootloaderJs: null,
			frontendBootloaderCss: null,
			frontendEmbedViteFiles: null,
			frontendEmbedBootloaderJs: null,
			frontendEmbedBootloaderCss: null,
		}),
	};

	const service = new ClientServerService(
		config as never,
		{ name: 'Test Instance', ugcVisibilityForVisitor: 'all', manifestJsonOverride: '' } as never,
		repositories.users as never,
		repositories.userProfiles as never,
		repositories.notes as never,
		repositories.galleryPosts as never,
		repositories.channels as never,
		repositories.clips as never,
		repositories.pages as never,
		repositories.flashs as never,
		repositories.reversiGames as never,
		repositories.announcements as never,
		{} as never,
		{} as never,
		{} as never,
		{} as never,
		{} as never,
		{} as never,
		{} as never,
		{} as never,
		{} as never,
		{ handle: vi.fn() } as never,
		{} as never,
		htmlTemplateService as never,
		{ logger: new Logger('client') } as never,
	);

	const app = Fastify({ logger: false });
	apps.push(app);
	await app.register(service.createServer);
	await app.ready();

	return { app, repositories };
}

function expectNoRepositoryCalls(repositories: Record<string, ReturnType<typeof createRepository>>) {
	for (const [name, repository] of Object.entries(repositories)) {
		expect(repository.findOneBy, name).not.toHaveBeenCalled();
		expect(repository.findOne, name).not.toHaveBeenCalled();
	}
}

describe('ClientServerService 学内SNSモード', () => {
	test.each([
		'/@alice',
		'/@alice/notes',
		'/@alice/pages/page1',
		'/notes/9zzzzzzzzz',
		'/clips/9zzzzzzzzz',
		'/play/9zzzzzzzzz',
		'/gallery/9zzzzzzzzz',
		'/channels/9zzzzzzzzz',
		'/reversi/g/9zzzzzzzzz',
		'/announcements/9zzzzzzzzz',
		// 2次元コードの URL。ユーザー名へリダイレクトせず、フロントエンドでユーザーのページへ移る
		'/users/9zzzzzzzzz',
	])('%s はメタ情報を埋め込まず、通常の SPA の HTML を返す', async (path) => {
		const { app, repositories } = await createClientServer(true);

		const res = await app.inject({ method: 'GET', url: path, headers: { accept: 'text/html' } });

		expect(res.statusCode).toBe(200);
		expect(res.headers['content-type']).toContain('text/html');
		expect(res.body).toContain('Test Instance');
		expectNoRepositoryCalls(repositories);
	});

	test.each([
		'/@alice.rss',
		'/@alice.atom',
		'/@alice.json',
		'/embed/notes/9zzzzzzzzz',
		'/embed/user-timeline/9zzzzzzzzz',
		'/embed/clips/9zzzzzzzzz',
		'/embed/anything',
	])('%s は 404 にする', async (path) => {
		const { app, repositories } = await createClientServer(true);

		const res = await app.inject({ method: 'GET', url: path });

		expect(res.statusCode).toBe(404);
		expectNoRepositoryCalls(repositories);
	});

	test('埋め込みページを拒否するときは、iframe に入れられないようにするヘッダーを外さない', async () => {
		const { app } = await createClientServer(true);

		const res = await app.inject({ method: 'GET', url: '/embed/notes/9zzzzzzzzz' });

		expect(res.headers['x-frame-options']).toBe('DENY');
	});

	test('robots.txt はすべてのクロールを禁止する', async () => {
		const { app } = await createClientServer(true);

		const res = await app.inject({ method: 'GET', url: '/robots.txt' });

		expect(res.statusCode).toBe(200);
		expect(res.body).toBe('User-agent: *\nDisallow: /\n');
	});

	test('HTML に noindex のメタタグを入れる', async () => {
		const { app } = await createClientServer(true);

		const res = await app.inject({ method: 'GET', url: '/', headers: { accept: 'text/html' } });

		expect(res.body).toContain('<meta name="robots" content="noindex"');
	});

	test('manifest.json はインスタンス名だけを返す', async () => {
		const { app, repositories } = await createClientServer(true);

		const res = await app.inject({ method: 'GET', url: '/manifest.json' });

		expect(res.statusCode).toBe(200);
		expect(res.json()).toMatchObject({ name: 'Test Instance' });
		expectNoRepositoryCalls(repositories);
	});
});

describe('ClientServerService intra 連携が無効なとき', () => {
	test('/users/:id は upstream と同じくユーザーを探す', async () => {
		const { app, repositories } = await createClientServer(false);

		const res = await app.inject({ method: 'GET', url: '/users/9zzzzzzzzz' });

		expect(res.statusCode).toBe(404);
		expect(repositories.users.findOneBy).toHaveBeenCalled();
	});

	test('/@:user.rss は upstream と同じくユーザーを探す', async () => {
		const { app, repositories } = await createClientServer(false);

		await app.inject({ method: 'GET', url: '/@alice.rss' });

		expect(repositories.users.findOneBy).toHaveBeenCalled();
	});

	test('/notes/:id は upstream と同じくノートを探す', async () => {
		const { app, repositories } = await createClientServer(false);

		const res = await app.inject({ method: 'GET', url: '/notes/9zzzzzzzzz', headers: { accept: 'text/html' } });

		expect(res.statusCode).toBe(200);
		expect(repositories.notes.findOne).toHaveBeenCalled();
	});
});

describe('NodeinfoServerService', () => {
	async function createNodeinfoServer(withIntra: boolean) {
		const notesChart = { getChart: vi.fn().mockRejectedValue(new Error('should not be called')) };
		const usersChart = { getChart: vi.fn().mockRejectedValue(new Error('should not be called')) };
		const service = new NodeinfoServerService(
			{ url: 'http://localhost:3000', intra: withIntra ? intra : undefined } as never,
			{} as never,
			{} as never,
			notesChart as never,
			usersChart as never,
		);

		const app = Fastify({ logger: false });
		apps.push(app);
		await app.register(service.createServer);
		await app.ready();

		return { app, notesChart, usersChart };
	}

	test.each(['/nodeinfo/2.1', '/nodeinfo/2.0'])('学内SNSモードでは %s を 404 にし、統計を集計しない', async (path) => {
		const { app, notesChart, usersChart } = await createNodeinfoServer(true);

		const res = await app.inject({ method: 'GET', url: path });

		expect(res.statusCode).toBe(404);
		expect(notesChart.getChart).not.toHaveBeenCalled();
		expect(usersChart.getChart).not.toHaveBeenCalled();
	});

	test('intra 連携が無効なら upstream と同じく統計を集計する', async () => {
		const { app, notesChart } = await createNodeinfoServer(false);

		await app.inject({ method: 'GET', url: '/nodeinfo/2.1' });

		expect(notesChart.getChart).toHaveBeenCalled();
	});
});

describe('UrlPreviewService', () => {
	function createUrlPreviewService(withIntra: boolean) {
		(globalThis as { _SUMMALY_VERSION_?: string })._SUMMALY_VERSION_ ??= '0.0.0';

		const authenticateService = {
			authenticate: vi.fn(async (token: string | null) => {
				if (token === 'valid-token') return [{ id: 'user1', isSuspended: false }, null];
				if (token === 'suspended-token') return [{ id: 'user2', isSuspended: true }, null];
				throw new AuthenticationError('invalid token');
			}),
		};

		const service = new UrlPreviewService(
			{ url: 'http://localhost:3000', intra: withIntra ? intra : undefined } as never,
			// プレビューを無効にしておき、認証を通過したかどうかを 403 (URL_PREVIEW_DISABLED) で見分ける
			{ urlPreviewEnabled: false } as never,
			{} as never,
			{} as never,
			{ getLogger: () => new Logger('url-preview') } as never,
			authenticateService as never,
		);

		return { service, authenticateService };
	}

	async function request(service: UrlPreviewService, authorization?: string) {
		const app = Fastify({ logger: false });
		apps.push(app);
		app.get<{ Querystring: { url: string; lang: string; } }>('/url', (req, reply) => service.handle(req, reply));
		await app.ready();

		return await app.inject({
			method: 'GET',
			url: '/url?url=https%3A%2F%2Fexample.com%2F',
			headers: authorization ? { authorization } : {},
		});
	}

	test('学内SNSモードでは、トークンが無ければ外部の URL を取得せずに 401 を返す', async () => {
		const { service } = createUrlPreviewService(true);
		try {
			const res = await request(service);

			expect(res.statusCode).toBe(401);
			expect(res.json().error.code).toBe('CREDENTIAL_REQUIRED');
		} finally {
			service.dispose();
		}
	});

	test('学内SNSモードでは、無効なトークンや凍結されたユーザーも 401 にする', async () => {
		const { service } = createUrlPreviewService(true);
		try {
			expect((await request(service, 'Bearer wrong-token')).statusCode).toBe(401);
			expect((await request(service, 'Bearer suspended-token')).statusCode).toBe(401);
		} finally {
			service.dispose();
		}
	});

	test('学内SNSモードでも、ログインしたユーザーのトークンがあれば先へ進む', async () => {
		const { service, authenticateService } = createUrlPreviewService(true);
		try {
			const res = await request(service, 'Bearer valid-token');

			expect(authenticateService.authenticate).toHaveBeenCalledWith('valid-token');
			expect(res.statusCode).toBe(403);
			expect(res.json().error.code).toBe('URL_PREVIEW_DISABLED');
		} finally {
			service.dispose();
		}
	});

	test('intra 連携が無効なら、upstream と同じくトークンなしでも先へ進む', async () => {
		const { service, authenticateService } = createUrlPreviewService(false);
		try {
			const res = await request(service);

			expect(authenticateService.authenticate).not.toHaveBeenCalled();
			expect(res.statusCode).toBe(403);
		} finally {
			service.dispose();
		}
	});
});
