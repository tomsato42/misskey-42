/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { DI } from '@/di-symbols.js';
import type { MiMeta } from '@/models/Meta.js';
import { AnthropicService, ClaudeError } from '@/core/anthropic/AnthropicService.js';
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
	buildInstructionsPrompt,
	buildEmojiTaggingPrompt,
	normalizeSuggestedCategory,
	normalizeSuggestedTags,
	toEmojiTaggingModel,
} from './emoji-tagging.js';
import type { CategorySummary, EmojiTaggingRequest, SuggestedCategory } from './emoji-tagging.js';

// 絵文字のタグの提案だけでなく翻訳でも使うので、エラーは AnthropicService のものをそのまま使う
export { ClaudeError as EmojiTaggingError } from '@/core/anthropic/AnthropicService.js';
export type { ClaudeErrorCode as EmojiTaggingErrorCode } from '@/core/anthropic/AnthropicService.js';

@Injectable()
export class EmojiTagSuggestionService {
	private logger: Logger;

	constructor(
		@Inject(DI.meta)
		private meta: MiMeta,

		private anthropicService: AnthropicService,
		private downloadService: DownloadService,
		private imageProcessingService: ImageProcessingService,
		private loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger('emoji-tagging');
	}

	/**
	 * API キーとモデルが使えるかを確かめる。モデルの情報を取るだけなので費用はかからない
	 */
	@bindThis
	public async testConnection(): Promise<void> {
		await this.anthropicService.testModel(toEmojiTaggingModel(this.meta.anthropicModel));
	}

	/**
	 * 画像を取り出し、Claude に送れる大きさの PNG にする (アニメーションは最初のコマ、SVG は画像にする)。
	 * 最初のコマだけではアニメーションか分からないので、それも調べて返す
	 */
	@bindThis
	private async loadImage(url: string): Promise<{ data: string; isAnimated: boolean }> {
		const [path, cleanup] = await createTemp();
		try {
			await this.downloadService.downloadUrl(url, path, { attachMediaGateCookie: true });
			const metadata = await sharp(path).metadata();
			const png = await this.imageProcessingService.convertToPng(path, EMOJI_TAGGING_IMAGE_SIZE, EMOJI_TAGGING_IMAGE_SIZE);
			return {
				data: Buffer.from(png.data).toString('base64'),
				isAnimated: (metadata.pages ?? 1) > 1,
			};
		} catch (err) {
			// 取得のエラーにはメディア用 Cookie を含むリクエストの内容が入ることがあるので、文だけを残す
			this.logger.warn(`Failed to load the emoji image: ${url}: ${err instanceof Error ? err.message : String(err)}`);
			throw new ClaudeError('FAILED_TO_LOAD_IMAGE', 'Failed to load the emoji image.');
		} finally {
			cleanup();
		}
	}

	/**
	 * 絵文字の画像と名前から、タグ (aliases) とカテゴリを提案させる
	 * @param categories 今あるカテゴリ。この中から選ぶか、合うものが無ければ新しいカテゴリを考えさせる
	 */
	@bindThis
	public async suggest(imageUrl: string, request: EmojiTaggingRequest, categories: CategorySummary[]): Promise<{ tags: string[]; category: SuggestedCategory | null }> {
		// 画像を取りに行く前に、キーが無いことを知らせる
		this.anthropicService.getClient();
		const image = await this.loadImage(imageUrl);
		const instructions = buildInstructionsPrompt(this.meta.anthropicEmojiTaggingInstructions);

		const parsed = await this.anthropicService.createJson({
			model: toEmojiTaggingModel(this.meta.anthropicModel),
			schema: EMOJI_TAGS_SCHEMA,
			// 指示・管理者の指示・カテゴリ一覧はどの絵文字でも同じなので、まとめて提案するときはキャッシュが効く
			system: [
				{ type: 'text', text: EMOJI_TAGGING_SYSTEM_PROMPT },
				...(instructions != null ? [{ type: 'text' as const, text: instructions }] : []),
				{ type: 'text', text: buildCategoryListPrompt(categories), cache_control: { type: 'ephemeral' } },
			],
			content: [
				{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: image.data } },
				{ type: 'text', text: buildEmojiTaggingPrompt(request, { isAnimated: image.isAnimated }) },
			],
		});

		const result = parsed as { tags?: unknown; category?: unknown } | null;
		return {
			tags: normalizeSuggestedTags(result?.tags, request),
			category: normalizeSuggestedCategory(result?.category, categories.map(it => it.name)),
		};
	}
}
