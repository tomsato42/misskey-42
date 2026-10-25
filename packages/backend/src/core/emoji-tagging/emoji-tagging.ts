/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 絵文字のタグ (aliases) とカテゴリを Claude に提案させるための、DI 不要の純粋関数と定数

/** 管理画面で選べるモデル。先頭が既定 */
export const EMOJI_TAGGING_MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'] as const;
export type EmojiTaggingModel = typeof EMOJI_TAGGING_MODELS[number];
export const DEFAULT_EMOJI_TAGGING_MODEL: EmojiTaggingModel = 'claude-sonnet-5-5';

/**
 * DB に入っているモデル名を、選べるモデルのどれかにする。選べないもの (提供が終わったものなど) は既定に戻す
 */
export function toEmojiTaggingModel(model: string): EmojiTaggingModel {
	return (EMOJI_TAGGING_MODELS as readonly string[]).includes(model) ? model as EmojiTaggingModel : DEFAULT_EMOJI_TAGGING_MODEL;
}

/** 1 つの絵文字に提案するタグの最大数 */
export const MAX_SUGGESTED_TAGS = 15;
/** 1 つのタグの最大文字数 (Misskey の aliases に上限は無いが、長い語は検索に使われない) */
export const MAX_TAG_LENGTH = 32;
/** 絵文字の名前とカテゴリの最大文字数 (プロンプトに入れるもの) */
export const MAX_PROMPT_NAME_LENGTH = 128;
/** 今のタグとして受け取る最大数 */
export const MAX_CURRENT_TAGS = 100;
/** ヒントの最大文字数 */
export const MAX_HINT_LENGTH = 200;
/** 再提案で除く語として受け取る最大数 (それまでの提案を何回分か渡す) */
export const MAX_EXCLUDED_TAGS = 100;
/** カテゴリ名の最大文字数 */
export const MAX_CATEGORY_LENGTH = 64;
/** カテゴリ一覧としてプロンプトに入れる最大数 */
export const MAX_PROMPT_CATEGORIES = 500;
/** Claude に送る画像の一辺の長さ (px) */
export const EMOJI_TAGGING_IMAGE_SIZE = 256;

/** 構造化出力の JSON スキーマ */
export const EMOJI_TAGS_SCHEMA = {
	type: 'object',
	properties: {
		tags: {
			type: 'array',
			items: { type: 'string' },
		},
		category: { type: 'string' },
	},
	required: ['tags', 'category'],
	additionalProperties: false,
} as const;

export const EMOJI_TAGGING_SYSTEM_PROMPT = `あなたは日本語の SNS (Misskey) のカスタム絵文字に、検索用のタグとカテゴリを付ける担当です。
このサーバーは 42 Tokyo (プログラミングスクール) の学生向けの学内 SNS です。
絵文字の画像と名前を見て、ユーザーが絵文字を探すときに打ちそうな言葉 (tags) と、絵文字を入れるカテゴリ (category) を提案してください。

タグの決まり:
- ${MAX_SUGGESTED_TAGS} 個以内。よく使われそうな順に並べる
- 表記ゆれを含める: ひらがな・カタカナ・漢字・ローマ字 (小文字、ヘボン式)・英語
- 意味の近い言葉、気持ちや場面を表す言葉、ネットでよく使われる言い方も含める
  例: 笑顔の絵文字なら「うれしい」「嬉しい」「やったー」「にこにこ」「smile」、泣き顔なら「かなしい」「泣き」「涙」「ぴえん」「sad」
- 画像に文字が書かれていれば、その文字とその読みを含める
- 42 の用語 (ピシン (Piscine)・norminette・peer・evaluation・blackhole など) が関係しそうなら含める
- 1 つのタグにスペースを含めない。記号だけのタグ、絵文字名とまったく同じタグは出さない
- 下品な言葉、人や集団を傷つける言葉、個人を特定する言葉は出さない
- 画像から読み取れない固有名詞をでっち上げない

カテゴリの決まり:
- 「今あるカテゴリ」の一覧に合うものがあれば、その名前を一字一句そのまま使う
- 合うものが無いときだけ、新しいカテゴリの名前を 1 つ考える。今あるカテゴリと同じ言語・同じ粒度・同じ書き方 (「/」で区切っていればそれも) に揃える
- 今のカテゴリが合っていれば、それをそのまま返す`;

/**
 * 今あるカテゴリの一覧をプロンプトの文にする。一覧はどの絵文字でも同じなので、システムプロンプトの後ろに置いてキャッシュする
 */
