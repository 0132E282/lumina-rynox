import { Field } from '@/components/form';
import FormLayout, { Section } from '@/layouts/form-layout';

export default function TaskForm() {
    return (
        <FormLayout title="Công việc">
            <Section>
                <Field
                    name="title"
                    ui="input"
                    label="Tiêu đề"
                    maxLength={255}
                    validate="min:1:Tiêu đề là bắt buộc"
                />
                <Field name="description" ui="textarea" label="Mô tả" />
                <Field name="due_date" ui="input" type="date" label="Hạn" />
                <Field
                    name="priority"
                    ui="select"
                    label="Ưu tiên"
                    default="medium"
                >
                    <option value="low">Thấp</option>
                    <option value="medium">Vừa</option>
                    <option value="high">Cao</option>
                </Field>
                <Field
                    name="status"
                    ui="select"
                    label="Trạng thái"
                    default="todo"
                >
                    <option value="todo">Chưa xong</option>
                    <option value="done">Đã xong</option>
                </Field>
            </Section>
        </FormLayout>
    );
}
