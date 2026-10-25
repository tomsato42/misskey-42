/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { EmojiTagSuggestionService } from '@/core/emoji-tagging/EmojiTagSuggestionService.js';
import { emojiTaggingApiErrors, withEmojiTaggingApiErrors } from '@/server/api/emoji-tagging-errors.js';

export const meta = {
	tags: ['admin'],

	description: 'Check that the Claude API key and model in the server settings can be used for suggesting emoji tags. No tokens are used.',

	requireCredential: true,
	requireAdmin: true,
	kind: 'write:admin:emoji',

	limit: {
		duration: 1000 * 60,
		max: 10,
	},

	errors: {
		notConfigured: emojiTaggingApiErrors.notConfigured,
		invalidApiKey: emojiTaggingApiErrors.invalidApiKey,
		rateLimited: emojiTaggingApiErrors.rateLimited,
		failed: emojiTaggingApiErrors.failed,
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private emojiTagSuggestionService: EmojiTagSuggestionService,
	) {
		super(meta, paramDef, async () => {
			await withEmojiTaggingApiErrors(() => this.emojiTagSuggestionService.testConnection());
		});
	}
}
