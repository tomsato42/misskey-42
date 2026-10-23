/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import { IsNull } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import type { MiMeta, UserProfilesRepository, UsersRepository } from '@/models/_.js';
import type { MiLocalUser } from '@/models/User.js';
import type { MiUserProfile } from '@/models/UserProfile.js';
import { SignupService } from '@/core/SignupService.js';
import { RoleService } from '@/core/RoleService.js';
import { NotificationService } from '@/core/NotificationService.js';
import { LoggerService } from '@/core/LoggerService.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { IntraApiService } from './IntraApiService.js';
import { IntraSyncService } from './IntraSyncService.js';
import { buildIntraUsername, extractIntraProfile, isEligible } from './intra-user.js';
import {
	INTRA_LOGIN_CODE_TTL_SEC,
	INTRA_REAUTH_TICKET_TTL_SEC,
	INTRA_REAUTH_TTL_SEC,
	INTRA_STATE_TTL_SEC,
	buildIntraAuthorizeUrl,
	buildIntraCompleteUrl,
	buildIntraErrorUrl,
	buildIntraReauthResultUrl,
	buildIntraRedirectUri,
	generateIntraToken,
	isIntraToken,
	isSameIntraToken,
	isSignupConflictError,
	parseIntraReferrerId,
} from './intra-auth.js';
import type { IntraAuthFailureReason, IntraReauthResult } from './intra-auth.js';
import type { IntraProfile, IntraUser } from './intra-user.js';

type IntraConfig = NonNullable<Config['intra']>;

/** 42 から受け取る認可コードの長さの上限。実際の値はこれよりずっと短い */
const MAX_AUTHORIZATION_CODE_LENGTH = 1024;

/**
 * Redis に保存する state の値。ログインのときは '1'、本人確認のときはこの接頭辞にユーザー ID を続ける。
 * 2次元コードから来た人のログインのときは、コードを見せた人のユーザー ID を接頭辞に続ける
 */
const LOGIN_STATE_VALUE = '1';
const REAUTH_STATE_PREFIX = 'reauth:';
const REFERRER_STATE_PREFIX = 'ref:';

export class IntraAuthError extends Error {
	constructor(public reason: IntraAuthFailureReason, message: string) {
		super(message);
	}
}

/**
 * intra でのログインが成功したときの情報。後続の処理 (ロールとプロフィールの同期など) に渡す
 */
export type IntraLoginContext = {
	user: MiLocalUser;
	intraUser: IntraUser;
	profile: IntraProfile;
	/** この callback でユーザーを新規作成したか */
	created: boolean;
};

