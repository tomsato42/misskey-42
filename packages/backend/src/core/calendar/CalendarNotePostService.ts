/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import type { MiUser } from '@/models/User.js';
import type { MiNote } from '@/models/Note.js';
import type { MiCalendarEvent } from '@/models/CalendarEvent.js';
import { LoggerService } from '@/core/LoggerService.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { CalendarEventService } from './CalendarEventService.js';
import { CalendarEventCanceledError, CalendarEventRateLimitError, CalendarNoteParamsConflictError } from './calendar-errors.js';
import { normalizeCalendarEventInput } from './calendar-event-input.js';
import { CALENDAR_EVENT_CREATE_LIMIT } from './calendar-limits.js';
import { assertCalendarLinkableNote } from './calendar-note-link.js';
import type { CalendarEventInput } from './calendar-event-input.js';
import type { CalendarLinkableNoteLike } from './calendar-note-link.js';

type Me = { id: MiUser['id'] };

export type CalendarNotePostParams = {
	/** 既存のイベントに紐づける */
	calendarEventId?: MiCalendarEvent['id'] | null;
	/** 投稿しながらイベントを作る */
	calendarEvent?: CalendarEventInput | null;
	/** 投稿するノートの内容 (notes/create のパラメータから作る) */
	note: CalendarLinkableNoteLike;
};

/** ノートを保存した直後に呼ぶ処理 */
export type CalendarNotePostHook = (note: MiNote) => Promise<void>;

/**
 * ノートの投稿 (notes/create) とカレンダーのイベントの連携
 */
@Injectable()
export class CalendarNotePostService {
	private logger: Logger;

	constructor(
		private calendarEventService: CalendarEventService,
		private loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger('calendar');
	}

	/**
	 * 投稿の前に、イベントの指定を確かめる。イベントの指定が無ければ null を返す。
	 * 返した関数はノートを保存した直後に呼ぶ (イベントを作る・紐づける)
	 *
	 * イベントの説明を省略して作るときは、ノートの本文を説明にする (CW 付きのノートは本文を隠しているので使わない)
	 * @throws CalendarNoteParamsConflictError calendarEventId と calendarEvent を同時に指定した
	 * @throws CalendarNoteNotLinkableError 紐づけられない種類のノート
	 * @throws CalendarEventValidationError イベントの入力が仕様に合わない
	 * @throws CalendarEventRateLimitError イベントを作る数の上限に達している
	 * @throws CalendarEventNotFoundError 紐づけるイベントが存在しない
	 * @throws CalendarEventCanceledError 紐づけるイベントが中止されている
	 */
	@bindThis
	public async prepare(me: Me, params: CalendarNotePostParams): Promise<CalendarNotePostHook | null> {
		const { calendarEventId, calendarEvent, note } = params;
		if (calendarEventId == null && calendarEvent == null) return null;
		if (calendarEventId != null && calendarEvent != null) throw new CalendarNoteParamsConflictError();

		assertCalendarLinkableNote(note);

		if (calendarEvent != null) {
			const input: CalendarEventInput = {
				...calendarEvent,
				description: calendarEvent.description !== undefined
					? calendarEvent.description
					: (note.cw == null ? note.text ?? null : null),
			};
			// ノートを作る前に検証だけしておく (イベントは作った後のノートを告知のノートにして作る)
			normalizeCalendarEventInput(input);
			await this.assertCanCreateEvent(me);
			return async createdNote => {
				await this.runAfterNoteCreated(createdNote, 'create', async () => {
					await this.calendarEventService.create(me, input, { announcementNote: createdNote });
				});
			};
		}

		const event = await this.calendarEventService.findByIdOrFail(calendarEventId!);
		if (event.canceledAt != null) throw new CalendarEventCanceledError();
		return async createdNote => {
			await this.runAfterNoteCreated(createdNote, 'link', async () => {
				// 投稿の処理で公開範囲などが変わることがあるので、保存したノートで確かめ直す
				assertCalendarLinkableNote(createdNote);
				await this.calendarEventService.linkNote(createdNote, event.id, me);
			});
		};
	}

	/**
	 * calendar/events/create のレート制限と同じ上限 (1時間あたりの作成数) を、作ったイベントの数で確かめる
	 * @throws CalendarEventRateLimitError 上限に達している
	 */
	@bindThis
	private async assertCanCreateEvent(me: Me): Promise<void> {
		const { duration, max } = CALENDAR_EVENT_CREATE_LIMIT;
		const createdDates = await this.calendarEventService.getCreatedDatesSince(me, new Date(Date.now() - duration), max);
		if (createdDates.length >= max) {
			// 新しい順なので、上限の件数目が期間から外れると作れるようになる
			throw new CalendarEventRateLimitError(createdDates[max - 1].getTime() + duration);
		}
	}

	/**
	 * ノートは保存済みなので、イベントの処理に失敗してもノートは残し、投稿の後処理 (配信など) を続ける。
	 * 失敗するのは検証の後にイベントが削除された場合や DB の障害などで、返り値のノートに calendarEvent が付かないことで分かる
	 */
	@bindThis
	private async runAfterNoteCreated(note: MiNote, action: 'create' | 'link', fn: () => Promise<void>): Promise<void> {
		try {
			await fn();
		} catch (err) {
			this.logger.warn(`Failed to ${action} calendar event for note ${note.id}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
}
