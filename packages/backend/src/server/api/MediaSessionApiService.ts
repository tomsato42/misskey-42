/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { Config, MediaGateConfig } from '@/config.js';
import { getIpHash } from '@/misc/get-ip-hash.js';
import { isNativeUserToken } from '@/misc/token.js';
import { bindThis } from '@/decorators.js';
import {
	buildMediaGateCookie,
	buildMediaGateCookieClear,
	issueMediaGateToken,
	nowUnixSec,
} from '@/core/media-gate/media-gate.js';
import { AuthenticateService, AuthenticationError } from './AuthenticateService.js';
import { RateLimiterService } from './RateLimiterService.js';
import type { IEndpointMeta } from './endpoints.js';
import type { FastifyReply, FastifyRequest } from 'fastify';

type Limit = IEndpointMeta['limit'] & { key: string };

// フロントエンドは起動時やアカウント切り替え時に呼ぶ。学内からのアクセスは 1 つのグローバル IP にまとまることが多いため、上限は緩めにする
const issueLimit: Limit = { key: 'media-session', duration: 1000 * 60 * 10, max: 600 };

// ApiCallService のレート制限エラーと同じ識別子を使う
const rateLimitExceededError = {
	message: 'Rate limit exceeded. Please try again later.',
	code: 'RATE_LIMIT_EXCEEDED',
	id: 'd5826d14-3982-4d2e-8011-b9e9f02499ef',
};

const forbiddenOriginError = {
	message: 'Cross-origin requests are not allowed.',
	code: 'FORBIDDEN_ORIGIN',
	id: 'a7f0a5c4-3c3c-4b8e-9d0f-6c2f1b7e9d41',
};

const authenticationFailedError = {
	message: 'Authentication failed. Please ensure your token is correct.',
	code: 'AUTHENTICATION_FAILED',
	id: 'b0a7f5f8-dc2f-4171-b91f-de88ad238e14',
};

/**
 * 画像・添付ファイルを見るための Cookie (mediaGate) を発行・削除する HTTP ハンドラ。
 * config.mediaGate があるときだけ ApiServerService から登録される
 */
@Injectable()
export class MediaSessionApiService {
	constructor(
		@Inject(DI.config)
		private config: Config,

		private authenticateService: AuthenticateService,
		private rateLimiterService: RateLimiterService,
	) {
	}

	private get mediaGate(): MediaGateConfig {
		if (this.config.mediaGate == null) throw new Error('mediaGate is not configured');
		return this.config.mediaGate;
	}

	private isSecureCookie(): boolean {
		return this.config.url.startsWith('https://');
	}

	/**
	 * 他のサイトから Cookie を設定・削除させないよう、同じオリジンからのリクエストだけを受け付ける
	 */
	@bindThis
	private isSameOriginRequest(request: FastifyRequest): boolean {
		const origin = request.headers.origin;
		if (origin != null && origin !== this.config.url) return false;
		const fetchSite = request.headers['sec-fetch-site'];
		if (fetchSite != null && fetchSite !== 'same-origin' && fetchSite !== 'none') return false;
		return true;
	}

	/**
	 * POST /api/media-session
	 */
	@bindThis
	public async issue(request: FastifyRequest<{ Body: { i?: unknown } | undefined }>, reply: FastifyReply) {
		if (!this.isSameOriginRequest(request)) {
			reply.code(403);
			return { error: forbiddenOriginError };
		}

		if (this.config.enableIpRateLimit && await this.rateLimiterService.limit(issueLimit, getIpHash(request.ip)) != null) {
			reply.code(429);
			return { error: rateLimitExceededError };
		}

		// ブラウザのフロントエンドだけが使うので、ネイティブのトークン (アプリのアクセストークンではないもの) だけを受け付ける
		const token = request.body?.i;
		if (typeof token !== 'string' || !isNativeUserToken(token)) {
			reply.code(401);
			return { error: authenticationFailedError };
		}

		const [user] = await this.authenticateService.authenticate(token).catch(err => {
			if (err instanceof AuthenticationError) return [null] as const;
			throw err;
		});
		if (user == null || user.isSuspended || user.isDeleted) {
			reply.code(401);
			return { error: authenticationFailedError };
		}

		const { token: mediaToken, exp } = issueMediaGateToken(this.mediaGate, user.id, nowUnixSec());
		reply.header('Set-Cookie', buildMediaGateCookie(this.mediaGate.cookieName, mediaToken, this.mediaGate.ttlSec, this.isSecureCookie()));
		return { expiresAt: exp * 1000 };
	}

	/**
	 * POST /api/media-session/clear
	 */
	@bindThis
	public async clear(request: FastifyRequest, reply: FastifyReply) {
		if (!this.isSameOriginRequest(request)) {
			reply.code(403);
			return { error: forbiddenOriginError };
		}

		reply.header('Set-Cookie', buildMediaGateCookieClear(this.mediaGate.cookieName, this.isSecureCookie()));
		reply.code(204);
		return reply.send();
	}
}
