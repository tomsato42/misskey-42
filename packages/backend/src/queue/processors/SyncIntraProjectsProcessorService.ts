/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import type Logger from '@/logger.js';
import { bindThis } from '@/decorators.js';
import { IntraProjectService } from '@/core/intra/IntraProjectService.js';
import { IntraCohortService } from '@/core/intra/IntraCohortService.js';
import { QueueLoggerService } from '../QueueLoggerService.js';

/**
 * 42 intra の課題 (キャンパスごとの登録の条件) を取り込み、ピシンごとの入学時期を集計し直す。
 * 1 キャンパスあたり 42 API へのリクエストは、課題が 6 回 (42 Tokyo・42cursus で 161 件、1 ページ 30 件)、
 * 入学時期が 18 回 (42 Tokyo・42cursus で 1720 人、1 ページ 100 件)
 */
@Injectable()
export class SyncIntraProjectsProcessorService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		private intraProjectService: IntraProjectService,
		private intraCohortService: IntraCohortService,
		private queueLoggerService: QueueLoggerService,
	) {
		this.logger = this.queueLoggerService.logger.createSubLogger('sync-intra-projects');
	}

	@bindThis
	public async process(): Promise<void> {
		// 連携を無効にした直後は、登録済みのジョブが一度だけ実行されることがある
		if (this.config.intra == null) return;

		this.logger.info('Syncing projects with 42 intra...');
		await this.intraProjectService.syncAllCampuses();
		this.logger.succ('Synced projects with 42 intra.');

		this.logger.info('Syncing cohorts with 42 intra...');
		await this.intraCohortService.syncAllCampuses();
		this.logger.succ('Synced cohorts with 42 intra.');
	}
}
