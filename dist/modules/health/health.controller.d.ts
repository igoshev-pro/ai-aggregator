import { Connection } from 'mongoose';
export declare class HealthController {
    private connection;
    constructor(connection: Connection);
    check(): Promise<{
        status: string;
        timestamp: string;
        uptime: number;
        mongo: string;
        memory: {
            rss: string;
            heap: string;
        };
    }>;
}
