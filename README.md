# benchmark-ts

- [benchmark-ts](#benchmark-ts)
  - [Example:](#example)
  - [Output](#output)
  - [Events](#events)
    - [`task-start`](#task-start)
    - [`task-done`](#task-done)
    - [`done`](#done)


## Example:

```typescript
import { Benchmark } from "@weedzcokie/benchmark";

function cellNumberToName(x: number) {
    let name = "";
    while (x >= 0) {
        name = String.fromCodePoint(x % 26 + 65) + name;
        x = Math.floor(x / 26) - 1;
    }
    return name;
}

const DATA_SIZE = 100000;

const lookups: string[] = [];
for (let i = 0; i < DATA_SIZE; ++i) {
    lookups.push(cellNumberToName(i));
}

function mapAssignment() {
    const map = new Map();
    for (const x of lookups) {
        map.set(x, true);
    }
    return map;
}
function setAssignment() {
    const set = new Set();
    for (const x of lookups) {
        set.add(x);
    }
    return set;
}
function objectAssignment() {
    const object: Record<string, boolean> = {};
    for (const x of lookups) {
        object[x] = true;
    }
    return object;
}

const bench = new Benchmark();
bench.add("Map assignment", mapAssignment);
bench.add("Set assignment", setAssignment);
bench.add("Object assignment", objectAssignment);

await bench.run();

console.table(bench.table());

```

Output:
```
┌───────────────────┬──────────┬────────────────┬────────────────┬───────────────────┐
│      (index)      │   Op/s   │ Set assignment │ Map assignment │ Object assignment │
├───────────────────┼──────────┼────────────────┼────────────────┼───────────────────┤
│  Set assignment   │ '171.44' │      '-'       │     '1.11'     │      '1.47'       │
│  Map assignment   │ '155.09' │     '0.90'     │      '-'       │      '1.33'       │
│ Object assignment │ '116.68' │     '0.68'     │     '0.75'     │        '-'        │
└───────────────────┴──────────┴────────────────┴────────────────┴───────────────────┘
```

## Output

We do not print anything. You can listen on the `task-start` event to know when a task is starting and
`task-done` to know then a task is done.

Example:
```typescript
bench.on("task-start", task => {
    console.log(`Running task '${task.label}'...`);
});

bench.on("task-done", (task, result) => {
    console.log("Task done:", task.label, result);
});
```

## Events

Typescript everywhere so probably easiest to look at type definitions.

### `task-start`

Fires when a task starts running.

### `task-done`

Fires when a task is done running.

### `done`

Fires when all tasks are done running.
