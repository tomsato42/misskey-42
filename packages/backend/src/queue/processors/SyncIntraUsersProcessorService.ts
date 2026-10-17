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
import { QueueLoggerService } from '../QueueLoggerService.js';

/** 1 回のジョブで同期するユーザー数の上限。42 API へのリクエストは 500ms 以上の間隔を空けるため、300 人で 2.5 分以上かかる */
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
		private queueLoggerService: QueueLoggerService,
	) {
		this.logger = this.queueLoggerService.logger.createSubLogger('sync-intra-users');
	}

	@bindThis
	public async process(): Promise<void> {
		// 連携を無効にした直後は、登録済みのジョブが一度だけ実行されることがある
		if (this.config.intra == null) return;

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
	}
}
