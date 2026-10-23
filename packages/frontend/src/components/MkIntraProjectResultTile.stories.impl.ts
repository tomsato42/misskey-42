/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable import/no-default-export */
import MkIntraProjectResultTile from './MkIntraProjectResultTile.vue';
import type { StoryObj } from '@storybook/vue3';
export const Default = {
	render(args) {
		return {
			components: {
				MkIntraProjectResultTile,
			},
			setup() {
				return {
					args,
				};
			},
			template: '<MkIntraProjectResultTile v-bind="args" />',
		};
	},
	args: {
		finalMark: 125,
		validated: true,
	},
	parameters: {
		layout: 'centered',
	},
} satisfies StoryObj<typeof MkIntraProjectResultTile>;
export const Fail = {
	...Default,
	args: {
		finalMark: 0,
		validated: false,
	},
} satisfies StoryObj<typeof MkIntraProjectResultTile>;
export const Small = {
	...Default,
	args: {
		...Default.args,
		small: true,
	},
} satisfies StoryObj<typeof MkIntraProjectResultTile>;
