import { Benchmark, nsToMs, type TaskObject } from "../src/index.js";

export async function runBenchmark(tasks: TaskObject[]) {
    const bench = setupBenchmark();
    for (const task of tasks) {
        bench.add(task.label, task.fn);
    }

    await bench.runRoundRobin();
    console.table(bench.table());
}

export function setupBenchmark(...args: ConstructorParameters<typeof Benchmark>) {
    const bench = new Benchmark(...args);

    process.stdout.write("\n".repeat(bench.size() + 8));

    bench.on("progress", (tasks) => {
        const executedTaskTime = tasks.reduce((acc, value) => acc + value.elapsedTime.task, 0n);
        const totalTaskTime = bench.timePerTest * bench.size();

        process.stdout.moveCursor(0, tasks.length * -1 - 5);
        process.stdout.cursorTo(0);
        process.stdout.clearScreenDown();
        console.log(`Time spent in task execution: ${Math.round(nsToMs(executedTaskTime))} / ${totalTaskTime}`);
        const table = tasks.reduce((acc, task) => {
            const result = task.result();
            acc[task.label] = {
                ops: Math.round(result.ops),
                taskTime: nsToMs(task.elapsedTime.task),
                setupTime: nsToMs(task.elapsedTime.setup),
            }
            return acc;
        }, {} as Record<string, {ops: number; taskTime: number; setupTime: number;}>);
        console.table(table);
    });

    return bench;
}
