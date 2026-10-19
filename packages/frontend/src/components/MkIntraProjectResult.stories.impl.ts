/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable import/no-default-export */
import { action } from 'storybook/actions';
import { userLite } from '../../.storybook/fakes.js';
import MkIntraProjectResult from './MkIntraProjectResult.vue';
import type { StoryObj } from '@storybook/vue3';
export const Default = {
	render(args) {
		return {
			components: {
				MkIntraProjectResult,
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
						remove: action('remove'),
					};
				},
			},
			template: '<MkIntraProjectResult v-bind="props" v-on="events" />',
		};
	},
	args: {
		result: {
			projectSlug: 'webserv',
			projectName: 'webserv',
			finalMark: 125,
			validated: true,
			outstandingCount: 2,
			members: [
				{ login: 'tomsato', user: userLite('9x0000000a', 'tomsato', null, 'さとう') },
				{ login: 'hana', user: null },
			],
		},
	},
	parameters: {
		layout: 'padded',
	},
} satisfies StoryObj<typeof MkIntraProjectResult>;
export const Fail = {
	...Default,
	args: {
		result: {
			...Default.args.result,
			projectSlug: 'ft_irc',
			projectName: 'ft_irc',
			finalMark: 0,
			validated: false,
			outstandingCount: 0,
		},
	},
} satisfies StoryObj<typeof MkIntraProjectResult>;
export const Removable = {
	...Default,
	args: {
		...Default.args,
		removable: true,
	},
} satisfies StoryObj<typeof MkIntraProjectResult>;
