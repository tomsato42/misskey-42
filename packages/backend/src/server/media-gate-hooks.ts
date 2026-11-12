/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { IsNull } from 'typeorm';
import type { MediaGateConfig } from '@/config.js';
import type { CacheService } from '@/core/CacheService.js';
import { getCookieValue } from '@/core/intra/intra-auth.js';
import { MEDIA_GATE_SERVER_SUBJECT, nowUnixSec, toPrivateCacheControl, verifyMediaGateToken } from '@/core/media-gate/media-gate.js';
import type { UsersRepository } from '@/models/_.js';
import type { MiLocalUser } from '@/models/User.js';
import type { FastifyInstance, onRequestAsyncHookHandler, onSendHookHandler } from 'fastify';

/**
 * Cookie の subject のユーザーが、メディアを見てよい状態 (存在し、凍結・削除されていない) か
 */
export type MediaGateUserChecker = (userId: string) => Promise<boolean>;

/**
 * CacheService のローカルユーザーのキャッシュを使う MediaGateUserChecker を作る。
 * このキャッシュは凍結・凍結解除・削除のときに内部イベントで更新されるので、リクエストごとに DB を引かずに最新の状態を見られる
 */
export function createMediaGateUserChecker(cacheService: CacheService, usersRepository: UsersRepository): MediaGateUserChecker {
	return async (userId) => {
		const user = await cacheService.localUserByIdCache.fetchMaybe(userId,
			async () => (await usersRepository.findOneBy({ id: userId, host: IsNull() }) as MiLocalUser | null) ?? undefined);
		return user != null && !user.isSuspended && !user.isDeleted;
	};
}

/**
 * リクエストの Cookie に、有効なメディア用トークンが入っているか。
 * 署名と期限に加えて、subject がユーザー ID ならそのユーザーが凍結・削除されていないことも確かめる
 */
export async function hasValidMediaGateCookie(config: MediaGateConfig, cookieHeader: string | string[] | undefined, isActiveUser: MediaGateUserChecker): Promise<boolean> {
	const token = getCookieValue(cookieHeader, config.cookieName);
	const verified = verifyMediaGateToken(config.secret, token, nowUnixSec());
	if (verified == null) return false;
	if (verified.subject === MEDIA_GATE_SERVER_SUBJECT) return true;
	return await isActiveUser(verified.subject);
}

/**
 * メディア用 Cookie を検証するフック。
 * Cookie が無効なら 401 を返し、通ったレスポンスは Cache-Control を private にして Cloudflare などに共有キャッシュさせない
 */
export function createMediaGateHooks(config: MediaGateConfig, isActiveUser: MediaGateUserChecker): { onRequest: onRequestAsyncHookHandler; onSend: onSendHookHandler } {
	return {
		onRequest: async (request, reply) => {
			if (await hasValidMediaGateCookie(config, request.headers.cookie, isActiveUser)) return;

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
export function mediaGateRouteOptions(config: MediaGateConfig | undefined, isActiveUser: MediaGateUserChecker): Partial<ReturnType<typeof createMediaGateHooks>> {
	return config != null ? createMediaGateHooks(config, isActiveUser) : {};
}

/**
 * fastify のプラグインのスコープにメディア用 Cookie の検証を加える。
 * フックはこの関数を呼んだプラグイン (fastify.register で登録したもの) の中のルートにだけ効く
 */
export function registerMediaGateHooks(fastify: FastifyInstance, config: MediaGateConfig, isActiveUser: MediaGateUserChecker): void {
	const hooks = createMediaGateHooks(config, isActiveUser);
	fastify.addHook('onRequest', hooks.onRequest);
	fastify.addHook('onSend', hooks.onSend);
}
