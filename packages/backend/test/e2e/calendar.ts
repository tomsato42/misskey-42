/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'assert';
import { describe, beforeAll, test } from 'vitest';
import { formatJstDate } from '@/core/calendar/calendar-time.js';
import { api, castAsError, failedApiCall, post, role, signup, successfulApiCall } from '../utils.js';
import type * as misskey from 'misskey-js';

// 各テストは前のテストで作ったイベントやノートを使うので、上から順に実行する
describe('カレンダー', () => {
	let root: misskey.entities.SignupResponse;
	let alice: misskey.entities.SignupResponse;
	let bob: misskey.entities.SignupResponse;
	let carol: misskey.entities.SignupResponse;

	// 1週間後 (日本時間)。月をまたいでも一覧の month はこの日付から作る
	const date = formatJstDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
	const month = date.slice(0, 7);

	let event: misskey.entities.CalendarEvent;
	let bobLinkedNote: misskey.entities.Note;
	let bobFollowersNote: misskey.entities.Note;
	let aliceNote: misskey.entities.Note;

	beforeAll(async () => {
		root = await signup({ username: 'root' });
		alice = await signup({ username: 'alice' });
		bob = await signup({ username: 'bob' });
		carol = await signup({ username: 'carol' });
		const moderatorRole = await role(root, { isModerator: true, name: 'Moderator' });
		await api('admin/roles/assign', { userId: carol.id, roleId: moderatorRole.id }, root);
	}, 1000 * 60 * 2);

	describe('作成と表示', () => {
		test('イベントを作ると、作成者が購読した状態で返る', async () => {
			event = await successfulApiCall({
				endpoint: 'calendar/events/create',
				parameters: { title: ' もくもく会 ', date, startTime: '12:00', endTime: '13:00', location: 'c3', hashtag: '#mokumoku42' },
				user: alice,
			});

			assert.strictEqual(event.title, 'もくもく会');
			assert.strictEqual(event.date, date);
			assert.strictEqual(event.startTime, '12:00');
			assert.strictEqual(event.endTime, '13:00');
			assert.strictEqual(event.isAllDay, false);
			assert.strictEqual(event.location, 'c3');
			assert.strictEqual(event.hashtag, 'mokumoku42');
			assert.strictEqual(event.userId, alice.id);
			assert.strictEqual(event.user.id, alice.id);
			assert.strictEqual(event.isCanceled, false);
			assert.strictEqual(event.subscribersCount, 1);
			assert.strictEqual(event.isSubscribed, true);
			assert.strictEqual(event.canManage, true);
			assert.strictEqual(event.announcementNoteId, null);
		});

		test('終日のイベントは時刻が null', async () => {
			const allDay = await successfulApiCall({
				endpoint: 'calendar/events/create',
				parameters: { title: 'Exam', date, isAllDay: true, startTime: '10:00' },
				user: bob,
			});
			assert.strictEqual(allDay.isAllDay, true);
			assert.strictEqual(allDay.startTime, null);
			assert.strictEqual(allDay.endTime, null);
			assert.strictEqual(allDay.endsAt, null);
		});

		test('入力が仕様に合わないと理由付きのエラー', async () => {
			const res = await api('calendar/events/create', { title: 'x', date, startTime: '13:00', endTime: '12:00' }, alice);
			assert.strictEqual(res.status, 400);
			const err = castAsError(res.body as any).error;
			assert.strictEqual(err.code, 'INVALID_CALENDAR_EVENT');
			assert.strictEqual(err.id, 'b48e0f85-835e-4c35-a8f3-a5c520d3727d');
			assert.deepStrictEqual(err.info, { reason: 'endNotAfterStart' });

			const res2 = await api('calendar/events/create', { title: 'x', date: '2026-02-30', startTime: '12:00' }, alice);
			assert.deepStrictEqual(castAsError(res2.body as any).error.info, { reason: 'invalidDate' });
		});

		test('ほかの人から見ると購読しておらず、編集できない。モデレーターは編集できる', async () => {
			const fromBob = await successfulApiCall({ endpoint: 'calendar/events/show', parameters: { eventId: event.id }, user: bob });
			assert.strictEqual(fromBob.isSubscribed, false);
			assert.strictEqual(fromBob.canManage, false);

			const fromCarol = await successfulApiCall({ endpoint: 'calendar/events/show', parameters: { eventId: event.id }, user: carol });
			assert.strictEqual(fromCarol.canManage, true);
		});

		test('存在しないイベント', async () => {
			await failedApiCall({ endpoint: 'calendar/events/show', parameters: { eventId: 'xxxxxxxxxx' }, user: bob }, {
				status: 400, code: 'NO_SUCH_CALENDAR_EVENT', id: '14d2357d-a3a3-4f49-b23a-ca7c0d19fe31',
			});
		});

		test('ログインしていないと使えない', async () => {
			const res = await api('calendar/events/list', { month });
			assert.strictEqual(res.status, 401);
		});
	});

	describe('一覧と購読', () => {
		test('月の一覧を filter で絞り込める', async () => {
			const all = await successfulApiCall({ endpoint: 'calendar/events/list', parameters: { month }, user: bob });
			assert.ok(all.some(e => e.id === event.id));

			const subscribed = await successfulApiCall({ endpoint: 'calendar/events/list', parameters: { month, filter: 'subscribed' }, user: bob });
			assert.ok(!subscribed.some(e => e.id === event.id));

			const mine = await successfulApiCall({ endpoint: 'calendar/events/list', parameters: { month, filter: 'mine' }, user: alice });
			assert.deepStrictEqual(mine.map(e => e.id), [event.id]);
		});

		test('month の形式が違うとエラー', async () => {
			await failedApiCall({ endpoint: 'calendar/events/list', parameters: { month: '2026-13' }, user: bob }, {
				status: 400, code: 'INVALID_MONTH', id: '988bcea4-f638-4271-a1bc-6478f1a84328',
			});
		});

		test('購読すると購読中の一覧と近日のイベントに出る', async () => {
			const subscribed = await successfulApiCall({ endpoint: 'calendar/events/subscribe', parameters: { eventId: event.id }, user: bob });
			assert.strictEqual(subscribed.isSubscribed, true);
			assert.strictEqual(subscribed.subscribersCount, 2);

			// 二重に購読しても数は変わらない
			const again = await successfulApiCall({ endpoint: 'calendar/events/subscribe', parameters: { eventId: event.id }, user: bob });
			assert.strictEqual(again.subscribersCount, 2);

			const list = await successfulApiCall({ endpoint: 'calendar/events/list', parameters: { month, filter: 'subscribed' }, user: bob });
			assert.ok(list.some(e => e.id === event.id && e.isSubscribed === true));

			const upcoming = await successfulApiCall({ endpoint: 'calendar/events/upcoming', parameters: { filter: 'subscribed', limit: 10 }, user: bob });
			assert.ok(upcoming.some(e => e.id === event.id));
		});

		test('作成者は購読を解除できない', async () => {
			await failedApiCall({ endpoint: 'calendar/events/unsubscribe', parameters: { eventId: event.id }, user: alice }, {
				status: 400, code: 'CANNOT_UNSUBSCRIBE_OWN_CALENDAR_EVENT', id: '50299446-02a9-485e-8c3c-2f1c02680cf6',
			});
		});

		test('購読を解除できる', async () => {
			await successfulApiCall({ endpoint: 'calendar/events/subscribe', parameters: { eventId: event.id }, user: carol });
			const res = await successfulApiCall({ endpoint: 'calendar/events/unsubscribe', parameters: { eventId: event.id }, user: carol });
			assert.strictEqual(res.isSubscribed, false);
			assert.strictEqual(res.subscribersCount, 2);
		});
	});

	describe('ノートとの紐づけ', () => {
		test('投稿するときに既存のイベントに紐づけると、ノートの返り値に calendarEvent が付く', async () => {
			const res = await api('notes/create', { text: '行きます', calendarEventId: event.id }, bob);
			assert.strictEqual(res.status, 200);
			bobLinkedNote = res.body.createdNote;

			const linked = bobLinkedNote.calendarEvent;
			assert.ok(linked);
			assert.strictEqual(linked.id, event.id);
			assert.strictEqual(linked.title, 'もくもく会');
			assert.strictEqual(linked.date, date);
			assert.strictEqual(linked.isSubscribed, true);
			assert.strictEqual(linked.subscribersCount, 2);
		});

		test('投稿しながらイベントを作れる。説明を省略するとノートの本文になる', async () => {
			const res = await api('notes/create', {
				text: 'ボドゲやります #boardgame42',
				calendarEvent: { title: 'ボードゲーム部', date, startTime: '19:00', hashtag: 'boardgame42' },
			}, alice);
			assert.strictEqual(res.status, 200);
			const note = res.body.createdNote;
			assert.ok(note.calendarEvent);
			assert.strictEqual(note.calendarEvent.title, 'ボードゲーム部');
			assert.strictEqual(note.calendarEvent.isSubscribed, true);

			const created = await successfulApiCall({ endpoint: 'calendar/events/show', parameters: { eventId: note.calendarEvent.id }, user: alice });
			assert.strictEqual(created.announcementNoteId, note.id);
			assert.strictEqual(created.description, 'ボドゲやります #boardgame42');
			assert.strictEqual(created.hashtag, 'boardgame42');
		});

		test('投稿のときの指定の誤り', async () => {
			await failedApiCall({
				endpoint: 'notes/create',
				parameters: { text: 'x', calendarEventId: event.id, calendarEvent: { title: 'x', date, isAllDay: true } },
				user: bob,
			}, { status: 400, code: 'CALENDAR_EVENT_PARAMS_CONFLICT', id: '6c749f7a-c6c8-43d2-8fd6-d2a1ef336bf7' });

			await failedApiCall({
				endpoint: 'notes/create',
				parameters: { text: 'x', calendarEventId: 'xxxxxxxxxx' },
				user: bob,
			}, { status: 400, code: 'NO_SUCH_CALENDAR_EVENT', id: '1c9aa98b-9663-4249-b6f5-59d575bd7db0' });

			await failedApiCall({
				endpoint: 'notes/create',
				parameters: { text: 'x', calendarEvent: { title: 'x', date } },
				user: bob,
			}, { status: 400, code: 'INVALID_CALENDAR_EVENT', id: '2bc06ea8-a7f7-40e2-b310-cd4d28e48ead' });
		});

		test('ダイレクトのノートと純粋なリノートは紐づけられず、ノートも作られない', async () => {
			const before = await successfulApiCall({ endpoint: 'users/notes', parameters: { userId: bob.id, limit: 100 }, user: bob });

			const res = await api('notes/create', { text: 'x', visibility: 'specified', visibleUserIds: [alice.id], calendarEventId: event.id }, bob);
			assert.strictEqual(res.status, 400);
			assert.strictEqual(castAsError(res.body as any).error.code, 'CANNOT_LINK_NOTE_TO_CALENDAR_EVENT');
			assert.deepStrictEqual(castAsError(res.body as any).error.info, { reason: 'specifiedVisibility' });

			const renote = await api('notes/create', { renoteId: bobLinkedNote.id, calendarEventId: event.id }, bob);
			assert.strictEqual(renote.status, 400);
			assert.deepStrictEqual(castAsError(renote.body as any).error.info, { reason: 'pureRenote' });

			const after = await successfulApiCall({ endpoint: 'users/notes', parameters: { userId: bob.id, limit: 100 }, user: bob });
			assert.strictEqual(after.length, before.length);
		});

		test('notes/show とタイムラインでも calendarEvent が付き、購読状態は見る人ごと', async () => {
			const fromAlice = await successfulApiCall({ endpoint: 'notes/show', parameters: { noteId: bobLinkedNote.id }, user: alice });
			assert.strictEqual(fromAlice.calendarEvent?.id, event.id);
			assert.strictEqual(fromAlice.calendarEvent?.isSubscribed, true);

			const fromCarol = await successfulApiCall({ endpoint: 'notes/show', parameters: { noteId: bobLinkedNote.id }, user: carol });
			assert.strictEqual(fromCarol.calendarEvent?.isSubscribed, false);

			const timeline = await successfulApiCall({ endpoint: 'users/notes', parameters: { userId: bob.id }, user: carol });
			const inTimeline = timeline.find(n => n.id === bobLinkedNote.id);
			assert.strictEqual(inTimeline?.calendarEvent?.id, event.id);

			// 紐づいていないノートには付かない
			const plain = await post(bob, { text: 'ふつうのノート' });
			assert.strictEqual(plain.calendarEvent, undefined);
		});

		test('イベントのノートの一覧は、見てよいノートだけを返す', async () => {
			bobFollowersNote = await post(bob, { text: 'フォロワー限定', visibility: 'followers', calendarEventId: event.id });
			assert.strictEqual(bobFollowersNote.calendarEvent?.id, event.id);

			const fromBob = await successfulApiCall({ endpoint: 'calendar/events/notes', parameters: { eventId: event.id }, user: bob });
			assert.deepStrictEqual(fromBob.map(n => n.id), [bobFollowersNote.id, bobLinkedNote.id]);

			// alice は bob をフォローしていない
			const fromAlice = await successfulApiCall({ endpoint: 'calendar/events/notes', parameters: { eventId: event.id }, user: alice });
			assert.deepStrictEqual(fromAlice.map(n => n.id), [bobLinkedNote.id]);

			// 見られないノートは、何のイベントのものかも隠す
			const hidden = await successfulApiCall({ endpoint: 'notes/show', parameters: { noteId: bobFollowersNote.id }, user: alice });
			assert.strictEqual(hidden.isHidden, true);
			assert.strictEqual(hidden.calendarEvent, undefined);

			const paged = await successfulApiCall({ endpoint: 'calendar/events/notes', parameters: { eventId: event.id, untilId: bobFollowersNote.id }, user: bob });
			assert.deepStrictEqual(paged.map(n => n.id), [bobLinkedNote.id]);
		});

		test('ブロックしている人のノートは一覧に出ない', async () => {
			await successfulApiCall({ endpoint: 'blocking/create', parameters: { userId: alice.id }, user: bob });
			try {
				const fromAlice = await successfulApiCall({ endpoint: 'calendar/events/notes', parameters: { eventId: event.id }, user: alice });
				assert.deepStrictEqual(fromAlice, []);
			} finally {
				await successfulApiCall({ endpoint: 'blocking/delete', parameters: { userId: alice.id }, user: bob });
			}
		});

		test('投稿済みの自分のノートを紐づけられる', async () => {
			aliceNote = await post(alice, { text: 'あとから紐づける' });
			await successfulApiCall({ endpoint: 'calendar/events/link-note', parameters: { noteId: aliceNote.id, eventId: event.id }, user: alice });

			const shown = await successfulApiCall({ endpoint: 'notes/show', parameters: { noteId: aliceNote.id }, user: alice });
			assert.strictEqual(shown.calendarEvent?.id, event.id);

			// 同じイベントにもう一度紐づけても何もしない
			await successfulApiCall({ endpoint: 'calendar/events/link-note', parameters: { noteId: aliceNote.id, eventId: event.id }, user: alice });
		});

		test('紐づけのエラー', async () => {
			const other = await successfulApiCall({
				endpoint: 'calendar/events/create',
				parameters: { title: '別のイベント', date, isAllDay: true },
				user: alice,
			});
			await failedApiCall({ endpoint: 'calendar/events/link-note', parameters: { noteId: aliceNote.id, eventId: other.id }, user: alice }, {
				status: 400, code: 'NOTE_ALREADY_LINKED_TO_ANOTHER_CALENDAR_EVENT', id: '5b98c05e-f4ed-4cb1-889d-bf635c5b4603',
			});
			await failedApiCall({ endpoint: 'calendar/events/link-note', parameters: { noteId: aliceNote.id, eventId: event.id }, user: bob }, {
				status: 400, code: 'ACCESS_DENIED', id: '9fae17be-db0d-41ef-b418-eb4aeeefb8c6',
			});
			await failedApiCall({ endpoint: 'calendar/events/link-note', parameters: { noteId: 'xxxxxxxxxx', eventId: event.id }, user: alice }, {
				status: 400, code: 'NO_SUCH_NOTE', id: 'd54587c1-87ba-4d56-a113-9e29357d7529',
			});

			const direct = await post(alice, { text: 'ダイレクト', visibility: 'specified', visibleUserIds: [bob.id] });
			await failedApiCall({ endpoint: 'calendar/events/link-note', parameters: { noteId: direct.id, eventId: event.id }, user: alice }, {
				status: 400, code: 'CANNOT_LINK_NOTE_TO_CALENDAR_EVENT', id: 'b7471874-1199-42df-bd78-a6f518d8f626',
			});
		});

		test('紐づけを外せるのはノートの作成者・イベントの作成者・モデレーター', async () => {
			// bob は alice のノートの作成者でもイベントの作成者でもない
			await failedApiCall({ endpoint: 'calendar/events/unlink-note', parameters: { noteId: aliceNote.id }, user: bob }, {
				status: 400, code: 'ACCESS_DENIED', id: '568307ac-c95a-4ff3-ba4c-076b13bf9809',
			});

			// イベントの作成者 (alice) は bob のノートの紐づけを外せる
			await successfulApiCall({ endpoint: 'calendar/events/unlink-note', parameters: { noteId: bobFollowersNote.id }, user: alice });
			await failedApiCall({ endpoint: 'calendar/events/unlink-note', parameters: { noteId: bobFollowersNote.id }, user: alice }, {
				status: 400, code: 'NOTE_NOT_LINKED_TO_CALENDAR_EVENT', id: '4de63727-115b-483c-905f-a90dc0d3ebb3',
			});

			const shown = await successfulApiCall({ endpoint: 'notes/show', parameters: { noteId: bobFollowersNote.id }, user: bob });
			assert.strictEqual(shown.calendarEvent, undefined);
		});
	});

	describe('編集・中止・削除', () => {
		test('作成者以外は編集できない', async () => {
			await failedApiCall({ endpoint: 'calendar/events/update', parameters: { eventId: event.id, title: '乗っ取り' }, user: bob }, {
				status: 400, code: 'ACCESS_DENIED', id: '1055669a-4b7a-4347-bdba-7549df982583',
			});
		});

		test('変える項目だけを渡して編集でき、null で消せる', async () => {
			const updated = await successfulApiCall({
				endpoint: 'calendar/events/update',
				parameters: { eventId: event.id, title: 'もくもく会 (場所変更)', location: null, startTime: '12:30' },
				user: alice,
			});
			assert.strictEqual(updated.title, 'もくもく会 (場所変更)');
			assert.strictEqual(updated.location, null);
			assert.strictEqual(updated.startTime, '12:30');
			assert.strictEqual(updated.endTime, '13:00');
			assert.strictEqual(updated.hashtag, 'mokumoku42');
			assert.notStrictEqual(updated.updatedAt, null);

			const res = await api('calendar/events/update', { eventId: event.id, endTime: '12:00' }, alice);
			assert.strictEqual(castAsError(res.body as any).error.code, 'INVALID_CALENDAR_EVENT');
			assert.deepStrictEqual(castAsError(res.body as any).error.info, { reason: 'endNotAfterStart' });
		});

		test('モデレーターも編集できる', async () => {
			const updated = await successfulApiCall({ endpoint: 'calendar/events/update', parameters: { eventId: event.id, location: 'c1' }, user: carol });
			assert.strictEqual(updated.location, 'c1');
		});

		test('中止すると isCanceled になり、購読・紐づけ・編集ができなくなる', async () => {
			await failedApiCall({ endpoint: 'calendar/events/cancel', parameters: { eventId: event.id }, user: bob }, {
				status: 400, code: 'ACCESS_DENIED', id: 'f70e5f07-dcb0-4727-81e4-9c925d4439bb',
			});

			const canceled = await successfulApiCall({ endpoint: 'calendar/events/cancel', parameters: { eventId: event.id }, user: alice });
			assert.strictEqual(canceled.isCanceled, true);
			assert.notStrictEqual(canceled.canceledAt, null);

			await failedApiCall({ endpoint: 'calendar/events/cancel', parameters: { eventId: event.id }, user: alice }, {
				status: 400, code: 'CALENDAR_EVENT_CANCELED', id: '58426b92-8f54-409b-82dd-ce8617828dae',
			});
			await failedApiCall({ endpoint: 'calendar/events/subscribe', parameters: { eventId: event.id }, user: carol }, {
				status: 400, code: 'CALENDAR_EVENT_CANCELED', id: '959f2887-4596-498a-ae47-0581f6bc862e',
			});
			await failedApiCall({ endpoint: 'calendar/events/update', parameters: { eventId: event.id, title: 'x' }, user: alice }, {
				status: 400, code: 'CALENDAR_EVENT_CANCELED', id: 'd831c855-bc77-4673-8ebf-b1de2601613e',
			});
			await failedApiCall({ endpoint: 'notes/create', parameters: { text: 'x', calendarEventId: event.id }, user: bob }, {
				status: 400, code: 'CALENDAR_EVENT_CANCELED', id: '6f2f511f-a971-4bbb-be0c-7e41eda7a349',
			});
			const newNote = await post(bob, { text: 'あとから' });
			await failedApiCall({ endpoint: 'calendar/events/link-note', parameters: { noteId: newNote.id, eventId: event.id }, user: bob }, {
				status: 400, code: 'CALENDAR_EVENT_CANCELED', id: 'fd44ba04-6922-48f3-9718-5408c7f3ff8a',
			});

			// 中止したイベントは一覧には残り、近日のイベントからは消える
			const list = await successfulApiCall({ endpoint: 'calendar/events/list', parameters: { month }, user: bob });
			assert.ok(list.some(e => e.id === event.id && e.isCanceled));
			const upcoming = await successfulApiCall({ endpoint: 'calendar/events/upcoming', parameters: { limit: 30 }, user: bob });
			assert.ok(!upcoming.some(e => e.id === event.id));

			const shown = await successfulApiCall({ endpoint: 'notes/show', parameters: { noteId: bobLinkedNote.id }, user: bob });
			assert.strictEqual(shown.calendarEvent?.isCanceled, true);
		});

		test('作成者以外は削除できず、モデレーターは削除できる。ノートは残る', async () => {
			await failedApiCall({ endpoint: 'calendar/events/delete', parameters: { eventId: event.id }, user: bob }, {
				status: 400, code: 'ACCESS_DENIED', id: '714f14ea-c6b0-42f9-8f1a-d8fbc21c62ce',
			});

			await successfulApiCall({ endpoint: 'calendar/events/delete', parameters: { eventId: event.id }, user: carol });

			await failedApiCall({ endpoint: 'calendar/events/show', parameters: { eventId: event.id }, user: alice }, {
				status: 400, code: 'NO_SUCH_CALENDAR_EVENT', id: '14d2357d-a3a3-4f49-b23a-ca7c0d19fe31',
			});
			await failedApiCall({ endpoint: 'calendar/events/delete', parameters: { eventId: event.id }, user: alice }, {
				status: 400, code: 'NO_SUCH_CALENDAR_EVENT', id: '5affb905-2875-4fec-af6b-6850012a299f',
			});
			await failedApiCall({ endpoint: 'calendar/events/notes', parameters: { eventId: event.id }, user: alice }, {
				status: 400, code: 'NO_SUCH_CALENDAR_EVENT', id: 'd1599890-b83e-4e1a-b92e-9c232a38921d',
			});

			const shown = await successfulApiCall({ endpoint: 'notes/show', parameters: { noteId: bobLinkedNote.id }, user: bob });
			assert.strictEqual(shown.calendarEvent, undefined);
		});
	});
});
