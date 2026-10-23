/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// DB や 42 API を使わず、依存をすべて差し替えて IntraProjectService の分岐を確認する

import { beforeEach, describe, expect, test } from 'vitest';
import { FindOperator } from 'typeorm';
import { IntraProjectService } from '@/core/intra/IntraProjectService.js';
import type { IntraProjectSession, IntraProjectStatuses, IntraQuestUser } from '@/core/intra/intra-project.js';
import type { IntraUser } from '@/core/intra/intra-user.js';
import type { Config } from '@/config.js';

type FakeProject = { id: string; slug: string; campusId: number; sessionId: number; maxGroupSize: number | null; updatedAt: Date; [key: string]: unknown };
type FakeProgress = {
	userId: string;
	campusId: number | null;
	projectStatuses: IntraProjectStatuses;
	validatedQuests: string[];
	projectsSyncedAt: Date | null;
	questsSyncedAt: Date | null;
};

function session(id: number, slug: string, overrides: Partial<IntraProjectSession> = {}): IntraProjectSession {
	return {
		id,
		project_id: id * 10,
		campus_id: 26,
		cursus_id: 21,
		is_subscriptable: true,
		updated_at: '2026-01-01T00:00:00.000Z',
		project: { id: id * 10, name: slug, slug },
		project_sessions_rules: [
			{ required: true, params: [{ value: '2' }, { value: '2' }], rule: { kind: 'group_validation', internal_name: 'GroupSizeBetweenNAndM' } },
		],
		...overrides,
	};
}

function intraUser(overrides: Partial<IntraUser> = {}): IntraUser {
	return {
		id: 1000,
		login: 'tomoki',
		pool_year: '2023',
		pool_month: 'july',
		'staff?': false,
		created_at: '2023-05-10T03:00:00.000Z',
		cursus_users: [],
		campus: [{ id: 26, name: 'Tokyo' }],
		campus_users: [{ campus_id: 26, is_primary: true }],
		projects_users: [
			{ status: 'finished', 'validated?': true, cursus_ids: [21], project: { id: 1, slug: '42cursus-minishell' } },
			{ status: 'searching_a_group', 'validated?': null, cursus_ids: [21], project: { id: 2, slug: 'cub3d' } },
		],
		...overrides,
	};
}

