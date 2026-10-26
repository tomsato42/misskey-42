/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Claude の API・画像の取得・変換を差し替えて、EmojiTagSuggestionService の分岐を確認する

import * as fs from 'node:fs/promises';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import { EmojiTagSuggestionService, EmojiTaggingError } from '@/core/emoji-tagging/EmojiTagSuggestionService.js';
import { AnthropicService } from '@/core/anthropic/AnthropicService.js';
import type { MiMeta } from '@/models/Meta.js';
import type { DownloadService } from '@/core/DownloadService.js';
import type { ImageProcessingService } from '@/core/ImageProcessingService.js';
import type { LoggerService } from '@/core/LoggerService.js';

const API_KEY = 'sk-ant-test-0000000000';

const logger = { warn: () => {}, error: () => {} };
const loggerService = { getLogger: () => logger } as unknown as LoggerService;
const imageProcessingService = {
	convertToPng: async () => ({ data: Buffer.from('png'), ext: 'png', type: 'image/png' }),
} as unknown as ImageProcessingService;

const request = { name: 'happy', category: null, currentTags: ['にこ'], excludedTags: [], hint: null };

function textResponse(json: unknown, stopReason = 'end_turn') {
	return { stop_reason: stopReason, content: [{ type: 'text', text: JSON.stringify(json) }] };
}

const categories = (...names: string[]) => names.map(name => ({ name, count: 1, examples: [`${name}_example`] }));

describe('EmojiTagSuggestionService', () => {
	let meta: Pick<MiMeta, 'anthropicApiKey' | 'anthropicModel'>;
	let calls: Record<string, any>[];
	let respond: () => Promise<unknown>;
	let downloadFails: boolean;
	let image: Buffer;
	let staticImage: Buffer;
	let animatedImage: Buffer;
	let service: EmojiTagSuggestionService;

	beforeAll(async () => {
		const frame = (color: string) => sharp({ create: { width: 4, height: 4, channels: 4, background: color } }).png().toBuffer();
		staticImage = await frame('#f00');
		animatedImage = await sharp([staticImage, await frame('#00f')], { join: { animated: true } }).gif().toBuffer();
	});

	beforeEach(() => {
		meta = { anthropicApiKey: API_KEY, anthropicModel: 'claude-sonnet-5-5' };
		calls = [];
		respond = async () => textResponse({ tags: ['うれしい', 'にこ', 'smile'], category: 'きもち' });
		downloadFails = false;
		image = staticImage;

		const downloadService = {
			downloadUrl: async (_url: string, path: string) => {
				if (downloadFails) throw new Error('404');
				await fs.writeFile(path, image);
				return { filename: 'happy.png' };
			},
		} as unknown as DownloadService;

		const anthropicService = new AnthropicService(meta as MiMeta, loggerService);
		service = new EmojiTagSuggestionService(meta as MiMeta, anthropicService, downloadService, imageProcessingService, loggerService);

		const fake = {
			beta: { messages: { create: async (params: Record<string, any>) => { calls.push(params); return await respond(); } } },
			models: { retrieve: async () => { await respond(); return {}; } },
		};
		// API キーが同じあいだは作り直さないので、差し替えたクライアントを使い続ける
		(anthropicService as any).client = { apiKey: API_KEY, anthropic: fake };
	});

	test('画像と今あるカテゴリを送り、タグとカテゴリを整えて返す', async () => {
		const result = await service.suggest('https://example.com/happy.png', request, categories('きもち', 'たべもの'));

		expect(result).toEqual({ tags: ['うれしい', 'smile'], category: { name: 'きもち', isNew: false } });
		const params = calls[0];
		expect(params.model).toBe('claude-sonnet-5-5');
		expect(params.output_config.format.type).toBe('json_schema');
		expect(params.messages[0].content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/png' } });
		expect(params.system[1].text).toContain('- たべもの (1 件。例: たべもの_example)');
		expect(params.messages[0].content[1].text).toContain('動き: 静止画');
		expect(params.fallbacks).toBe('default');
	});

	test('今あるカテゴリに無ければ新しいカテゴリとして返す', async () => {
		respond = async () => textResponse({ tags: [], category: 'どうぶつ' });
		const result = await service.suggest('https://example.com/cat.png', request, categories('きもち'));
		expect(result.category).toEqual({ name: 'どうぶつ', isNew: true });
	});

	test('アニメーションする画像なら、そう伝える', async () => {
		image = animatedImage;
		await service.suggest('https://example.com/ablob_happy.gif', { ...request, name: 'ablob_happy' }, categories('blob', 'ablob'));
		expect(calls[0].messages[0].content[1].text).toContain('動き: アニメーションする');
	});

	test('Haiku では別のモデルでの答え直しを付けない', async () => {
		meta.anthropicModel = 'claude-haiku-5-5';
		await service.suggest('https://example.com/happy.png', request, []);
		expect(calls[0].model).toBe('claude-haiku-5-5');
		expect(calls[0].fallbacks).toBeUndefined();
		expect(calls[0].betas).toBeUndefined();
	});

	test('API キーが無ければ NOT_CONFIGURED', async () => {
		meta.anthropicApiKey = null;
		await expect(service.suggest('https://example.com/happy.png', request, [])).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
	});

	test('画像を取れなければ FAILED_TO_LOAD_IMAGE', async () => {
		downloadFails = true;
		await expect(service.suggest('https://example.com/happy.png', request, [])).rejects.toMatchObject({ code: 'FAILED_TO_LOAD_IMAGE' });
		expect(calls).toHaveLength(0);
	});

	test('キーが拒まれたら INVALID_API_KEY、上限なら RATE_LIMITED', async () => {
		respond = async () => { throw new Anthropic.AuthenticationError(401, undefined, 'invalid x-api-key', new Headers()); };
		await expect(service.suggest('https://example.com/happy.png', request, [])).rejects.toMatchObject({ code: 'INVALID_API_KEY' });

		respond = async () => { throw new Anthropic.RateLimitError(429, undefined, 'rate limited', new Headers()); };
		await expect(service.testConnection()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
	});

	test('断られたら REFUSED、壊れた応答なら FAILED', async () => {
		respond = async () => ({ stop_reason: 'refusal', content: [] });
		await expect(service.suggest('https://example.com/happy.png', request, [])).rejects.toMatchObject({ code: 'REFUSED' });

		respond = async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{' }] });
		const err = await service.suggest('https://example.com/happy.png', request, []).catch(e => e);
		expect(err).toBeInstanceOf(EmojiTaggingError);
		expect(err.code).toBe('FAILED');
	});
});
