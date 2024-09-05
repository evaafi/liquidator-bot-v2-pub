import {sleep} from "./common";

export type AsyncLambda<T> = () => Promise<T>;

export type DummyFunction = () => {};
const DUMMY_FUNCTION_INSTANCE = () => {
};

type RetryParams = {
    attempts: number,
    attemptInterval: number,
    verbose: boolean,
    on_fail: DummyFunction,
}

const DEFAULT_RETRY_PARAMS = {
    attempts: 3,
    attemptInterval: 3000,
    verbose: true,
    on_fail: DUMMY_FUNCTION_INSTANCE,
};

/**
 * Tries to run specified lambda several times if it throws
 * @type T type of the return value
 * @param lambda lambda function to run
 * @param params retry function params: attempts - for number of attempts, attemptInterval - number of ms to wait between retries, ...
 * @returns
 */
export async function retry<T>(lambda: AsyncLambda<T>, params: any = {}) {
    let value = null;
    let ok = false;
    const {attempts, attemptInterval, verbose, on_fail}: RetryParams = {...DEFAULT_RETRY_PARAMS, ...params};
    let n = attempts;

    while (n > 0 && !ok) {
        try {
            value = await lambda();
            ok = true;
        } catch (e) {
            if (typeof on_fail === 'function') {
                on_fail();
            }
            if (verbose) {
                console.log(e);
            }
            console.log(`Call failed, retrying. Retries left: ${--n}`);
            await sleep(attemptInterval);
        }
    }

    return {ok, value};
}