<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkContainer :showHeader="widgetProps.showHeader" data-testid="mkw-upcomingCalendarEvents" class="mkw-upcomingCalendarEvents">
	<template #icon><i class="ti ti-calendar-event"></i></template>
	<template #header>{{ i18n.ts._widgets.upcomingCalendarEvents }}</template>
	<template #func="{ buttonStyleClass }">
		<MkA v-tooltip="i18n.ts._calendar.calendar" :class="buttonStyleClass" to="/calendar" :aria-label="i18n.ts._calendar.calendar"><i class="ti ti-calendar"></i></MkA>
	</template>

	<MkLoading v-if="fetching"/>
	<MkError v-else-if="error" @retry="fetch()"/>
	<div v-else-if="events.length === 0" :class="$style.empty">{{ i18n.ts._calendar.noUpcomingEvents }}</div>
	<div v-else>
		<MkA v-for="event in events" :key="event.id" :to="`/calendar/events/${event.id}`" :class="$style.item">
			<div :class="$style.dateBox" aria-hidden="true">
				<span>{{ i18n.tsx.monthX({ month: dateOf(event).month }) }}</span>
				<b>{{ dateOf(event).day }}</b>
			</div>
			<div :class="$style.body">
				<b :class="$style.title">{{ event.title }}</b>
				<div :class="$style.meta">{{ metaOf(event) }}</div>
			</div>
		</MkA>
	</div>
</MkContainer>
</template>

<script lang="ts" setup>
// 42times: 近日のイベント (calendar/events/upcoming)。押すとイベントのページ、ヘッダーのボタンでカレンダー画面を開く
import { ref, watch } from 'vue';
import * as Misskey from 'misskey-js';
import { useInterval } from '@@/js/use-interval.js';
import { useWidgetPropsManager } from './widget.js';
import type { WidgetComponentEmits, WidgetComponentExpose, WidgetComponentProps } from './widget.js';
import type { FormWithDefault, GetFormResultType } from '@/utility/form.js';
import MkContainer from '@/components/MkContainer.vue';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';
import { parseCalendarDate } from '@/utility/calendar.js';
import { formatCalendarDay, formatCalendarEventTime } from '@/utility/calendar-event-messages.js';

const name = 'upcomingCalendarEvents';

const widgetPropsDef = {
	showHeader: {
		type: 'boolean',
		label: i18n.ts._widgetOptions.showHeader,
		default: true,
	},
	limit: {
		type: 'range',
		label: i18n.ts._calendar.widgetLimit,
		default: 5,
		min: 1,
		max: 10,
		step: 1,
	},
	filter: {
		type: 'radio',
		label: i18n.ts._calendar.widgetFilter,
		default: 'all',
		options: [{
			value: 'all' as const,
			label: i18n.ts._calendar.all,
		}, {
			value: 'subscribed' as const,
			label: i18n.ts._calendar.subscribed,
		}],
	},
} satisfies FormWithDefault;

type WidgetProps = GetFormResultType<typeof widgetPropsDef>;

const props = defineProps<WidgetComponentProps<WidgetProps>>();
const emit = defineEmits<WidgetComponentEmits<WidgetProps>>();

const { widgetProps, configure } = useWidgetPropsManager(name,
	widgetPropsDef,
	props,
	emit,
);

const events = ref<Misskey.entities.CalendarEvent[]>([]);
const fetching = ref(true);
const error = ref(false);

// 定期の取得と設定の変更による取得が重なったとき、古い応答で上書きしないための連番
let requestSeq = 0;

async function fetch() {
	const seq = ++requestSeq;
	try {
		const res = await misskeyApi('calendar/events/upcoming', {
			limit: Math.min(Math.max(Math.round(widgetProps.limit), 1), 30),
			filter: widgetProps.filter,
		});
		if (seq !== requestSeq) return;
		events.value = res;
		error.value = false;
	} catch (err) {
		if (seq !== requestSeq) return;
		console.error(err);
		error.value = true;
	} finally {
		if (seq === requestSeq) fetching.value = false;
	}
}

useInterval(fetch, 1000 * 60 * 5, {
	immediate: true,
	afterMounted: true,
});

watch(() => [widgetProps.limit, widgetProps.filter], () => {
	fetch();
});

function dateOf(event: Misskey.entities.CalendarEvent) {
	return parseCalendarDate(event.date) ?? { year: 0, month: 0, day: 0 };
}

/** 「10月20日(火) 12:00〜 ・ c3 ・ 購読中」 */
function metaOf(event: Misskey.entities.CalendarEvent): string {
	return [
		`${formatCalendarDay(event.date)} ${formatCalendarEventTime(event)}`,
		event.location,
		event.isSubscribed ? i18n.ts._calendar.subscribed : null,
	].filter(x => x != null && x !== '').join(' ・ ');
}

defineExpose<WidgetComponentExpose>({
	name,
	configure,
	id: props.widget ? props.widget.id : null,
});
</script>

<style lang="scss" module>
.empty {
	padding: 16px;
	text-align: center;
	font-size: 0.9em;
	opacity: 0.7;
}

.item {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 10px 16px;
	color: inherit;

	&:hover {
		text-decoration: none;
		background: var(--MI_THEME-panelHighlight);
	}

	& + .item {
		border-top: solid 0.5px var(--MI_THEME-divider);
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

.body {
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
	font-size: 0.85em;
	opacity: 0.7;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
</style>
