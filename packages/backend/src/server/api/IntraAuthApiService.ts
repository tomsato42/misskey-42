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
import { IntraAccountService } from '@/core/intra/IntraAccountService.js';
import {
	INTRA_LOGIN_CODE_TTL_SEC,
	INTRA_LOGIN_COOKIE_NAME,
	INTRA_STATE_COOKIE_NAME,
	INTRA_STATE_TTL_SEC,
	buildIntraCookie,
	buildIntraCookieClear,
	buildIntraErrorUrl,
	buildIntraReauthResultUrl,
	getCookieValue,
	isSameIntraToken,
} from '@/core/intra/intra-auth.js';
import { RateLimiterService } from './RateLimiterService.js';
import { SigninService } from './SigninService.js';
import type { IEndpointMeta } from './endpoints.js';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';

type Limit = IEndpointMeta['limit'] & { key: string };

// 学内からのアクセスは 1 つのグローバル IP にまとまることが多いため、IP あたりの上限は緩めにする
const authorizeLimit: Limit = { key: 'intra-authorize', duration: 1000 * 60 * 10, max: 300 };
const callbackLimit: Limit = { key: 'intra-callback', duration: 1000 * 60 * 10, max: 300 };
const exchangeLimit: Limit = { key: 'intra-exchange', duration: 1000 * 60 * 10, max: 300 };
const passkeySetupLimit: Limit = { key: 'intra-passkey-setup', duration: 1000 * 60 * 10, max: 60 };

// ApiCallService のレート制限エラーと同じ識別子を使う
const rateLimitExceededError = {
	message: 'Rate limit exceeded. Please try again later.',
	code: 'RATE_LIMIT_EXCEEDED',
	id: 'd5826d14-3982-4d2e-8011-b9e9f02499ef',
};

const invalidPasskeySetupTokenError = {
	message: 'Invalid or expired passkey setup link.',
	code: 'INVALID_PASSKEY_SETUP_TOKEN',
	id: '5b1d7d8e-0e57-4b8e-9d6c-6a1f7f0c2d41',
};

const passkeyVerificationFailedError = {
	message: 'Failed to verify the passkey.',
	code: 'PASSKEY_VERIFICATION_FAILED',
	id: 'a3c0f6b2-5d0e-4a64-9f59-2b6d8f1e7c90',
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
		private intraAccountService: IntraAccountService,
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
	 * GET /api/intra/authorize[?reauth=<チケット>][?ref=<ユーザー ID>]
	 * reauth は、ログイン中のユーザーが本人確認のために 42 でログインし直すときに i/intra/start-reauth で発行したチケット。
	 * ref は、2次元コードを読み込んで来た人のときの、コードを見せた人のユーザー ID (アカウントを作ったら、その人を通知で案内する)
	 */
	@bindThis
	public async authorize(request: FastifyRequest<{ Querystring: { reauth?: string; ref?: string; } }>, reply: FastifyReply) {
		if (await this.isRateLimited(request, authorizeLimit)) {
			reply.code(429);
			return { error: rateLimitExceededError };
		}

		const reauthTicket = request.query.reauth;
		const authorization = reauthTicket != null
			? await this.intraAuthService.createReauthAuthorizeUrl(reauthTicket)
			: await this.intraAuthService.createAuthorizeUrl(request.query.ref);
		if (authorization == null) {
			return reply.redirect(buildIntraReauthResultUrl(this.config.url, 'error'), 302);
		}

		const { url, state } = authorization;
		// @fastify/cookie は登録されていないため、既存箇所 (ClientServerService) と同様にヘッダーを直接設定する
		reply.header('Set-Cookie', buildIntraCookie(INTRA_STATE_COOKIE_NAME, state, INTRA_STATE_TTL_SEC, this.intraAuthService.isSecureCookie()));
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

		const secure = this.intraAuthService.isSecureCookie();
		const cookieState = getCookieValue(request.headers.cookie, INTRA_STATE_COOKIE_NAME);
		const { url, loginCode } = await this.intraAuthService.handleCallback(request.query.code, request.query.state, cookieState);

		// state は使い捨てなので、成否にかかわらず Cookie を消す
		const cookies = [buildIntraCookieClear(INTRA_STATE_COOKIE_NAME, secure)];
		if (loginCode != null) {
			cookies.push(buildIntraCookie(INTRA_LOGIN_COOKIE_NAME, loginCode, INTRA_LOGIN_CODE_TTL_SEC, secure));
		}
		reply.header('Set-Cookie', cookies);
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

		const code = request.body?.code;
		const cookieCode = getCookieValue(request.headers.cookie, INTRA_LOGIN_COOKIE_NAME);
		const user = await this.intraAuthService.consumeLoginCode(code, cookieCode);

		// Cookie と一致したコードは (ログインできたかにかかわらず) 使用済みなので、Cookie を消す。
		// 一致しない場合は、このブラウザで進行中の別のログインを妨げないよう Cookie を残す
		if (isSameIntraToken(code, cookieCode)) {
			reply.header('Set-Cookie', buildIntraCookieClear(INTRA_LOGIN_COOKIE_NAME, this.intraAuthService.isSecureCookie()));
		}

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

	/**
	 * POST /api/intra/passkey-setup/options
	 * 管理者が発行した登録リンクから、パスキーの登録を始める
	 */
	@bindThis
	public async passkeySetupOptions(request: FastifyRequest<{ Body: { token?: string; } | undefined }>, reply: FastifyReply) {
		if (await this.isRateLimited(request, passkeySetupLimit)) {
			reply.code(429);
			return { error: rateLimitExceededError };
		}

		const result = await this.intraAccountService.beginPasskeySetup(request.body?.token);
		if (result == null) {
			reply.code(400);
			return { error: invalidPasskeySetupTokenError };
		}
		return result;
	}

	/**
	 * POST /api/intra/passkey-setup/complete
	 * 管理者が発行した登録リンクからパスキーを登録し、ログインする
	 */
	@bindThis
	public async passkeySetupComplete(request: FastifyRequest<{ Body: { token?: string; name?: string; credential?: unknown; } | undefined }>, reply: FastifyReply) {
		if (await this.isRateLimited(request, passkeySetupLimit)) {
			reply.code(429);
			return { error: rateLimitExceededError };
		}

		const name = request.body?.name;
		const credential = request.body?.credential;
		if (typeof name !== 'string' || name.length < 1 || name.length > 30 || credential == null || typeof credential !== 'object') {
			reply.code(400);
			return { error: invalidPasskeySetupTokenError };
		}

		let user;
		try {
			user = await this.intraAccountService.completePasskeySetup(request.body?.token, name, credential as RegistrationResponseJSON);
		} catch {
			// パスキーの検証に失敗した (別の端末で始めた登録、改ざんなど)
			reply.code(400);
			return { error: passkeyVerificationFailedError };
		}
		if (user == null) {
			reply.code(400);
			return { error: invalidPasskeySetupTokenError };
		}

		return this.signinService.signin(request, reply, user);
	}
}
