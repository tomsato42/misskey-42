/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type {
	IntraProjectsRepository,
	IntraUserProgressesRepository,
	PairMembersRepository,
	UserProfilesRepository,
	MiUser,
} from '@/models/_.js';
import type { Packed } from '@/misc/json-schema.js';
import type { MiPairRecruitment } from '@/models/PairRecruitment.js';
import type { MiIntraProject } from '@/models/IntraProject.js';
import type { MiIntraUserProgress } from '@/models/IntraUserProgress.js';
import { bindThis } from '@/decorators.js';
import { IdService } from '@/core/IdService.js';
import { judgeProjectAvailability } from '@/core/intra/intra-project.js';
import type { IntraProjectAvailabilityState } from '@/core/intra/intra-project.js';
import { bestWantedState, canSeeMember, getEffectiveState, getOwnerIntraProjectUrl, getRecruitmentSlugs } from '@/core/pair/pair-recruitment.js';
import type { PairMemberStatus, PairViewerStatus } from '@/core/pair/pair-recruitment.js';
import type { MiPairMember } from '@/models/PairMember.js';
import type { PairInviteCandidate } from '@/core/pair/PairRecruitmentService.js';
import { UserEntityService } from './UserEntityService.js';

function projectKey(campusId: number, slug: string): string {
	return `${campusId}:${slug}`;
}

/** 招待 (members ではなく invitations に出す状態) */
const INVITATION_STATUSES: PairMemberStatus[] = ['invited', 'declined'];

/** 募集の課題 (古い行で projects が空のときは、projectSlug などの列から作る) */
function getEntries(r: MiPairRecruitment) {
	if (r.projects.length > 0) return r.projects;
	return [{ slug: r.projectSlug, name: r.projectName, minGroupSize: r.minGroupSize, maxGroupSize: r.maxGroupSize }];
}

@Injectable()
export class PairRecruitmentEntityService {
	constructor(
		@Inject(DI.pairMembersRepository)
		private pairMembersRepository: PairMembersRepository,

		@Inject(DI.intraProjectsRepository)
		private intraProjectsRepository: IntraProjectsRepository,

		@Inject(DI.intraUserProgressesRepository)
		private intraUserProgressesRepository: IntraUserProgressesRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private userEntityService: UserEntityService,
		private idService: IdService,
	) {
	}

	/** 募集の課題 (キャンパスと slug の組) の intra_project をまとめて取る */
	@bindThis
	private async fetchProjects(recruitments: MiPairRecruitment[]): Promise<Map<string, MiIntraProject>> {
		if (recruitments.length === 0) return new Map();
		const projects = await this.intraProjectsRepository.findBy({
			campusId: In([...new Set(recruitments.map(r => r.campusId))]),
			slug: In([...new Set(recruitments.flatMap(r => getRecruitmentSlugs(r)))]),
		});
		return new Map(projects.map(p => [projectKey(p.campusId, p.slug), p]));
	}

	@bindThis
	private judgeState(project: MiIntraProject | undefined, progress: MiIntraUserProgress | null | undefined): IntraProjectAvailabilityState | null {
		if (project == null || progress == null) return null;
		return judgeProjectAvailability(project, progress).state;
	}

	@bindThis
	public async packMany(
		recruitments: MiPairRecruitment[],
		me: { id: MiUser['id'] },
		now = new Date(),
	): Promise<Packed<'PairRecruitment'>[]> {
		if (recruitments.length === 0) return [];
		const ids = recruitments.map(r => r.id);
		const ownIds = recruitments.filter(r => r.userId === me.id).map(r => r.id);

		const [users, projects, myProgress, myMembers, pendingCounts, wantedCounts] = await Promise.all([
			this.userEntityService.packMany(recruitments.map(r => r.user ?? r.userId), me),
			this.fetchProjects(recruitments),
			this.intraUserProgressesRepository.findOneBy({ userId: me.id }),
			this.pairMembersRepository.findBy({ recruitmentId: In(ids), userId: me.id }),
			ownIds.length > 0
				? this.pairMembersRepository.createQueryBuilder('member')
					.select('member.recruitmentId', 'recruitmentId')
					.addSelect('COUNT(*)', 'count')
					.where('member.recruitmentId IN (:...ownIds)', { ownIds })
					.andWhere('member.status = \'pending\'')
					.groupBy('member.recruitmentId')
					.getRawMany<{ recruitmentId: string; count: string }>()
				: Promise.resolve([]),
			// 課題ごとの、やりたい人の数 (参加希望中と参加中)
			this.pairMembersRepository.query(
				'SELECT m."recruitmentId" AS "recruitmentId", s.slug AS "slug", COUNT(*) AS "count" FROM "pair_member" m CROSS JOIN LATERAL unnest(m."wantedProjectSlugs") AS s(slug) WHERE m."recruitmentId" = ANY($1) AND m."status" IN (\'pending\', \'accepted\') GROUP BY m."recruitmentId", s.slug',
				[ids],
			) as Promise<{ recruitmentId: string; slug: string; count: string }[]>,
		]);

		const userMap = new Map(users.map(u => [u.id, u]));
		const myMemberMap = new Map(myMembers.map(m => [m.recruitmentId, m]));
		const wantedCountMap = new Map(wantedCounts.map(c => [`${c.recruitmentId}:${c.slug}`, parseInt(c.count, 10)]));
		const pendingCountMap = new Map(pendingCounts.map(c => [c.recruitmentId, parseInt(c.count, 10)]));

		return recruitments.map(r => {
			const state = getEffectiveState(r, now);
			const isOwner = r.userId === me.id;
			const myMember = myMemberMap.get(r.id);
			const myStatus: PairViewerStatus | null = isOwner ? 'owner' : myMember?.status ?? null;
			const entries = getEntries(r).map(e => ({
				...e,
				myState: this.judgeState(projects.get(projectKey(r.campusId, e.slug)), myProgress),
				wantedCount: wantedCountMap.get(`${r.id}:${e.slug}`) ?? 0,
			}));
			return {
				id: r.id,
				createdAt: this.idService.parse(r.id).date.toISOString(),
				expiresAt: r.expiresAt.toISOString(),
				closedAt: state.closedAt?.toISOString() ?? null,
				status: state.status,
				closedReason: state.closedReason,
				userId: r.userId,
				user: userMap.get(r.userId)!,
				project: {
					slug: r.projectSlug,
					name: r.projectName,
					minGroupSize: r.minGroupSize,
					maxGroupSize: r.maxGroupSize,
				},
				projects: entries,
				teamSize: r.teamSize,
				acceptedCount: r.acceptedCount,
				pendingCount: isOwner ? pendingCountMap.get(r.id) ?? 0 : null,
				startTiming: r.startTiming,
				startDate: r.startDate,
				comment: r.comment,
				noteId: r.noteId,
				// まとめた課題のどれかに取り組めれば、取り組める判定を返す
				myProjectState: bestWantedState(entries.map(e => e.myState)),
				myStatus,
				myWantedProjectSlugs: myMember != null && (myMember.status === 'pending' || myMember.status === 'accepted') ? myMember.wantedProjectSlugs : null,
			};
		});
	}