export function buildCategoryListPrompt(categories: string[]): string {
	if (categories.length === 0) return '今あるカテゴリ: (まだ無い)';
	return `今あるカテゴリ:\n${categories.slice(0, MAX_PROMPT_CATEGORIES).map(it => `- ${it}`).join('\n')}`;
}

export type EmojiTaggingRequest = {
	/** 絵文字の名前 (ショートコード) */
	name: string;
	category: string | null;
	/** 今付いているタグ。提案から除く */
	currentTags: string[];
	/** それまでに提案した語。再提案ではこれを除いて別の語を出させる */
	excludedTags: string[];
	/** 管理者が添えたヒント */
	hint: string | null;
};

/**
 * 画像と一緒に送る指示の文を作る
 */
export function buildEmojiTaggingPrompt(request: EmojiTaggingRequest): string {
	const lines = [`絵文字の名前: ${request.name}`];
	lines.push(`今のカテゴリ: ${request.category != null && request.category !== '' ? request.category : '(未設定)'}`);
	if (request.currentTags.length > 0) lines.push(`今付いているタグ (これは出さない): ${request.currentTags.join(' ')}`);
	if (request.excludedTags.length > 0) lines.push(`前に提案して採用されなかった語 (これは出さず、別の語を出す): ${request.excludedTags.join(' ')}`);
	if (request.hint != null && request.hint !== '') lines.push(`管理者からのヒント: ${request.hint}`);
	lines.push('この絵文字のタグとカテゴリを提案してください。');
	return lines.join('\n');
}

/**
 * タグを比べるときのキー。英字の大文字と小文字、全角と半角は区別しない
 */
function tagKey(tag: string): string {
	return tag.normalize('NFKC').toLowerCase();
}

/**
 * Claude が返したタグを Misskey の aliases として使える形に整える。
 * 空白を除き、長すぎるもの・記号だけのもの・絵文字名や今のタグや除く語と同じものを外し、重複を除いて最大数までにする
 */
export function normalizeSuggestedTags(raw: unknown, options: { name: string; currentTags: string[]; excludedTags: string[] }): string[] {
	if (!Array.isArray(raw)) return [];

	const blocked = new Set([options.name, ...options.currentTags, ...options.excludedTags].map(tagKey));
	const seen = new Set<string>();
	const result: string[] = [];

	for (const item of raw) {
		if (typeof item !== 'string') continue;
		// aliases はスペース区切りで編集するので、タグの中の空白は詰める
		const tag = item.normalize('NFC').replace(/\s+/gu, '');
		if (tag === '' || [...tag].length > MAX_TAG_LENGTH) continue;
		// 文字も数字も含まないもの (記号だけ) は検索に使えない
		if (!/[\p{L}\p{N}]/u.test(tag)) continue;

		const key = tagKey(tag);
		if (blocked.has(key) || seen.has(key)) continue;
		seen.add(key);
		result.push(tag);
		if (result.length >= MAX_SUGGESTED_TAGS) break;
	}

	return result;
}

/**
 * API キーを画面やログに出すときの形。末尾 4 文字だけ残す
 */
export function maskApiKey(key: string | null): string | null {
	if (key == null || key === '') return null;
	// 短すぎるキーは末尾だけでも大半が見えてしまうので出さない
	return key.length < 12 ? '****' : key.slice(-4);
}

export type SuggestedCategory = {
	name: string;
	/** 今あるカテゴリに無い (新しく作る) なら true */
	isNew: boolean;
};

/**
 * Claude が返したカテゴリを整える。今あるカテゴリと (大文字小文字・全角半角を除いて) 同じなら、今あるほうの名前にそろえる
 */
export function normalizeSuggestedCategory(raw: unknown, categories: string[]): SuggestedCategory | null {
	if (typeof raw !== 'string') return null;
	const name = raw.normalize('NFC').trim().replace(/\s+/gu, ' ');
	if (name === '' || [...name].length > MAX_CATEGORY_LENGTH) return null;

	const existing = categories.find(it => tagKey(it) === tagKey(name));
	return existing != null ? { name: existing, isNew: false } : { name, isNew: true };
}

/**
 * ローカルの絵文字のカテゴリを、重複を除いて名前順に並べる
 */
export function collectCategories(categories: (string | null)[]): string[] {
	return [...new Set(categories.filter((it): it is string => it != null && it !== ''))].sort((a, b) => a.localeCompare(b, 'ja'));
}
