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

class Task {
    private histogram = createHistogram();
    private elapsedTime = 0n;

    private fn: TaskObject["fn"];

    label: TaskObject["label"];
    setup?: () => any;

    constructor(label: TaskObject["label"], fn: TaskObject["fn"], opts: TaskObject["opts"] = {}) {
        this.label = label;
        this.fn = fn;
        this.setup = opts.setup;
    }

    async meassureExecutionTime(asyncFn: boolean) {
        const setupData = this.setup?.();
        const start = process.hrtime.bigint();
        asyncFn ? await this.fn.call(this, setupData) : this.fn.call(this, setupData);
        const deltaTime = process.hrtime.bigint() - start;

        this.histogram.record(deltaTime);
        this.elapsedTime += deltaTime;

        return this.elapsedTime;
    }
    async run(ms: number, asyncFn: boolean) {
        const targetTimeInNs = BigInt(ms * NANOSECONDS_IN_MILLISECOND);
    
        while (this.elapsedTime < targetTimeInNs) {
            await this.meassureExecutionTime(asyncFn);
        }
    }
    reset() {
        this.histogram.reset();
        this.elapsedTime = 0n;
    }
    result(): PerfResult {
        // To milliseconds with 3 decimal places
        const totalTime = Number(this.elapsedTime / BigInt(1000)) / 1000;
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
    "task-done": (task: Task, result: Result) => void;
    "done": (results: Result[]) => void;
}

export declare interface Benchmark {
    on<T extends keyof BenchmarkEvents>(event: T, listener: BenchmarkEvents[T]): this;
    emit<T extends keyof BenchmarkEvents>(event: T, ...args: Parameters<BenchmarkEvents[T]>): boolean;
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
    private results: Result[] = [];
    private tasks: Task[] = [];

    private timePerTest: number;
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

    async runRoundRobin() {
        const targetTimeInNs = BigInt(this.timePerTest * NANOSECONDS_IN_MILLISECOND);

        const tasksToRun = new Set(this.tasks);
        while (tasksToRun.size) {
            for (const task of tasksToRun) {
                if (await task.meassureExecutionTime(this.asyncTask) >= targetTimeInNs) {
                    tasksToRun.delete(task);

                    const result: Result = {
                        label: task.label,
                        performance: task.result(),
                    };
                    this.emit("task-done", task, result);
                    this.results.push(result);
                }
            }
        }

        this.emit("done", this.results);
    }

    async run() {
        // warmup
        for (const task of this.tasks) {
            await task.run(500, this.asyncTask);
            task.reset();
        }

        for (const task of this.tasks) {
            this.emit("task-start", task);

            await task.run(this.timePerTest, this.asyncTask);

            const result: Result = {
                label: task.label,
                performance: task.result(),
            };

            this.emit("task-done", task, result);

            this.results.push(result);
        }

        this.emit("done", this.results);

        return this;
    }

    table() {
        const resultMap = new Map<string, {
            performance: PerfResult,
            comparisons: Record<string, number>
        }>();

        this.results.sort((a, b) => a.performance.ops > b.performance.ops ? -1 : 0);

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

export async function runBenchmark(tasks: TaskObject[]) {
    const bench = new Benchmark();
    for (const task of tasks) {
        bench.add(task.label, task.fn);
    }
    bench.on("task-start", (task) => {
        console.log(`Benchmarking '${task.label}'...`);
    });
    await bench.run();
    console.table(bench.table());
}
