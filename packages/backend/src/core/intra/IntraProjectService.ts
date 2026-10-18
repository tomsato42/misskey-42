/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In, Not } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import type { IntraProjectsRepository, IntraUserProgressesRepository } from '@/models/_.js';
import type { MiUser } from '@/models/User.js';
import type { MiIntraUserProgress } from '@/models/IntraUserProgress.js';
import { IdService } from '@/core/IdService.js';
import { LoggerService } from '@/core/LoggerService.js';
import { isDuplicateKeyValueError } from '@/misc/is-duplicate-key-value-error.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { IntraApiService } from './IntraApiService.js';
import { extractProjectStatuses, extractValidatedQuests, selectProjectSessions, toProjectDefinition } from './intra-project.js';
import type { IntraProjectDefinition } from './intra-project.js';
import type { IntraUser } from './intra-user.js';

type IntraConfig = NonNullable<Config['intra']>;

/**
 * 42 intra の課題 (キャンパスごとの登録の条件) と、ユーザーの課題の状態・達成したクエストを取り込む
 */
@Injectable()
export class IntraProjectService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.intraProjectsRepository)
		private intraProjectsRepository: IntraProjectsRepository,

		@Inject(DI.intraUserProgressesRepository)
		private intraUserProgressesRepository: IntraUserProgressesRepository,

		private intraApiService: IntraApiService,
		private idService: IdService,
		private loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger('intra-project');
	}

	@bindThis
	private getIntraConfig(): IntraConfig {
		if (this.config.intra == null) {
			throw new Error('42 intra integration is not configured');
		}
		return this.config.intra;
	}

	/**
	 * ユーザーの課題の状態と達成したクエストを保存する。
	 * 課題の状態は intraUser の projects_users から取り (追加のリクエストは無い)、クエストは 42 API に 1 回問い合わせる。
	 * クエストの取得に失敗した場合は、保存済みのクエストを残して課題の状態だけ更新する
	 * @param campusId ユーザーの主キャンパスの intra のキャンパス ID
	 */
	@bindThis
	public async syncUserProgress(userId: MiUser['id'], intraUser: IntraUser, campusId: number | null): Promise<void> {
		const now = new Date();
		const values: Partial<MiIntraUserProgress> & Pick<MiIntraUserProgress, 'userId'> = { userId, campusId };

		if (intraUser.projects_users != null) {
			values.projectStatuses = extractProjectStatuses(intraUser.projects_users);
			values.projectsSyncedAt = now;
		}

		try {
			const questsUsers = await this.intraApiService.getQuestsUsers(intraUser.id);
			if (questsUsers != null) {
				values.validatedQuests = extractValidatedQuests(questsUsers);
				values.questsSyncedAt = now;
			}
		} catch (err) {
			this.logger.warn(`Failed to fetch quests of intra user ${intraUser.id} (user ${userId}): ${err instanceof Error ? err.message : String(err)}`);
		}

		// 値を入れた列だけが更新される
		await this.intraUserProgressesRepository.upsert(values, ['userId']);
	}

	/**
	 * 課題を取り込む対象のキャンパス (intra_user_progress に記録されている主キャンパス) の一覧
	 */
	@bindThis
	public async getTargetCampusIds(): Promise<number[]> {
		const rows = await this.intraUserProgressesRepository.createQueryBuilder('progress')
			.select('progress.campusId', 'campusId')
			.distinct(true)
			.where('progress.campusId IS NOT NULL')
			.getRawMany<{ campusId: number }>();
		return rows.map(r => r.campusId).sort((a, b) => a - b);
	}

	/**
	 * 対象のすべてのキャンパスの課題を取り込む (1 日 1 回のジョブ)
	 */
	@bindThis
	public async syncAllCampuses(): Promise<void> {
		for (const campusId of await this.getTargetCampusIds()) {
			try {
				await this.syncProjects(campusId);
			} catch (err) {
				// 1 つのキャンパスの失敗で全体を止めない
				this.logger.warn(`Failed to sync projects of campus ${campusId}: ${err instanceof Error ? err.message : String(err)}`);
			}
		}
	}

	/**
	 * 課題をまだ 1 件も取り込んでいないキャンパスの課題を取り込む (初回の取り込み)
	 */
	@bindThis
	public async syncMissingCampuses(): Promise<void> {
		for (const campusId of await this.getTargetCampusIds()) {
			if (await this.intraProjectsRepository.existsBy({ campusId })) continue;
			try {
				await this.syncProjects(campusId);
			} catch (err) {
				this.logger.warn(`Failed to sync projects of campus ${campusId}: ${err instanceof Error ? err.message : String(err)}`);
			}
		}
	}

	/**
	 * キャンパスの課題を 42 API から取り込み、登録できなくなった課題を消す
	 * @returns 取り込んだ課題の数
	 */
	@bindThis
	public async syncProjects(campusId: number): Promise<number> {
		const intra = this.getIntraConfig();

		const sessions = await this.intraApiService.getProjectSessions(campusId, intra.cursusId);
		const definitions = selectProjectSessions(sessions)
			// 登録できないセッションしか無い課題は扱わない
			.filter(s => s.is_subscriptable)
			.map(s => toProjectDefinition(s))
			.filter((d): d is IntraProjectDefinition => d != null && d.campusId === campusId);

		if (definitions.length === 0) {
			// 42 API の一時的な不具合で全件消してしまわないよう、何もしない
			this.logger.warn(`No projects found for campus ${campusId}; keeping the cached projects`);
			return 0;
		}

		const existing = await this.intraProjectsRepository.findBy({ campusId });
		const existingIds = new Map(existing.map(p => [p.slug, p.id]));
		const now = new Date();

		for (const definition of definitions) {
			const id = existingIds.get(definition.slug);
			if (id != null) {
				await this.intraProjectsRepository.update({ id }, { ...definition, updatedAt: now });
				continue;
			}

			try {
				await this.intraProjectsRepository.insert({ id: this.idService.gen(), ...definition, updatedAt: now });
			} catch (err) {
				// 同時に走った取り込みが先に作成した場合は、そちらを残す
				if (!isDuplicateKeyValueError(err)) throw err;
			}
		}

		await this.intraProjectsRepository.delete({
			campusId,
			slug: Not(In(definitions.map(d => d.slug))),
		});

		this.logger.info(`Synced ${definitions.length} projects of campus ${campusId}`);
		return definitions.length;
	}
}
