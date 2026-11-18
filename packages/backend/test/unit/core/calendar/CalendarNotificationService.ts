/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// DB を引くメソッドをメモリ上のデータに差し替えて、CalendarNotificationService の分岐を確かめる (DB 不要)

import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
	CalendarNotificationService,
	MAX_REMINDERS_PER_RUN,
} from '@/core/calendar/CalendarNotificationService.js';
import { jstToDate } from '@/core/calendar/calendar-time.js';
import type { NotificationService } from '@/core/NotificationService.js';
import type { LoggerService } from '@/core/LoggerService.js';
import type { CalendarEventReminderKind } from '@/models/CalendarEventReminder.js';

type EventRow = { id: string; startsAt: Date; isAllDay: boolean };
type Subscriber = { userId: string; settings?: Partial<Record<CalendarEventReminderKind | 'changes', boolean>>; suspended?: boolean };

function jst(value: string): Date {
	const [date, time = '00:00'] = value.split(' ');
	const [year, month, day] = date.split('-').map(Number);
	const [hour, minute] = time.split(':').map(Number);
	return jstToDate({ year, month, day }, { hour, minute });
}

describe('CalendarNotificationService', () => {
	let events: EventRow[];
	let subscribers: Map<string, Subscriber[]>;
	/** `${eventId}:${userId}:${kind}` */
	let reminded: Set<string>;
	let createNotification: ReturnType<typeof vi.fn>;
	let claimCalls: { eventId: string; kind: string; userIds: string[] }[];
	let service: CalendarNotificationService;

	beforeEach(() => {
		events = [];
		subscribers = new Map();
		reminded = new Set();
		claimCalls = [];
		createNotification = vi.fn();

		const loggerService = { getLogger: () => ({ error: vi.fn(), warn: vi.fn() }) } as unknown as LoggerService;
		service = new CalendarNotificationService(
			{} as never,
			{} as never,
			{} as never,
			{ createNotification } as unknown as NotificationService,
			{ gen: () => 'id' } as never,
			loggerService,
		);

		// SQL の条件 (凍結を除く、設定がオフの人を除く、送った記録がある人を除く) をメモリ上で再現する
		Object.defineProperty(service, 'findSubscriberIdsToNotify', {
			value: async (eventId: string, setting: CalendarEventReminderKind | 'changes', opts: { limit: number; excludeUserId?: string; afterUserId?: string | null; onlyNotReminded?: boolean }) => {
				return (subscribers.get(eventId) ?? [])
					.filter(s => !s.suspended)
					.filter(s => s.settings?.[setting] !== false)
					.filter(s => s.userId !== opts.excludeUserId)
					.filter(s => opts.afterUserId == null || s.userId > opts.afterUserId)
					.filter(s => !opts.onlyNotReminded || !reminded.has(`${eventId}:${s.userId}:${setting}`))
					.map(s => s.userId)
					.sort()
					.slice(0, opts.limit);
			},
		});
		Object.defineProperty(service, 'findReminderCandidateEvents', {
			value: async () => events,
		});
		Object.defineProperty(service, 'claimReminders', {
			configurable: true,
			value: async (eventId: string, kind: string, userIds: string[]) => {
				claimCalls.push({ eventId, kind, userIds });
				const claimed: string[] = [];
				for (const userId of userIds) {
					const key = `${eventId}:${userId}:${kind}`;
					if (reminded.has(key)) continue;
					reminded.add(key);
					claimed.push(userId);
				}
				return claimed;
			},
		});
	});

	function notifiedUserIds(type: string): string[] {
		return createNotification.mock.calls.filter(c => c[1] === type).map(c => c[0] as string).sort();
	}

	describe('日時の変更・中止', () => {
		test('操作した本人・凍結されたユーザー・changes をオフにした人を除いて送る', async () => {
			subscribers.set('event1', [
				{ userId: 'alice' },
				{ userId: 'bob' },
				{ userId: 'carol', settings: { changes: false } },
				{ userId: 'dave', suspended: true },
				// リマインドをオフにしていても、変更の通知は届く
				{ userId: 'erin', settings: { week: false, day: false, today: false } },
			]);

			const sent = await service.sendUpdatedNotifications({
				eventId: 'event1',
				updateKind: 'canceled',
				previousSchedule: null,
				schedule: { startsAt: '2026-10-20T03:00:00.000Z', endsAt: null, isAllDay: false },
			}, { id: 'alice' });

			expect(sent).toBe(2);
			expect(notifiedUserIds('calendarEventUpdated')).toEqual(['bob', 'erin']);
			expect(createNotification.mock.calls[0][2]).toMatchObject({ eventId: 'event1', updateKind: 'canceled' });
			// 通知の相手のユーザー (notifierId) は付けない
			expect(createNotification.mock.calls[0][3]).toBeUndefined();
		});

		test('購読者が多いときは分けて引き、全員に送る', async () => {
			subscribers.set('event1', Array.from({ length: 1234 }, (_, i) => ({ userId: `u${String(i).padStart(5, '0')}` })));

			const sent = await service.sendUpdatedNotifications({
				eventId: 'event1',
				updateKind: 'rescheduled',
				previousSchedule: { startsAt: '2026-10-20T03:00:00.000Z', endsAt: null, isAllDay: false },
				schedule: { startsAt: '2026-10-21T03:00:00.000Z', endsAt: null, isAllDay: false },
			}, { id: 'owner' });

			expect(sent).toBe(1234);
			expect(new Set(notifiedUserIds('calendarEventUpdated')).size).toBe(1234);
		});

		test('notifyRescheduled は変更前後の日時を保存する形にして、待たずに送る', async () => {
			subscribers.set('event1', [{ userId: 'bob' }]);
			service.notifyRescheduled({ id: 'event1' }, {
				previous: { startsAt: new Date('2026-10-20T03:00:00.000Z'), endsAt: null, isAllDay: false },
				current: { startsAt: new Date('2026-10-19T15:00:00.000Z'), endsAt: null, isAllDay: true },
			}, { id: 'alice' });

			await vi.waitFor(() => expect(createNotification).toHaveBeenCalledOnce());
			expect(createNotification.mock.calls[0]).toEqual(['bob', 'calendarEventUpdated', {
				eventId: 'event1',
				updateKind: 'rescheduled',
				previousSchedule: { startsAt: '2026-10-20T03:00:00.000Z', endsAt: null, isAllDay: false },
				schedule: { startsAt: '2026-10-19T15:00:00.000Z', endsAt: null, isAllDay: true },
			}]);
		});

		test('notifyCanceled は中止したときの日時を入れる', async () => {
			subscribers.set('event1', [{ userId: 'bob' }]);
			service.notifyCanceled({ id: 'event1', startsAt: new Date('2026-10-20T03:00:00.000Z'), endsAt: new Date('2026-10-20T04:00:00.000Z'), isAllDay: false }, { id: 'alice' });

			await vi.waitFor(() => expect(createNotification).toHaveBeenCalledOnce());
			expect(createNotification.mock.calls[0][2]).toEqual({
				eventId: 'event1',
				updateKind: 'canceled',
				previousSchedule: null,
				schedule: { startsAt: '2026-10-20T03:00:00.000Z', endsAt: '2026-10-20T04:00:00.000Z', isAllDay: false },
			});
		});
	});

	describe('リマインド', () => {
		test('送る時刻になった種類だけ、設定がオンで未送信の購読者に送る', async () => {
			events.push({ id: 'event1', startsAt: jst('2026-10-20 12:00'), isAllDay: false });
			subscribers.set('event1', [
				{ userId: 'alice' },
				{ userId: 'bob', settings: { day: false } },
				{ userId: 'carol', suspended: true },
				{ userId: 'dave' },
			]);
			reminded.add('event1:dave:day');

			const result = await service.sendDueReminders(jst('2026-10-19 09:05'));

			expect(result).toEqual({ events: 1, sent: 1, truncated: false });
			expect(createNotification.mock.calls).toEqual([['alice', 'calendarEventReminder', { eventId: 'event1', reminderKind: 'day' }]]);
		});

		test('記録を先に入れ、入れられなかった (他のワーカーが先に送った) 人には送らない', async () => {
			events.push({ id: 'event1', startsAt: jst('2026-10-20 12:00'), isAllDay: false });
			subscribers.set('event1', [{ userId: 'alice' }, { userId: 'bob' }]);
			// 購読者を引いた後、記録を入れる前に別のワーカーが bob に送った
			const originalClaim = (service as any).claimReminders;
			Object.defineProperty(service, 'claimReminders', {
				value: async (eventId: string, kind: string, userIds: string[]) => {
					reminded.add(`${eventId}:bob:${kind}`);
					return await originalClaim(eventId, kind, userIds);
				},
			});

			const result = await service.sendDueReminders(jst('2026-10-19 09:00'));

			expect(result.sent).toBe(1);
			expect(notifiedUserIds('calendarEventReminder')).toEqual(['alice']);
		});

		test('同じ時刻に 2 回動いても 1 回だけ送る', async () => {
			events.push({ id: 'event1', startsAt: jst('2026-10-20 12:00'), isAllDay: false });
			subscribers.set('event1', [{ userId: 'alice' }]);

			await service.sendDueReminders(jst('2026-10-19 09:00'));
			await service.sendDueReminders(jst('2026-10-19 09:05'));

			expect(createNotification).toHaveBeenCalledOnce();
		});

		test('送る時刻でないイベント・始まったイベントには送らず、購読者も引かない', async () => {
			events.push({ id: 'later', startsAt: jst('2026-10-25 12:00'), isAllDay: false });
			events.push({ id: 'started', startsAt: jst('2026-10-19 09:10'), isAllDay: false });
			subscribers.set('later', [{ userId: 'alice' }]);
			subscribers.set('started', [{ userId: 'alice' }]);

			const result = await service.sendDueReminders(jst('2026-10-19 09:15'));

			expect(result.sent).toBe(0);
			expect(claimCalls).toEqual([]);
		});

		test('1 回に送る数の上限で打ち切り、残りは次の回に送る', async () => {
			events.push({ id: 'event1', startsAt: jst('2026-10-20 12:00'), isAllDay: false });
			events.push({ id: 'event2', startsAt: jst('2026-10-20 13:00'), isAllDay: false });
			subscribers.set('event1', Array.from({ length: MAX_REMINDERS_PER_RUN }, (_, i) => ({ userId: `u${String(i).padStart(5, '0')}` })));
			subscribers.set('event2', [{ userId: 'alice' }]);

			const first = await service.sendDueReminders(jst('2026-10-19 09:00'));
			expect(first).toEqual({ events: 2, sent: MAX_REMINDERS_PER_RUN, truncated: true });
			expect(notifiedUserIds('calendarEventReminder')).not.toContain('alice');

			const second = await service.sendDueReminders(jst('2026-10-19 09:05'));
			expect(second).toEqual({ events: 2, sent: 1, truncated: false });
			expect(createNotification.mock.calls.at(-1)).toEqual(['alice', 'calendarEventReminder', { eventId: 'event2', reminderKind: 'day' }]);
		});
	});
});
