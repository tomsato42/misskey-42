/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * カレンダー機能のエラーの基底クラス。API では instanceof で種類を見分けて、対応する API エラーに変換する
 */
export class CalendarError extends Error {
	constructor(message?: string) {
		super(message);
		this.name = new.target.name;
	}
}

/** イベントが存在しない (削除済みを含む) */
export class CalendarEventNotFoundError extends CalendarError {}

/** 操作する権限が無い (作成者・ノートの作成者・モデレーター以上ではない) */
export class CalendarEventPermissionError extends CalendarError {}

/** 中止したイベントに対して、編集・中止・購読をしようとした */
export class CalendarEventCanceledError extends CalendarError {}

/** イベントの作成者は購読を解除できない */
export class CalendarEventCannotUnsubscribeOwnError extends CalendarError {}

/** ノートが既に別のイベントに紐づいている */
export class CalendarEventNoteAlreadyLinkedError extends CalendarError {}

/** ノートがどのイベントにも紐づいていない */
export class CalendarEventNoteNotLinkedError extends CalendarError {}

export const calendarNoteUnlinkableReasons = [
	/** 公開範囲が「指定ユーザー」(ダイレクト) */
	'specifiedVisibility',
	/** 本文などの無い純粋なリノート */
	'pureRenote',
] as const;
export type CalendarNoteUnlinkableReason = typeof calendarNoteUnlinkableReasons[number];

/** イベントに紐づけられない種類のノート。reason で理由を見分ける */
export class CalendarNoteNotLinkableError extends CalendarError {
	public readonly reason: CalendarNoteUnlinkableReason;

	constructor(reason: CalendarNoteUnlinkableReason) {
		super(reason);
		this.reason = reason;
	}
}

/** ノートの投稿で、既存のイベントへの紐づけ (calendarEventId) とイベントの作成 (calendarEvent) を同時に指定した */
export class CalendarNoteParamsConflictError extends CalendarError {}

export const calendarEventValidationReasons = [
	'titleRequired',
	'titleTooLong',
	'locationTooLong',
	'descriptionTooLong',
	'invalidHashtag',
	'hashtagTooLong',
	'invalidDate',
	'invalidStartTime',
	'invalidEndTime',
	'startTimeRequired',
	'endNotAfterStart',
	'endNotSameDay',
	'invalidMonth',
] as const;
export type CalendarEventValidationReason = typeof calendarEventValidationReasons[number];

/** 入力が仕様に合わない。reason で理由を見分ける */
export class CalendarEventValidationError extends CalendarError {
	public readonly reason: CalendarEventValidationReason;

	constructor(reason: CalendarEventValidationReason) {
		super(reason);
		this.reason = reason;
	}
}
