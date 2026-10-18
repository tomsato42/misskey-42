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
import { canSeeMember, getEffectiveState, getOwnerIntraProjectUrl } from '@/core/pair/pair-recruitment.js';
import type { PairViewerStatus } from '@/core/pair/pair-recruitment.js';
import { UserEntityService } from './UserEntityService.js';

function projectKey(campusId: number, slug: string): string {
	return `${campusId}:${slug}`;
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
			slug: In([...new Set(recruitments.map(r => r.projectSlug))]),
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

		const [users, projects, myProgress, myMembers, pendingCounts] = await Promise.all([
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
		]);

		const userMap = new Map(users.map(u => [u.id, u]));
		const myMemberMap = new Map(myMembers.map(m => [m.recruitmentId, m.status]));
		const pendingCountMap = new Map(pendingCounts.map(c => [c.recruitmentId, parseInt(c.count, 10)]));

		return recruitments.map(r => {
			const state = getEffectiveState(r, now);
			const isOwner = r.userId === me.id;
			const myStatus: PairViewerStatus | null = isOwner ? 'owner' : myMemberMap.get(r.id) ?? null;
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
				teamSize: r.teamSize,
				acceptedCount: r.acceptedCount,
				pendingCount: isOwner ? pendingCountMap.get(r.id) ?? 0 : null,
				startTiming: r.startTiming,
				startDate: r.startDate,
				comment: r.comment,
				noteId: r.noteId,
				myProjectState: this.judgeState(projects.get(projectKey(r.campusId, r.projectSlug)), myProgress),
				myStatus,
			};
		});
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
		const project = projects.get(projectKey(recruitment.campusId, recruitment.projectSlug));

		return {
			...packed,
			ownerIntraProjectUrl: getOwnerIntraProjectUrl(recruitment.projectSlug, ownerProfile?.intraLogin, ownerProgress?.projectStatuses),
			members: visible.map(m => ({
				id: m.id,
				createdAt: this.idService.parse(m.id).date.toISOString(),
				updatedAt: m.updatedAt.toISOString(),
				userId: m.userId,
				user: userMap.get(m.userId)!,
				status: m.status,
				projectState: this.judgeState(project, progressMap.get(m.userId)),
			})),
		};
	}
}
