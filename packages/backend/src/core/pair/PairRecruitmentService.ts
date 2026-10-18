/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In, LessThan, LessThanOrEqual, MoreThan } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import type {
	IntraProjectsRepository,
	IntraUserProgressesRepository,
	PairMembersRepository,
	PairRecruitmentsRepository,
	UsersRepository,
} from '@/models/_.js';
import type { MiLocalUser, MiUser } from '@/models/User.js';
import type { MiIntraProject } from '@/models/IntraProject.js';
import type { MiIntraUserProgress } from '@/models/IntraUserProgress.js';
import type { MiPairRecruitment } from '@/models/PairRecruitment.js';
import { MiPairMember } from '@/models/PairMember.js';
import { IdService } from '@/core/IdService.js';
import { CacheService } from '@/core/CacheService.js';
import { QueryService } from '@/core/QueryService.js';
import { NotificationService } from '@/core/NotificationService.js';
import { NoteCreateService } from '@/core/NoteCreateService.js';
import { LoggerService } from '@/core/LoggerService.js';
import { isDuplicateKeyValueError } from '@/misc/is-duplicate-key-value-error.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { judgeProjectAvailability } from '@/core/intra/intra-project.js';
import type { IntraProjectAvailability, IntraProjectAvailabilityState } from '@/core/intra/intra-project.js';
import {
	PAIR_RECRUITMENT_LIFETIME_MS,
	PAIR_RECRUITMENT_MAX_OPEN_PER_USER,
	PairRecruitmentError,
	buildAnnouncementText,
	canWorkOn,
	getTeamSizeRange,
	isRecruitmentOpen,
	isTeamFull,
	isValidTeamSize,
	judgeAccept,
	judgeApply,
	normalizeComment,
	normalizeStartDate,
	sortProjectsByState,
} from './pair-recruitment.js';
import type { PairClosedReason, PairMemberStatus, PairStartTiming } from './pair-recruitment.js';

export type PairRecruitmentProject = {
	slug: string;
	name: string;
	minGroupSize: number;
	maxGroupSize: number;
	state: IntraProjectAvailabilityState;
	reason: IntraProjectAvailability['reason'];
	openRecruitmentCount: number;
};

export type PairRecruitmentListTab = 'open' | 'mine' | 'joined';

/** 「参加中」に出す参加の状態 */
const JOINED_STATUSES: PairMemberStatus[] = ['pending', 'accepted'];

/** 期限切れの締め切りで 1 回に処理する数 */
const EXPIRE_BATCH_SIZE = 100;

/**
 * 42 の課題のペア募集。学内SNSモード (config.intra がある) のときだけ使える
 */
