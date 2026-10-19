/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// DB を使わず、依存をすべて差し替えて PairRecruitmentService の主要な分岐を確認する

import { beforeEach, describe, expect, test } from 'vitest';
import { FindOperator, QueryFailedError } from 'typeorm';
import { PairRecruitmentService } from '@/core/pair/PairRecruitmentService.js';
import { PairRecruitmentError, PAIR_RECRUITMENT_LIFETIME_MS } from '@/core/pair/pair-recruitment.js';
import type { Config } from '@/config.js';
import type { MiLocalUser } from '@/models/User.js';
import type { MiPairRecruitment } from '@/models/PairRecruitment.js';
import type { MiPairMember } from '@/models/PairMember.js';
import type { MiIntraProject } from '@/models/IntraProject.js';
import type { MiIntraUserProgress } from '@/models/IntraUserProgress.js';

type Row = Record<string, unknown>;

/** TypeORM の where (FindOperator を含む) を 1 行に当てはめる */
function matches(row: Row, where: Row): boolean {
	return Object.entries(where).every(([key, cond]) => {
		const value = row[key];
		if (cond instanceof FindOperator) {
			const operand = cond.value as unknown;
			switch (cond.type) {
				case 'lessThan': return (value as number | Date) < (operand as number | Date);
				case 'lessThanOrEqual': return (value as number | Date) <= (operand as number | Date);
				case 'moreThan': return (value as number | Date) > (operand as number | Date);
				case 'in': return (operand as unknown[]).includes(value);
				default: throw new Error(`unsupported operator ${cond.type}`);
			}
		}
		return value === cond;
	});
}

/** update の set を当てはめる。() => '"col" + 1' の形の式にも対応する */
function applySet(row: Row, set: Row) {
	for (const [key, v] of Object.entries(set)) {
		if (typeof v === 'function') {
			const expr = (v as () => string)();
			const m = /^"(\w+)" ([+-]) (\d+)$/.exec(expr);
			if (m == null) throw new Error(`unsupported expression ${expr}`);
			const delta = parseInt(m[3], 10) * (m[2] === '+' ? 1 : -1);
			row[key] = (row[m[1]] as number) + delta;
		} else {
			row[key] = v;
		}
	}
}

function fakeRepository<T extends Row>(rows: T[]) {
	return {
		findOneBy: async (where: Row) => {
			const found = rows.find(r => matches(r, where));
			return found ? { ...found } : null;
		},
		findOne: async (opts: { where: Row }) => {
			const found = rows.find(r => matches(r, opts.where));
			return found ? { ...found } : null;
		},
		findBy: async (where: Row) => rows.filter(r => matches(r, where)).map(r => ({ ...r })),
		find: async (opts: { where: Row; take?: number }) => rows.filter(r => matches(r, opts.where)).slice(0, opts.take ?? Infinity).map(r => ({ ...r })),
		existsBy: async (where: Row) => rows.some(r => matches(r, where)),
		countBy: async (where: Row) => rows.filter(r => matches(r, where)).length,
		insert: async (row: T) => {
			if ('recruitmentId' in row && rows.some(r => r.recruitmentId === row.recruitmentId && r.userId === row.userId)) {
				throw new QueryFailedError('INSERT', [], Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }));
			}
			rows.push({ ...row });
		},
		update: async (where: Row, set: Row) => {
			const targets = rows.filter(r => matches(r, where));
			for (const r of targets) applySet(r, set);
			return { affected: targets.length };
		},
		delete: async (where: Row) => {
			const targets = rows.filter(r => matches(r, where));
			for (const t of targets) rows.splice(rows.indexOf(t), 1);
			return { affected: targets.length };
		},
	};
}

const now = new Date('2026-10-18T03:00:00.000Z');

function localUser(id: string): MiLocalUser {
	return { id, username: id, host: null, isBot: false, isCat: false, isSuspended: false, isDeleted: false } as unknown as MiLocalUser;
}

function project(slug: string, overrides: Partial<MiIntraProject> = {}): MiIntraProject {
	return {
		id: `project-${slug}`,
		projectId: 1,
		slug,
		name: slug,
		campusId: 26,
		cursusId: 21,
		sessionId: 1,
		minGroupSize: null,
		maxGroupSize: 2,
		requiredQuests: [],
		requiredAnyQuests: [],
		forbiddenQuests: [],
		exclusiveProjects: [],
		requiredProjects: [],
		updatedAt: now,
		...overrides,
	};
}

