export function notDefined(v: any): boolean {
    return typeof v === 'undefined' || v === null;
}

export function isDefined(v: any): boolean {
    return !notDefined(v);
}

export function checkDefined(v: any, message: string) {
    if (notDefined(v)) {
        throw new Error(message);
    }
}
