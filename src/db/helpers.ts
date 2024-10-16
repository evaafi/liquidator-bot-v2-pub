import {repeatStr} from "../util/format";

export function makeCreateUsersScript(columns: string[]): string {
    return `            
CREATE TABLE IF NOT EXISTS users(
id INTEGER PRIMARY KEY AUTOINCREMENT,
wallet_address VARCHAR NOT NULL,
contract_address VARCHAR UNIQUE NOT NULL,
code_version INTEGER NOT NULL,
created_at TIMESTAMP NOT NULL,
updated_at TIMESTAMP NOT NULL,
actualized_at TIMESTAMP NOT NULL,
${columns.map(name => `${name} VARCHAR NOT NULL, `).join('\n')}
state VARCHAR NOT NULL DEFAULT 'active')`;
}

export function makeProcessUserScript(columns: string[]): string {
    const principal_insert_cols = columns.map(col => (
        `${col} = CASE WHEN actualized_at < ? THEN ? ELSE ${col} END`)
    ).join(',\n');
    console.log('principals_insert_cols: ', principal_insert_cols);
    return `
INSERT INTO users(
wallet_address, contract_address, code_version, created_at, updated_at, actualized_at,
${columns.map(name => `${name}`).join(', ')})
VALUES(${repeatStr('?', 6 + columns.length).join(', ')})
ON CONFLICT(contract_address) DO UPDATE SET 
code_version = CASE WHEN actualized_at < ? THEN ? ELSE code_version END, 
created_at = CASE WHEN created_at > ? THEN ? ELSE created_at END, 
updated_at = CASE WHEN updated_at < ? THEN ? ELSE updated_at END,
actualized_at = CASE WHEN actualized_at < ? THEN ? ELSE actualized_at END,
${principal_insert_cols}`;
}
