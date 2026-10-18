/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// DB を使わず、リポジトリをメモリ上の配列に差し替えて CalendarEventService の分岐を確認する。
// createQueryBuilder を使うメソッド (listUpcoming / countSubscribersOfEvents) はここでは扱わない

import { beforeEach, describe, expect, test } from 'vitest';
import { FindOperator, QueryFailedError } from 'typeorm';
import { CalendarEventService } from '@/core/calendar/CalendarEventService.js';
import {
	CalendarEventCanceledError,
	CalendarEventCannotUnsubscribeOwnError,
	CalendarEventNoteAlreadyLinkedError,
	CalendarEventNoteNotLinkedError,
	CalendarEventNotFoundError,
	CalendarEventPermissionError,
	CalendarEventValidationError,
} from '@/core/calendar/calendar-errors.js';
import { MiCalendarEvent } from '@/models/CalendarEvent.js';
import { MiCalendarEventSubscription } from '@/models/CalendarEventSubscription.js';
import { MiCalendarEventNote } from '@/models/CalendarEventNote.js';
import type { CalendarEventScheduleChange } from '@/core/calendar/CalendarEventService.js';

type Row = { id: string; [key: string]: unknown };

function duplicateKeyError(): QueryFailedError {
	return new QueryFailedError('INSERT', [], Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }));
}

function matchValue(actual: unknown, expected: unknown): boolean {
	if (expected instanceof FindOperator) {
		const op = expected as FindOperator<any>;
		switch (op.type) {
			case 'in': return (op.value as unknown[]).includes(actual);
			case 'lessThan': return (actual as any) < op.value;
			case 'moreThanOrEqual': return (actual as any) >= op.value;
			case 'isNull': return actual == null;
			case 'and': return (op.value as unknown as FindOperator<any>[]).every(o => matchValue(actual, o));
			default: throw new Error(`unsupported operator: ${op.type}`);
		}
	}
	if (actual instanceof Date && expected instanceof Date) return actual.getTime() === expected.getTime();
	return actual === expected;
}

function matchWhere(row: Row, where: Record<string, unknown>): boolean {
	return Object.entries(where).every(([k, v]) => matchValue(row[k], v));
}

/** TypeORM のリポジトリのうち、サービスが使うメソッドだけをメモリ上で再現する */
class FakeTable<T extends Row> {
	public rows: T[] = [];

	constructor(private uniques: (keyof T & string)[][] = []) {}

	private toWhere(criteria: string | Record<string, unknown>): Record<string, unknown> {
		return typeof criteria === 'string' ? { id: criteria } : criteria;
	}

	public filter(where: Record<string, unknown>): T[] {
		return this.rows.filter(r => matchWhere(r, where));
	}

	public async insert(row: T) {
		for (const keys of [['id'], ...this.uniques]) {
			if (this.rows.some(r => keys.every(k => r[k] === row[k]))) throw duplicateKeyError();
		}
		this.rows.push({ ...row });
		return { identifiers: [{ id: row.id }] };
	}

	public async update(criteria: string | Record<string, unknown>, values: Partial<T>) {
		const targets = this.filter(this.toWhere(criteria));
		for (const r of targets) Object.assign(r, values);
		return { affected: targets.length };
	}

	public async delete(criteria: string | Record<string, unknown>) {
		const where = this.toWhere(criteria);
		const before = this.rows.length;
		this.rows = this.rows.filter(r => !matchWhere(r, where));
		return { affected: before - this.rows.length };
	}

	public async findOneBy(where: Record<string, unknown>) {
		const found = this.filter(where)[0];
		return found ? { ...found } : null;
	}

	public async findOneByOrFail(where: Record<string, unknown>) {
		const found = await this.findOneBy(where);
		if (found == null) throw new Error('not found');
		return found;
	}

	public async findOne(opts: { where: Record<string, unknown> }) {
		return await this.findOneBy(opts.where);
	}

