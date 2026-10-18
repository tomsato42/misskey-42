/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { setTimeout } from 'node:timers/promises';
import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { LoggerService } from '@/core/LoggerService.js';
import { StatusError } from '@/misc/status-error.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import type { IntraUser } from './intra-user.js';
import type { IntraProjectSession, IntraQuestUser } from './intra-project.js';
import type { Response } from 'node-fetch';

type IntraConfig = NonNullable<Config['intra']>;

type IntraTokenResponse = {
	access_token: string;
	token_type: string;
	/** 秒 */
	expires_in: number;
};

/** アプリトークンでのリクエストの最小間隔 (ミリ秒) */
const APP_REQUEST_MIN_INTERVAL = 500;
/** アプリトークンの期限切れ直前に使ってしまわないための余裕 (ミリ秒) */
const APP_TOKEN_EXPIRY_MARGIN = 60 * 1000;
/** Retry-After が無い・解釈できない 429 のときに待つ時間 (ミリ秒) */
const DEFAULT_RETRY_AFTER = 1000;
/** Retry-After が極端に長い場合に待つ上限 (ミリ秒) */
const MAX_RETRY_AFTER = 60 * 1000;

const REQUEST_TIMEOUT = 10 * 1000;
// /v2/me や /v2/users/:id は projects_users などを含むため大きくなることがある
const MAX_RESPONSE_SIZE = 4 * 1024 * 1024;

/** 一覧の API で 1 ページに取得する件数 (42 API の上限は 100) */
const PAGE_SIZE = 100;
/** 一覧の API で取得するページ数の上限 */
const MAX_PAGES = 10;

@Injectable()
export class IntraApiService {
	private logger: Logger;

	private appToken: { token: string; expiresAt: number } | null = null;
	private appTokenPromise: Promise<string> | null = null;

	// アプリトークンでのリクエストを直列化し、最小間隔を空けるためのキュー
	private appRequestQueue: Promise<unknown> = Promise.resolve();
	private lastAppRequestAt = 0;

	constructor(
		@Inject(DI.config)
		private config: Config,

		private httpRequestService: HttpRequestService,
		private loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger('intra-api');
	}

	@bindThis
	private getIntraConfig(): IntraConfig {
		if (this.config.intra == null) {
			throw new Error('42 intra integration is not configured');
		}
		return this.config.intra;
	}

