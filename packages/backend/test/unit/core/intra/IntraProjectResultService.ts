/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// DB や 42 API を使わず、依存をすべて差し替えて IntraProjectResultService の分岐を確認する

import { beforeEach, describe, expect, test } from 'vitest';
import { FindOperator } from 'typeorm';
import {
	IntraProjectResultNotAttachableError,
	IntraProjectResultNotFoundError,
	IntraProjectResultService,
} from '@/core/intra/IntraProjectResultService.js';
import type { MiIntraProjectResult } from '@/models/IntraProjectResult.js';
import type { MiIntraProjectNote } from '@/models/IntraProjectNote.js';
import type { MiNote } from '@/models/Note.js';
import type { IntraProjectUser } from '@/core/intra/intra-project.js';
import type { IntraScaleTeam, IntraTeam } from '@/core/intra/intra-project-result.js';

const NOW = new Date();

function pu(id: number, overrides: Partial<IntraProjectUser> = {}): IntraProjectUser {
	return {
		id,
		status: 'finished',
		'validated?': true,
		final_mark: 100,
		marked_at: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
		current_team_id: id * 10,
		project: { id, slug: `project-${id}`, name: `Project ${id}` },
		...overrides,
	};
}

describe('IntraProjectResultService', () => {
	let seq: number;
	let results: MiIntraProjectResult[];
	let notes: MiIntraProjectNote[];
	let resultsSyncedAt: Date | null;
	let notifications: { userId: string; type: string; data: Record<string, unknown> }[];
	let teams: Map<number, IntraTeam>;
	let scaleTeams: Map<number, IntraScaleTeam[]>;
	let apiCalls: string[];
	let remoteProjectsUsers: IntraProjectUser[] | null;
	let service: IntraProjectResultService;

	beforeEach(() => {
		seq = 0;
		results = [];
		notes = [];
		resultsSyncedAt = new Date('2026-10-18T00:00:00.000Z');
		notifications = [];
		teams = new Map();
		scaleTeams = new Map();
		apiCalls = [];
		remoteProjectsUsers = null;

		const matches = (row: MiIntraProjectResult, where: Record<string, unknown>) => Object.entries(where).every(([k, v]) => {
			if (v instanceof FindOperator) {
				expect(v.type).toBe('not');
				// Not(In([...])) の value は中の In の配列になる
				return !(v.value as unknown as number[]).includes(row[k as keyof MiIntraProjectResult] as number);
			}
			return row[k as keyof MiIntraProjectResult] === v;
		});

		const fakeResultsRepository = {
			findBy: async (where: Record<string, unknown>) => results.filter(r => matches(r, where)).map(r => ({ ...r })),
			findOneBy: async (where: Record<string, unknown>) => {
				const found = results.find(r => matches(r, where));
				return found ? { ...found } : null;
			},
			update: async (where: { id: string }, set: Partial<MiIntraProjectResult>) => {
				Object.assign(results.find(r => r.id === where.id)!, set);
			},
			insert: async (row: Omit<MiIntraProjectResult, 'members' | 'outstandingCount' | 'detailsTeamId' | 'submissions' | 'submissionsTeamId' | 'user'>) => {
				// 列の既定値を入れる
				results.push({ members: [], outstandingCount: null, detailsTeamId: null, submissions: [], submissionsTeamId: null, user: null, ...row });
			},
			delete: async (where: Record<string, unknown>) => {
				results = results.filter(r => !matches(r, where));
			},
		};

		const fakeProgressesRepository = {
			findOne: async () => ({ userId: 'u1', resultsSyncedAt }),
			update: async (_where: unknown, set: { resultsSyncedAt: Date }) => {
				resultsSyncedAt = set.resultsSyncedAt;
			},
		};

		const fakeIntraApiService = {
			getTeam: async (teamId: number) => {
				apiCalls.push(`team ${teamId}`);
				return teams.get(teamId) ?? null;
			},
			getTeamScaleTeams: async (teamId: number) => {
				apiCalls.push(`scale_teams ${teamId}`);
				return scaleTeams.get(teamId) ?? [];
			},
			getUserProjectsUsers: async (intraId: number) => {
				apiCalls.push(`projects_users ${intraId}`);
				return remoteProjectsUsers;
			},
		};

		const noop = () => {};
		service = new IntraProjectResultService(
			fakeResultsRepository as any,
			{ insert: async (row: MiIntraProjectNote) => { notes.push(row); } } as any,
			fakeProgressesRepository as any,
			{ findOne: async () => ({ userId: 'u1', intraId: 1, intraLogin: 'tomsato' }) } as any,
			fakeIntraApiService as any,
			{ createNotification: (userId: string, type: string, data: Record<string, unknown>) => { notifications.push({ userId, type, data }); } } as any,
			{ gen: () => `id${++seq}` } as any,
			{ getLogger: () => ({ info: noop, warn: noop, error: noop, debug: noop }) } as any,
		);
	});

	describe('syncResults', () => {
		test('点数が付いた課題を保存し、新しく結果が出た課題を通知してメンバーと outstanding を取得する', async () => {
			teams.set(10, { id: 10, users: [{ id: 1, login: 'tomsato' }, { id: 2, login: 'hana' }] });
			scaleTeams.set(10, [{ flag: { name: 'Outstanding project' } }, { flag: { name: 'Ok' } }]);

			await service.syncResults('u1', [pu(1), pu(2, { status: 'in_progress', final_mark: null })]);

			expect(results).toHaveLength(1);
			expect(results[0]).toMatchObject({
				userId: 'u1',
				projectsUserId: 1,
				projectSlug: 'project-1',
				finalMark: 100,
				validated: true,
				members: [{ intraId: 1, login: 'tomsato' }, { intraId: 2, login: 'hana' }],
				outstandingCount: 1,
				detailsTeamId: 10,
			});
			expect(notifications).toEqual([{
				userId: 'u1',
				type: 'intraProjectFinished',
				data: { intraProjectResultId: results[0].id, projectSlug: 'project-1', projectName: 'Project 1', finalMark: 100, validated: true },
			}]);
		});

		test('初めての同期では、これまでの結果を保存するだけで通知しない', async () => {
			resultsSyncedAt = null;

			await service.syncResults('u1', [pu(1)]);

			expect(results).toHaveLength(1);
			expect(notifications).toEqual([]);
			// 提出ごとの結果だけは取得する
			expect(apiCalls).toEqual(['projects_users 1']);
			expect(resultsSyncedAt).toEqual(expect.any(Date));
		});

		test('提出ごとの結果を保存し、最後のチームが変わるまで取得し直さない', async () => {
			resultsSyncedAt = null;
			remoteProjectsUsers = [{
				...pu(1),
				teams: [
					{ id: 10, final_mark: 125, 'validated?': true, closed_at: '2026-10-18T10:00:00.000Z', users: [{ id: 1, login: 'tomsato' }] },
					{ id: 9, final_mark: 0, 'validated?': false, closed_at: '2026-09-12T10:00:00.000Z', users: [{ id: 1, login: 'tomsato' }, { id: 2, login: 'hana' }] },
					{ id: 11, final_mark: null, 'validated?': null, users: [] },
				],
			}];

			await service.syncResults('u1', [pu(1)]);

			expect(results[0].submissionsTeamId).toBe(10);
			expect(results[0].submissions).toEqual([
				{ teamId: 9, finalMark: 0, validated: false, markedAt: '2026-09-12T10:00:00.000Z', members: [{ intraId: 1, login: 'tomsato' }, { intraId: 2, login: 'hana' }], outstandingCount: null },
				{ teamId: 10, finalMark: 125, validated: true, markedAt: '2026-10-18T10:00:00.000Z', members: [{ intraId: 1, login: 'tomsato' }], outstandingCount: null },
			]);

			apiCalls = [];
			await service.syncResults('u1', [pu(1)]);
			expect(apiCalls).toEqual([]);
		});

		test('提出ごとの結果を取得できなくても、課題の結果は保存する', async () => {
			resultsSyncedAt = null;
			remoteProjectsUsers = [{ ...pu(1) }];

			await service.syncResults('u1', [pu(1)]);

			expect(results).toHaveLength(1);
			expect(results[0]).toMatchObject({ submissions: [], submissionsTeamId: null });
		});

		test('結果が変わらなければ通知せず、intra から消えた結果は消す', async () => {
			await service.syncResults('u1', [pu(1), pu(2)]);
			notifications = [];

			await service.syncResults('u1', [pu(1)]);

			expect(results.map(r => r.projectsUserId)).toEqual([1]);
			expect(notifications).toEqual([]);
		});
	});

	describe('prepareNote', () => {
		beforeEach(() => {
			results.push({
				id: 'r1', userId: 'u1', user: null, projectsUserId: 1, projectSlug: 'webserv', projectName: 'webserv',
				finalMark: 125, validated: true, markedAt: NOW, teamId: 10,
				members: [], outstandingCount: null, detailsTeamId: null, updatedAt: NOW,
				submissions: [
					{ teamId: 9, finalMark: 80, validated: false, markedAt: '2026-10-02T10:00:00.000Z', members: [{ intraId: 1, login: 'tomsato' }, { intraId: 3, login: 'ken' }], outstandingCount: null },
					{ teamId: 10, finalMark: 125, validated: true, markedAt: '2026-10-18T10:00:00.000Z', members: [], outstandingCount: null },
				],
				submissionsTeamId: 10,
			});
		});

		test('結果を指定しなければ何もしない', async () => {
			expect(await service.prepareNote({ id: 'u1' }, null, { hasPoll: false })).toBeNull();
		});

		test('メンバーと outstanding を取得して、投稿した時点の結果をノートに付ける', async () => {
			teams.set(10, { id: 10, users: [{ id: 1, login: 'tomsato' }, { id: 2, login: 'hana' }], scale_teams: [{ flag: { name: 'Outstanding project' } }] });

			const onInserted = await service.prepareNote({ id: 'u1' }, 'r1', { text: null, hasPoll: false });
			await onInserted!({ id: 'n1' } as MiNote);

			// チームに評価が含まれていれば、評価を別に取得しない
			expect(apiCalls).toEqual(['team 10']);
			expect(notes).toEqual([{
				noteId: 'n1',
				userId: 'u1',
				projectSlug: 'webserv',
				projectName: 'webserv',
				finalMark: 125,
				validated: true,
				outstandingCount: 1,
				members: [{ intraId: 1, login: 'tomsato' }, { intraId: 2, login: 'hana' }],
				attemptNumber: 2,
				attemptCount: 2,
				markedAt: NOW,
				intraLogin: 'tomsato',
			}]);
		});

		test('前の提出を選ぶと、その提出の点数・メンバーと outstanding を付ける', async () => {
			scaleTeams.set(9, [{ flag: { name: 'Outstanding project' } }]);

			const onInserted = await service.prepareNote({ id: 'u1' }, 'r1', { text: null, hasPoll: false }, 9);
			await onInserted!({ id: 'n1' } as MiNote);

			expect(apiCalls).toEqual(['scale_teams 9']);
			expect(notes[0]).toMatchObject({
				finalMark: 80,
				validated: false,
				outstandingCount: 1,
				members: [{ intraId: 1, login: 'tomsato' }, { intraId: 3, login: 'ken' }],
				attemptNumber: 1,
				attemptCount: 2,
				markedAt: new Date('2026-10-02T10:00:00.000Z'),
				intraLogin: 'tomsato',
			});
			// 取得した outstanding の数は保存して、次は取得しない
			expect(results[0].submissions[0].outstandingCount).toBe(1);
		});

		test('提出の一覧に無いチームは付けられない', async () => {
			await expect(service.prepareNote({ id: 'u1' }, 'r1', { hasPoll: false }, 999)).rejects.toBeInstanceOf(IntraProjectResultNotFoundError);
		});

		test('チームを取得できなければ、自分だけをメンバーにして outstanding は不明にする', async () => {
			const onInserted = await service.prepareNote({ id: 'u1' }, 'r1', { text: 'やった', hasPoll: false });
			await onInserted!({ id: 'n1' } as MiNote);

			expect(notes[0]).toMatchObject({ outstandingCount: null, members: [{ intraId: 1, login: 'tomsato' }] });
		});

		test('他人の結果と、本文などの無いリノートには付けられない', async () => {
			await expect(service.prepareNote({ id: 'u2' }, 'r1', { hasPoll: false })).rejects.toBeInstanceOf(IntraProjectResultNotFoundError);
			await expect(service.prepareNote({ id: 'u1' }, 'r1', { renoteId: 'n0', hasPoll: false })).rejects.toBeInstanceOf(IntraProjectResultNotAttachableError);
		});
	});
});
