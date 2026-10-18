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
import MkCalendarEventEditDialog from './MkCalendarEventEditDialog.vue';
import type { entities } from 'misskey-js';
import type { StoryObj } from '@storybook/vue3';

function calendarEvent(): entities.CalendarEvent {
	return {
		id: 'somecalendareventid',
		createdAt: '2026-10-18T00:00:00.000Z',
		updatedAt: null,
		userId: 'someuserid',
		user: userLite(),
		title: 'もくもく会',
		date: '2026-10-20',
		startTime: '12:00',
		endTime: '15:00',
		isAllDay: false,
		startsAt: '2026-10-20T03:00:00.000Z',
		endsAt: '2026-10-20T06:00:00.000Z',
		location: 'c3',
		description: 'みんなで黙々と課題を進める会です。',
		hashtag: 'mokumoku',
		isCanceled: false,
		canceledAt: null,
		announcementNoteId: null,
		subscribersCount: 8,
		isSubscribed: true,
		canManage: true,
	};
}

export const Default = {
	render(args) {
		return {
			components: {
				MkCalendarEventEditDialog,
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
						'done': action('done'),
						'closed': action('closed'),
					};
				},
			},
			template: '<MkCalendarEventEditDialog v-bind="props" v-on="events" />',
		};
	},
	args: {
		initialDate: '2026-10-20',
	},
	parameters: {
		layout: 'centered',
		msw: {
			handlers: [
				...commonHandlers,
				http.post('/api/calendar/events/create', async ({ request }) => {
					action('POST /api/calendar/events/create')(await request.json());
					return HttpResponse.json(calendarEvent());
				}),
			],
		},
	},
} satisfies StoryObj<typeof MkCalendarEventEditDialog>;
export const Edit = {
	...Default,
	args: {
		event: calendarEvent(),
	},
	parameters: {
		...Default.parameters,
		msw: {
			handlers: [
				...commonHandlers,
				http.post('/api/calendar/events/update', async ({ request }) => {
					action('POST /api/calendar/events/update')(await request.json());
					return HttpResponse.json(calendarEvent());
				}),
			],
		},
	},
} satisfies StoryObj<typeof MkCalendarEventEditDialog>;
