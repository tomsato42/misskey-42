/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// DB や Redis を使わず、依存をすべて差し替えて IntraAccountService の分岐を確認する

import { beforeEach, describe, expect, test } from 'vitest';
import { IntraAccountError, IntraAccountService } from '@/core/intra/IntraAccountService.js';
import { IntraAuthError } from '@/core/intra/IntraAuthService.js';
import type { IntraUser } from '@/core/intra/intra-user.js';
import type { Config } from '@/config.js';

const BASE_URL = 'https://example.com';
const CURSUS_42 = 21;

class FakeRedis {
	public store = new Map<string, string>();

	public async set(key: string, value: string) {
		this.store.set(key, value);
		return 'OK';
	}

	public async get(key: string) {
		return this.store.get(key) ?? null;
	}

	public async del(key: string) {
		return this.store.delete(key) ? 1 : 0;
	}

	public async getdel(key: string) {
		const value = this.store.get(key) ?? null;
		this.store.delete(key);
		return value;
	}
}

function createIntraUser(overrides: Partial<IntraUser> = {}): IntraUser {
	return {
		id: 1000,
		login: 'tomoki',
		pool_year: '2023',
		pool_month: 'july',
		'staff?': false,
		created_at: '2023-05-10T03:00:00.000Z',
		cursus_users: [
			{ cursus_id: CURSUS_42, level: 5.73, blackholed_at: '2025-03-01T00:00:00.000Z', begin_at: '2023-10-02T01:00:00.000Z', end_at: null },
		],
		campus: [{ id: 26, name: 'Tokyo' }],
		campus_users: [{ campus_id: 26, is_primary: true }],
		...overrides,
	};
}

type FakeUser = { id: string; username: string; name: string | null; host: null; isSuspended: boolean; isDeleted: boolean };

