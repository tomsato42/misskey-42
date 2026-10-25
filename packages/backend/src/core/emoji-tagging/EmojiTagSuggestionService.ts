/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { DI } from '@/di-symbols.js';
import type { MiMeta } from '@/models/Meta.js';
import { DownloadService } from '@/core/DownloadService.js';
import { ImageProcessingService } from '@/core/ImageProcessingService.js';
import { LoggerService } from '@/core/LoggerService.js';
import { createTemp } from '@/misc/create-temp.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import {
	EMOJI_TAGGING_IMAGE_SIZE,
	EMOJI_TAGGING_SYSTEM_PROMPT,
	EMOJI_TAGS_SCHEMA,
	buildCategoryListPrompt,
	buildEmojiTaggingPrompt,
	normalizeSuggestedCategory,
	normalizeSuggestedTags,
	toEmojiTaggingModel,
} from './emoji-tagging.js';
import type { EmojiTaggingRequest, SuggestedCategory } from './emoji-tagging.js';

export type EmojiTaggingErrorCode =
	| 'NOT_CONFIGURED'
	| 'FAILED_TO_LOAD_IMAGE'
	| 'INVALID_API_KEY'
	| 'RATE_LIMITED'
	| 'REFUSED'
	| 'FAILED';

export class EmojiTaggingError extends Error {
	constructor(public readonly code: EmojiTaggingErrorCode, message: string) {
		super(message);
		this.name = 'EmojiTaggingError';
	}
}

@Injectable()
export class EmojiTagSuggestionService {
	private logger: Logger;
	private client: { apiKey: string; anthropic: Anthropic } | null = null;

	constructor(
		@Inject(DI.meta)
		private meta: MiMeta,

		private downloadService: DownloadService,
		private imageProcessingService: ImageProcessingService,
		private loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger('emoji-tagging');
	}

	/**
	 * API キーが変わったときだけクライアントを作り直す
	 */
	@bindThis
	private getClient(): Anthropic {
		const apiKey = this.meta.anthropicApiKey;
		if (apiKey == null || apiKey === '') throw new EmojiTaggingError('NOT_CONFIGURED', 'The Claude API key is not set.');
		if (this.client?.apiKey !== apiKey) {
			this.client = { apiKey, anthropic: new Anthropic({ apiKey, timeout: 60 * 1000, maxRetries: 2 }) };
		}
		return this.client.anthropic;
	}

	/**
	 * API キーとモデルが使えるかを確かめる。モデルの情報を取るだけなので費用はかからない
	 */
	@bindThis
	public async testConnection(): Promise<void> {
		const anthropic = this.getClient();
		try {
			await anthropic.models.retrieve(toEmojiTaggingModel(this.meta.anthropicModel));
		} catch (err) {
			throw this.toTaggingError(err);
		}
	}

	@bindThis
	private toTaggingError(err: unknown): unknown {
		if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
			return new EmojiTaggingError('INVALID_API_KEY', 'The Claude API key was rejected.');
		}
		if (err instanceof Anthropic.RateLimitError) {
			return new EmojiTaggingError('RATE_LIMITED', 'The Claude API rate limit was reached.');
		}
		if (err instanceof Anthropic.APIError) {
			this.logger.error(`Claude API error ${err.status}: ${err.message}`);
			return new EmojiTaggingError('FAILED', 'The Claude API returned an error.');
		}
		return err;
	}

	/**
	 * 画像を取り出し、Claude に送れる大きさの PNG にする (アニメーションは最初のコマ、SVG は画像にする)
	 */
	@bindThis
	private async loadImage(url: string): Promise<string> {
		const [path, cleanup] = await createTemp();
		try {
			await this.downloadService.downloadUrl(url, path, { attachMediaGateCookie: true });
			const png = await this.imageProcessingService.convertToPng(path, EMOJI_TAGGING_IMAGE_SIZE, EMOJI_TAGGING_IMAGE_SIZE);
			return Buffer.from(png.data).toString('base64');
		} catch (err) {
			this.logger.warn(`Failed to load the emoji image: ${url}`, { error: err });
			throw new EmojiTaggingError('FAILED_TO_LOAD_IMAGE', 'Failed to load the emoji image.');
		} finally {
			cleanup();
		}
	}

	/**
	 * 絵文字の画像と名前から、タグ (aliases) とカテゴリを提案させる
	 * @param categories 今あるカテゴリ。この中から選ぶか、合うものが無ければ新しいカテゴリを考えさせる
	 */
	@bindThis
	public async suggest(imageUrl: string, request: EmojiTaggingRequest, categories: string[]): Promise<{ tags: string[]; category: SuggestedCategory | null }> {
		const anthropic = this.getClient();
		const image = await this.loadImage(imageUrl);
		const model = toEmojiTaggingModel(this.meta.anthropicModel);

		let response: Anthropic.Beta.BetaMessage;
		try {
			response = await anthropic.beta.messages.create({
				model,
				max_tokens: 4096,
				// タグを並べるだけなので深く考えさせない
				output_config: { effort: 'low', format: { type: 'json_schema', schema: EMOJI_TAGS_SCHEMA } },
				// 安全のための判定で断られたとき、別のモデルで答え直させる (Haiku には無い)
				...(model === 'claude-haiku-5-5' ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
				// 指示とカテゴリ一覧はどの絵文字でも同じなので、まとめて提案するときはキャッシュが効く
				system: [
					{ type: 'text', text: EMOJI_TAGGING_SYSTEM_PROMPT },
					{ type: 'text', text: buildCategoryListPrompt(categories), cache_control: { type: 'ephemeral' } },
				],
				messages: [{
					role: 'user',
					content: [
						{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: image } },
						{ type: 'text', text: buildEmojiTaggingPrompt(request) },
					],
				}],
			});
		} catch (err) {
			throw this.toTaggingError(err);
		}

		if (response.stop_reason === 'refusal') {
			throw new EmojiTaggingError('REFUSED', 'Claude declined to suggest tags for this emoji.');
		}

		const text = response.content.find(block => block.type === 'text');
		if (response.stop_reason === 'max_tokens' || text == null) {
			this.logger.error(`Unexpected Claude response: stop_reason=${response.stop_reason}`);
			throw new EmojiTaggingError('FAILED', 'Claude returned no tags.');
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(text.text);
		} catch {
			this.logger.error('Claude returned invalid JSON.');
			throw new EmojiTaggingError('FAILED', 'Claude returned no tags.');
		}

		const result = parsed as { tags?: unknown; category?: unknown } | null;
		return {
			tags: normalizeSuggestedTags(result?.tags, request),
			category: normalizeSuggestedCategory(result?.category, categories),
		};
	}
}
