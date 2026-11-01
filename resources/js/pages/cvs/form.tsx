import { CvAiUpload } from '@/components/cvs/cv-ai-upload';
import { CvLatexButton } from '@/components/cvs/cv-latex-field';
import { CvLatexPreview } from '@/components/cvs/cv-latex-preview';
import { Field } from '@/components/form';
import FormLayout, { Section } from '@/layouts/form-layout';

export default function CvForm() {
    return (
        <FormLayout title="CV">
            <Section>
                <CvAiUpload />
                <Field
                    name="name"
                    ui="input"
                    label="Tên CV"
                    maxLength={255}
                    validate="min:1:Tên CV là bắt buộc"
                />
                <Field
                    name="desired_position"
                    ui="input"
                    label="Vị trí ứng tuyển"
                    maxLength={255}
                    placeholder="Backend Developer"
                />
                <Field
                    name="position"
                    ui="input"
                    label="Từ khoá tìm kiếm"
                    maxLength={255}
                    placeholder="PHP Laravel · Backend"
                    description="Tách bằng dấu · hoặc dấu phẩy; mỗi từ khoá là một lượt tìm việc."
                />
                <Field
                    name="expected_salary"
                    ui="input"
                    label="Mức lương mong muốn"
                    maxLength={100}
                    placeholder="35-45 triệu"
                    description="AI dùng để chấm độ phù hợp khi tin tuyển dụng có nêu lương."
                />
                {/* * The CV text the AI reads to score jobs: filled by the upload, kept but not shown. */}
                <Field name="content" ui="textarea" className="hidden" />
                <CvLatexButton />
                <Field
                    name="latex"
                    ui="textarea"
                    label="CV dạng LaTeX"
                    spellCheck={false}
                    className="[&_textarea]:min-h-96 [&_textarea]:font-mono [&_textarea]:text-xs"
                    description="AI chỉ dùng thông tin có trong CV. Sau khi chấm việc xong, AI tự cập nhật ô này trừ khi bạn đã sửa tay. Biên dịch bằng pdflatex hoặc Overleaf."
                />
                <CvLatexPreview />
                {/* * Where the uploaded file is kept on the server; set by the upload. */}
                <Field name="file_path" ui="input" className="hidden" />
            </Section>
        </FormLayout>
    );
}
