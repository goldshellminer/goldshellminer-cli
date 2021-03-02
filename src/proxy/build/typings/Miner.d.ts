/// <reference types="node" />
import * as EventEmitter from "events";
import * as WebSocket from "ws";
import Connection from "./Connection";
import Queue from "./Queue";
import { Job, CoinHiveResponse, StratumRequestParams, StratumError, StratumJob } from "./types";
export declare type Options = {
    connection: Connection | null;
    ws: WebSocket | null;
    address: string | null;
    user: string | null;
    diff: number | null;
    pass: string | null;
};
declare class Miner extends EventEmitter {
    id: string;
    login: string;
    address: string;
    user: string;
    diff: number;
    pass: string;
    heartbeat: NodeJS.Timer;
    connection: Connection;
    queue: Queue;
    ws: WebSocket;
    online: boolean;
    jobs: Job[];
    hashes: number;
    constructor(options: Options);
    connect(): Promise<void>;
    kill(): void;
    sendToMiner(payload: CoinHiveResponse): void;
    sendToPool(method: string, params: StratumRequestParams): void;
    handleAuthed(auth: string): void;
    handleJob(job: Job): void;
    handleAccepted(job: StratumJob): void;
    handleError(error: StratumError): void;
    handleMessage(message: string): void;
}
export default Miner;
