/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable import/no-default-export */
import { HttpResponse, http } from 'msw';
import { action } from 'storybook/actions';
import { userLite } from '../../.storybook/fakes.js';
import { commonHandlers } from '../../.storybook/mocks.js';
import MkCalendarEventSubscribersDialog from './MkCalendarEventSubscribersDialog.vue';
import type { entities } from 'misskey-js';
import type { StoryObj } from '@storybook/vue3';

function calendarEvent(overrides: Partial<entities.CalendarEvent> = {}): entities.CalendarEvent {
	return {
		id: 'somecalendareventid',
		createdAt: '2026-10-18T00:00:00.000Z',
		updatedAt: null,
		userId: 'someuserid',
		user: userLite(),
		title: 'ft_transcendence 勉強会',
		date: '2026-10-21',
		startTime: '19:00',
		endTime: '21:00',
		isAllDay: false,
		startsAt: '2026-10-21T10:00:00.000Z',
		endsAt: '2026-10-21T12:00:00.000Z',
		location: '3F セミナールーム',
		description: null,
		hashtag: null,
		visibility: 'public',
		isCanceled: false,
		canceledAt: null,
		announcementNoteId: null,
		subscribersCount: 4,
		isSubscribed: true,
		canManage: false,
		...overrides,
	};
}

const subscribers = [
	{ id: 'sub3', createdAt: '2026-10-19T00:00:00.000Z', user: userLite('user3', 'snakamura', null, 'なかむー') },
	{ id: 'sub2', createdAt: '2026-10-18T12:00:00.000Z', user: userLite('user2', 'aoki', null, 'あおき') },
	{ id: 'sub1', createdAt: '2026-10-18T06:00:00.000Z', user: userLite('user1', 'mhayashi', null, 'はやし') },
];

export const Default = {
	render(args) {
		return {
			components: {
				MkCalendarEventSubscribersDialog,
			},
			setup() {
				return {
					args,
				};
			},
			computed: {
				props() {
					return {
						...this.args,
					};
				},
				events() {
					return {
						closed: action('closed'),
					};
				},
			},
			template: '<MkCalendarEventSubscribersDialog v-bind="props" v-on="events" />',
		};
	},
	args: {
		event: calendarEvent(),
	},
	parameters: {
		layout: 'centered',
		msw: {
			handlers: [
				...commonHandlers,
				http.post('/api/calendar/events/subscribers', async ({ request }) => {
					const body = await request.json() as { untilId?: string };
					if (body.untilId != null) return HttpResponse.json([]);
					return HttpResponse.json(subscribers);
				}),
			],
		},
	},
} satisfies StoryObj<typeof MkCalendarEventSubscribersDialog>;
export const Empty = {
	...Default,
	args: {
		event: calendarEvent({ subscribersCount: 1 }),
	},
	parameters: {
		...Default.parameters,
		msw: {
			handlers: [
				...commonHandlers,
				http.post('/api/calendar/events/subscribers', () => HttpResponse.json([])),
			],
		},
	},
} satisfies StoryObj<typeof MkCalendarEventSubscribersDialog>;
