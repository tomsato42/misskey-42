/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In, Not } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { IntraProjectNotesRepository, IntraProjectResultsRepository, IntraUserProgressesRepository, UserProfilesRepository } from '@/models/_.js';
import type { MiUser } from '@/models/User.js';
import type { MiNote } from '@/models/Note.js';
import type { MiIntraProjectResult } from '@/models/IntraProjectResult.js';
import { IdService } from '@/core/IdService.js';
import { LoggerService } from '@/core/LoggerService.js';
import { NotificationService } from '@/core/NotificationService.js';
import { isDuplicateKeyValueError } from '@/misc/is-duplicate-key-value-error.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { IntraApiService } from './IntraApiService.js';
import { countOutstandingFlags, extractProjectResults, extractSubmissions, extractTeamMembers, findNewlyMarkedResults, getAttemptNumber } from './intra-project-result.js';
import type { IntraProjectResultMember, IntraProjectResultValues, IntraProjectSubmission } from './intra-project-result.js';
import type { IntraProjectUser } from './intra-project.js';

/** 付けようとした課題の結果が無い (自分のものではない) */
export class IntraProjectResultNotFoundError extends Error {
	constructor() {
		super('No such intra project result');
	}
}

/** 課題の結果を付けられない種類のノート (本文などの無いリノート) */
export class IntraProjectResultNotAttachableError extends Error {
	constructor() {
		super('Cannot attach an intra project result to a pure renote');
	}
}

/** 課題の結果を付けるかを決めるのに使う、投稿するノートの内容 */
export type IntraProjectNoteLike = {
	renoteId?: string | null;
	text?: string | null;
	fileIds?: string[] | null;
	hasPoll: boolean;
};

/**
 * 42 intra の課題の結果 (点数・合否・チームのメンバー・outstanding の数) を保存し、
 * 結果が出たら通知する。ノートに結果を付ける
 */
@Injectable()
export class IntraProjectResultService {
	private logger: Logger;

	constructor(
		@Inject(DI.intraProjectResultsRepository)
		private intraProjectResultsRepository: IntraProjectResultsRepository,

		@Inject(DI.intraProjectNotesRepository)
		private intraProjectNotesRepository: IntraProjectNotesRepository,

		@Inject(DI.intraUserProgressesRepository)
		private intraUserProgressesRepository: IntraUserProgressesRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private intraApiService: IntraApiService,
		private notificationService: NotificationService,
		private idService: IdService,
		private loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger('intra-project-result');
	}

	/**
	 * projects_users から課題の結果を保存し、新しく結果が出た課題を通知する。
	 * 初めて保存するとき (intra_user_progress.resultsSyncedAt が無いとき) は、これまでの結果を通知しない
	 */
	@bindThis
	public async syncResults(userId: MiUser['id'], projectsUsers: IntraProjectUser[]): Promise<void> {
		const now = new Date();
		const current = extractProjectResults(projectsUsers);
		const [previous, progress] = await Promise.all([
			this.intraProjectResultsRepository.findBy({ userId }),
			this.intraUserProgressesRepository.findOne({ where: { userId }, select: { userId: true, resultsSyncedAt: true } }),
		]);
		const isFirstSync = progress?.resultsSyncedAt == null;
		const newlyMarked = isFirstSync ? [] : findNewlyMarkedResults(previous, current, now);

		const previousById = new Map(previous.map(p => [p.projectsUserId, p]));
		for (const result of current) {
			const prev = previousById.get(result.projectsUserId);
			if (prev != null) {
				if (!isSameResult(prev, result)) {
					await this.intraProjectResultsRepository.update({ id: prev.id }, { ...result, updatedAt: now });
				}
				continue;
			}

			try {
				await this.intraProjectResultsRepository.insert({ id: this.idService.gen(), userId, ...result, updatedAt: now });
			} catch (err) {
				// 同じユーザーの同期が同時に走った場合は、先に保存された方を残す
				if (!isDuplicateKeyValueError(err)) throw err;
			}
		}

		// intra から消えた結果 (登録の取り消しなど) は消す
		if (current.length > 0) {
			await this.intraProjectResultsRepository.delete({
				userId,
				projectsUserId: Not(In(current.map(r => r.projectsUserId))),
			});
		} else if (previous.length > 0 && projectsUsers.length > 0) {
			await this.intraProjectResultsRepository.delete({ userId });
		}

		await this.intraUserProgressesRepository.update({ userId }, { resultsSyncedAt: now });

		for (const result of newlyMarked) {
			const saved = await this.intraProjectResultsRepository.findOneBy({ userId, projectsUserId: result.projectsUserId });
			if (saved == null) continue;
			this.notificationService.createNotification(userId, 'intraProjectFinished', {
				intraProjectResultId: saved.id,
				projectSlug: saved.projectSlug,
				projectName: saved.projectName,
				finalMark: saved.finalMark,
				validated: saved.validated,
			});
			// 投稿するときに待たないよう、チームのメンバーと outstanding の数を先に取得しておく
			await this.ensureDetails(saved).catch(err => {
				this.logger.warn(`Failed to fetch details of intra project result ${saved.id}: ${err instanceof Error ? err.message : String(err)}`);
			});
		}

		await this.syncSubmissions(userId).catch(err => {
			// 提出ごとの結果が取れなくても、最後の提出の結果は共有できる
			this.logger.warn(`Failed to sync submissions of user ${userId}: ${err instanceof Error ? err.message : String(err)}`);
		});
	}

