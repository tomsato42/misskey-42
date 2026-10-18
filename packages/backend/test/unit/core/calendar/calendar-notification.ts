/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import {
	getCalendarEventIdOfNotification,
	normalizeCalendarNotificationSettings,
	packCalendarEventScheduleSnapshot,
	packCalendarNotificationFields,
	toCalendarEventScheduleSnapshot,
} from '@/core/calendar/calendar-notification.js';
import type { MiNotification } from '@/models/Notification.js';
import type { Packed } from '@/misc/json-schema.js';

const EVENT_LITE = { id: 'event1', title: 'もくもく会' } as Packed<'CalendarEventLite'>;

describe('日時の保存と返り値の形', () => {
	test('時刻のあるイベントは日本時間の日付・時刻にする', () => {
		const snapshot = toCalendarEventScheduleSnapshot({
			startsAt: new Date('2026-10-20T10:00:00.000Z'),
			endsAt: new Date('2026-10-20T11:30:00.000Z'),
			isAllDay: false,
		});
		expect(snapshot).toEqual({ startsAt: '2026-10-20T10:00:00.000Z', endsAt: '2026-10-20T11:30:00.000Z', isAllDay: false });
		// Redis に JSON で保存しても同じ値に戻る
		expect(packCalendarEventScheduleSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual({
			date: '2026-10-20',
			startTime: '19:00',
			endTime: '20:30',
			isAllDay: false,
			startsAt: '2026-10-20T10:00:00.000Z',
			endsAt: '2026-10-20T11:30:00.000Z',
		});
	});

	test('終日・終了時刻の無いイベントは時刻が null', () => {
		expect(packCalendarEventScheduleSnapshot({ startsAt: '2026-10-19T15:00:00.000Z', endsAt: null, isAllDay: true })).toMatchObject({
			date: '2026-10-20', startTime: null, endTime: null, isAllDay: true,
		});
		expect(packCalendarEventScheduleSnapshot({ startsAt: '2026-10-20T10:00:00.000Z', endsAt: null, isAllDay: false })).toMatchObject({
			startTime: '19:00', endTime: null,
		});
	});
});

describe('通知の返り値に足す項目', () => {
	const base = { id: 'n1', createdAt: '2026-10-19T00:00:00.000Z' };

	test('リマインド', () => {
		const notification: MiNotification = { ...base, type: 'calendarEventReminder', eventId: 'event1', reminderKind: 'day' };
		expect(getCalendarEventIdOfNotification(notification)).toBe('event1');
		expect(packCalendarNotificationFields(notification, EVENT_LITE)).toEqual({ event: EVENT_LITE, reminderKind: 'day' });
	});

	test('日時の変更と中止', () => {
		const schedule = { startsAt: '2026-10-21T10:00:00.000Z', endsAt: null, isAllDay: false };
		const rescheduled: MiNotification = {
			...base,
			type: 'calendarEventUpdated',
			eventId: 'event1',
			updateKind: 'rescheduled',
			previousSchedule: { startsAt: '2026-10-20T10:00:00.000Z', endsAt: null, isAllDay: false },
			schedule,
		};
		expect(packCalendarNotificationFields(rescheduled, EVENT_LITE)).toMatchObject({
			event: EVENT_LITE,
			updateKind: 'rescheduled',
			previousSchedule: { date: '2026-10-20', startTime: '19:00' },
			schedule: { date: '2026-10-21', startTime: '19:00' },
		});

		const canceled: MiNotification = { ...rescheduled, updateKind: 'canceled', previousSchedule: null };
		expect(packCalendarNotificationFields(canceled, EVENT_LITE)).toMatchObject({ updateKind: 'canceled', previousSchedule: null });
	});

	test('カレンダーの通知でなければ何も足さない', () => {
		const notification: MiNotification = { ...base, type: 'login' };
		expect(getCalendarEventIdOfNotification(notification)).toBeNull();
		expect(packCalendarNotificationFields(notification, EVENT_LITE)).toEqual({});
	});
});

describe('normalizeCalendarNotificationSettings', () => {
	test('項目が無い・真偽値でないときは既定のオン', () => {
		expect(normalizeCalendarNotificationSettings(null)).toEqual({ week: true, day: true, today: true, changes: true });
		expect(normalizeCalendarNotificationSettings({ week: false, day: 'no' })).toEqual({ week: false, day: true, today: true, changes: true });
	});

	test('余計な項目は落とす', () => {
		expect(normalizeCalendarNotificationSettings({ changes: false, extra: true } as never)).toEqual({ week: true, day: true, today: true, changes: false });
	});
});
