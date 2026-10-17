/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import { ApiCallService } from '@/server/api/ApiCallService.js';
import Logger from '@/logger.js';
import { envOption } from '@/env.js';
import { logManager } from '@/logging/logging-runtime.js';
import { PrettyConsoleBackend } from '@/logging/PrettyConsoleBackend.js';
import type { LogBackend } from '@/logging/LogBackend.js';
import type { LogRecord } from '@/logging/types.js';

/** API失敗ログを確認するための最小Fastify応答を作成します。 */
function createReply() {
	return {
		code: vi.fn(),
		header: vi.fn(),
		send: vi.fn(),
	};
}

/** APIサービスの依存関係を最小限の仮実装へ差し替えます。 */
function createService(config: object = {}, authenticated: [unknown, unknown] = [null, null]) {
	const authenticateService = {
		authenticate: vi.fn().mockResolvedValue(authenticated),
	};
	const telemetryService = {
		startSpan: vi.fn((_name: string, callback: () => unknown) => callback()),
		captureMessage: vi.fn(),
	};
	const apiLoggerService = { logger: new Logger('api') };

	const service = new ApiCallService(
		{} as never,
		config as never,
		{} as never,
		authenticateService as never,
		{} as never,
		{} as never,
		apiLoggerService as never,
		telemetryService as never,
	);
	return { service, telemetryService };
}

describe('ApiCallService structured error logging', () => {
	test('redacts API credentials and serializes the endpoint error', async () => {
		const write = vi.fn<LogBackend['write']>();
		logManager.setBackend({ write });
		const previousQuiet = envOption.quiet;
		envOption.quiet = false;
		const { service, telemetryService } = createService();
		try {
			const reply = createReply();
			const endpoint = {
				name: 'notes/show',
				meta: {},
				params: {},
				exec: vi.fn().mockRejectedValue(new TypeError('broken endpoint')),
			};
			const request = {
				method: 'POST',
				body: {
					i: 'native-token',
					password: 'password',
					options: { visible: true },
				},
				query: {},
				headers: {},
				ip: '127.0.0.1',
			};

			await service.handleRequest(endpoint as never, request as never, reply as never);

			const record = write.mock.calls[0][0] as LogRecord;
			expect(record).toMatchObject({
				eventName: 'api.endpoint.failed',
				attributes: {
					'api.endpoint': 'notes/show',
					'api.params': {
						i: '[REDACTED]',
						password: '[REDACTED]',
						options: { visible: true },
					},
				},
				error: { type: 'TypeError', message: 'broken endpoint' },
			});
			expect(record.attributes?.['error.id']).toEqual(expect.any(String));
			expect(telemetryService.captureMessage.mock.calls[0][1].extra).not.toHaveProperty('ps');
		} finally {
			service.dispose();
			envOption.quiet = previousQuiet;
			logManager.setBackend(new PrettyConsoleBackend({ output: () => undefined }));
		}
	});
});

describe('ApiCallService 学内SNSモードの未ログイン制限', () => {
	const intraConfig = {
		intra: {
			clientId: 'id',
			clientSecret: 'secret',
			cursusId: 21,
			apiBaseUrl: 'https://api.intra.42.fr',
		},
	};

	/** 指定した名前のエンドポイントへ POST リクエストを送ります。 */
	async function callEndpoint(config: object, name: string, authenticated: [unknown, unknown] = [null, null]) {
		const { service } = createService(config, authenticated);
		try {
			const reply = createReply();
			const endpoint = {
				name,
				meta: {},
				params: {},
				exec: vi.fn().mockResolvedValue({ ok: true }),
			};
			const request = {
				method: 'POST',
				body: {},
				query: {},
				headers: {},
				ip: '127.0.0.1',
			};

			await service.handleRequest(endpoint as never, request as never, reply as never);
			return { reply, endpoint };
		} finally {
			service.dispose();
		}
	}

	test('許可リストに無いエンドポイントは、requireCredential と同じ 401 で拒否する', async () => {
		const { reply, endpoint } = await callEndpoint(intraConfig, 'notes/local-timeline');

		expect(endpoint.exec).not.toHaveBeenCalled();
		expect(reply.code).toHaveBeenCalledWith(401);
		expect(reply.header).toHaveBeenCalledWith('WWW-Authenticate', 'Bearer realm="Misskey"');
		expect(reply.send).toHaveBeenCalledWith({
			error: expect.objectContaining({
				code: 'CREDENTIAL_REQUIRED',
				id: '1384574d-a912-4b81-8601-c7b1c4085df1',
			}),
		});
	});

	test('許可リストにあるエンドポイント (meta) は、トークンなしでも呼び出せる', async () => {
		const { reply, endpoint } = await callEndpoint(intraConfig, 'meta');

		expect(endpoint.exec).toHaveBeenCalled();
		expect(reply.code).not.toHaveBeenCalledWith(401);
		expect(reply.send).toHaveBeenCalledWith({ ok: true });
	});

	test('ログインしていれば、許可リストに無いエンドポイントも呼び出せる', async () => {
		const user = { id: 'user1', isSuspended: false };
		const { reply, endpoint } = await callEndpoint(intraConfig, 'notes/local-timeline', [user, null]);

		expect(endpoint.exec).toHaveBeenCalled();
		expect(reply.send).toHaveBeenCalledWith({ ok: true });
	});

	test('intra 連携が無効なら、upstream と同じくトークンなしでも呼び出せる', async () => {
		const { reply, endpoint } = await callEndpoint({}, 'notes/local-timeline');

		expect(endpoint.exec).toHaveBeenCalled();
		expect(reply.send).toHaveBeenCalledWith({ ok: true });
	});
});
