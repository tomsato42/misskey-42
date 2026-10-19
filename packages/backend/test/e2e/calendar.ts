/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'assert';
import { describe, beforeAll, test, vi } from 'vitest';
import { formatJstDate } from '@/core/calendar/calendar-time.js';
import { api, castAsError, failedApiCall, post, relativeFetch, role, signup, successfulApiCall } from '../utils.js';
import type * as misskey from 'misskey-js';

// 各テストは前のテストで作ったイベントやノートを使うので、上から順に実行する
describe('カレンダー', () => {
	let root: misskey.entities.SignupResponse;
	let alice: misskey.entities.SignupResponse;
	let bob: misskey.entities.SignupResponse;
	let carol: misskey.entities.SignupResponse;
	let dave: misskey.entities.SignupResponse;
	let erin: misskey.entities.SignupResponse;

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
		dave = await signup({ username: 'dave' });
		erin = await signup({ username: 'erin' });
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
			// bob は alice のノートの作成者でもイベントの作成者でもない。紐づいていないノートと同じエラーになる
			await failedApiCall({ endpoint: 'calendar/events/unlink-note', parameters: { noteId: aliceNote.id }, user: bob }, {
				status: 400, code: 'NOTE_NOT_LINKED_TO_CALENDAR_EVENT', id: '4de63727-115b-483c-905f-a90dc0d3ebb3',
			});
			const unlinkedNote = await post(alice, { text: '紐づけていないノート' });
			await failedApiCall({ endpoint: 'calendar/events/unlink-note', parameters: { noteId: unlinkedNote.id }, user: bob }, {
				status: 400, code: 'NOTE_NOT_LINKED_TO_CALENDAR_EVENT', id: '4de63727-115b-483c-905f-a90dc0d3ebb3',
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

	describe('ノートと一緒に作るイベントの数の上限', () => {
		test('直近1時間に30件作っていると、notes/create でイベントを作れず、ノートも作らない', async () => {
			for (let i = 0; i < 30; i++) {
				await successfulApiCall({ endpoint: 'calendar/events/create', parameters: { title: `上限の確認 ${i}`, date, isAllDay: true }, user: dave });
			}

			const res = await api('notes/create', { text: '上限を超えた告知', calendarEvent: { title: '31件目', date, isAllDay: true } }, dave);
			assert.strictEqual(res.status, 429);
			const err = castAsError(res.body as any).error;
			assert.strictEqual(err.code, 'RATE_LIMIT_EXCEEDED');
			assert.strictEqual(err.id, 'd5826d14-3982-4d2e-8011-b9e9f02499ef');
			assert.ok(res.headers.get('retry-after') != null);

			const notes = await successfulApiCall({ endpoint: 'users/notes', parameters: { userId: dave.id }, user: dave });
			assert.ok(!notes.some(n => n.text === '上限を超えた告知'));

			// 既存のイベントへの紐づけは数えない
			const own = await successfulApiCall({ endpoint: 'calendar/events/list', parameters: { month, filter: 'mine' }, user: dave });
			const linked = await successfulApiCall({ endpoint: 'notes/create', parameters: { text: '紐づけは作れる', calendarEventId: own[0].id }, user: dave });
			assert.strictEqual(linked.createdNote.calendarEvent?.id, own[0].id);
		});
	});

	describe('通知', () => {
		const waitOptions = { timeout: 5000, interval: 50 };
		let target: misskey.entities.CalendarEvent;

		async function calendarNotifications(user: misskey.entities.SignupResponse) {
			const res = await api('i/notifications', { includeTypes: ['calendarEventUpdated', 'calendarEventReminder'] }, user);
			assert.strictEqual(res.status, 200);
			return res.body.filter(n => n.type === 'calendarEventUpdated' && n.event.id === target.id);
		}

		test('通知の設定は既定ですべてオンで、項目ごとに変えられる', async () => {
			const initial = await successfulApiCall({ endpoint: 'i/calendar-notification-settings', parameters: {}, user: carol });
			assert.deepStrictEqual(initial, { week: true, day: true, today: true, changes: true, invited: true });

			const updated = await successfulApiCall({ endpoint: 'i/calendar-notification-settings/update', parameters: { changes: false }, user: carol });
			assert.deepStrictEqual(updated, { week: true, day: true, today: true, changes: false, invited: true });
			const shown = await successfulApiCall({ endpoint: 'i/calendar-notification-settings', parameters: {}, user: carol });
			assert.deepStrictEqual(shown, updated);
		});

		test('日時を変えると、操作した本人と changes をオフにした人を除く購読者に通知が届く', async () => {
			target = await successfulApiCall({
				endpoint: 'calendar/events/create',
				parameters: { title: '通知の確認', date, startTime: '18:00' },
				user: alice,
			});
			await successfulApiCall({ endpoint: 'calendar/events/subscribe', parameters: { eventId: target.id }, user: bob });
			await successfulApiCall({ endpoint: 'calendar/events/subscribe', parameters: { eventId: target.id }, user: carol });

			// 日時以外の変更では通知しない
			await successfulApiCall({ endpoint: 'calendar/events/update', parameters: { eventId: target.id, location: 'c2' }, user: alice });
			await successfulApiCall({ endpoint: 'calendar/events/update', parameters: { eventId: target.id, startTime: '19:00', endTime: '20:00' }, user: alice });

			await vi.waitFor(async () => {
				const notifications = await calendarNotifications(bob);
				assert.strictEqual(notifications.length, 1);
				const n = notifications[0];
				assert.ok(n.type === 'calendarEventUpdated');
				assert.strictEqual(n.updateKind, 'rescheduled');
				assert.strictEqual(n.event.title, '通知の確認');
				assert.strictEqual(n.previousSchedule?.date, date);
				assert.strictEqual(n.previousSchedule?.startTime, '18:00');
				assert.strictEqual(n.previousSchedule?.endTime, null);
				assert.strictEqual(n.schedule.startTime, '19:00');
				assert.strictEqual(n.schedule.endTime, '20:00');
			}, waitOptions);

			assert.strictEqual((await calendarNotifications(alice)).length, 0);
			assert.strictEqual((await calendarNotifications(carol)).length, 0);
		});

		test('中止すると canceled の通知が届く。モデレーターが中止したときは作成者にも届く', async () => {
			await successfulApiCall({ endpoint: 'calendar/events/cancel', parameters: { eventId: target.id }, user: root });

			await vi.waitFor(async () => {
				const notifications = await calendarNotifications(bob);
				assert.strictEqual(notifications.length, 2);
				const canceled = notifications.find(n => n.type === 'calendarEventUpdated' && n.updateKind === 'canceled');
				assert.ok(canceled != null && canceled.type === 'calendarEventUpdated');
				assert.strictEqual(canceled.previousSchedule, null);
				assert.strictEqual(canceled.schedule.startTime, '19:00');
				assert.strictEqual(canceled.event.isCanceled, true);
			}, waitOptions);

			await vi.waitFor(async () => {
				assert.strictEqual((await calendarNotifications(alice)).length, 1);
			}, waitOptions);
		});

		test('イベントを削除すると、そのイベントの通知は出さない', async () => {
			await successfulApiCall({ endpoint: 'calendar/events/delete', parameters: { eventId: target.id }, user: alice });
			assert.strictEqual((await calendarNotifications(bob)).length, 0);
		});
	});

	describe('カレンダー配信', () => {
		let urls: { subscribedUrl: string; allUrl: string };
		let subscribedEvent: misskey.entities.CalendarEvent;
		let otherEvent: misskey.entities.CalendarEvent;

		async function fetchFeed(url: string) {
			return await relativeFetch(new URL(url).pathname);
		}

		beforeAll(async () => {
			subscribedEvent = await successfulApiCall({
				endpoint: 'calendar/events/create',
				parameters: { title: '配信, 確認; する', date, startTime: '10:00', description: '1行目\n2行目' },
				user: erin,
			});
			otherEvent = await successfulApiCall({
				endpoint: 'calendar/events/create',
				parameters: { title: 'erin が購読していないイベント', date, isAllDay: true },
				user: bob,
			});
		});

		test('配信の URL を取ると鍵が作られ、2 回目も同じ URL を返す', async () => {
			urls = await successfulApiCall({ endpoint: 'i/calendar-feed', parameters: {}, user: erin });
			assert.match(urls.subscribedUrl, /\/calendar\/feed\/subscribed\/[A-Za-z0-9_-]{43}\.ics$/);
			assert.match(urls.allUrl, /\/calendar\/feed\/all\/[A-Za-z0-9_-]{43}\.ics$/);
			assert.strictEqual(urls.subscribedUrl.split('/').at(-1), urls.allUrl.split('/').at(-1));

			const again = await successfulApiCall({ endpoint: 'i/calendar-feed', parameters: {}, user: erin });
			assert.deepStrictEqual(again, urls);
		});

		test('購読中の配信は、購読している (自分が作成した) イベントだけ', async () => {
			const res = await fetchFeed(urls.subscribedUrl);
			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.headers.get('content-type'), 'text/calendar; charset=utf-8');
			assert.strictEqual(res.headers.get('cache-control'), 'private, max-age=300');
			assert.strictEqual(res.headers.get('content-disposition'), 'inline; filename="42times.ics"');

			const body = await res.text();
			const unfolded = body.replace(/\r\n /g, '');
			assert.ok(body.startsWith('BEGIN:VCALENDAR\r\n'));
			assert.ok(unfolded.includes(`UID:${subscribedEvent.id}@`));
			assert.ok(unfolded.includes('SUMMARY:配信\\, 確認\\; する'));
			assert.ok(unfolded.includes('DESCRIPTION:1行目\\n2行目\\n\\n'));
			assert.ok(unfolded.includes(`/calendar/events/${subscribedEvent.id}`));
			assert.ok(unfolded.includes('STATUS:CONFIRMED'));
			assert.ok(!unfolded.includes(`UID:${otherEvent.id}@`));
		});

		test('すべての配信は、購読していないイベントと中止したイベントも含む', async () => {
			await successfulApiCall({ endpoint: 'calendar/events/cancel', parameters: { eventId: otherEvent.id }, user: bob });

			const res = await fetchFeed(urls.allUrl);
			assert.strictEqual(res.status, 200);
			const unfolded = (await res.text()).replace(/\r\n /g, '');
			assert.ok(unfolded.includes(`UID:${subscribedEvent.id}@`));
			assert.ok(unfolded.includes(`UID:${otherEvent.id}@`));
			assert.ok(unfolded.includes('STATUS:CANCELLED'));
			assert.ok(unfolded.includes('DTSTART;VALUE=DATE:'));
		});

		test('知らない鍵・形の違う鍵は 404', async () => {
			assert.strictEqual((await relativeFetch(`/calendar/feed/all/${'A'.repeat(43)}.ics`)).status, 404);
			assert.strictEqual((await relativeFetch('/calendar/feed/all/short.ics')).status, 404);
		});

		test('作り直すと古い URL は 404 になる', async () => {
			const regenerated = await successfulApiCall({ endpoint: 'i/calendar-feed/regenerate', parameters: {}, user: erin });
			assert.notStrictEqual(regenerated.allUrl, urls.allUrl);

			assert.strictEqual((await fetchFeed(urls.allUrl)).status, 404);
			assert.strictEqual((await fetchFeed(regenerated.allUrl)).status, 200);
			urls = regenerated;
		});

		test('凍結されたユーザーの URL は 404 になる', async () => {
			await api('admin/suspend-user', { userId: erin.id }, root);
			try {
				assert.strictEqual((await fetchFeed(urls.subscribedUrl)).status, 404);
			} finally {
				await api('admin/unsuspend-user', { userId: erin.id }, root);
			}
			assert.strictEqual((await fetchFeed(urls.subscribedUrl)).status, 200);
		});
	});

	describe('公開範囲', () => {
		let frank: misskey.entities.SignupResponse;
		let grace: misskey.entities.SignupResponse;
		let followersEvent: misskey.entities.CalendarEvent;

		async function canShow(eventId: string, user: misskey.entities.SignupResponse): Promise<boolean> {
			const res = await api('calendar/events/show', { eventId }, user);
			if (res.status === 200) return true;
			assert.strictEqual(castAsError(res.body).error.code, 'NO_SUCH_CALENDAR_EVENT');
			return false;
		}

		async function monthIds(user: misskey.entities.SignupResponse): Promise<string[]> {
			const events = await successfulApiCall({ endpoint: 'calendar/events/list', parameters: { month }, user });
			return events.map(e => e.id);
		}

		async function invitedNotifications(user: misskey.entities.SignupResponse, eventId: string) {
			const res = await api('i/notifications', { includeTypes: ['calendarEventInvited'] }, user);
			assert.strictEqual(res.status, 200);
			return res.body.filter(n => n.type === 'calendarEventInvited' && n.event.id === eventId);
		}

		beforeAll(async () => {
			frank = await signup({ username: 'frank' });
			grace = await signup({ username: 'grace' });
			await api('following/create', { userId: alice.id }, frank);
		}, 1000 * 60);

		test('既定は全員で、公開範囲を返す。指定ユーザーとリストは管理できる人にだけ返す', async () => {
			const open = await successfulApiCall({ endpoint: 'calendar/events/create', parameters: { title: '全員向け', date, startTime: '09:00' }, user: alice });
			assert.strictEqual(open.visibility, 'public');
			assert.deepStrictEqual(open.visibleUserIds, []);
			assert.strictEqual(open.userListId, null);

			const shown = await successfulApiCall({ endpoint: 'calendar/events/show', parameters: { eventId: open.id }, user: frank });
			assert.strictEqual(shown.visibility, 'public');
			assert.strictEqual(shown.visibleUserIds, undefined);
		});

		test('フォロワー限定は、作成者のフォロワーだけが見られる', async () => {
			followersEvent = await successfulApiCall({
				endpoint: 'calendar/events/create',
				parameters: { title: 'フォロワー限定', date, startTime: '10:00', visibility: 'followers' },
				user: alice,
			});
			assert.strictEqual(followersEvent.visibility, 'followers');

			assert.ok(await canShow(followersEvent.id, frank));
			assert.ok(!await canShow(followersEvent.id, grace));
			assert.ok((await monthIds(frank)).includes(followersEvent.id));
			assert.ok(!(await monthIds(grace)).includes(followersEvent.id));

			// 見られない人は購読もできない (存在しないのと同じエラー)
			await failedApiCall({ endpoint: 'calendar/events/subscribe', parameters: { eventId: followersEvent.id }, user: grace }, { status: 400, code: 'NO_SUCH_CALENDAR_EVENT', id: '7ca24a7a-de71-4aa9-84da-160776c9a929' });
		});

		test('モデレーターも普段はほかの人と同じで、管理人ビュー (moderatorView) のときだけ公開範囲の外も見られる', async () => {
			const hidden = await successfulApiCall({
				endpoint: 'calendar/events/create',
				parameters: { title: '管理人ビュー', date, startTime: '10:30', visibility: 'followers' },
				user: alice,
			});
			assert.ok(!await canShow(hidden.id, carol));
			assert.ok(!(await monthIds(carol)).includes(hidden.id));

			const shown = await successfulApiCall({ endpoint: 'calendar/events/show', parameters: { eventId: hidden.id, moderatorView: true }, user: carol });
			assert.strictEqual(shown.isOutsideVisibility, true);
			const list = await successfulApiCall({ endpoint: 'calendar/events/list', parameters: { month, moderatorView: true }, user: carol });
			assert.strictEqual(list.find(e => e.id === hidden.id)?.isOutsideVisibility, true);
			// 公開範囲の内のイベントは false
			assert.ok(list.filter(e => e.visibility === 'public').every(e => e.isOutsideVisibility === false));
			await successfulApiCall({ endpoint: 'calendar/events/subscribers', parameters: { eventId: hidden.id, moderatorView: true }, user: carol });
			await successfulApiCall({ endpoint: 'calendar/events/notes', parameters: { eventId: hidden.id, moderatorView: true }, user: carol });

			// モデレーターでなければ効かない
			await failedApiCall({ endpoint: 'calendar/events/show', parameters: { eventId: hidden.id, moderatorView: true }, user: grace }, { status: 400, code: 'NO_SUCH_CALENDAR_EVENT', id: '14d2357d-a3a3-4f49-b23a-ca7c0d19fe31' });
			const graceList = await successfulApiCall({ endpoint: 'calendar/events/list', parameters: { month, moderatorView: true }, user: grace });
			assert.ok(!graceList.some(e => e.id === hidden.id));

			// 購読は公開範囲の内の人だけ (リマインドや配信の対象にならないので)
			await failedApiCall({ endpoint: 'calendar/events/subscribe', parameters: { eventId: hidden.id }, user: carol }, { status: 400, code: 'NO_SUCH_CALENDAR_EVENT', id: '7ca24a7a-de71-4aa9-84da-160776c9a929' });

			// 管理の操作は、管理人ビューでなくてもできる
			const updated = await successfulApiCall({ endpoint: 'calendar/events/update', parameters: { eventId: hidden.id, title: '管理人ビュー (編集済み)' }, user: carol });
			assert.strictEqual(updated.title, '管理人ビュー (編集済み)');
			await successfulApiCall({ endpoint: 'calendar/events/cancel', parameters: { eventId: hidden.id }, user: carol });
			await successfulApiCall({ endpoint: 'calendar/events/delete', parameters: { eventId: hidden.id }, user: carol });
		});

		test('相互フォローは、作成者もフォローし返すと見られる', async () => {
			const mutual = await successfulApiCall({
				endpoint: 'calendar/events/create',
				parameters: { title: '相互フォロー限定', date, startTime: '11:00', visibility: 'mutual' },
				user: alice,
			});
			assert.ok(!await canShow(mutual.id, frank));
			await api('following/create', { userId: frank.id }, alice);
			assert.ok(await canShow(mutual.id, frank));
		});

		test('指定ユーザーは指定した人だけが見られ、作るとその人に招待の通知が届く', async () => {
			const specified = await successfulApiCall({
				endpoint: 'calendar/events/create',
				parameters: { title: '指定ユーザー限定', date, startTime: '12:00', visibility: 'specified', visibleUserIds: [grace.id, alice.id] },
				user: alice,
			});
			assert.strictEqual(specified.visibility, 'specified');
			assert.deepStrictEqual(specified.visibleUserIds, [grace.id]);

			assert.ok(await canShow(specified.id, grace));
			assert.ok(!await canShow(specified.id, frank));

			await vi.waitFor(async () => {
				const notifications = await invitedNotifications(grace, specified.id);
				assert.strictEqual(notifications.length, 1);
				assert.ok(notifications[0].type === 'calendarEventInvited');
				assert.strictEqual(notifications[0].user.id, alice.id);
			}, { timeout: 5000, interval: 50 });
			assert.strictEqual((await invitedNotifications(frank, specified.id)).length, 0);

			const shown = await successfulApiCall({ endpoint: 'calendar/events/show', parameters: { eventId: specified.id }, user: grace });
			assert.strictEqual(shown.invitedBy?.id, alice.id);
		});

		test('指定ユーザーが作成者だけのときはエラー', async () => {
			const res = await api('calendar/events/create', { title: 'x', date, startTime: '12:00', visibility: 'specified', visibleUserIds: [alice.id] }, alice);
			assert.strictEqual(res.status, 400);
			assert.strictEqual(castAsError(res.body).error.code, 'INVALID_CALENDAR_EVENT');
			assert.strictEqual((castAsError(res.body).error.info as { reason: string }).reason, 'visibleUsersRequired');
		});

		test('リストはメンバーが見られて招待され、ほかの人のリストは使えない', async () => {
			const list = await successfulApiCall({ endpoint: 'users/lists/create', parameters: { name: 'calendar' }, user: alice });
			await successfulApiCall({ endpoint: 'users/lists/push', parameters: { listId: list.id, userId: grace.id }, user: alice });

			const listEvent = await successfulApiCall({
				endpoint: 'calendar/events/create',
				parameters: { title: 'リスト限定', date, startTime: '13:00', visibility: 'list', userListId: list.id },
				user: alice,
			});
			assert.strictEqual(listEvent.userListId, list.id);
			assert.ok(await canShow(listEvent.id, grace));
			assert.ok(!await canShow(listEvent.id, frank));
			await vi.waitFor(async () => {
				assert.strictEqual((await invitedNotifications(grace, listEvent.id)).length, 1);
			}, { timeout: 5000, interval: 50 });

			const res = await api('calendar/events/create', { title: 'x', date, startTime: '12:00', visibility: 'list', userListId: list.id }, bob);
			assert.strictEqual(res.status, 400);
			assert.strictEqual((castAsError(res.body).error.info as { reason: string }).reason, 'invalidUserList');
		});

		test('公開範囲を狭めると、範囲の外になった人の購読が外れる', async () => {
			const target = await successfulApiCall({ endpoint: 'calendar/events/create', parameters: { title: 'あとで狭める', date, startTime: '14:00' }, user: alice });
			await successfulApiCall({ endpoint: 'calendar/events/subscribe', parameters: { eventId: target.id }, user: frank });
			await successfulApiCall({ endpoint: 'calendar/events/subscribe', parameters: { eventId: target.id }, user: grace });

			const updated = await successfulApiCall({
				endpoint: 'calendar/events/update',
				parameters: { eventId: target.id, visibility: 'specified', visibleUserIds: [grace.id] },
				user: alice,
			});
			assert.strictEqual(updated.visibility, 'specified');
			assert.strictEqual(updated.subscribersCount, 2);
			assert.ok(!await canShow(target.id, frank));
			assert.ok(await canShow(target.id, grace));
		});

		test('ノートに付けたイベントは、公開範囲の外の人には付かない (ノートだけ見える)', async () => {
			const note = (await api('notes/create', {
				text: '指定ユーザー向けのイベントを告知',
				calendarEvent: { title: 'ノートで告知', date, startTime: '15:00', visibility: 'specified', visibleUserIds: [grace.id] },
			}, alice)).body.createdNote;

			await vi.waitFor(async () => {
				const forGrace = await successfulApiCall({ endpoint: 'notes/show', parameters: { noteId: note.id }, user: grace });
				assert.strictEqual(forGrace.calendarEvent?.title, 'ノートで告知');
			}, { timeout: 5000, interval: 50 });
			const forFrank = await successfulApiCall({ endpoint: 'notes/show', parameters: { noteId: note.id }, user: frank });
			assert.strictEqual(forFrank.calendarEvent, undefined);
		});

		test('公開範囲の外になったイベントは、購読を外せるが中身は返さず、編集などのエラーでも存在が分からない', async () => {
			const target = await successfulApiCall({ endpoint: 'calendar/events/create', parameters: { title: 'あとで見えなくなる', date, startTime: '16:00' }, user: alice });
			await successfulApiCall({ endpoint: 'calendar/events/subscribe', parameters: { eventId: target.id }, user: frank });
			// 招待の通知は、イベントが見られるあいだは出る
			await successfulApiCall({ endpoint: 'calendar/events/invite', parameters: { eventId: target.id, userIds: [grace.id] }, user: alice });
			await vi.waitFor(async () => {
				assert.strictEqual((await invitedNotifications(grace, target.id)).length, 1);
			}, { timeout: 5000, interval: 50 });

			// 公開範囲を狭めて frank と grace が見られないようにする
			await successfulApiCall({ endpoint: 'calendar/events/update', parameters: { eventId: target.id, visibility: 'specified', visibleUserIds: [carol.id] }, user: alice });

			await failedApiCall({ endpoint: 'calendar/events/unsubscribe', parameters: { eventId: target.id }, user: frank }, { status: 400, code: 'NO_SUCH_CALENDAR_EVENT', id: 'c0c8b27b-3858-4ef0-9c13-c255a97be389' });
			await failedApiCall({ endpoint: 'calendar/events/update', parameters: { eventId: target.id, title: 'x' }, user: grace }, { status: 400, code: 'NO_SUCH_CALENDAR_EVENT', id: '4a76d49b-9560-4c56-b199-ba395d7f2c1f' });
			const graceNote = await post(grace, { text: 'x' });
			await failedApiCall({ endpoint: 'calendar/events/link-note', parameters: { noteId: graceNote.id, eventId: target.id }, user: grace }, { status: 400, code: 'NO_SUCH_CALENDAR_EVENT', id: 'cea2e56f-0bcd-4557-9dc7-bc4b9a3d642d' });

			// 見られなくなったイベントの通知は出さない (中身を引き直して出すので)
			assert.strictEqual((await invitedNotifications(grace, target.id)).length, 0);
		});

		test('公開範囲の外のイベントは、購読者の一覧・招待でも存在しないのと同じエラー', async () => {
			const hidden = await successfulApiCall({
				endpoint: 'calendar/events/create',
				parameters: { title: '見えない', date, startTime: '18:00', visibility: 'specified', visibleUserIds: [carol.id] },
				user: alice,
			});
			await failedApiCall({ endpoint: 'calendar/events/subscribers', parameters: { eventId: hidden.id }, user: frank }, { status: 400, code: 'NO_SUCH_CALENDAR_EVENT', id: '66935c2f-b273-477d-94ef-0e3358048e32' });
			await failedApiCall({ endpoint: 'calendar/events/invite', parameters: { eventId: hidden.id, userIds: [grace.id] }, user: frank }, { status: 400, code: 'NO_SUCH_CALENDAR_EVENT', id: '983c16f8-0bed-49ec-92f6-2a639172d2e0' });
			await failedApiCall({ endpoint: 'calendar/events/invitation-statuses', parameters: { eventId: hidden.id, userIds: [grace.id] }, user: frank }, { status: 400, code: 'NO_SUCH_CALENDAR_EVENT', id: '3fe65baa-d325-4863-8fe7-3f384762647f' });
		});

		test('指定ユーザー・リストのイベントは、購読しているだけでは招待できない (作成者はできる)', async () => {
			const specified = await successfulApiCall({
				endpoint: 'calendar/events/create',
				parameters: { title: '招待は作成者だけ', date, startTime: '17:00', visibility: 'specified', visibleUserIds: [grace.id, frank.id] },
				user: alice,
			});
			await successfulApiCall({ endpoint: 'calendar/events/subscribe', parameters: { eventId: specified.id }, user: grace });
			await failedApiCall({ endpoint: 'calendar/events/invitation-statuses', parameters: { eventId: specified.id, userIds: [frank.id] }, user: grace }, { status: 400, code: 'ACCESS_DENIED', id: 'e0a93603-1026-4c20-b625-74f569937d68' });
			const statuses = await successfulApiCall({ endpoint: 'calendar/events/invitation-statuses', parameters: { eventId: specified.id, userIds: [frank.id, dave.id] }, user: alice });
			assert.deepStrictEqual(statuses.map(s => s.status), ['invited', 'unavailable']);
		});

		test('すべての配信は、鍵の持ち主が見られるイベントだけ', async () => {
			const graceUrls = await successfulApiCall({ endpoint: 'i/calendar-feed', parameters: {}, user: grace });
			const res = await relativeFetch(new URL(graceUrls.allUrl).pathname);
			const unfolded = (await res.text()).replace(/\r\n /g, '');
			assert.ok(!unfolded.includes(`UID:${followersEvent.id}@`));

			const frankUrls = await successfulApiCall({ endpoint: 'i/calendar-feed', parameters: {}, user: frank });
			const frankFeed = (await (await relativeFetch(new URL(frankUrls.allUrl).pathname)).text()).replace(/\r\n /g, '');
			assert.ok(frankFeed.includes(`UID:${followersEvent.id}@`));
		});
	});

	describe('購読者の一覧と招待', () => {
		let hank: misskey.entities.SignupResponse;
		let ivy: misskey.entities.SignupResponse;
		let jack: misskey.entities.SignupResponse;
		let target: misskey.entities.CalendarEvent;

		async function invitedNotifications(user: misskey.entities.SignupResponse, eventId: string) {
			const res = await api('i/notifications', { includeTypes: ['calendarEventInvited'] }, user);
			assert.strictEqual(res.status, 200);
			return res.body.filter(n => n.type === 'calendarEventInvited' && n.event.id === eventId);
		}

		beforeAll(async () => {
			hank = await signup({ username: 'hank' });
			ivy = await signup({ username: 'ivy' });
			jack = await signup({ username: 'jack' });
			target = await successfulApiCall({ endpoint: 'calendar/events/create', parameters: { title: '購読者と招待', date, startTime: '16:00' }, user: hank });
			await api('following/create', { userId: jack.id }, ivy);
		}, 1000 * 60);

		test('購読者の一覧は作成者を除き、新しく購読した順', async () => {
			await successfulApiCall({ endpoint: 'calendar/events/subscribe', parameters: { eventId: target.id }, user: alice });
			await successfulApiCall({ endpoint: 'calendar/events/subscribe', parameters: { eventId: target.id }, user: jack });
			await successfulApiCall({ endpoint: 'calendar/events/subscribe', parameters: { eventId: target.id }, user: bob });

			const all = await successfulApiCall({ endpoint: 'calendar/events/subscribers', parameters: { eventId: target.id }, user: ivy });
			assert.deepStrictEqual(all.map(s => s.user.id), [bob.id, jack.id, alice.id]);

			const page = await successfulApiCall({ endpoint: 'calendar/events/subscribers', parameters: { eventId: target.id, limit: 2 }, user: ivy });
			const next = await successfulApiCall({ endpoint: 'calendar/events/subscribers', parameters: { eventId: target.id, untilId: page.at(-1)!.id }, user: ivy });
			assert.deepStrictEqual(next.map(s => s.user.id), [alice.id]);

			// イベントのページでは、フォローしている人を先にアバターを並べる
			const shown = await successfulApiCall({ endpoint: 'calendar/events/show', parameters: { eventId: target.id }, user: ivy });
			assert.strictEqual(shown.followingSubscribersCount, 1);
			assert.strictEqual(shown.subscribersPreview?.[0].id, jack.id);
			assert.strictEqual(shown.subscribersPreview?.length, 4);
			assert.strictEqual(shown.invitedBy, null);
		});

		test('購読していない人は招待できない', async () => {
			await failedApiCall({ endpoint: 'calendar/events/invite', parameters: { eventId: target.id, userIds: [dave.id] }, user: ivy }, { status: 400, code: 'ACCESS_DENIED', id: 'ffe95d7b-cf6b-4975-8d4c-d2d9443e3bf8' });
			await failedApiCall({ endpoint: 'calendar/events/invitation-statuses', parameters: { eventId: target.id, userIds: [dave.id] }, user: ivy }, { status: 400, code: 'ACCESS_DENIED', id: 'e0a93603-1026-4c20-b625-74f569937d68' });
		});

		test('購読している人は招待でき、招待された人には招待した人の名前で通知が届く。同じ人には 1 回だけ', async () => {
			const result = await successfulApiCall({ endpoint: 'calendar/events/invite', parameters: { eventId: target.id, userIds: [ivy.id, hank.id, alice.id, jack.id] }, user: jack });
			assert.deepStrictEqual(result, { invited: 1, subscribed: 2, alreadyInvited: 0, unavailable: 1 });

			await vi.waitFor(async () => {
				const notifications = await invitedNotifications(ivy, target.id);
				assert.strictEqual(notifications.length, 1);
				assert.ok(notifications[0].type === 'calendarEventInvited');
				assert.strictEqual(notifications[0].user.id, jack.id);
			}, { timeout: 5000, interval: 50 });

			const again = await successfulApiCall({ endpoint: 'calendar/events/invite', parameters: { eventId: target.id, userIds: [ivy.id] }, user: hank });
			assert.deepStrictEqual(again, { invited: 0, subscribed: 0, alreadyInvited: 1, unavailable: 0 });

			const statuses = await successfulApiCall({ endpoint: 'calendar/events/invitation-statuses', parameters: { eventId: target.id, userIds: [hank.id, ivy.id, dave.id, jack.id] }, user: jack });
			assert.deepStrictEqual(statuses, [
				{ userId: hank.id, status: 'subscribed' },
				{ userId: ivy.id, status: 'invited' },
				{ userId: dave.id, status: 'invitable' },
				{ userId: jack.id, status: 'unavailable' },
			]);

			const shown = await successfulApiCall({ endpoint: 'calendar/events/show', parameters: { eventId: target.id }, user: ivy });
			assert.strictEqual(shown.invitedBy?.id, jack.id);
		});

		test('自分のリストのメンバーを招待できる。dryRun では送らずに数だけ返す', async () => {
			const list = await successfulApiCall({ endpoint: 'users/lists/create', parameters: { name: 'invite' }, user: jack });
			for (const user of [dave, erin, alice]) {
				await successfulApiCall({ endpoint: 'users/lists/push', parameters: { listId: list.id, userId: user.id }, user: jack });
			}

			const dry = await successfulApiCall({ endpoint: 'calendar/events/invite', parameters: { eventId: target.id, userListId: list.id, dryRun: true }, user: jack });
			assert.deepStrictEqual(dry, { invited: 2, subscribed: 1, alreadyInvited: 0, unavailable: 0 });
			assert.strictEqual((await invitedNotifications(dave, target.id)).length, 0);

			const sent = await successfulApiCall({ endpoint: 'calendar/events/invite', parameters: { eventId: target.id, userListId: list.id }, user: jack });
			assert.deepStrictEqual(sent, { invited: 2, subscribed: 1, alreadyInvited: 0, unavailable: 0 });
			await vi.waitFor(async () => {
				assert.strictEqual((await invitedNotifications(dave, target.id)).length, 1);
			}, { timeout: 5000, interval: 50 });

			await failedApiCall({ endpoint: 'calendar/events/invite', parameters: { eventId: target.id, userListId: list.id }, user: hank }, { status: 400, code: 'NO_SUCH_LIST', id: 'ad4767f7-72d5-4995-bc83-c194c0aa350c' });
		});

		test('招待の通知をオフにした人には届かないが、招待済みになる', async () => {
			await successfulApiCall({ endpoint: 'i/calendar-notification-settings/update', parameters: { invited: false }, user: bob });
			const quiet = await successfulApiCall({ endpoint: 'calendar/events/create', parameters: { title: '通知しない', date, startTime: '17:00' }, user: hank });
			const result = await successfulApiCall({ endpoint: 'calendar/events/invite', parameters: { eventId: quiet.id, userIds: [bob.id] }, user: hank });
			assert.strictEqual(result.invited, 1);

			// 通知は裏で作るので、ほかの人に届くのを待ってから確かめる
			await successfulApiCall({ endpoint: 'calendar/events/invite', parameters: { eventId: quiet.id, userIds: [ivy.id] }, user: hank });
			await vi.waitFor(async () => {
				assert.strictEqual((await invitedNotifications(ivy, quiet.id)).length, 1);
			}, { timeout: 5000, interval: 50 });
			assert.strictEqual((await invitedNotifications(bob, quiet.id)).length, 0);
			const statuses = await successfulApiCall({ endpoint: 'calendar/events/invitation-statuses', parameters: { eventId: quiet.id, userIds: [bob.id] }, user: hank });
			assert.strictEqual(statuses[0].status, 'invited');
		});

		test('公開範囲の外の人は招待できず、中止したイベントには招待できない', async () => {
			const followersOnly = await successfulApiCall({
				endpoint: 'calendar/events/create',
				parameters: { title: 'フォロワーだけ', date, startTime: '18:00', visibility: 'followers' },
				user: hank,
			});
			const result = await successfulApiCall({ endpoint: 'calendar/events/invite', parameters: { eventId: followersOnly.id, userIds: [ivy.id] }, user: hank });
			assert.deepStrictEqual(result, { invited: 0, subscribed: 0, alreadyInvited: 0, unavailable: 1 });

			await successfulApiCall({ endpoint: 'calendar/events/cancel', parameters: { eventId: followersOnly.id }, user: hank });
			await failedApiCall({ endpoint: 'calendar/events/invite', parameters: { eventId: followersOnly.id, userIds: [ivy.id] }, user: hank }, { status: 400, code: 'CALENDAR_EVENT_CANCELED', id: '8873aebe-3ee9-4ce7-83df-d20af01cd98d' });
		});

		test('作成者がフォロワー (相互フォローならフォローも) を非公開にしているイベントには、購読者は招待できない', async () => {
			const kate = await signup({ username: 'kate' });
			const leo = await signup({ username: 'leo' });
			await api('following/create', { userId: kate.id }, leo);
			await api('following/create', { userId: leo.id }, kate);
			const followersOnly = await successfulApiCall({ endpoint: 'calendar/events/create', parameters: { title: 'フォロワー限定', date, startTime: '19:00', visibility: 'followers' }, user: kate });
			const mutualOnly = await successfulApiCall({ endpoint: 'calendar/events/create', parameters: { title: '相互フォロー限定', date, startTime: '20:00', visibility: 'mutual' }, user: kate });
			for (const event of [followersOnly, mutualOnly]) {
				await successfulApiCall({ endpoint: 'calendar/events/subscribe', parameters: { eventId: event.id }, user: leo });
			}
			const canInvite = async (event: misskey.entities.CalendarEvent, user: misskey.entities.SignupResponse) =>
				(await successfulApiCall({ endpoint: 'calendar/events/show', parameters: { eventId: event.id }, user })).canInvite;

			assert.strictEqual(await canInvite(followersOnly, leo), true);
			assert.strictEqual(await canInvite(mutualOnly, leo), true);

			// 招待できるかの状態から、作成者をフォローしているかが分かってしまう
			await successfulApiCall({ endpoint: 'i/update', parameters: { followersVisibility: 'private' }, user: kate });
			assert.strictEqual(await canInvite(followersOnly, leo), false);
			await failedApiCall({ endpoint: 'calendar/events/invitation-statuses', parameters: { eventId: followersOnly.id, userIds: [ivy.id] }, user: leo }, { status: 400, code: 'ACCESS_DENIED', id: 'e0a93603-1026-4c20-b625-74f569937d68' });
			await failedApiCall({ endpoint: 'calendar/events/invite', parameters: { eventId: followersOnly.id, userIds: [ivy.id], dryRun: true }, user: leo }, { status: 400, code: 'ACCESS_DENIED', id: 'ffe95d7b-cf6b-4975-8d4c-d2d9443e3bf8' });
			// 作成者は自分で送れる
			assert.strictEqual(await canInvite(followersOnly, kate), true);
			await successfulApiCall({ endpoint: 'calendar/events/invitation-statuses', parameters: { eventId: followersOnly.id, userIds: [ivy.id] }, user: kate });

			// 相互フォローは、フォローの一覧を非公開にしていても送れない
			await successfulApiCall({ endpoint: 'i/update', parameters: { followersVisibility: 'followers', followingVisibility: 'private' }, user: kate });
			assert.strictEqual(await canInvite(followersOnly, leo), true);
			assert.strictEqual(await canInvite(mutualOnly, leo), false);
			await failedApiCall({ endpoint: 'calendar/events/invitation-statuses', parameters: { eventId: mutualOnly.id, userIds: [ivy.id] }, user: leo }, { status: 400, code: 'ACCESS_DENIED', id: 'e0a93603-1026-4c20-b625-74f569937d68' });
		});
	});
});
