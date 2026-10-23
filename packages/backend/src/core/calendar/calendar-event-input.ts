/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as mfm from 'mfm-js';
import { normalizeForSearch } from '@/misc/normalize-for-search.js';
import { CalendarEventValidationError } from './calendar-errors.js';
import { resolveCalendarEventSchedule } from './calendar-time.js';
import type { CalendarEventSchedule, CalendarEventScheduleInput } from './calendar-time.js';

// 長さはコードポイントの数で数える (API の JSON Schema の maxLength と同じ数え方)
export const CALENDAR_EVENT_TITLE_MAX_LENGTH = 100;
export const CALENDAR_EVENT_LOCATION_MAX_LENGTH = 128;
export const CALENDAR_EVENT_DESCRIPTION_MAX_LENGTH = 3000;
export const CALENDAR_EVENT_HASHTAG_MAX_LENGTH = 128;

export type CalendarEventInput = CalendarEventScheduleInput & {
	title: string;
	location?: string | null;
	description?: string | null;
	/** 先頭の # はあっても無くてもよい */
	hashtag?: string | null;
};

export type NormalizedCalendarEventInput = CalendarEventSchedule & {
	title: string;
	location: string | null;
	description: string | null;
	hashtag: string | null;
};

function codePointLength(value: string): number {
	return [...value].length;
}

/** 前後の空白を除き、空なら null にする */
function optionalText(value: string | null | undefined): string | null {
	if (value == null) return null;
	const trimmed = value.trim();
	return trimmed === '' ? null : trimmed;
}

/**
 * イベントのハッシュタグを保存する形にする。
 * 先頭の # (全角を含む) を除き、ノートのハッシュタグと同じく MFM のハッシュタグとして読めるものだけを受け付け、
 * normalizeForSearch (NFKC + 小文字) で正規化する。空なら null
 * @throws CalendarEventValidationError (invalidHashtag / hashtagTooLong)
 */
export function normalizeCalendarHashtag(value: string | null | undefined): string | null {
	const text = optionalText(value);
	if (text == null) return null;
	const tag = text.replace(/^[#＃]/, '');
	if (tag === '') return null;

	// ノートの本文に「#タグ」と書いたときにハッシュタグ全体として読まれるものだけを許す
	const nodes = mfm.parse(`#${tag}`);
	if (nodes.length !== 1 || nodes[0].type !== 'hashtag' || nodes[0].props.hashtag !== tag) {
		throw new CalendarEventValidationError('invalidHashtag');
	}

	const normalized = normalizeForSearch(tag);
	if (codePointLength(normalized) > CALENDAR_EVENT_HASHTAG_MAX_LENGTH) {
		throw new CalendarEventValidationError('hashtagTooLong');
	}
	return normalized;
}

/**
 * イベントの入力を検証し、保存する形にする
 * @throws CalendarEventValidationError
 */
export function normalizeCalendarEventInput(input: CalendarEventInput): NormalizedCalendarEventInput {
	const title = optionalText(input.title);
	if (title == null) throw new CalendarEventValidationError('titleRequired');
	if (codePointLength(title) > CALENDAR_EVENT_TITLE_MAX_LENGTH) throw new CalendarEventValidationError('titleTooLong');

	const location = optionalText(input.location);
	if (location != null && codePointLength(location) > CALENDAR_EVENT_LOCATION_MAX_LENGTH) {
		throw new CalendarEventValidationError('locationTooLong');
	}

	const description = optionalText(input.description);
	if (description != null && codePointLength(description) > CALENDAR_EVENT_DESCRIPTION_MAX_LENGTH) {
		throw new CalendarEventValidationError('descriptionTooLong');
	}

	const hashtag = normalizeCalendarHashtag(input.hashtag);
	const schedule = resolveCalendarEventSchedule(input);

	return {
		title,
		location,
		description,
		hashtag,
		...schedule,
	};
}