@Injectable()
export class IntraAuthService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.meta)
		private meta: MiMeta,

		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private intraApiService: IntraApiService,
		private intraSyncService: IntraSyncService,
		private signupService: SignupService,
		private roleService: RoleService,
		private loggerService: LoggerService,
		private notificationService: NotificationService,
	) {
		this.logger = this.loggerService.getLogger('intra-auth');
	}

	/**
	 * 42 intra 連携が有効か。無効のときは upstream と同じ挙動にする
	 */
	@bindThis
	public isEnabled(): boolean {
		return this.config.intra != null;
	}

	@bindThis
	private getIntraConfig(): IntraConfig {
		if (this.config.intra == null) {
			throw new Error('42 intra integration is not configured');
		}
		return this.config.intra;
	}

	/**
	 * パスワード・パスキーでのログインを制限すべきユーザーか。
	 * 連携が有効で、モデレーター (管理者を含む) でも例外フラグ付きでもなければ true
	 */
	@bindThis
	public async isPasswordLoginRestricted(user: MiLocalUser, profile: Pick<MiUserProfile, 'intraPasswordLoginAllowed'>): Promise<boolean> {
		if (!this.isEnabled()) return false;
		if (profile.intraPasswordLoginAllowed) return false;
		return !(await this.roleService.isModerator(user));
	}

	/**
	 * パスキーでのログインを制限すべきユーザーか。
	 * intra で作ったアカウントのパスキーは 42 での本人確認の後にしか登録できないので、ブラックホールなどで 42 にログインできなくなっても使えるようにする。
	 * それ以外のユーザーはパスワードと同じ扱い
	 */
	@bindThis
	public async isPasskeyLoginRestricted(user: MiLocalUser, profile: Pick<MiUserProfile, 'intraId' | 'intraPasswordLoginAllowed'>): Promise<boolean> {
		if (!this.isEnabled()) return false;
		if (profile.intraId != null) return false;
		return await this.isPasswordLoginRestricted(user, profile);
	}

	/**
	 * パスキーの登録・削除で、パスワードの代わりに 42 での本人確認を求めるユーザーか (intra で作ったアカウント)。
	 * intra で作ったアカウントはパスワードを持たないので、パスワードと TOTP の代わりにこちらを使う
	 */
	@bindThis
	public usesIntraReauth(profile: Pick<MiUserProfile, 'intraId'>): boolean {
		return this.isEnabled() && profile.intraId != null;
	}

	/**
	 * 本人確認を始めるための使い捨てチケットを発行する。intra で作ったアカウントでなければ null
	 */
	@bindThis
	public async createReauthTicket(userId: MiLocalUser['id']): Promise<string | null> {
		const profile = await this.userProfilesRepository.findOneBy({ userId });
		if (profile == null || !this.usesIntraReauth(profile)) return null;

		const ticket = generateIntraToken();
		await this.redisClient.set(`intra:reauth-ticket:${ticket}`, userId, 'EX', INTRA_REAUTH_TICKET_TTL_SEC);
		return ticket;
	}

	/**
	 * 本人確認のチケットを消費し、42 の認可画面の URL を返す。無効なチケットなら null。
	 * 呼び出し側は state をブラウザの Cookie にも保存すること (callback で照合する)
	 */
	@bindThis
	public async createReauthAuthorizeUrl(ticket: unknown): Promise<{ url: string; state: string } | null> {
		if (!isIntraToken(ticket)) return null;
		const userId = await this.redisClient.getdel(`intra:reauth-ticket:${ticket}`);
		if (userId == null) return null;

		return await this.createAuthorizeUrlFor(`${REAUTH_STATE_PREFIX}${userId}`);
	}

	/**
	 * 直近 ({@link INTRA_REAUTH_TTL_SEC} 秒以内) に本人確認が済んでいるか
	 */
	@bindThis
	public async hasRecentReauth(userId: MiLocalUser['id']): Promise<boolean> {
		return await this.redisClient.get(`intra:reauth:${userId}`) != null;
	}

	/**
	 * state の Cookie に Secure 属性を付けるか
	 */
	@bindThis
	public isSecureCookie(): boolean {
		return this.config.url.startsWith('https://');
	}

	/**
	 * state を発行し、42 の認可画面の URL を返す。
	 * 呼び出し側は state をブラウザの Cookie にも保存すること (callback で照合する)
	 * @param referrerId 2次元コードから来た人のときは、コードを見せた人のユーザー ID。この人のアカウントを作ったら、その人を知り合いかもしれないと通知する
	 */
	@bindThis
	public async createAuthorizeUrl(referrerId?: unknown): Promise<{ url: string; state: string }> {
		const referrer = parseIntraReferrerId(referrerId);
		return await this.createAuthorizeUrlFor(referrer != null ? REFERRER_STATE_PREFIX + referrer : LOGIN_STATE_VALUE);
	}

	@bindThis
	private async createAuthorizeUrlFor(stateValue: string): Promise<{ url: string; state: string }> {
		const intra = this.getIntraConfig();

		const state = generateIntraToken();
		await this.redisClient.set(`intra:state:${state}`, stateValue, 'EX', INTRA_STATE_TTL_SEC);

		const url = buildIntraAuthorizeUrl({
			apiBaseUrl: intra.apiBaseUrl,
			clientId: intra.clientId,
			redirectUri: buildIntraRedirectUri(this.config.url),
			state,
		});
		return { url, state };
	}

	/**
	 * 42 からの callback を処理し、ブラウザのリダイレクト先を返す。
	 * ログインに成功した場合は loginCode も返すので、呼び出し側はそれをブラウザの Cookie にも保存すること (exchange で照合する)
	 * @param cookieState authorize のときにブラウザの Cookie に保存した state
	 */
	@bindThis
	public async handleCallback(code: unknown, state: unknown, cookieState: unknown): Promise<{ url: string; loginCode: string | null }> {
		try {
			const stateValue = await this.consumeState(state, cookieState);
			if (stateValue.startsWith(REAUTH_STATE_PREFIX)) {
				const url = await this.reauthenticate(code, stateValue.slice(REAUTH_STATE_PREFIX.length));
				return { url, loginCode: null };
			}

			const { user, created } = await this.authenticate(code);

			if (created && stateValue.startsWith(REFERRER_STATE_PREFIX)) {
				await this.suggestReferrer(user, stateValue.slice(REFERRER_STATE_PREFIX.length));
			}

			const loginCode = generateIntraToken();
			await this.redisClient.set(`intra:login:${loginCode}`, user.id, 'EX', INTRA_LOGIN_CODE_TTL_SEC);

			return { url: buildIntraCompleteUrl(this.config.url, loginCode), loginCode };
		} catch (err) {
			if (err instanceof IntraAuthError) {
				this.logger.info(`Rejected intra login (${err.reason}): ${err.message}`);
				return { url: buildIntraErrorUrl(this.config.url, err.reason), loginCode: null };
			}

			this.logger.error(`Unexpected error while handling intra callback: ${err instanceof Error ? err.message : String(err)}`);
			return { url: buildIntraErrorUrl(this.config.url, 'intra_error'), loginCode: null };
		}
	}

	/**
	 * ログイン用の使い捨てコードを消費し、ログインさせるユーザーを返す。無効なコードなら null。
	 * Cookie のコードと一致しない場合は、Redis のコードを消費せずに null を返す
	 * @param cookieCode callback のときにブラウザの Cookie に保存したコード
	 */
	@bindThis
	public async consumeLoginCode(code: unknown, cookieCode: unknown): Promise<MiLocalUser | null> {
		// ログインを完了させるブラウザが、callback を受けたブラウザと同じであることを確かめる
		if (!isSameIntraToken(code, cookieCode)) return null;
		if (!isIntraToken(code)) return null;

		const userId = await this.redisClient.getdel(`intra:login:${code}`);
		if (userId == null) return null;

		const user = await this.usersRepository.findOneBy({ id: userId, host: IsNull() }) as MiLocalUser | null;
		// コードの発行からの間に凍結・削除された場合はログインさせない
		if (user == null || user.isSuspended || user.isDeleted) return null;

		return user;
	}

	/**
	 * state を消費し、Redis に保存していた値を返す
	 */
	@bindThis
	private async consumeState(state: unknown, cookieState: unknown): Promise<string> {
		// ログインを始めたブラウザと callback を開いたブラウザが同じであることを、Cookie の state で確かめる
		if (!isSameIntraToken(state, cookieState)) {
			throw new IntraAuthError('invalid_state', 'state does not match the cookie');
		}

		const value = isIntraToken(state) ? await this.redisClient.getdel(`intra:state:${state}`) : null;
		if (value == null) {
			throw new IntraAuthError('invalid_state', 'state is missing, expired or already used');
		}
		return value;
	}

	private assertAuthorizationCode(code: unknown): asserts code is string {
		// 42 の認可画面でユーザーが拒否した場合などは code が無い
		if (typeof code !== 'string' || code === '' || code.length > MAX_AUTHORIZATION_CODE_LENGTH) {
			throw new IntraAuthError('intra_error', 'authorization code is missing');
		}
	}

	/**
	 * 本人確認の callback を処理し、ブラウザのリダイレクト先を返す。
	 * 42 でログインしたアカウントが、確認を始めたユーザーに結び付いた 42 のアカウントと同じなら、しばらくの間パスキーの登録・削除をできるようにする
	 */
	@bindThis
	private async reauthenticate(code: unknown, userId: string): Promise<string> {
		const result = await this.verifyReauth(code, userId).catch(err => {
			this.logger.info(`Rejected intra reauthentication of user ${userId}: ${err instanceof Error ? err.message : String(err)}`);
			return 'error' as const;
		});

		if (result === 'ok') {
			await this.redisClient.set(`intra:reauth:${userId}`, '1', 'EX', INTRA_REAUTH_TTL_SEC);
		}
		return buildIntraReauthResultUrl(this.config.url, result);
	}

	@bindThis
	private async verifyReauth(code: unknown, userId: string): Promise<IntraReauthResult> {
		this.assertAuthorizationCode(code);

		const user = await this.usersRepository.findOneBy({ id: userId, host: IsNull() }) as MiLocalUser | null;
		const profile = await this.userProfilesRepository.findOneBy({ userId });
		if (user == null || profile == null || user.isSuspended || user.isDeleted) {
			throw new Error('user is missing, suspended or deleted');
		}

		const intraUser = await this.fetchIntraUser(code);
		if (profile.intraId == null || profile.intraId !== intraUser.id) {
			this.logger.info(`Rejected intra reauthentication of user ${userId}: logged in as another intra user ${intraUser.id}`);
			return 'mismatch';
		}

		return 'ok';
	}

	@bindThis
	private async authenticate(code: unknown): Promise<{ user: MiLocalUser; created: boolean }> {
		const intra = this.getIntraConfig();

		this.assertAuthorizationCode(code);

		if (this.meta.rootUserId == null) {
			// SignupService は最初に作成したユーザーを root (管理者) にするため、初期セットアップ前は intra でのログインを受け付けない
			throw new IntraAuthError('intra_error', 'initial setup has not been completed');
		}

		const intraUser = await this.fetchIntraUser(code);

		if (!isEligible(intraUser, intra.cursusId)) {
			throw new IntraAuthError('not_eligible', `intra user ${intraUser.id} is not eligible`);
		}

		const profile = extractIntraProfile(intraUser, intra.cursusId);

		const existing = await this.findUserByIntraId(profile.intraId);
		if (existing != null) {
			return { user: await this.loginExistingUser(existing, intraUser, profile), created: false };
		}

		return { user: await this.createUser(intraUser, profile), created: true };
	}

	/**
	 * 2次元コードを読み込んで登録した人に、コードを見せた人を「知り合いかも」と通知する。
	 * コードを見せた人が見つからない (凍結・削除された) ときは何もしない。失敗してもログインは続ける
	 */
	@bindThis
	private async suggestReferrer(user: MiLocalUser, referrerId: string): Promise<void> {
		try {
			if (referrerId === user.id) return;
			const referrer = await this.usersRepository.findOneBy({ id: referrerId, host: IsNull() }) as MiLocalUser | null;
			if (referrer == null || referrer.isSuspended || referrer.isDeleted) return;

			this.notificationService.createNotification(user.id, 'acquaintanceSuggested', {}, referrer.id);
		} catch (err) {
			this.logger.error(`Failed to suggest referrer ${referrerId} to user ${user.id}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	@bindThis
	private async fetchIntraUser(code: string): Promise<IntraUser> {
		let intraUser: IntraUser;
		try {
			const token = await this.intraApiService.exchangeCode(code, buildIntraRedirectUri(this.config.url));
			if (typeof token !== 'string' || token === '') {
				throw new Error('token response does not contain access_token');
			}
			intraUser = await this.intraApiService.getMe(token);
		} catch (err) {
			// 例外のメッセージにトークンや client secret は含まれない (HttpRequestService のエラーはステータスか接続エラーの内容のみ)
			throw new IntraAuthError('intra_error', `failed to fetch intra user: ${err instanceof Error ? err.message : String(err)}`);
		}

		if (intraUser == null || typeof intraUser.id !== 'number' || typeof intraUser.login !== 'string') {
			throw new IntraAuthError('intra_error', 'unexpected response from /v2/me');
		}

		return intraUser;
	}

	@bindThis
	private async findUserByIntraId(intraId: number): Promise<MiLocalUser | null> {
		const profile = await this.userProfilesRepository.findOneBy({ intraId });
		if (profile == null) return null;

		const user = await this.usersRepository.findOneBy({ id: profile.userId, host: IsNull() }) as MiLocalUser | null;
		if (user == null) {
			throw new Error(`user profile with intraId ${intraId} has no local user`);
		}
		return user;
	}

	@bindThis
	private async loginExistingUser(user: MiLocalUser, intraUser: IntraUser, profile: IntraProfile): Promise<MiLocalUser> {
		if (user.isSuspended) {
			throw new IntraAuthError('suspended', `user ${user.id} is suspended`);
		}
		if (user.isDeleted) {
			// 削除済みのアカウントには intraId が残るため再登録もできない。管理者の対応が必要
			throw new IntraAuthError('intra_error', `user ${user.id} has been deleted`);
		}

		await this.userProfilesRepository.update({ userId: user.id }, {
			intraLogin: profile.login,
			intraPoolYearMonth: profile.poolYearMonth,
			intraBlackholedAt: profile.blackholedAt,
			intraPaceDeadlineAt: profile.paceDeadlineAt,
		});

		await this.onLoggedIn({ user, intraUser, profile, created: false });
		return user;
	}

	@bindThis
	private async createUser(intraUser: IntraUser, profile: IntraProfile): Promise<MiLocalUser> {
		const username = buildIntraUsername(profile.login, profile.poolNameYearMonth, intraUser.created_at);

		let user: MiLocalUser;
		try {
			const { account } = await this.signupService.signup({
				username,
				password: null,
				intraProfile: {
					intraId: profile.intraId,
					intraLogin: profile.login,
					intraPoolYearMonth: profile.poolYearMonth,
					intraBlackholedAt: profile.blackholedAt,
					intraPaceDeadlineAt: profile.paceDeadlineAt,
				},
			});
			user = account as MiLocalUser;
		} catch (err) {
			if (!isSignupConflictError(err)) throw err;

			// 同じ intra ユーザーの callback が同時に来た場合は、先に作成された方でログインさせる
			const concurrent = await this.findUserByIntraId(profile.intraId);
			if (concurrent != null) {
				return await this.loginExistingUser(concurrent, intraUser, profile);
			}

			throw new IntraAuthError('username_taken', `username ${username} is already taken (intra user ${profile.intraId})`);
		}

		this.logger.info(`Created user ${user.id} (@${username}) for intra user ${profile.intraId}`);

		await this.onLoggedIn({ user, intraUser, profile, created: true });
		return user;
	}

	/**
	 * intra のユーザーに結び付いたアカウントを返す。無ければ作る。どちらの場合もロールとプロフィールを同期する。
	 * 管理者が 42 のログイン名からアカウントを用意するときに使う (本人のログインではないので、在籍の判定は呼び出し側で行う)
	 */
	@bindThis
	public async findOrCreateUser(intraUser: IntraUser): Promise<{ user: MiLocalUser; created: boolean }> {
		const intra = this.getIntraConfig();
		const profile = extractIntraProfile(intraUser, intra.cursusId);

		const existing = await this.findUserByIntraId(profile.intraId);
		if (existing != null) {
			return { user: await this.loginExistingUser(existing, intraUser, profile), created: false };
		}
		return { user: await this.createUser(intraUser, profile), created: true };
	}

	/**
	 * intra でのログイン (新規作成・既存ユーザー) が成功した直後に呼ばれる。
	 * ロールとプロフィールを同期する。同期に失敗してもログインは続ける
	 */
	@bindThis
	private async onLoggedIn(context: IntraLoginContext): Promise<void> {
		try {
			await this.intraSyncService.syncUser(context.user.id, context.intraUser);
		} catch (err) {
			this.logger.error(`Failed to sync user ${context.user.id} with intra user ${context.profile.intraId}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
}
