/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 42 API を使わず、HTTP を差し替えて /oauth/token の SECRET の切り替えを確認する

import { describe, expect, test } from 'vitest';
import { IntraApiService } from '@/core/intra/IntraApiService.js';
import { StatusError } from '@/misc/status-error.js';
import type { Config } from '@/config.js';
import type { HttpRequestService } from '@/core/HttpRequestService.js';
import type { LoggerService } from '@/core/LoggerService.js';

type Logged = { level: string; message: string };

function createService(secrets: { clientSecret: string; clientSecretNext: string | null }, accepted: Set<string>) {
	const sentSecrets: string[] = [];
	const logged: Logged[] = [];

	const config = {
		intra: { clientId: 'cid', ...secrets, cursusId: 21, apiBaseUrl: 'https://api.intra.42.fr', levelBadgeUrl: null, coalitionIconUrl: null },
	} as unknown as Config;

	const httpRequestService = {
		send: async (_url: string, args: { body: string }) => {
			const secret = new URLSearchParams(args.body).get('client_secret') ?? '';
			sentSecrets.push(secret);
			if (!accepted.has(secret)) throw new StatusError('401 Unauthorized', 401, 'Unauthorized');
			return { json: async () => ({ access_token: `token-${secret}`, token_type: 'bearer', expires_in: 7200 }) };
		},
	} as unknown as HttpRequestService;

	const logger = Object.fromEntries(['debug', 'info', 'succ', 'warn', 'error'].map(level => [level, (message: string) => logged.push({ level, message })]));
	const loggerService = { getLogger: () => logger } as unknown as LoggerService;

	const service = new IntraApiService(config, httpRequestService, loggerService);
	return { service, sentSecrets, logged };
}

describe('IntraApiService の SECRET の切り替え', () => {
	test('clientSecret が通れば clientSecretNext は使わない', async () => {
		const { service, sentSecrets, logged } = createService({ clientSecret: 'old', clientSecretNext: 'next' }, new Set(['old', 'next']));

		expect(await service.exchangeCode('code', 'https://example.com/cb')).toBe('token-old');
		expect(sentSecrets).toEqual(['old']);
		expect(logged.filter(l => l.level === 'warn' || l.level === 'error')).toEqual([]);
	});

	test('clientSecret が 401 なら clientSecretNext で取り直し、以後は clientSecretNext から使う', async () => {
		const { service, sentSecrets, logged } = createService({ clientSecret: 'old', clientSecretNext: 'next' }, new Set(['next']));

		expect(await service.exchangeCode('code', 'https://example.com/cb')).toBe('token-next');
		expect(await service.exchangeCode('code2', 'https://example.com/cb')).toBe('token-next');
		expect(sentSecrets).toEqual(['old', 'next', 'next']);
		expect(logged.filter(l => l.level === 'warn').map(l => l.message)).toEqual([
			expect.stringContaining('Switched to clientSecretNext'),
		]);
	});

	test('認可コードも同じものを送り直す', async () => {
		const bodies: string[] = [];
		const { service } = createService({ clientSecret: 'old', clientSecretNext: 'next' }, new Set(['next']));
		const send = (service as unknown as { httpRequestService: { send: (url: string, args: { body: string }) => Promise<unknown> } }).httpRequestService;
		const original = send.send;
		send.send = async (url, args) => {
			bodies.push(args.body);
			return await original(url, args);
		};

		await service.exchangeCode('the-code', 'https://example.com/cb');
		expect(bodies.map(b => new URLSearchParams(b).get('code'))).toEqual(['the-code', 'the-code']);
		expect(bodies.map(b => new URLSearchParams(b).get('grant_type'))).toEqual(['authorization_code', 'authorization_code']);
	});

	test('どちらも 401 なら StatusError を投げ、両方拒否されたことをログに出す', async () => {
		const { service, sentSecrets, logged } = createService({ clientSecret: 'old', clientSecretNext: 'next' }, new Set());

		await expect(service.exchangeCode('code', 'https://example.com/cb')).rejects.toBeInstanceOf(StatusError);
		expect(sentSecrets).toEqual(['old', 'next']);
		expect(logged.filter(l => l.level === 'error').map(l => l.message)).toEqual([
			expect.stringContaining('rejected both clientSecret and clientSecretNext'),
		]);
	});

	test('clientSecretNext が無ければ 1 回だけ試し、次の SECRET を入れるようログに出す', async () => {
		const { service, sentSecrets, logged } = createService({ clientSecret: 'old', clientSecretNext: null }, new Set());

		await expect(service.exchangeCode('code', 'https://example.com/cb')).rejects.toBeInstanceOf(StatusError);
		expect(sentSecrets).toEqual(['old']);
		expect(logged.filter(l => l.level === 'error').map(l => l.message)).toEqual([
			expect.stringContaining('set it as clientSecretNext'),
		]);
	});

	test('401 以外のエラーでは次の SECRET を試さない', async () => {
		const { service } = createService({ clientSecret: 'old', clientSecretNext: 'next' }, new Set(['next']));
		const http = (service as unknown as { httpRequestService: { send: () => Promise<unknown> } }).httpRequestService;
		let calls = 0;
		http.send = async () => {
			calls++;
			throw new StatusError('503 Service Unavailable', 503, 'Service Unavailable');
		};

		await expect(service.exchangeCode('code', 'https://example.com/cb')).rejects.toBeInstanceOf(StatusError);
		expect(calls).toBe(1);
	});
});