	public async findBy(where: Record<string, unknown>) {
		return this.filter(where).map(r => ({ ...r }));
	}

	public async find(opts: { where: Record<string, unknown>; order?: Record<string, 'ASC' | 'DESC'>; take?: number }) {
		let rows = this.filter(opts.where).map(r => ({ ...r }));
		if (opts.order) {
			const order = Object.entries(opts.order);
			rows = rows.sort((a, b) => {
				for (const [k, dir] of order) {
					const av = a[k] as any;
					const bv = b[k] as any;
					if (av < bv) return dir === 'ASC' ? -1 : 1;
					if (av > bv) return dir === 'ASC' ? 1 : -1;
				}
				return 0;
			});
		}
		return opts.take != null ? rows.slice(0, opts.take) : rows;
	}

	public async exists(opts: { where: Record<string, unknown> }) {
		return this.filter(opts.where).length > 0;
	}

	public async countBy(where: Record<string, unknown>) {
		return this.filter(where).length;
	}
}

type EventRow = Row & Omit<MiCalendarEvent, 'user' | 'announcementNote'>;
type SubscriptionRow = Row & { eventId: string; userId: string };
type NoteLinkRow = Row & { eventId: string; noteId: string; userId: string };
type ReminderRow = Row & { eventId: string; userId: string; kind: string };

const ALICE = { id: 'alice' };
const BOB = { id: 'bob' };
const MOD = { id: 'mod' };

const INPUT = { title: 'もくもく会', date: '2026-10-20', startTime: '12:00', endTime: '15:00', location: 'c3', hashtag: '#mokumoku' };