	/**
	 * 提出 (チーム) ごとの結果を、最後のチームが変わった課題の分だけ取得し直す。
	 * 取得し直す課題があるときだけ、42 API の projects_users を 1 回 (ページ分) 呼ぶ
	 */
	@bindThis
	public async syncSubmissions(userId: MiUser['id']): Promise<void> {
		const stale = (await this.intraProjectResultsRepository.findBy({ userId }))
			.filter(r => r.teamId != null && r.submissionsTeamId !== r.teamId);
		if (stale.length === 0) return;

		const profile = await this.userProfilesRepository.findOne({ where: { userId }, select: { userId: true, intraId: true } });
		if (profile?.intraId == null) return;

		const projectsUsers = await this.intraApiService.getUserProjectsUsers(profile.intraId);
		if (projectsUsers == null) return;
		const byId = new Map(projectsUsers.filter(pu => typeof pu.id === 'number').map(pu => [pu.id, pu]));

		for (const result of stale) {
			const teams = byId.get(result.projectsUserId)?.teams;
			if (!Array.isArray(teams)) continue;
			await this.intraProjectResultsRepository.update({ id: result.id }, {
				submissions: extractSubmissions(teams, result.submissions),
				submissionsTeamId: result.teamId,
			});
		}
	}

	/**
	 * チームのメンバーと outstanding の数を、まだ取得していなければ (最後のチームが変わっていれば) 42 API から取得して保存する
	 */
	@bindThis
	public async ensureDetails(result: MiIntraProjectResult): Promise<MiIntraProjectResult> {
		if (result.teamId == null || result.detailsTeamId === result.teamId) return result;

		const team = await this.intraApiService.getTeam(result.teamId);
		if (team == null) return result;
		const scaleTeams = Array.isArray(team.scale_teams)
			? team.scale_teams
			: await this.intraApiService.getTeamScaleTeams(result.teamId);

		const values = {
			members: extractTeamMembers(team),
			outstandingCount: scaleTeams != null ? countOutstandingFlags(scaleTeams) : null,
			detailsTeamId: result.teamId,
		};
		await this.intraProjectResultsRepository.update({ id: result.id }, values);
		return { ...result, ...values };
	}

	/**
	 * ユーザーの課題の結果。結果が出た日時の新しい順
	 */
	@bindThis
	public async list(userId: MiUser['id']): Promise<MiIntraProjectResult[]> {
		return await this.intraProjectResultsRepository.createQueryBuilder('result')
			.where('result.userId = :userId', { userId })
			.orderBy('result.markedAt', 'DESC', 'NULLS LAST')
			.addOrderBy('result.id', 'DESC')
			.getMany();
	}

