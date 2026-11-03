/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Claude (Anthropic) の API を呼ぶ共通の部分。API キーは meta の anthropicApiKey (管理画面の「外部サービス」で登録する)

import { Inject, Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { DI } from '@/di-symbols.js';
import type { MiMeta } from '@/models/Meta.js';
import { LoggerService } from '@/core/LoggerService.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';

export type ClaudeErrorCode =
	| 'NOT_CONFIGURED'
	| 'FAILED_TO_LOAD_IMAGE'
	| 'INVALID_API_KEY'
	| 'RATE_LIMITED'
	| 'REFUSED'
	| 'FAILED';

export class ClaudeError extends Error {
	constructor(public readonly code: ClaudeErrorCode, message: string) {
		super(message);
		this.name = 'ClaudeError';
	}
}

/** 安全のための判定で断られたときに、別のモデルで答え直させられるモデル (Haiku には無い) */
const MODELS_WITH_FALLBACK: readonly string[] = ['claude-opus-5-5', 'claude-sonnet-5-5'];

@Injectable()
export class AnthropicService {
	private logger: Logger;
	private client: { apiKey: string; anthropic: Anthropic } | null = null;

	constructor(
		@Inject(DI.meta)
		private meta: MiMeta,

		private loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger('anthropic');
	}

	public get isConfigured(): boolean {
		return this.meta.anthropicApiKey != null && this.meta.anthropicApiKey !== '';
	}

	/**
	 * API キーが変わったときだけクライアントを作り直す
	 */
	@bindThis
	public getClient(): Anthropic {
		const apiKey = this.meta.anthropicApiKey;
		if (apiKey == null || apiKey === '') throw new ClaudeError('NOT_CONFIGURED', 'The Claude API key is not set.');
		if (this.client?.apiKey !== apiKey) {
			this.client = { apiKey, anthropic: new Anthropic({ apiKey, timeout: 60 * 1000, maxRetries: 2 }) };
		}
		return this.client.anthropic;
	}

	/**
	 * API のエラーを ClaudeError にする。それ以外の例外はそのまま返す
	 */
	@bindThis
	public toClaudeError(err: unknown): unknown {
		if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
			return new ClaudeError('INVALID_API_KEY', 'The Claude API key was rejected.');
		}
		if (err instanceof Anthropic.RateLimitError) {
			return new ClaudeError('RATE_LIMITED', 'The Claude API rate limit was reached.');
		}
		if (err instanceof Anthropic.APIError) {
			this.logger.error(`Claude API error ${err.status}: ${err.message}`);
			return new ClaudeError('FAILED', 'The Claude API returned an error.');
		}
		return err;
	}

	/**
	 * API キーとモデルが使えるかを確かめる。モデルの情報を取るだけなので費用はかからない
	 */
	@bindThis
	public async testModel(model: string): Promise<void> {
		const anthropic = this.getClient();
		try {
			await anthropic.models.retrieve(model);
		} catch (err) {
			throw this.toClaudeError(err);
		}
	}

	/**
	 * 構造化出力 (JSON スキーマ) で 1 回だけ呼び、返ってきた JSON をそのまま返す。中身の検証は呼び出し側で行う
	 */
	@bindThis
	public async createJson(params: {
		model: string;
		schema: Record<string, unknown>;
		system: Anthropic.Beta.BetaTextBlockParam[];
		content: Anthropic.Beta.BetaContentBlockParam[];
		maxTokens?: number;
	}): Promise<unknown> {
		const anthropic = this.getClient();

		let response: Anthropic.Beta.BetaMessage;
		try {
			response = await anthropic.beta.messages.create({
				model: params.model,
				max_tokens: params.maxTokens ?? 4096,
				// どの用途も決まった形で答えるだけなので深く考えさせない
				output_config: { effort: 'low', format: { type: 'json_schema', schema: params.schema } },
				...(MODELS_WITH_FALLBACK.includes(params.model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
				system: params.system,
				messages: [{ role: 'user', content: params.content }],
			});
		} catch (err) {
			throw this.toClaudeError(err);
		}

		if (response.stop_reason === 'refusal') {
			throw new ClaudeError('REFUSED', 'Claude declined the request.');
		}

		const text = response.content.find(block => block.type === 'text');
		if (response.stop_reason === 'max_tokens' || text == null) {
			this.logger.error(`Unexpected Claude response: stop_reason=${response.stop_reason}`);
			throw new ClaudeError('FAILED', 'Claude returned no answer.');
		}

		try {
			return JSON.parse(text.text);
		} catch {
			this.logger.error('Claude returned invalid JSON.');
			throw new ClaudeError('FAILED', 'Claude returned no answer.');
		}
	}
}
