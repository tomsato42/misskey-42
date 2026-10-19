/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// DB や Redis を使わず、依存をすべて差し替えて IntraSyncService の分岐を確認する

import { beforeEach, describe, expect, test } from 'vitest';
import { QueryFailedError } from 'typeorm';
import { IntraSyncService } from '@/core/intra/IntraSyncService.js';
import { findNearestIntake } from '@/core/intra/intra-cohort.js';
import { RoleService } from '@/core/RoleService.js';
import type { IntraUser } from '@/core/intra/intra-user.js';
import type { IntraCoalition } from '@/core/intra/intra-coalition.js';
import type { IntraRoleKind } from '@/models/IntraRole.js';
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
type FakeIntraRole = { id: string; roleId: string; kind: IntraRoleKind; key: string };
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
	let progressSyncCalls: { userId: string; intraId: number; campusId: number | null }[];
	let progressSyncHook: (() => Promise<void> | void) | null;
	/** キャンパス ID → 入学の月の一覧 */
	let intakes: Map<number, string[]>;
	/** intra のユーザー ID → コアリション。Error なら取得に失敗する */
	let coalitions: Map<number, IntraCoalition | Error>;
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
	function addManagedRole(kind: IntraRoleKind, key: string, name: string): string {
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
		progressSyncCalls = [];
		intakes = new Map();
		coalitions = new Map();
		progressSyncHook = null;

		const config = {
			intra: { clientId: 'cid', clientSecret: 'csecret', cursusId: CURSUS_42, apiBaseUrl: 'https://api.intra.42.fr', levelBadgeUrl: 'https://example.com/badges/lv-{level}.svg' },
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
			find: async () => intraRoles.map(r => ({ roleId: r.roleId, kind: r.kind })),
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
			getRoles: async () => roles,
			update: async (role: { id: string }, params: Record<string, unknown>) => {
				Object.assign(roles.find(r => r.id === role.id)!, params);
			},
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

		const fakeIntraProjectService = {
			syncUserProgress: async (userId: string, intraUser: IntraUser, campusId: number | null) => {
				await progressSyncHook?.();
				progressSyncCalls.push({ userId, intraId: intraUser.id, campusId });
			},
		};

		const fakeIntraCohortService = {
			getIntakeYearMonth: async (campusId: number | null, cursusBeginAt: Date | null) =>
				campusId != null && cursusBeginAt != null ? findNearestIntake(cursusBeginAt, intakes.get(campusId) ?? []) : null,
		};

		const fakeIntraCoalitionService = {
			getUserCoalition: async (intraId: number, campusId: number | null) => {
				if (campusId == null) return null;
				const coalition = coalitions.get(intraId) ?? null;
				if (coalition instanceof Error) throw coalition;
				return coalition;
			},
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
			fakeIntraProjectService as any,
			fakeIntraCohortService as any,
			fakeIntraCoalitionService as any,
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

		expect(intraRoles.map(r => [r.kind, r.key])).toEqual([['level', '5'], ['campus', '26'], ['pool', '2307'], ['cohort', '2310']]);
		expect(roles.map(r => r.name)).toEqual(['Lv.5', 'Tokyo', 'Piscine 23/07', 'Cursus 23/10']);
		for (const role of roles) {
			expect(role).toMatchObject({
				target: 'manual',
				isPublic: true,
				asBadge: true,
				isModerator: false,
				isAdministrator: false,
				// ロールのタイムラインを公開する
				isExplorable: true,
				canEditMembersByModerator: false,
				color: null,
				policies: {},
			});
		}
		expect(roles.map(r => r.iconUrl)).toEqual(['https://example.com/badges/lv-5.svg', null, null, null]);
		expect(roles[2].description).toBe('42 intra のピシンの時期に応じて自動で付与されます');
		expect(roles[3].description).toBe('42 intra の本科 (42cursus) への入学時期に応じて自動で付与されます');
		expect(roleNamesOf('u1')).toEqual(['Cursus 23/10', 'Lv.5', 'Piscine 23/07', 'Tokyo']);
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

		expect(roleNamesOf('u1')).toEqual(['Cursus 23/10', 'Lv.5', 'Manual', 'Piscine 23/07', 'Tokyo']);
		// 既存のロールは作り直さない
		expect(intraRoles.filter(r => r.kind === 'campus')).toHaveLength(1);
	});

	test('入学時期のロールを付け替え、ほかの入学時期のロールは外す', async () => {
		addProfile('u1', { intraId: 1000 });
		const cohort2304 = addManagedRole('cohort', '2304', 'Cursus 23/04');
		const cohort2310 = addManagedRole('cohort', '2310', 'Cursus 23/10');
		assign('u1', cohort2304);

		await service.syncUser('u1', createIntraUser({
			cursus_users: [
				// 42cursus の開始日時 (日本時間で 2023-11-01) ではなく、ピシンの年月 (23/07) から 23/10 になる
				{ cursus_id: CURSUS_42, level: 5.73, blackholed_at: null, begin_at: '2023-10-31T15:00:00.000Z', end_at: null },
			],
		}));

		expect(roleNamesOf('u1')).toEqual(['Cursus 23/10', 'Lv.5', 'Piscine 23/07', 'Tokyo']);
		expect(intraRoles.filter(r => r.kind === 'cohort').map(r => r.key).sort()).toEqual(['2304', '2310']);
		expect(assignments.some(a => a.roleId === cohort2304)).toBe(false);
		expect(assignments.some(a => a.roleId === cohort2310)).toBe(true);
	});

	test('入学の月の集計があれば、42cursus を始めた月に最も近い入学の月で入学時期のロールを決める', async () => {
		addProfile('u1', { intraId: 1000 });
		intakes.set(26, ['2305', '2309', '2404']);

		// 42cursus の開始は 2023-10-02
		await service.syncUser('u1', createIntraUser());

		expect(roleNamesOf('u1')).toEqual(['Cursus 23/09', 'Lv.5', 'Piscine 23/07', 'Tokyo']);
	});

	test('コアリションのロールを色付きで作成して付与し、ほかのコアリションのロールは外す', async () => {
		addProfile('u1', { intraId: 1000 });
		const old = addManagedRole('coalition', '302', 'Kaze');
		assign('u1', old);
		coalitions.set(1000, { id: 301, name: 'Fuji', color: '#FF6950' });

		await service.syncUser('u1', createIntraUser());

		expect(roleNamesOf('u1')).toEqual(['Cursus 23/10', 'Fuji', 'Lv.5', 'Piscine 23/07', 'Tokyo']);
		expect(roles.find(r => r.name === 'Fuji')).toMatchObject({
			color: '#FF6950',
			isExplorable: true,
			description: '42 intra のコアリションに応じて自動で付与されます',
		});
		expect(intraRoles.find(r => r.kind === 'coalition' && r.key === '301')).toBeDefined();
	});

	test('コアリションに所属していなければコアリションのロールを外す', async () => {
		addProfile('u1', { intraId: 1000 });
		const fuji = addManagedRole('coalition', '301', 'Fuji');
		assign('u1', fuji);

		await service.syncUser('u1', createIntraUser());

		expect(roleNamesOf('u1')).toEqual(['Cursus 23/10', 'Lv.5', 'Piscine 23/07', 'Tokyo']);
	});

	test('コアリションを取得できなければ、コアリションのロールは付けも外しもせず、ほかのロールは同期する', async () => {
		addProfile('u1', { intraId: 1000 });
		const fuji = addManagedRole('coalition', '301', 'Fuji');
		const lv4 = addManagedRole('level', '4', 'Lv.4');
		assign('u1', fuji);
		assign('u1', lv4);
		coalitions.set(1000, new Error('42 API is down'));

		await service.syncUser('u1', createIntraUser());

		expect(roleNamesOf('u1')).toEqual(['Cursus 23/10', 'Fuji', 'Lv.5', 'Piscine 23/07', 'Tokyo']);
	});

	test('ピシンの年月が無ければピシンのロールを付けず、付いていれば外す', async () => {
		addProfile('u1', { intraId: 1000 });
		const pool = addManagedRole('pool', '2307', 'Piscine 23/07');
		assign('u1', pool);

		await service.syncUser('u1', createIntraUser({ pool_year: null, pool_month: null }));

		expect(roleNamesOf('u1')).toEqual(['Cursus 23/10', 'Lv.5', 'Tokyo']);
		expect(intraRoles.filter(r => r.kind === 'pool')).toHaveLength(1);
	});

	test('作成済みのレベルのロールにアイコンが無ければ設定し、設定済みのアイコンは上書きしない', async () => {
		addProfile('u1', { intraId: 1000 });
		addProfile('u2', { intraId: 2000 });
		const lv5 = addManagedRole('level', '5', 'Lv.5');
		const lv7 = addManagedRole('level', '7', 'Lv.7');
		Object.assign(roles.find(r => r.id === lv7)!, { iconUrl: 'https://example.com/custom.png' });

		await service.syncUser('u1', createIntraUser());
		await service.syncUser('u2', createIntraUser({ id: 2000, cursus_users: [{ cursus_id: CURSUS_42, level: 7.2, blackholed_at: null, begin_at: '2023-10-02T00:00:00.000Z', end_at: null }] }));

		expect(roles.find(r => r.id === lv5)?.iconUrl).toBe('https://example.com/badges/lv-5.svg');
		expect(roles.find(r => r.id === lv7)?.iconUrl).toBe('https://example.com/custom.png');
	});

	test('Lv.0 から Lv.21 までのロールを先に作り、2 回目は作らない', async () => {
		const lv3 = addManagedRole('level', '3', 'レベル3 (管理者が変えた名前)');

		await service.ensureLevelRoles();
		await service.ensureLevelRoles();

		const levelKeys = intraRoles.filter(r => r.kind === 'level').map(r => Number(r.key)).sort((a, b) => a - b);
		expect(levelKeys).toEqual(Array.from({ length: 22 }, (_, i) => i));
		expect(roles.find(r => r.id === lv3)?.name).toBe('レベル3 (管理者が変えた名前)');
		expect(roles.find(r => r.name === 'Lv.21')?.iconUrl).toBe('https://example.com/badges/lv-21.svg');
		expect(roles).toHaveLength(22);
	});

	test('既存のロールの名前は上書きしない', async () => {
		addProfile('u1', { intraId: 1000 });
		const tokyo = addManagedRole('campus', '26', '東京校');
		const pool = addManagedRole('pool', '2307', '2023 年 7 月ピシン');

		await service.syncUser('u1', createIntraUser());

		expect(roles.find(r => r.id === tokyo)?.name).toBe('東京校');
		expect(roles.find(r => r.id === pool)?.name).toBe('2023 年 7 月ピシン');
		expect(roleNamesOf('u1')).toEqual(['2023 年 7 月ピシン', 'Cursus 23/10', 'Lv.5', '東京校']);
	});

	test('対象 cursus に在籍していなければレベルと入学時期のロールをすべて外す', async () => {
		addProfile('u1', { intraId: 1000 });
		const lv4 = addManagedRole('level', '4', 'Lv.4');
		const lv5 = addManagedRole('level', '5', 'Lv.5');
		const cohort = addManagedRole('cohort', '2310', 'Cursus 23/10');
		assign('u1', lv4);
		assign('u1', lv5);
		assign('u1', cohort);

		await service.syncUser('u1', createIntraUser({ cursus_users: [], 'staff?': true }));

		expect(roleNamesOf('u1')).toEqual(['Piscine 23/07', 'Tokyo']);
	});

	test('キャンパスが無ければキャンパスのロールを外す', async () => {
		addProfile('u1', { intraId: 1000 });
		const tokyo = addManagedRole('campus', '26', 'Tokyo');
		assign('u1', tokyo);

		await service.syncUser('u1', createIntraUser({ campus: [], campus_users: [] }));

		expect(roleNamesOf('u1')).toEqual(['Cursus 23/10', 'Lv.5', 'Piscine 23/07']);
	});

	test('期限切れで付いている管理ロールは付け直す', async () => {
		addProfile('u1', { intraId: 1000 });
		const lv5 = addManagedRole('level', '5', 'Lv.5');
		assign('u1', lv5, new Date(Date.now() - 1000));

		await service.syncUser('u1', createIntraUser({ campus: [], campus_users: [] }));

		const current = assignments.filter(a => a.userId === 'u1' && a.roleId === lv5);
		expect(current).toHaveLength(1);
		expect(current[0]).toMatchObject({ roleId: lv5, expiresAt: null });
	});

	test('intraUser を省略すると 42 API から取得する', async () => {
		addProfile('u1', { intraId: 1000 });
		remoteUsers.set(1000, createIntraUser({ login: 'renamed' }));

		await service.syncUser('u1');

		expect(getUserCalls).toEqual([1000]);
		expect(profiles[0].intraLogin).toBe('renamed');
		expect(roleNamesOf('u1')).toEqual(['Cursus 23/10', 'Lv.5', 'Piscine 23/07', 'Tokyo']);
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

	test('課題の状態とクエストを主キャンパスとともに保存する', async () => {
		addProfile('u1', { intraId: 1000 });

		await service.syncUser('u1', createIntraUser());

		expect(progressSyncCalls).toEqual([{ userId: 'u1', intraId: 1000, campusId: 26 }]);
	});

	test('課題の状態の保存に失敗しても、プロフィールとロールの同期は成功させる', async () => {
		addProfile('u1', { intraId: 1000 });
		progressSyncHook = () => {
			throw new Error('42 API is down');
		};

		await service.syncUser('u1', createIntraUser());

		expect(profiles[0].intraLogin).toBe('tomoki');
		expect(roleNamesOf('u1')).toEqual(['Cursus 23/10', 'Lv.5', 'Piscine 23/07', 'Tokyo']);
	});

	test('intra と連携していないユーザーには何もしない', async () => {
		addProfile('u1');

		await service.syncUser('u1');

		expect(progressSyncCalls).toEqual([]);
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
		expect(roles.map(r => r.name)).toEqual(['Lv.5 (concurrent)', 'Piscine 23/07', 'Cursus 23/10']);
		expect(roleNamesOf('u1')).toEqual(['Cursus 23/10', 'Lv.5 (concurrent)', 'Piscine 23/07']);
	});

	test('同時に同期しても同じ条件のロールは 1 つだけ', async () => {
		addProfile('u1', { intraId: 1000 });
		addProfile('u2', { intraId: 2000 });

		await Promise.all([
			service.syncUser('u1', createIntraUser()),
			service.syncUser('u2', createIntraUser({ id: 2000, login: 'other' })),
		]);

		expect(intraRoles).toHaveLength(4);
		expect(roles).toHaveLength(4);
		expect(roleNamesOf('u1')).toEqual(['Cursus 23/10', 'Lv.5', 'Piscine 23/07', 'Tokyo']);
		expect(roleNamesOf('u2')).toEqual(['Cursus 23/10', 'Lv.5', 'Piscine 23/07', 'Tokyo']);
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