@Injectable()
export class PairRecruitmentService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.pairRecruitmentsRepository)
		private pairRecruitmentsRepository: PairRecruitmentsRepository,

		@Inject(DI.pairMembersRepository)
		private pairMembersRepository: PairMembersRepository,

		@Inject(DI.intraProjectsRepository)
		private intraProjectsRepository: IntraProjectsRepository,

		@Inject(DI.intraUserProgressesRepository)
		private intraUserProgressesRepository: IntraUserProgressesRepository,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private idService: IdService,
		private cacheService: CacheService,
		private queryService: QueryService,
		private notificationService: NotificationService,
		private noteCreateService: NoteCreateService,
		private loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger('pair-recruitment');
	}

	@bindThis
	private assertEnabled(): void {
		if (this.config.intra == null) throw new PairRecruitmentError('unavailable');
	}

	/** 凍結・削除 (削除のジョブの完了待ち) されたユーザーは作成・参加できない。API の認証でも凍結は弾かれるが、念のため確かめる */
	@bindThis
	private assertActive(me: MiLocalUser): void {
		if (me.isSuspended || me.isDeleted) throw new PairRecruitmentError('unavailable');
	}

	@bindThis
	private async getProgress(userId: MiUser['id']): Promise<MiIntraUserProgress | null> {
		return await this.intraUserProgressesRepository.findOneBy({ userId });
	}

	/**
	 * ユーザーのその課題の判定。進捗が無いか、課題が無ければ null
	 */
	@bindThis
	private judge(project: MiIntraProject | null, progress: MiIntraUserProgress | null): IntraProjectAvailability | null {
		if (project == null || progress == null) return null;
		return judgeProjectAvailability(project, progress);
	}

	@bindThis
	private async findProject(campusId: number, slug: string): Promise<MiIntraProject | null> {
		return await this.intraProjectsRepository.findOneBy({ campusId, slug });
	}

	/** 作成者とブロックの関係にあるか (どちらの向きでも) */
	@bindThis
	private async isBlockedWith(meId: MiUser['id'], otherId: MiUser['id']): Promise<boolean> {
		const [blocking, blocked] = await Promise.all([
			this.cacheService.userBlockingCache.fetch(meId),
			this.cacheService.userBlockedCache.fetch(meId),
		]);
		return blocking.has(otherId) || blocked.has(otherId);
	}

	@bindThis
	private async findRecruitmentOrFail(recruitmentId: MiPairRecruitment['id']): Promise<MiPairRecruitment> {
		const recruitment = await this.pairRecruitmentsRepository.findOneBy({ id: recruitmentId });
		if (recruitment == null) throw new PairRecruitmentError('noSuchRecruitment');
		return recruitment;
	}

	/**
	 * 作成者か参加希望を送った人だけが操作できる募集を返す。それ以外の人には (存在するかどうかも分からないよう) noSuchRecruitment
	 */
	@bindThis
	private async findForParticipantOrFail(me: MiLocalUser, recruitmentId: MiPairRecruitment['id']): Promise<MiPairRecruitment> {
		const recruitment = await this.findRecruitmentOrFail(recruitmentId);
		if (recruitment.userId === me.id) return recruitment;
		if (!(await this.pairMembersRepository.existsBy({ recruitmentId: recruitment.id, userId: me.id }))) throw new PairRecruitmentError('noSuchRecruitment');
		return recruitment;
	}

	/**
	 * 自分のキャンパスの、2 人以上で取り組む課題と自分の判定の一覧。取り組める課題を上に並べる。
	 * キャンパスが分からなければ空
	 */
	@bindThis
	public async getProjects(me: MiLocalUser, now = new Date()): Promise<PairRecruitmentProject[]> {
		this.assertEnabled();

		const progress = await this.getProgress(me.id);
		if (progress?.campusId == null) return [];
		const campusId = progress.campusId;

		const [projects, counts] = await Promise.all([
			this.intraProjectsRepository.findBy({ campusId }),
			this.pairRecruitmentsRepository.createQueryBuilder('recruitment')
				.select('recruitment.projectSlug', 'slug')
				.addSelect('COUNT(*)', 'count')
				.where('recruitment.campusId = :campusId', { campusId })
				.andWhere('recruitment.status = \'open\'')
				.andWhere('recruitment.expiresAt > :now', { now })
				.groupBy('recruitment.projectSlug')
				.getRawMany<{ slug: string; count: string }>(),
		]);
		const countMap = new Map(counts.map(c => [c.slug, parseInt(c.count, 10)]));

		const result: PairRecruitmentProject[] = [];
		for (const project of projects) {
			const range = getTeamSizeRange(project);
			if (range == null) continue;
			const availability = judgeProjectAvailability(project, progress);
			result.push({
				slug: project.slug,
				name: project.name,
				minGroupSize: range.min,
				maxGroupSize: range.max,
				state: availability.state,
				reason: availability.reason,
				openRecruitmentCount: countMap.get(project.slug) ?? 0,
			});
		}
		return sortProjectsByState(result);
	}

	/**
	 * 募集を作成する。announce が true なら、作成者のノートとしてタイムラインにも告知する
	 */
	@bindThis
	public async create(me: MiLocalUser, input: {
		projectSlug: string;
		teamSize: number;
		startTiming: PairStartTiming;
		startDate?: string | null;
		comment?: string | null;
		announce: boolean;
	}, now = new Date()): Promise<MiPairRecruitment> {
		this.assertEnabled();
		this.assertActive(me);

		const progress = await this.getProgress(me.id);
		if (progress?.campusId == null) throw new PairRecruitmentError('noCampus');

		const project = await this.findProject(progress.campusId, input.projectSlug);
		if (project == null) throw new PairRecruitmentError('noSuchProject');

		const range = getTeamSizeRange(project);
		if (range == null) throw new PairRecruitmentError('notPairProject');
		if (!isValidTeamSize(project, input.teamSize)) throw new PairRecruitmentError('invalidTeamSize');

		const startDate = normalizeStartDate(input.startTiming, input.startDate, now);
		const comment = normalizeComment(input.comment);

		if (!canWorkOn(judgeProjectAvailability(project, progress).state)) throw new PairRecruitmentError('projectNotAvailable');

		const openCount = await this.pairRecruitmentsRepository.countBy({
			userId: me.id,
			status: 'open',
			expiresAt: MoreThan(now),
		});
		if (openCount >= PAIR_RECRUITMENT_MAX_OPEN_PER_USER) throw new PairRecruitmentError('tooManyOpenRecruitments');

		const recruitment: MiPairRecruitment = {
			id: this.idService.gen(now.getTime()),
			userId: me.id,
			user: null,
			campusId: progress.campusId,
			projectSlug: project.slug,
			projectName: project.name,
			minGroupSize: range.min,
			maxGroupSize: range.max,
			teamSize: input.teamSize,
			startTiming: input.startTiming,
			startDate,
			comment,
			status: 'open',
			closedReason: null,
			acceptedCount: 0,
			noteId: null,
			note: null,
			expiresAt: new Date(now.getTime() + PAIR_RECRUITMENT_LIFETIME_MS),
			closedAt: null,
		};
		await this.pairRecruitmentsRepository.insert(recruitment);

		if (input.announce) {
			try {
				const note = await this.noteCreateService.create(me, {
					text: buildAnnouncementText({
						projectName: recruitment.projectName,
						teamSize: recruitment.teamSize,
						startTiming: recruitment.startTiming,
						startDate: recruitment.startDate,
						comment: recruitment.comment,
						url: `${this.config.url}/pair/${recruitment.id}`,
						now,
					}),
					visibility: 'public',
				});
				await this.pairRecruitmentsRepository.update({ id: recruitment.id }, { noteId: note.id });
				recruitment.noteId = note.id;
			} catch (err) {
				// 告知に失敗しても募集は残す
				this.logger.warn(`Failed to announce pair recruitment ${recruitment.id}: ${err instanceof Error ? err.message : String(err)}`);
			}
		}

		return recruitment;
	}

	/**
	 * 募集を見てよいか。作成者・参加希望を送った人・同じキャンパスの人 (作成者が凍結・削除されておらず、ブロックの関係にない) だけ
	 */
	@bindThis
	public async canView(me: MiLocalUser, recruitment: MiPairRecruitment): Promise<boolean> {
		if (recruitment.userId === me.id) return true;
		if (await this.pairMembersRepository.existsBy({ recruitmentId: recruitment.id, userId: me.id })) return true;

		const progress = await this.getProgress(me.id);
		if (progress?.campusId !== recruitment.campusId) return false;

		const owner = recruitment.user ?? await this.usersRepository.findOneBy({ id: recruitment.userId });
		if (owner == null || owner.isSuspended || owner.isDeleted) return false;

		return !(await this.isBlockedWith(me.id, recruitment.userId));
	}

	/**
	 * 見てよい募集を 1 件返す。見られなければ noSuchRecruitment
	 */
	@bindThis
	public async get(me: MiLocalUser, recruitmentId: MiPairRecruitment['id']): Promise<MiPairRecruitment> {
		this.assertEnabled();

		const recruitment = await this.pairRecruitmentsRepository.findOne({
			where: { id: recruitmentId },
			relations: { user: true },
		});
		if (recruitment == null || !(await this.canView(me, recruitment))) throw new PairRecruitmentError('noSuchRecruitment');
		return recruitment;
	}

	/**
	 * 募集の一覧。
	 * open: 自分と同じキャンパスの募集中の募集 (期限切れ・凍結や削除されたユーザー・ブロックの関係にあるユーザーの募集を除く)、
	 * mine: 自分の募集 (締め切ったものを含む)、joined: 参加希望を送った・参加している募集 (締め切ったものを含む)
	 */
	@bindThis
	public async list(me: MiLocalUser, params: {
		tab: PairRecruitmentListTab;
		projectSlug?: string | null;
		/** 自分が取り組める (available / in_progress の) 課題の募集だけにする */
		onlyWorkable?: boolean;
		sinceId?: string;
		untilId?: string;
		limit: number;
	}, now = new Date()): Promise<MiPairRecruitment[]> {
		this.assertEnabled();

		const progress = await this.getProgress(me.id);
		const campusId = progress?.campusId ?? null;

		const query = this.queryService.makePaginationQuery(this.pairRecruitmentsRepository.createQueryBuilder('recruitment'), params.sinceId, params.untilId)
			.innerJoinAndSelect('recruitment.user', 'user');

		switch (params.tab) {
			case 'open': {
				if (campusId == null) return [];
				query
					.andWhere('recruitment.campusId = :campusId', { campusId })
					.andWhere('recruitment.status = \'open\'')
					.andWhere('recruitment.expiresAt > :now', { now })
					.andWhere('user.isSuspended = FALSE')
					.andWhere('user.isDeleted = FALSE');

				const [blocking, blocked] = await Promise.all([
					this.cacheService.userBlockingCache.fetch(me.id),
					this.cacheService.userBlockedCache.fetch(me.id),
				]);
				const blockIds = [...new Set([...blocking, ...blocked])];
				if (blockIds.length > 0) {
					query.andWhere('recruitment.userId NOT IN (:...blockIds)', { blockIds });
				}
				break;
			}
			case 'mine': {
				query.andWhere('recruitment.userId = :meId', { meId: me.id });
				break;
			}
			case 'joined': {
				query.innerJoin(MiPairMember, 'member', 'member.recruitmentId = recruitment.id AND member.userId = :meId AND member.status IN (:...joinedStatuses)', {
					meId: me.id,
					joinedStatuses: JOINED_STATUSES,
				});
				break;
			}
		}

		if (params.projectSlug != null) {
			query.andWhere('recruitment.projectSlug = :projectSlug', { projectSlug: params.projectSlug });
		}

		if (params.onlyWorkable) {
			if (progress == null || campusId == null) return [];
			const projects = await this.intraProjectsRepository.findBy({ campusId });
			const workable = projects.filter(p => canWorkOn(judgeProjectAvailability(p, progress).state)).map(p => p.slug);
			if (workable.length === 0) return [];
			query.andWhere('recruitment.projectSlug IN (:...workable)', { workable });
		}

		return await query.limit(params.limit).getMany();
	}

	/**
	 * 参加希望を送る。作成者に通知する
	 */
	@bindThis
	public async apply(me: MiLocalUser, recruitmentId: MiPairRecruitment['id'], now = new Date()): Promise<MiPairRecruitment> {
		const recruitment = await this.get(me, recruitmentId);
		this.assertActive(me);

		if (recruitment.userId !== me.id && await this.isBlockedWith(me.id, recruitment.userId)) throw new PairRecruitmentError('blocked');

		const [existing, progress, project] = await Promise.all([
			this.pairMembersRepository.findOneBy({ recruitmentId: recruitment.id, userId: me.id }),
			this.getProgress(me.id),
			this.findProject(recruitment.campusId, recruitment.projectSlug),
		]);

		const error = judgeApply({
			recruitment,
			applicantId: me.id,
			existingStatus: existing?.status ?? null,
			state: this.judge(project, progress)?.state ?? null,
			now,
		});
		if (error != null) throw new PairRecruitmentError(error);

		if (existing != null) {
			// 取り下げた後にもう一度送る
			const result = await this.pairMembersRepository.update({ id: existing.id, status: 'withdrawn' }, { status: 'pending', updatedAt: now });
			if (result.affected === 0) throw new PairRecruitmentError('alreadyApplied');
		} else {
			try {
				await this.pairMembersRepository.insert({
					id: this.idService.gen(now.getTime()),
					recruitmentId: recruitment.id,
					userId: me.id,
					status: 'pending',
					updatedAt: now,
				});
			} catch (err) {
				// 同時に送られた場合
				if (isDuplicateKeyValueError(err)) throw new PairRecruitmentError('alreadyApplied');
				throw err;
			}
		}

		this.notificationService.createNotification(recruitment.userId, 'pairJoinRequested', {
			pairRecruitmentId: recruitment.id,
			projectSlug: recruitment.projectSlug,
			projectName: recruitment.projectName,
		}, me.id);

		return recruitment;
	}

	/**
	 * 参加希望を承認する (作成者だけ)。承認した人に通知し、人数がそろったら締め切る
	 */
	@bindThis
	public async accept(me: MiLocalUser, recruitmentId: MiPairRecruitment['id'], userId: MiUser['id'], now = new Date()): Promise<MiPairRecruitment> {
		this.assertEnabled();
		const recruitment = await this.findForParticipantOrFail(me, recruitmentId);
		if (recruitment.userId !== me.id) throw new PairRecruitmentError('notOwner');

		const [member, applicant, progress, project] = await Promise.all([
			this.pairMembersRepository.findOneBy({ recruitmentId: recruitment.id, userId }),
			this.usersRepository.findOneBy({ id: userId }),
			this.getProgress(userId),
			this.findProject(recruitment.campusId, recruitment.projectSlug),
		]);

		// 凍結・削除されたユーザーは取り組めないものとして扱う
		const applicantState = applicant == null || applicant.isSuspended || applicant.isDeleted
			? null
			: this.judge(project, progress)?.state ?? null;

		const error = judgeAccept({
			recruitment,
			actorId: me.id,
			memberStatus: member?.status ?? null,
			applicantState,
			now,
		});
		if (error != null) throw new PairRecruitmentError(error);

		const memberUpdate = await this.pairMembersRepository.update({ id: member!.id, status: 'pending' }, { status: 'accepted', updatedAt: now });
		if (memberUpdate.affected === 0) throw new PairRecruitmentError('noSuchApplication');

		// 同時に承認されても人数を超えないよう、条件付きで数を増やす
		const countUpdate = await this.pairRecruitmentsRepository.update({
			id: recruitment.id,
			status: 'open',
			acceptedCount: LessThan(recruitment.teamSize - 1),
		}, {
			acceptedCount: () => '"acceptedCount" + 1',
		});
		if (countUpdate.affected === 0) {
			await this.pairMembersRepository.update({ id: member!.id, status: 'accepted' }, { status: 'pending', updatedAt: now });
			const latest = await this.findRecruitmentOrFail(recruitment.id);
			throw new PairRecruitmentError(isRecruitmentOpen(latest, now) ? 'full' : 'recruitmentClosed');
		}

		this.notificationService.createNotification(userId, 'pairAccepted', {
			pairRecruitmentId: recruitment.id,
			projectSlug: recruitment.projectSlug,
			projectName: recruitment.projectName,
		}, me.id);

		const latest = await this.findRecruitmentOrFail(recruitment.id);
		if (isTeamFull(latest.teamSize, latest.acceptedCount)) {
			await this.closeRecruitment(latest, 'full', now);
			return await this.findRecruitmentOrFail(recruitment.id);
		}
		return latest;
	}

	/**
	 * 参加希望を見送る (作成者だけ)。通知はしない。見送られた人は同じ募集に再び送れない
	 */
	@bindThis
	public async reject(me: MiLocalUser, recruitmentId: MiPairRecruitment['id'], userId: MiUser['id'], now = new Date()): Promise<MiPairRecruitment> {
		this.assertEnabled();
		const recruitment = await this.findForParticipantOrFail(me, recruitmentId);
		if (recruitment.userId !== me.id) throw new PairRecruitmentError('notOwner');
		if (!isRecruitmentOpen(recruitment, now)) throw new PairRecruitmentError('recruitmentClosed');

		const member = await this.pairMembersRepository.findOneBy({ recruitmentId: recruitment.id, userId });
		if (member?.status !== 'pending') throw new PairRecruitmentError('noSuchApplication');

		const result = await this.pairMembersRepository.update({ id: member.id, status: 'pending' }, { status: 'rejected', updatedAt: now });
		if (result.affected === 0) throw new PairRecruitmentError('noSuchApplication');

		return recruitment;
	}

	/**
	 * 自分の参加希望・参加を取り下げる (募集中の間だけ)
	 */
	@bindThis
	public async withdraw(me: MiLocalUser, recruitmentId: MiPairRecruitment['id'], now = new Date()): Promise<MiPairRecruitment> {
		this.assertEnabled();
		const recruitment = await this.findForParticipantOrFail(me, recruitmentId);

		const member = await this.pairMembersRepository.findOneBy({ recruitmentId: recruitment.id, userId: me.id });
		if (member == null || (member.status !== 'pending' && member.status !== 'accepted')) throw new PairRecruitmentError('notMember');
		if (!isRecruitmentOpen(recruitment, now)) throw new PairRecruitmentError('recruitmentClosed');

		const result = await this.pairMembersRepository.update({ id: member.id, status: member.status }, { status: 'withdrawn', updatedAt: now });
		if (result.affected === 0) throw new PairRecruitmentError('notMember');

		if (member.status === 'accepted') {
			await this.pairRecruitmentsRepository.update({
				id: recruitment.id,
				acceptedCount: MoreThan(0),
			}, {
				acceptedCount: () => '"acceptedCount" - 1',
			});
		}

		return await this.findRecruitmentOrFail(recruitment.id);
	}

	/**
	 * 作成者が募集を締め切る
	 */
	@bindThis
	public async close(me: MiLocalUser, recruitmentId: MiPairRecruitment['id'], now = new Date()): Promise<MiPairRecruitment> {
		this.assertEnabled();
		const recruitment = await this.findForParticipantOrFail(me, recruitmentId);
		if (recruitment.userId !== me.id) throw new PairRecruitmentError('notOwner');
		if (!isRecruitmentOpen(recruitment, now)) throw new PairRecruitmentError('recruitmentClosed');

		if (!(await this.closeRecruitment(recruitment, 'manual', now))) throw new PairRecruitmentError('recruitmentClosed');
		return await this.findRecruitmentOrFail(recruitment.id);
	}

	/**
	 * 募集中の募集を締め切り、作成者以外のメンバー (承認済みと参加希望中) に通知する。
	 * 期限切れのときは作成者にも通知する
	 * @returns 締め切ったか (既に締め切られていたら false)
	 */
	@bindThis
	public async closeRecruitment(recruitment: MiPairRecruitment, reason: PairClosedReason, now = new Date()): Promise<boolean> {
		const result = await this.pairRecruitmentsRepository.update({ id: recruitment.id, status: 'open' }, {
			status: 'closed',
			closedReason: reason,
			closedAt: now,
		});
		if (result.affected === 0) return false;

		const members = await this.pairMembersRepository.findBy({
			recruitmentId: recruitment.id,
			status: In(JOINED_STATUSES),
		});
		const notifieeIds = members.map(m => m.userId);
		if (reason === 'expired') notifieeIds.push(recruitment.userId);

		for (const notifieeId of notifieeIds) {
			this.notificationService.createNotification(notifieeId, 'pairClosed', {
				pairRecruitmentId: recruitment.id,
				projectSlug: recruitment.projectSlug,
				projectName: recruitment.projectName,
				reason,
			});
		}
		return true;
	}

	/**
	 * 期限を過ぎた募集を締め切る (毎時のジョブ)
	 * @returns 締め切った数
	 */
	@bindThis
	public async closeExpired(now = new Date()): Promise<number> {
		let closed = 0;
		// 締め切った募集は条件から外れるので、毎回先頭から取り直す
		for (;;) {
			const expired = await this.pairRecruitmentsRepository.find({
				where: { status: 'open', expiresAt: LessThanOrEqual(now) },
				order: { id: 'ASC' },
				take: EXPIRE_BATCH_SIZE,
			});
			if (expired.length === 0) break;

			let progressed = false;
			for (const recruitment of expired) {
				if (await this.closeRecruitment(recruitment, 'expired', now)) {
					closed++;
					progressed = true;
				}
			}
			// 他のプロセスが同時に締め切っている場合でも、何も進まなければ止める
			if (!progressed || expired.length < EXPIRE_BATCH_SIZE) break;
		}
		return closed;
	}
}
