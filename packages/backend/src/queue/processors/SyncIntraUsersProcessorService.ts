/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import type { UserProfilesRepository } from '@/models/_.js';
import type Logger from '@/logger.js';
import { bindThis } from '@/decorators.js';
import { IntraSyncService } from '@/core/intra/IntraSyncService.js';
import { IntraProjectService } from '@/core/intra/IntraProjectService.js';
import { IntraCohortService } from '@/core/intra/IntraCohortService.js';
import { QueueLoggerService } from '../QueueLoggerService.js';

/**
 * 1 回のジョブで同期するユーザー数の上限。
 * 1 人あたり 42 API へのリクエストは 2 回 (ユーザー情報とクエスト。コアリションのロールが付いていない人はコアリションも) で、500ms 以上の間隔を空けるため、300 人で 5 分以上かかる
 */
const MAX_USERS_PER_RUN = 300;

/**
 * intra と連携しているユーザーを、前回の同期が古い順に 42 API と同期する
 */
@Injectable()
export class SyncIntraUsersProcessorService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private intraSyncService: IntraSyncService,
		private intraProjectService: IntraProjectService,
		private intraCohortService: IntraCohortService,
		private queueLoggerService: QueueLoggerService,
	) {
		this.logger = this.queueLoggerService.logger.createSubLogger('sync-intra-users');
	}

	@bindThis
	public async process(): Promise<void> {
		// 連携を無効にした直後は、登録済みのジョブが一度だけ実行されることがある
		if (this.config.intra == null) return;

		try {
			await this.intraSyncService.ensureLevelRoles();
		} catch (err) {
			// レベルのロールを作れなくても、ユーザーの同期は続ける
			this.logger.warn(`Failed to ensure level roles: ${err instanceof Error ? err.message : String(err)}`);
		}

		try {
			// 入学時期をまだ集計していないキャンパス (初回など) の入学時期を、ユーザーのロールを決める前に集計する
			await this.intraCohortService.syncMissingCampuses();
		} catch (err) {
			// 集計できなくても、ユーザーの同期は続ける (入学時期はピシンの年月を丸めて決める)
			this.logger.warn(`Failed to sync cohorts: ${err instanceof Error ? err.message : String(err)}`);
		}

		const profiles = await this.userProfilesRepository.createQueryBuilder('profile')
			.innerJoin('profile.user', 'user')
			.select(['profile.userId'])
			.where('profile.intraId IS NOT NULL')
			.andWhere('user.isDeleted = FALSE')
			.orderBy('profile.intraSyncedAt', 'ASC', 'NULLS FIRST')
			.limit(MAX_USERS_PER_RUN)
			.getMany();

		this.logger.info(`Syncing ${profiles.length} users with 42 intra...`);

		let failed = 0;
		for (const { userId } of profiles) {
			try {
				await this.intraSyncService.syncUser(userId);
			} catch (err) {
				// 1 人の失敗で全体を止めない
				failed++;
				this.logger.warn(`Failed to sync user ${userId}: ${err instanceof Error ? err.message : String(err)}`);
			}
		}

		this.logger.succ(`Synced ${profiles.length - failed} users with 42 intra (${failed} failed).`);

		try {
			// 課題をまだ取り込んでいないキャンパス (初回や、新しいキャンパスのユーザーが来たとき) の課題を取り込む。
			// 対象のキャンパスはユーザーの同期で記録した主キャンパスなので、ユーザーの同期の後に行う
			await this.intraProjectService.syncMissingCampuses();
		} catch (err) {
			this.logger.warn(`Failed to sync projects: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
}
