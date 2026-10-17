/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// DB や Redis を使わず、依存をすべて差し替えて IntraAuthService の分岐を確認する

import { beforeEach, describe, expect, test } from 'vitest';
import { IntraAuthService } from '@/core/intra/IntraAuthService.js';
import type { IntraUser } from '@/core/intra/intra-user.js';
import type { Config } from '@/config.js';

const BASE_URL = 'https://example.com';
const CURSUS_42 = 21;

type FakeUser = { id: string; username: string; usernameLower: string; host: null; isSuspended: boolean; isDeleted: boolean; };
type FakeProfile = {
	userId: string;
	intraId: number | null;
	intraLogin: string | null;
	intraPoolYearMonth: string | null;
	intraBlackholedAt: Date | null;
	intraPaceDeadlineAt: Date | null;
	intraPasswordLoginAllowed: boolean;
};

class FakeRedis {
	public store = new Map<string, string>();

	public async set(key: string, value: string) {
		this.store.set(key, value);
		return 'OK';
	}

	public async getdel(key: string) {
		const value = this.store.get(key) ?? null;
		this.store.delete(key);
		return value;
	}
}

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
	return Object.entries(where).every(([k, v]) => {
		// typeorm の IsNull() は FindOperator なので、ここでは null 判定として扱う
		if (v != null && typeof v === 'object' && '_type' in v) return row[k] == null;
		return row[k] === v;
	});
}

class FakeRepository<T extends Record<string, any>> {
	constructor(public rows: T[]) {}

	public async findOneBy(where: Record<string, unknown>) {
		return this.rows.find(r => matches(r, where)) ?? null;
	}

	public async update(where: Record<string, unknown>, set: Partial<T>) {
		for (const row of this.rows) {
			if (matches(row, where)) Object.assign(row, set);
		}
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
			{ cursus_id: CURSUS_42, level: 5.73, blackholed_at: '2027-03-01T00:00:00.000Z', begin_at: '2023-10-02T01:00:00.000Z', end_at: null },
		],
		campus: [{ id: 26, name: 'Tokyo' }],
		campus_users: [{ campus_id: 26, is_primary: true }],
		...overrides,
	};
}

