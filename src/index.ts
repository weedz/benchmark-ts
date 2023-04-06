import { createHistogram } from "perf_hooks";

declare module 'perf_hooks' {
    interface Histogram {
        count: number
    }
}

const NANOSECONDS_IN_MILLISECONDS = 1_000_000;


function meassureExecutionTime(ms: number, fn: (...args: unknown[]) => unknown, args: unknown[] = []): PerfResult {
    // "Prime"
    fn(...args);
    fn(...args);
    fn(...args);
    const histogram = createHistogram();

    const targetTimeInNs = BigInt(ms * NANOSECONDS_IN_MILLISECONDS);

    let elapsedTime = 0n;
    while (elapsedTime < targetTimeInNs) {
        const start = process.hrtime.bigint();
        fn(...args);
        const deltaTime = process.hrtime.bigint() - start;

        histogram.record(deltaTime);
        elapsedTime += deltaTime;
    }

    // To milliseconds, 3 decimal
    const totalTime = Number(elapsedTime / BigInt(1000)) / 1000;

    return {
        iterations: histogram.count,
        ops: histogram.count / totalTime * 1000,
        totalTime,
        histogram: {
            max: histogram.max / NANOSECONDS_IN_MILLISECONDS,
            min: histogram.min / NANOSECONDS_IN_MILLISECONDS,
            mean: histogram.mean / NANOSECONDS_IN_MILLISECONDS,
            "99th": histogram.percentile(.99) / NANOSECONDS_IN_MILLISECONDS,
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
    }
}

type Result = {
    label: string
    performance: PerfResult
}

export type TestArray = Array<{
    label: string
    fn: (...args: any[]) => void
    args?: any[]
}>

export function runTests(tests: TestArray, opts: Partial<{
    print: boolean
    time: number
}> = {}) {
    opts.time ||= 5000;
    const results: Result[] = [];
    for (const test of tests) {
        process.stdout.write(`Running '${test.label}'...\n`);
        const perf = meassureExecutionTime(opts.time, test.fn, test.args);

        const result = {
            label: test.label,
            performance: perf
        };

        if (opts.print) {
            printResult(result);
            process.stdout.write("\n");
        }
    
        results.push(result);
    }
    return results.sort( (a,b) => a.performance.ops > b.performance.ops ? -1 : 0);
}

export function printResult(result: Result) {
    process.stdout.write(`${result.label}:\n`);
    console.log("  Operations:", result.performance.iterations);
    console.log("  Total time:", result.performance.totalTime);
    console.log("  Max (ms):", result.performance.histogram.max.toFixed(3));
    console.log("  Min (ms):", result.performance.histogram.min.toFixed(3));
    console.log("  Mean (ms):", result.performance.histogram.mean.toFixed(3));
    console.log("  99th:", result.performance.histogram["99th"].toFixed(3));
    console.log("  Op/s:", result.performance.ops);
}

export function printResults(results: Result[]) {
    for (const result of results) {
        printResult(result);
    }
}

export function printResultsTable(results: Result[]) {
    const resultMap = new Map<string, {
        rate: number,
        comparisons: Record<string, number>
    }>();

    for (const result of results) {
        const comparisons: Record<string, number> = {};
        for (const compare of results) {
            comparisons[compare.label] = result.performance.ops / compare.performance.ops;
        }
        resultMap.set(result.label, {
            rate: result.performance.ops,
            comparisons
        });
    }

    const table: Record<string, {}> = {};
    
    for (const [label, result] of resultMap.entries()) {
        const row: any = {
            "Op/s": result.rate.toFixed(2)
        };
        // process.stdout.write(`${label} (${result.rate.toFixed(2)}/s):\n`);
        for (const [compareLabel, compareResult] of Object.entries(result.comparisons)) {
            if (compareLabel === label) {
                row[compareLabel] = "-";
                continue;
            }
            const percentage = (compareResult - 1) * 100;
            // process.stdout.write(`  ${compareLabel}: ${percentage.toFixed(2)}% (${compareResult.toFixed(2)}x)\n`);

            row[compareLabel] = compareResult.toFixed(2)
        }
        table[label] = row;
    }
    console.table(table);
    return table;
}
