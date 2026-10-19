/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as Misskey from 'misskey-js';

export interface PostFormProps {
	reply?: Misskey.entities.Note | null;
	renote?: Misskey.entities.Note | null;
	channel?: {
		id: string;
		name: string;
		color: string;
		isSensitive: boolean;
		allowRenoteToExternal: boolean;
		userId: string | null;
	} | null;
	mention?: Misskey.entities.User;
	specified?: Misskey.entities.UserDetailed;
	initialText?: string;
	initialCw?: string;
	initialVisibility?: (typeof Misskey.noteVisibilities)[number];
	initialFiles?: Misskey.entities.DriveFile[];
	initialLocalOnly?: boolean;
	initialVisibleUsers?: Misskey.entities.UserDetailed[];
	initialNote?: Misskey.entities.Note;
	/** 42times: 紐づけるイベントの初期値 (イベントページの「#○○ で投稿する」など)。中止済みのイベントは無視する */
	initialCalendarEvent?: Misskey.entities.CalendarEventLite | null;
	/** 42times: 付ける課題の結果 (点数を共有) の初期値 */
	initialIntraProjectResult?: Misskey.entities.IntraProjectResult | null;
	instant?: boolean;
};
