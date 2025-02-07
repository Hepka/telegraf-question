import { Middleware } from "telegraf/typings/middleware";
import { Context } from "telegraf/typings/context";
import { ExtraReplyMessage } from "telegraf/typings/telegram-types";

const defaultFilters = {
    'any': (ctx: any) => true,
    'text': (ctx: any) => (ctx.message?.text?.length ?? 0) > 0,
    'number': (ctx: any) => defaultFilters['text'](ctx) && !Number.isNaN(parseFloat(ctx.message.text)),
    'callback_query': (ctx: any) => typeof ctx.callbackQuery !== 'undefined',
};

export default function TelegrafQuestion<TContext extends Context>(config?: {
    cancelTimeout?: number,
}): Middleware<TContext> {
    let wasAsked: {
        [key: string]: any
    } = {};

    let cancelTime = config?.cancelTimeout ?? -1;

    return async (ctx, next) => {
        if (ctx.chat.id in wasAsked) {
            await wasAsked[ctx.chat.id].next(ctx);
        } else {

            ctx.ask = async (
                question: { text: string; extra?: ExtraReplyMessage } | string,
                cancel?: ((ctx: any) => Promise<boolean> | boolean) | string | null,
                type: 'any' | 'text' | 'number' | 'callback_query' = 'text',
                errorText: { text: string; extra?: ExtraReplyMessage } | string | null = null,
                filter?: (ctx: any) => Promise<boolean> | boolean
            ): Promise<Context | null> => {

                let cancelFunction = (ctx: any) => {
                    if (typeof cancel !== 'undefined' && cancel !== null) {
                        if (typeof cancel === 'string') {
                            return ctx.message?.text === cancel;
                        } else {
                            return cancel(ctx);
                        }
                    }
                    return false;
                };

                let chatId = ctx.chat.id;

                return await new Promise<Context>((resolve) => {
                    let cancelTimeoutObj = {};

                    async function* answer() {
                        let filterResult = false;
                        while (!filterResult) {
                            let ctx: any = yield filterResult;
                            if (ctx === cancelTimeoutObj) {
                                resolve(null);
                                delete wasAsked[chatId];
                                return filterResult;
                            }
                            filterResult = (await defaultFilters[type](ctx)) && (typeof filter === 'undefined' ? true : await filter(ctx));
                            let isCancelled = cancelFunction(ctx);
                            if (filterResult || isCancelled) {
                                if (isCancelled) {
                                    resolve(null);
                                } else {
                                    resolve(ctx)
                                }
                                delete wasAsked[ctx.chat.id];
                                return filterResult;
                            }
                            if (!filterResult && errorText !== null) {
                                if (typeof errorText === 'string') {
                                    ctx.reply(errorText);
                                } else {
                                    ctx.reply(errorText.text, errorText.extra);
                                }
                            }
                        }
                    }
                    if (ctx.chat.id in wasAsked) {
                        throw new Error('Question already asked for chat ' + ctx.from.id);
                    }

                    let ask = answer();
                    ask.next();

                    wasAsked[ctx.chat.id] = ask;
                    if (typeof question === 'string') {
                        ctx.reply(question);
                    } else {
                        ctx.reply(question.text, question.extra);
                    }

                    if (cancelTime > 0) {
                        setTimeout(() => {
                            if (wasAsked[ctx.chat.id] === ask) {
                                ask.next(<any>cancelTimeoutObj);
                            }
                        }, cancelTime);
                    }
                });

            };

            return await next();
        }
    }
}

declare module 'telegraf/typings/context' {
    interface Context {
        ask: (
            question: { text: string; extra?: ExtraReplyMessage } | string,
            cancel?: ((ctx: any) => Promise<boolean> | boolean) | string | null,
            type?: 'text' | 'number' | 'callback_query',
            errorText?: { text: string; extra?: ExtraReplyMessage } | string | null,
            filter?: (ctx: any) => Promise<boolean> | boolean,
        ) => Promise<Context> | Promise<null>;
    }
}