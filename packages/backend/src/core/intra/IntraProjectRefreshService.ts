/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { UserProfilesRepository } from '@/models/_.js';
import type { MiUser } from '@/models/User.js';
import { LoggerService } from '@/core/LoggerService.js';
import { NotificationService } from '@/core/NotificationService.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { IntraSyncService } from './IntraSyncService.js';

/** intra と連携していない */
export class IntraNotLinkedError extends Error {
	constructor() {
		super('The user is not linked with 42 intra');
	}
}

/** 前に頼んだ再取得がまだ終わっていない */
export class IntraRefreshInProgressError extends Error {
	constructor() {
		super('A refresh is already in progress');
	}
}

/**
 * ユーザーが自分で頼んだ、42 intra の情報 (課題の結果を含む) の再取得。
 * 毎時の同期を待たずに 1 人分だけ取得し、終わったら intraProjectsRefreshed を通知する
 */
@Injectable()
export class IntraProjectRefreshService {
	private logger: Logger;
	/** 取得中のユーザー (このプロセスの中だけ。重ねて頼まれたときに断る) */
	private running = new Set<MiUser['id']>();

	constructor(
		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private intraSyncService: IntraSyncService,
		private notificationService: NotificationService,
		private loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger('intra-refresh');
	}

	/**
	 * 再取得を始める。取得は待たずに返し、終わったら通知する
	 * @throws IntraNotLinkedError intra と連携していない
	 * @throws IntraRefreshInProgressError 前に頼んだ再取得がまだ終わっていない
	 */
	@bindThis
	public async requestRefresh(userId: MiUser['id']): Promise<void> {
		if (this.running.has(userId)) throw new IntraRefreshInProgressError();

		const profile = await this.userProfilesRepository.findOne({ where: { userId }, select: { userId: true, intraId: true } });
		if (profile?.intraId == null) throw new IntraNotLinkedError();

		this.running.add(userId);
		void this.refresh(userId).finally(() => {
			this.running.delete(userId);
		});
	}

	@bindThis
	private async refresh(userId: MiUser['id']): Promise<void> {
		let failed = false;
		try {
			await this.intraSyncService.syncUser(userId);
		} catch (err) {
			failed = true;
			this.logger.warn(`Failed to refresh user ${userId}: ${err instanceof Error ? err.message : String(err)}`);
		}
		this.notificationService.createNotification(userId, 'intraProjectsRefreshed', { failed });
	}
}
