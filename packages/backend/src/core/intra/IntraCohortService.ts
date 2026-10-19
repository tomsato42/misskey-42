/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In, Not } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import type { IntraCohortsRepository } from '@/models/_.js';
import { IdService } from '@/core/IdService.js';
import { LoggerService } from '@/core/LoggerService.js';
import { isDuplicateKeyValueError } from '@/misc/is-duplicate-key-value-error.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { IntraApiService } from './IntraApiService.js';
import { IntraProjectService } from './IntraProjectService.js';
import { buildCohortTable, findNearestIntake, getIntakeYearMonths } from './intra-cohort.js';

type IntraConfig = NonNullable<Config['intra']>;

/**
 * キャンパス・ピシンごとの本科への入学時期 (intra_cohort) を、42 API の 42cursus の在籍者から集計して保存し、
 * それをもとにユーザーの入学時期を決める
 */
@Injectable()
export class IntraCohortService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.intraCohortsRepository)
		private intraCohortsRepository: IntraCohortsRepository,

		private intraApiService: IntraApiService,
		private intraProjectService: IntraProjectService,
		private idService: IdService,
		private loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger('intra-cohort');
	}

	@bindThis
	private getIntraConfig(): IntraConfig {
		if (this.config.intra == null) {
			throw new Error('42 intra integration is not configured');
		}
		return this.config.intra;
	}

	/**
	 * 本人が 42cursus を始めた月に最も近い、キャンパスの入学の月 (YYMM)。集計が無いか、近い入学の月が無ければ null
	 */
	@bindThis
	public async getIntakeYearMonth(campusId: number | null, cursusBeginAt: Date | null): Promise<string | null> {
		if (campusId == null || cursusBeginAt == null) return null;
		const entries = await this.intraCohortsRepository.find({
			select: { cohortYearMonth: true, userCount: true },
			where: { campusId },
		});
		return findNearestIntake(cursusBeginAt, getIntakeYearMonths(entries));
	}

	/**
	 * 対象のすべてのキャンパス (課題を取り込むキャンパスと同じ) の入学時期を集計する (1 日 1 回のジョブ)
	 */
	@bindThis
	public async syncAllCampuses(): Promise<void> {
		for (const campusId of await this.intraProjectService.getTargetCampusIds()) {
			try {
				await this.syncCohorts(campusId);
			} catch (err) {
				// 1 つのキャンパスの失敗で全体を止めない
				this.logger.warn(`Failed to sync cohorts of campus ${campusId}: ${err instanceof Error ? err.message : String(err)}`);
			}
		}
	}

	/**
	 * 入学時期をまだ集計していないキャンパスの入学時期を集計する (初回の集計)
	 */
	@bindThis
	public async syncMissingCampuses(): Promise<void> {
		for (const campusId of await this.intraProjectService.getTargetCampusIds()) {
			if (await this.intraCohortsRepository.existsBy({ campusId })) continue;
			try {
				await this.syncCohorts(campusId);
			} catch (err) {
				this.logger.warn(`Failed to sync cohorts of campus ${campusId}: ${err instanceof Error ? err.message : String(err)}`);
			}
		}
	}

	/**
	 * キャンパスの入学時期を 42 API から集計し直す
	 * @returns 集計できたピシンの数
	 */
	@bindThis
	public async syncCohorts(campusId: number): Promise<number> {
		const intra = this.getIntraConfig();

		const cursusUsers = await this.intraApiService.getCampusCursusUsers(campusId, intra.cursusId);
		const entries = buildCohortTable(cursusUsers);

		if (entries.length === 0) {
			// 42 API の一時的な不具合で全件消してしまわないよう、何もしない
			this.logger.warn(`No cohorts found for campus ${campusId}; keeping the cached cohorts`);
			return 0;
		}

		const existing = await this.intraCohortsRepository.findBy({ campusId });
		const existingIds = new Map(existing.map(c => [c.poolYearMonth, c.id]));
		const now = new Date();

		for (const entry of entries) {
			const id = existingIds.get(entry.poolYearMonth);
			if (id != null) {
				await this.intraCohortsRepository.update({ id }, { ...entry, updatedAt: now });
				continue;
			}

			try {
				await this.intraCohortsRepository.insert({ id: this.idService.gen(), campusId, ...entry, updatedAt: now });
			} catch (err) {
				// 同時に走った集計が先に作成した場合は、そちらを残す
				if (!isDuplicateKeyValueError(err)) throw err;
			}
		}

		await this.intraCohortsRepository.delete({
			campusId,
			poolYearMonth: Not(In(entries.map(e => e.poolYearMonth))),
		});

		this.logger.info(`Synced ${entries.length} cohorts of campus ${campusId}`);
		return entries.length;
	}
}
