/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// DB や Redis を使わず、依存をすべて差し替えて IntraSyncService の分岐を確認する

import { beforeEach, describe, expect, test } from 'vitest';
import { QueryFailedError } from 'typeorm';
import { IntraSyncService } from '@/core/intra/IntraSyncService.js';
import { RoleService } from '@/core/RoleService.js';
import type { IntraUser } from '@/core/intra/intra-user.js';
import type { Config } from '@/config.js';

const CURSUS_42 = 21;

type FakeProfile = {
	userId: string;
	intraId: number | null;
	intraLogin: string | null;
	intraPoolYearMonth: string | null;
	intraBlackholedAt: Date | null;
	intraPaceDeadlineAt: Date | null;
	intraSyncedAt: Date | null;
};
type FakeRole = { id: string; name: string; [key: string]: unknown };
type FakeIntraRole = { id: string; roleId: string; kind: 'level' | 'campus'; key: string };
type FakeAssignment = { id: string; userId: string; roleId: string; expiresAt: Date | null };

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

function duplicateKeyError(): QueryFailedError {
	return new QueryFailedError('INSERT INTO "intra_role"', [], Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }));
}

describe('IntraSyncService', () => {
	let seq: number;
	let profiles: FakeProfile[];
	let roles: FakeRole[];
	let intraRoles: FakeIntraRole[];
	let assignments: FakeAssignment[];
	let profileCache: Map<string, FakeProfile>;
	let remoteUsers: Map<number, IntraUser>;
	let getUserCalls: number[];
	let beforeIntraRoleInsert: ((row: FakeIntraRole) => Promise<void> | void) | null;
	let service: IntraSyncService;

	function nextId(prefix: string) {
		seq++;
		return `${prefix}${seq}`;
	}

	function addProfile(userId: string, profile: Partial<FakeProfile> = {}) {
		profiles.push({
			userId,
			intraId: null,
			intraLogin: null,
			intraPoolYearMonth: null,
			intraBlackholedAt: null,
			intraPaceDeadlineAt: null,
			intraSyncedAt: null,
			...profile,
		});
	}

	/** 既に同期済みの intra 管理ロールを用意する */
	function addManagedRole(kind: 'level' | 'campus', key: string, name: string): string {
		const roleId = nextId('role');
		roles.push({ id: roleId, name });
		intraRoles.push({ id: nextId('ir'), roleId, kind, key });
		return roleId;
	}

	function assign(userId: string, roleId: string, expiresAt: Date | null = null) {
		assignments.push({ id: nextId('as'), userId, roleId, expiresAt });
	}

	function roleNamesOf(userId: string): string[] {
		return assignments
			.filter(a => a.userId === userId)
			.map(a => roles.find(r => r.id === a.roleId)?.name ?? a.roleId)
			.sort();
	}

	beforeEach(() => {
		seq = 0;
		profiles = [];
		roles = [];
		intraRoles = [];
		assignments = [];
		profileCache = new Map();
		remoteUsers = new Map();
		getUserCalls = [];
		beforeIntraRoleInsert = null;

		const config = {
			intra: { clientId: 'cid', clientSecret: 'csecret', cursusId: CURSUS_42, apiBaseUrl: 'https://api.intra.42.fr' },
		} as Partial<Config>;

		const fakeProfilesRepository = {
			findOneBy: async (where: { userId: string }) => profiles.find(p => p.userId === where.userId) ?? null,
			findOneByOrFail: async (where: { userId: string }) => {
				const found = profiles.find(p => p.userId === where.userId);
				if (found == null) throw new Error('not found');
				return { ...found };
			},
			update: async (where: { userId: string }, set: Partial<FakeProfile>) => {
				const found = profiles.find(p => p.userId === where.userId);
				if (found) Object.assign(found, set);
			},
		};

		const fakeIntraRolesRepository = {
			findOneBy: async (where: { kind: string; key: string }) => intraRoles.find(r => r.kind === where.kind && r.key === where.key) ?? null,
			findOneByOrFail: async (where: { kind: string; key: string }) => {
				const found = intraRoles.find(r => r.kind === where.kind && r.key === where.key);
				if (found == null) throw new Error('not found');
				return found;
			},
			find: async () => intraRoles.map(r => ({ roleId: r.roleId })),
			insert: async (row: FakeIntraRole) => {
				await beforeIntraRoleInsert?.(row);
				if (intraRoles.some(r => r.kind === row.kind && r.key === row.key)) throw duplicateKeyError();
				intraRoles.push({ ...row });
			},
		};

		const fakeRoleAssignmentsRepository = {
			findBy: async (where: { userId: string }) => assignments.filter(a => a.userId === where.userId).map(a => ({ ...a })),
		};

		const fakeRoleService = {
			create: async (values: Record<string, unknown>) => {
				const role = { ...values, id: nextId('role') } as FakeRole;
				roles.push(role);
				return role;
			},
			delete: async (role: { id: string }) => {
				roles = roles.filter(r => r.id !== role.id);
				// role への FK は ON DELETE CASCADE
				intraRoles = intraRoles.filter(r => r.roleId !== role.id);
				assignments = assignments.filter(a => a.roleId !== role.id);
			},
			assign: async (userId: string, roleId: string) => {
				const existing = assignments.find(a => a.userId === userId && a.roleId === roleId);
				if (existing) {
					if (existing.expiresAt && existing.expiresAt.getTime() < Date.now()) {
						assignments = assignments.filter(a => a !== existing);
					} else {
						throw new RoleService.AlreadyAssignedError();
					}
				}
				assign(userId, roleId);
			},
			unassign: async (userId: string, roleId: string) => {
				const existing = assignments.find(a => a.userId === userId && a.roleId === roleId);
				if (existing == null) throw new RoleService.NotAssignedError();
				assignments = assignments.filter(a => a !== existing);
			},
		};

		const fakeIntraApiService = {
			getUser: async (intraId: number) => {
				getUserCalls.push(intraId);
				const user = remoteUsers.get(intraId);
				return user ? structuredClone(user) : null;
			},
		};

		const fakeCacheService = {
			userProfileCache: {
				set: async (key: string, value: FakeProfile) => {
					profileCache.set(key, value);
				},
			},
		};

		const noop = () => {};
		const fakeLoggerService = {
			getLogger: () => ({ info: noop, warn: noop, error: noop, debug: noop }),
		};

		service = new IntraSyncService(
			config as Config,
			fakeProfilesRepository as any,
			fakeIntraRolesRepository as any,
			fakeRoleAssignmentsRepository as any,
			fakeIntraApiService as any,
			fakeRoleService as any,
			fakeCacheService as any,
			{ gen: () => nextId('id') } as any,
			fakeLoggerService as any,
		);
	});

	test('プロフィールを更新し、ロールを作成して付与する', async () => {
		addProfile('u1', { intraId: 1000, intraLogin: 'old' });

		await service.syncUser('u1', createIntraUser());

		expect(profiles[0]).toMatchObject({
			intraLogin: 'tomoki',
			intraPoolYearMonth: '2307',
			intraBlackholedAt: new Date('2027-03-01T00:00:00.000Z'),
			intraPaceDeadlineAt: null,
		});
		expect(profiles[0].intraSyncedAt).toBeInstanceOf(Date);
		expect(profileCache.get('u1')?.intraLogin).toBe('tomoki');

		expect(intraRoles.map(r => [r.kind, r.key])).toEqual([['level', '5'], ['campus', '26']]);
		expect(roles).toHaveLength(2);
		expect(roles[0]).toMatchObject({
			name: 'Lv.5',
			target: 'manual',
			isPublic: true,
			asBadge: true,
			isModerator: false,
			isAdministrator: false,
			canEditMembersByModerator: false,
			color: null,
			policies: {},
		});
		expect(roles[1].name).toBe('Tokyo');
		expect(roleNamesOf('u1')).toEqual(['Lv.5', 'Tokyo']);
	});

	test('レベルが上がったら新しいレベルのロールに付け替え、手動のロールには触れない', async () => {
		addProfile('u1', { intraId: 1000 });
		const lv4 = addManagedRole('level', '4', 'Lv.4');
		const tokyo = addManagedRole('campus', '26', 'Tokyo');
		roles.push({ id: 'manual', name: 'Manual' });
		assign('u1', lv4);
		assign('u1', tokyo);
		assign('u1', 'manual');

		await service.syncUser('u1', createIntraUser());

		expect(roleNamesOf('u1')).toEqual(['Lv.5', 'Manual', 'Tokyo']);
		// 既存のロールは作り直さない
		expect(intraRoles.filter(r => r.kind === 'campus')).toHaveLength(1);
	});

	test('既存のロールの名前は上書きしない', async () => {
		addProfile('u1', { intraId: 1000 });
		const tokyo = addManagedRole('campus', '26', '東京校');

		await service.syncUser('u1', createIntraUser());

		expect(roles.find(r => r.id === tokyo)?.name).toBe('東京校');
		expect(roleNamesOf('u1')).toEqual(['Lv.5', '東京校']);
	});

	test('対象 cursus に在籍していなければレベルのロールをすべて外す', async () => {
		addProfile('u1', { intraId: 1000 });
		const lv4 = addManagedRole('level', '4', 'Lv.4');
		const lv5 = addManagedRole('level', '5', 'Lv.5');
		assign('u1', lv4);
		assign('u1', lv5);

		await service.syncUser('u1', createIntraUser({ cursus_users: [], 'staff?': true }));

		expect(roleNamesOf('u1')).toEqual(['Tokyo']);
	});

	test('キャンパスが無ければキャンパスのロールを外す', async () => {
		addProfile('u1', { intraId: 1000 });
		const tokyo = addManagedRole('campus', '26', 'Tokyo');
		assign('u1', tokyo);

		await service.syncUser('u1', createIntraUser({ campus: [], campus_users: [] }));

		expect(roleNamesOf('u1')).toEqual(['Lv.5']);
	});

	test('期限切れで付いている管理ロールは付け直す', async () => {
		addProfile('u1', { intraId: 1000 });
		const lv5 = addManagedRole('level', '5', 'Lv.5');
		assign('u1', lv5, new Date(Date.now() - 1000));

		await service.syncUser('u1', createIntraUser({ campus: [], campus_users: [] }));

		const current = assignments.filter(a => a.userId === 'u1');
		expect(current).toHaveLength(1);
		expect(current[0]).toMatchObject({ roleId: lv5, expiresAt: null });
	});

	test('intraUser を省略すると 42 API から取得する', async () => {
		addProfile('u1', { intraId: 1000 });
		remoteUsers.set(1000, createIntraUser({ login: 'renamed' }));

		await service.syncUser('u1');

		expect(getUserCalls).toEqual([1000]);
		expect(profiles[0].intraLogin).toBe('renamed');
		expect(roleNamesOf('u1')).toEqual(['Lv.5', 'Tokyo']);
	});

	test('42 API でユーザーが見つからなければ intraSyncedAt だけ更新する', async () => {
		const blackholedAt = new Date('2025-01-01T00:00:00.000Z');
		addProfile('u1', { intraId: 1000, intraLogin: 'tomoki', intraPoolYearMonth: '2307', intraBlackholedAt: blackholedAt });
		const lv5 = addManagedRole('level', '5', 'Lv.5');
		assign('u1', lv5);

		await service.syncUser('u1');

		expect(profiles[0]).toMatchObject({ intraLogin: 'tomoki', intraPoolYearMonth: '2307', intraBlackholedAt: blackholedAt });
		expect(profiles[0].intraSyncedAt).toBeInstanceOf(Date);
		expect(roleNamesOf('u1')).toEqual(['Lv.5']);
	});

	test('intra と連携していないユーザーには何もしない', async () => {
		addProfile('u1');

		await service.syncUser('u1');

		expect(getUserCalls).toEqual([]);
		expect(profiles[0].intraSyncedAt).toBeNull();
		expect(roles).toHaveLength(0);
	});

	test('intraUser の ID がプロフィールと違えば例外', async () => {
		addProfile('u1', { intraId: 1000 });

		await expect(service.syncUser('u1', createIntraUser({ id: 2000 }))).rejects.toThrow();
		expect(profiles[0].intraLogin).toBeNull();
		expect(roles).toHaveLength(0);
	});

	test('同じ条件のロールを別の同期が先に作成していたら、そちらを使い、作成したロールは消す', async () => {
		addProfile('u1', { intraId: 1000 });
		let concurrentRoleId: string | null = null;
		beforeIntraRoleInsert = (row) => {
			if (row.kind !== 'level' || concurrentRoleId != null) return;
			// 検索の後、記録の直前に別の同期がロールを作成した状況を再現する
			concurrentRoleId = addManagedRole('level', '5', 'Lv.5 (concurrent)');
		};

		await service.syncUser('u1', createIntraUser({ campus: [], campus_users: [] }));

		expect(intraRoles.filter(r => r.kind === 'level')).toEqual([expect.objectContaining({ roleId: concurrentRoleId })]);
		expect(roles.map(r => r.name)).toEqual(['Lv.5 (concurrent)']);
		expect(roleNamesOf('u1')).toEqual(['Lv.5 (concurrent)']);
	});

	test('同時に同期しても同じ条件のロールは 1 つだけ', async () => {
		addProfile('u1', { intraId: 1000 });
		addProfile('u2', { intraId: 2000 });

		await Promise.all([
			service.syncUser('u1', createIntraUser()),
			service.syncUser('u2', createIntraUser({ id: 2000, login: 'other' })),
		]);

		expect(intraRoles).toHaveLength(2);
		expect(roles).toHaveLength(2);
		expect(roleNamesOf('u1')).toEqual(['Lv.5', 'Tokyo']);
		expect(roleNamesOf('u2')).toEqual(['Lv.5', 'Tokyo']);
	});

	test('記録が重複以外の理由で失敗したら、作成したロールを消して例外を投げる', async () => {
		addProfile('u1', { intraId: 1000 });
		beforeIntraRoleInsert = () => {
			throw new Error('connection lost');
		};

		await expect(service.syncUser('u1', createIntraUser())).rejects.toThrow('connection lost');
		expect(roles).toHaveLength(0);
		expect(intraRoles).toHaveLength(0);
	});
});
