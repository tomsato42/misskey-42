<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="[$style.root, { [$style.canceled]: event.isCanceled }]">
	<MkA :to="`/calendar/events/${event.id}`" :class="$style.main" :title="i18n.ts._calendar.openEvent" :aria-label="linkLabel">
		<div :class="$style.dateBox" aria-hidden="true">
			<span>{{ i18n.tsx.monthX({ month: date.month }) }}</span>
			<b>{{ date.day }}</b>
			<span>{{ getWeekdayShortLabel(weekday) }}</span>
		</div>
		<div :class="$style.info">
			<b :class="$style.title">{{ event.title }}</b>
			<small :class="$style.meta">
				<span v-if="event.isCanceled" :class="$style.canceledLabel">{{ i18n.ts._calendar.canceled }}</span>
				<span>{{ metaText }}</span>
			</small>
		</div>
	</MkA>
	<template v-if="!event.isCanceled && !mock">
		<MkButton v-if="subscribed === true" v-tooltip="i18n.ts._calendar.unsubscribe" primary rounded small :disabled="busy" aria-pressed="true" @click="unsubscribe">
			<i class="ti ti-bell-ringing"></i> {{ i18n.ts._calendar.subscribed }}
		</MkButton>
		<MkButton v-else rounded small :disabled="busy" @click="subscribe">
			<i class="ti ti-bell"></i> {{ i18n.ts._calendar.subscribe }}
		</MkButton>
	</template>
</div>
</template>

<script lang="ts" setup>
// ノートに紐づいたイベントのカード (MkNote / MkNoteDetailed の本文の下)。押すとイベントのページを開く。
// ストリーミングで届いたノートのイベントには isSubscribed が無いので、そのときは「購読」を出し、押したら API の結果で状態を決める
import { computed, inject, ref, watch } from 'vue';
import * as Misskey from 'misskey-js';
import MkButton from '@/components/MkButton.vue';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { DI } from '@/di.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { dayOfWeek, parseCalendarDate } from '@/utility/calendar.js';
import { formatCalendarDay, formatCalendarEventTime, getCalendarApiErrorMessage, getWeekdayShortLabel } from '@/utility/calendar-event-messages.js';

const props = defineProps<{
	event: Misskey.entities.CalendarEventLite;
}>();

const mock = inject(DI.mock, false);

/** 購読しているか。分からないとき (ストリーミングで届いたノート) は undefined */
const subscribed = ref<boolean | undefined>(props.event.isSubscribed);
const subscribersCount = ref(props.event.subscribersCount);
const busy = ref(false);

watch(() => props.event, (event) => {
	subscribed.value = event.isSubscribed;
	subscribersCount.value = event.subscribersCount;
});

const date = computed(() => parseCalendarDate(props.event.date) ?? { year: 0, month: 0, day: 0 });
const weekday = computed(() => parseCalendarDate(props.event.date) != null ? dayOfWeek(props.event.date) : 0);

const metaText = computed(() => [
	formatCalendarEventTime(props.event),
	props.event.location,
	i18n.tsx._calendar.subscribersShort({ n: subscribersCount.value }),
].filter(x => x != null && x !== '').join(' ・ '));

// 日付の箱は aria-hidden にしているので、読み上げ用のラベルには日付を入れる
const linkLabel = computed(() => [
	props.event.isCanceled ? i18n.ts._calendar.canceled : null,
	props.event.title,
	formatCalendarDay(props.event.date),
	metaText.value,
].filter(x => x != null).join(' '));

function apply(event: Misskey.entities.CalendarEvent) {
	subscribed.value = event.isSubscribed;
	subscribersCount.value = event.subscribersCount;
}

async function subscribe() {
	if (busy.value) return;
	busy.value = true;
	try {
		apply(await misskeyApi('calendar/events/subscribe', { eventId: props.event.id }));
	} catch (err) {
		os.alert({ type: 'error', ...getCalendarApiErrorMessage(err) });
	} finally {
		busy.value = false;
	}
}

async function unsubscribe() {
	if (busy.value) return;
	busy.value = true;
	try {
		apply(await misskeyApi('calendar/events/unsubscribe', { eventId: props.event.id }));
	} catch (err) {
		os.alert({ type: 'error', ...getCalendarApiErrorMessage(err) });
	} finally {
		busy.value = false;
	}
}
</script>

<style lang="scss" module>
.root {
	display: flex;
	align-items: center;
	gap: 12px;
	margin-top: 10px;
	padding: 12px;
	border: solid 0.5px var(--MI_THEME-divider);
	border-radius: 8px;
}

.main {
	flex: 1;
	min-width: 0;
	display: flex;
	align-items: center;
	gap: 12px;
	color: inherit;

	&:hover {
		text-decoration: none;

		.title {
			text-decoration: underline;
		}
	}
}

.dateBox {
	width: 44px;
	flex: none;
	text-align: center;
	border-radius: 8px;
	background: var(--MI_THEME-buttonBg);
	padding: 3px 0;
	font-size: 0.75em;
	line-height: 1.25;

	> b {
		display: block;
		font-size: 1.5em;
	}
}

.info {
	flex: 1;
	min-width: 0;
}

.title {
	display: block;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.meta {
	display: block;
	font-size: 0.85em;
	opacity: 0.7;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.canceledLabel {
	margin-right: 0.5em;
	color: var(--MI_THEME-error);
	font-weight: bold;
}

.canceled {
	.title {
		text-decoration: line-through;
		opacity: 0.7;
	}
}

@container (max-width: 400px) {
	.root {
		flex-wrap: wrap;
	}
}
</style>
