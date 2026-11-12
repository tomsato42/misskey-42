/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import type Logger from '@/logger.js';
import { bindThis } from '@/decorators.js';
import { CalendarNotificationService } from '@/core/calendar/CalendarNotificationService.js';
import { QueueLoggerService } from '../QueueLoggerService.js';

/**
 * 購読しているカレンダーのイベントのリマインド (1週間前・前日・当日) を送る。5分ごとに動く
 */
@Injectable()
export class CalendarEventRemindersProcessorService {
	private logger: Logger;

	constructor(
		private calendarNotificationService: CalendarNotificationService,
		private queueLoggerService: QueueLoggerService,
	) {
		this.logger = this.queueLoggerService.logger.createSubLogger('calendar-event-reminders');
	}

	@bindThis
	public async process(): Promise<void> {
		const result = await this.calendarNotificationService.sendDueReminders(new Date());

		if (result.truncated) {
			this.logger.warn(`Reached the per-run limit (${result.events} events checked, ${result.sent} reminders sent). The rest will be sent in the next run.`);
		} else if (result.sent > 0) {
			this.logger.info(`Sent ${result.sent} calendar event reminders (${result.events} events checked).`);
		}
	}
}
