/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { MediaGateConfig } from '@/config.js';
import { getCookieValue } from '@/core/intra/intra-auth.js';
import { nowUnixSec, toPrivateCacheControl, verifyMediaGateToken } from '@/core/media-gate/media-gate.js';
import type { FastifyInstance, onRequestAsyncHookHandler, onSendHookHandler } from 'fastify';

/**
 * リクエストの Cookie に、有効なメディア用トークンが入っているか
 */
export function hasValidMediaGateCookie(config: MediaGateConfig, cookieHeader: string | string[] | undefined): boolean {
	const token = getCookieValue(cookieHeader, config.cookieName);
	return verifyMediaGateToken(config.secret, token, nowUnixSec()) != null;
}

/**
 * メディア用 Cookie を検証するフック。
 * Cookie が無効なら 401 を返し、通ったレスポンスは Cache-Control を private にして Cloudflare などに共有キャッシュさせない
 */
export function createMediaGateHooks(config: MediaGateConfig): { onRequest: onRequestAsyncHookHandler; onSend: onSendHookHandler } {
	return {
		onRequest: async (request, reply) => {
			if (hasValidMediaGateCookie(config, request.headers.cookie)) return;

			reply.code(401);
			reply.header('Cache-Control', 'no-store');
			reply.header('Content-Type', 'text/plain; charset=utf-8');
			reply.send('Unauthorized');
			return reply;
		},
		onSend: (request, reply, payload, done) => {
			reply.header('Cache-Control', toPrivateCacheControl(reply.getHeader('cache-control')));
			done(null, payload);
		},
	};
}

/**
 * ルートの定義に渡すオプション。mediaGate が無効なら空 (upstream と同じ挙動)
 */
export function mediaGateRouteOptions(config: MediaGateConfig | undefined): Partial<ReturnType<typeof createMediaGateHooks>> {
	return config != null ? createMediaGateHooks(config) : {};
}

/**
 * fastify のプラグインのスコープにメディア用 Cookie の検証を加える。
 * フックはこの関数を呼んだプラグイン (fastify.register で登録したもの) の中のルートにだけ効く
 */
export function registerMediaGateHooks(fastify: FastifyInstance, config: MediaGateConfig): void {
	const hooks = createMediaGateHooks(config);
	fastify.addHook('onRequest', hooks.onRequest);
	fastify.addHook('onSend', hooks.onSend);
}
