<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModal ref="modal" v-slot="{ type }" :zPriority="'high'" :anchorElement="anchorElement" @click="modal?.close()" @closed="emit('closed')" @esc="modal?.close()">
	<div class="_popup" :class="{ [$style.root]: true, [$style.asDrawer]: type === 'drawer' }" role="menu" :aria-label="i18n.ts._calendar.visibility">
		<div :class="[$style.label, $style.item]" aria-hidden="true">
			{{ i18n.ts._calendar.visibility }}
		</div>
		<button
			v-for="visibility in calendarEventVisibilities"
			:key="visibility"
			class="_button"
			:class="[$style.item, { [$style.active]: v === visibility }]"
			role="menuitemradio"
			:aria-checked="v === visibility"
			@click="choose(visibility)"
		>
			<div :class="$style.icon"><i :class="getCalendarVisibilityIcon(visibility)"></i></div>
			<div :class="$style.body">
				<span :class="$style.itemTitle">{{ getCalendarVisibilityLabel(visibility) }}</span>
				<span :class="$style.itemDescription">{{ getCalendarVisibilityDescription(visibility) }}</span>
			</div>
		</button>
	</div>
</MkModal>
</template>

<script lang="ts" setup>
// イベントの公開範囲を選ぶポップアップ。投稿の公開範囲 (MkVisibilityPicker) と同じ見た目にする
import { nextTick, ref, useTemplateRef } from 'vue';
import MkModal from '@/components/MkModal.vue';
import { i18n } from '@/i18n.js';
import { calendarEventVisibilities, getCalendarVisibilityIcon } from '@/utility/calendar-visibility.js';
import type { CalendarEventVisibility } from '@/utility/calendar-visibility.js';
import { getCalendarVisibilityDescription, getCalendarVisibilityLabel } from '@/utility/calendar-event-messages.js';

const modal = useTemplateRef('modal');

const props = defineProps<{
	currentVisibility: CalendarEventVisibility;
	anchorElement?: HTMLElement | null;
}>();

const emit = defineEmits<{
	(ev: 'changeVisibility', v: CalendarEventVisibility): void;
	(ev: 'closed'): void;
}>();

const v = ref(props.currentVisibility);

function choose(visibility: CalendarEventVisibility): void {
	v.value = visibility;
	emit('changeVisibility', visibility);
	nextTick(() => {
		if (modal.value) modal.value.close();
	});
}
</script>

<style lang="scss" module>
.root {
	min-width: 240px;
	padding: 8px 0;

	&.asDrawer {
		padding: 12px 0 max(env(safe-area-inset-bottom, 0px), 12px) 0;
		width: 100%;
		border-radius: 24px;
		border-bottom-right-radius: 0;
		border-bottom-left-radius: 0;

		.label {
			pointer-events: none;
			font-size: 12px;
			padding-bottom: 4px;
			opacity: 0.7;
		}

		.item {
			font-size: 14px;
			padding: 10px 24px;
		}
	}
}

.label {
	pointer-events: none;
	font-size: 10px;
	padding-bottom: 4px;
	opacity: 0.7;
}

.item {
	display: flex;
	padding: 8px 14px;
	font-size: 12px;
	text-align: left;
	width: 100%;
	box-sizing: border-box;

	&:hover {
		background: color(from var(--MI_THEME-fg) srgb r g b / 0.05);
	}

	&:active {
		background: color(from var(--MI_THEME-fg) srgb r g b / 0.1);
	}

	&.active {
		color: var(--MI_THEME-accent);
	}
}

.icon {
	display: flex;
	justify-content: center;
	align-items: center;
	margin-right: 10px;
	width: 16px;
	margin-top: auto;
	margin-bottom: auto;
}

.body {
	flex: 1 1 auto;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.itemTitle {
	display: block;
	font-weight: bold;
}

.itemDescription {
	opacity: 0.6;
}
</style>
