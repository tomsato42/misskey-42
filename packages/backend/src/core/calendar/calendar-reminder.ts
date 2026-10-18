/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// イベントのリマインドを送る時刻の計算 (日本時間)。
// week: 開始日の7日前の 9:00、day: 前日の 9:00、today: 当日の 9:00。
// ただし today は、開始が 9:00 ちょうどかそれより前 (終日でない) なら開始の1時間前。
// 終日のイベントは開始日の 0:00 を基準にする

import { calendarEventReminderKinds } from '@/models/CalendarEventReminder.js';
import type { CalendarEventReminderKind } from '@/models/CalendarEventReminder.js';
import type { MiCalendarEvent } from '@/models/CalendarEvent.js';
import { startOfJstDay } from './calendar-time.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** リマインドを送る時刻 (日本時間の時) */
export const CALENDAR_REMINDER_HOUR = 9;

/**
 * 送る時刻を過ぎてから、まだ送ってよい時間。定期ジョブは5分ごとに動くので、
 * ジョブが少し遅れたり止まったりしても、この時間の中なら送る。これより前に作られたイベントや購読には送らない
 */
export const CALENDAR_REMINDER_WINDOW_MS = 30 * 60 * 1000;

/**
 * 定期ジョブで見るイベントの開始日時の範囲 (今からの時間)。
 * week のリマインドは開始の最大 7日15時間前 (23:59 に始まるイベント) なので、8日先まで見れば足りる
 */
export const CALENDAR_REMINDER_LOOKAHEAD_MS = 8 * DAY_MS;

/** 終日のイベントは当日中 (翌日の 0:00 まで) を「終わっていない」とするため、1日前まで遡って探す */
export const CALENDAR_REMINDER_LOOKBEHIND_MS = DAY_MS;

export type CalendarReminderEventLike = Pick<MiCalendarEvent, 'startsAt' | 'isAllDay'>;

/**
 * リマインドを送る時刻
 */
export function getCalendarReminderTime(event: CalendarReminderEventLike, kind: CalendarEventReminderKind): Date {
	const dayStart = startOfJstDay(event.startsAt).getTime();
	const reminderOfDay = (daysBefore: number) => new Date(dayStart - daysBefore * DAY_MS + CALENDAR_REMINDER_HOUR * HOUR_MS);

	switch (kind) {
		case 'week': return reminderOfDay(7);
		case 'day': return reminderOfDay(1);
		case 'today': {
			const nineOClock = reminderOfDay(0);
			// 9:00 ちょうどに始まるイベントも、9:00 に送ると間に合わないので1時間前にする
			if (!event.isAllDay && event.startsAt.getTime() <= nineOClock.getTime()) {
				return new Date(event.startsAt.getTime() - HOUR_MS);
			}
			return nineOClock;
		}
	}
}

/**
 * リマインドを送るにはもう遅いか。時刻のあるイベントは始まったら、終日のイベントはその日が終わったら遅い
 * (終日のイベントは 0:00 に始まるので、当日 9:00 のリマインドを送れるようにする)
 */
export function isTooLateForCalendarReminder(event: CalendarReminderEventLike, now: Date): boolean {
	const deadline = event.isAllDay ? event.startsAt.getTime() + DAY_MS : event.startsAt.getTime();
	return now.getTime() >= deadline;
}

/**
 * now の時点で送るべきリマインドの種類。送る時刻が「now の30分前 〜 now」に入っていて、遅すぎないもの
 */
export function getDueCalendarReminderKinds(event: CalendarReminderEventLike, now: Date): CalendarEventReminderKind[] {
	if (isTooLateForCalendarReminder(event, now)) return [];
	const nowMs = now.getTime();
	return calendarEventReminderKinds.filter(kind => {
		const at = getCalendarReminderTime(event, kind).getTime();
		return at <= nowMs && nowMs - at <= CALENDAR_REMINDER_WINDOW_MS;
	});
}