describe('IntraAccountService', () => {
	let redis: FakeRedis;
	let users: FakeUser[];
	let profileUpdates: { userId: string; set: Record<string, unknown> }[];
	let insertedKeys: Record<string, unknown>[];
	let intraUser: IntraUser | null;
	let intraApiFails: boolean;
	let linkedCalls: number[];
	let linkedError: Error | null;
	let signupError: Error | null;
	let verifyFails: boolean;
	let service: IntraAccountService;

	beforeEach(() => {
		redis = new FakeRedis();
		users = [];
		profileUpdates = [];
		insertedKeys = [];
		intraUser = createIntraUser();
		intraApiFails = false;
		linkedCalls = [];
		linkedError = null;
		signupError = null;
		verifyFails = false;

		const config = {
			url: BASE_URL,
			intra: { clientId: 'cid', clientSecret: 'csecret', cursusId: CURSUS_42, apiBaseUrl: 'https://api.intra.42.fr', levelBadgeUrl: null, coalitionIconUrl: null },
		} as Partial<Config>;

		const fakeUsersRepository = {
			findOneBy: async (where: { id: string }) => users.find(u => u.id === where.id) ?? null,
		};
		const fakeProfilesRepository = {
			update: async (where: { userId: string }, set: Record<string, unknown>) => {
				profileUpdates.push({ userId: where.userId, set });
			},
		};
		const fakeSecurityKeysRepository = {
			insert: async (row: Record<string, unknown>) => {
				insertedKeys.push(row);
			},
		};
		const fakeIntraApiService = {
			getUserByLogin: async (login: string) => {
				if (intraApiFails) throw new Error('500 Internal Server Error');
				return intraUser != null && intraUser.login === login ? structuredClone(intraUser) : null;
			},
		};
		const fakeIntraAuthService = {
			findOrCreateUser: async (u: IntraUser) => {
				linkedCalls.push(u.id);
				if (linkedError) throw linkedError;
				const user = { id: `linked${u.id}`, username: `${u.login}_2307`, name: null, host: null, isSuspended: false, isDeleted: false };
				users.push(user);
				return { user, created: true };
			},
		};
		const fakeSignupService = {
			signup: async (opts: { username: string }) => {
				if (signupError) throw signupError;
				const user = { id: `manual${users.length}`, username: opts.username, name: null, host: null, isSuspended: false, isDeleted: false };
				users.push(user);
				return { account: user, secret: 'secret' };
			},
		};
		const fakeWebAuthnService = {
			initiateRegistration: async (userId: string) => ({ challenge: `challenge-for-${userId}` }),
			verifyRegistration: async () => {
				if (verifyFails) throw new Error('verification failed');
				return {
					credentialID: 'cred1',
					credentialPublicKey: new Uint8Array([1, 2, 3]),
					counter: 0,
					credentialDeviceType: 'multiDevice',
					credentialBackedUp: true,
					transports: ['internal'],
				};
			},
		};
		const noop = () => {};
		const fakeLoggerService = {
			getLogger: () => ({ info: noop, warn: noop, error: noop, debug: noop }),
		};

		service = new IntraAccountService(
			config as Config,
			redis as any,
			fakeUsersRepository as any,
			fakeProfilesRepository as any,
			fakeSecurityKeysRepository as any,
			fakeIntraApiService as any,
			fakeIntraAuthService as any,
			fakeSignupService as any,
			fakeWebAuthnService as any,
			fakeLoggerService as any,
		);
	});

	async function reasonOf(promise: Promise<unknown>): Promise<string> {
		const err = await promise.then(() => null, e => e);
		expect(err).toBeInstanceOf(IntraAccountError);
		return (err as IntraAccountError).reason;
	}

	describe('findOrCreateAccount', () => {
		test('42 の API で在籍記録を確かめられたら、42 ID を結び付けたアカウントにする', async () => {
			const result = await service.findOrCreateAccount('tomoki', false);
			expect(result).toMatchObject({ created: true, linked: true, user: { username: 'tomoki_2307' } });
			expect(linkedCalls).toEqual([1000]);
		});

		test('確かめられなければ理由を返し、アカウントは作らない', async () => {
			expect(await reasonOf(service.findOrCreateAccount('nobody', false))).toBe('not_found');

			intraUser = createIntraUser({ cursus_users: [] });
			expect(await reasonOf(service.findOrCreateAccount('tomoki', false))).toBe('not_eligible');

			intraApiFails = true;
			expect(await reasonOf(service.findOrCreateAccount('tomoki', false))).toBe('intra_error');

			expect(users).toHaveLength(0);
		});

		test('手動で確かめたなら、在籍記録が無くても 42 のユーザーが取れれば結び付ける', async () => {
			intraUser = createIntraUser({ cursus_users: [] });
			const result = await service.findOrCreateAccount('tomoki', true);
			expect(result).toMatchObject({ created: true, linked: true });
		});

		test('手動で確かめたなら、42 のユーザーが取れなくても、結び付けずにパスキーでログインできるアカウントを作る', async () => {
			const notFound = await service.findOrCreateAccount('some-one', true);
			expect(notFound).toMatchObject({ created: true, linked: false, user: { username: 'some_one' } });
			expect(profileUpdates).toEqual([{ userId: notFound.user.id, set: { intraPasswordLoginAllowed: true } }]);

			intraApiFails = true;
			const failed = await service.findOrCreateAccount('tomoki', true);
			expect(failed).toMatchObject({ created: true, linked: false, user: { username: 'tomoki' } });
			expect(linkedCalls).toHaveLength(0);
		});

		test('ユーザー名の重複と凍結は理由を返す', async () => {
			signupError = new Error('DUPLICATED_USERNAME');
			expect(await reasonOf(service.findOrCreateAccount('nobody', true))).toBe('username_taken');

			linkedError = new IntraAuthError('suspended', 'suspended');
			expect(await reasonOf(service.findOrCreateAccount('tomoki', false))).toBe('suspended');
		});
	});

	describe('パスキーの登録リンク', () => {
		function tokenOf(url: string): string {
			const prefix = `${BASE_URL}/intra-passkey-setup/`;
			expect(url.startsWith(prefix)).toBe(true);
			return url.slice(prefix.length);
		}

		beforeEach(() => {
			users.push({ id: 'u1', username: 'tomoki_2307', name: null, host: null, isSuspended: false, isDeleted: false });
		});

		test('リンクからパスキーを登録してログインでき、リンクは使い捨て', async () => {
			const { url } = await service.issuePasskeySetup('u1');
			const token = tokenOf(url);

			const begun = await service.beginPasskeySetup(token);
			expect(begun).toEqual({ username: 'tomoki_2307', options: { challenge: 'challenge-for-u1' } });

			const user = await service.completePasskeySetup(token, 'My key', {} as any);
			expect(user?.id).toBe('u1');
			expect(insertedKeys).toHaveLength(1);
			expect(insertedKeys[0]).toMatchObject({ id: 'cred1', userId: 'u1', name: 'My key' });
			expect(profileUpdates).toEqual([{ userId: 'u1', set: { usePasswordLessLogin: true } }]);

			expect(await service.beginPasskeySetup(token)).toBeNull();
			expect(await service.completePasskeySetup(token, 'My key', {} as any)).toBeNull();
			expect(insertedKeys).toHaveLength(1);
		});

		test('パスキーの検証に失敗したら、リンクは消費しない', async () => {
			const token = tokenOf((await service.issuePasskeySetup('u1')).url);
			verifyFails = true;
			await expect(service.completePasskeySetup(token, 'My key', {} as any)).rejects.toThrow();
			expect(insertedKeys).toHaveLength(0);
			expect(await service.beginPasskeySetup(token)).not.toBeNull();
		});

		test('リンクを出し直すと、前のリンクは使えなくなる', async () => {
			const first = tokenOf((await service.issuePasskeySetup('u1')).url);
			const second = tokenOf((await service.issuePasskeySetup('u1')).url);
			expect(await service.beginPasskeySetup(first)).toBeNull();
			expect(await service.beginPasskeySetup(second)).not.toBeNull();
		});

		test('不正なリンクや凍結されたユーザーのリンクは null', async () => {
			expect(await service.beginPasskeySetup(undefined)).toBeNull();
			expect(await service.beginPasskeySetup('a'.repeat(43))).toBeNull();

			const token = tokenOf((await service.issuePasskeySetup('u1')).url);
			users[0].isSuspended = true;
			expect(await service.beginPasskeySetup(token)).toBeNull();
			expect(await service.completePasskeySetup(token, 'My key', {} as any)).toBeNull();
		});
	});
});
