<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<SearchMarker path="/settings/calendar" :label="i18n.ts._calendar.feed" :keywords="['calendar', 'feed', 'ical', 'ics', 'google', 'apple', 'outlook']" icon="ti ti-rss">
	<div class="_gaps_m">
		<MkInfo><SearchText>{{ i18n.ts._calendar._feed.description }}</SearchText></MkInfo>

		<template v-if="feed != null">
			<SearchMarker :keywords="['calendar', 'feed', 'subscribed']">
				<MkFolder :defaultOpen="true">
					<template #icon><SearchIcon><i class="ti ti-bell-ringing"></i></SearchIcon></template>
					<template #label><SearchLabel>{{ i18n.ts._calendar._feed.subscribed }}</SearchLabel></template>
					<template #caption>{{ i18n.ts._calendar._feed.subscribedCaption }}</template>

					<div class="_gaps_s">
						<div :class="$style.copyRow">
							<MkInput :modelValue="feed.subscribedUrl" readonly :class="$style.url"><template #label>{{ i18n.ts._calendar._feed.subscribedUrl }}</template></MkInput>
							<MkButton @click="copy(feed.subscribedUrl)"><i class="ti ti-copy"></i> {{ i18n.ts.copy }}</MkButton>
						</div>
						<div class="_buttons">
							<MkButton type="a" :href="buildGoogleCalendarSubscribeUrl(feed.subscribedUrl)" target="_blank" rel="noopener" rounded><i class="ti ti-brand-google"></i> {{ i18n.ts._calendar._feed.addToGoogle }}</MkButton>
							<MkButton type="a" :href="toWebcalUrl(feed.subscribedUrl)" rounded><i class="ti ti-calendar-plus"></i> {{ i18n.ts._calendar._feed.openInApps }}</MkButton>
						</div>
					</div>
				</MkFolder>
			</SearchMarker>

			<SearchMarker :keywords="['calendar', 'feed', 'all']">
				<MkFolder :defaultOpen="true">
					<template #icon><SearchIcon><i class="ti ti-calendar"></i></SearchIcon></template>
					<template #label><SearchLabel>{{ i18n.ts._calendar._feed.all }}</SearchLabel></template>
					<template #caption>{{ i18n.ts._calendar._feed.allCaption }}</template>

					<div class="_gaps_s">
						<div :class="$style.copyRow">
							<MkInput :modelValue="feed.allUrl" readonly :class="$style.url"><template #label>{{ i18n.ts._calendar._feed.allUrl }}</template></MkInput>
							<MkButton @click="copy(feed.allUrl)"><i class="ti ti-copy"></i> {{ i18n.ts.copy }}</MkButton>
						</div>
						<div class="_buttons">
							<MkButton type="a" :href="buildGoogleCalendarSubscribeUrl(feed.allUrl)" target="_blank" rel="noopener" rounded><i class="ti ti-brand-google"></i> {{ i18n.ts._calendar._feed.addToGoogle }}</MkButton>
							<MkButton type="a" :href="toWebcalUrl(feed.allUrl)" rounded><i class="ti ti-calendar-plus"></i> {{ i18n.ts._calendar._feed.openInApps }}</MkButton>
						</div>
					</div>
				</MkFolder>
			</SearchMarker>
		</template>
		<MkError v-else-if="error" @retry="fetchFeed()"/>
		<MkLoading v-else/>

		<MkInfo warn>{{ i18n.ts._calendar._feed.warning }}</MkInfo>

		<SearchMarker :keywords="['calendar', 'feed', 'regenerate', 'reset']">
			<MkFolder>
				<template #icon><SearchIcon><i class="ti ti-refresh"></i></SearchIcon></template>
				<template #label><SearchLabel>{{ i18n.ts._calendar._feed.regenerate }}</SearchLabel></template>
				<template #caption>{{ i18n.ts._calendar._feed.regenerateCaption }}</template>

				<MkButton danger rounded :disabled="regenerating" @click="regenerate"><i class="ti ti-refresh"></i> {{ i18n.ts._calendar._feed.regenerate }}</MkButton>
			</MkFolder>
		</SearchMarker>

		<SearchMarker :keywords="['calendar', 'feed', 'help']">
			<MkFolder>
				<template #icon><SearchIcon><i class="ti ti-help-circle"></i></SearchIcon></template>
				<template #label><SearchLabel>{{ i18n.ts._calendar._feed.howToAdd }}</SearchLabel></template>

				<ol :class="$style.steps">
					<li>{{ i18n.ts._calendar._feed.howToGoogle }}</li>
					<li>{{ i18n.ts._calendar._feed.howToApple }}</li>
					<li>{{ i18n.ts._calendar._feed.howToOutlook }}</li>
				</ol>
			</MkFolder>
		</SearchMarker>
	</div>
</SearchMarker>
</template>

<script lang="ts" setup>
// 42times: カレンダー連携。カレンダーアプリが読み込む配信 (.ics) の URL を出す。
// i/calendar-feed は secure な API (公式のクライアントのトークンでだけ呼べる) で、Web クライアントからは misskeyApi でそのまま呼べる
import { computed, ref } from 'vue';
import * as Misskey from 'misskey-js';
import MkButton from '@/components/MkButton.vue';
import MkFolder from '@/components/MkFolder.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkInput from '@/components/MkInput.vue';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { copyToClipboard } from '@/utility/copy-to-clipboard.js';
import { buildGoogleCalendarSubscribeUrl, toWebcalUrl } from '@/utility/calendar-feed.js';
import { getCalendarApiErrorMessage } from '@/utility/calendar-event-messages.js';

const feed = ref<Misskey.entities.CalendarFeedUrls | null>(null);
const error = ref(false);
const regenerating = ref(false);

async function fetchFeed() {
	error.value = false;
	try {
		feed.value = await misskeyApi('i/calendar-feed');
	} catch (err) {
		console.error(err);
		error.value = true;
	}
}

fetchFeed();

function copy(url: string) {
	copyToClipboard(url);
}

async function regenerate() {
	if (regenerating.value) return;
	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.ts._calendar._feed.regenerateConfirm,
	});
	if (canceled) return;

	regenerating.value = true;
	try {
		feed.value = await misskeyApi('i/calendar-feed/regenerate');
		os.success();
	} catch (err) {
		os.alert({ type: 'error', ...getCalendarApiErrorMessage(err) });
	} finally {
		regenerating.value = false;
	}
}

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: i18n.ts._calendar.feed,
	icon: 'ti ti-rss',
}));
</script>

<style lang="scss" module>
.copyRow {
	display: flex;
	// 入力欄のラベルの分だけ、ボタンを入力部分の高さにそろえる
	align-items: flex-end;
	gap: 8px;
}

.url {
	flex: 1;
	min-width: 0;
}

.steps {
	margin: 0;
	padding-left: 1.4em;
	line-height: 1.6;
}
</style>
