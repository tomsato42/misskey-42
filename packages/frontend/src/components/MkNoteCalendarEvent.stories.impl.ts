/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable import/no-default-export */
import MkNoteCalendarEvent from './MkNoteCalendarEvent.vue';
import type { StoryObj } from '@storybook/vue3';
export const Default = {
	render(args) {
		return {
			components: {
				MkNoteCalendarEvent,
			},
			setup() {
				return {
					args,
				};
			},
			template: '<MkNoteCalendarEvent v-bind="args" />',
		};
	},
	args: {
		event: {
			id: '9x0000000a',
			title: 'ボードゲーム部 定例',
			date: '2026-10-20',
			startTime: '19:00',
			endTime: '21:00',
			isAllDay: false,
			startsAt: '2026-10-20T10:00:00.000Z',
			endsAt: '2026-10-20T12:00:00.000Z',
			location: '1F イベントスペース',
			visibility: 'public',
			isCanceled: false,
			subscribersCount: 21,
			isSubscribed: false,
		},
	},
	parameters: {
		layout: 'padded',
	},
} satisfies StoryObj<typeof MkNoteCalendarEvent>;
export const Subscribed = {
	...Default,
	args: {
		...Default.args,
		event: {
			...Default.args.event,
			isSubscribed: true,
		},
	},
} satisfies StoryObj<typeof MkNoteCalendarEvent>;
export const Canceled = {
	...Default,
	args: {
		...Default.args,
		event: {
			...Default.args.event,
			isCanceled: true,
		},
	},
} satisfies StoryObj<typeof MkNoteCalendarEvent>;
export const AllDay = {
	...Default,
	args: {
		...Default.args,
		event: {
			...Default.args.event,
			title: 'Exam',
			startTime: null,
			endTime: null,
			isAllDay: true,
			location: null,
		},
	},
} satisfies StoryObj<typeof MkNoteCalendarEvent>;
export const FollowersOnly = {
	...Default,
	args: {
		...Default.args,
		event: {
			...Default.args.event,
			visibility: 'followers',
		},
	},
} satisfies StoryObj<typeof MkNoteCalendarEvent>;
