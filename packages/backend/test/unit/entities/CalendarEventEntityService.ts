/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 依存するサービスを差し替えて、返り値の形と、まとめて引くこと (N+1 にしないこと) を確認する (DB 不要)

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { CalendarEventEntityService } from '@/core/entities/CalendarEventEntityService.js';
import type { CalendarEventService } from '@/core/calendar/CalendarEventService.js';
import type { UserEntityService } from '@/core/entities/UserEntityService.js';
import type { IdService } from '@/core/IdService.js';
import type { MiCalendarEvent } from '@/models/CalendarEvent.js';

const ALICE = { id: 'alice' };
const BOB = { id: 'bob' };

function event(overrides: Partial<MiCalendarEvent> = {}): MiCalendarEvent {
	return {
		id: 'event1',
		userId: ALICE.id,
		user: null,
		title: 'もくもく会',
		// 日本時間 2026-10-20 12:00〜13:00
		startsAt: new Date('2026-10-20T03:00:00.000Z'),
		endsAt: new Date('2026-10-20T04:00:00.000Z'),
		isAllDay: false,
		location: 'c3',
		description: '説明',
		hashtag: 'mokumoku',
		announcementNoteId: null,
		announcementNote: null,
		canceledAt: null,
		updatedAt: null,
		...overrides,
	};
}

