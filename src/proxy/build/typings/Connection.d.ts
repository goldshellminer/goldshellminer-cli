/// <reference types="node" />
import * as EventEmitter from "events";
import Miner from "./Miner";
import Queue from "./Queue";
import { Dictionary, Socket, StratumRequestParams, RPCMessage } from "./types";
export declare type Options = {
    host: string;
    port: number;
    ssl: boolean;
};
declare class Connection extends EventEmitter {
    id: string;
    host: string;
    port: number;
    ssl: boolean;
    online: boolean;
    socket: Socket;
    queue: Queue;
    buffer: string;
    rpcId: number;
    rpc: Dictionary<RPCMessage>;
    auth: Dictionary<string>;
    minerId: Dictionary<string>;
    miners: Miner[];
    constructor(options: Options);
    connect(): void;
    kill(): void;
    ready(): void;
    receive(message: string): void;
    send(id: string, method: string, params?: StratumRequestParams): boolean;
    addMiner(miner: Miner): void;
    removeMiner(minerId: string): void;
    clear(id: string): void;
}
export default Connection;
