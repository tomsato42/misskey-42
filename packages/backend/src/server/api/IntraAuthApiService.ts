/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { getIpHash } from '@/misc/get-ip-hash.js';
import { bindThis } from '@/decorators.js';
import { IntraAuthService } from '@/core/intra/IntraAuthService.js';
import { buildIntraErrorUrl } from '@/core/intra/intra-auth.js';
import { RateLimiterService } from './RateLimiterService.js';
import { SigninService } from './SigninService.js';
import type { IEndpointMeta } from './endpoints.js';
import type { FastifyReply, FastifyRequest } from 'fastify';

type Limit = IEndpointMeta['limit'] & { key: string };

// 学内からのアクセスは 1 つのグローバル IP にまとまることが多いため、IP あたりの上限は緩めにする
const authorizeLimit: Limit = { key: 'intra-authorize', duration: 1000 * 60 * 10, max: 300 };
const callbackLimit: Limit = { key: 'intra-callback', duration: 1000 * 60 * 10, max: 300 };
const exchangeLimit: Limit = { key: 'intra-exchange', duration: 1000 * 60 * 10, max: 300 };

// ApiCallService のレート制限エラーと同じ識別子を使う
const rateLimitExceededError = {
	message: 'Rate limit exceeded. Please try again later.',
	code: 'RATE_LIMIT_EXCEEDED',
	id: 'd5826d14-3982-4d2e-8011-b9e9f02499ef',
};

/**
 * 42 intra の OAuth2 ログインの HTTP ハンドラ。config.intra があるときだけ ApiServerService から登録される
 */
@Injectable()
export class IntraAuthApiService {
	constructor(
		@Inject(DI.config)
		private config: Config,

		private intraAuthService: IntraAuthService,
		private rateLimiterService: RateLimiterService,
		private signinService: SigninService,
	) {
	}

	@bindThis
	private async isRateLimited(request: FastifyRequest, limit: Limit): Promise<boolean> {
		if (!this.config.enableIpRateLimit) return false;
		return await this.rateLimiterService.limit(limit, getIpHash(request.ip)) != null;
	}

	/**
	 * GET /api/intra/authorize
	 */
	@bindThis
	public async authorize(request: FastifyRequest, reply: FastifyReply) {
		if (await this.isRateLimited(request, authorizeLimit)) {
			reply.code(429);
			return { error: rateLimitExceededError };
		}

		const url = await this.intraAuthService.createAuthorizeUrl();
		return reply.redirect(url, 302);
	}

	/**
	 * GET /api/intra/callback?code&state
	 */
	@bindThis
	public async callback(request: FastifyRequest<{ Querystring: { code?: string; state?: string; } }>, reply: FastifyReply) {
		// ブラウザで開かれるページなので、拒否した場合もフロントエンドへリダイレクトする
		if (await this.isRateLimited(request, callbackLimit)) {
			return reply.redirect(buildIntraErrorUrl(this.config.url, 'intra_error'), 302);
		}

		const url = await this.intraAuthService.handleCallback(request.query.code, request.query.state);
		return reply.redirect(url, 302);
	}

	/**
	 * POST /api/intra/exchange
	 */
	@bindThis
	public async exchange(request: FastifyRequest<{ Body: { code?: string; } | undefined }>, reply: FastifyReply) {
		reply.header('Access-Control-Allow-Origin', this.config.url);
		reply.header('Access-Control-Allow-Credentials', 'true');

		if (await this.isRateLimited(request, exchangeLimit)) {
			reply.code(429);
			return { error: rateLimitExceededError };
		}

		const user = await this.intraAuthService.consumeLoginCode(request.body?.code);
		if (user == null) {
			reply.code(400);
			return {
				error: {
					message: 'Invalid or expired login code.',
					code: 'INVALID_INTRA_LOGIN_CODE',
					id: '0eaa8405-5151-496b-9b12-148cc4872353',
				},
			};
		}

		return this.signinService.signin(request, reply, user);
	}
}
