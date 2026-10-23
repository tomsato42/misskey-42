<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!-- 42times: タイムラインのリプライの上に、スレッドの最初のノートと直前のノートを並べる -->
<template>
<div :class="$style.root">
	<MkNoteSub v-if="threadRoot != null" :note="threadRoot" :class="$style.threadRoot" :clickToOpen="true" :lineBelow="true"/>
	<div v-if="context.showGap" :class="$style.gap">
		<MkA class="_link" :to="notePage(note)">{{ i18n.ts.continueThread }} <i class="ti ti-chevron-double-right"></i></MkA>
	</div>
	<MkNoteSub :note="note.reply ?? null" :class="$style.parent" :clickToOpen="true" :lineAbove="threadRoot != null || context.showGap"/>
</div>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import * as Misskey from 'misskey-js';
import MkNoteSub from '@/components/MkNoteSub.vue';
import { notePage } from '@/filters/note.js';
import { i18n } from '@/i18n.js';
import { fetchThreadRoot, getReplyContext } from '@/utility/reply-context.js';

const props = defineProps<{
	note: Misskey.entities.Note;
}>();

const context = computed(() => getReplyContext(props.note));
const threadRoot = ref<Misskey.entities.Note | null>(null);

watch(() => context.value.rootId, (rootId) => {
	threadRoot.value = null;
	if (rootId == null) return;
	fetchThreadRoot(rootId).then(note => {
		if (context.value.rootId === rootId) threadRoot.value = note;
	});
}, { immediate: true });
</script>

<style lang="scss" module>
.root > .threadRoot {
	padding-bottom: 8px;
}

.root > .parent {
	padding-bottom: 0;
}

.gap {
	position: relative;
	padding: 6px 32px 6px calc(32px + 38px + 8px);
	font-size: 0.9em;

	// アイコンの中心を通る点線 (MkNoteSub の縦線とつなぐ)
	&::before {
		content: "";
		position: absolute;
		top: 0;
		bottom: 0;
		left: calc(32px + 19px - 1px);
		border-left: 2px dotted var(--MI_THEME-divider);
		pointer-events: none;
	}
}

@container (max-width: 450px) {
	.gap {
		padding: 6px 16px 6px calc(16px + 38px + 8px);

		&::before {
			left: calc(16px + 19px - 1px);
		}
	}
}
</style>
