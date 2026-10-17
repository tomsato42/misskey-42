/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { type FastifyServerOptions } from 'fastify';
import type * as Sentry from '@sentry/node';
import type * as SentryVue from '@sentry/vue';
import type { RedisOptions as IoRedisRedisOptions } from 'ioredis';
import type { RedisOptions as BullMqRedisOptions } from 'bullmq';
import type { AccessLogConfiguration, LogFormat, LogLevelSetting } from './logging/types.js';

type RedisOptionsRequiredFields = {
	host: string;
	port: number;
	family?: number;
	pass: string;
	db?: number;
	prefix?: string;
};
type RedisOptionsSource = Partial<IoRedisRedisOptions & BullMqRedisOptions> & RedisOptionsRequiredFields;
type RedisOptionsResolved = IoRedisRedisOptions & BullMqRedisOptions & RedisOptionsRequiredFields;

type SentryBackendConfig = {
	options: Partial<Sentry.NodeOptions>;
	enableNodeProfiling: boolean;
	disabledIntegrations?: string[];
};

/**
 * 設定ファイルの型
 */
type Source = {
	url?: string;
	port?: number;
	socket?: string;
	trustProxy?: FastifyServerOptions['trustProxy'];
	chmodSocket?: string;
	enableIpRateLimit?: boolean;
	disableHsts?: boolean;
	db: {
		host: string;
		port: number;
		db?: string;
		user?: string;
		pass?: string;
		disableCache?: boolean;
		extra?: { [x: string]: string };
	};
	dbReplications?: boolean;
	dbSlaves?: {
		host: string;
		port: number;
		db: string;
		user: string;
		pass: string;
	}[];
	redis: RedisOptionsSource;
	redisForPubsub?: RedisOptionsSource;
	redisForJobQueue?: RedisOptionsSource;
	redisForTimelines?: RedisOptionsSource;
	redisForReactions?: RedisOptionsSource;
	fulltextSearch?: {
		provider?: FulltextSearchProvider;
	};
	meilisearch?: {
		host: string;
		port: string;
		apiKey: string;
		ssl?: boolean;
		index: string;
		scope?: 'local' | 'global' | string[];
	};
	sentryForBackend?: SentryBackendConfig;
	sentryForFrontend?: {
		options: Partial<SentryVue.BrowserOptions> & { dsn: string };
		vueIntegration?: SentryVue.VueIntegrationOptions | null;
		browserTracingIntegration?: Parameters<typeof SentryVue.browserTracingIntegration>[0] | null;
		replayIntegration?: Parameters<typeof SentryVue.replayIntegration>[0] | null;
	};

	publishTarballInsteadOfProvideRepositoryUrl?: boolean;

	setupPassword?: string;

	proxy?: string;
	proxySmtp?: string;
	proxyBypassHosts?: string[];

	allowedPrivateNetworks?: string[];

	maxFileSize?: number;

	clusterLimit?: number;
	threadPoolSize?: number;

	id: string;

	outgoingAddress?: string;
	outgoingAddressFamily?: 'ipv4' | 'ipv6' | 'dual';

	deliverJobConcurrency?: number;
	inboxJobConcurrency?: number;
	relationshipJobConcurrency?: number;
	deliverJobPerSec?: number;
	inboxJobPerSec?: number;
	relationshipJobPerSec?: number;
	deliverJobMaxAttempts?: number;
	inboxJobMaxAttempts?: number;

	mediaProxy?: string;
	videoThumbnailGenerator?: string;

	perChannelMaxNoteCacheCount?: number;
	perUserNotificationsMaxCount?: number;
	deactivateAntennaThreshold?: number;
	pidFile: string;

	logging?: {
		format?: LogFormat;
		level?: LogLevelSetting;
		domains?: Record<string, LogLevelSetting> | null;
		access?: AccessLogConfiguration;
		sql?: {
			disableQueryTruncation?: boolean,
			enableQueryParamLogging?: boolean,
		}
	}

	intra?: {
		clientId: string;
		clientSecret: string;
		cursusId?: number;
		apiBaseUrl?: string;
	};

	mediaGate?: {
		secret: string;
		cookieName?: string;
		ttlSec?: number;
	};
};

