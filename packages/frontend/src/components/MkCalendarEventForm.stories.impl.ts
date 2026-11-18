/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable import/no-default-export */
import { ref } from 'vue';
import { action } from 'storybook/actions';
import { userLite } from '../../.storybook/fakes.js';
import MkCalendarEventForm from './MkCalendarEventForm.vue';
import type { StoryObj } from '@storybook/vue3';
export const Default = {
	render(args) {
		return {
			components: {
				MkCalendarEventForm,
			},
			setup() {
				const form = ref(args.modelValue);
				return {
					args,
					form,
				};
			},
			computed: {
				props() {
					const { modelValue, ...rest } = this.args;
					return rest;
				},
				events() {
					return {
						'update:modelValue': action('update:modelValue'),
					};
				},
			},
			template: '<MkCalendarEventForm v-model="form" v-bind="props" v-on="events" />',
		};
	},
	args: {
		modelValue: {
			title: 'もくもく会',
			date: '2026-10-20',
			startTime: '12:00',
			endTime: '15:00',
			isAllDay: false,
			location: 'c3',
			hashtag: 'mokumoku',
			description: 'みんなで黙々と課題を進める会です。途中参加・途中退出OK。',
			visibility: 'public',
			visibleUsers: [],
			userListId: null,
		},
	},
	parameters: {
		layout: 'padded',
	},
} satisfies StoryObj<typeof MkCalendarEventForm>;
export const AllDay = {
	...Default,
	args: {
		...Default.args,
		modelValue: {
			...Default.args.modelValue,
			title: 'Exam',
			startTime: '',
			endTime: '',
			isAllDay: true,
			location: '',
			hashtag: '',
			description: '',
		},
	},
} satisfies StoryObj<typeof MkCalendarEventForm>;
export const WithErrors = {
	...Default,
	args: {
		...Default.args,
		modelValue: {
			...Default.args.modelValue,
			title: '',
			endTime: '11:00',
			hashtag: 'a b',
		},
		errors: {
			title: 'titleRequired',
			endTime: 'endNotAfterStart',
			hashtag: 'invalidHashtag',
		},
	},
} satisfies StoryObj<typeof MkCalendarEventForm>;
export const WithoutDescription = {
	...Default,
	args: {
		...Default.args,
		withDescription: false,
	},
} satisfies StoryObj<typeof MkCalendarEventForm>;
export const SpecifiedUsers = {
	...Default,
	args: {
		...Default.args,
		modelValue: {
			...Default.args.modelValue,
			visibility: 'specified',
			visibleUsers: [userLite('user1', 'alice', null, 'Alice'), userLite('user2', 'bob', null, 'Bob')],
		},
	},
} satisfies StoryObj<typeof MkCalendarEventForm>;
export const SpecifiedUsersRequired = {
	...Default,
	args: {
		...Default.args,
		modelValue: {
			...Default.args.modelValue,
			visibility: 'specified',
		},
		errors: {
			visibility: 'visibleUsersRequired',
		},
	},
} satisfies StoryObj<typeof MkCalendarEventForm>;
