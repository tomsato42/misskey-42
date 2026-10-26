/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { MiMeta } from '@/models/Meta.js';
import { LoggerService } from '@/core/LoggerService.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { AnthropicService, ClaudeError } from './AnthropicService.js';
import {
	CLAUDE_TRANSLATION_SCHEMA,
	CLAUDE_TRANSLATION_SYSTEM_PROMPT,
	buildClaudeTranslationPrompt,
	normalizeClaudeTranslation,
	normalizeTargetLang,
	toClaudeTranslationModel,
} from './claude-translation.js';

export type Translation = { sourceLang: string; text: string };

@Injectable()
export class ClaudeTranslationService {
	private logger: Logger;

	constructor(
		@Inject(DI.meta)
		private meta: MiMeta,

		private anthropicService: AnthropicService,
		private loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger('claude-translation');
	}

	/** ノートの翻訳に Claude を使う設定で、キーもあるか */
	public get isEnabled(): boolean {
		return this.meta.anthropicTranslationEnabled && this.anthropicService.isConfigured;
	}

	/**
	 * ノートの本文を訳す。訳した結果を覚えておくのは呼び出し側 (NoteTranslationCacheService)
	 */
	@bindThis
	public async translate(text: string, rawTargetLang: string): Promise<Translation> {
		const targetLang = normalizeTargetLang(rawTargetLang);
		if (targetLang == null) throw new ClaudeError('FAILED', 'Unsupported target language.');

		const raw = await this.anthropicService.createJson({
			model: toClaudeTranslationModel(this.meta.anthropicTranslationModel),
			schema: CLAUDE_TRANSLATION_SCHEMA,
			maxTokens: 8192,
			system: [{ type: 'text', text: CLAUDE_TRANSLATION_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
			content: [{ type: 'text', text: buildClaudeTranslationPrompt(text, targetLang) }],
		});

		const translation = normalizeClaudeTranslation(raw);
		if (translation == null) {
			this.logger.error('Claude returned a translation in an unexpected shape.');
			throw new ClaudeError('FAILED', 'Claude returned no translation.');
		}

		return translation;
	}

	/**
	 * 翻訳のモデルが使えるかを確かめる。費用はかからない
	 */
	@bindThis
	public async testConnection(): Promise<void> {
		await this.anthropicService.testModel(toClaudeTranslationModel(this.meta.anthropicTranslationModel));
	}
}
