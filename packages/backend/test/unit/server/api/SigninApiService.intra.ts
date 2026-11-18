/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 42 intra 連携でパスワードログインを制限したときに、制限対象かどうかが応答から区別できないことを確認する。
// DB を使わず、依存をすべて差し替えて SigninApiService を直接組み立てる

import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import bcrypt from 'bcryptjs';
import { SigninApiService } from '@/server/api/SigninApiService.js';
import type { Config } from '@/config.js';

const WRONG_PASSWORD_ERROR_ID = '932c904e-9460-45b7-9ce6-7ed33be7eb2c';
const PASSKEY_FAILED_ERROR_ID = '93b86c4b-72f9-40eb-9815-798928603d1e';

type FakeUser = { id: string; username: string; usernameLower: string; host: null; isSuspended: boolean; token: string; };
type FakeProfile = {
	userId: string;
	password: string | null;
	twoFactorEnabled: boolean;
	usePasswordLessLogin: boolean;
	intraPasswordLoginAllowed: boolean;
};

class FakeReply {
	public statusCode = 200;
	public code(status: number) {
		this.statusCode = status;
		return this;
	}
	public header() {
		return this;
	}
}

describe('SigninApiService (42 intra のパスワードログイン制限)', () => {
	let passwordHash: string;
	let user: FakeUser;
	let profile: FakeProfile;
	let securityKeyCount: number;
	let restricted: boolean;
	let passkeyAuthorized: boolean;
	let signins: { success: boolean }[];
	let signedIn: string[];
	let service: SigninApiService;

	beforeAll(async () => {
		passwordHash = await bcrypt.hash('correct-password', await bcrypt.genSalt(4));
	});

	beforeEach(() => {
		user = { id: 'u1', username: 'alice', usernameLower: 'alice', host: null, isSuspended: false, token: 'token' };
		profile = { userId: 'u1', password: passwordHash, twoFactorEnabled: false, usePasswordLessLogin: false, intraPasswordLoginAllowed: false };
		securityKeyCount = 0;
		restricted = false;
		passkeyAuthorized = false;
		signins = [];
		signedIn = [];

		const noop = () => {};
		service = new SigninApiService(
			{ url: 'https://example.com', enableIpRateLimit: false } as Config,
			{} as any,
			{ findOneBy: async () => user } as any,
			{ findOneByOrFail: async () => profile } as any,
			{ countBy: async () => securityKeyCount } as any,
			{ insert: async (row: { success: boolean }) => { signins.push(row); } } as any,
			{ getLogger: () => ({ info: noop, warn: noop, error: noop, debug: noop }) } as any,
			{ gen: () => 'id' } as any,
			{ limit: async () => null } as any,
			{
				signin: (_req: unknown, _reply: unknown, u: FakeUser) => {
					signedIn.push(u.id);
					return { finished: true, id: u.id, i: u.token };
				},
			} as any,
			{ twoFactorAuthenticate: async () => {} } as any,
			{
				verifyAuthentication: async () => passkeyAuthorized,
				initiateAuthentication: async () => ({ challenge: 'c' }),
			} as any,
			{} as any,
			{ isPasswordLoginRestricted: async () => restricted } as any,
		);
	});

	async function signin(body: Record<string, unknown>) {
		const reply = new FakeReply();
		const request = { body: { username: 'alice', ...body }, ip: '127.0.0.1', headers: {} };
		const res = await service.signin(request as any, reply as any);
		return { status: reply.statusCode, body: res as any };
	}

	test('パスワード未送信の段階では、制限対象でも通常と同じ応答を返す', async () => {
		const normal = await signin({});
		restricted = true;
		const limited = await signin({});
		expect(limited).toEqual(normal);
		expect(limited.body).toEqual({ finished: false, next: 'captcha' });
	});

	test('2 段階認証が有効なユーザーでも、パスワード未送信の段階の応答は同じ', async () => {
		profile.twoFactorEnabled = true;
		const normal = await signin({});
		restricted = true;
		expect(await signin({})).toEqual(normal);
	});

	test('制限対象は正しいパスワードでも「パスワードが違う」ときと同じ失敗になり、失敗が記録される', async () => {
		const wrong = await signin({ password: 'wrong-password' });
		expect(wrong).toEqual({ status: 403, body: { error: { id: WRONG_PASSWORD_ERROR_ID } } });

		restricted = true;
		const limited = await signin({ password: 'correct-password' });
		expect(limited).toEqual(wrong);
		expect(signins).toEqual([expect.objectContaining({ success: false }), expect.objectContaining({ success: false })]);
		expect(signedIn).toEqual([]);
	});

	test('制限対象でなければ正しいパスワードでログインできる', async () => {
		const res = await signin({ password: 'correct-password' });
		expect(res.body).toEqual({ finished: true, id: 'u1', i: 'token' });
	});

	test('パスワードを持たないユーザーは 500 にならず「パスワードが違う」になる', async () => {
		profile.password = null;
		expect(await signin({ password: 'anything' })).toEqual({ status: 403, body: { error: { id: WRONG_PASSWORD_ERROR_ID } } });

		restricted = true;
		expect(await signin({ password: 'anything' })).toEqual({ status: 403, body: { error: { id: WRONG_PASSWORD_ERROR_ID } } });
	});

	test('2 段階認証 (TOTP) のユーザーも、制限対象ならログインできない', async () => {
		profile.twoFactorEnabled = true;
		restricted = true;
		const res = await signin({ password: 'correct-password', token: '123456' });
		expect(res).toEqual({ status: 403, body: { error: { id: WRONG_PASSWORD_ERROR_ID } } });
		expect(signedIn).toEqual([]);
	});

	test('パスワードレスログインのユーザーは、制限対象ならパスキーが正しくても、パスキー失敗と同じ応答になる', async () => {
		profile.twoFactorEnabled = true;
		profile.usePasswordLessLogin = true;
		securityKeyCount = 1;

		// パスキーの認証要求までは通常と同じ
		const normalChallenge = await signin({ password: 'wrong-password' });
		restricted = true;
		expect(await signin({ password: 'wrong-password' })).toEqual(normalChallenge);
		expect(normalChallenge.body.next).toBe('passkey');

		restricted = false;
		passkeyAuthorized = false;
		const normalFailure = await signin({ password: 'wrong-password', credential: {} });
		expect(normalFailure).toEqual({ status: 403, body: { error: { id: PASSKEY_FAILED_ERROR_ID } } });

		restricted = true;
		passkeyAuthorized = true;
		expect(await signin({ password: 'wrong-password', credential: {} })).toEqual(normalFailure);
		expect(signedIn).toEqual([]);
	});
});
