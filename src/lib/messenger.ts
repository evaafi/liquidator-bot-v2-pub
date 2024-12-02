// small logger
export function formatDateTime(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    return `${hours}:${minutes}:${seconds} ${day}-${month}-${year}`;
}

export function logMessage(message: string, printDateTime: boolean = true) {
    if (printDateTime) {
        console.log(`[${formatDateTime()}] ${message}`);
    } else {
        console.log(message);
    }
}

// telegram sender
export type SendMessageOptions = {
    throwOnFailure?: boolean,
    debug?: boolean,
    printDateTime?: boolean,
};

const DEFAULT_OPTIONS = {throwOnFailure: false, debug: false, printDateTime: true};

export async function sendTelegramMessage(
    message: string,
    telegramBotToken: string,
    telegramChatId: string,
    telegramTopicId?: string,
    options?: SendMessageOptions
) {
    // console.log({message, telegramBotToken, telegramChatId, telegramTopicId, options});
    const url = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;
    try {
        const bodyBase = {
            chat_id: telegramChatId,
            text: message,
            parse_mode: 'html'
        };

        const body = telegramTopicId ?
            {...bodyBase, ...{message_thread_id: telegramTopicId}} : bodyBase;

        const response = await fetch(url, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            throw new Error(response.statusText);
        }

        const data = await response.json();
        if (options?.debug) {
            console.log('Message sent successfully', data);
        }
    } catch (error) {
        if (options?.throwOnFailure) {
            throw error;
        } else {
            console.error('Error sending message:', error);
            logMessage(message, options?.printDateTime);
        }
    }
}

export abstract class Messenger {
    abstract sendMessage(message: string): Promise<void>;
}

export class ChannelMessenger extends Messenger {
    private readonly botToken: string;
    private readonly chatId: string;
    private readonly options: SendMessageOptions;

    constructor(telegramBotToken: string, channelId: string, options?: SendMessageOptions) {
        super();
        this.botToken = telegramBotToken;
        this.chatId = channelId;
        this.options = {...DEFAULT_OPTIONS, ...(options ?? {})};
    }

    async sendMessage(message: string): Promise<void> {
        try {
            await sendTelegramMessage(message, this.botToken, this.chatId, undefined, this.options)
        } catch (e) {
            console.error("FAILED TO SEND CHAT MESSAGE: ", e);
            if (this?.options?.throwOnFailure) throw e;
        }
    }

    log(message: string): void {
        console.log(message);
    }
}

export class TopicMessenger extends Messenger {
    private readonly botToken: string;
    private readonly chatId: string;
    private readonly topicId: string;
    private readonly options: SendMessageOptions;

    constructor(botToken: string, groupId: string, topicId: string, options?: SendMessageOptions) {
        super();
        this.botToken = botToken;
        this.chatId = groupId;
        this.topicId = topicId;
        this.options = {...DEFAULT_OPTIONS, ...(options ?? {})};
    }

    async sendMessage(message: string): Promise<void> {
        try {
            await sendTelegramMessage(message, this.botToken, this.chatId, this.topicId, this.options);
        } catch (e) {
            console.error("FAILED TO SEND CHAT MESSAGE: ", e);
            if (this.options?.throwOnFailure) throw e;
        }
    }
}