function progress(userId: string, overrides: Partial<MiIntraUserProgress> = {}): MiIntraUserProgress {
	return {
		userId,
		user: null,
		campusId: 26,
		projectStatuses: {},
		validatedQuests: [],
		projectsSyncedAt: now,
		questsSyncedAt: now,
		...overrides,
	};
}

describe('PairRecruitmentService', () => {
	let seq: number;
	let recruitments: MiPairRecruitment[];
	let members: MiPairMember[];
	let projects: MiIntraProject[];
	let progresses: MiIntraUserProgress[];
	let users: Row[];
	let profiles: Row[];
	let blocking: Map<string, Set<string>>;
	let notifications: { notifieeId: string; type: string; data: Row; notifierId?: string | null }[];
	let notes: { userId: string; text: string; visibility: string }[];
	let noteError: Error | null;
	let config: Partial<Config>;
	let service: PairRecruitmentService;

	const owner = localUser('owner');
	const alice = localUser('alice');
	const bob = localUser('bob');

	beforeEach(() => {
		seq = 0;
		recruitments = [];
		members = [];
		projects = [
			project('cub3d'),
			project('ft_transcendence', { minGroupSize: 4, maxGroupSize: 5 }),
			project('libft', { maxGroupSize: 1 }),
			project('minishell', { exclusiveProjects: ['minishell'] }),
		];
		progresses = [progress('owner'), progress('alice'), progress('bob')];
		users = [owner, alice, bob].map(u => ({ ...u }));
		profiles = [owner, alice, bob].map(u => ({ userId: u.id, pairInvitationsEnabled: true }));
		blocking = new Map();
		notifications = [];
		notes = [];
		noteError = null;
		config = {
			url: 'https://42times.example',
			intra: { clientId: 'cid', clientSecret: 'csecret', cursusId: 21, apiBaseUrl: 'https://api.intra.42.fr' } as Config['intra'],
		};

		const noop = () => {};
		const blockingCache = {
			fetch: async (userId: string) => blocking.get(userId) ?? new Set<string>(),
		};
		const blockedCache = {
			fetch: async (userId: string) => new Set([...blocking.entries()].filter(([, set]) => set.has(userId)).map(([id]) => id)),
		};

		const recruitmentsRepository = {
			...fakeRepository(recruitments as unknown as Row[]),
			// getProjects の課題ごとの募集の数 (unnest した集計) をまねる
			query: async (_sql: string, [campusId, at]: [number, Date]) => {
				const counts = new Map<string, number>();
				for (const r of recruitments) {
					if (r.campusId !== campusId || r.status !== 'open' || r.expiresAt <= at) continue;
					for (const slug of r.projectSlugs) counts.set(slug, (counts.get(slug) ?? 0) + 1);
				}
				return [...counts].map(([slug, count]) => ({ slug, count: String(count) }));
			},
		};

		service = new PairRecruitmentService(
			config as Config,
			recruitmentsRepository as any,
			fakeRepository(members as unknown as Row[]) as any,
			fakeRepository(projects as unknown as Row[]) as any,
			fakeRepository(progresses as unknown as Row[]) as any,
			fakeRepository(users) as any,
			{ ...fakeRepository(profiles), find: async (opts: { where: Row }) => profiles.filter(r => matches(r, opts.where)).map(r => ({ ...r })) } as any,
			{ gen: () => `id${String(++seq).padStart(4, '0')}` } as any,
			{ userBlockingCache: blockingCache, userBlockedCache: blockedCache } as any,
			{} as any,
			{
				createNotification: (notifieeId: string, type: string, data: Row, notifierId?: string | null) => {
					notifications.push({ notifieeId, type, data, notifierId });
				},
			} as any,
			{
				create: async (user: { id: string }, data: { text: string; visibility: string }) => {
					if (noteError) throw noteError;
					notes.push({ userId: user.id, text: data.text, visibility: data.visibility });
					return { id: `note${notes.length}` };
				},
			} as any,
			{ getLogger: () => ({ info: noop, warn: noop, error: noop, debug: noop }) } as any,
		);
	});

	async function expectCode(promise: Promise<unknown>, code: string) {
		await expect(promise).rejects.toSatisfy((err: unknown) => err instanceof PairRecruitmentError && err.code === code);
	}

	async function createRecruitment(overrides: Partial<Parameters<PairRecruitmentService['create']>[1]> & { projectSlug?: string } = {}) {
		const { projectSlug, ...rest } = overrides;
		return await service.create(owner, {
			projectSlugs: [projectSlug ?? 'cub3d'],
			teamSize: 2,
			startTiming: 'now',
			announce: false,
			...rest,
		}, now);
	}

	describe('create', () => {
		test('募集を作成し、作成から 14 日後を期限にする', async () => {
			const r = await createRecruitment({ comment: '  よろしく  ' });

			expect(recruitments).toHaveLength(1);
			expect(r).toMatchObject({
				userId: 'owner',
				campusId: 26,
				projectSlug: 'cub3d',
				projectName: 'cub3d',
				minGroupSize: 2,
				maxGroupSize: 2,
				teamSize: 2,
				comment: 'よろしく',
				status: 'open',
				acceptedCount: 0,
				noteId: null,
			});
			expect(r.expiresAt.getTime()).toBe(now.getTime() + PAIR_RECRUITMENT_LIFETIME_MS);
			expect(notes).toEqual([]);
		});

		test('告知するなら公開のノートを投稿し、noteId を保存する', async () => {
			const r = await createRecruitment({ announce: true });

			expect(notes).toHaveLength(1);
			expect(notes[0].visibility).toBe('public');
			expect(notes[0].text).toContain('cub3d');
			expect(notes[0].text).toContain(`https://42times.example/pair/${r.id}`);
			expect(r.noteId).toBe('note1');
			expect(recruitments[0].noteId).toBe('note1');
		});

		test('告知に失敗しても募集は残す', async () => {
			noteError = new Error('rate limit');
			const r = await createRecruitment({ announce: true });

			expect(r.noteId).toBeNull();
			expect(recruitments).toHaveLength(1);
		});

		test('学内SNSモードでなければ使えない', async () => {
			config.intra = undefined;
			await expectCode(createRecruitment(), 'unavailable');
		});

		test('削除の処理中のユーザーは作成できない', async () => {
			await expectCode(service.create({ ...owner, isDeleted: true } as MiLocalUser, { projectSlugs: ['cub3d'], teamSize: 2, startTiming: 'now', announce: false }, now), 'unavailable');
		});

		test('キャンパスが分からなければ作成できない', async () => {
			progresses.splice(0, progresses.length);
			await expectCode(createRecruitment(), 'noCampus');
		});

		test('別のキャンパスの課題は選べない', async () => {
			progresses[0].campusId = 1;
			await expectCode(createRecruitment(), 'noSuchProject');
		});

		test('1 人の課題と、人数の範囲の外は作成できない', async () => {
			await expectCode(createRecruitment({ projectSlug: 'libft' }), 'notPairProject');
			await expectCode(createRecruitment({ projectSlug: 'ft_transcendence', teamSize: 3 }), 'invalidTeamSize');
			await expectCode(createRecruitment({ teamSize: 3 }), 'invalidTeamSize');
		});

		test('作成者がその課題に取り組めなければ作成できない', async () => {
			progresses[0].projectStatuses = { cub3d: { status: 'finished', validated: true } };
			await expectCode(createRecruitment(), 'projectNotAvailable');
		});

		test('取り組み中の課題なら作成できる', async () => {
			progresses[0].projectStatuses = { cub3d: { status: 'in_progress', validated: null } };
			await createRecruitment();
			expect(recruitments).toHaveLength(1);
		});

		test('募集中の募集は 5 件まで (締め切ったものと期限切れは数えない)', async () => {
			for (let i = 0; i < 5; i++) await createRecruitment();
			await expectCode(createRecruitment(), 'tooManyOpenRecruitments');

			recruitments[0].status = 'closed';
			recruitments[1].expiresAt = new Date(now.getTime() - 1);
			await createRecruitment();
			await createRecruitment();
			await expectCode(createRecruitment(), 'tooManyOpenRecruitments');
		});

		test('日付の指定が正しくなければ作成できない', async () => {
			await expectCode(createRecruitment({ startTiming: 'date', startDate: '2026-02-30' }), 'invalidStartDate');
			const r = await createRecruitment({ startTiming: 'date', startDate: '2026-10-25' });
			expect(r.startDate).toBe('2026-10-25');
		});
	});

	describe('apply', () => {
		test('参加希望を送り、作成者に通知する', async () => {
			const r = await createRecruitment();
			await service.apply(alice, r.id, undefined, now);

			expect(members).toEqual([expect.objectContaining({ recruitmentId: r.id, userId: 'alice', status: 'pending' })]);
			expect(notifications).toEqual([{
				notifieeId: 'owner',
				type: 'pairJoinRequested',
				data: { pairRecruitmentId: r.id, projectSlug: 'cub3d', projectName: 'cub3d' },
				notifierId: 'alice',
			}]);
		});

		test('同じ募集に二重に送れない', async () => {
			const r = await createRecruitment();
			await service.apply(alice, r.id, undefined, now);
			await expectCode(service.apply(alice, r.id, undefined, now), 'alreadyApplied');
		});

		test('同時に送られて一意制約に当たった場合も alreadyApplied', async () => {
			const r = await createRecruitment();
			await Promise.all([
				service.apply(alice, r.id, undefined, now),
				expectCode(service.apply(alice, r.id, undefined, now), 'alreadyApplied'),
			]);
			expect(members).toHaveLength(1);
		});

		test('自分の募集には送れない', async () => {
			const r = await createRecruitment();
			await expectCode(service.apply(owner, r.id, undefined, now), 'cannotApplyOwn');
		});

		test('その課題を終えた人や locked の人は送れない', async () => {
			const r = await createRecruitment();
			progresses[1].projectStatuses = { cub3d: { status: 'finished', validated: true } };
			await expectCode(service.apply(alice, r.id, undefined, now), 'projectNotAvailable');
		});

		test('別のキャンパスの人からは見えない', async () => {
			const r = await createRecruitment();
			progresses[1].campusId = 1;
			await expectCode(service.apply(alice, r.id, undefined, now), 'noSuchRecruitment');
		});

		test('ブロックの関係にある人の募集は見えない', async () => {
			const r = await createRecruitment();
			blocking.set('owner', new Set(['alice']));
			await expectCode(service.apply(alice, r.id, undefined, now), 'noSuchRecruitment');
		});

		test('凍結された作成者の募集は見えない', async () => {
			const r = await createRecruitment();
			users.find(u => u.id === 'owner')!.isSuspended = true;
			await expectCode(service.apply(alice, r.id, undefined, now), 'noSuchRecruitment');
		});

		test('期限を過ぎた募集には送れない', async () => {
			const r = await createRecruitment();
			await expectCode(service.apply(alice, r.id, undefined, new Date(r.expiresAt.getTime() + 1)), 'recruitmentClosed');
		});

		test('取り下げた後はもう一度送れる', async () => {
			const r = await createRecruitment();
			await service.apply(alice, r.id, undefined, now);
			await service.withdraw(alice, r.id, now);
			await service.apply(alice, r.id, undefined, now);
			expect(members).toEqual([expect.objectContaining({ userId: 'alice', status: 'pending' })]);
		});
	});

	describe('accept / reject', () => {
		test('承認すると参加者に通知し、人数がそろったら締め切ってメンバーに通知する', async () => {
			const r = await createRecruitment();
			await service.apply(alice, r.id, undefined, now);
			await service.apply(bob, r.id, undefined, now);
			notifications.length = 0;

			const result = await service.accept(owner, r.id, 'alice', now);

			expect(result).toMatchObject({ status: 'closed', closedReason: 'full', acceptedCount: 1 });
			expect(members.map(m => [m.userId, m.status])).toEqual([['alice', 'accepted'], ['bob', 'pending']]);
			expect(notifications).toEqual([
				{ notifieeId: 'alice', type: 'pairAccepted', data: { pairRecruitmentId: r.id, projectSlug: 'cub3d', projectName: 'cub3d' }, notifierId: 'owner' },
				{ notifieeId: 'alice', type: 'pairClosed', data: { pairRecruitmentId: r.id, projectSlug: 'cub3d', projectName: 'cub3d', reason: 'full' }, notifierId: undefined },
				{ notifieeId: 'bob', type: 'pairClosed', data: { pairRecruitmentId: r.id, projectSlug: 'cub3d', projectName: 'cub3d', reason: 'full' }, notifierId: undefined },
			]);
		});

		test('同時に承認しても人数を超えない', async () => {
			const r = await createRecruitment();
			await service.apply(alice, r.id, undefined, now);
			await service.apply(bob, r.id, undefined, now);

			const results = await Promise.allSettled([
				service.accept(owner, r.id, 'alice', now),
				service.accept(owner, r.id, 'bob', now),
			]);

			expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
			expect(recruitments[0].acceptedCount).toBe(1);
			expect(members.filter(m => m.status === 'accepted')).toHaveLength(1);
			expect(members.filter(m => m.status === 'pending')).toHaveLength(1);
		});

		test('人数がそろうまでは募集中のまま', async () => {
			progresses.push(progress('carol'));
			users.push({ ...localUser('carol') });
			const r = await createRecruitment({ projectSlug: 'ft_transcendence', teamSize: 4 });
			await service.apply(alice, r.id, undefined, now);

			const result = await service.accept(owner, r.id, 'alice', now);
			expect(result).toMatchObject({ status: 'open', acceptedCount: 1 });
		});

		test('作成者以外は承認できない (参加希望を送っていない人には募集が無いものとして返す)', async () => {
			const r = await createRecruitment();
			await service.apply(alice, r.id, undefined, now);
			await expectCode(service.accept(bob, r.id, 'alice', now), 'noSuchRecruitment');
			await expectCode(service.reject(bob, r.id, 'alice', now), 'noSuchRecruitment');
			await service.apply(bob, r.id, undefined, now);
			await expectCode(service.accept(bob, r.id, 'alice', now), 'notOwner');
			await expectCode(service.reject(bob, r.id, 'alice', now), 'notOwner');
		});

		test('承認の前に locked や finished になった人は承認できない', async () => {
			const r = await createRecruitment();
			await service.apply(alice, r.id, undefined, now);
			progresses[1].projectStatuses = { cub3d: { status: 'finished', validated: true } };

			await expectCode(service.accept(owner, r.id, 'alice', now), 'applicantNotAvailable');
			expect(members[0].status).toBe('pending');
		});

		test('凍結された人は承認できない', async () => {
			const r = await createRecruitment();
			await service.apply(alice, r.id, undefined, now);
			users.find(u => u.id === 'alice')!.isSuspended = true;

			await expectCode(service.accept(owner, r.id, 'alice', now), 'applicantNotAvailable');
		});

		test('参加希望が無い人は承認できない', async () => {
			const r = await createRecruitment();
			await expectCode(service.accept(owner, r.id, 'alice', now), 'noSuchApplication');
		});

		test('見送りは通知せず、見送られた人は再び送れない', async () => {
			const r = await createRecruitment();
			await service.apply(alice, r.id, undefined, now);
			notifications.length = 0;

			await service.reject(owner, r.id, 'alice', now);

			expect(members[0].status).toBe('rejected');
			expect(notifications).toEqual([]);
			await expectCode(service.apply(alice, r.id, undefined, now), 'rejectedBefore');
			await expectCode(service.accept(owner, r.id, 'alice', now), 'noSuchApplication');
		});
	});

	describe('withdraw / close', () => {
		test('承認済みの人が取り下げると、承認済みの人数を戻す', async () => {
			const r = await createRecruitment({ projectSlug: 'ft_transcendence', teamSize: 4 });
			await service.apply(alice, r.id, undefined, now);
			await service.accept(owner, r.id, 'alice', now);

			const result = await service.withdraw(alice, r.id, now);

			expect(result.acceptedCount).toBe(0);
			expect(members[0].status).toBe('withdrawn');
		});

		test('参加していなければ取り下げられない', async () => {
			const r = await createRecruitment();
			await expectCode(service.withdraw(alice, r.id, now), 'noSuchRecruitment');
			await expectCode(service.withdraw(owner, r.id, now), 'notMember');
			await service.apply(alice, r.id, undefined, now);
			await service.reject(owner, r.id, 'alice', now);
			await expectCode(service.withdraw(alice, r.id, now), 'notMember');
		});

		test('締め切った後は取り下げられない', async () => {
			const r = await createRecruitment();
			await service.apply(alice, r.id, undefined, now);
			await service.close(owner, r.id, now);
			await expectCode(service.withdraw(alice, r.id, now), 'recruitmentClosed');
		});

		test('作成者が締め切ると、作成者以外のメンバーに通知する (見送った人と取り下げた人には通知しない)', async () => {
			progresses.push(progress('carol'), progress('dave'));
			users.push({ ...localUser('carol') }, { ...localUser('dave') });
			const r = await createRecruitment({ projectSlug: 'ft_transcendence', teamSize: 5 });
			await service.apply(alice, r.id, undefined, now);
			await service.apply(bob, r.id, undefined, now);
			await service.apply(localUser('carol'), r.id, undefined, now);
			await service.apply(localUser('dave'), r.id, undefined, now);
			await service.accept(owner, r.id, 'alice', now);
			await service.reject(owner, r.id, 'carol', now);
			await service.withdraw(localUser('dave'), r.id, now);
			notifications.length = 0;

			const result = await service.close(owner, r.id, now);

			expect(result).toMatchObject({ status: 'closed', closedReason: 'manual' });
			expect(notifications.map(n => [n.notifieeId, n.type, n.data.reason])).toEqual([
				['alice', 'pairClosed', 'manual'],
				['bob', 'pairClosed', 'manual'],
			]);
		});

		test('作成者以外は締め切れず、締め切った募集はもう一度締め切れない', async () => {
			const r = await createRecruitment();
			await expectCode(service.close(alice, r.id, now), 'noSuchRecruitment');
			await service.apply(alice, r.id, undefined, now);
			await expectCode(service.close(alice, r.id, now), 'notOwner');
			await service.close(owner, r.id, now);
			await expectCode(service.close(owner, r.id, now), 'recruitmentClosed');
		});
	});

	describe('closeExpired', () => {
		test('期限を過ぎた募集を締め切り、作成者とメンバーに通知する', async () => {
			const expired = await createRecruitment();
			const active = await service.create(owner, { projectSlugs: ['cub3d'], teamSize: 2, startTiming: 'now', announce: false }, new Date(now.getTime() + 1000 * 60 * 60 * 24 * 7));
			await service.apply(alice, expired.id, undefined, now);
			notifications.length = 0;

			const later = new Date(expired.expiresAt.getTime() + 1);
			expect(await service.closeExpired(later)).toBe(1);

			expect(recruitments.find(r => r.id === expired.id)).toMatchObject({ status: 'closed', closedReason: 'expired', closedAt: later });
			expect(recruitments.find(r => r.id === active.id)!.status).toBe('open');
			expect(notifications.map(n => [n.notifieeId, n.type, n.data.reason])).toEqual([
				['alice', 'pairClosed', 'expired'],
				['owner', 'pairClosed', 'expired'],
			]);

			// 2 回目は何もしない
			expect(await service.closeExpired(later)).toBe(0);
		});
	});

	describe('getProjects', () => {
		test('2 人以上の課題だけを、取り組める課題を上にして返す', async () => {
			progresses[0].projectStatuses = { minishell: { status: 'finished', validated: true }, cub3d: { status: 'in_progress', validated: null } };
			for (let i = 0; i < 3; i++) await createRecruitment();
			// 締め切った募集は数えない
			await createRecruitment({ projectSlug: 'ft_transcendence', teamSize: 4 });
			recruitments[3].status = 'closed';

			const result = await service.getProjects(owner, now);

			expect(result).toEqual([
				{ slug: 'ft_transcendence', name: 'ft_transcendence', minGroupSize: 4, maxGroupSize: 5, state: 'available', reason: null, openRecruitmentCount: 0 },
				{ slug: 'cub3d', name: 'cub3d', minGroupSize: 2, maxGroupSize: 2, state: 'in_progress', reason: 'registered', openRecruitmentCount: 3 },
				{ slug: 'minishell', name: 'minishell', minGroupSize: 2, maxGroupSize: 2, state: 'finished', reason: 'validated', openRecruitmentCount: 0 },
			]);
		});

		test('キャンパスが分からなければ空', async () => {
			progresses.splice(0, progresses.length);
			expect(await service.getProjects(owner, now)).toEqual([]);
		});
	});

	describe('複数の課題', () => {
		beforeEach(() => {
			projects.push(
				project('webserv', { maxGroupSize: 3 }),
				project('ft_irc', { maxGroupSize: 3 }),
			);
		});

		async function createMulti(overrides: Partial<Parameters<PairRecruitmentService['create']>[1]> = {}) {
			return await service.create(owner, {
				projectSlugs: ['webserv', 'ft_irc'],
				teamSize: 3,
				startTiming: 'now',
				announce: false,
				...overrides,
			}, now);
		}

		test('課題をまとめて募集し、名前をつなぎ、人数はどの課題でも組める範囲にする', async () => {
			const r = await createMulti();
			expect(r).toMatchObject({
				projectSlug: 'webserv',
				projectName: 'webserv / ft_irc',
				projectSlugs: ['webserv', 'ft_irc'],
				minGroupSize: 2,
				maxGroupSize: 3,
			});
			expect(r.projects.map(p => p.slug)).toEqual(['webserv', 'ft_irc']);

			// cub3d は 2 人まで
			await expectCode(createMulti({ projectSlugs: ['webserv', 'cub3d'] }), 'invalidTeamSize');
			await createMulti({ projectSlugs: ['webserv', 'cub3d'], teamSize: 2 });
			// 人数の範囲が重ならない
			await expectCode(createMulti({ projectSlugs: ['cub3d', 'ft_transcendence'], teamSize: 2 }), 'noCommonTeamSize');
		});

		test('重複・多すぎる課題・取り組めない課題は選べない', async () => {
			await expectCode(createMulti({ projectSlugs: ['webserv', 'webserv'] }), 'invalidProjects');
			await expectCode(createMulti({ projectSlugs: ['webserv', 'ft_irc', 'cub3d', 'minishell', 'ft_transcendence'] }), 'tooManyProjects');
			await expectCode(createMulti({ projectSlugs: [] }), 'invalidProjects');
			progresses[0].projectStatuses = { ft_irc: { status: 'finished', validated: true } };
			await expectCode(createMulti(), 'projectNotAvailable');
		});

		test('やりたい課題を選んで参加希望を送る。選ばなければ取り組める課題すべて', async () => {
			const r = await createMulti();
			await service.apply(alice, r.id, ['ft_irc'], now);
			progresses[2].projectStatuses = { webserv: { status: 'finished', validated: true } };
			await service.apply(bob, r.id, undefined, now);

			expect(members.map(m => [m.userId, m.wantedProjectSlugs])).toEqual([['alice', ['ft_irc']], ['bob', ['ft_irc']]]);
		});

		test('募集に無い課題や、取り組めない課題をやりたい課題にはできない', async () => {
			const r = await createMulti();
			await expectCode(service.apply(alice, r.id, ['cub3d'], now), 'invalidWantedProjects');
			progresses[1].projectStatuses = { webserv: { status: 'finished', validated: true } };
			await expectCode(service.apply(alice, r.id, ['webserv', 'ft_irc'], now), 'projectNotAvailable');
			progresses[1].projectStatuses = { webserv: { status: 'finished', validated: true }, ft_irc: { status: 'finished', validated: true } };
			await expectCode(service.apply(alice, r.id, undefined, now), 'projectNotAvailable');
		});

		test('やりたい課題のどれかに取り組めれば承認できる', async () => {
			const r = await createMulti();
			await service.apply(alice, r.id, ['webserv', 'ft_irc'], now);
			progresses[1].projectStatuses = { webserv: { status: 'finished', validated: true } };
			await service.accept(owner, r.id, 'alice', now);
			expect(members[0].status).toBe('accepted');
		});
	});

	describe('update', () => {
		beforeEach(() => {
			projects.push(
				project('webserv', { maxGroupSize: 3 }),
				project('ft_irc', { maxGroupSize: 3 }),
			);
		});

		test('ひとことと時期と人数を変えられる', async () => {
			const r = await createRecruitment({ projectSlug: 'webserv', comment: 'a' });
			const updated = await service.update(owner, r.id, { teamSize: 3, startTiming: 'date', startDate: '2026-10-25', comment: '  b  ' }, now);
			expect(updated).toMatchObject({ teamSize: 3, startTiming: 'date', startDate: '2026-10-25', comment: 'b' });

			const kept = await service.update(owner, r.id, { teamSize: 2 }, now);
			expect(kept).toMatchObject({ teamSize: 2, startTiming: 'date', startDate: '2026-10-25', comment: 'b' });
		});

		test('課題を足すと複数の課題の募集になる。外すと、その課題だけをやりたい参加希望は取り下げになって通知される', async () => {
			const r = await createRecruitment({ projectSlug: 'webserv' });
			await service.apply(alice, r.id, undefined, now);

			const multi = await service.update(owner, r.id, { projectSlugs: ['webserv', 'ft_irc'] }, now);
			expect(multi.projectName).toBe('webserv / ft_irc');
			await service.apply(bob, r.id, ['ft_irc'], now);
			notifications.splice(0);

			const single = await service.update(owner, r.id, { projectSlugs: ['webserv'] }, now);
			expect(single.projectSlugs).toEqual(['webserv']);
			expect(members.find(m => m.userId === 'alice')?.status).toBe('pending');
			expect(members.find(m => m.userId === 'bob')?.status).toBe('withdrawn');
			expect(notifications).toEqual([expect.objectContaining({ notifieeId: 'bob', type: 'pairApplicationCancelled', notifierId: 'owner' })]);
		});

		test('参加が決まった人のやりたい課題をすべて外すことと、参加が決まった人数より少なくすることはできない', async () => {
			const r = await createRecruitment({ projectSlugs: ['webserv', 'ft_irc'], teamSize: 3 });
			await service.apply(alice, r.id, ['ft_irc'], now);
			await service.accept(owner, r.id, 'alice', now);

			await expectCode(service.update(owner, r.id, { projectSlugs: ['webserv'] }, now), 'memberWouldLoseProject');
			await expectCode(service.update(owner, r.id, { teamSize: 1 }, now), 'invalidTeamSize');
		});

		test('人数を参加が決まった人数ちょうどにすると締め切る', async () => {
			const r = await createRecruitment({ projectSlug: 'webserv', teamSize: 3 });
			await service.apply(alice, r.id, undefined, now);
			await service.accept(owner, r.id, 'alice', now);

			const closed = await service.update(owner, r.id, { teamSize: 2 }, now);
			expect(closed).toMatchObject({ status: 'closed', closedReason: 'full' });
		});

		test('作成者以外と、締め切った募集は編集できない', async () => {
			const r = await createRecruitment();
			await service.apply(alice, r.id, undefined, now);
			await expectCode(service.update(alice, r.id, { comment: 'x' }, now), 'notOwner');
			await expectCode(service.update(bob, r.id, { comment: 'x' }, now), 'noSuchRecruitment');
			await service.close(owner, r.id, now);
			await expectCode(service.update(owner, r.id, { comment: 'x' }, now), 'recruitmentClosed');
		});
	});

	describe('invite', () => {
		test('招待すると通知し、招待された人は参加希望を送るか断れる', async () => {
			const r = await createRecruitment();
			await service.invite(owner, r.id, ['alice', 'bob'], now);

			expect(members.map(m => [m.userId, m.status])).toEqual([['alice', 'invited'], ['bob', 'invited']]);
			expect(notifications.map(n => [n.notifieeId, n.type, n.notifierId])).toEqual([['alice', 'pairInvited', 'owner'], ['bob', 'pairInvited', 'owner']]);

			await service.apply(alice, r.id, undefined, now);
			await service.decline(bob, r.id, now);
			expect(members.map(m => [m.userId, m.status])).toEqual([['alice', 'pending'], ['bob', 'declined']]);

			// 断った後でも送れる
			await service.apply(bob, r.id, undefined, now);
			expect(members[1].status).toBe('pending');
		});

		test('招待を受け取らない人・取り組めない人・別のキャンパスの人・参加希望を送った人は招待できない', async () => {
			const r = await createRecruitment();
			profiles[1].pairInvitationsEnabled = false;
			await expectCode(service.invite(owner, r.id, ['alice'], now), 'cannotInvite');

			progresses[2].projectStatuses = { cub3d: { status: 'finished', validated: true } };
			await expectCode(service.invite(owner, r.id, ['bob'], now), 'cannotInvite');

			progresses[2].projectStatuses = {};
			progresses[2].campusId = 1;
			await expectCode(service.invite(owner, r.id, ['bob'], now), 'cannotInvite');

			progresses[2].campusId = 26;
			await service.apply(bob, r.id, undefined, now);
			await expectCode(service.invite(owner, r.id, ['bob'], now), 'cannotInvite');
			await expectCode(service.invite(owner, r.id, ['owner'], now), 'cannotInvite');
			// 1 人でも招待できなければ誰にも送らない
			expect(notifications.filter(n => n.type === 'pairInvited')).toEqual([]);
		});

		test('作成者以外は招待できず、招待されていない人は断れない。取り消すともう一度招待できる', async () => {
			const r = await createRecruitment();
			await service.apply(alice, r.id, undefined, now);
			await expectCode(service.invite(alice, r.id, ['bob'], now), 'notOwner');
			await expectCode(service.decline(alice, r.id, now), 'notInvited');

			await service.invite(owner, r.id, ['bob'], now);
			await service.cancelInvitation(owner, r.id, 'bob');
			expect(members.map(m => m.userId)).toEqual(['alice']);
			await expectCode(service.cancelInvitation(owner, r.id, 'alice'), 'notInvited');
			await service.invite(owner, r.id, ['bob'], now);
		});

		test('見送られた招待は取り消せず、同じ人にもう一度送れない', async () => {
			const r = await createRecruitment();
			await service.invite(owner, r.id, ['bob'], now);
			await service.decline(bob, r.id, now);
			await expectCode(service.cancelInvitation(owner, r.id, 'bob'), 'notInvited');
			await expectCode(service.invite(owner, r.id, ['bob'], now), 'cannotInvite');
		});
	});
});
