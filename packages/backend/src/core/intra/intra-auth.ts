/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 42 intra の OAuth2 ログインで使う純粋関数群。
// DI に依存しないので、ユニットテストから直接呼び出せる。

import { randomBytes } from 'node:crypto';
import { QueryFailedError } from 'typeorm';

/**
 * ログインを拒否したときにフロントエンドへ渡す理由
 */
export const intraAuthFailureReasons = [
	'not_eligible',
	'suspended',
	'username_taken',
	'invalid_state',
	'intra_error',
] as const;

export type IntraAuthFailureReason = typeof intraAuthFailureReasons[number];

/** state の有効期間 (秒) */
export const INTRA_STATE_TTL_SEC = 60 * 10;
/** ログイン用の使い捨てコードの有効期間 (秒) */
export const INTRA_LOGIN_CODE_TTL_SEC = 60;

/** 生成するランダム値のバイト数 */
const TOKEN_BYTES = 32;
// 32 バイトを base64url (パディング無し) で表すと 43 文字になる
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * state やログイン用コードに使うランダム値を生成する
 */
export function generateIntraToken(): string {
	return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * {@link generateIntraToken} が生成しうる形式の文字列か。
 * 外部から渡された値をそのまま Redis のキーに使わないための事前チェック
 */
export function isIntraToken(value: unknown): value is string {
	return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

export function buildIntraRedirectUri(baseUrl: string): string {
	return `${baseUrl}/api/intra/callback`;
}

export function buildIntraAuthorizeUrl(params: {
	apiBaseUrl: string;
	clientId: string;
	redirectUri: string;
	state: string;
}): string {
	const url = new URL(`${params.apiBaseUrl}/oauth/authorize`);
	url.searchParams.set('client_id', params.clientId);
	url.searchParams.set('redirect_uri', params.redirectUri);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('scope', 'public');
	url.searchParams.set('state', params.state);
	return url.toString();
}

/**
 * ログイン成功時のリダイレクト先。フロントエンドがこのコードを POST /api/intra/exchange に渡してトークンを受け取る
 */
export function buildIntraCompleteUrl(baseUrl: string, loginCode: string): string {
	return `${baseUrl}/intra-complete/${encodeURIComponent(loginCode)}`;
}

export function buildIntraErrorUrl(baseUrl: string, reason: IntraAuthFailureReason): string {
	return `${baseUrl}/intra-complete/error?reason=${encodeURIComponent(reason)}`;
}

/**
 * SignupService.signup が投げた例外が、ユーザー名 (または intraId) の重複によるものか。
 * 一意制約違反はユーザー名と intraId のどちらでも起こりうるので、呼び出し側で intraId による再検索をして区別する
 */
export function isSignupConflictError(err: unknown): boolean {
	if (err instanceof QueryFailedError) {
		return (err.driverError as { code?: unknown } | undefined)?.code === '23505';
	}
	if (!(err instanceof Error)) return false;
	// SignupService の事前チェック、予約語・禁止語、トランザクション内の再チェックで投げられるもの
	return err.message === 'DUPLICATED_USERNAME'
		|| err.message === 'USED_USERNAME'
		|| err.message.trim() === 'the username is already used';
}
