<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModalWindow
	ref="dialog"
	:width="500"
	:height="720"
	@close="dialog?.close()"
	@closed="emit('closed')"
>
	<template #header>{{ event ? i18n.ts._calendar.editEvent : i18n.ts._calendar.createEvent }}</template>

	<div class="_spacer" style="--MI_SPACER-min: 20px; --MI_SPACER-max: 28px;">
		<MkCalendarEventForm v-model="form" :errors="errors" :disabled="submitting" :autofocus="event == null"/>
	</div>

	<template #footer>
		<div :class="$style.footer">
			<MkButton primary rounded :wait="submitting" :disabled="submitting" @click="submit">
				<i class="ti ti-check"></i> {{ event ? i18n.ts.save : i18n.ts.create }}
			</MkButton>
		</div>
	</template>
</MkModalWindow>
</template>

<script lang="ts" setup>
// イベントの作成・編集のダイアログ。保存できたら done で保存後のイベントを返す。
// 開くときは utility/calendar-event-dialog.ts の openCalendarEventEditDialog を使う
import { ref, useTemplateRef, watch } from 'vue';
import * as Misskey from 'misskey-js';
import MkModalWindow from '@/components/MkModalWindow.vue';
import MkButton from '@/components/MkButton.vue';
import MkCalendarEventForm from '@/components/MkCalendarEventForm.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';
import {
	calendarEventFormToParams,
	calendarEventFormToUpdateParams,
	calendarEventReasonToField,
	calendarEventToForm,
	clearChangedCalendarEventFormErrors,
	createEmptyCalendarEventForm,
	getCalendarEventValidationReason,
	validateCalendarEventForm,
} from '@/utility/calendar-event-form.js';
import type { CalendarEventFormErrors, CalendarEventFormValue } from '@/utility/calendar-event-form.js';
import { getCalendarApiErrorMessage } from '@/utility/calendar-event-messages.js';
import { toJstDateString } from '@/utility/calendar.js';

const props = defineProps<{
	/** 編集するイベント。省略すると新しく作る */
	event?: Misskey.entities.CalendarEvent | null;
	/** 新しく作るときの日付 ('YYYY-MM-DD')。省略すると今日 */
	initialDate?: string | null;
}>();

const emit = defineEmits<{
	(ev: 'done', event: Misskey.entities.CalendarEvent): void;
	(ev: 'closed'): void;
}>();

const dialog = useTemplateRef('dialog');

const form = ref<CalendarEventFormValue>(props.event
	? calendarEventToForm(props.event)
	: createEmptyCalendarEventForm(props.initialDate ?? toJstDateString(new Date())));
const errors = ref<CalendarEventFormErrors>({});
const submitting = ref(false);

watch(form, (next, prev) => {
	errors.value = clearChangedCalendarEventFormErrors(errors.value, prev, next);
});

async function save(): Promise<Misskey.entities.CalendarEvent> {
	if (props.event) {
		const changes = calendarEventFormToUpdateParams(props.event, form.value);
		if (Object.keys(changes).length === 0) return props.event;
		return await misskeyApi('calendar/events/update', { eventId: props.event.id, ...changes });
	} else {
		return await misskeyApi('calendar/events/create', calendarEventFormToParams(form.value));
	}
}

async function submit() {
	if (submitting.value) return;

	const clientErrors = validateCalendarEventForm(form.value);
	if (Object.keys(clientErrors).length > 0) {
		errors.value = clientErrors;
		return;
	}

	submitting.value = true;
	try {
		const saved = await save();
		emit('done', saved);
		dialog.value?.close();
	} catch (err) {
		const reason = getCalendarEventValidationReason(err);
		const field = reason != null ? calendarEventReasonToField(reason) : null;
		if (reason != null && field != null) {
			errors.value = { [field]: reason };
		} else {
			os.alert({ type: 'error', ...getCalendarApiErrorMessage(err) });
		}
	} finally {
		submitting.value = false;
	}
}
</script>

<style lang="scss" module>
.footer {
	display: flex;
	justify-content: center;
	padding: 12px;
}
</style>
