/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type {
	CalendarEventRemindersRepository,
	CalendarEventsRepository,
	CalendarEventSubscriptionsRepository,
} from '@/models/_.js';
import type { MiCalendarEvent } from '@/models/CalendarEvent.js';
import { MiCalendarEventReminder } from '@/models/CalendarEventReminder.js';
import type { CalendarEventReminderKind } from '@/models/CalendarEventReminder.js';
import { MiUser } from '@/models/User.js';
import { MiUserProfile } from '@/models/UserProfile.js';
import { NotificationService } from '@/core/NotificationService.js';
import { IdService } from '@/core/IdService.js';
import { LoggerService } from '@/core/LoggerService.js';
import { bindThis } from '@/decorators.js';
import { trackPromise } from '@/misc/promise-tracker.js';
import type Logger from '@/logger.js';
import {
	CALENDAR_REMINDER_LOOKAHEAD_MS,
	CALENDAR_REMINDER_LOOKBEHIND_MS,
	getDueCalendarReminderKinds,
} from './calendar-reminder.js';
import { toCalendarEventScheduleSnapshot } from './calendar-notification.js';
import type { CalendarEventUpdatedNotificationData } from './calendar-notification.js';
import type { CalendarEventSchedule } from './calendar-time.js';

type Me = { id: MiUser['id'] };

/** calendarNotificationSettings の項目 */
type CalendarNotificationSettingKey = CalendarEventReminderKind | 'changes';

/** 日時の変更・中止の通知で、購読者を一度に引く数 */
const UPDATED_RECIPIENTS_BATCH_SIZE = 500;

/** 定期ジョブ 1 回で見るイベントの数の上限 (開始が近い順) */
export const MAX_REMINDER_EVENTS_PER_RUN = 1000;

/** 定期ジョブ 1 回で送るリマインドの数の上限。残りは次の回 (5分後) に送る */
export const MAX_REMINDERS_PER_RUN = 1000;

export type CalendarReminderRunResult = {
	/** 見たイベントの数 */
	events: number;
	/** 送ったリマインドの数 */
	sent: number;
	/** 上限に達して、残りを次の回に回したか */
	truncated: boolean;
};

/**
 * カレンダーのイベントの通知 (日時の変更・中止、リマインド) を購読者に送る
 */
@Injectable()
export class CalendarNotificationService {
	private logger: Logger;

	constructor(
		@Inject(DI.calendarEventsRepository)
		private calendarEventsRepository: CalendarEventsRepository,

		@Inject(DI.calendarEventSubscriptionsRepository)
		private calendarEventSubscriptionsRepository: CalendarEventSubscriptionsRepository,

		@Inject(DI.calendarEventRemindersRepository)
		private calendarEventRemindersRepository: CalendarEventRemindersRepository,

		private notificationService: NotificationService,
		private idService: IdService,
		private loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger('calendar');
	}

	//#region 日時の変更・中止

	/**
	 * 日時が変わったことを購読者に通知する。API の応答を遅くしないよう、待たずに裏で送る
	 */
	@bindThis
	public notifyRescheduled(event: Pick<MiCalendarEvent, 'id'>, change: { previous: CalendarEventSchedule; current: CalendarEventSchedule }, operator: Me): void {
		this.runInBackground(event.id, {
			eventId: event.id,
			updateKind: 'rescheduled',
			previousSchedule: toCalendarEventScheduleSnapshot(change.previous),
			schedule: toCalendarEventScheduleSnapshot(change.current),
		}, operator);
	}

	/**
	 * 中止したことを購読者に通知する。API の応答を遅くしないよう、待たずに裏で送る
	 */
	@bindThis
	public notifyCanceled(event: Pick<MiCalendarEvent, 'id' | 'startsAt' | 'endsAt' | 'isAllDay'>, operator: Me): void {
		this.runInBackground(event.id, {
			eventId: event.id,
			updateKind: 'canceled',
			previousSchedule: null,
			schedule: toCalendarEventScheduleSnapshot(event),
		}, operator);
	}

	@bindThis
	private runInBackground(eventId: MiCalendarEvent['id'], data: CalendarEventUpdatedNotificationData, operator: Me): void {
		trackPromise(this.sendUpdatedNotifications(data, operator).catch(err => {
			this.logger.error(`Failed to notify subscribers of calendar event ${eventId}: ${err instanceof Error ? err.message : String(err)}`);
		}));
	}

	/**
	 * 購読者 (操作した本人、凍結・削除済み、changes をオフにした人を除く) に calendarEventUpdated を送る。
	 * 購読者が多くても 1 回のクエリが重くならないよう、ユーザー ID の順に分けて引く
	 * @returns 送った数
	 */
	@bindThis
	public async sendUpdatedNotifications(data: CalendarEventUpdatedNotificationData, operator: Me): Promise<number> {
		let sent = 0;
		let afterUserId: MiUser['id'] | null = null;
		for (;;) {
			const userIds = await this.findSubscriberIdsToNotify(data.eventId, 'changes', {
				excludeUserId: operator.id,
				afterUserId,
				limit: UPDATED_RECIPIENTS_BATCH_SIZE,
			});
			for (const userId of userIds) {
				this.notificationService.createNotification(userId, 'calendarEventUpdated', data);
			}
			sent += userIds.length;
			if (userIds.length < UPDATED_RECIPIENTS_BATCH_SIZE) break;
			afterUserId = userIds[userIds.length - 1];
		}
		return sent;
	}

