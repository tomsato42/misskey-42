/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import type Logger from '@/logger.js';
import { bindThis } from '@/decorators.js';
import { PairRecruitmentService } from '@/core/pair/PairRecruitmentService.js';
import { QueueLoggerService } from '../QueueLoggerService.js';

/**
 * 期限 (作成から 14 日) を過ぎたペア募集を締め切り、作成者とメンバーに通知する
 */
@Injectable()
export class CloseExpiredPairRecruitmentsProcessorService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		private pairRecruitmentService: PairRecruitmentService,
		private queueLoggerService: QueueLoggerService,
	) {
		this.logger = this.queueLoggerService.logger.createSubLogger('close-expired-pair-recruitments');
	}

	@bindThis
	public async process(): Promise<void> {
		// 連携を無効にした直後は、登録済みのジョブが一度だけ実行されることがある
		if (this.config.intra == null) return;

		const closed = await this.pairRecruitmentService.closeExpired();
		if (closed > 0) this.logger.succ(`Closed ${closed} expired pair recruitments.`);
	}
}
