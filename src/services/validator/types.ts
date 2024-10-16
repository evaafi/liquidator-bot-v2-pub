import {Cell, Dictionary} from "@ton/ton";

export type PriceData = {
    dict: Dictionary<bigint, bigint>;
    dataCell: Cell;
};