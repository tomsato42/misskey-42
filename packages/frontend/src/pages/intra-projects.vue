<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader>
	<div class="_spacer" style="--MI_SPACER-w: 600px;">
		<div class="_gaps">
			<div :class="$style.toolbar">
				<MkButton rounded :disabled="refreshing" @click="refresh">
					<i :class="refreshing ? 'ti ti-loader-2' : 'ti ti-refresh'"></i> {{ refreshing ? i18n.ts._intraProjectResult.refreshing : i18n.ts._intraProjectResult.refresh }}
				</MkButton>
			</div>

			<MkError v-if="fetchError" @retry="fetchResults()"/>
			<MkLoading v-else-if="results == null"/>
			<MkResult v-else-if="results.length === 0" type="empty" :text="i18n.ts._intraProjectResult.noResults"/>
			<div v-else class="_panel" :class="$style.rows">
				<div v-for="r in results" :key="r.id" :class="$style.row">
					<MkIntraProjectResultTile :finalMark="r.finalMark" :validated="r.validated" small/>
					<b :class="$style.name">{{ r.projectName }}</b>
					<MkIntraProjectResultStars v-if="r.outstandingCount != null" :count="r.outstandingCount"/>
					<MkButton primary rounded small :aria-label="`${i18n.ts._intraProjectResult.post}: ${getIntraProjectResultLabel(r)}`" @click="share(r)">
						{{ i18n.ts._intraProjectResult.post }}
					</MkButton>
				</div>
			</div>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
// 42times: 点数を共有。点数の付いた課題を、結果が出た日時の新しい順に出し、選んだ課題のカードを付けた投稿フォームを開く。
// 再取得は 42 API から取得し終えると intraProjectsRefreshed が通知されるので、届いたら一覧を読み直す
import { onBeforeUnmount, onMounted, ref } from 'vue';
import * as Misskey from 'misskey-js';
import MkButton from '@/components/MkButton.vue';
import MkIntraProjectResultTile from '@/components/MkIntraProjectResultTile.vue';
import MkIntraProjectResultStars from '@/components/MkIntraProjectResultStars.vue';
import * as os from '@/os.js';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import { useStream } from '@/stream.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { getIntraProjectResultLabel, getIntraRefreshErrorMessage } from '@/utility/intra-project-result.js';

const results = ref<Misskey.entities.IntraProjectResult[] | null>(null);
const fetchError = ref(false);
const refreshing = ref(false);

async function fetchResults() {
	fetchError.value = false;
	try {
		results.value = await misskeyApi('i/intra/project-results');
	} catch (err) {
		console.error(err);
		fetchError.value = true;
	}
}

async function refresh() {
	if (refreshing.value) return;
	refreshing.value = true;
	try {
		await misskeyApi('i/intra/refresh-project-results');
	} catch (err) {
		const code = (err as Partial<Misskey.api.APIError>).code;
		// 取得中 (別の画面で押したときなど) なら、終わるのを待つ
		if (code !== 'INTRA_REFRESH_IN_PROGRESS') refreshing.value = false;
		os.alert({ type: 'error', text: getIntraRefreshErrorMessage(err) });
	}
}

function share(result: Misskey.entities.IntraProjectResult) {
	os.post({ initialIntraProjectResult: result });
}

const connection = useStream().useChannel('main');
connection.on('notification', (notification) => {
	if (notification.type !== 'intraProjectsRefreshed') return;
	refreshing.value = false;
	fetchResults();
});

onMounted(() => {
	fetchResults();
});

onBeforeUnmount(() => {
	connection.dispose();
});

definePage(() => ({
	title: i18n.ts._intraProjectResult.share,
	icon: 'ti ti-trophy',
}));
</script>

<style lang="scss" module>
.toolbar {
	display: flex;
	justify-content: flex-end;
}

.rows {
	display: flex;
	flex-direction: column;
	overflow: clip;
}

.row {
	display: flex;
	align-items: center;
	gap: 10px;
	min-height: 48px;
	padding: 8px 14px;

	& + & {
		border-top: solid 0.5px var(--MI_THEME-divider);
	}
}

.name {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	// intra の課題の名前の色
	color: #00898b;
}
</style>
