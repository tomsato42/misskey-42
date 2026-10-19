/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable import/no-default-export */
import MkIntraLevel from './MkIntraLevel.vue';
import type { StoryObj } from '@storybook/vue3';
export const Default = {
	render(args) {
		return {
			components: {
				MkIntraLevel,
			},
			setup() {
				return {
					args,
				};
			},
			template: '<MkIntraLevel v-bind="args" />',
		};
	},
	args: {
		level: 7,
	},
	parameters: {
		layout: 'centered',
	},
} satisfies StoryObj<typeof MkIntraLevel>;
export const Removable = {
	...Default,
	args: {
		...Default.args,
		removable: true,
	},
} satisfies StoryObj<typeof MkIntraLevel>;