describe('IntraProjectService', () => {
	let seq: number;
	let projects: FakeProject[];
	let progresses: FakeProgress[];
	let remoteSessions: Map<number, IntraProjectSession[]>;
	let remoteQuests: IntraQuestUser[] | null | Error;
	let sessionCalls: [number, number][];
	let resultSyncCalls: [string, number][];
	let service: IntraProjectService;

	beforeEach(() => {
		seq = 0;
		projects = [];
		progresses = [];
		remoteSessions = new Map();
		remoteQuests = [];
		sessionCalls = [];
		resultSyncCalls = [];

		const config = {
			intra: { clientId: 'cid', clientSecret: 'csecret', cursusId: 21, apiBaseUrl: 'https://api.intra.42.fr' },
		} as Partial<Config>;

		const fakeProjectsRepository = {
			findBy: async (where: { campusId: number }) => projects.filter(p => p.campusId === where.campusId).map(p => ({ ...p })),
			existsBy: async (where: { campusId: number }) => projects.some(p => p.campusId === where.campusId),
			update: async (where: { id: string }, set: Partial<FakeProject>) => {
				Object.assign(projects.find(p => p.id === where.id)!, set);
			},
			insert: async (row: FakeProject) => {
				projects.push({ ...row });
			},
			delete: async (where: { campusId: number; slug: FindOperator<string[]> }) => {
				expect(where.slug.type).toBe('not');
				const keep = where.slug.value as unknown as string[];
				projects = projects.filter(p => p.campusId !== where.campusId || keep.includes(p.slug));
			},
		};

		const fakeProgressesRepository = {
			upsert: async (values: Partial<FakeProgress> & { userId: string }, conflictPaths: string[]) => {
				expect(conflictPaths).toEqual(['userId']);
				const existing = progresses.find(p => p.userId === values.userId);
				if (existing) {
					// TypeORM の upsert と同じく、値を入れた列だけを更新する
					for (const [k, v] of Object.entries(values)) {
						if (v !== undefined) (existing as Record<string, unknown>)[k] = v;
					}
				} else {
					progresses.push({ campusId: null, projectStatuses: {}, validatedQuests: [], projectsSyncedAt: null, questsSyncedAt: null, ...values });
				}
			},
			createQueryBuilder: () => {
				const qb = {
					select: () => qb,
					distinct: () => qb,
					where: () => qb,
					getRawMany: async () => [...new Set(progresses.map(p => p.campusId).filter(c => c != null))].map(campusId => ({ campusId })),
				};
				return qb;
			},
		};

		const fakeIntraApiService = {
			getProjectSessions: async (campusId: number, cursusId: number) => {
				sessionCalls.push([campusId, cursusId]);
				return structuredClone(remoteSessions.get(campusId) ?? []);
			},
			getQuestsUsers: async () => {
				if (remoteQuests instanceof Error) throw remoteQuests;
				return remoteQuests;
			},
		};

		const noop = () => {};
		const fakeLoggerService = {
			getLogger: () => ({ info: noop, warn: noop, error: noop, debug: noop }),
		};

		service = new IntraProjectService(
			config as Config,
			fakeProjectsRepository as any,
			fakeProgressesRepository as any,
			fakeIntraApiService as any,
			{
				syncResults: async (userId: string, projectsUsers: unknown[]) => {
					resultSyncCalls.push([userId, projectsUsers.length]);
				},
			} as any,
			{ gen: () => `id${++seq}` } as any,
			fakeLoggerService as any,
		);
	});

	describe('syncProjects', () => {
		test('課題を取り込み、既存の課題は ID を変えずに更新し、無くなった課題は消す', async () => {
			projects.push({ id: 'old-cub3d', slug: 'cub3d', campusId: 26, sessionId: 1, maxGroupSize: null, updatedAt: new Date(0) });
			projects.push({ id: 'gone', slug: 'ft_services', campusId: 26, sessionId: 2, maxGroupSize: 2, updatedAt: new Date(0) });
			projects.push({ id: 'other-campus', slug: 'ft_services', campusId: 1, sessionId: 3, maxGroupSize: 2, updatedAt: new Date(0) });
			remoteSessions.set(26, [
				session(5218, 'cub3d'),
				session(5241, 'ft_transcendence', {
					project_sessions_rules: [{ required: true, params: [{ value: '4' }, { value: '5' }], rule: { kind: 'group_validation', internal_name: 'GroupSizeBetweenNAndM' } }],
				}),
				session(9999, 'closed', { is_subscriptable: false }),
			]);

			expect(await service.syncProjects(26)).toBe(2);

			expect(sessionCalls).toEqual([[26, 21]]);
			expect(projects.map(p => [p.id, p.slug, p.campusId, p.sessionId, p.maxGroupSize]).sort()).toEqual([
				['id1', 'ft_transcendence', 26, 5241, 5],
				['old-cub3d', 'cub3d', 26, 5218, 2],
				['other-campus', 'ft_services', 1, 3, 2],
			]);
			expect(projects.find(p => p.slug === 'cub3d')!.updatedAt.getTime()).toBeGreaterThan(0);
		});

		test('42 API が 1 件も返さなければ、保存済みの課題を消さない', async () => {
			projects.push({ id: 'p1', slug: 'cub3d', campusId: 26, sessionId: 1, maxGroupSize: 2, updatedAt: new Date(0) });

			expect(await service.syncProjects(26)).toBe(0);
			expect(projects).toHaveLength(1);
		});
	});

	describe('syncMissingCampuses / syncAllCampuses', () => {
		test('ユーザーの主キャンパスのうち、課題が無いキャンパスだけ取り込む', async () => {
			progresses.push({ userId: 'u1', campusId: 26, projectStatuses: {}, validatedQuests: [], projectsSyncedAt: null, questsSyncedAt: null });
			progresses.push({ userId: 'u2', campusId: 1, projectStatuses: {}, validatedQuests: [], projectsSyncedAt: null, questsSyncedAt: null });
			progresses.push({ userId: 'u3', campusId: null, projectStatuses: {}, validatedQuests: [], projectsSyncedAt: null, questsSyncedAt: null });
			projects.push({ id: 'p1', slug: 'cub3d', campusId: 1, sessionId: 1, maxGroupSize: 2, updatedAt: new Date(0) });
			remoteSessions.set(26, [session(5218, 'cub3d')]);

			await service.syncMissingCampuses();
			expect(sessionCalls).toEqual([[26, 21]]);

			// 2 回目は課題があるので取り込まない
			await service.syncMissingCampuses();
			expect(sessionCalls).toEqual([[26, 21]]);
		});

		test('毎日のジョブではすべてのキャンパスを取り込む', async () => {
			progresses.push({ userId: 'u1', campusId: 26, projectStatuses: {}, validatedQuests: [], projectsSyncedAt: null, questsSyncedAt: null });
			progresses.push({ userId: 'u2', campusId: 1, projectStatuses: {}, validatedQuests: [], projectsSyncedAt: null, questsSyncedAt: null });

			await service.syncAllCampuses();
			expect(sessionCalls.map(c => c[0]).sort()).toEqual([1, 26]);
		});
	});

	describe('syncUserProgress', () => {
		test('課題の状態と達成したクエストを保存する', async () => {
			remoteQuests = [
				{ validated_at: '2025-01-01T00:00:00.000Z', quest: { slug: 'common-core-rank-02' } },
				{ validated_at: null, quest: { slug: 'common-core-rank-03' } },
			];

			await service.syncUserProgress('u1', intraUser(), 26);

			expect(progresses).toEqual([{
				userId: 'u1',
				campusId: 26,
				projectStatuses: {
					'42cursus-minishell': { status: 'finished', validated: true },
					cub3d: { status: 'searching_a_group', validated: null },
				},
				validatedQuests: ['common-core-rank-02'],
				projectsSyncedAt: expect.any(Date),
				questsSyncedAt: expect.any(Date),
			}]);
			expect(resultSyncCalls).toEqual([['u1', 2]]);
		});

		test('クエストの取得に失敗したら、保存済みのクエストを残して課題の状態だけ更新する', async () => {
			const questsSyncedAt = new Date('2026-01-01T00:00:00.000Z');
			progresses.push({ userId: 'u1', campusId: 26, projectStatuses: {}, validatedQuests: ['common-core-rank-01'], projectsSyncedAt: null, questsSyncedAt });
			remoteQuests = new Error('timeout');

			await service.syncUserProgress('u1', intraUser(), 26);

			expect(progresses[0].validatedQuests).toEqual(['common-core-rank-01']);
			expect(progresses[0].questsSyncedAt).toBe(questsSyncedAt);
			expect(Object.keys(progresses[0].projectStatuses).sort()).toEqual(['42cursus-minishell', 'cub3d']);
		});

		test('projects_users が無ければ課題の状態は更新しない', async () => {
			progresses.push({ userId: 'u1', campusId: 26, projectStatuses: { cub3d: { status: 'finished', validated: true } }, validatedQuests: [], projectsSyncedAt: null, questsSyncedAt: null });

			await service.syncUserProgress('u1', intraUser({ projects_users: undefined }), 26);

			expect(progresses[0].projectStatuses).toEqual({ cub3d: { status: 'finished', validated: true } });
			expect(progresses[0].projectsSyncedAt).toBeNull();
		});
	});
});
