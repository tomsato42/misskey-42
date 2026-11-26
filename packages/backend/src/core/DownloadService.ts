/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as fs from 'node:fs';
import * as stream from 'node:stream/promises';
import { Inject, Injectable } from '@nestjs/common';
import chalk from 'chalk';
import got, * as Got from 'got';
import { parse } from 'content-disposition';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { createTemp } from '@/misc/create-temp.js';
import { StatusError } from '@/misc/status-error.js';
import { LoggerService } from '@/core/LoggerService.js';
import type Logger from '@/logger.js';
import {
	MEDIA_GATE_SERVER_SUBJECT,
	MEDIA_GATE_SERVER_TOKEN_TTL_SEC,
	issueMediaGateToken,
	nowUnixSec,
} from '@/core/media-gate/media-gate.js';

import { bindThis } from '@/decorators.js';

export type DownloadUrlOptions = {
	/**
	 * mediaGate が有効なとき、取得先が自分のホスト (config.url と同じオリジン) なら、サーバー用のメディア用 Cookie を付ける。
	 * 自分のホストのメディアを読む必要がある取得 (メディアプロキシ、ローカルのドライブのファイルを読むインポート・エクスポート) にだけ指定する。
	 * ユーザーや他のサーバーが指定した URL を取り込む取得 (drive/files/upload-from-url、ActivityPub 由来の取得など) には指定しない
	 */
	attachMediaGateCookie?: boolean;
};

@Injectable()
export class DownloadService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		private httpRequestService: HttpRequestService,
		private loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger('download');
	}

	/**
	 * mediaGate が有効で、呼び出し側が attachMediaGateCookie を指定したとき、自分のホストのメディア
	 * (オブジェクトストレージを前にした Cloudflare Worker や /files/*) を取得できるよう、短い期限のメディア用 Cookie を付ける。
	 * got は別オリジンへのリダイレクトで Cookie ヘッダーを外すので、他のホストには送られない
	 */
	@bindThis
	private getMediaGateHeaders(url: URL, options: DownloadUrlOptions): Record<string, string> {
		if (options.attachMediaGateCookie !== true) return {};
		if (this.config.mediaGate == null || url.origin !== this.config.url) return {};
		const { token } = issueMediaGateToken(this.config.mediaGate, MEDIA_GATE_SERVER_SUBJECT, nowUnixSec(), MEDIA_GATE_SERVER_TOKEN_TTL_SEC);
		return { Cookie: `${this.config.mediaGate.cookieName}=${token}` };
	}

	@bindThis
	public async downloadUrl(url: string, path: string, options: DownloadUrlOptions = {}): Promise<{
		filename: string;
	}> {
		this.logger.info(`Downloading ${chalk.cyan(url)} to ${chalk.cyanBright(path)} ...`);

		const timeout = 30 * 1000;
		const operationTimeout = 60 * 1000;
		const maxSize = this.config.maxFileSize;

		const urlObj = new URL(url);
		let filename = urlObj.pathname.split('/').pop() ?? 'untitled';

		const req = got.stream(url, {
			headers: {
				'User-Agent': this.config.userAgent,
				...this.getMediaGateHeaders(urlObj, options),
			},
			timeout: {
				lookup: timeout,
				connect: timeout,
				secureConnect: timeout,
				socket: timeout,	// read timeout
				response: timeout,
				send: timeout,
				request: operationTimeout,	// whole operation timeout
			},
			agent: {
				http: this.httpRequestService.getAgentForHttp(urlObj),
				https: this.httpRequestService.getAgentForHttps(urlObj),
			},
			hooks: {
				beforeRedirect: [
					(options) => {
						// リダイレクト先ごとにエージェントを選択し直し、
						// proxyBypassHosts 経由のリダイレクトでローカルアドレスチェックが素通しになるのを防ぐ
						const redirectUrl = options.url;
						if (redirectUrl == null) return;
						options.agent = {
							http: this.httpRequestService.getAgentForHttp(redirectUrl),
							https: this.httpRequestService.getAgentForHttps(redirectUrl),
						};
					},
				],
			},
			http2: false,	// default
			retry: {
				limit: 0,
			},
			enableUnixSockets: false,
		}).on('response', (res: Got.Response) => {
			const contentLength = res.headers['content-length'];
			if (contentLength != null) {
				const size = Number(contentLength);
				if (size > maxSize) {
					this.logger.warn(`maxSize exceeded (${size} > ${maxSize}) on response`);
					req.destroy();
				}
			}

			const contentDisposition = res.headers['content-disposition'];
			if (contentDisposition != null) {
				try {
					const parsed = parse(contentDisposition);
					if (parsed.parameters.filename) {
						filename = parsed.parameters.filename;
					}
				} catch (e) {
					this.logger.warn(`Failed to parse content-disposition: ${contentDisposition}`, { stack: e });
				}
			}
		}).on('downloadProgress', (progress: Got.Progress) => {
			if (progress.transferred > maxSize) {
				this.logger.warn(`maxSize exceeded (${progress.transferred} > ${maxSize}) on downloadProgress`);
				req.destroy();
			}
		});

		try {
			await stream.pipeline(req, fs.createWriteStream(path));
		} catch (e) {
			if (e instanceof Got.HTTPError) {
				throw new StatusError(`${e.response.statusCode} ${e.response.statusMessage}`, e.response.statusCode, e.response.statusMessage);
			} else {
				throw e;
			}
		}

		this.logger.succ(`Download finished: ${chalk.cyan(url)}`);

		return {
			filename,
		};
	}

	@bindThis
	public async downloadTextFile(url: string, options: DownloadUrlOptions = {}): Promise<string> {
		// Create temp file
		const [path, cleanup] = await createTemp();

		this.logger.info(`text file: Temp file is ${path}`);

		try {
			// write content at URL to temp file
			await this.downloadUrl(url, path, options);

			const text = await fs.promises.readFile(path, 'utf8');

			return text;
		} finally {
			cleanup();
		}
	}
}
