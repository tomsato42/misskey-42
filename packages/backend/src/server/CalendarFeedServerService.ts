/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { getIpHash } from '@/misc/get-ip-hash.js';
import { bindThis } from '@/decorators.js';
import { CalendarFeedService } from '@/core/calendar/CalendarFeedService.js';
import type { CalendarFeedKind } from '@/core/calendar/CalendarFeedService.js';
import { RateLimiterService } from './api/RateLimiterService.js';
import type { IEndpointMeta } from './api/endpoints.js';
import type { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';

type Limit = IEndpointMeta['limit'] & { key: string };

// カレンダーアプリは 1 時間ごとなどに読み直す。Google カレンダーなどは少数のサーバーから全員分を取りに来るので、IP ごとの上限は緩めにする
const ipLimit: Limit = { key: 'calendar-feed', duration: 1000 * 60 * 10, max: 600 };

// 1 つの URL (ユーザー) を短い間隔で何度も取りに来るのを抑える
const userLimit: Limit = { key: 'calendar-feed-user', duration: 1000 * 60 * 10, max: 60 };

/** 末尾の .ics を除いた鍵を取り出す。鍵の形は CalendarFeedService で確かめる */
const FEED_FILE_PATTERN = /^(.+)\.ics$/;

/**
 * カレンダー配信 (iCalendar) の HTTP ハンドラ。
 * GET /calendar/feed/subscribed/<鍵>.ics と GET /calendar/feed/all/<鍵>.ics
 *
 * カレンダーアプリはログインできないので、URL に含めた鍵 (user_profile.calendarFeedToken) で認証する。
 * /api の外にあるので、学内SNSモードの未ログインの API の制限 (ApiCallService) は受けない
 */
@Injectable()
export class CalendarFeedServerService {
	constructor(
		@Inject(DI.config)
		private config: Config,

		private calendarFeedService: CalendarFeedService,
		private rateLimiterService: RateLimiterService,
	) {
	}

	@bindThis
	public createServer(fastify: FastifyInstance, options: FastifyPluginOptions, done: (err?: Error) => void) {
		for (const kind of ['subscribed', 'all'] as const satisfies CalendarFeedKind[]) {
			fastify.get<{ Params: { file: string } }>(`/calendar/feed/${kind}/:file`, (request, reply) => this.handle(kind, request, reply));
		}
		done();
	}

	@bindThis
	private async handle(kind: CalendarFeedKind, request: FastifyRequest<{ Params: { file: string } }>, reply: FastifyReply) {
		// 鍵の有無や誰の鍵かが分からないよう、失敗はすべて同じ 404 にする
		const notFound = () => {
			reply.code(404);
			reply.header('Cache-Control', 'private, no-store');
			return reply.send();
		};

		if (this.config.enableIpRateLimit && await this.rateLimiterService.limit(ipLimit, getIpHash(request.ip)) != null) {
			reply.code(429);
			reply.header('Retry-After', '600');
			return reply.send();
		}

		const match = FEED_FILE_PATTERN.exec(request.params.file);
		if (match == null) return notFound();

		const user = await this.calendarFeedService.findUserByToken(match[1]);
		if (user == null) return notFound();

		if (await this.rateLimiterService.limit(userLimit, user.id) != null) {
			reply.code(429);
			reply.header('Retry-After', '600');
			return reply.send();
		}

		const body = await this.calendarFeedService.buildFeed(user, kind, new Date());

		reply.header('Content-Type', 'text/calendar; charset=utf-8');
		// 鍵を含む URL の中身なので、Cloudflare などの共有キャッシュには置かせない
		reply.header('Cache-Control', 'private, max-age=300');
		reply.header('Content-Disposition', 'inline; filename="42times.ics"');
		reply.header('X-Content-Type-Options', 'nosniff');
		return reply.send(body);
	}
}
