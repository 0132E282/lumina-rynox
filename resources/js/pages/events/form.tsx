import { EventSidePanels } from '@/components/events/event-side-panels';
import { Field } from '@/components/form';
import FormLayout, { Group, Section } from '@/layouts/form-layout';
import { EVENT_TYPE_KEYS, EVENT_TYPES } from '@/lib/event-types';
import { todayIso } from '@/lib/personal-date';

const TYPE_OPTIONS = EVENT_TYPE_KEYS.map((key) => ({
    value: key,
    label: EVENT_TYPES[key].label,
    description: EVENT_TYPES[key].description,
    badge: EVENT_TYPES[key].letter,
    badgeClassName: EVENT_TYPES[key].dot,
}));

const REPEAT_OPTIONS = [
    { value: 'none', label: 'Không lặp' },
    { value: 'daily', label: 'Hằng ngày' },
    { value: 'weekly', label: 'Hằng tuần' },
    { value: 'monthly', label: 'Hằng tháng' },
];

// * Same marks as `Event::REMIND_MARKS` (minutes); reminders arrive as in-app notifications.
const REMINDER_OPTIONS = [
    {
        value: 1440,
        label: 'Nhắc trước 1 ngày',
        description: 'Thông báo ngay trên hệ thống',
    },
    {
        value: 30,
        label: 'Nhắc trước 30 phút',
        description: 'Thông báo ngay trên hệ thống',
    },
];

export default function EventForm() {
    return (
        <FormLayout title="Sự kiện">
            <Group withSidebar>
                <Section>
                    <h2 className="text-base font-semibold">
                        Thông tin sự kiện
                    </h2>
                    <Field
                        name="title"
                        ui="input"
                        label="Tên sự kiện"
                        maxLength={255}
                        validate="min:1:Tên sự kiện là bắt buộc"
                    />
                    <Field
                        name="type"
                        ui="choice-cards"
                        label="Loại"
                        default="meeting"
                        options={TYPE_OPTIONS}
                    />
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field
                            name="date"
                            ui="input"
                            type="date"
                            label="Ngày"
                            default={todayIso()}
                        />
                        <Field
                            name="repeat"
                            ui="select"
                            label="Lặp lại"
                            default="none"
                            options={REPEAT_OPTIONS}
                        />
                        <Field
                            name="starts_at"
                            ui="input"
                            type="time"
                            label="Bắt đầu"
                            default="09:00"
                        />
                        <Field
                            name="ends_at"
                            ui="input"
                            type="time"
                            label="Kết thúc"
                            default="10:00"
                        />
                    </div>
                    <Field
                        name="location"
                        ui="input"
                        label="Địa điểm hoặc đường dẫn họp"
                        maxLength={500}
                    />
                </Section>
                <Section>
                    <h2 className="text-base font-semibold">Nhắc</h2>
                    <Field
                        name="remind_before_minutes"
                        ui="checkbox-group"
                        options={REMINDER_OPTIONS}
                    />
                </Section>
            </Group>
            <EventSidePanels />
        </FormLayout>
    );
}
