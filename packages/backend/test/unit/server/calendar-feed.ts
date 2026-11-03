/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// カレンダー配信 (iCalendar) の HTTP ハンドラと鍵の管理を、DB を差し替えて確かめる

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { CalendarFeedServerService } from '@/server/CalendarFeedServerService.js';
import {
	CalendarFeedService,
	generateCalendarFeedToken,
	isValidCalendarFeedToken,
} from '@/core/calendar/CalendarFeedService.js';
import type { Config } from '@/config.js';
import type { RateLimiterService } from '@/server/api/RateLimiterService.js';

const TOKEN = 'A'.repeat(20) + '-_' + 'b'.repeat(21);

describe('鍵の形', () => {
	test('32 バイトの乱数を base64url にした 43 文字で、毎回違う', () => {
		const a = generateCalendarFeedToken();
		const b = generateCalendarFeedToken();
		expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(a).not.toBe(b);
		expect(isValidCalendarFeedToken(a)).toBe(true);
	});

	test('形の違う鍵は弾く', () => {
		expect(isValidCalendarFeedToken(TOKEN)).toBe(true);
		expect(isValidCalendarFeedToken('')).toBe(false);
		expect(isValidCalendarFeedToken('A'.repeat(42))).toBe(false);
		expect(isValidCalendarFeedToken('A'.repeat(44))).toBe(false);
		expect(isValidCalendarFeedToken('A'.repeat(42) + '=')).toBe(false);
		expect(isValidCalendarFeedToken('A'.repeat(42) + '/')).toBe(false);
	});
});

describe('CalendarFeedService の鍵の管理', () => {
	let profile: { userId: string; calendarFeedToken: string | null };
	let service: CalendarFeedService;
	let cacheDelete: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		profile = { userId: 'alice', calendarFeedToken: null };
		cacheDelete = vi.fn(async () => {});
		const userProfilesRepository = {
			findOne: async () => ({ ...profile }),
			findOneOrFail: async () => ({ ...profile }),
			update: async (criteria: { userId: string; calendarFeedToken?: unknown }, values: { calendarFeedToken: string }) => {
				// IsNull() を渡したときは、鍵が無いときだけ更新する
				if ('calendarFeedToken' in criteria && profile.calendarFeedToken != null) return { affected: 0 };
				profile.calendarFeedToken = values.calendarFeedToken;
				return { affected: 1 };
			},
		};
		service = new CalendarFeedService(
			{ url: 'https://42times.example.com', host: '42times.example.com' } as Config,
			{ name: '42times' } as never,
			userProfilesRepository as never,
			{} as never,
			{} as never,
			{ userProfileCache: { delete: cacheDelete } } as never,
			{} as never,
		);
	});

	test('URL は購読中とすべての 2 種類で、同じ鍵を使う', () => {
		expect(service.buildUrls(TOKEN)).toEqual({
			subscribedUrl: `https://42times.example.com/calendar/feed/subscribed/${TOKEN}.ics`,
			allUrl: `https://42times.example.com/calendar/feed/all/${TOKEN}.ics`,
		});
	});

	test('鍵が無ければ作って保存し、次からは同じ鍵を返す', async () => {
		const token = await service.getOrCreateToken('alice');
		expect(isValidCalendarFeedToken(token)).toBe(true);
		expect(profile.calendarFeedToken).toBe(token);
		expect(cacheDelete).toHaveBeenCalledWith('alice');

		expect(await service.getOrCreateToken('alice')).toBe(token);
	});

	test('作り直すと別の鍵になる', async () => {
		const first = await service.getOrCreateToken('alice');
		const second = await service.regenerateToken('alice');
		expect(second).not.toBe(first);
		expect(profile.calendarFeedToken).toBe(second);
	});
});

describe('CalendarFeedServerService', () => {
	let app: FastifyInstance;
	let findUserByToken: ReturnType<typeof vi.fn>;
	let buildFeed: ReturnType<typeof vi.fn>;
	let limit: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		findUserByToken = vi.fn(async (token: string) => token === TOKEN ? { id: 'alice' } : null);
		buildFeed = vi.fn(async () => 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
		limit = vi.fn(async () => null);

		const server = new CalendarFeedServerService(
			{ enableIpRateLimit: true } as Config,
			{ findUserByToken, buildFeed } as unknown as CalendarFeedService,
			{ limit } as unknown as RateLimiterService,
		);
		app = Fastify();
		app.register(server.createServer);
		await app.ready();
	});

	afterEach(async () => {
		await app.close();
	});

	test.each(['subscribed', 'all'] as const)('/calendar/feed/%s/<鍵>.ics で配信する', async (kind) => {
		const res = await app.inject({ method: 'GET', url: `/calendar/feed/${kind}/${TOKEN}.ics` });

		expect(res.statusCode).toBe(200);
		expect(res.headers['content-type']).toBe('text/calendar; charset=utf-8');
		expect(res.headers['cache-control']).toBe('private, max-age=300');
		expect(res.headers['content-disposition']).toBe('inline; filename="42times.ics"');
		expect(res.body).toBe('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
		expect(findUserByToken).toHaveBeenCalledWith(TOKEN);
		expect(buildFeed.mock.calls[0][0]).toEqual({ id: 'alice' });
		expect(buildFeed.mock.calls[0][1]).toBe(kind);
	});

	test('知らない鍵・.ics の無い URL・知らない種類は 404', async () => {
		for (const url of [
			`/calendar/feed/all/${'C'.repeat(43)}.ics`,
			`/calendar/feed/all/${TOKEN}`,
			`/calendar/feed/all/${TOKEN}.ical`,
			`/calendar/feed/mine/${TOKEN}.ics`,
		]) {
			const res = await app.inject({ method: 'GET', url });
			expect(res.statusCode, url).toBe(404);
		}
		expect(buildFeed).not.toHaveBeenCalled();
	});

	test('IP ごとのレート制限を超えると 429', async () => {
		limit.mockResolvedValueOnce({ code: 'RATE_LIMIT_EXCEEDED', info: {} });
		const res = await app.inject({ method: 'GET', url: `/calendar/feed/all/${TOKEN}.ics` });
		expect(res.statusCode).toBe(429);
		expect(limit.mock.calls[0][0]).toMatchObject({ key: 'calendar-feed' });
		expect(findUserByToken).not.toHaveBeenCalled();
	});

	test('1 つの鍵を何度も取りに来ると 429', async () => {
		limit.mockResolvedValueOnce(null).mockResolvedValueOnce({ code: 'RATE_LIMIT_EXCEEDED', info: {} });
		const res = await app.inject({ method: 'GET', url: `/calendar/feed/all/${TOKEN}.ics` });
		expect(res.statusCode).toBe(429);
		expect(limit.mock.calls[1]).toEqual([expect.objectContaining({ key: 'calendar-feed-user' }), 'alice']);
		expect(buildFeed).not.toHaveBeenCalled();
	});
});
