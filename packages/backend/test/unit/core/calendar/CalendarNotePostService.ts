/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// CalendarEventService を差し替えて、ノートの投稿との連携の分岐を確認する (DB 不要)

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { CalendarNotePostService } from '@/core/calendar/CalendarNotePostService.js';
import {
	CalendarEventCanceledError,
	CalendarEventNotFoundError,
	CalendarEventValidationError,
	CalendarNoteNotLinkableError,
	CalendarNoteParamsConflictError,
} from '@/core/calendar/calendar-errors.js';
import type { CalendarEventService } from '@/core/calendar/CalendarEventService.js';
import type { LoggerService } from '@/core/LoggerService.js';
import type { CalendarLinkableNoteLike } from '@/core/calendar/calendar-note-link.js';
import type { MiCalendarEvent } from '@/models/CalendarEvent.js';
import type { MiNote } from '@/models/Note.js';

const ME = { id: 'me' };

const NOTE_PARAMS: CalendarLinkableNoteLike = {
	visibility: 'public',
	renoteId: null,
	replyId: null,
	text: '今週もボドゲやります',
	cw: null,
	fileIds: [],
	hasPoll: false,
};

const EVENT_INPUT = { title: 'ボードゲーム部', date: '2026-10-20', startTime: '19:00' };

function createdNote(overrides: Partial<MiNote> = {}): MiNote {
	return {
		id: 'note1',
		userId: ME.id,
		visibility: 'public',
		renoteId: null,
		replyId: null,
		text: '今週もボドゲやります',
		cw: null,
		fileIds: [],
		hasPoll: false,
		...overrides,
	} as MiNote;
}

function event(overrides: Partial<MiCalendarEvent> = {}): MiCalendarEvent {
	return {
		id: 'event1',
		userId: 'other',
		canceledAt: null,
		...overrides,
	} as MiCalendarEvent;
}