	//#endregion

	//#region リマインド

	/**
	 * now の時点で送るべきリマインドを送る (定期ジョブから呼ぶ)。
	 * 送る前に calendar_event_reminder に記録を入れ、既に記録があった人には送らない
	 * (複数のワーカーが同時に動いても、同じリマインドは 1 回だけ送られる)
	 */
	@bindThis
	public async sendDueReminders(now: Date): Promise<CalendarReminderRunResult> {
		const events = await this.findReminderCandidateEvents(now, MAX_REMINDER_EVENTS_PER_RUN);
		let sent = 0;
		let budget = MAX_REMINDERS_PER_RUN;

		for (const event of events) {
			for (const kind of getDueCalendarReminderKinds(event, now)) {
				if (budget <= 0) {
					return { events: events.length, sent, truncated: true };
				}

				const userIds = await this.findSubscriberIdsToNotify(event.id, kind, { onlyNotReminded: true, limit: budget });
				if (userIds.length === 0) continue;
				budget -= userIds.length;

				const claimed = await this.claimReminders(event.id, kind, userIds);
				for (const userId of claimed) {
					this.notificationService.createNotification(userId, 'calendarEventReminder', {
						eventId: event.id,
						reminderKind: kind,
					});
				}
				sent += claimed.length;
			}
		}

		return { events: events.length, sent, truncated: events.length >= MAX_REMINDER_EVENTS_PER_RUN };
	}

	/**
	 * リマインドの対象になりうる、中止されていないイベント (開始が近い順)。
	 * 送る時刻かどうかは getDueCalendarReminderKinds で確かめる
	 */
	@bindThis
	protected async findReminderCandidateEvents(now: Date, limit: number): Promise<Pick<MiCalendarEvent, 'id' | 'startsAt' | 'isAllDay'>[]> {
		return await this.calendarEventsRepository.createQueryBuilder('event')
			.select(['event.id', 'event.startsAt', 'event.isAllDay'])
			.where('event.startsAt > :from', { from: new Date(now.getTime() - CALENDAR_REMINDER_LOOKBEHIND_MS) })
			.andWhere('event.startsAt <= :to', { to: new Date(now.getTime() + CALENDAR_REMINDER_LOOKAHEAD_MS) })
			.andWhere('event.canceledAt IS NULL')
			.orderBy('event.startsAt', 'ASC')
			.addOrderBy('event.id', 'ASC')
			.limit(limit)
			.getMany();
	}

	/**
	 * 送ったリマインドの記録を入れる。UNIQUE (eventId, userId, kind) に触れた (既に送った) 人は除いて、記録できた人を返す
	 */
	@bindThis
	protected async claimReminders(eventId: MiCalendarEvent['id'], kind: CalendarEventReminderKind, userIds: MiUser['id'][]): Promise<MiUser['id'][]> {
		if (userIds.length === 0) return [];
		const result = await this.calendarEventRemindersRepository.createQueryBuilder()
			.insert()
			.into(MiCalendarEventReminder)
			.values(userIds.map(userId => ({
				id: this.idService.gen(),
				eventId,
				userId,
				kind,
			})))
			.orIgnore()
			.returning(['userId'])
			.execute();
		return (result.raw as { userId: MiUser['id'] }[]).map(row => row.userId);
	}

	//#endregion

	/**
	 * 通知を送る購読者のユーザー ID (ID の昇順)。凍結・削除済みのユーザーと、calendarNotificationSettings の該当項目をオフにした人を除く
	 */
	@bindThis
	protected async findSubscriberIdsToNotify(
		eventId: MiCalendarEvent['id'],
		setting: CalendarNotificationSettingKey,
		opts: {
			limit: number;
			excludeUserId?: MiUser['id'];
			afterUserId?: MiUser['id'] | null;
			/** リマインドを送った記録が無い人だけにする (setting はリマインドの種類) */
			onlyNotReminded?: boolean;
		},
	): Promise<MiUser['id'][]> {
		const query = this.calendarEventSubscriptionsRepository.createQueryBuilder('subscription')
			.select('subscription.userId', 'userId')
			.innerJoin(MiUser, 'user', 'user.id = subscription.userId')
			.innerJoin(MiUserProfile, 'profile', 'profile.userId = subscription.userId')
			.where('subscription.eventId = :eventId', { eventId })
			.andWhere('user.isSuspended = FALSE')
			.andWhere('user.isDeleted = FALSE')
			// 既定はすべてオン。項目が無いときもオンとみなす
			.andWhere('COALESCE((profile.calendarNotificationSettings ->> CAST(:setting AS text))::boolean, TRUE) = TRUE', { setting })
			.orderBy('subscription.userId', 'ASC')
			.limit(opts.limit);

		if (opts.excludeUserId != null) {
			query.andWhere('subscription.userId != :excludeUserId', { excludeUserId: opts.excludeUserId });
		}
		if (opts.afterUserId != null) {
			query.andWhere('subscription.userId > :afterUserId', { afterUserId: opts.afterUserId });
		}
		if (opts.onlyNotReminded === true) {
			query
				.leftJoin(MiCalendarEventReminder, 'reminder', 'reminder.eventId = subscription.eventId AND reminder.userId = subscription.userId AND reminder.kind = :kind', { kind: setting })
				.andWhere('reminder.id IS NULL');
		}

		const rows = await query.getRawMany<{ userId: MiUser['id'] }>();
		return rows.map(row => row.userId);
	}
}