export type Config = {
	url: string;
	port: number;
	socket: string | undefined;
	trustProxy: NonNullable<FastifyServerOptions['trustProxy']>;
	chmodSocket: string | undefined;
	enableIpRateLimit: boolean;
	disableHsts: boolean | undefined;
	db: {
		host: string;
		port: number;
		db: string;
		user: string;
		pass: string;
		disableCache?: boolean;
		extra?: { [x: string]: string };
	};
	dbReplications: boolean | undefined;
	dbSlaves: {
		host: string;
		port: number;
		db: string;
		user: string;
		pass: string;
	}[] | undefined;
	fulltextSearch?: {
		provider?: FulltextSearchProvider;
	};
	meilisearch: {
		host: string;
		port: string;
		apiKey: string;
		ssl?: boolean;
		index: string;
		scope?: 'local' | 'global' | string[];
	} | undefined;
	proxy: string | undefined;
	proxySmtp: string | undefined;
	proxyBypassHosts: string[] | undefined;
	allowedPrivateNetworks: string[] | undefined;
	maxFileSize: number;
	clusterLimit: number | undefined;
	threadPoolSize: number;
	id: string;
	outgoingAddress: string | undefined;
	outgoingAddressFamily: 'ipv4' | 'ipv6' | 'dual' | undefined;
	deliverJobConcurrency: number | undefined;
	inboxJobConcurrency: number | undefined;
	relationshipJobConcurrency: number | undefined;
	deliverJobPerSec: number | undefined;
	inboxJobPerSec: number | undefined;
	relationshipJobPerSec: number | undefined;
	deliverJobMaxAttempts: number | undefined;
	inboxJobMaxAttempts: number | undefined;
	logging?: {
		format?: LogFormat;
		level?: LogLevelSetting;
		domains?: Record<string, LogLevelSetting> | null;
		access?: AccessLogConfiguration;
		sql?: {
			disableQueryTruncation?: boolean,
			enableQueryParamLogging?: boolean,
		}
	}

	version: string;
	publishTarballInsteadOfProvideRepositoryUrl: boolean;
	setupPassword: string | undefined;
	host: string;
	hostname: string;
	scheme: string;
	wsScheme: string;
	apiUrl: string;
	wsUrl: string;
	authUrl: string;
	driveUrl: string;
	userAgent: string;
	frontendManifestExists: boolean;
	frontendEmbedManifestExists: boolean;
	rootDir: string;
	mediaProxy: string;
	externalMediaProxyEnabled: boolean;
	videoThumbnailGenerator: string | null;
	redis: RedisOptionsResolved;
	redisForPubsub: RedisOptionsResolved;
	redisForJobQueue: RedisOptionsResolved;
	redisForTimelines: RedisOptionsResolved;
	redisForReactions: RedisOptionsResolved;
	sentryForBackend: SentryBackendConfig | undefined;
	sentryForFrontend: {
		options: Partial<SentryVue.BrowserOptions> & { dsn: string };
		vueIntegration?: SentryVue.VueIntegrationOptions | null;
		browserTracingIntegration?: Parameters<typeof SentryVue.browserTracingIntegration>[0] | null;
		replayIntegration?: Parameters<typeof SentryVue.replayIntegration>[0] | null;
	} | undefined;
	perChannelMaxNoteCacheCount: number;
	perUserNotificationsMaxCount: number;
	deactivateAntennaThreshold: number;
	pidFile: string;
	/**
	 * 42 intra 連携の設定。未設定のときは連携機能全体を無効にする
	 */
	intra: {
		clientId: string;
		clientSecret: string;
		cursusId: number;
		apiBaseUrl: string;
	} | undefined;
	/**
	 * 画像・添付ファイルをログインしている人にだけ見せるための署名付き Cookie の設定。
	 * 未設定のときは機能全体を無効にし、upstream と同じ挙動にする
	 */
	mediaGate: MediaGateConfig | undefined;
};

export type MediaGateConfig = {
	/** Cookie の署名に使う秘密の値。Cloudflare Worker の MEDIA_GATE_SECRET と同じ値にする */
	secret: string;
	cookieName: string;
	/** Cookie の有効期間 (秒) */
	ttlSec: number;
};

export type FulltextSearchProvider = 'sqlLike' | 'sqlPgroonga' | 'meilisearch';

const _filename = fileURLToPath(import.meta.url);
const _dirname = dirname(_filename);

