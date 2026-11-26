/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 投稿フォームの「イベントを告知」「イベントに紐づける」の判定 (i18n に依存させず、ユニットテストできるようにする)

import type { CalendarEventParams } from '@/utility/calendar-event-form.js';

/**
 * 投稿フォームでイベントを扱えない理由。
 * specified: 公開範囲がダイレクト、scheduled: 予約投稿 (予約投稿は下書きとして保存され、イベントの情報を保存できない)
 */
export type CalendarNoteFormUnavailableReason = 'specified' | 'scheduled';

export function getCalendarNoteFormUnavailableReason(ctx: {
	visibility: string;
	scheduledAt: number | null;
}): CalendarNoteFormUnavailableReason | null {
	if (ctx.visibility === 'specified') return 'specified';
	if (ctx.scheduledAt != null) return 'scheduled';
	return null;
}

/** backend の core/calendar/calendar-errors.ts の calendarNoteUnlinkableReasons と同じ */
export type CalendarNoteUnlinkableReason = 'specifiedVisibility' | 'pureRenote';

/**
 * notes/create に送るノートが、イベントに紐づけられない理由。紐づけられるなら null。
 * backend の core/calendar/calendar-note-link.ts の getCalendarNoteUnlinkableReason と同じ判定
 */
export function getCalendarNoteUnlinkableReason(note: {
	visibility: string;
	renoteId?: string | null;
	replyId?: string | null;
	text?: string | null;
	cw?: string | null;
	fileIds?: string[] | null;
	poll?: unknown;
}): CalendarNoteUnlinkableReason | null {
	if (note.visibility === 'specified') return 'specifiedVisibility';

	const isPureRenote = note.renoteId != null
		&& note.text == null
		&& note.cw == null
		&& note.replyId == null
		&& note.poll == null
		&& (note.fileIds == null || note.fileIds.length === 0);
	if (isPureRenote) return 'pureRenote';

	return null;
}

/** notes/create に足すイベントのパラメータ。告知と紐づけは同時に指定できないので、どちらか一方だけにする */
export type CalendarNoteParams = {
	calendarEvent?: CalendarEventParams;
	calendarEventId?: string;
};

export function buildCalendarNoteParams(ctx: {
	announce: CalendarEventParams | null;
	linkedEventId: string | null;
}): CalendarNoteParams {
	if (ctx.announce != null) return { calendarEvent: ctx.announce };
	if (ctx.linkedEventId != null) return { calendarEventId: ctx.linkedEventId };
	return {};
}
