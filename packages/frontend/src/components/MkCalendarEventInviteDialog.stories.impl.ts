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
import MkCalendarEventInviteDialog from './MkCalendarEventInviteDialog.vue';
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

const following = [
	userLite('user1', 'kmiura', null, 'みうら'),
	userLite('user2', 'yito', null, 'いとう'),
	userLite('user3', 'hokada', null, 'おかだ'),
	userLite('user4', 'mhayashi', null, 'はやし'),
];

const statuses: Record<string, string> = {
	user1: 'invitable',
	user2: 'invited',
	user3: 'unavailable',
	user4: 'subscribed',
};

const handlers = [
	...commonHandlers,
	http.post('/api/users/following', () => HttpResponse.json(following.map((followee, i) => ({
		id: `following${i}`,
		createdAt: '2026-10-01T00:00:00.000Z',
		followeeId: followee.id,
		followerId: 'someuserid',
		followee,
	})))),
	http.post('/api/users/search', () => HttpResponse.json(following.slice(0, 1))),
	http.post('/api/calendar/events/invitation-statuses', async ({ request }) => {
		const body = await request.json() as { userIds: string[] };
		return HttpResponse.json(body.userIds.map(userId => ({ userId, status: statuses[userId] ?? 'invitable' })));
	}),
	http.post('/api/users/lists/list', () => HttpResponse.json([
		{ id: 'list1', createdAt: '2026-10-01T00:00:00.000Z', name: 'C++ 勉強会', userIds: ['user1', 'user2', 'user3'], isPublic: false },
	])),
	http.post('/api/calendar/events/invite', async ({ request }) => {
		action('POST /api/calendar/events/invite')(await request.json());
		return HttpResponse.json({ invited: 1, subscribed: 0, alreadyInvited: 1, unavailable: 1 });
	}),
];

export const Default = {
	render(args) {
		return {
			components: {
				MkCalendarEventInviteDialog,
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
						done: action('done'),
						closed: action('closed'),
					};
				},
			},
			template: '<MkCalendarEventInviteDialog v-bind="props" v-on="events" />',
		};
	},
	args: {
		event: calendarEvent(),
	},
	parameters: {
		layout: 'centered',
		msw: {
			handlers,
		},
	},
} satisfies StoryObj<typeof MkCalendarEventInviteDialog>;
export const FollowersOnly = {
	...Default,
	args: {
		event: calendarEvent({ visibility: 'followers' }),
	},
} satisfies StoryObj<typeof MkCalendarEventInviteDialog>;
