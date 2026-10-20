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
	/** 42times: 付ける課題の結果のうち、どの提出か (チームの ID)。無ければ最後の提出 */
	initialIntraProjectTeamId?: number | null;
	/** 42times: 付ける 42 intra のレベルの初期値 (レベルが上がった通知の「投稿する」) */
	initialIntraLevel?: number | null;
	/**
	 * 42times: 編集するノート。あるときは本文と CW だけを書き換えて notes/update で保存する
	 * (ほかの props は渡さない。返信先・引用・チャンネル・公開範囲はこのノートのものを表示する)
	 */
	editNote?: Misskey.entities.Note | null;
	instant?: boolean;
};