describe('CalendarEventService', () => {
	let seq: number;
	let events: FakeTable<EventRow>;
	let subscriptions: FakeTable<SubscriptionRow>;
	let noteLinks: FakeTable<NoteLinkRow>;
	let reminders: FakeTable<ReminderRow>;
	let scheduleChanges: CalendarEventScheduleChange[];
	let canceledEvents: string[];
	let notifiedOperators: string[];
	let service: CalendarEventService;

	function tableOf(entity: unknown): FakeTable<any> {
		if (entity === MiCalendarEvent) return events;
		if (entity === MiCalendarEventSubscription) return subscriptions;
		if (entity === MiCalendarEventNote) return noteLinks;
		throw new Error('unknown entity');
	}

	async function getEvent(id: string): Promise<MiCalendarEvent> {
		return await events.findOneByOrFail({ id }) as unknown as MiCalendarEvent;
	}

	function subscriberIdsOf(eventId: string): string[] {
		return subscriptions.filter({ eventId }).map(s => s.userId).sort();
	}

	beforeEach(() => {
		seq = 0;
		events = new FakeTable<EventRow>();
		subscriptions = new FakeTable<SubscriptionRow>([['eventId', 'userId']]);
		noteLinks = new FakeTable<NoteLinkRow>([['noteId']]);
		reminders = new FakeTable<ReminderRow>([['eventId', 'userId', 'kind']]);
		scheduleChanges = [];
		canceledEvents = [];

		// ON DELETE CASCADE
		const originalDelete = events.delete.bind(events);
		events.delete = async (criteria) => {
			const result = await originalDelete(criteria);
			const alive = new Set(events.rows.map(e => e.id));
			subscriptions.rows = subscriptions.rows.filter(s => alive.has(s.eventId));
			noteLinks.rows = noteLinks.rows.filter(l => alive.has(l.eventId));
			reminders.rows = reminders.rows.filter(r => alive.has(r.eventId));
			return result;
		};

		const fakeDb = {
			transaction: async (fn: (em: unknown) => Promise<void>) => {
				const tables: FakeTable<any>[] = [events, subscriptions, noteLinks];
				const snapshot = tables.map(t => t.rows.map(r => ({ ...r })));
				const em = {
					insert: async (entity: unknown, row: Row) => await tableOf(entity).insert(row),
				};
				try {
					await fn(em);
				} catch (err) {
					tables.forEach((t, i) => { t.rows = snapshot[i]; });
					throw err;
				}
			},
		};

		const fakeRoleService = {
			isModerator: async (user: { id: string }) => user.id === MOD.id,
		};

		// 日時の変更・中止の通知を頼んだことを記録する
		notifiedOperators = [];
		const fakeCalendarNotificationService = {
			notifyRescheduled: (_event: MiCalendarEvent, change: CalendarEventScheduleChange, operator: { id: string }) => {
				scheduleChanges.push(change);
				notifiedOperators.push(operator.id);
			},
			notifyCanceled: (event: MiCalendarEvent, operator: { id: string }) => {
				canceledEvents.push(event.id);
				notifiedOperators.push(operator.id);
			},
		};

		service = new CalendarEventService(
			fakeDb as any,
			events as any,
			subscriptions as any,
			noteLinks as any,
			reminders as any,
			fakeRoleService as any,
			{ gen: () => `id${String(++seq).padStart(4, '0')}` } as any,
			fakeCalendarNotificationService as any,
		);
	});

	test('日時の変更と中止は、操作した人を添えて購読者への通知を頼む', async () => {
		const created = await service.create(ALICE, INPUT);
		await service.update(created, { startTime: '13:00' }, MOD);
		await service.cancel(await getEvent(created.id), ALICE);

		expect(scheduleChanges).toHaveLength(1);
		expect(canceledEvents).toEqual([created.id]);
		expect(notifiedOperators).toEqual([MOD.id, ALICE.id]);
	});

	describe('create', () => {
		test('イベントを作り、作成者を購読させる', async () => {
			const event = await service.create(ALICE, INPUT);

			expect(event).toMatchObject({
				userId: 'alice',
				title: 'もくもく会',
				startsAt: new Date('2026-10-20T03:00:00.000Z'),
				endsAt: new Date('2026-10-20T06:00:00.000Z'),
				isAllDay: false,
				location: 'c3',
				description: null,
				hashtag: 'mokumoku',
				announcementNoteId: null,
				canceledAt: null,
				updatedAt: null,
			});
			expect(subscriberIdsOf(event.id)).toEqual(['alice']);
			expect(noteLinks.rows).toEqual([]);
		});

		test('告知のノートを記録し、イベントに紐づける', async () => {
			const event = await service.create(ALICE, INPUT, { announcementNote: { id: 'note1', userId: 'alice' } });

			expect(event.announcementNoteId).toBe('note1');
			expect(noteLinks.rows).toMatchObject([{ eventId: event.id, noteId: 'note1', userId: 'alice' }]);
		});

		test('他人のノートは告知のノートにできない', async () => {
			await expect(service.create(ALICE, INPUT, { announcementNote: { id: 'note1', userId: 'bob' } })).rejects.toThrow(CalendarEventPermissionError);
			expect(events.rows).toEqual([]);
		});

		test('告知のノートが別のイベントに紐づいていたら、何も作らずにエラー', async () => {
			const other = await service.create(ALICE, INPUT, { announcementNote: { id: 'note1', userId: 'alice' } });

			await expect(service.create(ALICE, INPUT, { announcementNote: { id: 'note1', userId: 'alice' } })).rejects.toThrow(CalendarEventNoteAlreadyLinkedError);
			expect(events.rows.map(e => e.id)).toEqual([other.id]);
			expect(subscriptions.rows).toHaveLength(1);
		});

		test('入力が仕様に合わなければ検証エラー', async () => {
			await expect(service.create(ALICE, { ...INPUT, title: '' })).rejects.toThrow(CalendarEventValidationError);
			expect(events.rows).toEqual([]);
		});
	});

	describe('update', () => {
		test('作成者は編集でき、渡さなかった項目は変わらない', async () => {
			const created = await service.create(ALICE, INPUT);

			const { event, scheduleChange } = await service.update(created, { title: 'お茶会', location: null }, ALICE);

			expect(event).toMatchObject({ title: 'お茶会', location: null, hashtag: 'mokumoku', startsAt: created.startsAt, endsAt: created.endsAt });
			expect(event.updatedAt).toBeInstanceOf(Date);
			expect(scheduleChange).toBeNull();
			expect(await getEvent(created.id)).toMatchObject({ title: 'お茶会', location: null });
			expect(scheduleChanges).toEqual([]);
		});

		test('日時を変えたら送ったリマインダーの記録を消し、変更を受け渡す', async () => {
			const created = await service.create(ALICE, INPUT);
			const untouched = await service.create(ALICE, INPUT);
			await reminders.insert({ id: 'r1', eventId: created.id, userId: 'alice', kind: 'week' });
			await reminders.insert({ id: 'r2', eventId: untouched.id, userId: 'alice', kind: 'week' });

			const { event, scheduleChange } = await service.update(created, { date: '2026-10-21' }, ALICE);

			expect(event.startsAt).toEqual(new Date('2026-10-21T03:00:00.000Z'));
			expect(event.endsAt).toEqual(new Date('2026-10-21T06:00:00.000Z'));
			expect(scheduleChange).toEqual({
				previous: { startsAt: new Date('2026-10-20T03:00:00.000Z'), endsAt: new Date('2026-10-20T06:00:00.000Z'), isAllDay: false },
				current: { startsAt: new Date('2026-10-21T03:00:00.000Z'), endsAt: new Date('2026-10-21T06:00:00.000Z'), isAllDay: false },
			});
			expect(scheduleChanges).toEqual([scheduleChange]);
			expect(reminders.rows.map(r => r.id)).toEqual(['r2']);
		});

		test('終了時刻だけを消しても日時の変更として扱う', async () => {
			const created = await service.create(ALICE, INPUT);

			const { event, scheduleChange } = await service.update(created, { endTime: null }, ALICE);

			expect(event.endsAt).toBeNull();
			expect(scheduleChange).not.toBeNull();
		});

		test('終日に変えると時刻は使わない', async () => {
			const created = await service.create(ALICE, INPUT);

			const { event } = await service.update(created, { isAllDay: true }, ALICE);

			expect(event).toMatchObject({ isAllDay: true, startsAt: new Date('2026-10-19T15:00:00.000Z'), endsAt: null });
		});

		test('ハッシュタグを渡したときだけ正規化し直し、空にすると消える', async () => {
			const created = await service.create(ALICE, INPUT);

			expect((await service.update(created, { hashtag: '#Tea' }, ALICE)).event.hashtag).toBe('tea');
			expect((await service.update(created, { hashtag: '' }, ALICE)).event.hashtag).toBeNull();
		});

		test('モデレーターは他人のイベントを編集できる', async () => {
			const created = await service.create(ALICE, INPUT);

			await expect(service.update(created, { title: '変更' }, MOD)).resolves.toMatchObject({ event: { title: '変更' } });
		});

		test('作成者でもモデレーターでもなければ編集できない', async () => {
			const created = await service.create(ALICE, INPUT);

			await expect(service.update(created, { title: '変更' }, BOB)).rejects.toThrow(CalendarEventPermissionError);
			expect((await getEvent(created.id)).title).toBe('もくもく会');
		});

		test('中止したイベントは編集できない', async () => {
			const created = await service.create(ALICE, INPUT);
			const canceled = await service.cancel(created, ALICE);

			await expect(service.update(canceled, { title: '変更' }, ALICE)).rejects.toThrow(CalendarEventCanceledError);
		});

		test('日時が仕様に合わなければ検証エラー', async () => {
			const created = await service.create(ALICE, INPUT);

			await expect(service.update(created, { endTime: '11:00' }, ALICE)).rejects.toThrow(CalendarEventValidationError);
		});
	});

	describe('cancel / delete', () => {
		test('中止するとイベントを残して中止の印を付け、onCanceled を呼ぶ', async () => {
			const created = await service.create(ALICE, INPUT);

			const canceled = await service.cancel(created, ALICE);

			expect(canceled.canceledAt).toBeInstanceOf(Date);
			expect((await getEvent(created.id)).canceledAt).toEqual(canceled.canceledAt);
			expect(canceledEvents).toEqual([created.id]);
		});

		test('既に中止したイベントは中止できない (古いオブジェクトで呼ばれても二重にしない)', async () => {
			const created = await service.create(ALICE, INPUT);
			await service.cancel(created, ALICE);

			await expect(service.cancel(created, MOD)).rejects.toThrow(CalendarEventCanceledError);
			expect(canceledEvents).toEqual([created.id]);
		});

		test('他人は中止できない', async () => {
			const created = await service.create(ALICE, INPUT);

			await expect(service.cancel(created, BOB)).rejects.toThrow(CalendarEventPermissionError);
		});

		test('削除すると購読・紐づけ・リマインダーの記録も消える', async () => {
			const created = await service.create(ALICE, INPUT, { announcementNote: { id: 'note1', userId: 'alice' } });
			await service.subscribe(created, BOB);
			await reminders.insert({ id: 'r1', eventId: created.id, userId: 'bob', kind: 'day' });

			await service.delete(created, MOD);

			expect(events.rows).toEqual([]);
			expect(subscriptions.rows).toEqual([]);
			expect(noteLinks.rows).toEqual([]);
			expect(reminders.rows).toEqual([]);
		});

		test('他人は削除できない', async () => {
			const created = await service.create(ALICE, INPUT);

			await expect(service.delete(created, BOB)).rejects.toThrow(CalendarEventPermissionError);
			expect(events.rows).toHaveLength(1);
		});

		test('createManageChecker は canManage と同じ判定をまとめて行う', async () => {
			const own = { userId: ALICE.id };
			const others = { userId: BOB.id };

			const aliceCheck = await service.createManageChecker(ALICE, [own, others]);
			expect([aliceCheck(own), aliceCheck(others)]).toEqual([true, false]);

			const modCheck = await service.createManageChecker(MOD, [own, others]);
			expect([modCheck(own), modCheck(others)]).toEqual([true, true]);
		});
	});

	describe('subscribe / unsubscribe', () => {
		test('購読と解除ができ、重複した購読は無視する', async () => {
			const created = await service.create(ALICE, INPUT);

			await service.subscribe(created, BOB);
			await service.subscribe(created, BOB);
			expect(subscriberIdsOf(created.id)).toEqual(['alice', 'bob']);
			expect(await service.isSubscribed(created, BOB)).toBe(true);
			expect(await service.countSubscribers(created)).toBe(2);

			await service.unsubscribe(created, BOB);
			expect(subscriberIdsOf(created.id)).toEqual(['alice']);
			expect(await service.isSubscribed(created, BOB)).toBe(false);
		});

		test('同時に購読して一意制約に触れても成功として扱う', async () => {
			const created = await service.create(ALICE, INPUT);
			Object.defineProperty(service, 'isSubscribed', { value: async () => false });
			await subscriptions.insert({ id: 'race', eventId: created.id, userId: 'bob' });

			await expect(service.subscribe(created, BOB)).resolves.toBeUndefined();
			expect(subscriberIdsOf(created.id)).toEqual(['alice', 'bob']);
		});

		test('作成者は購読を解除できない', async () => {
			const created = await service.create(ALICE, INPUT);

			await expect(service.unsubscribe(created, ALICE)).rejects.toThrow(CalendarEventCannotUnsubscribeOwnError);
			expect(subscriberIdsOf(created.id)).toEqual(['alice']);
		});

		test('中止したイベントは購読できない', async () => {
			const canceled = await service.cancel(await service.create(ALICE, INPUT), ALICE);

			await expect(service.subscribe(canceled, BOB)).rejects.toThrow(CalendarEventCanceledError);
		});

		test('getSubscribedEventIds は購読しているものだけを返す', async () => {
			const e1 = await service.create(ALICE, INPUT);
			const e2 = await service.create(ALICE, INPUT);
			const e3 = await service.create(BOB, INPUT);
			await service.subscribe(e2, BOB);

			expect(await service.getSubscribedEventIds(BOB, [e1.id, e2.id, e3.id])).toEqual(new Set([e2.id, e3.id]));
			expect(await service.getSubscribedEventIds(BOB, [])).toEqual(new Set());
		});
	});

	describe('linkNote / unlinkNote', () => {
		test('ノートの作成者がノートを紐づけられ、同じイベントへの紐づけは何もしない', async () => {
			const created = await service.create(ALICE, INPUT);
			const note = { id: 'note1', userId: 'bob' };

			await service.linkNote(note, created.id, BOB);
			await service.linkNote(note, created.id, BOB);

			expect(noteLinks.rows).toMatchObject([{ eventId: created.id, noteId: 'note1', userId: 'bob' }]);
			expect(await service.getEventIdOfNote('note1')).toBe(created.id);
		});

		test('他人のノートは紐づけられない (モデレーターでも)', async () => {
			const created = await service.create(ALICE, INPUT);

			await expect(service.linkNote({ id: 'note1', userId: 'bob' }, created.id, MOD)).rejects.toThrow(CalendarEventPermissionError);
		});

		test('存在しないイベントには紐づけられない', async () => {
			await expect(service.linkNote({ id: 'note1', userId: 'bob' }, 'missing', BOB)).rejects.toThrow(CalendarEventNotFoundError);
		});

		test('別のイベントに紐づいているノートは紐づけられない', async () => {
			const e1 = await service.create(ALICE, INPUT);
			const e2 = await service.create(ALICE, INPUT);
			const note = { id: 'note1', userId: 'bob' };
			await service.linkNote(note, e1.id, BOB);

			await expect(service.linkNote(note, e2.id, BOB)).rejects.toThrow(CalendarEventNoteAlreadyLinkedError);
			expect(await service.getEventIdOfNote('note1')).toBe(e1.id);
		});

		test('中止したイベントにも紐づけられる', async () => {
			const canceled = await service.cancel(await service.create(ALICE, INPUT), ALICE);

			await expect(service.linkNote({ id: 'note1', userId: 'bob' }, canceled.id, BOB)).resolves.toMatchObject({ id: canceled.id });
		});

		test.each([
			['ノートの作成者', BOB],
			['イベントの作成者', ALICE],
			['モデレーター', MOD],
		])('%sは紐づけを外せる', async (_label, me) => {
			const created = await service.create(ALICE, INPUT);
			await service.linkNote({ id: 'note1', userId: 'bob' }, created.id, BOB);

			await service.unlinkNote({ id: 'note1' }, me);

			expect(noteLinks.rows).toEqual([]);
			expect(await service.getEventIdOfNote('note1')).toBeNull();
		});

		test('関係の無い人は紐づけを外せず、紐づいていないときと同じエラーになる', async () => {
			const created = await service.create(ALICE, INPUT);
			await service.linkNote({ id: 'note1', userId: 'bob' }, created.id, BOB);

			await expect(service.unlinkNote({ id: 'note1' }, { id: 'carol' })).rejects.toThrow(CalendarEventNoteNotLinkedError);
			await expect(service.unlinkNote({ id: 'note2' }, { id: 'carol' })).rejects.toThrow(CalendarEventNoteNotLinkedError);
			expect(noteLinks.rows).toHaveLength(1);
		});

		test('別のイベントの作成者は紐づけを外せない', async () => {
			const created = await service.create(ALICE, INPUT);
			await service.create({ id: 'carol' }, INPUT);
			await service.linkNote({ id: 'note1', userId: 'bob' }, created.id, BOB);

			await expect(service.unlinkNote({ id: 'note1' }, { id: 'carol' })).rejects.toThrow(CalendarEventNoteNotLinkedError);
			expect(noteLinks.rows).toHaveLength(1);
		});

		test('紐づいていないノートは外せない', async () => {
			await expect(service.unlinkNote({ id: 'note1' }, BOB)).rejects.toThrow(CalendarEventNoteNotLinkedError);
		});

		test('告知のノートの紐づけを外しても、告知のノートの記録は残す', async () => {
			const created = await service.create(ALICE, INPUT, { announcementNote: { id: 'note1', userId: 'alice' } });

			await service.unlinkNote({ id: 'note1' }, ALICE);

			expect((await getEvent(created.id)).announcementNoteId).toBe('note1');
		});

		test('getLinkedNoteIds は新しい順に untilId より前を limit 件返す', async () => {
			const created = await service.create(ALICE, INPUT);
			for (const noteId of ['n1', 'n2', 'n3', 'n4']) {
				await service.linkNote({ id: noteId, userId: 'bob' }, created.id, BOB);
			}
			const other = await service.create(ALICE, INPUT);
			await service.linkNote({ id: 'n5', userId: 'bob' }, other.id, BOB);

			expect(await service.getLinkedNoteIds(created, { limit: 2 })).toEqual(['n4', 'n3']);
			expect(await service.getLinkedNoteIds(created, { untilId: 'n3', limit: 10 })).toEqual(['n2', 'n1']);
		});

		test('getEventsOfNotes はノートごとのイベントをまとめて返す', async () => {
			const e1 = await service.create(ALICE, INPUT);
			const e2 = await service.create(BOB, { ...INPUT, title: 'お茶会' });
			await service.linkNote({ id: 'n1', userId: 'bob' }, e1.id, BOB);
			await service.linkNote({ id: 'n2', userId: 'bob' }, e1.id, BOB);
			await service.linkNote({ id: 'n3', userId: 'bob' }, e2.id, BOB);

			const result = await service.getEventsOfNotes(['n1', 'n3', 'n9']);

			expect([...result.keys()].sort()).toEqual(['n1', 'n3']);
			expect(result.get('n1')?.id).toBe(e1.id);
			expect(result.get('n3')?.title).toBe('お茶会');
			expect(await service.getEventsOfNotes([])).toEqual(new Map());
		});
	});

	describe('取得', () => {
		test('findByIdOrFail は存在しなければ CalendarEventNotFoundError', async () => {
			const created = await service.create(ALICE, INPUT);

			expect((await service.findByIdOrFail(created.id)).id).toBe(created.id);
			expect(await service.findById('missing')).toBeNull();
			await expect(service.findByIdOrFail('missing')).rejects.toThrow(CalendarEventNotFoundError);
		});

		test('listInRange は範囲内のイベントを開始日時順に、絞り込みに応じて返す', async () => {
			const late = await service.create(ALICE, { ...INPUT, title: 'late', date: '2026-10-31', startTime: '23:00', endTime: null });
			const early = await service.create(BOB, { ...INPUT, title: 'early', date: '2026-10-01', startTime: '00:00', endTime: null });
			const allDay = await service.create(BOB, { ...INPUT, title: 'allDay', date: '2026-10-15', isAllDay: true });
			await service.create(ALICE, { ...INPUT, title: 'next month', date: '2026-11-01', startTime: '00:00', endTime: null });
			await service.create(ALICE, { ...INPUT, title: 'prev month', date: '2026-09-30', startTime: '23:59', endTime: null });
			await service.cancel(allDay, BOB);
			await service.subscribe(early, ALICE);

			const from = new Date('2026-09-30T15:00:00.000Z');
			const to = new Date('2026-10-31T15:00:00.000Z');

			expect((await service.listInRange(from, to, 'all', ALICE)).map(e => e.title)).toEqual(['early', 'allDay', 'late']);
			expect((await service.listInRange(from, to, 'mine', ALICE)).map(e => e.id)).toEqual([late.id]);
			expect((await service.listInRange(from, to, 'subscribed', ALICE)).map(e => e.id)).toEqual([early.id, late.id]);
		});
	});
});
