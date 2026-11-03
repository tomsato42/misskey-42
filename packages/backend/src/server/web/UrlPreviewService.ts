/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import type { SummalyResult } from '@misskey-dev/summaly';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import type Logger from '@/logger.js';
import { deepClone } from '@/misc/clone.js';
import { query } from '@/misc/prelude/url.js';
import { MemoryKVCache } from '@/misc/cache.js';
import { LoggerService } from '@/core/LoggerService.js';
import { UtilityService } from '@/core/UtilityService.js';
import { bindThis } from '@/decorators.js';
import { ApiError } from '@/server/api/error.js';
import { MiMeta } from '@/models/Meta.js';
import { isIntraMode } from '@/core/intra/intra-visitor.js';
import { AuthenticateService, AuthenticationError } from '@/server/api/AuthenticateService.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

@Injectable()
export class UrlPreviewService implements OnApplicationShutdown {
	private logger: Logger;
	private summaryCache: MemoryKVCache<SummalyResult>;
	private readonly summalyDefaultUserAgent: string;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.meta)
		private meta: MiMeta,

		private httpRequestService: HttpRequestService,
		private utilityService: UtilityService,
		private loggerService: LoggerService,
		private authenticateService: AuthenticateService,
	) {
		this.logger = this.loggerService.getLogger('url-preview');
		this.summaryCache = new MemoryKVCache<SummalyResult>(1000 * 60 * 60, 100); // 1h, 100件
		this.summalyDefaultUserAgent = `SummalyBot/${_SUMMALY_VERSION_} (${this.config.url}; +https://github.com/misskey-dev/summaly/blob/master/README.md)`;
	}

	@bindThis
	private wrap(url?: string | null): string | null {
		return url != null
			? `${this.config.mediaProxy}/preview.webp?${query({
				url,
				preview: '1',
			})}`
			: null;
	}

	@bindThis
	public async handle(
		request: FastifyRequest<{ Querystring: { url: string; lang?: string; } }>,
		reply: FastifyReply,
	): Promise<object | undefined> {
		// 42 intra 連携が有効なとき (学内SNSモード) は、未ログインの訪問者にサーバーから外部の URL を取得させない
		if (isIntraMode(this.config) && !(await this.isAuthenticated(request))) {
			reply.code(401);
			reply.header('WWW-Authenticate', 'Bearer realm="Misskey"');
			return {
				error: new ApiError({
					message: 'Credential required.',
					code: 'CREDENTIAL_REQUIRED',
					id: '1384574d-a912-4b81-8601-c7b1c4085df1',
				}),
			};
		}

		const url = request.query.url;
		if (typeof url !== 'string') {
			reply.code(400);
			return;
		}

		const lang = request.query.lang;
		if (Array.isArray(lang)) {
			reply.code(400);
			return;
		}

		if (!this.meta.urlPreviewEnabled) {
			reply.code(403);
			return {
				error: new ApiError({
					message: 'URL preview is disabled',
					code: 'URL_PREVIEW_DISABLED',
					id: '58b36e13-d2f5-0323-b0c6-76aa9dabefb8',
				}),
			};
		}

		this.logger.info(this.meta.urlPreviewSummaryProxyUrl
			? `(Proxy) Getting preview of ${url}@${lang} ...`
			: `Getting preview of ${url}@${lang} ...`);

		try {
			const fetcher = async () => {
				const result = await (
					this.meta.urlPreviewSummaryProxyUrl
					? this.fetchSummaryFromProxy(url, lang)
					: this.fetchSummary(url, lang)
				);

				if (!result.url.startsWith('http://') && !result.url.startsWith('https://')) {
					return undefined;
				}

				if (result.player.url && !result.player.url.startsWith('http://') && !result.player.url.startsWith('https://')) {
					return undefined;
				}

				return result;
			};

			const summary = deepClone(await this.summaryCache.fetchMaybe(`${url}@${lang ?? '_DEFAULT_'}`, fetcher));

			if (summary == null) {
				throw new Error('Invalid summary');
			}

			this.logger.succ(`Got preview of ${url}: ${summary.title}`);

			summary.icon = this.wrap(summary.icon);
			summary.thumbnail = this.wrap(summary.thumbnail);

			if (summary.sensitive !== true) {
				summary.sensitive = this.utilityService.isKeyWordIncluded(summary.url, this.meta.urlPreviewSensitiveList);
			}

			// Cache 1day
			// 学内SNSモードではログインしたユーザーにだけ返すので、共有キャッシュに保存させない
			reply.header('Cache-Control', isIntraMode(this.config) ? 'private, max-age=86400, immutable' : 'max-age=86400, immutable');

			return summary;
		} catch (err) {
			this.logger.warn(`Failed to get preview of ${url}: ${err}`);

			reply.code(422);
			reply.header('Cache-Control', isIntraMode(this.config) ? 'private, max-age=86400, immutable' : 'max-age=86400, immutable');
			return {
				error: new ApiError({
					message: 'Failed to get preview',
					code: 'URL_PREVIEW_FAILED',
					id: '09d01cb5-53b9-4856-82e5-38a50c290a3b',
				}),
			};
		}
	}

	/**
	 * Authorization ヘッダーのトークンで、ログインしたユーザーからのリクエストか確かめる
	 */
	@bindThis
	private async isAuthenticated(request: FastifyRequest): Promise<boolean> {
		// https://datatracker.ietf.org/doc/html/rfc6750.html#section-2.1 (case sensitive)
		const token = request.headers.authorization?.startsWith('Bearer ')
			? request.headers.authorization.slice(7)
			: null;
		if (token == null) return false;

		try {
			const [user] = await this.authenticateService.authenticate(token);
			return user != null && !user.isSuspended;
		} catch (err) {
			if (err instanceof AuthenticationError) return false;
			throw err;
		}
	}

	@bindThis
	private async fetchSummary(url: string, lang?: string): Promise<SummalyResult> {
		const { summaly } = await import('@misskey-dev/summaly');

		return summaly(url, {
			followRedirects: this.meta.urlPreviewAllowRedirect,
			lang: lang ?? 'ja-JP',
			agent: {
				http: this.httpRequestService.httpAgent,
				https: this.httpRequestService.httpsAgent,
			},
			userAgent: this.meta.urlPreviewUserAgent ?? this.summalyDefaultUserAgent,
			operationTimeout: this.meta.urlPreviewTimeout,
			contentLengthLimit: this.meta.urlPreviewMaximumContentLength,
			contentLengthRequired: this.meta.urlPreviewRequireContentLength,
		});
	}

	@bindThis
	private fetchSummaryFromProxy(url: string, lang?: string): Promise<SummalyResult> {
		const proxy = this.meta.urlPreviewSummaryProxyUrl!;
		const queryStr = query({
			url: url,
			lang: lang ?? 'ja-JP',
			followRedirects: this.meta.urlPreviewAllowRedirect,
			userAgent: this.meta.urlPreviewUserAgent ?? this.summalyDefaultUserAgent,
			operationTimeout: this.meta.urlPreviewTimeout,
			contentLengthLimit: this.meta.urlPreviewMaximumContentLength,
			contentLengthRequired: this.meta.urlPreviewRequireContentLength,
		});

		return this.httpRequestService.getJson<SummalyResult>(`${proxy}?${queryStr}`, 'application/json, */*', undefined, true);
	}

	@bindThis
	public dispose(): void {
		this.summaryCache.dispose();
	}

	@bindThis
	public onApplicationShutdown(): void {
		this.dispose();
	}
}
