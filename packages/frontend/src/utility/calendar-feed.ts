/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// カレンダー配信 (.ics) の URL を、カレンダーアプリで開くリンクにする

/** https:// (または http://) の URL を webcal:// にする。Apple カレンダーや Outlook は webcal:// のリンクで購読を始める */
export function toWebcalUrl(url: string): string {
	return url.replace(/^https?:\/\//i, 'webcal://');
}

/**
 * Google カレンダーで「URL で追加」を開くリンク。
 * Google は公式に文書化していないが、render?cid= に webcal:// の URL をエンコードして渡す形が広く使われている
 */
export function buildGoogleCalendarSubscribeUrl(url: string): string {
	return `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(toWebcalUrl(url))}`;
}