	/**
	 * 招待の候補を返す
	 */
	@bindThis
	public async packInviteCandidates(candidates: PairInviteCandidate[], me: { id: MiUser['id'] }): Promise<Packed<'PairInviteCandidate'>[]> {
		const users = await this.userEntityService.packMany(candidates.map(c => c.user), me);
		const userMap = new Map(users.map(u => [u.id, u]));
		return candidates.map(c => ({ user: userMap.get(c.user.id)!, projectSlugs: c.projectSlugs }));
	}

	@bindThis
	public async pack(
		recruitment: MiPairRecruitment,
		me: { id: MiUser['id'] },
		now = new Date(),
	): Promise<Packed<'PairRecruitment'>> {
		return (await this.packMany([recruitment], me, now))[0];
	}

	/**
	 * メンバーの一覧を含めて返す。承認済みのメンバーは誰にでも見せ、それ以外 (参加希望中・見送り) は作成者と本人にだけ見せる。
	 * 凍結・削除されたユーザーは出さない
	 */
	@bindThis
	public async packDetailed(
		recruitment: MiPairRecruitment,
		me: { id: MiUser['id'] },
		now = new Date(),
	): Promise<Packed<'PairRecruitmentDetailed'>> {
		const [packed, members, projects, ownerProfile, ownerProgress] = await Promise.all([
			this.pack(recruitment, me, now),
			this.pairMembersRepository.find({
				where: { recruitmentId: recruitment.id },
				relations: { user: true },
				order: { id: 'ASC' },
			}),
			this.fetchProjects([recruitment]),
			this.userProfilesRepository.findOne({ where: { userId: recruitment.userId }, select: { userId: true, intraLogin: true } }),
			this.intraUserProgressesRepository.findOne({ where: { userId: recruitment.userId }, select: { userId: true, projectStatuses: true } }),
		]);

		const visible = members.filter(m =>
			m.user != null && !m.user.isSuspended && !m.user.isDeleted &&
			canSeeMember({ viewerId: me.id, ownerId: recruitment.userId, memberUserId: m.userId, memberStatus: m.status }));

		const [users, progresses] = visible.length > 0
			? await Promise.all([
				this.userEntityService.packMany(visible.map(m => m.user ?? m.userId), me),
				this.intraUserProgressesRepository.findBy({ userId: In(visible.map(m => m.userId)) }),
			])
			: [[], []];
		const userMap = new Map(users.map(u => [u.id, u]));
		const progressMap = new Map(progresses.map(p => [p.userId, p]));
		const slugs = getRecruitmentSlugs(recruitment);
		const packMember = (m: MiPairMember) => {
			const wanted = m.wantedProjectSlugs.filter(slug => slugs.includes(slug));
			return {
				id: m.id,
				createdAt: this.idService.parse(m.id).date.toISOString(),
				updatedAt: m.updatedAt.toISOString(),
				userId: m.userId,
				user: userMap.get(m.userId)!,
				status: m.status,
				// やりたい課題のどれかに取り組めれば、取り組める判定を返す (招待中はまとめた課題すべてから)
				projectState: bestWantedState((wanted.length > 0 ? wanted : slugs).map(slug => this.judgeState(projects.get(projectKey(recruitment.campusId, slug)), progressMap.get(m.userId)))),
				wantedProjectSlugs: wanted,
			};
		};

		return {
			...packed,
			// 複数の課題をまとめた募集では、どの課題のページか分からないので出さない
			ownerIntraProjectUrl: slugs.length === 1 ? getOwnerIntraProjectUrl(recruitment.projectSlug, ownerProfile?.intraLogin, ownerProgress?.projectStatuses) : null,
			ownerIntraLogin: ownerProfile?.intraLogin ?? null,
			members: visible.filter(m => !INVITATION_STATUSES.includes(m.status)).map(packMember),
			invitations: recruitment.userId === me.id ? visible.filter(m => INVITATION_STATUSES.includes(m.status)).map(packMember) : [],
		};
	}
}