/** Path of repository root directory */
let rootDir = _dirname;
// 見つかるまで上に遡る
while (!fs.existsSync(resolve(rootDir, 'packages'))) {
	const parentDir = dirname(rootDir);
	if (parentDir === rootDir) {
		throw new Error('Cannot find root directory');
	}
	rootDir = parentDir;
}

/** Path of configuration directory */
const configDir = resolve(rootDir, '.config');
/** Path of built directory */
const projectBuiltDir = resolve(rootDir, 'built');

const compiledConfigFilePathForTest = resolve(projectBuiltDir, '._config_.json');

export const compiledConfigFilePath = fs.existsSync(compiledConfigFilePathForTest)
	? compiledConfigFilePathForTest
	: resolve(projectBuiltDir, '.config.json');

export function loadConfig(): Config {
	if (!fs.existsSync(compiledConfigFilePath)) {
		throw new Error('Compiled configuration file not found. Try running \'pnpm compile-config\'.');
	}

	const meta = JSON.parse(fs.readFileSync(resolve(projectBuiltDir, 'meta.json'), 'utf-8'));

	const frontendManifestExists = fs.existsSync(resolve(projectBuiltDir, '_frontend_vite_/manifest.json'));
	const frontendEmbedManifestExists = fs.existsSync(resolve(projectBuiltDir, '_frontend_embed_vite_/manifest.json'));

	const config = JSON.parse(fs.readFileSync(compiledConfigFilePath, 'utf-8')) as Source;

	const url = tryCreateUrl(config.url ?? process.env.MISSKEY_URL ?? '');
	const version = meta.version;
	const host = url.host;
	const hostname = url.hostname;
	const scheme = url.protocol.replace(/:$/, '');
	const wsScheme = scheme.replace('http', 'ws');

	const dbDb = config.db.db ?? process.env.DATABASE_DB ?? '';
	const dbUser = config.db.user ?? process.env.DATABASE_USER ?? '';
	const dbPass = config.db.pass ?? process.env.DATABASE_PASSWORD ?? '';

	const externalMediaProxy = config.mediaProxy ?
		config.mediaProxy.endsWith('/') ? config.mediaProxy.substring(0, config.mediaProxy.length - 1) : config.mediaProxy
		: null;
	const internalMediaProxy = `${scheme}://${host}/proxy`;
	const redis = convertRedisOptions(config.redis, host);

	return {
		version,
		publishTarballInsteadOfProvideRepositoryUrl: !!config.publishTarballInsteadOfProvideRepositoryUrl,
		setupPassword: config.setupPassword,
		url: url.origin,
		port: config.port ?? parseInt(process.env.PORT ?? '', 10),
		socket: config.socket,
		trustProxy: config.trustProxy ?? [
			'10.0.0.0/8',
			'172.16.0.0/12',
			'192.168.0.0/16',
			'127.0.0.1/32',
			'::1/128',
			'fc00::/7',
		],
		chmodSocket: config.chmodSocket,
		disableHsts: config.disableHsts,
		enableIpRateLimit: config.enableIpRateLimit ?? true,
		host,
		hostname,
		scheme,
		wsScheme,
		wsUrl: `${wsScheme}://${host}`,
		apiUrl: `${scheme}://${host}/api`,
		authUrl: `${scheme}://${host}/auth`,
		driveUrl: `${scheme}://${host}/files`,
		db: { ...config.db, db: dbDb, user: dbUser, pass: dbPass },
		dbReplications: config.dbReplications,
		dbSlaves: config.dbSlaves,
		fulltextSearch: config.fulltextSearch,
		meilisearch: config.meilisearch,
		redis,
		redisForPubsub: config.redisForPubsub ? convertRedisOptions(config.redisForPubsub, host) : redis,
		redisForJobQueue: config.redisForJobQueue ? convertRedisOptions(config.redisForJobQueue, host) : redis,
		redisForTimelines: config.redisForTimelines ? convertRedisOptions(config.redisForTimelines, host) : redis,
		redisForReactions: config.redisForReactions ? convertRedisOptions(config.redisForReactions, host) : redis,
		sentryForBackend: config.sentryForBackend,
		sentryForFrontend: config.sentryForFrontend,
		id: config.id,
		proxy: config.proxy,
		proxySmtp: config.proxySmtp,
		proxyBypassHosts: config.proxyBypassHosts,
		allowedPrivateNetworks: config.allowedPrivateNetworks,
		maxFileSize: config.maxFileSize ?? 262144000,
		clusterLimit: config.clusterLimit,
		threadPoolSize: config.threadPoolSize ?? 1,
		outgoingAddress: config.outgoingAddress,
		outgoingAddressFamily: config.outgoingAddressFamily,
		deliverJobConcurrency: config.deliverJobConcurrency,
		inboxJobConcurrency: config.inboxJobConcurrency,
		relationshipJobConcurrency: config.relationshipJobConcurrency,
		deliverJobPerSec: config.deliverJobPerSec,
		inboxJobPerSec: config.inboxJobPerSec,
		relationshipJobPerSec: config.relationshipJobPerSec,
		deliverJobMaxAttempts: config.deliverJobMaxAttempts,
		inboxJobMaxAttempts: config.inboxJobMaxAttempts,
		mediaProxy: externalMediaProxy ?? internalMediaProxy,
		externalMediaProxyEnabled: externalMediaProxy !== null && externalMediaProxy !== internalMediaProxy,
		videoThumbnailGenerator: config.videoThumbnailGenerator ?
			config.videoThumbnailGenerator.endsWith('/') ? config.videoThumbnailGenerator.substring(0, config.videoThumbnailGenerator.length - 1) : config.videoThumbnailGenerator
			: null,
		userAgent: `Misskey/${version} (${config.url})`,
		frontendManifestExists: frontendManifestExists,
		frontendEmbedManifestExists: frontendEmbedManifestExists,
		rootDir,
		perChannelMaxNoteCacheCount: config.perChannelMaxNoteCacheCount ?? 1000,
		perUserNotificationsMaxCount: config.perUserNotificationsMaxCount ?? 500,
		deactivateAntennaThreshold: config.deactivateAntennaThreshold ?? (1000 * 60 * 60 * 24 * 7),
		pidFile: config.pidFile,
		logging: config.logging,
		intra: config.intra ? {
			clientId: config.intra.clientId,
			clientSecret: config.intra.clientSecret,
			// 21 = 42cursus
			cursusId: config.intra.cursusId ?? 21,
			apiBaseUrl: (config.intra.apiBaseUrl ?? 'https://api.intra.42.fr').replace(/\/+$/, ''),
		} : undefined,
		mediaGate: config.mediaGate ? convertMediaGateConfig(config.mediaGate) : undefined,
	};
}

