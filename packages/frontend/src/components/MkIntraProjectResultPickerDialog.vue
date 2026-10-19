<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModalWindow
	ref="dialog"
	:width="400"
	:height="520"
	@close="dialog?.close()"
	@closed="emit('closed')"
>
	<template #header>{{ i18n.ts._intraProjectResult.selectProject }}</template>

	<div class="_spacer" style="--MI_SPACER-min: 16px; --MI_SPACER-max: 20px;">
		<MkError v-if="fetchError" @retry="fetchResults()"/>
		<MkLoading v-else-if="results == null"/>
		<MkResult v-else-if="results.length === 0" type="empty" :text="i18n.ts._intraProjectResult.noResults"/>
		<div v-else :class="$style.rows">
			<button
				v-for="r in results"
				:key="r.id"
				type="button"
				class="_button"
				:class="$style.row"
				:aria-label="getIntraProjectResultLabel(r)"
				@click="select(r)"
			>
				<MkIntraProjectResultTile :finalMark="r.finalMark" :validated="r.validated" small/>
				<b :class="$style.name">{{ r.projectName }}</b>
				<MkIntraProjectResultStars v-if="r.outstandingCount != null" :count="r.outstandingCount"/>
			</button>
		</div>
	</div>
</MkModalWindow>
</template>

<script lang="ts" setup>
// 点数を共有する課題を選ぶダイアログ。点数の付いた課題を、結果が出た日時の新しい順に出す。
// 開くときは utility/intra-project-result.ts の openIntraProjectResultPicker を使う
import { onMounted, ref, useTemplateRef } from 'vue';
import type * as Misskey from 'misskey-js';
import MkModalWindow from '@/components/MkModalWindow.vue';
import MkIntraProjectResultTile from '@/components/MkIntraProjectResultTile.vue';
import MkIntraProjectResultStars from '@/components/MkIntraProjectResultStars.vue';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { getIntraProjectResultLabel } from '@/utility/intra-project-result.js';

const emit = defineEmits<{
	(ev: 'done', result: Misskey.entities.IntraProjectResult): void;
	(ev: 'closed'): void;
}>();

const dialog = useTemplateRef('dialog');
const results = ref<Misskey.entities.IntraProjectResult[] | null>(null);
const fetchError = ref(false);

async function fetchResults() {
	fetchError.value = false;
	results.value = null;
	try {
		results.value = await misskeyApi('i/intra/project-results');
	} catch (err) {
		console.error(err);
		fetchError.value = true;
	}
}

function select(result: Misskey.entities.IntraProjectResult) {
	emit('done', result);
	dialog.value?.close();
}

onMounted(() => {
	fetchResults();
});
</script>

<style lang="scss" module>
.rows {
	display: flex;
	flex-direction: column;
	border-radius: 8px;
	overflow: clip;
	background: var(--MI_THEME-panel);
}

.row {
	display: flex;
	align-items: center;
	gap: 10px;
	min-height: 48px;
	padding: 8px 12px;
	text-align: left;

	& + & {
		border-top: solid 0.5px var(--MI_THEME-divider);
	}

	&:hover {
		background: var(--MI_THEME-panelHighlight);
	}
}

.name {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	color: #00898b;
}
</style>
