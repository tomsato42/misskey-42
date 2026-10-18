/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// カレンダーの通知 (calendarEventReminder / calendarEventUpdated) の保存と返り値の形。
// 通知は Redis に JSON で保存するので、日時は ISO 8601 の文字列で持つ

import type { Packed } from '@/misc/json-schema.js';
import { DEFAULT_CALENDAR_NOTIFICATION_SETTINGS } from '@/models/CalendarEvent.js';
import type { CalendarNotificationSettings, MiCalendarEvent } from '@/models/CalendarEvent.js';
import type { CalendarEventReminderKind } from '@/models/CalendarEventReminder.js';
import type { MiGroupedNotification, MiNotification } from '@/models/Notification.js';
import { formatJstDate, formatJstTime } from './calendar-time.js';
import type { CalendarEventSchedule } from './calendar-time.js';

export const calendarNotificationTypes = ['calendarEventReminder', 'calendarEventUpdated'] as const;
export type CalendarNotificationType = typeof calendarNotificationTypes[number];

/**
 * rescheduled: 日時 (開始・終了・終日) が変わった、canceled: 中止された
 */
export const calendarEventUpdateKinds = ['rescheduled', 'canceled'] as const;
export type CalendarEventUpdateKind = typeof calendarEventUpdateKinds[number];

/** 通知に保存する、その時点のイベントの日時 */
export type CalendarEventScheduleSnapshot = {
	startsAt: string;
	endsAt: string | null;
	isAllDay: boolean;
};

/** MiNotification の calendarEventReminder の中身 (type・id・createdAt 以外) */
export type CalendarEventReminderNotificationData = {
	eventId: MiCalendarEvent['id'];
	reminderKind: CalendarEventReminderKind;
};

/** MiNotification の calendarEventUpdated の中身 (type・id・createdAt 以外) */
export type CalendarEventUpdatedNotificationData = {
	eventId: MiCalendarEvent['id'];
	updateKind: CalendarEventUpdateKind;
	/** 変更前の日時。rescheduled のときだけ入る */
	previousSchedule: CalendarEventScheduleSnapshot | null;
	/** 変更後の日時 (rescheduled) か、中止したときの日時 (canceled) */
	schedule: CalendarEventScheduleSnapshot;
};

/**
 * 保存されている calendarNotificationSettings を 4 項目そろった形にする (項目が無い・真偽値でないときは既定のオン)
 */
export function normalizeCalendarNotificationSettings(raw: Partial<Record<keyof CalendarNotificationSettings, unknown>> | null | undefined): CalendarNotificationSettings {
	const result = { ...DEFAULT_CALENDAR_NOTIFICATION_SETTINGS };
	for (const key of Object.keys(DEFAULT_CALENDAR_NOTIFICATION_SETTINGS) as (keyof CalendarNotificationSettings)[]) {
		const value = raw?.[key];
		if (typeof value === 'boolean') result[key] = value;
	}
	return result;
}

export function toCalendarEventScheduleSnapshot(schedule: CalendarEventSchedule): CalendarEventScheduleSnapshot {
	return {
		startsAt: schedule.startsAt.toISOString(),
		endsAt: schedule.endsAt?.toISOString() ?? null,
		isAllDay: schedule.isAllDay,
	};
}

/** 保存した日時を返り値の形 (日本時間の日付・時刻を含む) にする */
export function packCalendarEventScheduleSnapshot(snapshot: CalendarEventScheduleSnapshot): Packed<'CalendarEventSchedule'> {
	const startsAt = new Date(snapshot.startsAt);
	const endsAt = snapshot.endsAt != null ? new Date(snapshot.endsAt) : null;
	return {
		date: formatJstDate(startsAt),
		startTime: snapshot.isAllDay ? null : formatJstTime(startsAt),
		endTime: snapshot.isAllDay || endsAt == null ? null : formatJstTime(endsAt),
		isAllDay: snapshot.isAllDay,
		startsAt: startsAt.toISOString(),
		endsAt: endsAt?.toISOString() ?? null,
	};
}

/** カレンダーの通知なら、対象のイベントの ID を返す */
export function getCalendarEventIdOfNotification(notification: MiNotification | MiGroupedNotification): MiCalendarEvent['id'] | null {
	if (notification.type === 'calendarEventReminder' || notification.type === 'calendarEventUpdated') {
		return notification.eventId;
	}
	return null;
}

/**
 * カレンダーの通知の返り値に足す項目。カレンダーの通知でなければ空のオブジェクト
 */
export function packCalendarNotificationFields(
	notification: MiNotification | MiGroupedNotification,
	event: Packed<'CalendarEventLite'>,
): Record<string, unknown> {
	if (notification.type === 'calendarEventReminder') {
		return {
			event,
			reminderKind: notification.reminderKind,
		};
	}
	if (notification.type === 'calendarEventUpdated') {
		return {
			event,
			updateKind: notification.updateKind,
			previousSchedule: notification.previousSchedule != null ? packCalendarEventScheduleSnapshot(notification.previousSchedule) : null,
			schedule: packCalendarEventScheduleSnapshot(notification.schedule),
		};
	}
	return {};
}