const MEDIA_GATE_MIN_SECRET_LENGTH = 32;
const MEDIA_GATE_DEFAULT_TTL_SEC = 60 * 60 * 24 * 7;
const MEDIA_GATE_MAX_TTL_SEC = 60 * 60 * 24 * 30;

export function convertMediaGateConfig(source: NonNullable<Source['mediaGate']>): MediaGateConfig {
	if (typeof source.secret !== 'string' || source.secret.length < MEDIA_GATE_MIN_SECRET_LENGTH) {
		throw new Error(`mediaGate.secret must be a string of at least ${MEDIA_GATE_MIN_SECRET_LENGTH} characters.`);
	}

	const cookieName = source.cookieName ?? 'mi_media_session';
	// Cookie 名に使えるのは RFC 6265 の token のうち、扱いやすい文字だけに限る
	if (!/^[A-Za-z0-9_-]{1,64}$/.test(cookieName)) {
		throw new Error('mediaGate.cookieName must consist of 1-64 characters of A-Z, a-z, 0-9, "_" and "-".');
	}

	const ttlSec = source.ttlSec ?? MEDIA_GATE_DEFAULT_TTL_SEC;
	if (!Number.isInteger(ttlSec) || ttlSec < 60 || ttlSec > MEDIA_GATE_MAX_TTL_SEC) {
		throw new Error(`mediaGate.ttlSec must be an integer between 60 and ${MEDIA_GATE_MAX_TTL_SEC}.`);
	}

	return { secret: source.secret, cookieName, ttlSec };
}

function tryCreateUrl(url: string) {
	try {
		return new URL(url);
	} catch (_) {
		throw new Error(`url="${url}" is not a valid URL.`);
	}
}

function convertRedisOptions(options: RedisOptionsSource, host: string): RedisOptionsResolved {
	return {
		...options,
		password: options.pass,
		prefix: options.prefix ?? host,
		family: options.family ?? 0,
		keyPrefix: `${options.prefix ?? host}:`,
		db: options.db ?? 0,
	};
}