describe('CalendarNotePostService.prepare', () => {
	let calendarEventService: {
		create: ReturnType<typeof vi.fn>;
		linkNote: ReturnType<typeof vi.fn>;
		findByIdOrFail: ReturnType<typeof vi.fn>;
	};
	let warn: ReturnType<typeof vi.fn>;
	let service: CalendarNotePostService;

	beforeEach(() => {
		calendarEventService = {
			create: vi.fn(async () => event({ userId: ME.id })),
			linkNote: vi.fn(async () => event()),
			findByIdOrFail: vi.fn(async () => event()),
		};
		warn = vi.fn();
		const loggerService = { getLogger: () => ({ warn }) } as unknown as LoggerService;
		service = new CalendarNotePostService(calendarEventService as unknown as CalendarEventService, loggerService);
	});

	test('イベントの指定が無ければ null', async () => {
		expect(await service.prepare(ME, { note: NOTE_PARAMS })).toBeNull();
		expect(await service.prepare(ME, { calendarEventId: null, calendarEvent: null, note: NOTE_PARAMS })).toBeNull();
	});

	test('両方を指定するとエラー', async () => {
		await expect(service.prepare(ME, { calendarEventId: 'event1', calendarEvent: EVENT_INPUT, note: NOTE_PARAMS }))
			.rejects.toBeInstanceOf(CalendarNoteParamsConflictError);
	});

	test('ダイレクトのノートと純粋なリノートは、ノートを作る前にエラー', async () => {
		await expect(service.prepare(ME, { calendarEvent: EVENT_INPUT, note: { ...NOTE_PARAMS, visibility: 'specified' } }))
			.rejects.toBeInstanceOf(CalendarNoteNotLinkableError);
		await expect(service.prepare(ME, { calendarEventId: 'event1', note: { ...NOTE_PARAMS, renoteId: 'r', text: undefined } }))
			.rejects.toBeInstanceOf(CalendarNoteNotLinkableError);
		expect(calendarEventService.findByIdOrFail).not.toHaveBeenCalled();
	});

	describe('イベントを作る (calendarEvent)', () => {
		test('入力が仕様に合わなければ、ノートを作る前にエラー', async () => {
			await expect(service.prepare(ME, { calendarEvent: { ...EVENT_INPUT, startTime: null }, note: NOTE_PARAMS }))
				.rejects.toBeInstanceOf(CalendarEventValidationError);
		});

		test('ノートを作った後に、そのノートを告知のノートにしてイベントを作る。説明を省略するとノートの本文になる', async () => {
			const hook = await service.prepare(ME, { calendarEvent: EVENT_INPUT, note: NOTE_PARAMS });
			expect(calendarEventService.create).not.toHaveBeenCalled();

			const note = createdNote();
			await hook!(note);
			expect(calendarEventService.create).toHaveBeenCalledWith(ME, { ...EVENT_INPUT, description: '今週もボドゲやります' }, { announcementNote: note });
		});

		test('説明を指定したとき (null を含む) はノートの本文を使わない', async () => {
			const hook = await service.prepare(ME, { calendarEvent: { ...EVENT_INPUT, description: null }, note: NOTE_PARAMS });
			await hook!(createdNote());
			expect(calendarEventService.create.mock.calls[0][1].description).toBeNull();
		});

		test('CW 付きのノートの本文は説明にしない', async () => {
			const hook = await service.prepare(ME, { calendarEvent: EVENT_INPUT, note: { ...NOTE_PARAMS, cw: 'ネタバレ' } });
			await hook!(createdNote({ cw: 'ネタバレ' }));
			expect(calendarEventService.create.mock.calls[0][1].description).toBeNull();
		});

		test('ノートの本文が説明の上限を超えると、ノートを作る前にエラー', async () => {
			await expect(service.prepare(ME, { calendarEvent: EVENT_INPUT, note: { ...NOTE_PARAMS, text: 'あ'.repeat(3001) } }))
				.rejects.toBeInstanceOf(CalendarEventValidationError);
		});

		test('イベントの作成に失敗しても例外を投げない (ノートは残す)', async () => {
			calendarEventService.create.mockRejectedValueOnce(new Error('db down'));
			const hook = await service.prepare(ME, { calendarEvent: EVENT_INPUT, note: NOTE_PARAMS });
			await expect(hook!(createdNote())).resolves.toBeUndefined();
			expect(warn).toHaveBeenCalledOnce();
		});
	});

	describe('既存のイベントに紐づける (calendarEventId)', () => {
		test('イベントが無ければ、ノートを作る前にエラー', async () => {
			calendarEventService.findByIdOrFail.mockRejectedValueOnce(new CalendarEventNotFoundError());
			await expect(service.prepare(ME, { calendarEventId: 'missing', note: NOTE_PARAMS }))
				.rejects.toBeInstanceOf(CalendarEventNotFoundError);
		});

		test('中止したイベントには紐づけられない', async () => {
			calendarEventService.findByIdOrFail.mockResolvedValueOnce(event({ canceledAt: new Date() }));
			await expect(service.prepare(ME, { calendarEventId: 'event1', note: NOTE_PARAMS }))
				.rejects.toBeInstanceOf(CalendarEventCanceledError);
		});

		test('ノートを作った後に紐づける', async () => {
			const hook = await service.prepare(ME, { calendarEventId: 'event1', note: NOTE_PARAMS });
			expect(calendarEventService.linkNote).not.toHaveBeenCalled();

			const note = createdNote();
			await hook!(note);
			expect(calendarEventService.linkNote).toHaveBeenCalledWith(note, 'event1', ME);
		});

		test('保存したノートが紐づけられない種類なら、紐づけずに例外も投げない', async () => {
			const hook = await service.prepare(ME, { calendarEventId: 'event1', note: NOTE_PARAMS });
			await expect(hook!(createdNote({ visibility: 'specified' }))).resolves.toBeUndefined();
			expect(calendarEventService.linkNote).not.toHaveBeenCalled();
			expect(warn).toHaveBeenCalledOnce();
		});

		test('紐づけに失敗しても例外を投げない', async () => {
			calendarEventService.linkNote.mockRejectedValueOnce(new CalendarEventNotFoundError());
			const hook = await service.prepare(ME, { calendarEventId: 'event1', note: NOTE_PARAMS });
			await expect(hook!(createdNote())).resolves.toBeUndefined();
			expect(warn).toHaveBeenCalledOnce();
		});
	});
});