	/**
	 * OAuth2 の認可コードをユーザーのアクセストークンに交換する
	 */
	@bindThis
	public async exchangeCode(code: string, redirectUri: string): Promise<string> {
		const intra = this.getIntraConfig();

		const res = await this.httpRequestService.send(`${intra.apiBaseUrl}/oauth/token`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Accept: 'application/json',
			},
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				client_id: intra.clientId,
				client_secret: intra.clientSecret,
				code,
				redirect_uri: redirectUri,
			}).toString(),
			timeout: REQUEST_TIMEOUT,
		});

		const body = await res.json() as IntraTokenResponse;
		return body.access_token;
	}

	/**
	 * ユーザーのアクセストークンで、そのユーザー自身の情報を取得する
	 */
	@bindThis
	public async getMe(userAccessToken: string): Promise<IntraUser> {
		const intra = this.getIntraConfig();

		const res = await this.httpRequestService.send(`${intra.apiBaseUrl}/v2/me`, {
			method: 'GET',
			headers: {
				Accept: 'application/json',
				Authorization: `Bearer ${userAccessToken}`,
			},
			timeout: REQUEST_TIMEOUT,
			size: MAX_RESPONSE_SIZE,
		});

		return await res.json() as IntraUser;
	}

	/**
	 * アプリトークンで intra のユーザー情報を取得する。ユーザーが存在しなければ null
	 */
	@bindThis
	public async getUser(intraId: number): Promise<IntraUser | null> {
		const intra = this.getIntraConfig();

		const res = await this.appRequest(`${intra.apiBaseUrl}/v2/users/${encodeURIComponent(String(intraId))}`);
		if (res.status === 404) return null;
		if (!res.ok) {
			throw new StatusError(`${res.status} ${res.statusText}`, res.status, res.statusText);
		}

		return await res.json() as IntraUser;
	}

	/**
	 * アプリトークンで、キャンパス・cursus の課題のセッション (登録の条件を含む) をすべて取得する。
	 * 42 Tokyo・42cursus では 161 件 (2 ページ、1 ページ目は約 600KB) だった
	 */
	@bindThis
	public async getProjectSessions(campusId: number, cursusId: number): Promise<IntraProjectSession[]> {
		const intra = this.getIntraConfig();
		const query = new URLSearchParams({
			'filter[campus_id]': String(campusId),
			'filter[cursus_id]': String(cursusId),
		});
		return await this.appGetAllPages<IntraProjectSession>(`${intra.apiBaseUrl}/v2/project_sessions?${query.toString()}`);
	}

	/**
	 * アプリトークンで、ユーザーのクエストの状態をすべて取得する。ユーザーが存在しなければ null
	 */
	@bindThis
	public async getQuestsUsers(intraId: number): Promise<IntraQuestUser[] | null> {
		const intra = this.getIntraConfig();
		try {
			return await this.appGetAllPages<IntraQuestUser>(`${intra.apiBaseUrl}/v2/users/${encodeURIComponent(String(intraId))}/quests_users`);
		} catch (err) {
			if (err instanceof StatusError && err.statusCode === 404) return null;
			throw err;
		}
	}

	/**
	 * アプリトークンで一覧の API をページごとに取得して連結する。
	 * 返ってきた件数がページの大きさより少なくなるか、MAX_PAGES に達したら止める
	 */
	@bindThis
	private async appGetAllPages<T>(url: string): Promise<T[]> {
		const results: T[] = [];
		const separator = url.includes('?') ? '&' : '?';

		for (let page = 1; page <= MAX_PAGES; page++) {
			const res = await this.appRequest(`${url}${separator}page[size]=${PAGE_SIZE}&page[number]=${page}`);
			if (!res.ok) {
				throw new StatusError(`${res.status} ${res.statusText}`, res.status, res.statusText);
			}

			const body = await res.json() as unknown;
			if (!Array.isArray(body)) {
				throw new Error(`Unexpected response from 42 API: ${url}`);
			}
			results.push(...body as T[]);
			if (body.length < PAGE_SIZE) return results;
		}

		this.logger.warn(`Reached the page limit (${MAX_PAGES}) while fetching ${url}`);
		return results;
	}

	/**
	 * client_credentials で取得したアプリトークンを返す。期限まではメモリにキャッシュする
	 */
	@bindThis
	private async getAppToken(): Promise<string> {
		if (this.appToken != null && this.appToken.expiresAt > Date.now()) {
			return this.appToken.token;
		}

		// 同時に呼ばれても取得リクエストは 1 回にまとめる
		this.appTokenPromise ??= this.fetchAppToken().finally(() => {
			this.appTokenPromise = null;
		});
		return await this.appTokenPromise;
	}

	@bindThis
	private async fetchAppToken(): Promise<string> {
		const intra = this.getIntraConfig();

		const res = await this.httpRequestService.send(`${intra.apiBaseUrl}/oauth/token`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Accept: 'application/json',
			},
			body: new URLSearchParams({
				grant_type: 'client_credentials',
				client_id: intra.clientId,
				client_secret: intra.clientSecret,
			}).toString(),
			timeout: REQUEST_TIMEOUT,
		});

		const body = await res.json() as IntraTokenResponse;
		this.appToken = {
			token: body.access_token,
			expiresAt: Date.now() + (body.expires_in * 1000) - APP_TOKEN_EXPIRY_MARGIN,
		};
		return body.access_token;
	}

	/**
	 * アプリトークンで GET する。リクエストは直列化して最低 APP_REQUEST_MIN_INTERVAL ミリ秒の間隔を空け、
	 * 429 の場合は Retry-After を尊重して 1 回だけ再試行する。
	 * 4xx/5xx でも例外にせずレスポンスを返す (429 の再試行後を除く)
	 */
	@bindThis
	private async appRequest(url: string): Promise<Response> {
		const run = this.appRequestQueue.then(async () => {
			let res = await this.sendWithAppToken(url);
			if (res.status === 429) {
				const wait = this.parseRetryAfter(res.headers.get('Retry-After'));
				this.logger.warn(`Rate limited by 42 API. Retrying after ${wait}ms`);
				await setTimeout(wait);
				res = await this.sendWithAppToken(url);
			}
			return res;
		});
		// 失敗しても後続のリクエストが止まらないよう、キューには結果を握りつぶしたものを繋ぐ
		this.appRequestQueue = run.catch(() => {});
		return await run;
	}

	@bindThis
	private async sendWithAppToken(url: string): Promise<Response> {
		const token = await this.getAppToken();

		const wait = this.lastAppRequestAt + APP_REQUEST_MIN_INTERVAL - Date.now();
		if (wait > 0) await setTimeout(wait);
		this.lastAppRequestAt = Date.now();

		const res = await this.httpRequestService.send(url, {
			method: 'GET',
			headers: {
				Accept: 'application/json',
				Authorization: `Bearer ${token}`,
			},
			timeout: REQUEST_TIMEOUT,
			size: MAX_RESPONSE_SIZE,
		}, {
			throwErrorWhenResponseNotOk: false,
		});

		if (res.status === 401) {
			// トークンが失効・取り消しされた可能性があるので、次回は取り直す
			this.appToken = null;
		}

		return res;
	}

	@bindThis
	private parseRetryAfter(value: string | null): number {
		if (value == null) return DEFAULT_RETRY_AFTER;

		let ms: number;
		if (/^\d+$/.test(value.trim())) {
			ms = parseInt(value.trim(), 10) * 1000;
		} else {
			const date = Date.parse(value);
			ms = isNaN(date) ? DEFAULT_RETRY_AFTER : date - Date.now();
		}

		return Math.min(Math.max(ms, 0), MAX_RETRY_AFTER);
	}
}