describe('CalendarEventEntityService', () => {
	let calendarEventService: Record<string, ReturnType<typeof vi.fn>>;
	let userEntityService: Record<string, ReturnType<typeof vi.fn>>;
	let service: CalendarEventEntityService;

	beforeEach(() => {
		calendarEventService = {
			findByIdOrFail: vi.fn(async () => event()),
			countSubscribers: vi.fn(async () => 3),
			isSubscribed: vi.fn(async () => true),
			canManage: vi.fn(async (e: MiCalendarEvent, me: { id: string }) => e.userId === me.id),
			countSubscribersOfEvents: vi.fn(async (ids: string[]) => new Map(ids.map((id, i) => [id, i + 1]))),
			getSubscribedEventIds: vi.fn(async (_me: unknown, ids: string[]) => new Set(ids.slice(0, 1))),
			createManageChecker: vi.fn(async (me: { id: string }) => (e: { userId: string }) => e.userId === me.id),
			getEventsOfNotes: vi.fn(async () => new Map()),
		};
		userEntityService = {
			pack: vi.fn(async (u: string | { id: string }) => ({ id: typeof u === 'string' ? u : u.id })),
			packMany: vi.fn(async (us: (string | { id: string })[]) => us.map(u => ({ id: typeof u === 'string' ? u : u.id }))),
		};
		const idService = { parse: () => ({ date: new Date('2026-10-01T00:00:00.000Z') }) } as unknown as IdService;
		service = new CalendarEventEntityService(
			userEntityService as unknown as UserEntityService,
			calendarEventService as unknown as CalendarEventService,
			idService,
		);
	});

	describe('pack', () => {
		test('日付と時刻を日本時間で返す', async () => {
			const packed = await service.pack(event(), BOB);
			expect(packed).toEqual({
				id: 'event1',
				createdAt: '2026-10-01T00:00:00.000Z',
				updatedAt: null,
				userId: 'alice',
				user: { id: 'alice' },
				title: 'もくもく会',
				date: '2026-10-20',
				startTime: '12:00',
				endTime: '13:00',
				isAllDay: false,
				startsAt: '2026-10-20T03:00:00.000Z',
				endsAt: '2026-10-20T04:00:00.000Z',
				location: 'c3',
				description: '説明',
				hashtag: 'mokumoku',
				isCanceled: false,
				canceledAt: null,
				announcementNoteId: null,
				subscribersCount: 3,
				isSubscribed: true,
				canManage: false,
			});
		});

		test('終日のイベントは時刻が null', async () => {
			// 日本時間 2026-10-09 0:00
			const packed = await service.pack(event({ isAllDay: true, startsAt: new Date('2026-10-08T15:00:00.000Z'), endsAt: null }), ALICE);
			expect(packed).toMatchObject({ date: '2026-10-09', startTime: null, endTime: null, isAllDay: true, endsAt: null, canManage: true });
		});

		test('中止したイベント', async () => {
			const canceledAt = new Date('2026-10-10T00:00:00.000Z');
			const packed = await service.pack(event({ canceledAt }), ALICE);
			expect(packed).toMatchObject({ isCanceled: true, canceledAt: canceledAt.toISOString() });
		});

		test('閲覧者がいなければ isSubscribed と canManage を含めない', async () => {
			const packed = await service.pack(event(), null);
			expect(packed).not.toHaveProperty('isSubscribed');
			expect(packed).not.toHaveProperty('canManage');
			expect(calendarEventService.isSubscribed).not.toHaveBeenCalled();
		});

		test('ID を渡すとイベントを引く', async () => {
			await service.pack('event1', ALICE);
			expect(calendarEventService.findByIdOrFail).toHaveBeenCalledWith('event1');
		});
	});

	describe('packMany', () => {
		test('ユーザー・購読者数・購読状態・編集できるかをまとめて引く', async () => {
			const events = [event({ id: 'e1' }), event({ id: 'e2', userId: BOB.id }), event({ id: 'e3' })];

			const packed = await service.packMany(events, BOB);

			expect(packed.map(p => [p.id, p.subscribersCount, p.isSubscribed, p.canManage])).toEqual([
				['e1', 1, true, false],
				['e2', 2, false, true],
				['e3', 3, false, false],
			]);
			expect(userEntityService.packMany).toHaveBeenCalledOnce();
			expect(calendarEventService.countSubscribersOfEvents).toHaveBeenCalledOnce();
			expect(calendarEventService.getSubscribedEventIds).toHaveBeenCalledOnce();
			expect(calendarEventService.createManageChecker).toHaveBeenCalledOnce();
			// 1 件ずつは引かない
			expect(userEntityService.pack).not.toHaveBeenCalled();
			expect(calendarEventService.countSubscribers).not.toHaveBeenCalled();
			expect(calendarEventService.isSubscribed).not.toHaveBeenCalled();
			expect(calendarEventService.canManage).not.toHaveBeenCalled();
		});

		test('空なら何も引かない', async () => {
			expect(await service.packMany([], ALICE)).toEqual([]);
			expect(userEntityService.packMany).not.toHaveBeenCalled();
		});
	});

	describe('packLiteManyByNoteIds', () => {
		test('紐づいていないノートは null で、紐づけが無ければ購読者数などは引かない', async () => {
			const result = await service.packLiteManyByNoteIds(['n1', 'n2'], ALICE);
			expect([...result.entries()]).toEqual([['n1', null], ['n2', null]]);
			expect(calendarEventService.getEventsOfNotes).toHaveBeenCalledOnce();
			expect(calendarEventService.countSubscribersOfEvents).not.toHaveBeenCalled();
		});

		test('紐づいたノートには軽量版を入れる。同じイベントの購読者数などは 1 回で引く', async () => {
			const e = event({ id: 'e1' });
			calendarEventService.getEventsOfNotes.mockResolvedValueOnce(new Map([['n1', e], ['n3', e]]));

			const result = await service.packLiteManyByNoteIds(['n1', 'n2', 'n3', 'n1'], ALICE);

			expect(result.get('n2')).toBeNull();
			expect(result.get('n1')).toEqual({
				id: 'e1',
				title: 'もくもく会',
				date: '2026-10-20',
				startTime: '12:00',
				endTime: '13:00',
				isAllDay: false,
				startsAt: '2026-10-20T03:00:00.000Z',
				endsAt: '2026-10-20T04:00:00.000Z',
				location: 'c3',
				isCanceled: false,
				subscribersCount: 1,
				isSubscribed: true,
			});
			expect(result.get('n3')).toEqual(result.get('n1'));
			expect(calendarEventService.getEventsOfNotes).toHaveBeenCalledWith(['n1', 'n2', 'n3']);
			expect(calendarEventService.countSubscribersOfEvents).toHaveBeenCalledWith(['e1']);
			expect(calendarEventService.getSubscribedEventIds).toHaveBeenCalledWith(ALICE, ['e1']);
		});

		test('閲覧者がいなければ isSubscribed を含めない', async () => {
			calendarEventService.getEventsOfNotes.mockResolvedValueOnce(new Map([['n1', event()]]));
			const result = await service.packLiteManyByNoteIds(['n1'], null);
			expect(result.get('n1')).not.toHaveProperty('isSubscribed');
			expect(calendarEventService.getSubscribedEventIds).not.toHaveBeenCalled();
		});
	});
});
