/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 画像・添付ファイルをログインしている人にだけ見せるための、署名付き Cookie の純粋関数群。
// 同じアルゴリズムを cloudflare/media-worker/src/token.ts にも実装している。
// 形式を変えるときは両方を変え、cloudflare/media-worker/test/token-vectors.json のテストベクタも更新すること。
//
// トークンの形式: v1.{subject}.{exp}.{sig}
//   subject: ユーザー ID (サーバー自身の取得では MEDIA_GATE_SERVER_SUBJECT)
//   exp:     有効期限 (unix 秒)
//   sig:     base64url (パディング無し) で表した HMAC-SHA256(secret, "v1.{subject}.{exp}")。secret は UTF-8 のバイト列として使う

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { MediaGateConfig } from '@/config.js';

export const MEDIA_GATE_TOKEN_VERSION = 'v1';

/**
 * Misskey 自身がメディアを取得するとき (メディアプロキシなど) に使う subject。
 * ユーザー ID は英小文字と数字の 10 文字以上なので、ユーザー ID と重ならない
 */
export const MEDIA_GATE_SERVER_SUBJECT = 'server';

/** サーバー自身の取得に使うトークンの有効期間 (秒) */
export const MEDIA_GATE_SERVER_TOKEN_TTL_SEC = 60 * 5;

const MAX_TOKEN_LENGTH = 256;
const SUBJECT_PATTERN = /^[A-Za-z0-9]{1,64}$/;
const EXP_PATTERN = /^[1-9][0-9]{0,15}$/;
// HMAC-SHA256 の 32 バイトを base64url (パディング無し) で表すと 43 文字になる
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function sign(secret: string, payload: string): string {
	return createHmac('sha256', secret).update(payload, 'utf8').digest('base64url');
}

/**
 * トークンを作る
 * @param exp 有効期限 (unix 秒)
 */
export function signMediaGateToken(secret: string, subject: string, exp: number): string {
	if (!SUBJECT_PATTERN.test(subject)) throw new Error('invalid subject');
	if (!Number.isSafeInteger(exp) || exp <= 0) throw new Error('invalid exp');
	const payload = `${MEDIA_GATE_TOKEN_VERSION}.${subject}.${exp}`;
	return `${payload}.${sign(secret, payload)}`;
}

/**
 * トークンを検証する。署名が正しく、期限内であれば subject と exp を返し、それ以外は null
 * @param nowSec 現在時刻 (unix 秒)
 */
export function verifyMediaGateToken(secret: string, token: unknown, nowSec: number): { subject: string; exp: number } | null {
	if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return null;

	const parts = token.split('.');
	if (parts.length !== 4) return null;
	const [version, subject, expText, signature] = parts;
	if (version !== MEDIA_GATE_TOKEN_VERSION) return null;
	if (!SUBJECT_PATTERN.test(subject) || !EXP_PATTERN.test(expText) || !SIGNATURE_PATTERN.test(signature)) return null;

	const exp = Number(expText);
	if (!Number.isSafeInteger(exp)) return null;

	const expected = sign(secret, `${version}.${subject}.${expText}`);
	// どちらも 43 文字の ASCII なので、バイト列の長さは常に等しい。
	// 文字列として比べるので、同じバイト列を表す別の base64url 表記 (末尾の余りビットが異なるもの) も不正として扱う
	if (!timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(signature, 'utf8'))) return null;

	if (exp <= nowSec) return null;

	return { subject, exp };
}

export function nowUnixSec(): number {
	return Math.floor(Date.now() / 1000);
}

/**
 * Cookie に入れるトークンを発行する
 */
export function issueMediaGateToken(config: MediaGateConfig, subject: string, nowSec: number, ttlSec = config.ttlSec): { token: string; exp: number } {
	const exp = nowSec + ttlSec;
	return { token: signMediaGateToken(config.secret, subject, exp), exp };
}

/**
 * Set-Cookie ヘッダーの値。ホスト限定 (Domain 属性なし) で、サイト全体 (Path=/) に送られるようにする
 * @param maxAge 秒
 */
export function buildMediaGateCookie(name: string, token: string, maxAge: number, secure: boolean): string {
	return `${name}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/**
 * Cookie を消す Set-Cookie ヘッダーの値
 */
export function buildMediaGateCookieClear(name: string, secure: boolean): string {
	return buildMediaGateCookie(name, '', 0, secure);
}

/**
 * Cache-Control の値を、共有キャッシュ (Cloudflare など) に保存させないものに変える。
 * public は private に置き換え、private / no-store が無ければ private を付ける
 */
export function toPrivateCacheControl(value: unknown): string {
	if (typeof value !== 'string' || value.trim() === '') return 'private';

	const directives = value.split(',').map(x => x.trim()).filter(x => x !== '');
	const names = directives.map(x => x.split('=')[0].toLowerCase());
	if (names.includes('no-store')) return directives.join(', ');

	const rest = directives.filter((_, i) => names[i] !== 'public' && names[i] !== 'private' && names[i] !== 's-maxage');
	return ['private', ...rest].join(', ');
}
