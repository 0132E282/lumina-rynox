export type AiCommand = {
    name: string;
    description: string;
    template: string;
};

// * Ready-made prompt templates: picking one only fills the composer; the person edits and sends it. They run with any AI.
export const AI_COMMANDS: AiCommand[] = [
    {
        name: 'review',
        description: 'Review code: lỗi, bảo mật, hiệu năng',
        template:
            'Review đoạn code / thay đổi sau. Chỉ ra lỗi logic, vấn đề bảo mật, hiệu năng và code thừa, kèm đề xuất sửa:\n\n',
    },
    {
        name: 'explain',
        description: 'Giải thích code hoặc khái niệm',
        template: 'Giải thích rõ ràng, từng bước:\n\n',
    },
    {
        name: 'test',
        description: 'Viết test cho code',
        template:
            'Viết test (cả trường hợp biên và lỗi) cho đoạn code sau:\n\n',
    },
    {
        name: 'refactor',
        description: 'Làm code gọn, dễ đọc hơn',
        template:
            'Refactor đoạn code sau cho gọn và dễ đọc hơn, giữ nguyên hành vi:\n\n',
    },
    {
        name: 'optimize',
        description: 'Tối ưu hiệu năng',
        template:
            'Phân tích độ phức tạp và tối ưu hiệu năng đoạn code sau:\n\n',
    },
    {
        name: 'fix',
        description: 'Tìm nguyên nhân và sửa lỗi',
        template:
            'Tìm nguyên nhân gốc và cách sửa lỗi sau (kèm thông báo lỗi nếu có):\n\n',
    },
    {
        name: 'docs',
        description: 'Viết tài liệu / comment',
        template: 'Viết tài liệu ngắn gọn cho đoạn code sau:\n\n',
    },
    {
        name: 'commit',
        description: 'Soạn commit message',
        template:
            'Soạn commit message theo Conventional Commits cho thay đổi sau:\n\n',
    },
    {
        name: 'summarize',
        description: 'Tóm tắt nội dung',
        template: 'Tóm tắt ngắn gọn các ý chính của nội dung sau:\n\n',
    },
    {
        name: 'translate',
        description: 'Dịch văn bản',
        template: 'Dịch sang tiếng Anh, giữ nguyên ý và giọng văn:\n\n',
    },
    {
        name: 'plan',
        description: 'Lập kế hoạch từng bước',
        template: 'Lập kế hoạch thực hiện từng bước, nêu rủi ro cho:\n\n',
    },
];

/** * Commands matching what follows the "/" (the draft must be only that "/word"). */
export function matchCommands(draft: string): AiCommand[] | null {
    const match = /^\/(\S*)$/.exec(draft);

    if (match === null) {
        return null;
    }

    const query = match[1].toLowerCase();

    return AI_COMMANDS.filter((command) => command.name.startsWith(query));
}
