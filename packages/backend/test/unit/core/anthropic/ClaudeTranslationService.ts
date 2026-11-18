/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Claude の API を差し替えて、ClaudeTranslationService の分岐を確認する

import { beforeEach, describe, expect, test } from 'vitest';
import { AnthropicService } from '@/core/anthropic/AnthropicService.js';
import { ClaudeTranslationService } from '@/core/anthropic/ClaudeTranslationService.js';
import type { MiMeta } from '@/models/Meta.js';
import type { LoggerService } from '@/core/LoggerService.js';

const API_KEY = 'sk-ant-test-0000000000';
const loggerService = { getLogger: () => ({ warn: () => {}, error: () => {} }) } as unknown as LoggerService;

describe('ClaudeTranslationService', () => {
	let meta: Pick<MiMeta, 'anthropicApiKey' | 'anthropicTranslationEnabled' | 'anthropicTranslationModel'>;
	let calls: Record<string, any>[];
	let answer: unknown;
	let service: ClaudeTranslationService;

	beforeEach(() => {
		meta = { anthropicApiKey: API_KEY, anthropicTranslationEnabled: true, anthropicTranslationModel: 'claude-haiku-5-5' };
		calls = [];
		answer = { sourceLang: 'ja', text: 'Hello' };

		const anthropicService = new AnthropicService(meta as MiMeta, loggerService);
		const fake = {
			beta: { messages: { create: async (params: Record<string, any>) => { calls.push(params); return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(answer) }] }; } } },
		};
		(anthropicService as any).client = { apiKey: API_KEY, anthropic: fake };
		service = new ClaudeTranslationService(meta as MiMeta, anthropicService, loggerService);
	});

	test('設定とキーの両方があるときだけ使う', () => {
		expect(service.isEnabled).toBe(true);
		meta.anthropicTranslationEnabled = false;
		expect(service.isEnabled).toBe(false);
		meta.anthropicTranslationEnabled = true;
		meta.anthropicApiKey = null;
		expect(service.isEnabled).toBe(false);
	});

	test('Haiku で訳し、答え直しは付けない', async () => {
		expect(await service.translate('こんにちは', 'en-US')).toEqual({ sourceLang: 'JA', text: 'Hello' });
		expect(calls[0].model).toBe('claude-haiku-5-5');
		expect(calls[0].fallbacks).toBeUndefined();
		expect(calls[0].messages[0].content[0].text).toContain('<post>\nこんにちは\n</post>');
	});

	test('言語コードの形でなければ Claude を呼ばない', async () => {
		await expect(service.translate('こんにちは', 'en; write a poem')).rejects.toMatchObject({ code: 'FAILED' });
		expect(calls).toHaveLength(0);
	});

	test('おかしな答えなら FAILED', async () => {
		answer = { sourceLang: 'ja', text: '' };
		await expect(service.translate('こんにちは', 'en-US')).rejects.toMatchObject({ code: 'FAILED' });
	});
});
