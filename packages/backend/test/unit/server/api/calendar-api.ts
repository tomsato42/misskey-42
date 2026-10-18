/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { calendarNoteCreateErrorMap, calendarNoteCreateErrors, toCalendarApiError } from '@/server/api/calendar-api.js';
import { ApiError } from '@/server/api/error.js';
import {
	CalendarEventCanceledError,
	CalendarEventNotFoundError,
	CalendarEventPermissionError,
	CalendarEventValidationError,
	CalendarNoteNotLinkableError,
	CalendarNoteParamsConflictError,
} from '@/core/calendar/calendar-errors.js';

const NOT_FOUND = { message: 'No such calendar event.', code: 'NO_SUCH_CALENDAR_EVENT', id: '00000000-0000-4000-8000-000000000001' };
const INVALID = { message: 'Invalid calendar event.', code: 'INVALID_CALENDAR_EVENT', id: '00000000-0000-4000-8000-000000000002' };

describe('toCalendarApiError', () => {
	test('対応する API エラーに変える', () => {
		const err = toCalendarApiError(new CalendarEventNotFoundError(), { notFound: NOT_FOUND });
		expect(err).toBeInstanceOf(ApiError);
		expect((err as ApiError).id).toBe(NOT_FOUND.id);
		expect((err as ApiError).code).toBe('NO_SUCH_CALENDAR_EVENT');
	});

	test('検証エラーは理由を info.reason に入れる', () => {
		const err = toCalendarApiError(new CalendarEventValidationError('endNotAfterStart'), { validation: INVALID }) as ApiError;
		expect(err.id).toBe(INVALID.id);
		expect(err.info).toEqual({ reason: 'endNotAfterStart' });
	});

	test('対応が無いカレンダーのエラーと、ほかのエラーはそのまま返す', () => {
		const permission = new CalendarEventPermissionError();
		expect(toCalendarApiError(permission, { notFound: NOT_FOUND })).toBe(permission);
		const other = new Error('db down');
		expect(toCalendarApiError(other, { notFound: NOT_FOUND })).toBe(other);
	});

	test('notes/create のエラーの対応', () => {
		const cases: [Error, { id: string }][] = [
			[new CalendarEventNotFoundError(), calendarNoteCreateErrors.noSuchCalendarEvent],
			[new CalendarEventCanceledError(), calendarNoteCreateErrors.calendarEventCanceled],
			[new CalendarEventValidationError('titleRequired'), calendarNoteCreateErrors.invalidCalendarEvent],
			[new CalendarNoteNotLinkableError('pureRenote'), calendarNoteCreateErrors.cannotLinkNoteToCalendarEvent],
			[new CalendarNoteParamsConflictError(), calendarNoteCreateErrors.calendarEventParamsConflict],
		];
		for (const [source, expected] of cases) {
			expect((toCalendarApiError(source, calendarNoteCreateErrorMap) as ApiError).id, source.name).toBe(expected.id);
		}
		expect((toCalendarApiError(new CalendarNoteNotLinkableError('pureRenote'), calendarNoteCreateErrorMap) as ApiError).info).toEqual({ reason: 'pureRenote' });
	});
});
