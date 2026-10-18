/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as Misskey from 'misskey-js';
import type { MenuItem } from '@/types/menu.js';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { formatCalendarScheduleAndLocation, getCalendarApiErrorMessage } from '@/utility/calendar-event-messages.js';

/** ピッカーに出すイベントの数 (calendar/events/upcoming の上限) */
const PICKER_LIMIT = 30;

/**
 * ノートに紐づけるイベントを選ぶメニューを開く。終わっていない今後のイベント (中止済みは除く) を日時順に出す。
 * 選んだらそのイベント、閉じたら null を返す
 */
export async function pickCalendarEventForNote(anchorElement: HTMLElement | EventTarget | null | undefined, currentEventId?: string | null): Promise<Misskey.entities.CalendarEventLite | null> {
	let events: Misskey.entities.CalendarEvent[];
	try {
		events = await misskeyApi('calendar/events/upcoming', { limit: PICKER_LIMIT, filter: 'all' });
	} catch (err) {
		os.alert({ type: 'error', ...getCalendarApiErrorMessage(err) });
		return null;
	}

	let picked: Misskey.entities.CalendarEventLite | null = null;

	const items: MenuItem[] = [{
		type: 'label',
		text: i18n.ts._calendar.eventToLink,
	}];
	if (events.length === 0) {
		items.push({
			type: 'label',
			text: i18n.ts._calendar.noUpcomingEvents,
		});
	}
	for (const event of events) {
		if (event.isCanceled) continue;
		items.push({
			type: 'button',
			icon: event.isSubscribed ? 'ti ti-bell-ringing' : 'ti ti-calendar-event',
			text: event.title,
			caption: formatCalendarScheduleAndLocation(event),
			active: event.id === currentEventId,
			action: () => {
				picked = event;
			},
		});
	}

	await os.popupMenu(items, anchorElement);
	return picked;
}