	/**
	 * 投稿の前に、付ける課題の結果を確かめる。結果の指定が無ければ null を返す。
	 * 返した関数はノートを保存した直後に呼ぶ (投稿した時点の結果をノートに付ける)
	 * @throws IntraProjectResultNotAttachableError 本文などの無いリノート
	 * @throws IntraProjectResultNotFoundError 結果が無い、または自分のものではない
	 */
	@bindThis
	public async prepareNote(me: { id: MiUser['id'] }, resultId: MiIntraProjectResult['id'] | null | undefined, note: IntraProjectNoteLike, teamId?: number | null): Promise<((note: MiNote) => Promise<void>) | null> {
		if (resultId == null) return null;

		const isPureRenote = note.renoteId != null && note.text == null && (note.fileIds ?? []).length === 0 && !note.hasPoll;
		if (isPureRenote) throw new IntraProjectResultNotAttachableError();

		let result = await this.intraProjectResultsRepository.findOneBy({ id: resultId, userId: me.id });
		if (result == null) throw new IntraProjectResultNotFoundError();

		const ownMember = await this.getOwnMember(me.id);
		const attemptCount = result.submissions.length > 0 ? result.submissions.length : null;
		const base = {
			userId: me.id,
			projectSlug: result.projectSlug,
			projectName: result.projectName,
			attemptCount,
			intraLogin: ownMember[0]?.login ?? null,
		};

		// 最後の提出以外を選んだとき
		if (teamId != null && teamId !== result.teamId) {
			let submission = result.submissions.find(s => s.teamId === teamId);
			if (submission == null) throw new IntraProjectResultNotFoundError();
			try {
				submission = await this.ensureSubmissionOutstanding(result, submission);
			} catch (err) {
				this.logger.warn(`Failed to fetch evaluations of intra team ${teamId}: ${err instanceof Error ? err.message : String(err)}`);
			}
			const picked = submission;
			const attemptNumber = getAttemptNumber(result.submissions, picked.teamId);
			return async (created: MiNote) => {
				await this.intraProjectNotesRepository.insert({
					...base,
					noteId: created.id,
					finalMark: picked.finalMark,
					validated: picked.validated,
					outstandingCount: picked.outstandingCount,
					members: picked.members.length > 0 ? picked.members : ownMember,
					attemptNumber,
					markedAt: picked.markedAt != null ? new Date(picked.markedAt) : null,
				});
			};
		}

		try {
			result = await this.ensureDetails(result);
		} catch (err) {
			// メンバーと outstanding の数が取れなくても、点数は付けて投稿できるようにする
			this.logger.warn(`Failed to fetch details of intra project result ${result.id}: ${err instanceof Error ? err.message : String(err)}`);
		}

		const members = result.detailsTeamId != null && result.members.length > 0
			? result.members
			: ownMember;
		const snapshot = result;

		return async (created: MiNote) => {
			await this.intraProjectNotesRepository.insert({
				...base,
				noteId: created.id,
				finalMark: snapshot.finalMark,
				validated: snapshot.validated,
				outstandingCount: snapshot.detailsTeamId != null ? snapshot.outstandingCount : null,
				members,
				attemptNumber: getAttemptNumber(snapshot.submissions, snapshot.teamId),
				markedAt: snapshot.markedAt,
			});
		};
	}

	/**
	 * 最後以外の提出の outstanding の数を、まだ取得していなければ 42 API から取得して保存する
	 */
	@bindThis
	private async ensureSubmissionOutstanding(result: MiIntraProjectResult, submission: IntraProjectSubmission): Promise<IntraProjectSubmission> {
		if (submission.outstandingCount != null) return submission;
		const scaleTeams = await this.intraApiService.getTeamScaleTeams(submission.teamId);
		if (scaleTeams == null) return submission;

		const updated = { ...submission, outstandingCount: countOutstandingFlags(scaleTeams) };
		// 保存の間に取得し直された一覧を上書きしないよう、今の一覧を読み直して差し替える
		const latest = await this.intraProjectResultsRepository.findOneBy({ id: result.id });
		if (latest != null) {
			await this.intraProjectResultsRepository.update({ id: result.id }, {
				submissions: latest.submissions.map(s => s.teamId === updated.teamId ? { ...s, outstandingCount: updated.outstandingCount } : s),
			});
		}
		return updated;
	}

	/** チームのメンバーが分からないときに使う、自分だけのメンバー */
	@bindThis
	private async getOwnMember(userId: MiUser['id']): Promise<IntraProjectResultMember[]> {
		const profile = await this.userProfilesRepository.findOne({ where: { userId }, select: { userId: true, intraId: true, intraLogin: true } });
		if (profile?.intraId == null || profile.intraLogin == null) return [];
		return [{ intraId: profile.intraId, login: profile.intraLogin }];
	}
}

function isSameResult(prev: MiIntraProjectResult, next: IntraProjectResultValues): boolean {
	return prev.projectSlug === next.projectSlug
		&& prev.projectName === next.projectName
		&& prev.finalMark === next.finalMark
		&& prev.validated === next.validated
		&& prev.teamId === next.teamId
		&& (prev.markedAt?.getTime() ?? null) === (next.markedAt?.getTime() ?? null);
}
