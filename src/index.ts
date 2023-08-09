import EventEmitter from "node:events";
import { createHistogram } from "node:perf_hooks";

declare module "node:perf_hooks" {
    // Add missing type declaration for `Histogram.count`
    interface Histogram {
        count: number
    }
}

const NANOSECONDS_IN_MILLISECOND = 1_000_000;
const NANOSECONDS_IN_MICROSECOND = 1_000;

export const msToNs = (ms: number) => BigInt(ms * NANOSECONDS_IN_MILLISECOND);
export const nsToMs = (ns: bigint) => Math.round(Number(ns / BigInt(NANOSECONDS_IN_MICROSECOND))) / 1000;

class Task {
    private histogram = createHistogram();
    readonly elapsedTime = {
        task: 0n,
        setup: 0n,
    };

    private fn: TaskObject["fn"];

    readonly label: TaskObject["label"];
    private setup?: () => any;

    constructor(label: TaskObject["label"], fn: TaskObject["fn"], opts: TaskObject["opts"] = {}) {
        this.label = label;
        this.fn = fn;
        this.setup = opts.setup;
    }

    async meassureExecutionTime(asyncFn: boolean) {
        let start = process.hrtime.bigint();
        const setupData = this.setup?.();
        this.elapsedTime.setup += process.hrtime.bigint() - start;

        start = process.hrtime.bigint();
        asyncFn ? await this.fn.call(this, setupData) : this.fn.call(this, setupData);
        const deltaTime = process.hrtime.bigint() - start;

        this.histogram.record(deltaTime);
        this.elapsedTime.task += deltaTime;
    }
    async runFor(ms: number, asyncFn: boolean) {
        const targetTimeInNs = msToNs(ms);
    
        while (this.elapsedTime.task < targetTimeInNs) {
            await this.meassureExecutionTime(asyncFn);
        }
    }
    reset() {
        this.histogram.reset();
        this.elapsedTime.task = 0n;
        this.elapsedTime.setup = 0n;
    }
    result(): PerfResult {
        // To milliseconds with 3 decimal places
        const totalTime = Number(this.elapsedTime.task / BigInt(1000)) / 1000;
        return {
            iterations: this.histogram.count,
            ops: this.histogram.count / totalTime * 1000,
            totalTime,
            histogram: {
                max: this.histogram.max / NANOSECONDS_IN_MICROSECOND,
                min: this.histogram.min / NANOSECONDS_IN_MICROSECOND,
                mean: this.histogram.mean / NANOSECONDS_IN_MICROSECOND,
                "99th": this.histogram.percentile(.99) / NANOSECONDS_IN_MICROSECOND,
                stddev: this.histogram.stddev / NANOSECONDS_IN_MICROSECOND,
            }
        };
    }
}


type PerfResult = {
    totalTime: number
    ops: number
    iterations: number
    histogram: {
        max: number
        min: number
        mean: number
        "99th": number
        stddev: number
    }
}

type Result = {
    label: string
    performance: PerfResult
}

interface BenchmarkEvents {
    "task-start": (task: Task) => void;
    "task-done": (task: Task) => void;
    "done": () => void;
    "progress": (tasks: Task[]) => void;
}

export declare interface Benchmark {
    on<T extends keyof BenchmarkEvents>(event: T, listener: BenchmarkEvents[T]): this;
    emit<T extends keyof BenchmarkEvents>(event: T, ...args: Parameters<BenchmarkEvents[T]>): boolean;
    listenerCount<T extends keyof BenchmarkEvents>(event: T): number;
}

export interface TaskObject<TInitData = any> {
    label: string;
    fn: (data: TInitData) => unknown;
    opts?: TaskOpts<TInitData>
}

interface TaskOpts<TInitData> {
    /** This is called before every task execution. The return value is passed to `Task.fn` */
    setup?: () => TInitData;
}

export class Benchmark extends EventEmitter {
    private tasks: Task[] = [];

    readonly timePerTest: number;
    private asyncTask: boolean;

    constructor(opts: Partial<{
        /** Minimum number of milliseconds to execute a task for */
        time: number;
        /** Really noticable performance impact if using async/await */
        async: boolean;
    }> = {}) {
        super();
        this.timePerTest = opts.time || 5000;
        this.asyncTask = opts.async || false;
    }

    add<TInitData = unknown>(label: TaskObject<TInitData>["label"], fn: TaskObject<TInitData>["fn"], opts: TaskObject<TInitData>["opts"] = {}) {
        this.tasks.push(new Task(label, fn, opts));
        return this;
    }
    size() {
        return this.tasks.length;
    }

    reset() {
        for (const task of this.tasks) {
            task.reset();
        }
    }

    async runRoundRobin() {
        const targetTimeInNs = msToNs(this.timePerTest);

        const tasksToRun = new Set(this.tasks);

        const reportInterval = msToNs(Math.max(500, Math.min(1000, this.timePerTest / 10)));
        let lastReportAt = process.hrtime.bigint();

        while (tasksToRun.size) {
            for (const task of tasksToRun) {
                await task.meassureExecutionTime(this.asyncTask);
                // Only check/report progress if atleast one listener
                if (this.listenerCount("progress")) {
                    if (process.hrtime.bigint() - reportInterval >= lastReportAt) {
                        lastReportAt = process.hrtime.bigint();
                        this.emit("progress", this.tasks);
                    }
                }
                if (task.elapsedTime.task >= targetTimeInNs) {
                    tasksToRun.delete(task);

                    this.emit("task-done", task);
                }
            }
        }

        this.emit("done");
    }

    async run() {
        // warmup
        for (const task of this.tasks) {
            await task.runFor(500, this.asyncTask);
            task.reset();
        }

        for (const task of this.tasks) {
            this.emit("task-start", task);

            await task.runFor(this.timePerTest, this.asyncTask);

            this.emit("task-done", task);
        }

        this.emit("done");

        return this;
    }

    table() {
        const resultMap = new Map<string, {
            performance: PerfResult,
            comparisons: Record<string, number>
        }>();

        const results = this.tasks.map(
            task => ({
                performance: task.result(),
                label: task.label,
            })
        ).sort((a, b) => a.performance.ops > b.performance.ops ? -1 : 0);

        for (const result of results) {
            const comparisons: Record<string, number> = {};
            for (const compare of results) {
                comparisons[compare.label] = result.performance.ops / compare.performance.ops;
            }
            resultMap.set(result.label, {
                performance: result.performance,
                comparisons,
            });
        }

        const table: Record<string, {}> = {};

        for (const [label, result] of resultMap.entries()) {
            const row: Record<string, string> = {
                "99th (µs)": result.performance.histogram["99th"].toFixed(3),
                "+/- (µs)": result.performance.histogram.stddev.toFixed(3),
                "Op/s": result.performance.ops.toFixed(2),
            };
            for (const [compareLabel, compareResult] of Object.entries(result.comparisons)) {
                if (compareLabel === label) {
                    row[compareLabel] = "-";
                    continue;
                }

                row[compareLabel] = compareResult.toFixed(2)
            }
            table[label] = row;
        }
        return table;
    }
}
