import {Bot} from "grammy";

type Options = {
    throwOnFailure: boolean
};

export class Messenger {
    private bot: Bot;
    private readonly chatId: string;
    private options: Options;

    constructor(token: string, chatId: string, options: Options = {throwOnFailure: true}) {
        this.chatId = chatId;
        this.bot = new Bot(token);
        this.options = options;
    }

    async sendMessage(message: string, options?: any): Promise<void> {
        try {
            await this.bot.api.sendMessage(this.chatId, message, options);
        } catch (e) {
            console.error("FAILED TO SEND CHAT MESSAGE: ", e);
            if (this?.options?.throwOnFailure) throw e;
        }
    }

    log(message: string): void {
        console.log(message);
    }
}
