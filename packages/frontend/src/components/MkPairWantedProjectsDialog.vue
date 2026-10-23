<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModalWindow
	ref="dialog"
	:width="400"
	:height="420"
	@close="dialog?.close()"
	@closed="emit('closed')"
>
	<template #header>{{ i18n.ts._pairRecruitment.selectWantedProjects }}</template>

	<div class="_spacer" style="--MI_SPACER-min: 16px; --MI_SPACER-max: 20px;">
		<div class="_gaps_s">
			<div :class="$style.rows">
				<button
					v-for="p in recruitment.projects"
					:key="p.slug"
					type="button"
					role="checkbox"
					class="_button"
					:class="$style.row"
					:aria-checked="selected.has(p.slug)"
					:disabled="!canWorkOn(p.myState)"
					@click="toggle(p.slug)"
				>
					<span :class="[$style.checkbox, { [$style.checked]: selected.has(p.slug) }]" aria-hidden="true">
						<i v-if="selected.has(p.slug)" class="ti ti-check"></i>
					</span>
					<b :class="$style.name">{{ p.name }}</b>
					<MkPairProjectStateBadge v-if="p.myState != null" :state="p.myState"/>
				</button>
			</div>
			<div :class="$style.rows">
				<button
					type="button"
					role="checkbox"
					class="_button"
					:class="$style.row"
					:aria-checked="isAll"
					:disabled="workable.length === 0"
					@click="toggleAll"
				>
					<span :class="[$style.checkbox, { [$style.checked]: isAll }]" aria-hidden="true">
						<i v-if="isAll" class="ti ti-check"></i>
					</span>
					<span :class="$style.name">{{ i18n.ts._pairRecruitment.anyProject }}</span>
				</button>
			</div>
		</div>
	</div>

	<template #footer>
		<div class="_buttons" :class="$style.footer">
			<MkButton rounded @click="dialog?.close()">{{ i18n.ts.cancel }}</MkButton>
			<MkButton primary rounded :disabled="selected.size === 0" @click="done">{{ i18n.ts._pairRecruitment.sendApplication }}</MkButton>
		</div>
	</template>
</MkModalWindow>
</template>

<script lang="ts" setup>
// 複数の課題をまとめた募集に参加希望を送る前に、希望する課題を選ぶダイアログ。
// 開くときは utility/pair-recruitment-dialog.ts の openPairWantedProjectsDialog を使う
import { computed, ref, useTemplateRef } from 'vue';
import type * as Misskey from 'misskey-js';
import MkButton from '@/components/MkButton.vue';
import MkModalWindow from '@/components/MkModalWindow.vue';
import MkPairProjectStateBadge from '@/components/MkPairProjectStateBadge.vue';
import { i18n } from '@/i18n.js';
import { canWorkOn } from '@/utility/pair-recruitment.js';

const props = defineProps<{
	recruitment: Misskey.entities.PairRecruitment;
}>();

const emit = defineEmits<{
	(ev: 'done', slugs: string[]): void;
	(ev: 'closed'): void;
}>();

const dialog = useTemplateRef('dialog');

/** 自分が取り組める課題 (未解放・完了済みは選べない) */
const workable = computed(() => props.recruitment.projects.filter(p => canWorkOn(p.myState)).map(p => p.slug));
const selected = ref(new Set<string>(workable.value.length === 1 ? workable.value : []));
const isAll = computed(() => workable.value.length > 0 && workable.value.every(slug => selected.value.has(slug)));

function toggle(slug: string) {
	const next = new Set(selected.value);
	if (next.has(slug)) next.delete(slug);
	else next.add(slug);
	selected.value = next;
}

function toggleAll() {
	selected.value = isAll.value ? new Set() : new Set(workable.value);
}

function done() {
	if (selected.value.size === 0) return;
	// 募集の並び順で返す
	emit('done', props.recruitment.projects.map(p => p.slug).filter(slug => selected.value.has(slug)));
	dialog.value?.close();
}
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
	gap: 12px;
	min-height: 48px;
	padding: 10px 14px;
	text-align: left;

	& + & {
		border-top: solid 0.5px var(--MI_THEME-divider);
	}

	&:not(:disabled):hover {
		background: var(--MI_THEME-panelHighlight);
	}

	&:disabled {
		cursor: default;
		opacity: 0.5;
	}
}

.name {
	flex: 1;
	min-width: 0;
}

.checkbox {
	flex: none;
	width: 20px;
	height: 20px;
	display: grid;
	place-items: center;
	box-sizing: border-box;
	border: solid 2px var(--MI_THEME-divider);
	border-radius: 5px;
	font-size: 14px;
	color: var(--MI_THEME-fgOnAccent);

	&.checked {
		border-color: var(--MI_THEME-accent);
		background: var(--MI_THEME-accent);
	}
}

.footer {
	justify-content: flex-end;
}
</style>
