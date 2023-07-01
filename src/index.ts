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

async function warmup(fn: () => unknown) {
    for (let i = 0; i < 100; ++i) {
        await fn();
    }
}

async function meassureExecutionTime(ms: number, asyncFn: boolean, fn: () => unknown): Promise<PerfResult> {
    // "Prime"
    await warmup(fn);
    const histogram = createHistogram();

    const targetTimeInNs = BigInt(ms * NANOSECONDS_IN_MILLISECOND);

    let elapsedTime = 0n;

    if (asyncFn) {
        while (elapsedTime < targetTimeInNs) {
            const start = process.hrtime.bigint();
            await fn();
            const deltaTime = process.hrtime.bigint() - start;
    
            histogram.record(deltaTime);
            elapsedTime += deltaTime;
        }
    } else {
        while (elapsedTime < targetTimeInNs) {
            const start = process.hrtime.bigint();
            fn();
            const deltaTime = process.hrtime.bigint() - start;
    
            histogram.record(deltaTime);
            elapsedTime += deltaTime;
        }
    }

    // To milliseconds, 3 decimal
    const totalTime = Number(elapsedTime / BigInt(1000)) / 1000;

    return {
        iterations: histogram.count,
        ops: histogram.count / totalTime * 1000,
        totalTime,
        histogram: {
            max: histogram.max / NANOSECONDS_IN_MICROSECOND,
            min: histogram.min / NANOSECONDS_IN_MICROSECOND,
            mean: histogram.mean / NANOSECONDS_IN_MICROSECOND,
            "99th": histogram.percentile(.99) / NANOSECONDS_IN_MICROSECOND,
            stddev: histogram.stddev / NANOSECONDS_IN_MICROSECOND,
        }
    };
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

interface Task {
    label: string
    fn: () => void
}

interface BenchmarkEvents {
    "task-start": (task: Task) => void;
    "task-done": (task: Task, result: Result) => void;
    "done": (results: Result[]) => void;
}

export declare interface Benchmark {
    on<T extends keyof BenchmarkEvents>(event: T, listener: BenchmarkEvents[T]): this;
    emit<T extends keyof BenchmarkEvents>(event: T, ...args: Parameters<BenchmarkEvents[T]>): boolean;
}

export class Benchmark extends EventEmitter {
    private results: Result[] = [];
    private tasks: Task[];

    private timePerTest: number;
    private asyncTask: boolean;

    constructor(tasks: Task[] = [], opts: Partial<{
        time: number;
        /** Really noticable performance impact if using async/await */
        async: boolean;
    }> = {}) {
        super();
        this.tasks = tasks;
        this.timePerTest = opts.time || 5000;
        this.asyncTask = opts.async || false;
    }

    add(label: Task["label"], fn: Task["fn"]) {
        this.tasks.push({ label, fn });
        return this;
    }

    async run() {
        // 'jiting the jit'. Inconsistent results for really fast tasks without this.
        await meassureExecutionTime(1000, this.asyncTask, () => {});

        for (const task of this.tasks) {
            this.emit("task-start", task);

            const perf = await meassureExecutionTime(this.timePerTest, this.asyncTask, task.fn);

            const result: Result = {
                label: task.label,
                performance: perf
            };

            this.emit("task-done", task, result);

            this.results.push(result);
        }
        this.results.sort((a, b) => a.performance.ops > b.performance.ops ? -1 : 0);

        this.emit("done", this.results);

        return this;
    }

    table() {
        const resultMap = new Map<string, {
            performance: PerfResult,
            comparisons: Record<string, number>
        }>();

        for (const result of this.results) {
            const comparisons: Record<string, number> = {};
            for (const compare of this.results) {
                comparisons[compare.label] = result.performance.ops / compare.performance.ops;
            }
            resultMap.set(result.label, {
                performance: result.performance,
                comparisons,
            });
        }

        const table: Record<string, {}> = {};

        for (const [label, result] of resultMap.entries()) {
            const row: any = {
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
