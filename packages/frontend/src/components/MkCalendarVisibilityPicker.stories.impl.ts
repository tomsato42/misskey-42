/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable import/no-default-export */
import { action } from 'storybook/actions';
import MkCalendarVisibilityPicker from './MkCalendarVisibilityPicker.vue';
import type { StoryObj } from '@storybook/vue3';
export const Default = {
	render(args) {
		return {
			components: {
				MkCalendarVisibilityPicker,
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
						changeVisibility: action('changeVisibility'),
						closed: action('closed'),
					};
				},
			},
			template: '<MkCalendarVisibilityPicker v-bind="props" v-on="events" />',
		};
	},
	args: {
		currentVisibility: 'public',
	},
	parameters: {
		layout: 'centered',
	},
} satisfies StoryObj<typeof MkCalendarVisibilityPicker>;
export const Specified = {
	...Default,
	args: {
		currentVisibility: 'specified',
	},
} satisfies StoryObj<typeof MkCalendarVisibilityPicker>;
