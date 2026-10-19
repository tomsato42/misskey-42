/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable import/no-default-export */
import MkIntraProjectResultStars from './MkIntraProjectResultStars.vue';
import type { StoryObj } from '@storybook/vue3';
export const Default = {
	render(args) {
		return {
			components: {
				MkIntraProjectResultStars,
			},
			setup() {
				return {
					args,
				};
			},
			template: '<MkIntraProjectResultStars v-bind="args" />',
		};
	},
	args: {
		count: 2,
	},
	parameters: {
		layout: 'centered',
	},
} satisfies StoryObj<typeof MkIntraProjectResultStars>;
export const Many = {
	...Default,
	args: {
		count: 7,
	},
} satisfies StoryObj<typeof MkIntraProjectResultStars>;
