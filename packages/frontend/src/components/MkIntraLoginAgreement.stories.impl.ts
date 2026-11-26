/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable import/no-default-export */
import MkIntraLoginAgreement from './MkIntraLoginAgreement.vue';
import type { StoryObj } from '@storybook/vue3';
export const Default = {
	render(args) {
		return {
			components: {
				MkIntraLoginAgreement,
			},
			setup() {
				return {
					args,
				};
			},
			template: '<MkIntraLoginAgreement v-bind="args" />',
		};
	},
	args: {
		tosUrl: 'https://example.com/terms.html',
		privacyPolicyUrl: 'https://example.com/privacy.html',
	},
	parameters: {
		layout: 'centered',
	},
} satisfies StoryObj<typeof MkIntraLoginAgreement>;
export const TosOnly = {
	...Default,
	args: {
		tosUrl: 'https://example.com/terms.html',
		privacyPolicyUrl: null,
	},
} satisfies StoryObj<typeof MkIntraLoginAgreement>;