describe('IntraAuthService', () => {
	let redis: FakeRedis;
	let users: FakeRepository<FakeUser>;
	let profiles: FakeRepository<FakeProfile>;
	let intraUser: IntraUser;
	let intraApiFails: boolean;
	let moderators: Set<string>;
	let beforeSignup: (() => void) | null;
	let syncCalls: { userId: string; intraId: number }[];
	let syncFails: boolean;
	let meta: { rootUserId: string | null };
	let config: Partial<Config>;
	let service: IntraAuthService;

	function addUser(id: string, username: string, profile: Partial<FakeProfile> = {}, user: Partial<FakeUser> = {}) {
		users.rows.push({ id, username, usernameLower: username.toLowerCase(), host: null, isSuspended: false, isDeleted: false, ...user });
		profiles.rows.push({
			userId: id,
			intraId: null,
			intraLogin: null,
			intraPoolYearMonth: null,
			intraBlackholedAt: null,
			intraPaceDeadlineAt: null,
			intraPasswordLoginAllowed: false,
			...profile,
		});
	}

	const fakeSignupService = {
		signup: async (opts: { username: string; password: string | null; intraProfile: Partial<FakeProfile> }) => {
			beforeSignup?.();
			if (users.rows.some(u => u.usernameLower === opts.username.toLowerCase())) {
				throw new Error('DUPLICATED_USERNAME');
			}
			const id = `user${users.rows.length + 1}`;
			addUser(id, opts.username, opts.intraProfile);
			return { account: users.rows.find(u => u.id === id)!, secret: 'secret' };
		},
	};

	beforeEach(() => {
		redis = new FakeRedis();
		users = new FakeRepository<FakeUser>([]);
		profiles = new FakeRepository<FakeProfile>([]);
		intraUser = createIntraUser();
		intraApiFails = false;
		moderators = new Set();
		beforeSignup = null;
		syncCalls = [];
		syncFails = false;
		meta = { rootUserId: 'root' };
		config = {
			url: BASE_URL,
			intra: { clientId: 'cid', clientSecret: 'csecret', cursusId: CURSUS_42, apiBaseUrl: 'https://api.intra.42.fr' },
		};

		const fakeIntraApiService = {
			exchangeCode: async (code: string, redirectUri: string) => {
				if (intraApiFails) throw new Error('401 Unauthorized');
				expect(redirectUri).toBe(`${BASE_URL}/api/intra/callback`);
				return `token-for-${code}`;
			},
			getMe: async () => structuredClone(intraUser),
		};
		const fakeIntraSyncService = {
			syncUser: async (userId: string, intraUserArg: IntraUser) => {
				syncCalls.push({ userId, intraId: intraUserArg.id });
				if (syncFails) throw new Error('sync failed');
			},
		};
		const fakeRoleService = {
			isModerator: async (user: { id: string }) => moderators.has(user.id),
		};
		const noop = () => {};
		const fakeLoggerService = {
			getLogger: () => ({ info: noop, warn: noop, error: noop, debug: noop }),
		};

		service = new IntraAuthService(
			config as Config,
			meta as any,
			redis as any,
			users as any,
			profiles as any,
			fakeIntraApiService as any,
			fakeIntraSyncService as any,
			fakeSignupService as any,
			fakeRoleService as any,
			fakeLoggerService as any,
		);
	});

	async function authorizeAndGetState(): Promise<string> {
		const { state } = await service.createAuthorizeUrl();
		return state;
	}

	async function callbackUrl(code: unknown, state: unknown, cookieState: unknown): Promise<string> {
		return (await service.handleCallback(code, state, cookieState)).url;
	}

	function loginCodeOf(redirectUrl: string): string {
		const prefix = `${BASE_URL}/intra-complete/`;
		expect(redirectUrl.startsWith(prefix)).toBe(true);
		const code = redirectUrl.slice(prefix.length);
		expect(code).not.toMatch(/^error/);
		return code;
	}

	test('authorize URL に state を付け、Redis に保存する', async () => {
		const result = await service.createAuthorizeUrl();
		const url = new URL(result.url);
		expect(url.origin + url.pathname).toBe('https://api.intra.42.fr/oauth/authorize');
		expect(url.searchParams.get('client_id')).toBe('cid');
		const state = url.searchParams.get('state')!;
		expect(state).toBe(result.state);
		expect(redis.store.get(`intra:state:${state}`)).toBe('1');
		// client secret を URL に含めない
		expect(url.toString()).not.toContain('csecret');
	});

	test('新規ユーザーを作成し、使い捨てコードでログインできる', async () => {
		const state = await authorizeAndGetState();
		const redirect = await callbackUrl('authcode', state, state);
		const code = loginCodeOf(redirect);

		expect(users.rows).toHaveLength(1);
		expect(users.rows[0].username).toBe('tomoki_2307');
		expect(profiles.rows[0]).toMatchObject({
			intraId: 1000,
			intraLogin: 'tomoki',
			intraPoolYearMonth: '2307',
			intraBlackholedAt: new Date('2027-03-01T00:00:00.000Z'),
		});

		const user = await service.consumeLoginCode(code, code);
		expect(user?.id).toBe(users.rows[0].id);
		// 使い捨て
		expect(await service.consumeLoginCode(code, code)).toBeNull();
	});

	test('state は使い捨て', async () => {
		const state = await authorizeAndGetState();
		await callbackUrl('authcode', state, state);
		expect(await callbackUrl('authcode', state, state)).toBe(`${BASE_URL}/intra-complete/error?reason=invalid_state`);
	});

	test('不正な state は拒否する', async () => {
		expect(await callbackUrl('authcode', undefined, undefined)).toBe(`${BASE_URL}/intra-complete/error?reason=invalid_state`);
		expect(await callbackUrl('authcode', 'a'.repeat(43), 'a'.repeat(43))).toBe(`${BASE_URL}/intra-complete/error?reason=invalid_state`);
		expect(users.rows).toHaveLength(0);
	});

	test('Cookie の state と一致しなければ invalid_state (login CSRF 対策)', async () => {
		// 攻撃者が発行した state を、被害者のブラウザ (別の state の Cookie を持つ、または Cookie が無い) で使う状況
		const attackerState = await authorizeAndGetState();
		const victimState = await authorizeAndGetState();
		expect(await callbackUrl('authcode', attackerState, victimState)).toBe(`${BASE_URL}/intra-complete/error?reason=invalid_state`);
		expect(await callbackUrl('authcode', attackerState, null)).toBe(`${BASE_URL}/intra-complete/error?reason=invalid_state`);
		expect(await callbackUrl('authcode', attackerState, '')).toBe(`${BASE_URL}/intra-complete/error?reason=invalid_state`);
		expect(users.rows).toHaveLength(0);
	});

	test('isSecureCookie は config.url が https のときだけ true', () => {
		expect(service.isSecureCookie()).toBe(true);
		config.url = 'http://localhost:3000';
		expect(service.isSecureCookie()).toBe(false);
	});

	test('code が無い場合は intra_error', async () => {
		const state = await authorizeAndGetState();
		expect(await callbackUrl(undefined, state, state)).toBe(`${BASE_URL}/intra-complete/error?reason=intra_error`);
	});

	test('42 API の失敗は intra_error', async () => {
		intraApiFails = true;
		const state = await authorizeAndGetState();
		expect(await callbackUrl('authcode', state, state)).toBe(`${BASE_URL}/intra-complete/error?reason=intra_error`);
	});

	test('初期セットアップ前は intra でログインさせない', async () => {
		meta.rootUserId = null;
		const state = await authorizeAndGetState();
		expect(await callbackUrl('authcode', state, state)).toBe(`${BASE_URL}/intra-complete/error?reason=intra_error`);
		expect(users.rows).toHaveLength(0);
	});

	test('対象 cursus に在籍していなければ not_eligible', async () => {
		intraUser = createIntraUser({ cursus_users: [] });
		const state = await authorizeAndGetState();
		expect(await callbackUrl('authcode', state, state)).toBe(`${BASE_URL}/intra-complete/error?reason=not_eligible`);
		expect(users.rows).toHaveLength(0);
	});

	test('既存ユーザーは intra 系の列を更新してログインする', async () => {
		addUser('existing', 'tomoki_2307', { intraId: 1000, intraLogin: 'old', intraBlackholedAt: null });
		const state = await authorizeAndGetState();
		const code = loginCodeOf(await callbackUrl('authcode', state, state));

		expect(users.rows).toHaveLength(1);
		expect(profiles.rows[0]).toMatchObject({
			intraLogin: 'tomoki',
			intraPoolYearMonth: '2307',
			intraBlackholedAt: new Date('2027-03-01T00:00:00.000Z'),
		});
		expect((await service.consumeLoginCode(code, code))?.id).toBe('existing');
	});

	test('凍結済みの既存ユーザーは suspended', async () => {
		addUser('existing', 'tomoki_2307', { intraId: 1000 }, { isSuspended: true });
		const state = await authorizeAndGetState();
		expect(await callbackUrl('authcode', state, state)).toBe(`${BASE_URL}/intra-complete/error?reason=suspended`);
	});

	test('ログイン後に凍結されたら使い捨てコードは無効', async () => {
		const state = await authorizeAndGetState();
		const code = loginCodeOf(await callbackUrl('authcode', state, state));
		users.rows[0].isSuspended = true;
		expect(await service.consumeLoginCode(code, code)).toBeNull();
	});

	test('ユーザー名が別の人に使われていれば username_taken', async () => {
		addUser('other', 'tomoki_2307', { intraId: 999 });
		const state = await authorizeAndGetState();
		expect(await callbackUrl('authcode', state, state)).toBe(`${BASE_URL}/intra-complete/error?reason=username_taken`);
		expect(users.rows).toHaveLength(1);
	});

	test('同じ intra ユーザーが同時に作成された場合は、先に作成された方でログインする', async () => {
		// 検索の後、作成の直前に別の callback がユーザーを作成した状況を再現する
		beforeSignup = () => {
			beforeSignup = null;
			addUser('concurrent', 'tomoki_2307', { intraId: 1000 });
		};
		const state = await authorizeAndGetState();
		const code = loginCodeOf(await callbackUrl('authcode', state, state));

		expect(users.rows).toHaveLength(1);
		expect((await service.consumeLoginCode(code, code))?.id).toBe('concurrent');
	});

	test('不正な使い捨てコードは null', async () => {
		expect(await service.consumeLoginCode(undefined, undefined)).toBeNull();
		expect(await service.consumeLoginCode('a'.repeat(43), 'a'.repeat(43))).toBeNull();
		expect(await service.consumeLoginCode({ code: 'x' }, { code: 'x' })).toBeNull();
	});

	test('Cookie のコードと一致しなければ null で、コードは消費しない (login CSRF 対策)', async () => {
		const state = await authorizeAndGetState();
		const code = loginCodeOf(await callbackUrl('authcode', state, state));

		// 攻撃者が自分のコードを被害者のブラウザ (Cookie が無い、または別のコードの Cookie を持つ) で使わせる状況
		expect(await service.consumeLoginCode(code, null)).toBeNull();
		expect(await service.consumeLoginCode(code, 'b'.repeat(43))).toBeNull();
		expect(redis.store.has(`intra:login:${code}`)).toBe(true);

		expect((await service.consumeLoginCode(code, code))?.id).toBe(users.rows[0].id);
	});

	test('callback の戻り値の loginCode はリダイレクト先のコードと同じで、失敗時は null', async () => {
		const state = await authorizeAndGetState();
		const result = await service.handleCallback('authcode', state, state);
		expect(result.loginCode).not.toBeNull();
		expect(loginCodeOf(result.url)).toBe(result.loginCode);

		const failed = await service.handleCallback('authcode', state, state);
		expect(failed.loginCode).toBeNull();
	});

	test('ログインに成功したら、取得済みの intra ユーザー情報で同期する', async () => {
		addUser('existing', 'tomoki_2307', { intraId: 1000 });
		const state = await authorizeAndGetState();
		loginCodeOf(await callbackUrl('authcode', state, state));
		expect(syncCalls).toEqual([{ userId: 'existing', intraId: 1000 }]);

		// 新規作成のときも同期する
		intraUser = createIntraUser({ id: 2000, login: 'newcomer' });
		const state2 = await authorizeAndGetState();
		loginCodeOf(await callbackUrl('authcode', state2, state2));
		expect(syncCalls).toHaveLength(2);
		expect(syncCalls[1].intraId).toBe(2000);
	});

	test('同期に失敗してもログインは成功する', async () => {
		syncFails = true;
		const state = await authorizeAndGetState();
		const code = loginCodeOf(await callbackUrl('authcode', state, state));
		expect(syncCalls).toHaveLength(1);
		expect((await service.consumeLoginCode(code, code))?.id).toBe(users.rows[0].id);
	});

	test('ログインに失敗したら同期しない', async () => {
		intraUser = createIntraUser({ cursus_users: [] });
		const state = await authorizeAndGetState();
		await callbackUrl('authcode', state, state);
		expect(syncCalls).toHaveLength(0);
	});

	describe('isPasswordLoginRestricted', () => {
		const user = { id: 'u1' } as any;

		test('連携が無効なら制限しない', async () => {
			config.intra = undefined;
			expect(await service.isPasswordLoginRestricted(user, { intraPasswordLoginAllowed: false })).toBe(false);
		});

		test('一般ユーザーは制限する', async () => {
			expect(await service.isPasswordLoginRestricted(user, { intraPasswordLoginAllowed: false })).toBe(true);
		});

		test('例外フラグがあれば制限しない', async () => {
			expect(await service.isPasswordLoginRestricted(user, { intraPasswordLoginAllowed: true })).toBe(false);
		});

		test('モデレーター以上は制限しない', async () => {
			moderators.add('u1');
			expect(await service.isPasswordLoginRestricted(user, { intraPasswordLoginAllowed: false })).toBe(false);
		});
	});
});
