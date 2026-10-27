/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { CalendarNoteNotLinkableError } from './calendar-errors.js';
import type { CalendarNoteUnlinkableReason } from './calendar-errors.js';
import type { MiNote } from '@/models/Note.js';

/**
 * 紐づけられるかの判定に使うノートの項目。投稿前のパラメータからも作れるように、MiNote の一部だけにしている
 */
export type CalendarLinkableNoteLike = {
	visibility: MiNote['visibility'] | string;
	renoteId: MiNote['renoteId'] | undefined;
	replyId: MiNote['replyId'] | undefined;
	text: MiNote['text'] | undefined;
	cw: MiNote['cw'] | undefined;
	fileIds: MiNote['fileIds'] | undefined;
	hasPoll: boolean;
};

/**
 * ノートをイベントに紐づけられない理由。紐づけられるなら null。
 * ダイレクトのノートはイベントのページで見られる人が限られ、純粋なリノートは元のノートを紐づければよいので、どちらも認めない。
 * 純粋なリノートの判定は misc/is-renote.ts の isRenote / isQuote と揃える
 */
export function getCalendarNoteUnlinkableReason(note: CalendarLinkableNoteLike): CalendarNoteUnlinkableReason | null {
	if (note.visibility === 'specified') return 'specifiedVisibility';

	const isPureRenote = note.renoteId != null
		&& note.text == null
		&& note.cw == null
		&& note.replyId == null
		&& !note.hasPoll
		&& (note.fileIds == null || note.fileIds.length === 0);
	if (isPureRenote) return 'pureRenote';

	return null;
}

/**
 * @throws CalendarNoteNotLinkableError
 */
export function assertCalendarLinkableNote(note: CalendarLinkableNoteLike): void {
	const reason = getCalendarNoteUnlinkableReason(note);
	if (reason != null) throw new CalendarNoteNotLinkableError(reason);
}
